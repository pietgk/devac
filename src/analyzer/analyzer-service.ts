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
   * @param configOverride - Optional config overrides (ignorePatterns, supportedExtensions)
   */
  async analyze(
    directory: string,
    configOverride?: {
      ignorePatterns?: string[];
      supportedExtensions?: string[];
    },
  ): Promise<void> {
    logger.info(`Starting analysis for directory: ${directory}`);
    const absoluteDirectory = path.resolve(directory);
    let scanner: FileScanner;

    // Use overrides if provided, otherwise use global config
    const ignorePatterns =
      configOverride?.ignorePatterns ?? config.ignorePatterns;
    const supportedExtensions =
      configOverride?.supportedExtensions ?? config.supportedExtensions;

    try {
      // Instantiate FileScanner here with directory and config
      scanner = new FileScanner(
        absoluteDirectory,
        supportedExtensions,
        ignorePatterns,
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

      // 3. Parse Files (Pass 1) with streaming writes
      logger.info("Parsing files (Pass 1) with streaming writes to Neo4j...");

      // Enable streaming writes by setting storage manager
      this.parser.setStorageManager(this.storageManager);

      // Parse files - writes to Neo4j incrementally during batch processing
      await this.parser.parseFiles(files);

      // Collect Pass 1 Results (now returns empty since already written)
      logger.info("Pass 1 complete - all nodes written to Neo4j via streaming");
      const { allNodes: pass1Nodes, allRelationships: pass1Relationships } =
        await this.parser.collectResults();

      // Pass1 nodes/rels are already in Neo4j, but we need them for Pass 2
      // So we keep an empty array - Pass 2 will work with Neo4j data
      logger.info(
        `Pass 1 streaming complete (nodes and relationships already in Neo4j)`,
      );

      // 4. Resolve Relationships (Pass 2)
      logger.info("Resolving relationships (Pass 2)...");

      // Re-add TS files to project if they were removed during batch processing
      const processedTsFiles = this.parser.getProcessedTsFiles();
      if (processedTsFiles.length > 0) {
        logger.info(
          `Repopulating ts-morph project with ${processedTsFiles.length} files for Pass 2...`,
        );
        await this.parser.repopulateProjectForPass2(processedTsFiles);
      }

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

      // Combine Pass 2 relationships with Pass 1 (already in Neo4j)
      const finalRelationships = pass2Relationships;
      const uniqueRelationships = Array.from(
        new Map(finalRelationships.map((r) => [r.entityId, r])).values(),
      );
      logger.info(
        `Pass 2 relationships to write: ${uniqueRelationships.length}`,
      );

      // 4.5. Repository metadata already added during streaming writes
      // Skip node tagging since nodes are already in Neo4j

      // 5. Store Pass 2 Results (Pass 1 already stored via streaming)
      logger.info("Storing Pass 2 relationships...");
      logger.info(`[STORAGE] Pass 1 nodes already in Neo4j via streaming`);

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

      // Skip node writes - all nodes are already in Neo4j from streaming batches (Pass 1)
      logger.info(
        `[STORAGE] Skipping node write - all nodes already in Neo4j from streaming`,
      );

      // Group relationships by type before saving
      const relationshipsByType: { [type: string]: RelationshipInfo[] } = {};
      for (const rel of uniqueRelationships) {
        if (!relationshipsByType[rel.type]) {
          relationshipsByType[rel.type] = [];
        }
        // Push directly, using non-null assertion to satisfy compiler
        relationshipsByType[rel.type]!.push(rel);
      }

      // Save Pass 2 relationships batch by type (Pass 1 relationships already in Neo4j from streaming)
      logger.info(
        `[STORAGE] Starting to save ${Object.keys(relationshipsByType).length} Pass 2 relationship types...`,
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
