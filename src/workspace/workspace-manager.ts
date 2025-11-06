// src/workspace/workspace-manager.ts
import fs from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { Neo4jClient } from "../database/neo4j-client.js";
import { AnalyzerService } from "../analyzer/analyzer-service.js";
import { createContextLogger } from "../utils/logger.js";
import type {
  WorkspaceConfig,
  RepositoryConfig,
  DiscoveredRepository,
  SyncOptions,
  SyncReport,
  RepositorySyncResult,
  WorkspaceStatus,
  RepositoryStatus,
  RepositoryMetadata,
} from "./workspace-config.js";
import {
  createDefaultWorkspaceConfig,
  validateWorkspaceConfig,
  createRepositoryMetadata,
} from "./workspace-config.js";

const logger = createContextLogger("WorkspaceManager");

/**
 * Manages multi-repository workspace operations
 */
export class WorkspaceManager {
  constructor(private neo4jClient: Neo4jClient) {}

  /**
   * Discovers repositories in a workspace directory
   * Looks for package.json files and identifies monorepos
   */
  async discoverRepositories(
    workspaceRoot: string,
  ): Promise<DiscoveredRepository[]> {
    logger.info(`Discovering repositories in: ${workspaceRoot}`);
    const discovered: DiscoveredRepository[] = [];
    const absoluteRoot = path.resolve(workspaceRoot);

    try {
      const entries = await fs.readdir(absoluteRoot, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // Skip hidden and common non-code directories
        if (
          entry.name.startsWith(".") ||
          entry.name === "node_modules" ||
          entry.name === "logs"
        ) {
          continue;
        }

        const repoPath = path.join(absoluteRoot, entry.name);
        const packageJsonPath = path.join(repoPath, "package.json");

        // Check if directory has package.json
        const hasPackageJson = existsSync(packageJsonPath);
        if (!hasPackageJson) {
          logger.debug(`Skipping ${entry.name} (no package.json)`);
          continue;
        }

        // Check for monorepo indicators
        const isMonorepo =
          existsSync(path.join(repoPath, "pnpm-workspace.yaml")) ||
          existsSync(path.join(repoPath, "lerna.json")) ||
          existsSync(path.join(repoPath, "nx.json"));

        // Try to read package.json to determine type
        let type: "monorepo" | "app" | "library" = "library";
        try {
          const pkgContent = await fs.readFile(packageJsonPath, "utf-8");
          const pkg = JSON.parse(pkgContent);

          if (isMonorepo) {
            type = "monorepo";
          } else if (
            pkg.dependencies?.["react-native"] ||
            pkg.dependencies?.["expo"]
          ) {
            type = "app";
          } else if (
            pkg.dependencies?.["react"] ||
            pkg.dependencies?.["next"]
          ) {
            type = "app";
          } else if (pkg.private === false || pkg.publishConfig) {
            type = "library";
          }
        } catch (error) {
          logger.warn(`Failed to read package.json for ${entry.name}`);
        }

        discovered.push({
          name: entry.name,
          absolutePath: repoPath,
          relativePath: entry.name,
          hasPackageJson,
          isMonorepo,
          type,
        });

        logger.debug(
          `Found repository: ${entry.name} (${type}${isMonorepo ? ", monorepo" : ""})`,
        );
      }

      logger.info(`Discovered ${discovered.length} repositories`);
      return discovered;
    } catch (error: any) {
      logger.error(`Failed to discover repositories: ${error.message}`);
      throw error;
    }
  }

  /**
   * Converts discovered repositories to repository configs
   */
  convertToRepositoryConfigs(
    discovered: DiscoveredRepository[],
  ): RepositoryConfig[] {
    return discovered.map((repo) => ({
      name: repo.name,
      path: repo.relativePath,
      enabled: true,
      metadata: {
        type: repo.type,
        description: undefined,
      },
    }));
  }

  /**
   * Syncs repositories to Neo4j database
   */
  async syncRepositories(
    config: WorkspaceConfig,
    options: SyncOptions = {},
  ): Promise<SyncReport> {
    logger.info("Starting workspace sync...");
    const startTime = Date.now();

    // Filter repositories based on options
    let reposToSync = config.repositories.filter((r) => r.enabled);

    // Handle filter preset first (takes precedence over individual filters)
    if (options.filterPreset) {
      const preset = config.filterPresets?.find(
        (p) => p.name === options.filterPreset,
      );
      if (!preset) {
        throw new Error(
          `Filter preset "${options.filterPreset}" not found in config`,
        );
      }
      logger.verbose(
        `Applying filter preset: ${preset.name} (${preset.description || "no description"})`,
      );
      reposToSync = reposToSync.filter((r) =>
        preset.repositories.includes(r.name),
      );
      // Apply maxFiles from preset if not overridden
      if (preset.maxFiles && !options.maxFiles) {
        options.maxFiles = preset.maxFiles;
      }
    }
    // Handle individual filter option
    else if (options.filter && options.filter.length > 0) {
      reposToSync = reposToSync.filter((r) => options.filter!.includes(r.name));
      logger.verbose(`Filtering repositories: ${options.filter.join(", ")}`);
    }
    // Handle legacy --repos option
    else if (options.repo) {
      reposToSync = reposToSync.filter((r) => r.name === options.repo);
      if (reposToSync.length === 0) {
        throw new Error(`Repository "${options.repo}" not found in config`);
      }
    }

    if (reposToSync.length === 0) {
      throw new Error("No repositories match the specified filters");
    }

    logger.info(`Syncing ${reposToSync.length} repositories...`);

    const results: RepositorySyncResult[] = [];
    let totalFiles = 0;
    let totalNodes = 0;
    let totalRelationships = 0;

    for (const repo of reposToSync) {
      const result = await this.syncSingleRepository(config, repo, options);
      results.push(result);

      if (result.success) {
        totalFiles += result.filesAnalyzed;
        totalNodes += result.nodesCreated;
        totalRelationships += result.relationshipsCreated;
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    const report: SyncReport = {
      totalRepositories: reposToSync.length,
      successCount,
      failureCount,
      totalFiles,
      totalNodes,
      totalRelationships,
      totalDurationMs,
      results,
    };

    logger.info(
      `Sync complete: ${successCount}/${reposToSync.length} successful in ${(totalDurationMs / 1000).toFixed(1)}s`,
    );
    return report;
  }

  /**
   * Syncs a single repository
   */
  private async syncSingleRepository(
    config: WorkspaceConfig,
    repo: RepositoryConfig,
    options: SyncOptions,
  ): Promise<RepositorySyncResult> {
    logger.info(`Syncing repository: ${repo.name}`);
    const startTime = Date.now();

    try {
      if (options.dryRun) {
        logger.info(`[DRY RUN] Would analyze: ${repo.name}`);
        return {
          name: repo.name,
          success: true,
          filesAnalyzed: 0,
          nodesCreated: 0,
          relationshipsCreated: 0,
          durationMs: 0,
        };
      }

      const repoPath = path.join(config.workspaceRoot, repo.path);
      if (!existsSync(repoPath)) {
        throw new Error(`Repository path does not exist: ${repoPath}`);
      }

      // Create analyzer with repository metadata
      const repoMetadata = createRepositoryMetadata(repo);
      const analyzerService = new AnalyzerService(
        {}, // Use default Neo4j config
        repoPath,
        repoMetadata, // Pass metadata to tag all nodes
      );

      // Merge default and repository-specific ignore patterns
      const ignorePatterns = [
        ...config.defaults.ignorePatterns,
        ...(repo.ignorePatterns || []),
      ];

      // Run analysis with workspace config
      await analyzerService.analyze(repoPath, {
        ignorePatterns,
        supportedExtensions: config.defaults.extensions,
        maxFiles: options.maxFiles,
      });

      // Get stats from Neo4j
      const stats = await this.getRepositoryStats(repo.name);

      const durationMs = Date.now() - startTime;
      logger.info(
        `✓ ${repo.name} (${stats.files} files in ${(durationMs / 1000).toFixed(1)}s)`,
      );

      return {
        name: repo.name,
        success: true,
        filesAnalyzed: stats.files,
        nodesCreated: stats.nodes,
        relationshipsCreated: stats.relationships,
        durationMs,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      logger.error(`✗ ${repo.name} failed: ${error.message}`);

      return {
        name: repo.name,
        success: false,
        filesAnalyzed: 0,
        nodesCreated: 0,
        relationshipsCreated: 0,
        durationMs,
        error: error.message,
      };
    }
  }

  /**
   * Gets repository statistics from Neo4j
   */
  private async getRepositoryStats(
    repoName: string,
  ): Promise<{ files: number; nodes: number; relationships: number }> {
    try {
      const session = await this.neo4jClient.getSession("READ");
      try {
        const result = await session.run(
          `
          MATCH (f:File {repository: $repo})
          WITH count(f) as files
          MATCH (n {repository: $repo})
          WITH files, count(n) as nodes
          MATCH (n1 {repository: $repo})-[r]->(n2)
          RETURN files, nodes, count(r) as relationships
        `,
          { repo: repoName },
        );

        if (result.records.length === 0) {
          return { files: 0, nodes: 0, relationships: 0 };
        }

        const record = result.records[0];
        if (!record) {
          return { files: 0, nodes: 0, relationships: 0 };
        }

        return {
          files: record.get("files")?.toNumber() || 0,
          nodes: record.get("nodes")?.toNumber() || 0,
          relationships: record.get("relationships")?.toNumber() || 0,
        };
      } finally {
        await session.close();
      }
    } catch (error) {
      logger.warn(`Failed to get stats for ${repoName}, returning zeros`);
      return { files: 0, nodes: 0, relationships: 0 };
    }
  }

  /**
   * Gets workspace status from Neo4j
   */
  async getWorkspaceStatus(): Promise<WorkspaceStatus> {
    logger.info("Getting workspace status...");

    try {
      const session = await this.neo4jClient.getSession("READ");
      try {
        // Get status for each repository
        const repoResult = await session.run(`
          MATCH (f:File)
          WHERE f.repository IS NOT NULL
          WITH f.repository as repo,
               f.repositoryPath as path,
               max(f.syncedAt) as lastSync,
               count(f) as files
          MATCH (n {repository: repo})
          WITH repo, path, lastSync, files, count(n) as nodes
          MATCH (n1 {repository: repo})-[r]->(n2)
          WITH repo, path, lastSync, files, nodes, count(r) as rels
          OPTIONAL MATCH (p:Package {repository: repo})
          RETURN repo as name,
                 files as fileCount,
                 nodes as nodeCount,
                 rels as relationshipCount,
                 lastSync,
                 count(p) as packageCount
          ORDER BY name
        `);

        const repositories: RepositoryStatus[] = repoResult.records.map(
          (record) => ({
            name: record.get("name"),
            fileCount: record.get("fileCount")?.toNumber() || 0,
            nodeCount: record.get("nodeCount")?.toNumber() || 0,
            relationshipCount: record.get("relationshipCount")?.toNumber() || 0,
            lastSyncedAt: record.get("lastSync") || null,
            packageCount: record.get("packageCount")?.toNumber() || 0,
          }),
        );

        // Get orphaned nodes (no repository tag)
        const orphanResult = await session.run(`
          MATCH (n)
          WHERE n.repository IS NULL
          RETURN count(n) as orphanCount
        `);

        const orphanedNodes =
          orphanResult.records[0]?.get("orphanCount")?.toNumber() || 0;

        const status: WorkspaceStatus = {
          repositories,
          totalFiles: repositories.reduce((sum, r) => sum + r.fileCount, 0),
          totalNodes: repositories.reduce((sum, r) => sum + r.nodeCount, 0),
          totalRelationships: repositories.reduce(
            (sum, r) => sum + r.relationshipCount,
            0,
          ),
          orphanedNodes,
        };

        logger.info(
          `Status retrieved: ${status.repositories.length} repositories, ${status.totalFiles} files`,
        );
        return status;
      } finally {
        await session.close();
      }
    } catch (error: any) {
      logger.error(`Failed to get workspace status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Cleans a repository from the database
   */
  async cleanRepository(repoName: string): Promise<number> {
    logger.info(`Cleaning repository: ${repoName}`);

    try {
      const session = await this.neo4jClient.getSession("WRITE");
      try {
        // Delete all nodes and relationships for this repository
        const result = await session.run(
          `
          MATCH (n {repository: $repo})
          WITH n, count(*) as nodeCount
          DETACH DELETE n
          RETURN nodeCount
        `,
          { repo: repoName },
        );

        const deletedCount =
          result.records[0]?.get("nodeCount")?.toNumber() || 0;
        logger.info(`Deleted ${deletedCount} nodes for ${repoName}`);
        return deletedCount;
      } finally {
        await session.close();
      }
    } catch (error: any) {
      logger.error(`Failed to clean repository: ${error.message}`);
      throw error;
    }
  }

  /**
   * Saves workspace config to file
   */
  async saveConfig(config: WorkspaceConfig, configPath: string): Promise<void> {
    logger.info(`Saving workspace config to: ${configPath}`);

    try {
      // Ensure directory exists
      const dir = path.dirname(configPath);
      await fs.mkdir(dir, { recursive: true });

      // Write config
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

      logger.info("Workspace config saved successfully");
    } catch (error: any) {
      logger.error(`Failed to save config: ${error.message}`);
      throw error;
    }
  }

  /**
   * Loads workspace config from file
   */
  async loadConfig(configPath: string): Promise<WorkspaceConfig> {
    logger.info(`Loading workspace config from: ${configPath}`);

    try {
      const content = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(content);
      const validated = validateWorkspaceConfig(parsed);

      if (!validated) {
        throw new Error("Invalid workspace configuration");
      }

      logger.info("Workspace config loaded successfully");
      return validated;
    } catch (error: any) {
      logger.error(`Failed to load config: ${error.message}`);
      throw error;
    }
  }
}
