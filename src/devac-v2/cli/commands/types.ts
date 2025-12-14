/**
 * CLI Command Types for DevAC v2.0
 *
 * Based on spec Section 11: CLI Interface
 */

/**
 * Options for analyze command
 */
export interface AnalyzeOptions {
  /** Path to the package to analyze (defaults to current directory) */
  packagePath: string;
  /** Repository name for entity ID generation */
  repoName: string;
  /** Git branch name */
  branch: string;
  /** Only analyze if source files have changed (hash check) */
  ifChanged?: boolean;
  /** Force full reanalysis even if nothing changed */
  force?: boolean;
  /** Analyze all packages in repository */
  all?: boolean;
}

/**
 * Result from analyze command
 */
export interface AnalyzeResult {
  success: boolean;
  filesAnalyzed: number;
  nodesCreated: number;
  edgesCreated: number;
  refsCreated: number;
  skipped?: boolean;
  error?: string;
  timeMs: number;
}

/**
 * Options for query command
 */
export interface QueryOptions {
  /** SQL query to execute */
  sql: string;
  /** Path to package (for locating seed files) */
  packagePath: string;
  /** Output format */
  format: "json" | "csv" | "table";
}

/**
 * Result from query command
 */
export interface QueryResult {
  success: boolean;
  rows?: Record<string, unknown>[];
  csv?: string;
  table?: string;
  rowCount?: number;
  error?: string;
  timeMs?: number;
}

/**
 * Options for verify command
 */
export interface VerifyOptions {
  /** Path to package to verify */
  packagePath: string;
  /** Git branch to verify */
  branch?: string;
}

/**
 * Result from verify command
 */
export interface VerifyResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats?: {
    nodeCount: number;
    edgeCount: number;
    refCount: number;
    fileCount: number;
    unresolvedRefs: number;
    orphanedEdges: number;
  };
}

/**
 * Options for clean command
 */
export interface CleanOptions {
  /** Path to package to clean */
  packagePath: string;
  /** Also clean the .devac directory itself */
  cleanConfig?: boolean;
}

/**
 * Result from clean command
 */
export interface CleanResult {
  success: boolean;
  filesRemoved: number;
  bytesFreed: number;
  error?: string;
}
