// src/devac/discovery/workspace-discovery.ts

import fs from "fs/promises";
import path from "path";
import { glob } from "glob";
import { createContextLogger } from "../../utils/logger.js";
import type {
  WorkspaceDiscovery,
  PackageDiscovery,
  WorkspaceType,
  BuildSystem,
} from "../types/workspace.js";

const logger = createContextLogger("WorkspaceDiscovery");

/**
 * Discover workspace structure for a repository
 */
export async function discoverWorkspace(
  repoPath: string,
): Promise<WorkspaceDiscovery> {
  logger.info(`Discovering workspace: ${repoPath}`);

  const absolutePath = path.resolve(repoPath);

  // Read root package.json
  const rootPackageJsonPath = path.join(absolutePath, "package.json");
  const rootPackageExists = await fileExists(rootPackageJsonPath);

  if (!rootPackageExists) {
    throw new Error(`No package.json found at ${absolutePath}`);
  }

  const rootPackageJson = JSON.parse(
    await fs.readFile(rootPackageJsonPath, "utf-8"),
  );

  // Detect workspace type
  const workspaceType = detectWorkspaceType(rootPackageJson);

  // Detect package manager
  const packageManager = await detectPackageManager(absolutePath);
  const packageManagerVersion = await detectPackageManagerVersion(
    absolutePath,
    packageManager,
  );

  // Find all packages
  const packages = await findPackages(absolutePath, rootPackageJson.workspaces);

  // Detect build system
  const buildSystem = await detectBuildSystem(absolutePath, rootPackageJson);

  // Detect Node version
  const nodeVersion = await detectNodeVersion(absolutePath, rootPackageJson);

  const discovery: WorkspaceDiscovery = {
    repository: {
      path: absolutePath,
      name: path.basename(absolutePath),
    },
    workspaceType,
    packageManager,
    packageManagerVersion,
    rootPackage: {
      name: rootPackageJson.name || path.basename(absolutePath),
      scripts: rootPackageJson.scripts || {},
      workspaces: rootPackageJson.workspaces,
    },
    packages,
    buildSystem,
    nodeVersion,
  };

  logger.info(
    `Discovered ${packages.length} packages in ${discovery.repository.name}`,
  );

  return discovery;
}

/**
 * Detect workspace type from package.json
 */
function detectWorkspaceType(packageJson: any): WorkspaceType {
  if (packageJson.workspaces) {
    // Check package manager hints
    if (packageJson.packageManager?.startsWith("pnpm")) {
      return "pnpm";
    }
    if (packageJson.packageManager?.startsWith("yarn")) {
      return "yarn";
    }
    // Default to npm workspaces
    return "npm";
  }

  return "single";
}

/**
 * Detect package manager from lock files
 */
async function detectPackageManager(repoPath: string): Promise<string> {
  const lockFiles = {
    "pnpm-lock.yaml": "pnpm",
    "yarn.lock": "yarn",
    "package-lock.json": "npm",
  };

  for (const [lockFile, manager] of Object.entries(lockFiles)) {
    if (await fileExists(path.join(repoPath, lockFile))) {
      return manager;
    }
  }

  return "npm"; // Default
}

/**
 * Detect package manager version
 */
async function detectPackageManagerVersion(
  repoPath: string,
  packageManager: string,
): Promise<string | undefined> {
  try {
    const packageJsonPath = path.join(repoPath, "package.json");
    const packageJson = JSON.parse(
      await fs.readFile(packageJsonPath, "utf-8"),
    );

    if (packageJson.packageManager) {
      // Format: "pnpm@8.9.0"
      const version = packageJson.packageManager.split("@")[1];
      return version;
    }
  } catch (error) {
    logger.debug(`Could not detect ${packageManager} version`, { error });
  }

  return undefined;
}

/**
 * Find all packages in the workspace
 */
async function findPackages(
  repoPath: string,
  workspaces?: string[],
): Promise<PackageDiscovery[]> {
  if (!workspaces) {
    // Single package - analyze root
    return [await analyzePackage(repoPath, ".")];
  }

  const packages: PackageDiscovery[] = [];

  for (const workspace of workspaces) {
    // Glob pattern like "services/*" or "packages/**"
    const pattern = path.join(repoPath, workspace, "package.json");
    const packageJsonFiles = await glob(pattern, {
      ignore: ["**/node_modules/**"],
    });

    for (const packageJsonPath of packageJsonFiles) {
      const packageDir = path.dirname(packageJsonPath);
      const relativePath = path.relative(repoPath, packageDir);
      const packageDiscovery = await analyzePackage(repoPath, relativePath);
      packages.push(packageDiscovery);
    }
  }

  return packages;
}

/**
 * Analyze a single package
 */
async function analyzePackage(
  repoPath: string,
  relativePath: string,
): Promise<PackageDiscovery> {
  const packagePath = path.join(repoPath, relativePath);
  const packageJsonPath = path.join(packagePath, "package.json");

  const packageJson = JSON.parse(
    await fs.readFile(packageJsonPath, "utf-8"),
  );

  // Detect capabilities
  const hasTests = await hasTestFiles(packagePath) || hasScript(packageJson, "test");
  const hasLint = hasScript(packageJson, "lint");
  const hasTypeCheck =
    hasScript(packageJson, "typecheck", "type-check", "tsc") ||
    (await fileExists(path.join(packagePath, "tsconfig.json")));

  // Find script names
  const testScript = findScript(packageJson, "test");
  const lintScript = findScript(packageJson, "lint");
  const typeCheckScript = findScript(
    packageJson,
    "typecheck",
    "type-check",
    "tsc",
  );

  // Find config files
  const tsConfigPath = (await fileExists(path.join(packagePath, "tsconfig.json")))
    ? path.join(relativePath, "tsconfig.json")
    : undefined;

  const eslintConfigPath = await findEslintConfig(packagePath, relativePath);

  return {
    name: packageJson.name || path.basename(packagePath),
    path: relativePath,
    packageJson: {
      name: packageJson.name,
      scripts: packageJson.scripts || {},
      dependencies: packageJson.dependencies,
      devDependencies: packageJson.devDependencies,
    },
    hasTests,
    hasLint,
    hasTypeCheck,
    testScript,
    lintScript,
    typeCheckScript,
    tsConfigPath,
    eslintConfigPath,
  };
}

/**
 * Check if package has test files
 */
async function hasTestFiles(packagePath: string): Promise<boolean> {
  const testPatterns = [
    "**/*.test.ts",
    "**/*.test.js",
    "**/*.spec.ts",
    "**/*.spec.js",
    "**/__tests__/**/*.ts",
    "**/__tests__/**/*.js",
  ];

  for (const pattern of testPatterns) {
    const files = await glob(path.join(packagePath, pattern), {
      ignore: ["**/node_modules/**"],
    });
    if (files.length > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Check if package.json has a script
 */
function hasScript(packageJson: any, ...scriptNames: string[]): boolean {
  const scripts = packageJson.scripts || {};
  return scriptNames.some((name) => name in scripts);
}

/**
 * Find script name in package.json
 */
function findScript(
  packageJson: any,
  ...scriptNames: string[]
): string | undefined {
  const scripts = packageJson.scripts || {};
  for (const name of scriptNames) {
    if (name in scripts) {
      return name;
    }
  }
  return undefined;
}

/**
 * Find ESLint config file
 */
async function findEslintConfig(
  packagePath: string,
  relativePath: string,
): Promise<string | undefined> {
  const configFiles = [
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yml",
    ".eslintrc.yaml",
    "eslint.config.js",
    "eslint.config.mjs",
  ];

  for (const configFile of configFiles) {
    if (await fileExists(path.join(packagePath, configFile))) {
      return path.join(relativePath, configFile);
    }
  }

  // Check if eslintConfig is in package.json
  try {
    const packageJsonPath = path.join(packagePath, "package.json");
    const packageJson = JSON.parse(
      await fs.readFile(packageJsonPath, "utf-8"),
    );
    if (packageJson.eslintConfig) {
      return path.join(relativePath, "package.json#eslintConfig");
    }
  } catch (error) {
    // Ignore
  }

  return undefined;
}

/**
 * Detect build system
 */
async function detectBuildSystem(
  repoPath: string,
  packageJson: any,
): Promise<BuildSystem | undefined> {
  // Check for Turborepo
  if (
    (await fileExists(path.join(repoPath, "turbo.json"))) ||
    packageJson.devDependencies?.turbo ||
    packageJson.dependencies?.turbo
  ) {
    return "turborepo";
  }

  // Check for Lerna
  if (
    (await fileExists(path.join(repoPath, "lerna.json"))) ||
    packageJson.devDependencies?.lerna ||
    packageJson.dependencies?.lerna
  ) {
    return "lerna";
  }

  // Check for Nx
  if (
    (await fileExists(path.join(repoPath, "nx.json"))) ||
    packageJson.devDependencies?.nx ||
    packageJson.dependencies?.nx
  ) {
    return "nx";
  }

  return "none";
}

/**
 * Detect Node version requirement
 */
async function detectNodeVersion(
  repoPath: string,
  packageJson: any,
): Promise<string | undefined> {
  // Check .nvmrc
  const nvmrcPath = path.join(repoPath, ".nvmrc");
  if (await fileExists(nvmrcPath)) {
    const version = (await fs.readFile(nvmrcPath, "utf-8")).trim();
    return version;
  }

  // Check volta in package.json
  if (packageJson.volta?.node) {
    return packageJson.volta.node;
  }

  // Check engines in package.json
  if (packageJson.engines?.node) {
    return packageJson.engines.node;
  }

  return undefined;
}

/**
 * Check if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
