// src/analyzer/parsers/package-extractor.ts
import fs from "fs/promises";
import path from "path";
import { AstNode } from "../types.js";
import { createContextLogger } from "../../utils/logger.js";
import { generateEntityId } from "../parser-utils.js";

const logger = createContextLogger("PackageExtractor");

export interface PackageInfo {
  name: string;
  type: "frontend" | "shared-library" | "tool";
  path: string;
  version: string;
  entryPoint: string | null;
}

export interface PackageNode extends AstNode {
  kind: "Package";
  properties: {
    type: "frontend" | "shared-library" | "tool";
    version: string;
    entryPoint: string | null;
  };
}

/**
 * Extracts package information from a monorepo workspace.
 * Handles pnpm workspaces, npm workspaces, and standalone projects.
 */
export class PackageExtractor {
  private workspaceRoot: string;
  private packages: Map<string, PackageInfo> = new Map();
  private packagesByPath: Map<string, PackageInfo> = new Map();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot).replace(/\\/g, "/");
    logger.info(
      `PackageExtractor initialized for workspace: ${this.workspaceRoot}`,
    );
  }

  /**
   * Simple glob pattern matcher for workspace patterns like "packages/*" or "apps/**"
   */
  private async matchPattern(pattern: string): Promise<string[]> {
    const results: string[] = [];
    const basePath = this.workspaceRoot;

    // Simple implementation for common patterns: "packages/*", "apps/*", etc.
    // Handles single * (one level) and ** (multiple levels)
    const parts = pattern.split("/");

    const traverse = async (
      currentPath: string,
      remainingParts: string[],
    ): Promise<void> => {
      if (remainingParts.length === 0) {
        results.push(currentPath);
        return;
      }

      const [part, ...rest] = remainingParts;

      if (!part) {
        return; // Guard against undefined part
      }

      if (part === "**") {
        // Recursive traversal - match current level and all subdirectories
        await traverse(currentPath, rest);
        try {
          const entries = await fs.readdir(currentPath, {
            withFileTypes: true,
          });
          for (const entry of entries) {
            if (
              entry.isDirectory() &&
              entry.name !== "node_modules" &&
              entry.name !== "dist"
            ) {
              const subPath = path.join(currentPath, entry.name);
              await traverse(subPath, remainingParts); // Keep ** in pattern
            }
          }
        } catch {
          // Directory doesn't exist or not accessible
        }
      } else if (part === "*") {
        // Single level wildcard
        try {
          const entries = await fs.readdir(currentPath, {
            withFileTypes: true,
          });
          for (const entry of entries) {
            if (
              entry.isDirectory() &&
              entry.name !== "node_modules" &&
              entry.name !== "dist"
            ) {
              const subPath = path.join(currentPath, entry.name);
              await traverse(subPath, rest);
            }
          }
        } catch {
          // Directory doesn't exist or not accessible
        }
      } else {
        // Literal directory name
        const nextPath = path.join(currentPath, part);
        if (rest) {
          await traverse(nextPath, rest);
        }
      }
    };

    await traverse(basePath, parts);
    return results.map((p) => path.resolve(p).replace(/\\/g, "/"));
  }

  /**
   * Discovers all packages in the workspace.
   */
  async discoverPackages(): Promise<PackageInfo[]> {
    logger.info("Discovering packages in workspace...");

    // Try pnpm workspace first
    const pnpmWorkspaceFile = path.join(
      this.workspaceRoot,
      "pnpm-workspace.yaml",
    );
    if (await this.fileExists(pnpmWorkspaceFile)) {
      await this.discoverPnpmWorkspace(pnpmWorkspaceFile);
    } else {
      // Try npm workspace (package.json with workspaces field)
      const rootPackageJson = path.join(this.workspaceRoot, "package.json");
      if (await this.fileExists(rootPackageJson)) {
        await this.discoverNpmWorkspace(rootPackageJson);
      } else {
        logger.warn(
          "No workspace configuration found, treating as single package",
        );
        await this.discoverSinglePackage();
      }
    }

    logger.info(`Discovered ${this.packages.size} packages`);
    return Array.from(this.packages.values());
  }

  /**
   * Discovers packages from pnpm-workspace.yaml
   */
  private async discoverPnpmWorkspace(workspaceFile: string): Promise<void> {
    try {
      const content = await fs.readFile(workspaceFile, "utf-8");
      const patterns = this.parsePnpmWorkspace(content);

      for (const pattern of patterns) {
        const matches = await this.matchPattern(pattern);

        for (const match of matches) {
          const packageJsonPath = path.join(match, "package.json");
          if (await this.fileExists(packageJsonPath)) {
            await this.loadPackage(packageJsonPath, match);
          }
        }
      }
    } catch (error: any) {
      logger.error(`Failed to parse pnpm workspace: ${error.message}`);
    }
  }

  /**
   * Discovers packages from npm workspaces in package.json
   */
  private async discoverNpmWorkspace(rootPackageJson: string): Promise<void> {
    try {
      const content = await fs.readFile(rootPackageJson, "utf-8");
      const pkg = JSON.parse(content);

      if (pkg.workspaces) {
        const patterns = Array.isArray(pkg.workspaces)
          ? pkg.workspaces
          : pkg.workspaces.packages || [];

        for (const pattern of patterns) {
          const matches = await this.matchPattern(pattern);

          for (const match of matches) {
            const packageJsonPath = path.join(match, "package.json");
            if (await this.fileExists(packageJsonPath)) {
              await this.loadPackage(packageJsonPath, match);
            }
          }
        }
      }
    } catch (error: any) {
      logger.error(`Failed to parse npm workspace: ${error.message}`);
    }
  }

  /**
   * Treats the root as a single package
   */
  private async discoverSinglePackage(): Promise<void> {
    const rootPackageJson = path.join(this.workspaceRoot, "package.json");
    if (await this.fileExists(rootPackageJson)) {
      await this.loadPackage(rootPackageJson, this.workspaceRoot);
    }
  }

  /**
   * Loads package information from package.json
   */
  private async loadPackage(
    packageJsonPath: string,
    packagePath: string,
  ): Promise<void> {
    try {
      const content = await fs.readFile(packageJsonPath, "utf-8");
      const pkg = JSON.parse(content);

      if (!pkg.name) {
        logger.warn(`Package at ${packagePath} has no name, skipping`);
        return;
      }

      const normalizedPath = packagePath.replace(/\\/g, "/");
      const entryPoint = this.resolveEntryPoint(pkg, packagePath);
      const packageType = this.determinePackageType(normalizedPath, pkg);

      const packageInfo: PackageInfo = {
        name: pkg.name,
        type: packageType,
        path: normalizedPath,
        version: pkg.version || "0.0.0",
        entryPoint,
      };

      this.packages.set(pkg.name, packageInfo);
      this.packagesByPath.set(normalizedPath, packageInfo);

      logger.debug(
        `Loaded package: ${pkg.name} (${packageType}) at ${normalizedPath}`,
      );
    } catch (error: any) {
      logger.error(
        `Failed to load package at ${packagePath}: ${error.message}`,
      );
    }
  }

  /**
   * Determines package type based on path and package.json content
   */
  private determinePackageType(
    packagePath: string,
    pkg: any,
  ): "frontend" | "shared-library" | "tool" {
    const relativePath = path
      .relative(this.workspaceRoot, packagePath)
      .replace(/\\/g, "/");

    // Check path patterns
    if (
      relativePath.startsWith("frontends/") ||
      relativePath.startsWith("apps/")
    ) {
      return "frontend";
    }

    if (
      relativePath.startsWith("packages/") ||
      relativePath.startsWith("libs/")
    ) {
      return "shared-library";
    }

    // Check package.json indicators
    if (pkg.private === false || pkg.publishConfig) {
      return "shared-library";
    }

    // Check dependencies
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (
      deps["react"] ||
      deps["vue"] ||
      deps["@angular/core"] ||
      deps["next"] ||
      deps["vite"]
    ) {
      return "frontend";
    }

    return "tool";
  }

  /**
   * Resolves the entry point file for a package
   */
  private resolveEntryPoint(pkg: any, packagePath: string): string | null {
    // Try exports field first (modern)
    if (pkg.exports) {
      if (typeof pkg.exports === "string") {
        return this.normalizePath(path.join(packagePath, pkg.exports));
      }
      if (pkg.exports["."]) {
        const entry = pkg.exports["."];
        if (typeof entry === "string") {
          return this.normalizePath(path.join(packagePath, entry));
        }
        if (entry.import || entry.require) {
          return this.normalizePath(
            path.join(packagePath, entry.import || entry.require),
          );
        }
      }
    }

    // Try main field (classic)
    if (pkg.main) {
      return this.normalizePath(path.join(packagePath, pkg.main));
    }

    // Try module field (ESM)
    if (pkg.module) {
      return this.normalizePath(path.join(packagePath, pkg.module));
    }

    // Default conventions
    const conventions = [
      "src/index.ts",
      "src/index.tsx",
      "src/index.js",
      "index.ts",
      "index.js",
    ];

    for (const convention of conventions) {
      const entryPath = this.normalizePath(path.join(packagePath, convention));
      // We can't check file existence here synchronously, but we can return the path
      return entryPath;
    }

    return null;
  }

  /**
   * Gets the package that contains a given file path
   */
  getPackageForFile(filePath: string): PackageInfo | null {
    const normalizedPath = path.resolve(filePath).replace(/\\/g, "/");

    // Find the package with the longest matching path (most specific)
    let bestMatch: PackageInfo | null = null;
    let longestMatch = 0;

    for (const [pkgPath, pkgInfo] of this.packagesByPath.entries()) {
      if (
        normalizedPath.startsWith(pkgPath + "/") ||
        normalizedPath === pkgPath
      ) {
        if (pkgPath.length > longestMatch) {
          longestMatch = pkgPath.length;
          bestMatch = pkgInfo;
        }
      }
    }

    return bestMatch;
  }

  /**
   * Creates Package nodes for Neo4j
   */
  createPackageNodes(now: string): PackageNode[] {
    const nodes: PackageNode[] = [];

    for (const pkg of this.packages.values()) {
      const entityId = generateEntityId("package", pkg.name);

      const node: PackageNode = {
        id: entityId, // Use entityId as id for simplicity
        entityId,
        kind: "Package",
        name: pkg.name,
        filePath: pkg.path,
        language: "Meta", // Meta-level node
        startLine: 0,
        endLine: 0,
        startColumn: 0,
        endColumn: 0,
        properties: {
          type: pkg.type,
          version: pkg.version,
          entryPoint: pkg.entryPoint,
        },
        createdAt: now,
      };

      nodes.push(node);
    }

    return nodes;
  }

  /**
   * Gets all discovered packages
   */
  getPackages(): PackageInfo[] {
    return Array.from(this.packages.values());
  }

  // Helper methods

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private parsePnpmWorkspace(content: string): string[] {
    const patterns: string[] = [];
    const lines = content.split("\n");
    let inPackagesSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === "packages:") {
        inPackagesSection = true;
        continue;
      }

      if (inPackagesSection && trimmed.startsWith("-")) {
        const pattern = trimmed.substring(1).trim().replace(/['"]/g, "");
        patterns.push(pattern);
      } else if (inPackagesSection && trimmed && !trimmed.startsWith("#")) {
        // End of packages section
        break;
      }
    }

    return patterns;
  }

  private normalizePath(filePath: string): string {
    return path.resolve(filePath).replace(/\\/g, "/");
  }
}
