// src/analyzer/parsers/import-resolver.ts
import path from "path";
import fs from "fs/promises";
import { PackageInfo } from "./package-extractor.js";
import { createContextLogger } from "../../utils/logger.js";
import { SourceFile } from "ts-morph";

const logger = createContextLogger("ImportResolver");

export interface ImportNode {
  name: string;
  importSource: string;
  importPath?: string;
  isTypeOnly: boolean;
  isDefault: boolean;
}

export interface ResolvedImport {
  resolvedPath: string;
  resolvedType: "file" | "package" | "external";
  exportedName?: string;
}

/**
 * Resolves import paths to their actual source files or packages.
 * Handles workspace packages, relative imports, and TypeScript path aliases.
 */
export class ImportResolver {
  private packages: Map<string, PackageInfo>;
  private tsConfigPaths: Map<string, string[]> = new Map();
  private workspaceRoot: string;
  private packageTsConfigs: Map<
    string,
    { paths?: Record<string, string[]>; baseUrl?: string }
  > = new Map();

  constructor(
    packages: PackageInfo[],
    workspaceRoot: string,
    tsConfigPaths?: Record<string, string[]>,
  ) {
    this.packages = new Map(packages.map((p) => [p.name, p]));
    this.workspaceRoot = path.resolve(workspaceRoot).replace(/\\/g, "/");

    if (tsConfigPaths) {
      for (const [alias, paths] of Object.entries(tsConfigPaths)) {
        this.tsConfigPaths.set(alias, paths);
      }
    }

    logger.info(
      `ImportResolver initialized with ${this.packages.size} packages`,
    );
  }

  /**
   * Loads and caches per-package tsconfig.json
   */
  private async loadPackageTsConfig(
    packagePath: string,
  ): Promise<{ paths?: Record<string, string[]>; baseUrl?: string } | null> {
    if (this.packageTsConfigs.has(packagePath)) {
      return this.packageTsConfigs.get(packagePath)!;
    }

    const tsConfigPath = path.join(packagePath, "tsconfig.json");
    try {
      const content = await fs.readFile(tsConfigPath, "utf-8");
      const tsConfig = JSON.parse(content);
      const config = {
        paths: tsConfig.compilerOptions?.paths,
        baseUrl: tsConfig.compilerOptions?.baseUrl,
      };
      this.packageTsConfigs.set(packagePath, config);
      return config;
    } catch (error) {
      // No tsconfig.json in this package - cache null to avoid re-checking
      this.packageTsConfigs.set(packagePath, {});
      return null;
    }
  }

  /**
   * Gets the package path for a given file
   */
  private getFilePackagePath(filePath: string): string | null {
    const normalizedFilePath = this.normalizePath(filePath);

    // Find which package this file belongs to
    for (const pkg of this.packages.values()) {
      const normalizedPkgPath = this.normalizePath(pkg.path);
      if (normalizedFilePath.startsWith(normalizedPkgPath + "/")) {
        return normalizedPkgPath;
      }
    }

    return null;
  }

  /**
   * Gets package-specific path aliases
   */
  private async getPackagePaths(
    fromFile: string,
  ): Promise<Map<string, string[]>> {
    const packagePath = this.getFilePackagePath(fromFile);
    if (!packagePath) {
      return this.tsConfigPaths; // Fall back to workspace paths
    }

    const pkgConfig = await this.loadPackageTsConfig(packagePath);
    if (!pkgConfig?.paths) {
      return this.tsConfigPaths; // Fall back to workspace paths
    }

    // Merge package paths with workspace paths (package paths take priority)
    const merged = new Map(this.tsConfigPaths);
    for (const [alias, paths] of Object.entries(pkgConfig.paths)) {
      merged.set(alias, paths);
    }

    return merged;
  }

  /**
   * Resolves an import to its actual file path
   */
  async resolve(
    importNode: ImportNode,
    fromFile: string,
  ): Promise<ResolvedImport | null> {
    const { importSource } = importNode;

    // Workspace package import (@mindlercare/ui-web)
    if (this.isWorkspacePackage(importSource)) {
      return this.resolveWorkspacePackage(importNode);
    }

    // Relative import (./utils, ../components)
    if (importSource.startsWith(".")) {
      return this.resolveRelativeImport(importNode, fromFile);
    }

    // TypeScript path alias - try both workspace and per-package aliases
    // This handles: @/components, core/constants, ui, hooks/reduxHooks, etc.
    const aliasResolved = await this.resolvePathAlias(importNode, fromFile);
    if (aliasResolved) {
      return aliasResolved;
    }

    // External npm package (not in workspace)
    return this.resolveExternalPackage(importSource);
  }

  /**
   * Resolves workspace package imports
   */
  private async resolveWorkspacePackage(
    importNode: ImportNode,
  ): Promise<ResolvedImport | null> {
    const { importSource, name: importedName } = importNode;

    // Handle scoped packages: @mindlercare/ui-web or @mindlercare/ui-web/src/button
    let packageName = importSource;
    let subPath = "";

    // Check if it's a sub-path import
    const parts = importSource.split("/");
    if (importSource.startsWith("@")) {
      // Scoped package: @scope/name or @scope/name/subpath
      packageName = `${parts[0]}/${parts[1]}`;
      subPath = parts.slice(2).join("/");
    } else {
      // Non-scoped: package-name or package-name/subpath
      packageName = parts[0] || "";
      subPath = parts.slice(1).join("/");
    }

    const pkg = this.packages.get(packageName);
    if (!pkg) {
      logger.debug(`Package not found in workspace: ${packageName}`);
      return null;
    }

    // If subpath is specified, resolve directly
    if (subPath) {
      const resolvedPath = this.normalizePath(path.join(pkg.path, subPath));
      const fullPath = await this.resolveWithExtensions(resolvedPath);
      if (fullPath) {
        return {
          resolvedPath: fullPath,
          resolvedType: "package",
          exportedName: importedName,
        };
      }
    }

    // Try entry point
    if (pkg.entryPoint) {
      const entryExists = await this.fileExists(pkg.entryPoint);
      if (entryExists) {
        return {
          resolvedPath: pkg.entryPoint,
          resolvedType: "package",
          exportedName: importedName,
        };
      }
    }

    // Try convention-based entry points
    const conventions = [
      "src/index.ts",
      "src/index.tsx",
      "index.ts",
      "index.js",
    ];
    for (const convention of conventions) {
      const entryPath = this.normalizePath(path.join(pkg.path, convention));
      if (await this.fileExists(entryPath)) {
        return {
          resolvedPath: entryPath,
          resolvedType: "package",
          exportedName: importedName,
        };
      }
    }

    logger.debug(`Could not resolve entry point for package: ${packageName}`);
    return null;
  }

  /**
   * Resolves relative imports
   */
  private async resolveRelativeImport(
    importNode: ImportNode,
    fromFile: string,
  ): Promise<ResolvedImport | null> {
    const { importSource, name: importedName } = importNode;
    const baseDir = path.dirname(fromFile);
    const resolvedBase = this.normalizePath(
      path.resolve(baseDir, importSource),
    );

    // Try with extensions
    const resolvedPath = await this.resolveWithExtensions(resolvedBase);
    if (resolvedPath) {
      return {
        resolvedPath,
        resolvedType: "file",
        exportedName: importedName,
      };
    }

    return null;
  }

  /**
   * Resolves TypeScript path aliases (workspace and per-package)
   */
  private async resolvePathAlias(
    importNode: ImportNode,
    fromFile: string,
  ): Promise<ResolvedImport | null> {
    const { importSource, name: importedName } = importNode;

    // Get package-specific paths (includes workspace paths as fallback)
    const pathAliases = await this.getPackagePaths(fromFile);

    // Get package-specific baseUrl
    const packagePath = this.getFilePackagePath(fromFile);
    let baseUrl = this.workspaceRoot;

    if (packagePath) {
      const pkgConfig = await this.loadPackageTsConfig(packagePath);
      if (pkgConfig?.baseUrl) {
        baseUrl = this.normalizePath(path.join(packagePath, pkgConfig.baseUrl));
      }
    }

    for (const [alias, paths] of pathAliases.entries()) {
      // Convert alias pattern to regex (e.g., "@/*" -> "^@/(.*)$")
      const aliasRegex = new RegExp("^" + alias.replace("*", "(.*)") + "$");
      const match = importSource.match(aliasRegex);

      if (match) {
        const capturedPart = match[1] || "";

        // Try each path mapping
        for (const pathPattern of paths) {
          const resolvedPattern = pathPattern.replace("*", capturedPart);
          const fullPath = this.normalizePath(
            path.join(baseUrl, resolvedPattern),
          );

          const resolved = await this.resolveWithExtensions(fullPath);
          if (resolved) {
            return {
              resolvedPath: resolved,
              resolvedType: "file",
              exportedName: importedName,
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Marks external packages (not resolved, just identified)
   */
  private resolveExternalPackage(importSource: string): ResolvedImport {
    return {
      resolvedPath: importSource,
      resolvedType: "external",
    };
  }

  /**
   * Try to resolve a file path with common extensions
   */
  private async resolveWithExtensions(
    basePath: string,
  ): Promise<string | null> {
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".d.ts"];

    // Try exact path first
    if (await this.fileExists(basePath)) {
      return basePath;
    }

    // Try with extensions
    for (const ext of extensions) {
      const pathWithExt = basePath + ext;
      if (await this.fileExists(pathWithExt)) {
        return pathWithExt;
      }
    }

    // Try index files
    for (const ext of extensions) {
      const indexPath = this.normalizePath(path.join(basePath, `index${ext}`));
      if (await this.fileExists(indexPath)) {
        return indexPath;
      }
    }

    return null;
  }

  // Helper methods

  private isWorkspacePackage(importSource: string): boolean {
    // Check if it starts with any known workspace package name
    for (const packageName of this.packages.keys()) {
      if (
        importSource === packageName ||
        importSource.startsWith(packageName + "/")
      ) {
        return true;
      }
    }
    return false;
  }

  private isPathAlias(importSource: string): boolean {
    for (const alias of this.tsConfigPaths.keys()) {
      const pattern = alias.replace("*", "");
      if (importSource.startsWith(pattern)) {
        return true;
      }
    }
    return false;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private normalizePath(filePath: string): string {
    return path.resolve(filePath).replace(/\\/g, "/");
  }
}
