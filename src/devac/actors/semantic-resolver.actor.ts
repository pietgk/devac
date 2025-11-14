/**
 * SemanticResolverActor
 *
 * XState v5 actor for deferred semantic relationship resolution.
 * Processes queued files in batches using ts-morph.
 *
 * States:
 * - idle: No files queued
 * - queueing: Files being added to queue
 * - debouncing: Waiting for more files before processing
 * - processing: Actively resolving a batch
 * - batchComplete: Batch finished, checking for more work
 * - error: Batch failed, will retry
 * - stopped: Actor stopped
 *
 * @module devac/actors/semantic-resolver
 */

import { setup, assign, fromPromise, type AnyActorRef } from "xstate";
import { Project } from "ts-morph";
import { performance } from "perf_hooks";
import { RelationshipResolver } from "../../analyzer/relationship-resolver.js";
import type { ImportResolver } from "../../analyzer/parsers/import-resolver.js";
import type { PackageInfo } from "../../analyzer/parsers/package-extractor.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";
import type { RelationshipInfo } from "../../analyzer/types.js";
import { createContextLogger } from "../../utils/logger.js";
import { findNearestTsConfig } from "../../analyzer/utils/tsconfig-finder.js";

const logger = createContextLogger("SemanticResolverActor");

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for SemanticResolverActor
 */
export type SemanticResolverConfig = {
  batchSize: number; // Files per batch (default: 10)
  maxQueueSize: number; // Max queued files (default: 100)
  processingDelay: number; // Debounce delay in ms (default: 100)
};

/**
 * Queue item with priority
 */
export type QueueItem = {
  filePath: string;
  priority: number; // 100=high, 50=normal
  queuedAt: Date;
};

/**
 * Input for SemanticResolverActor
 */
export type SemanticResolverInput = {
  neo4jClient: Neo4jClient;
  importResolver: ImportResolver;
  packages: PackageInfo[];
  config: SemanticResolverConfig;
  parent?: AnyActorRef; // Optional parent for progress events
};

/**
 * Context for SemanticResolverActor state machine
 */
export type SemanticResolverContext = {
  input: SemanticResolverInput;
  queue: QueueItem[];
  processing: boolean;
  currentBatch: string[] | null;
  error: Error | null;
};

/**
 * Events for SemanticResolverActor
 */
export type SemanticResolverEvent =
  | { type: "ENQUEUE"; filePath: string; priority: "high" | "normal" }
  | { type: "PROCESS_BATCH" }
  | { type: "BATCH_COMPLETE"; filesProcessed: number; filePaths: string[] }
  | { type: "STOP" };

/**
 * Batch processing result
 */
export type BatchResult = {
  filesProcessed: number;
  filePaths: string[];
  relationshipsCreated: number;
  duration: number;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find all dependencies needed for a batch
 */
async function findBatchDependencies(
  batch: string[],
  neo4jClient: Neo4jClient,
): Promise<string[]> {
  try {
    const result = await neo4jClient.runTransaction(
      `UNWIND $filePaths as filePath
       MATCH path = (target:File {filePath: filePath})-[:IMPORTS*0..5]->(dep:File)
       RETURN DISTINCT dep.filePath as depPath
       LIMIT 100`,
      { filePaths: batch },
      "READ",
      "FindBatchDependencies",
    );

    return result.records.map((record) => record.get("depPath") as string);
  } catch (error) {
    logger.error("Failed to find batch dependencies", { error, batch });
    // Fallback: just return the batch files themselves
    return batch;
  }
}

/**
 * Create mini ts-morph Project for batch
 */
async function createMiniProject(files: string[]): Promise<Project> {
  // Find appropriate tsconfig
  const tsConfigPath =
    files.length > 0 ? await findNearestTsConfig(files[0]) : undefined;

  const project = new Project({
    tsConfigFilePath: tsConfigPath,
    skipAddingFilesFromTsConfig: true,
  });

  // Only add files needed for this batch
  for (const filePath of files) {
    try {
      project.addSourceFileAtPath(filePath);
    } catch (error) {
      logger.warn(`Could not add file to project: ${filePath}`, { error });
    }
  }

  return project;
}

/**
 * Write semantic data to Neo4j
 */
async function writeSemanticData(
  neo4jClient: Neo4jClient,
  batch: string[],
  relationships: RelationshipInfo[],
): Promise<number> {
  let relationshipsCreated = 0;

  await neo4jClient.runTransactionWork(
    async (tx) => {
      // Create semantic relationships
      if (relationships.length > 0) {
        // Group by relationship type for efficiency
        const byType = new Map<string, RelationshipInfo[]>();
        for (const rel of relationships) {
          const existing = byType.get(rel.type) || [];
          existing.push(rel);
          byType.set(rel.type, existing);
        }

        // Create relationships by type
        for (const [type, rels] of byType) {
          await tx.run(
            `UNWIND $rels AS relData
           MATCH (source:Node {entityId: relData.source})
           MATCH (target:Node {entityId: relData.target})
           MERGE (source)-[r:${type}]->(target)
           SET r.phase = "semantic"`,
            { rels },
          );
          relationshipsCreated += rels.length;
        }
      }

      // Mark files as semantically complete
      await tx.run(
        `UNWIND $filePaths AS filePath
       MATCH (f:File {filePath: filePath})
       SET f.semanticComplete = true,
           f.semanticQueued = false,
           f.lastSemanticUpdate = datetime()`,
        { filePaths: batch },
      );
    },
    "WRITE",
    "SemanticResolver-WriteData",
  );

  return relationshipsCreated;
}

// ============================================================================
// XState v5 Actor
// ============================================================================

/**
 * SemanticResolverActor
 *
 * Processes files in batches with queuing, debouncing, and error recovery.
 */
export const semanticResolverActor = setup({
  types: {
    input: {} as SemanticResolverInput,
    context: {} as SemanticResolverContext,
    events: {} as SemanticResolverEvent,
  },

  actors: {
    processBatch: fromPromise(
      async ({
        input,
      }: {
        input: {
          batch: string[];
          neo4jClient: Neo4jClient;
          importResolver: ImportResolver;
          packages: PackageInfo[];
          parent?: AnyActorRef;
        };
      }) => {
        const startTime = performance.now();

        try {
          // Notify parent of batch start
          if (input.parent) {
            input.parent.send({
              type: "SEMANTIC_BATCH_STARTED",
              filesCount: input.batch.length,
            });
          }

          // Find transitive dependencies
          const allNeededFiles = await findBatchDependencies(
            input.batch,
            input.neo4jClient,
          );

          if (input.parent) {
            input.parent.send({
              type: "SEMANTIC_DEPENDENCIES_FOUND",
              dependenciesCount: allNeededFiles.length,
            });
          }

          // Create mini ts-morph Project
          const miniProject = await createMiniProject(allNeededFiles);

          // Resolve relationships
          const resolver = new RelationshipResolver(
            miniProject,
            input.importResolver,
            input.packages,
          );

          const relationships = resolver.resolveRelationships();

          // Write to Neo4j
          const relationshipsCreated = await writeSemanticData(
            input.neo4jClient,
            input.batch,
            relationships,
          );

          const duration = performance.now() - startTime;

          // Notify parent of completion
          if (input.parent) {
            input.parent.send({
              type: "SEMANTIC_BATCH_COMPLETE",
              filesProcessed: input.batch.length,
              duration,
            });
          }

          logger.info(
            `✅ Batch complete: ${relationshipsCreated} relationships in ${duration.toFixed(0)}ms`,
          );

          return {
            filesProcessed: input.batch.length,
            filePaths: input.batch,
            relationshipsCreated,
            duration,
          };
        } catch (error) {
          logger.error("Semantic batch processing failed", {
            batch: input.batch,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error; // Re-throw to trigger actor error handling
        }
      },
    ),
  },

  actions: {
    addToQueue: assign({
      queue: ({ context, event }) => {
        if (event.type !== "ENQUEUE") return context.queue;

        const priority = event.priority === "high" ? 100 : 50;
        const queueItem: QueueItem = {
          filePath: event.filePath,
          priority,
          queuedAt: new Date(),
        };

        // Remove duplicates (same file)
        const filtered = context.queue.filter(
          (item) => item.filePath !== event.filePath,
        );

        // Check max queue size
        if (filtered.length >= context.input.config.maxQueueSize) {
          logger.warn(
            `Queue full (${filtered.length}), dropping: ${event.filePath}`,
          );
          return filtered;
        }

        // Insert sorted by priority (high to low)
        const insertIndex = filtered.findIndex(
          (item) => item.priority < priority,
        );

        if (insertIndex === -1) {
          return [...filtered, queueItem];
        } else {
          return [
            ...filtered.slice(0, insertIndex),
            queueItem,
            ...filtered.slice(insertIndex),
          ];
        }
      },
    }),

    markAsQueued: ({ context, event }) => {
      if (event.type !== "ENQUEUE") return;

      // Mark file as queued in Neo4j (fire and forget)
      context.input.neo4jClient
        .runTransaction(
          `MATCH (f:File {filePath: $filePath})
           SET f.semanticQueued = true`,
          { filePath: event.filePath },
          "WRITE",
          "MarkSemanticQueued",
        )
        .catch((error) => {
          logger.error(`Failed to mark as queued: ${event.filePath}`, {
            error,
          });
        });
    },

    prepareBatch: assign({
      currentBatch: ({ context }) => {
        const batchSize = context.input.config.batchSize;
        return context.queue.slice(0, batchSize).map((item) => item.filePath);
      },
      processing: () => true,
    }),

    removeBatch: assign({
      queue: ({ context }) => {
        const batchSize = context.input.config.batchSize;
        return context.queue.slice(batchSize);
      },
      currentBatch: () => null,
      processing: () => false,
    }),

    setError: assign({
      error: ({ event }) => (event as any).error || new Error("Batch failed"),
      processing: () => false,
    }),

    clearError: assign({
      error: () => null,
    }),

    logQueueStatus: ({ context }) => {
      logger.debug(
        `Queue status: ${context.queue.length} files, processing: ${context.processing}`,
      );
    },
  },

  guards: {
    hasQueuedFiles: ({ context }) => context.queue.length > 0,
    notProcessing: ({ context }) => !context.processing,
  },

  delays: {
    PROCESSING_DELAY: ({ context }) => context.input.config.processingDelay,
  },
}).createMachine({
  id: "semanticResolver",

  initial: "idle",

  context: ({ input }) => ({
    input,
    queue: [],
    processing: false,
    currentBatch: null,
    error: null,
  }),

  states: {
    idle: {
      entry: "logQueueStatus",
      on: {
        ENQUEUE: {
          actions: ["addToQueue", "markAsQueued"],
          target: "queueing",
        },
        STOP: "stopped",
      },
    },

    queueing: {
      always: [
        {
          guard: "hasQueuedFiles",
          target: "debouncing",
        },
        {
          target: "idle",
        },
      ],
      on: {
        ENQUEUE: {
          actions: ["addToQueue", "markAsQueued"],
        },
      },
    },

    debouncing: {
      after: {
        PROCESSING_DELAY: {
          target: "processing",
          guard: "hasQueuedFiles",
        },
      },
      on: {
        ENQUEUE: {
          actions: ["addToQueue", "markAsQueued"],
          target: "debouncing",
          reenter: true, // Reset debounce timer
        },
        STOP: "stopped",
      },
    },

    processing: {
      entry: ["prepareBatch", "logQueueStatus"],

      invoke: {
        src: "processBatch",
        input: ({ context }) => ({
          batch: context.currentBatch!,
          neo4jClient: context.input.neo4jClient,
          importResolver: context.input.importResolver,
          packages: context.input.packages,
          parent: context.input.parent,
        }),
        onDone: {
          target: "batchComplete",
          actions: ["removeBatch", "clearError"],
        },
        onError: {
          target: "error",
          actions: "setError",
        },
      },

      on: {
        ENQUEUE: {
          actions: ["addToQueue", "markAsQueued"],
        },
      },
    },

    batchComplete: {
      always: [
        {
          guard: "hasQueuedFiles",
          target: "debouncing",
        },
        {
          target: "idle",
        },
      ],
    },

    error: {
      entry: ({ context }) => {
        logger.error("SemanticResolver error state", { error: context.error });

        // Mark files as needing retry in Neo4j
        if (context.currentBatch) {
          for (const filePath of context.currentBatch) {
            context.input.neo4jClient
              .runTransaction(
                `MATCH (f:File {filePath: $filePath})
                 SET f.semanticQueued = false,
                     f.semanticRetryNeeded = true,
                     f.semanticError = $error,
                     f.semanticRetryAt = datetime() + duration('PT5M')`,
                {
                  filePath,
                  error: context.error?.message || "Unknown error",
                },
                "WRITE",
                "MarkSemanticError",
              )
              .catch((err) => {
                logger.error(`Failed to mark semantic error: ${filePath}`, {
                  error: err,
                });
              });
          }
        }
      },
      after: {
        5000: {
          target: "idle",
          actions: ["clearError", assign({ currentBatch: () => null })],
        },
      },
      on: {
        ENQUEUE: {
          actions: ["addToQueue", "markAsQueued"],
        },
      },
    },

    stopped: {
      type: "final",
    },
  },
});
