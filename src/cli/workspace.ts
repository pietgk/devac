// src/cli/workspace.ts
import { Command } from "commander";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { Neo4jClient } from "../database/neo4j-client.js";
import {
  WorkspaceConfig,
  RepositoryConfig,
} from "../workspace/workspace-config.js";
import { createContextLogger, updateLogLevel } from "../utils/logger.js";
import { setVerbosity } from "../config/index.js";
import path from "path";
import fs from "fs/promises";

const logger = createContextLogger("WorkspaceCLI");

export function createWorkspaceCommand(): Command {
  const workspace = new Command("workspace").description(
    "Multi-repository workspace management",
  );

  workspace
    .command("init")
    .description(
      "Initialize workspace configuration by discovering repositories",
    )
    .option(
      "-w, --workspace-root <path>",
      "Workspace root directory",
      process.cwd(),
    )
    .option(
      "-o, --output <path>",
      "Output config file path",
      ".codegraph/workspace.json",
    )
    .action(async (options) => {
      try {
        logger.info(`Initializing workspace configuration...`);

        const workspaceRoot = path.resolve(options.workspaceRoot);
        const outputPath = path.resolve(options.output);

        // Create Neo4j client (only needed for status queries later)
        const neo4jClient = new Neo4jClient();
        const manager = new WorkspaceManager(neo4jClient);

        // Discover repositories
        logger.info(`Scanning workspace: ${workspaceRoot}`);
        const discovered = await manager.discoverRepositories(workspaceRoot);
        logger.info(`Found ${discovered.length} repositories`);

        // Convert to repository configs
        const repositories = manager.convertToRepositoryConfigs(discovered);

        // Create workspace config
        const config: WorkspaceConfig = {
          version: "1.0",
          workspaceRoot,
          repositories,
          defaults: {
            ignorePatterns: [
              "**/node_modules/**",
              "**/dist/**",
              "**/build/**",
              "**/.git/**",
              "**/coverage/**",
              "**/.next/**",
              "**/storybook-static/**",
            ],
            extensions: [
              ".ts",
              ".tsx",
              ".js",
              ".jsx",
              ".py",
              ".java",
              ".cs",
              ".go",
              ".c",
              ".cpp",
              ".h",
            ],
          },
        };

        // Save config
        await manager.saveConfig(config, outputPath);

        logger.info(`\n✅ Workspace configuration created at: ${outputPath}`);
        logger.info(`\nDiscovered repositories:`);
        repositories.forEach((repo) => {
          logger.info(`  - ${repo.name} (${repo.metadata?.type || "unknown"})`);
        });
        logger.info(`\nNext steps:`);
        logger.info(`  1. Review ${outputPath}`);
        logger.info(`  2. Run: codegraph workspace sync`);

        await neo4jClient.closeDriver("WorkspaceCLI-Init");
      } catch (error: any) {
        logger.error(`Failed to initialize workspace: ${error.message}`);
        process.exit(1);
      }
    });

  workspace
    .command("sync")
    .description("Sync repositories to Neo4j database")
    .option(
      "-c, --config <path>",
      "Config file path",
      ".codegraph/workspace.json",
    )
    .option(
      "-r, --repos <names...>",
      "Specific repositories to sync (comma-separated)",
    )
    .option("--clean", "Clean database before syncing", false)
    .option("-v, --verbose", "Enable verbose logging")
    .option("-vv, --very-verbose", "Enable debug logging")
    .option("-vvv, --trace", "Enable trace logging (most detailed)")
    .option("--debug", "Enable debug logging (same as -vvv)")
    .option("-f, --filter <repos...>", "Filter specific repositories to sync")
    .option("--filter-preset <name>", "Use a named filter preset from config")
    .option(
      "--max-files <number>",
      "Maximum files to process per repository",
      parseInt,
    )
    .action(async (options) => {
      // Calculate verbosity level from flags
      let verbosity = 0;
      if (options.trace || options.debug) verbosity = 3;
      else if (options.veryVerbose) verbosity = 2;
      else if (options.verbose) verbosity = 1;

      // Set verbosity and update logger
      if (verbosity > 0) {
        setVerbosity(verbosity);
        updateLogLevel();
      }
      try {
        logger.info(`Starting workspace sync...`);

        const configPath = path.resolve(options.config);

        // Load config
        const neo4jClient = new Neo4jClient();
        const manager = new WorkspaceManager(neo4jClient);
        const config = await manager.loadConfig(configPath);

        // Build sync options
        const syncOptions: {
          repo?: string;
          reset?: boolean;
          filter?: string[];
          filterPreset?: string;
          maxFiles?: number;
        } = {
          repo: options.repos?.[0], // Take first repo if specified
          reset: options.clean,
          filter: options.filter,
          filterPreset: options.filterPreset,
          maxFiles: options.maxFiles,
        };

        // Log active filters
        if (syncOptions.filter) {
          logger.info(
            `Filtering repositories: ${syncOptions.filter.join(", ")}`,
          );
        }
        if (syncOptions.filterPreset) {
          logger.info(`Using filter preset: ${syncOptions.filterPreset}`);
        }
        if (syncOptions.maxFiles) {
          logger.info(`Maximum files per repository: ${syncOptions.maxFiles}`);
        }

        logger.info(`Syncing repositories...`);
        const report = await manager.syncRepositories(config, syncOptions);

        // Display results
        logger.info(`\n✅ Workspace sync complete!`);
        logger.info(`\nSummary:`);
        logger.info(`  Total repositories: ${report.totalRepositories}`);
        logger.info(`  Successful: ${report.successCount}`);
        logger.info(`  Failed: ${report.failureCount}`);
        logger.info(`  Total files analyzed: ${report.totalFiles}`);
        logger.info(`  Total nodes created: ${report.totalNodes}`);
        logger.info(`  Total relationships: ${report.totalRelationships}`);
        logger.info(
          `  Duration: ${(report.totalDurationMs / 1000).toFixed(2)}s`,
        );

        if (report.results.length > 0) {
          logger.info(`\nPer-repository results:`);
          report.results.forEach((result) => {
            const status = result.success ? "✓" : "✗";
            logger.info(`  ${status} ${result.name}`);
            if (result.success) {
              logger.info(
                `    Files: ${result.filesAnalyzed}, Nodes: ${result.nodesCreated}, Rels: ${result.relationshipsCreated}`,
              );
              logger.info(
                `    Duration: ${((result.durationMs || 0) / 1000).toFixed(2)}s`,
              );
            } else {
              logger.error(`    Error: ${result.error}`);
            }
          });
        }

        await neo4jClient.closeDriver("WorkspaceCLI-Sync");
      } catch (error: any) {
        logger.error(`Failed to sync workspace: ${error.message}`);
        process.exit(1);
      }
    });

  workspace
    .command("status")
    .description("Show workspace synchronization status")
    .option(
      "-c, --config <path>",
      "Config file path",
      ".codegraph/workspace.json",
    )
    .action(async (options) => {
      try {
        logger.info(`Checking workspace status...`);

        const configPath = path.resolve(options.config);

        // Load config
        const neo4jClient = new Neo4jClient();
        const manager = new WorkspaceManager(neo4jClient);

        let config: WorkspaceConfig | undefined;
        try {
          config = await manager.loadConfig(configPath);
        } catch (error) {
          logger.warn(
            `Config file not found. Run 'codegraph workspace init' first.`,
          );
        }

        // Get status from database
        const status = await manager.getWorkspaceStatus();

        // Display results
        logger.info(`\n📊 Workspace Status`);
        logger.info(
          `\nRepositories in database: ${status.repositories.length}`,
        );

        if (status.repositories.length > 0) {
          logger.info(`\nPer-repository breakdown:`);
          status.repositories.forEach((repo) => {
            logger.info(`  ${repo.name}`);
            logger.info(`    Files: ${repo.fileCount}`);
            logger.info(`    Nodes: ${repo.nodeCount}`);
            logger.info(`    Relationships: ${repo.relationshipCount}`);
            logger.info(`    Last synced: ${repo.lastSyncedAt || "Unknown"}`);
          });
        }

        logger.info(`\nTotal database statistics:`);
        logger.info(`  Files: ${status.totalFiles}`);
        logger.info(`  Nodes: ${status.totalNodes}`);
        logger.info(`  Relationships: ${status.totalRelationships}`);

        if (status.orphanedNodes > 0) {
          logger.warn(
            `  ⚠️  Orphaned nodes (no repository tag): ${status.orphanedNodes}`,
          );
        }

        // Compare with config if available
        if (config) {
          const configRepos = new Set(config.repositories.map((r) => r.name));
          const dbRepos = new Set(status.repositories.map((r) => r.name));

          const notInDb = [...configRepos].filter((name) => !dbRepos.has(name));
          const notInConfig = [...dbRepos].filter(
            (name) => !configRepos.has(name),
          );

          if (notInDb.length > 0) {
            logger.info(`\nRepositories in config but not synced:`);
            notInDb.forEach((name) => logger.info(`  - ${name}`));
          }

          if (notInConfig.length > 0) {
            logger.warn(`\nRepositories in database but not in config:`);
            notInConfig.forEach((name) => logger.warn(`  - ${name}`));
          }
        }

        await neo4jClient.closeDriver("WorkspaceCLI-Status");
      } catch (error: any) {
        logger.error(`Failed to get workspace status: ${error.message}`);
        process.exit(1);
      }
    });

  workspace
    .command("clean")
    .description("Remove repository data from database")
    .requiredOption("-r, --repo <name>", "Repository name to clean")
    .option("--confirm", "Confirm deletion without prompting", false)
    .action(async (options) => {
      try {
        const repoName = options.repo;

        if (!options.confirm) {
          logger.warn(`This will delete all nodes for repository: ${repoName}`);
          logger.warn(`Use --confirm flag to proceed`);
          process.exit(0);
        }

        logger.info(`Cleaning repository: ${repoName}...`);

        const neo4jClient = new Neo4jClient();
        const manager = new WorkspaceManager(neo4jClient);

        const deletedCount = await manager.cleanRepository(repoName);

        logger.info(
          `✅ Deleted ${deletedCount} nodes for repository: ${repoName}`,
        );

        await neo4jClient.closeDriver("WorkspaceCLI-Clean");
      } catch (error: any) {
        logger.error(`Failed to clean repository: ${error.message}`);
        process.exit(1);
      }
    });

  return workspace;
}
