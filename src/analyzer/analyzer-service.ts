// src/analyzer/analyzer-service.ts
import path from "path";
import { FileScanner, FileInfo } from "../scanner/file-scanner.js";
import { Parser } from "./parser.js";
import { RelationshipResolver } from "./relationship-resolver.js";
import { StorageManager } from "./storage-manager.js";
import { AstNode, RelationshipInfo } from "./types.js";
import { createContextLogger } from "../utils/logger.js";
import config from "../config/index.js";
import { Project } from "ts-morph";
import { Neo4jClient } from "../database/neo4j-client.js";
import { Neo4jError } from "../utils/errors.js";
// Removed setTimeout import

const logger = createContextLogger("AnalyzerService");

/**
 * Orchestrates the code analysis process: scanning, parsing, resolving, and storing.
 */
export class AnalyzerService {
  private parser: Parser;
  private storageManager: StorageManager;
  private neo4jClient: Neo4jClient;
  private repositoryMetadata?: {
    repository: string;
    repositoryPath: string;
    syncedAt: string;
  };

  constructor(
    neo4jConfigOverride?: {
      uri?: string;
      username?: string;
      password?: string;
      database?: string;
    },
    workspaceRoot?: string,
    repositoryMetadata?: {
      repository: string;
      repositoryPath: string;
      syncedAt: string;
    },
  ) {
    this.parser = new Parser(workspaceRoot);
    // Instantiate Neo4jClient with optional overrides
    this.neo4jClient = new Neo4jClient(neo4jConfigOverride);
    // Pass the client instance to StorageManager
    this.storageManager = new StorageManager(this.neo4jClient);
    this.repositoryMetadata = repositoryMetadata;
    logger.info(
      `AnalyzerService initialized${repositoryMetadata ? ` for repository: ${repositoryMetadata.repository}` : ""}.`,
    );
  }

  /**
   * Runs the full analysis pipeline for a given directory.
   * Assumes database is cleared externally (e.g., via test setup).
   * @param directory - The root directory to analyze.
   */
  async analyze(directory: string): Promise<void> {
    logger.info(`Starting analysis for directory: ${directory}`);
    const absoluteDirectory = path.resolve(directory);
    let scanner: FileScanner;

    try {
      // Instantiate FileScanner here with directory and config
      // Use config.supportedExtensions and config.ignorePatterns directly
      scanner = new FileScanner(
        absoluteDirectory,
        config.supportedExtensions,
        config.ignorePatterns,
      );

      // 1. Initialize packages
      logger.info("Initializing package detection...");
      await this.parser.initializePackages();

      // 2. Scan Files
      logger.info("Scanning files...");
      const files: FileInfo[] = await scanner.scan(); // No argument needed
      if (files.length === 0) {
        logger.warn("No files found to analyze.");
        return;
      }
      logger.info(`Found ${files.length} files.`);

      // 3. Parse Files (Pass 1)
      logger.info("Parsing files (Pass 1)...");
      await this.parser.parseFiles(files);

      // 3. Collect Pass 1 Results
      logger.info("Collecting Pass 1 results...");
      const { allNodes: pass1Nodes, allRelationships: pass1Relationships } =
        await this.parser.collectResults();
      logger.info(
        `Collected ${pass1Nodes.length} nodes and ${pass1Relationships.length} relationships from Pass 1.`,
      );

      if (pass1Nodes.length === 0) {
        logger.warn(
          "No nodes were generated during Pass 1. Aborting further analysis.",
        );
        return;
      }

      // 4. Resolve Relationships (Pass 2)
      logger.info("Resolving relationships (Pass 2)...");
      const tsProject: Project = this.parser.getTsProject();
      const resolver = new RelationshipResolver(pass1Nodes, pass1Relationships);
      const pass2Relationships = await resolver.resolveRelationships(
        tsProject,
        this.parser.getImportResolver(),
        this.parser.getPackages(),
      );
      logger.info(
        `Resolved ${pass2Relationships.length} relationships in Pass 2.`,
      );

      const finalNodes = pass1Nodes;
      const finalRelationships = [...pass1Relationships, ...pass2Relationships];
      const uniqueRelationships = Array.from(
        new Map(finalRelationships.map((r) => [r.entityId, r])).values(),
      );
      logger.info(
        `Total unique relationships after combining passes: ${uniqueRelationships.length}`,
      );

      // 4.5. Add repository metadata to all nodes
      if (this.repositoryMetadata) {
        logger.info(
          `Tagging ${finalNodes.length} nodes with repository metadata: ${this.repositoryMetadata.repository}`,
        );
        finalNodes.forEach((node) => {
          node.properties = {
            ...node.properties,
            repository: this.repositoryMetadata!.repository,
            repositoryPath: this.repositoryMetadata!.repositoryPath,
            syncedAt: this.repositoryMetadata!.syncedAt,
          };
        });
      }

      // 5. Store Results
      logger.info("Storing analysis results...");
      logger.info(`[STORAGE] About to save ${finalNodes.length} nodes`);

      // Ensure driver is initialized before storing
      try {
        await this.neo4jClient.initializeDriver("AnalyzerService-Store");
        logger.info("[STORAGE] Neo4j driver initialized successfully");
      } catch (error: any) {
        logger.error("[STORAGE] Failed to initialize Neo4j driver", {
          error: error.message,
          stack: error.stack,
        });
        throw error;
      }

      // --- Database clearing is now handled by beforeEach in tests ---

      try {
        logger.info(
          `[STORAGE] Starting saveNodesBatch for ${finalNodes.length} nodes...`,
        );
        await this.storageManager.saveNodesBatch(finalNodes);
        logger.info(
          `[STORAGE] ✅ Successfully saved ${finalNodes.length} nodes`,
        );
      } catch (error: any) {
        logger.error(`[STORAGE] ❌ Failed to save nodes batch`, {
          error: error.message,
          code: error.code,
          stack: error.stack,
          nodeCount: finalNodes.length,
        });
        throw error;
      }

      // Group relationships by type before saving
      const relationshipsByType: { [type: string]: RelationshipInfo[] } = {};
      for (const rel of uniqueRelationships) {
        if (!relationshipsByType[rel.type]) {
          relationshipsByType[rel.type] = [];
        }
        // Push directly, using non-null assertion to satisfy compiler
        relationshipsByType[rel.type]!.push(rel);
      }

      // Save relationships batch by type
      logger.info(
        `[STORAGE] Starting to save ${Object.keys(relationshipsByType).length} relationship types...`,
      );
      let totalRelsSaved = 0;

      for (const type in relationshipsByType) {
        const batch = relationshipsByType[type];
        if (batch) {
          try {
            logger.info(
              `[STORAGE] Saving ${batch.length} relationships of type: ${type}`,
            );
            await this.storageManager.saveRelationshipsBatch(type, batch);
            totalRelsSaved += batch.length;
            logger.info(
              `[STORAGE] ✅ Saved ${batch.length} ${type} relationships`,
            );
          } catch (error: any) {
            logger.error(`[STORAGE] ❌ Failed to save ${type} relationships`, {
              error: error.message,
              code: error.code,
              batchSize: batch.length,
              stack: error.stack,
            });
            throw error;
          }
        }
      }

      logger.info(
        `[STORAGE] ✅ Successfully saved ${totalRelsSaved} total relationships`,
      );
      logger.info("Analysis results stored successfully.");
    } catch (error: any) {
      logger.error(`Analysis failed: ${error.message}`, { stack: error.stack });
      throw error; // Re-throw the error for higher-level handling
    } finally {
      // 6. Cleanup & Disconnect
      logger.info("Closing Neo4j driver...");
      await this.neo4jClient.closeDriver("AnalyzerService-Cleanup");
      logger.info("Analysis complete.");
    }
  }
}
