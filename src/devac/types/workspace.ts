// src/devac/types/workspace.ts

/**
 * Workspace discovery types for package-aware service configuration
 */

export type WorkspaceType = "npm" | "pnpm" | "yarn" | "single" | "unknown";
export type BuildSystem = "turborepo" | "lerna" | "nx" | "none";
export type ServiceStrategy =
  | "aggregate"
  | "per-package"
  | "turborepo"
  | "single";

/**
 * Workspace discovery result for a single repository
 */
export interface WorkspaceDiscovery {
  repository: {
    path: string;
    name: string;
  };

  // Workspace metadata
  workspaceType: WorkspaceType;
  packageManager: string; // npm, pnpm, yarn
  packageManagerVersion?: string;

  // Root package.json
  rootPackage: {
    name: string;
    scripts: Record<string, string>;
    workspaces?: string[];
  };

  // Discovered packages/workspaces
  packages: PackageDiscovery[];

  // Build system (if monorepo)
  buildSystem?: BuildSystem;

  // Node version requirement
  nodeVersion?: string; // From .nvmrc, volta, or package.json engines
}

/**
 * Individual package discovery within a workspace
 */
export interface PackageDiscovery {
  name: string;
  path: string; // Relative to repo root
  packageJson: {
    name: string;
    scripts: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  // Detected capabilities
  hasTests: boolean;
  hasLint: boolean;
  hasTypeCheck: boolean;

  // Script names found
  testScript?: string; // 'test', 'test:unit', 'test:integration', etc.
  lintScript?: string; // 'lint', 'lint:check', etc.
  typeCheckScript?: string; // 'typecheck', 'type-check', 'tsc', etc.

  // TypeScript config
  tsConfigPath?: string; // Path to tsconfig.json

  // ESLint config
  eslintConfigPath?: string; // Path to .eslintrc.* or eslintConfig in package.json
}

/**
 * LLM-generated configuration recommendation
 */
export interface ServiceRecommendation {
  strategy: ServiceStrategy;
  command: string;
  workingDirectory: string;
  rationale: string;
  watch?: boolean;
  enabled?: boolean;

  // For per-package strategy
  packages?: PackageRecommendation[];
}

export interface PackageRecommendation {
  name: string;
  command: string;
  workingDirectory: string;
  enabled: boolean;
  watch?: boolean;
}

/**
 * Complete LLM recommendation response
 */
export interface ConfigurationRecommendation {
  recommendations: {
    typecheck?: ServiceRecommendation;
    lint?: ServiceRecommendation;
    test?: ServiceRecommendation;
  };
  rationale: string;
}
