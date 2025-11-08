// src/devac/types/workspace.ts

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Workspace unique identifier */
  id: string;
  /** Workspace name */
  name: string;
  /** Workspace root directory */
  rootPath: string;
  /** Neo4j database name for this workspace */
  database: string;
  /** Services enabled in this workspace */
  services: Record<string, any>;
  /** Created timestamp */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
  /** Workspace metadata */
  metadata?: {
    /** Git branch (if applicable) */
    branch?: string;
    /** Environment stage (dev, staging, prod) */
    stage?: string;
    /** Tags */
    tags?: string[];
  };
}

/**
 * Repository discovery result
 */
export interface DiscoveredRepository {
  /** Repository name */
  name: string;
  /** Full path to repository */
  path: string;
  /** Whether it's a git repository */
  isGitRepo: boolean;
  /** Git remote URL if available */
  remoteUrl?: string;
  /** Current branch */
  branch?: string;
  /** Last commit hash */
  lastCommit?: string;
  /** Primary language detected */
  primaryLanguage?: string;
}

/**
 * Workspace state for persistence
 */
export interface WorkspaceState {
  /** Workspace configuration */
  config: WorkspaceConfig;
  /** Service states */
  services: Record<string, any>;
  /** Last snapshot timestamp */
  snapshotAt: string;
}
