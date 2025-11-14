/**
 * Semantic Resolver: Deferred relationship resolution using ts-morph
 *
 * Processes queued files in batches, uses mini ts-morph Projects.
 * Target: 2-5s per batch of 10 files.
 *
 * Part of Lazy Semantic Resolution POC (Experiment 5)
 */

import { Project } from "ts-morph";
import { performance } from "perf_hooks";
import { RelationshipResolver } from "./relationship-resolver.js";
import { ImportResolver } from "./parsers/import-resolver.js";
import type { PackageInfo } from "./parsers/package-extractor.js";
import type { AstNode, RelationshipInfo } from "./types.js";
import type { Neo4jClient } from "../database/neo4j-client.js";
import type { Result } from "neo4j-driver";
import { createContextLogger } from "../utils/logger.js";
import { findNearestTsConfig } from "./utils/tsconfig-finder.js";

const logger = createContextLogger("SemanticResolver");

// ============================================================================
// Types
// ============================================================================

export interface SemanticResolverConfig {
  batchSize: number; // Number of files to process per batch (default: 10)
  maxQueueSize: number; // Maximum queue size before warning (default: 100)
  processingDelay: number; // Delay between batches in ms (default: 100)
}

export interface QueueItem {
  filePath: string;
  priority: "high" | "normal";
  queuedAt: Date;
}

export interface BatchResult {
  filePaths: string[];
  relationshipsCreated: number;
  duration: number;
  success: boolean;
  error?: Error;
}

// ============================================================================
// SemanticResolver Class
// ============================================================================

export class SemanticResolver {
  private queue: QueueItem[] = [];
  private processing: boolean = false;
  private config: SemanticResolverConfig;

  constructor(
    private neo4jClient: Neo4jClient,
    private importResolver: ImportResolver,
    private packages: PackageInfo[],
    config?: Partial<SemanticResolverConfig>
  ) {
    this.config = {
      batchSize: config?.batchSize ?? 10,
      maxQueueSize: config?.maxQueueSize ?? 100,
      processingDelay: config?.processingDelay ?? 100,
    };

    logger.info("SemanticResolver initialized", {
      batchSize: this.config.batchSize,
      maxQueueSize: this.config.maxQueueSize,
    });
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Queue a file for semantic resolution
   *
   * @param filePath - Absolute path to file
   * @param priority - Queue priority (high = front, normal = back)
   */
  enqueue(filePath: string, priority: "high" | "normal" = "normal"): void {
    // Check if already queued
    if (this.queue.some(item => item.filePath === filePath)) {
      logger.debug(`File already queued: ${filePath}`);
      return;
    }

    const queueItem: QueueItem = {
      filePath,
      priority,
      queuedAt: new Date(),
    };

    if (priority === "high") {
      this.queue.unshift(queueItem); // Add to front
    } else {
      this.queue.push(queueItem); // Add to back
    }

    logger.debug(
      `Queued for semantic resolution: ${filePath} ` +
      `(priority: ${priority}, queue size: ${this.queue.length})`
    );

    // Warn if queue is getting large
    if (this.queue.length > this.config.maxQueueSize) {
      logger.warn(
        `Queue size exceeds threshold: ${this.queue.length} > ${this.config.maxQueueSize}`
      );
    }

    // Mark as queued in Neo4j
    this.markAsQueued(filePath).catch(error => {
      logger.error(`Failed to mark as queued: ${filePath}`, error);
    });

    // Start processing if idle
    if (!this.processing) {
      // Use setImmediate to avoid blocking
      setImmediate(() => this.processQueue());
    }
  }

  /**
   * Get current queue status
   */
  getQueueStatus(): {
    queueSize: number;
    processing: boolean;
    highPriority: number;
    normalPriority: number;
  } {
    return {
      queueSize: this.queue.length,
      processing: this.processing,
      highPriority: this.queue.filter(i => i.priority === "high").length,
      normalPriority: this.queue.filter(i => i.priority === "normal").length,
    };
  }

  /**
   * Wait for queue to be empty (useful for testing)
   */
  async waitForIdle(timeout: number = 30000): Promise<boolean> {
    const start = Date.now();

    while (this.queue.length > 0 || this.processing) {
      if (Date.now() - start > timeout) {
        return false; // Timeout
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return true; // Queue is empty
  }

  // ==========================================================================
  // Queue Processing
  // ==========================================================================

  /**
   * Process the queue in batches
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        // Take batch
        const batch = this.queue.splice(0, this.config.batchSize);
        const filePaths = batch.map(item => item.filePath);

        logger.info(
          `Processing semantic batch: ${filePaths.length} files ` +
          `(${this.queue.length} remaining in queue)`
        );

        try {
          const result = await this.resolveBatch(filePaths);

          if (result.success) {
            logger.info(
              `✅ Batch complete: ${result.relationshipsCreated} relationships ` +
              `in ${result.duration.toFixed(0)}ms`
            );
          } else {
            logger.error(`❌ Batch failed:`, result.error);
            // Re-queue failed files at end
            for (const filePath of filePaths) {
              this.queue.push({
                filePath,
                priority: "normal",
                queuedAt: new Date(),
              });
            }
          }
        } catch (error) {
          logger.error(`Batch processing error:`, error);
          // Re-queue at end
          for (const filePath of filePaths) {
            this.queue.push({
              filePath,
              priority: "normal",
              queuedAt: new Date(),
            });
          }
        }

        // Small delay between batches to avoid overwhelming system
        if (this.queue.length > 0) {
          await new Promise(resolve =>
            setTimeout(resolve, this.config.processingDelay)
          );
        }
      }
    } finally {
      this.processing = false;
      logger.debug("Queue processing complete");
    }
  }

  // ==========================================================================
  // Batch Resolution
  // ==========================================================================

  /**
   * Resolve semantic relationships for a batch of files
   *
   * This is the core of semantic resolution:
   * 1. Find dependencies (transitive imports)
   * 2. Create mini ts-morph Project
   * 3. Use RelationshipResolver to resolve cross-file relationships
   * 4. Write to Neo4j with status updates
   */
  private async resolveBatch(filePaths: string[]): Promise<BatchResult> {
    const startTime = performance.now();

    try {
      // 1. Find transitive dependencies
      logger.debug(`Finding dependencies for ${filePaths.length} files...`);
      const allNeeded = await this.findBatchDependencies(filePaths);
      logger.debug(`Batch needs ${allNeeded.length} total files (including deps)`);

      // 2. Create mini ts-morph Project
      logger.debug("Creating mini ts-morph Project...");
      const nearestTsConfig = await findNearestTsConfig(
        filePaths[0],
        process.cwd() // workspaceRoot - should be passed in config
      );

      const miniProject = new Project({
        tsConfigFilePath: nearestTsConfig,
        skipAddingFilesFromTsConfig: true,
      });

      // Add all needed files
      for (const path of allNeeded) {
        try {
          miniProject.addSourceFileAtPath(path);
        } catch (error) {
          logger.warn(`Could not add file to Project: ${path}`, error);
        }
      }

      logger.debug(`Project created with ${miniProject.getSourceFiles().length} files`);

      // 3. Get nodes from Neo4j (RelationshipResolver needs them)
      logger.debug("Fetching nodes from Neo4j...");
      const nodes = await this.getNodesForFiles(filePaths);
      logger.debug(`Retrieved ${nodes.length} nodes`);

      // 4. Resolve relationships using RelationshipResolver
      logger.debug("Resolving semantic relationships...");
      const resolver = new RelationshipResolver(nodes, []); // Empty Pass 1 rels
      const semanticRels = await resolver.resolveRelationships(
        miniProject,
        this.importResolver,
        this.packages
      );

      logger.debug(`Resolved ${semanticRels.length} semantic relationships`);

      // 5. Write to Neo4j
      logger.debug("Writing to Neo4j...");
      await this.writeSemanticResults(filePaths, semanticRels);

      const duration = performance.now() - startTime;

      return {
        filePaths,
        relationshipsCreated: semanticRels.length,
        duration,
        success: true,
      };

    } catch (error) {
      const duration = performance.now() - startTime;
      logger.error(`Batch resolution failed after ${duration.toFixed(0)}ms:`, error);

      return {
        filePaths,
        relationshipsCreated: 0,
        duration,
        success: false,
        error: error as Error,
      };
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Find all dependencies needed for a batch of files
   *
   * Uses Neo4j to efficiently find transitive dependencies
   */
  private async findBatchDependencies(filePaths: string[]): Promise<string[]> {
    const result = await this.neo4jClient.runTransaction<Result>(
      `// Find files that the batch imports (1-2 levels deep)
       MATCH (f:File)
       WHERE f.filePath IN $paths

       // Follow IMPORTS relationships (up to 2 hops)
       OPTIONAL MATCH (f)-[:IMPORTS*1..2]->(dep:File)

       RETURN DISTINCT dep.filePath as filePath`,
      { paths: filePaths },
      "READ",
      "SemanticResolver-FindDeps"
    );

    const dependencies = result.records
      .map(r => r.get("filePath"))
      .filter(p => p != null);

    // Return batch files + their dependencies
    return Array.from(new Set([...filePaths, ...dependencies]));
  }

  /**
   * Get nodes from Neo4j for given files
   *
   * RelationshipResolver needs these to build relationships
   */
  private async getNodesForFiles(filePaths: string[]): Promise<AstNode[]> {
    const result = await this.neo4jClient.runTransaction<Result>(
      `// Get all nodes owned by these files
       MATCH (f:File)
       WHERE f.filePath IN $paths
       MATCH (f)-[:OWNS]->(n:Node)

       RETURN n {
         .entityId,
         .kind,
         .name,
         .filePath,
         .startLine,
         .endLine,
         .startColumn,
         .endColumn,
         .language,
         .parentId,
         .isExported,
         .isAsync,
         .isStatic
       } as node`,
      { paths: filePaths },
      "READ",
      "SemanticResolver-GetNodes"
    );

    return result.records.map(r => r.get("node") as AstNode);
  }

  /**
   * Mark file as queued for semantic resolution
   */
  private async markAsQueued(filePath: string): Promise<void> {
    await this.neo4jClient.runTransaction(
      `MATCH (f:File {filePath: $path})
       SET f.semanticQueued = true`,
      { path: filePath },
      "WRITE",
      "SemanticResolver-MarkQueued"
    );
  }

  /**
   * Write semantic results to Neo4j
   *
   * Creates relationships and marks files as semantically complete
   */
  private async writeSemanticResults(
    filePaths: string[],
    relationships: RelationshipInfo[]
  ): Promise<void> {
    await this.neo4jClient.runTransactionWork(
      async (tx) => {
        const now = new Date().toISOString();

        // Create relationships
        for (const rel of relationships) {
          await tx.run(
            `MATCH (source:Node {entityId: $sourceId})
             MATCH (target:Node {entityId: $targetId})
             MERGE (source)-[r:\`${rel.type}\`]->(target)
             SET r += $props,
                 r.phase = 'semantic',
                 r.confidence = 'verified',
                 r.verifiedAt = $now`,
            {
              sourceId: rel.sourceId,
              targetId: rel.targetId,
              props: rel.properties || {},
              now,
            }
          );
        }

        // Mark files as semantically complete
        for (const path of filePaths) {
          await tx.run(
            `MATCH (f:File {filePath: $path})
             SET f.semanticComplete = true,
                 f.semanticUpdatedAt = $now,
                 f.semanticQueued = false`,
            { path, now }
          );
        }
      },
      "WRITE",
      "SemanticResolver-WriteResults"
    );
  }
}
