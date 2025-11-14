/**
 * ValidationCoordinatorService
 *
 * Single entry point for all file change events in the DevAC validation system.
 * Orchestrates the entire pipeline: structural updates → semantic resolution →
 * affected calculation → validation execution.
 *
 * Architecture: XState v5 actor system with parent-child communication
 *
 * @module devac/services/validation-coordinator
 */

import {
  setup,
  assign,
  sendTo,
  fromPromise,
  createActor,
  type AnyActorRef,
  type ActorRefFrom,
} from "xstate";
import { Neo4jClient } from "../../database/neo4j-client.js";
import { StructuralParser } from "../../analyzer/structural-parser.js";
import { ImportResolver } from "../../analyzer/parsers/import-resolver.js";
import type { PackageInfo } from "../../analyzer/parsers/package-extractor.js";
import type { FileChangeEvent } from "../types/file-watcher.js";
import { graphUpdaterActor } from "../actors/graph-updater.actor.js";
import { semanticResolverActor } from "../actors/semantic-resolver.actor.js";
import { affectedCalculatorActor } from "../actors/affected-calculator.actor.js";
import { createScriptExecutorWithPackages } from "../actors/script-executor.actor.js";

/**
 * Result of affected scope calculation
 */
export type AffectedResult = {
  scope: "file" | "package" | "repository";
  files: string[];
  packages: string[];
  dependentCount: number;
};

/**
 * Validation result for a single package
 */
export type ValidationResult = {
  packageName: string;
  exitCode: number;
  output: string;
  duration: number;
};

/**
 * Context for ValidationCoordinator state machine
 */
export type ValidationCoordinatorContext = {
  fileEvent: FileChangeEvent | null;
  processingQueue: FileChangeEvent[]; // Handle concurrent changes
  affectedResult: AffectedResult | null;
  validationResults: Map<string, ValidationResult>;
  error: Error | null;
};

/**
 * Events handled by ValidationCoordinator
 */
export type ValidationCoordinatorEvent =
  | { type: "START" }
  | { type: "FILE_CHANGED"; event: FileChangeEvent }
  | { type: "SEMANTIC_COMPLETE"; filePath: string }
  | { type: "RECOVER" }
  | {
      type: "GRAPH_UPDATE_PROGRESS";
      phase: string;
      filePath?: string;
      nodesCount?: number;
    }
  | { type: "GRAPH_UPDATE_COMPLETE"; filePath: string; nodesUpdated: number }
  | { type: "SEMANTIC_BATCH_STARTED"; filesCount: number }
  | { type: "SEMANTIC_DEPENDENCIES_FOUND"; dependenciesCount: number }
  | {
      type: "SEMANTIC_BATCH_COMPLETE";
      filesProcessed: number;
      duration: number;
    }
  | { type: "AFFECTED_CALCULATION_STARTED"; filePath: string }
  | { type: "AFFECTED_CALCULATION_COMPLETE"; result: AffectedResult }
  | { type: "VALIDATION_PROGRESS"; packageName: string; phase?: string }
  | { type: "VALIDATION_OUTPUT"; packageName: string; output: string }
  | {
      type: "VALIDATION_COMPLETE";
      packageName: string;
      exitCode: number;
      duration: number;
    };

/**
 * Configuration options for ValidationCoordinator
 */
export type ValidationCoordinatorConfig = {
  neo4jClient: Neo4jClient;
  structuralParser: StructuralParser;
  importResolver: ImportResolver;
  packages: PackageInfo[];
  workspaceRoot: string;
};

/**
 * ValidationCoordinatorService
 *
 * Single entry point for all file changes. Orchestrates the entire validation pipeline.
 *
 * States:
 * - idle: Waiting for START command
 * - initializing: Setting up long-running actors (SemanticResolver)
 * - scanning: Initial repository scan for incomplete files
 * - watching: Listening for file changes
 * - processing: Handling file change (structural → semantic → affected → validate)
 * - degraded: Error recovery mode
 *
 * @example
 * ```typescript
 * const coordinator = new ValidationCoordinatorService({
 *   neo4jClient,
 *   structuralParser,
 *   importResolver,
 *   packages,
 *   workspaceRoot: process.cwd()
 * });
 *
 * coordinator.start();
 *
 * // Send file change events
 * coordinator.send({
 *   type: 'FILE_CHANGED',
 *   event: { path: 'src/index.ts', type: 'change' }
 * });
 * ```
 */
export class ValidationCoordinatorService {
  private machine: ReturnType<typeof this.createMachine>;
  private actor: ActorRefFrom<typeof this.machine> | null = null;
  private config: ValidationCoordinatorConfig;

  constructor(config: ValidationCoordinatorConfig) {
    this.config = config;
    this.machine = this.createMachine();
  }

  /**
   * Create the XState v5 state machine
   */
  private createMachine() {
    return setup({
      types: {
        context: {} as ValidationCoordinatorContext,
        events: {} as ValidationCoordinatorEvent,
      },

      actors: {
        graphUpdater: graphUpdaterActor,
        semanticResolver: semanticResolverActor,
        affectedCalculator: affectedCalculatorActor,
      },

      actions: {
        queueFileChange: assign({
          processingQueue: ({ context, event }) => {
            if (event.type === "FILE_CHANGED") {
              // Remove duplicates (same file)
              const filtered = context.processingQueue.filter(
                (e) => e.path !== event.event.path,
              );
              // Add to end of queue
              return [...filtered, event.event];
            }
            return context.processingQueue;
          },
        }),

        dequeueNextFile: assign({
          fileEvent: ({ context }) => {
            return context.processingQueue[0] || null;
          },
          processingQueue: ({ context }) => {
            return context.processingQueue.slice(1);
          },
        }),

        clearFileEvent: assign({
          fileEvent: () => null,
        }),

        setError: assign({
          error: ({ event }) =>
            (event as any).error || new Error("Unknown error"),
        }),

        logProgress: ({ event }) => {
          console.log(`[ValidationCoordinator] Progress:`, event);
        },
      },

      guards: {
        hasQueuedFiles: ({ context }) => context.processingQueue.length > 0,
        isProcessing: ({ context }) => context.fileEvent !== null,
      },
    }).createMachine({
      id: "validationCoordinator",
      initial: "idle",

      context: {
        fileEvent: null,
        processingQueue: [],
        affectedResult: null,
        validationResults: new Map(),
        error: null,
      },

      states: {
        idle: {
          on: {
            START: "initializing",
          },
        },

        initializing: {
          // TODO: Invoke SemanticResolverActor as long-running service
          after: {
            100: "scanning",
          },
        },

        scanning: {
          // TODO: Scan for files needing semantic resolution
          invoke: {
            src: fromPromise(async () => {
              // Placeholder: In full implementation, this queries Neo4j
              // for files with structuralComplete=true, semanticComplete=false
              console.log("[ValidationCoordinator] Repository scan complete");
              return { filesQueued: 0 };
            }),
            onDone: "watching",
            onError: "degraded",
          },
        },

        watching: {
          on: {
            FILE_CHANGED: [
              {
                // If already processing another file, queue this one
                guard: "isProcessing",
                actions: "queueFileChange",
                description: "Queue concurrent file change",
              },
              {
                // Otherwise, start processing immediately
                target: "processing",
                actions: assign({
                  fileEvent: ({ event }) => event.event,
                }),
                description: "Start processing file change",
              },
            ],

            SEMANTIC_COMPLETE: {
              // Background semantic resolution completed
              // TODO: Trigger affected calculation and validation
              actions: "logProgress",
            },
          },
        },

        processing: {
          initial: "structuralUpdate",

          states: {
            structuralUpdate: {
              // TODO: Invoke GraphUpdaterActor
              after: {
                10: "queueSemantic", // Placeholder delay
              },
              on: {
                GRAPH_UPDATE_PROGRESS: {
                  actions: "logProgress",
                },
              },
            },

            queueSemantic: {
              entry: [
                // TODO: Send ENQUEUE to SemanticResolverService
                ({ context }) => {
                  console.log(
                    `[ValidationCoordinator] Queued for semantic: ${context.fileEvent!.path}`,
                  );
                },
              ],

              always: [
                {
                  guard: "hasQueuedFiles",
                  target: "#validationCoordinator.processing",
                  actions: "dequeueNextFile",
                  description: "Process next queued file",
                },
                {
                  target: "#validationCoordinator.watching",
                  actions: "clearFileEvent",
                  description: "No more files, return to watching",
                },
              ],
            },

            calculatingAffected: {
              // TODO: Invoke AffectedCalculatorActor
              entry: () => {
                console.log(
                  "[ValidationCoordinator] Calculating affected scope",
                );
              },
            },

            validating: {
              invoke: {
                src: fromPromise(async ({ input }) => {
                  const { affectedResult, self } = input as {
                    affectedResult: AffectedResult;
                    self: AnyActorRef;
                  };

                  console.log(
                    `[ValidationCoordinator] Running validation for ${affectedResult.packages.length} package(s)`,
                  );

                  // Create dynamic script executor with affected packages
                  const scriptExecutorMachine =
                    createScriptExecutorWithPackages({
                      affectedPackages: affectedResult.packages,
                      validationCommand: "npm run validate",
                      parent: self,
                    });

                  const scriptActor = createActor(scriptExecutorMachine, {
                    input: {
                      affectedPackages: affectedResult.packages,
                      validationCommand: "npm run validate",
                      parent: self,
                    },
                  });

                  scriptActor.start();
                  scriptActor.send({ type: "EXECUTE" });

                  // Wait for completion
                  return new Promise((resolve) => {
                    scriptActor.subscribe((state) => {
                      if (state.status === "done") {
                        const results =
                          state.output?.results ||
                          Array.from(state.context.results.values());
                        resolve({ results });
                      }
                    });
                  });
                }),
                input: ({ context, self }) => ({
                  affectedResult: context.affectedResult!,
                  self,
                }),
                onDone: {
                  target: "complete",
                  actions: assign({
                    validationResults: ({ event }) => {
                      const results = (
                        event.output as { results: ValidationResult[] }
                      ).results;
                      const map = new Map<string, ValidationResult>();
                      for (const result of results) {
                        map.set(result.packageName, result);
                      }
                      return map;
                    },
                  }),
                },
                onError: {
                  target: "#validationCoordinator.degraded",
                  actions: "setError",
                },
              },
              on: {
                VALIDATION_PROGRESS: {
                  actions: ({ event }) => {
                    console.log(
                      `[ValidationCoordinator] Validation progress: ${event.packageName}`,
                    );
                  },
                },
                VALIDATION_OUTPUT: {
                  actions: ({ event }) => {
                    console.log(
                      `[ValidationCoordinator] ${event.packageName}: ${event.output}`,
                    );
                  },
                },
                VALIDATION_COMPLETE: {
                  actions: ({ event }) => {
                    console.log(
                      `[ValidationCoordinator] ${event.packageName} completed with exit code ${event.exitCode}`,
                    );
                  },
                },
              },
            },

            complete: {
              entry: [
                ({ context }) => {
                  console.log(
                    `[ValidationCoordinator] Validation complete for ${context.fileEvent!.path}`,
                  );
                },
                "clearFileEvent",
              ],
              always: [
                {
                  guard: "hasQueuedFiles",
                  target: "#validationCoordinator.processing",
                  actions: "dequeueNextFile",
                },
                {
                  target: "#validationCoordinator.watching",
                },
              ],
            },
          },
        },

        degraded: {
          entry: ({ context }) => {
            console.error(
              "[ValidationCoordinator] Entered degraded mode",
              context.error,
            );
          },
          on: {
            RECOVER: "scanning",
            FILE_CHANGED: {
              actions: "queueFileChange",
            },
          },
          after: {
            60000: {
              target: "scanning",
              description: "Auto-recover after 60s",
            },
          },
        },
      },
    });
  }

  /**
   * Start the ValidationCoordinator
   */
  public start(): void {
    if (this.actor) {
      console.warn("[ValidationCoordinator] Already started");
      return;
    }

    this.actor = createActor(this.machine);
    this.actor.start();
    this.actor.send({ type: "START" });

    console.log("[ValidationCoordinator] Started");
  }

  /**
   * Send an event to the coordinator
   */
  public send(event: ValidationCoordinatorEvent): void {
    if (!this.actor) {
      throw new Error("ValidationCoordinator not started. Call start() first.");
    }

    this.actor.send(event);
  }

  /**
   * Get current state (for debugging/monitoring)
   */
  public getState() {
    if (!this.actor) {
      return null;
    }

    const snapshot = this.actor.getSnapshot();
    return {
      state: snapshot.value,
      context: snapshot.context,
      status: snapshot.status,
    };
  }

  /**
   * Stop the ValidationCoordinator
   */
  public stop(): void {
    if (!this.actor) {
      console.warn("[ValidationCoordinator] Not started");
      return;
    }

    this.actor.stop();
    this.actor = null;

    console.log("[ValidationCoordinator] Stopped");
  }
}
