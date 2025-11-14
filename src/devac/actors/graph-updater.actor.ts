/**
 * GraphUpdaterActor
 *
 * XState v5 actor for updating the Neo4j graph with structural data from file parsing.
 * Handles atomic delete-and-recreate operations for file nodes.
 *
 * States:
 * - idle: Waiting for update request
 * - updating: Processing file update
 * - success: Update completed successfully
 * - failed: Update failed, will retry
 * - stopped: Actor stopped
 *
 * @module devac/actors/graph-updater
 */

import { setup, assign, fromPromise, type AnyActorRef } from "xstate";
import type { ManagedTransaction } from "neo4j-driver";
import type { Neo4jClient } from "../../database/neo4j-client.js";
import { toNumber } from "../../database/neo4j-utils.js";
import { createContextLogger } from "../../utils/logger.js";

const logger = createContextLogger("GraphUpdaterActor");

// ============================================================================
// Types
// ============================================================================

/**
 * Structural parse result from file analysis
 */
export type StructuralParseResult = {
  nodes: Array<{
    entityId: string;
    kind: string;
    name: string;
    filePath: string;
    line: number;
    column: number;
  }>;
  relationships: Array<{
    source: string; // entityId
    target: string; // entityId
    type: string; // CONTAINS, etc.
  }>;
  importStrings: string[];
  exportedSymbols: Array<{
    name: string;
    kind: string;
  }>;
};

/**
 * Input for GraphUpdaterActor
 */
export type GraphUpdaterInput = {
  neo4jClient: Neo4jClient;
  filePath: string;
  parseResult: StructuralParseResult;
  parent?: AnyActorRef; // Optional parent for progress events
};

/**
 * Context for GraphUpdaterActor state machine
 */
export type GraphUpdaterContext = {
  input: GraphUpdaterInput;
  nodesUpdated: number;
  error: Error | null;
  retryCount: number;
};

/**
 * Events for GraphUpdaterActor
 */
export type GraphUpdaterEvent =
  | { type: "UPDATE"; filePath: string; parseResult: StructuralParseResult }
  | { type: "RETRY" }
  | { type: "STOP" };

/**
 * Update result
 */
export type UpdateResult = {
  nodesUpdated: number;
  filePath: string;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safe delete file data (transaction-accepting version)
 * Deletes all nodes owned by a file in a transaction-safe way.
 */
async function safeDeleteFileTx(
  tx: ManagedTransaction,
  filePath: string,
): Promise<{ nodesDeleted: number }> {
  try {
    // Delete all nodes owned by the file
    const result = await tx.run(
      `MATCH (f:File {filePath: $filePath})-[:OWNS]->(n:Node)
       DETACH DELETE n
       WITH count(n) as deleted, f
       OPTIONAL MATCH (f)-[r]-()
       DELETE r, f
       RETURN deleted`,
      { filePath },
    );

    const nodesDeleted =
      result.records.length > 0
        ? toNumber(result.records[0]?.get("deleted"))
        : 0;

    logger.info(`Safe delete completed: ${filePath}`, { nodesDeleted });
    return { nodesDeleted };
  } catch (error) {
    logger.error(`Safe delete failed: ${filePath}`, { error });
    throw error;
  }
}

/**
 * Safe delete file (standalone version)
 * Wrapper for standalone use outside of a transaction.
 */
export async function safeDeleteFile(
  neo4jClient: Neo4jClient,
  filePath: string,
): Promise<{ nodesDeleted: number }> {
  return await neo4jClient.runTransactionWork(
    async (tx) => {
      return await safeDeleteFileTx(tx, filePath);
    },
    "WRITE",
    "GraphUpdater-SafeDelete",
  );
}

/**
 * Update file data in Neo4j (atomic delete + create)
 */
async function updateFileData(
  neo4jClient: Neo4jClient,
  filePath: string,
  parseResult: StructuralParseResult,
): Promise<{ nodesUpdated: number }> {
  // Use single transaction for entire operation (atomic)
  const result = await neo4jClient.runTransactionWork(
    async (tx) => {
      // First, safe delete old data (same transaction)
      await safeDeleteFileTx(tx, filePath);

      // Then, create new data (same transaction)
      // 1. Create File node
      await tx.run(
        `MERGE (f:File {filePath: $filePath})
       SET f.structuralComplete = true,
           f.semanticQueued = true,
           f.lastModified = datetime()`,
        { filePath },
      );

      let nodesCreated = 0;

      // 2. Create nodes
      if (parseResult.nodes.length > 0) {
        const nodesResult = await tx.run(
          `UNWIND $nodes AS nodeData
         CREATE (n:Node)
         SET n = nodeData.properties,
             n.entityId = nodeData.entityId
         WITH n, nodeData
         CALL apoc.create.addLabels(n, [nodeData.kind]) YIELD node
         RETURN count(node) as created`,
          {
            nodes: parseResult.nodes.map((n) => ({
              entityId: n.entityId,
              kind: n.kind,
              properties: {
                name: n.name,
                filePath: n.filePath,
                line: n.line,
                column: n.column,
              },
            })),
          },
        );

        nodesCreated = toNumber(nodesResult.records[0]?.get("created"));

        // 3. Create OWNS relationships
        await tx.run(
          `MATCH (f:File {filePath: $filePath})
         UNWIND $nodeIds as nodeId
         MATCH (n:Node {entityId: nodeId})
         MERGE (f)-[:OWNS]->(n)`,
          {
            filePath,
            nodeIds: parseResult.nodes.map((n) => n.entityId),
          },
        );

        // 4. Create structural relationships (CONTAINS, etc.)
        if (parseResult.relationships.length > 0) {
          for (const rel of parseResult.relationships) {
            await tx.run(
              `MATCH (source:Node {entityId: $source})
             MATCH (target:Node {entityId: $target})
             MERGE (source)-[r:${rel.type}]->(target)
             SET r.phase = "structural"`,
              {
                source: rel.source,
                target: rel.target,
              },
            );
          }
        }

        // 5. Store import strings for semantic resolution
        if (parseResult.importStrings.length > 0) {
          await tx.run(
            `MATCH (f:File {filePath: $filePath})
           SET f.pendingImports = $imports`,
            {
              filePath,
              imports: parseResult.importStrings,
            },
          );
        }

        // 6. Store export symbols
        if (parseResult.exportedSymbols.length > 0) {
          await tx.run(
            `MATCH (f:File {filePath: $filePath})
           SET f.exportedSymbols = $exports`,
            {
              filePath,
              exports: parseResult.exportedSymbols.map((e) => ({
                name: e.name,
                kind: e.kind,
              })),
            },
          );
        }
      }

      return { nodesCreated };
    },
    "WRITE",
    "GraphUpdater-Update",
  );

  return {
    nodesUpdated: result.nodesCreated,
  };
}

// ============================================================================
// XState v5 Actor
// ============================================================================

/**
 * GraphUpdaterActor - Manages Neo4j graph updates for file changes
 */
export const graphUpdaterActor = setup({
  types: {
    input: {} as GraphUpdaterInput,
    context: {} as GraphUpdaterContext,
    events: {} as GraphUpdaterEvent,
  },

  actors: {
    performUpdate: fromPromise(
      async ({
        input,
      }: {
        input: {
          neo4jClient: Neo4jClient;
          filePath: string;
          parseResult: StructuralParseResult;
          parent?: AnyActorRef;
        };
      }) => {
        try {
          // Notify parent of start
          if (input.parent) {
            input.parent.send({
              type: "GRAPH_UPDATE_PROGRESS",
              phase: "deleting",
              filePath: input.filePath,
            });
          }

          // Perform atomic update
          const result = await updateFileData(
            input.neo4jClient,
            input.filePath,
            input.parseResult,
          );

          // Notify parent of completion
          if (input.parent) {
            input.parent.send({
              type: "GRAPH_UPDATE_COMPLETE",
              filePath: input.filePath,
              nodesCount: result.nodesUpdated,
            });
          }

          return result;
        } catch (error) {
          logger.error("Graph update failed", {
            filePath: input.filePath,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    ),
  },

  actions: {
    setResult: assign({
      nodesUpdated: ({ event }) => {
        if (event.type === "xstate.done.actor.performUpdate") {
          const output = event.output as { nodesUpdated: number };
          return output.nodesUpdated;
        }
        return 0;
      },
    }),

    setError: assign({
      error: ({ event }) => {
        if (event.type === "xstate.error.actor.performUpdate") {
          return event.error as Error;
        }
        return null;
      },
    }),

    incrementRetry: assign({
      retryCount: ({ context }) => context.retryCount + 1,
    }),

    resetRetry: assign({
      retryCount: () => 0,
    }),

    clearError: assign({
      error: () => null,
    }),

    logSuccess: ({ context }) => {
      logger.info("Graph update successful", {
        filePath: context.input.filePath,
        nodesUpdated: context.nodesUpdated,
      });
    },

    logError: ({ context }) => {
      logger.error("Graph update error", {
        filePath: context.input.filePath,
        error: context.error,
        retryCount: context.retryCount,
      });
    },
  },

  guards: {
    canRetry: ({ context }) => context.retryCount < 3,
  },
}).createMachine({
  id: "graphUpdater",

  initial: "idle",

  context: ({ input }) => ({
    input,
    nodesUpdated: 0,
    error: null,
    retryCount: 0,
  }),

  states: {
    idle: {
      on: {
        UPDATE: {
          target: "updating",
          actions: assign({
            input: ({ context, event }) => ({
              ...context.input,
              filePath: event.filePath,
              parseResult: event.parseResult,
            }),
          }),
        },
        STOP: "stopped",
      },
    },

    updating: {
      invoke: {
        src: "performUpdate",
        input: ({ context }) => ({
          neo4jClient: context.input.neo4jClient,
          filePath: context.input.filePath,
          parseResult: context.input.parseResult,
          parent: context.input.parent,
        }),
        onDone: {
          target: "success",
          actions: ["setResult", "logSuccess"],
        },
        onError: {
          target: "failed",
          actions: ["setError", "logError"],
        },
      },
    },

    success: {
      after: {
        100: "idle", // Return to idle after brief pause
      },
    },

    failed: {
      entry: "incrementRetry",
      always: [
        {
          guard: "canRetry",
          target: "updating",
          actions: "clearError",
        },
        {
          // Max retries exceeded, stay in failed state
          actions: () => {
            logger.error("Max retries exceeded for graph update");
          },
        },
      ],
      on: {
        RETRY: {
          target: "updating",
          actions: ["clearError", "resetRetry"],
        },
        STOP: "stopped",
      },
    },

    stopped: {
      type: "final",
    },
  },
});

/**
 * Actor type exports for type safety
 */
export type GraphUpdaterActor = typeof graphUpdaterActor;
