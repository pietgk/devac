// src/workspace/workspace-config.ts
import { z } from "zod";

/**
 * Workspace configuration schema
 * Defines structure for multi-repository analysis in CodeGraph
 */

// ============================================================================
// Zod Schemas (Runtime Validation)
// ============================================================================

export const RepositoryConfigSchema = z.object({
  name: z.string().min(1, "Repository name cannot be empty"),
  path: z.string().min(1, "Repository path cannot be empty"),
  enabled: z.boolean().default(true),
  ignorePatterns: z.array(z.string()).optional(),
  metadata: z
    .object({
      type: z.enum(["monorepo", "app", "library"]).optional(),
      description: z.string().optional(),
    })
    .optional(),
});

export const FilterPresetSchema = z.object({
  name: z.string().min(1, "Filter preset name cannot be empty"),
  description: z.string().optional(),
  repositories: z.array(z.string()),
  maxFiles: z.number().optional(),
});

export const WorkspaceConfigSchema = z.object({
  version: z.literal("1.0"),
  workspaceRoot: z.string().min(1, "Workspace root cannot be empty"),
  repositories: z.array(RepositoryConfigSchema),
  defaults: z.object({
    ignorePatterns: z.array(z.string()).default([]),
    extensions: z.array(z.string()).default([]),
  }),
  filterPresets: z.array(FilterPresetSchema).optional(),
});

// ============================================================================
// TypeScript Types (Inferred from Zod)
// ============================================================================

export type RepositoryConfig = z.infer<typeof RepositoryConfigSchema>;
export type FilterPreset = z.infer<typeof FilterPresetSchema>;
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

// ============================================================================
// Repository Discovery Result
// ============================================================================

export interface DiscoveredRepository {
  name: string;
  absolutePath: string;
  relativePath: string;
  hasPackageJson: boolean;
  isMonorepo: boolean;
  type: "monorepo" | "app" | "library";
}

// ============================================================================
// Sync Options
// ============================================================================

export interface SyncOptions {
  /** Sync only this repository */
  repo?: string;
  /** Clear database before syncing */
  reset?: boolean;
  /** Show what would be synced without executing */
  dryRun?: boolean;
  /** Update schema before syncing */
  updateSchema?: boolean;
  /** Filter repositories by names */
  filter?: string[];
  /** Use a named filter preset */
  filterPreset?: string;
  /** Maximum files to process per repository */
  maxFiles?: number;
}

// ============================================================================
// Sync Report
// ============================================================================

export interface RepositorySyncResult {
  name: string;
  success: boolean;
  filesAnalyzed: number;
  nodesCreated: number;
  relationshipsCreated: number;
  durationMs: number;
  error?: string;
}

export interface SyncReport {
  totalRepositories: number;
  successCount: number;
  failureCount: number;
  totalFiles: number;
  totalNodes: number;
  totalRelationships: number;
  totalDurationMs: number;
  results: RepositorySyncResult[];
}

// ============================================================================
// Workspace Status
// ============================================================================

export interface RepositoryStatus {
  name: string;
  fileCount: number;
  nodeCount: number;
  relationshipCount: number;
  lastSyncedAt: string | null;
  packageCount?: number;
}

export interface WorkspaceStatus {
  repositories: RepositoryStatus[];
  totalFiles: number;
  totalNodes: number;
  totalRelationships: number;
  orphanedNodes: number; // Nodes without repository tag
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a default workspace config
 */
export function createDefaultWorkspaceConfig(
  workspaceRoot: string,
): WorkspaceConfig {
  return {
    version: "1.0",
    workspaceRoot,
    repositories: [],
    defaults: {
      ignorePatterns: [],
      extensions: [],
    },
  };
}

/**
 * Validates workspace config
 */
export function validateWorkspaceConfig(
  config: unknown,
): WorkspaceConfig | null {
  const result = WorkspaceConfigSchema.safeParse(config);
  if (!result.success) {
    return null;
  }
  return result.data;
}

/**
 * Repository metadata properties to add to all nodes
 */
export interface RepositoryMetadata {
  repository: string;
  repositoryPath: string;
  syncedAt: string;
}

/**
 * Creates repository metadata for tagging nodes
 */
export function createRepositoryMetadata(
  repo: RepositoryConfig,
): RepositoryMetadata {
  return {
    repository: repo.name,
    repositoryPath: repo.path,
    syncedAt: new Date().toISOString(),
  };
}
