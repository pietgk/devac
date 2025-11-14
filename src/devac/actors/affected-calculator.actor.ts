/**
 * AffectedCalculatorActor
 *
 * XState v5 actor for calculating which files/packages are affected by a file change.
 * Queries Neo4j dependency graph to find all dependents.
 *
 * States:
 * - calculating: Running dependency query
 * - success: Calculation completed successfully (final)
 * - failed: Calculation failed (final)
 *
 * @module devac/actors/affected-calculator
 */

import { setup, assign, fromPromise, type AnyActorRef } from "xstate";
import type { Neo4jClient } from "../../database/neo4j-client.js";
import { createContextLogger } from "../../utils/logger.js";
import { LRUCache } from "../utils/lru-cache.js";

const logger = createContextLogger("AffectedCalculatorActor");

// Global cache for affected results (shared across actor instances)
const affectedCache = new LRUCache<AffectedResult>({
  maxSize: 100,
  ttlMs: 60000, // 60 seconds TTL
});

// ============================================================================
// Types
// ============================================================================

/**
 * Package information
 */
export type PackageInfo = {
  name: string;
  path: string;
};

/**
 * Input for AffectedCalculatorActor
 */
export type AffectedCalculatorInput = {
  changedFilePath: string;
  neo4jClient: Neo4jClient;
  packages: PackageInfo[];
  parent?: AnyActorRef; // Optional parent for progress events
};

/**
 * Result of affected calculation
 */
export type AffectedResult = {
  scope: "file" | "package" | "repository";
  files: string[];
  packages: string[];
  dependentCount: number;
};

/**
 * Context for AffectedCalculatorActor state machine
 */
export type AffectedCalculatorContext = {
  input: AffectedCalculatorInput;
  result: AffectedResult | null;
  error: Error | null;
};

/**
 * Events for AffectedCalculatorActor (none - runs to completion)
 */
export type AffectedCalculatorEvent = never;

// ============================================================================
// XState v5 Actor
// ============================================================================

/**
 * AffectedCalculatorActor - Calculates affected files/packages for a change
 */
export const affectedCalculatorActor = setup({
  types: {
    input: {} as AffectedCalculatorInput,
    context: {} as AffectedCalculatorContext,
    events: {} as AffectedCalculatorEvent,
    output: {} as AffectedResult,
  },

  actors: {
    calculate: fromPromise(
      async ({ input }: { input: AffectedCalculatorInput }) => {
        const { changedFilePath, neo4jClient, packages, parent } = input;

        // Check cache first
        const cached = affectedCache.get(changedFilePath);
        if (cached) {
          logger.info(`Affected calculation: cache hit for ${changedFilePath}`);

          if (parent) {
            parent.send({
              type: "AFFECTED_CALCULATION_COMPLETE",
              result: cached,
            });
          }

          return cached;
        }

        if (parent) {
          parent.send({
            type: "AFFECTED_CALCULATION_STARTED",
            filePath: changedFilePath,
          });
        }

        // Query for dependent files
        const result = await neo4jClient.runTransaction(
          `MATCH (changed:File {filePath: $filePath})
           USING INDEX changed:File(filePath)
           WITH changed

           MATCH (changed)-[:OWNS]->(target:Node)
           MATCH (dependent:Node)-[r:IMPORTS|CALLS|EXTENDS|IMPLEMENTS]->(target)
           USING INDEX dependent:Node(entityId)
           WHERE dependent.entityId IS NOT NULL

           MATCH (dependentFile:File)-[:OWNS]->(dependent)
           OPTIONAL MATCH (dependentFile)-[:BELONGS_TO]->(pkg:Package)

           RETURN DISTINCT
             dependentFile.filePath as filePath,
             pkg.name as packageName
           LIMIT 500`,
          { filePath: changedFilePath },
          "READ",
          "AffectedCalculator-Query",
        );

        const affectedFiles = new Set<string>();
        const affectedPackages = new Set<string>();

        for (const record of result.records) {
          const filePath = record.get("filePath") as string | null;
          const packageName = record.get("packageName") as string | null;

          if (filePath) {
            affectedFiles.add(filePath);
          }
          if (packageName) {
            affectedPackages.add(packageName);
          }
        }

        // Determine scope
        let scope: "file" | "package" | "repository";

        if (affectedFiles.size === 0) {
          scope = "file"; // Only affects itself
        } else if (affectedPackages.size === 1) {
          scope = "package"; // Affects one package
        } else {
          scope = "repository"; // Affects multiple packages
        }

        const affectedResult: AffectedResult = {
          scope,
          files: Array.from(affectedFiles),
          packages: Array.from(affectedPackages),
          dependentCount: affectedFiles.size,
        };

        // Cache the result
        affectedCache.set(changedFilePath, affectedResult);

        if (parent) {
          parent.send({
            type: "AFFECTED_CALCULATION_COMPLETE",
            result: affectedResult,
          });
        }

        logger.info(
          `Affected calculation: ${scope} scope, ${affectedFiles.size} files, ${affectedPackages.size} packages (cached)`,
        );

        return affectedResult;
      },
    ),
  },

  actions: {
    setResult: assign({
      result: ({ event }) => {
        // XState v5 uses a different event type format
        if (event.type.startsWith("xstate.done.actor")) {
          return event.output as AffectedResult;
        }
        return null;
      },
    }),

    setError: assign({
      error: ({ event }) => {
        // XState v5 uses a different event type format
        if (event.type.startsWith("xstate.error.actor")) {
          return event.error as Error;
        }
        return null;
      },
    }),
  },
}).createMachine({
  id: "affectedCalculator",
  initial: "calculating",

  context: ({ input }) => ({
    input,
    result: null,
    error: null,
  }),

  states: {
    calculating: {
      invoke: {
        src: "calculate",
        input: ({ context }) => context.input,
        onDone: {
          target: "success",
          actions: "setResult",
        },
        onError: {
          target: "failed",
          actions: "setError",
        },
      },
    },

    success: {
      type: "final",
      output: ({ context }) => context.result!,
    },

    failed: {
      entry: ({ context }) => {
        logger.error(
          `Affected calculation failed: ${context.input.changedFilePath}`,
          {
            error: context.error,
          },
        );
      },
      type: "final",
      output: () => ({
        scope: "file" as const,
        files: [],
        packages: [],
        dependentCount: 0,
      }),
    },
  },
});

/**
 * Actor type exports for type safety
 */
export type AffectedCalculatorActor = typeof affectedCalculatorActor;

/**
 * Utility functions for cache management
 */
export const AffectedCalculatorCache = {
  /**
   * Get cache statistics
   */
  getStats: () => affectedCache.stats(),

  /**
   * Clear the cache
   */
  clear: () => affectedCache.clear(),

  /**
   * Prune expired entries
   */
  prune: () => affectedCache.prune(),

  /**
   * Check if a file path is cached
   */
  has: (filePath: string) => affectedCache.has(filePath),

  /**
   * Invalidate a specific file path
   */
  invalidate: (filePath: string) => affectedCache.delete(filePath),
};
