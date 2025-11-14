import { setup, assign, sendTo, fromPromise, createActor, type AnyActorRef } from "xstate";
import type { FileChangeEvent } from "../types/file-watcher.js";
import type { Neo4jClient } from "../graph/neo4j-client.js";
import type { StructuralParser } from "../parsers/structural-parser.js";
import type { ImportResolver } from "../resolution/import-resolver.js";
import type { PackageInfo } from "../types/package.js";
import type { AffectedResult } from "./affected-calculator.actor.js";
import type { ValidationResult } from "./script-executor.actor.js";
import { graphUpdaterActor } from "./graph-updater.actor.js";
import { semanticResolverActor } from "./semantic-resolver.actor.js";
import { affectedCalculatorActor } from "./affected-calculator.actor.js";
import { createScriptExecutorWithPackages } from "./script-executor.actor.js";

// ============================================================================
// Types
// ============================================================================

export type ValidationCoordinatorContext = {
  fileEvent: FileChangeEvent | null;
  processingQueue: FileChangeEvent[];
  affectedResult: AffectedResult | null;
  validationResults: Map<string, ValidationResult>;
  error: Error | null;
};

export type ValidationCoordinatorEvent =
  | { type: "START" }
  | { type: "FILE_CHANGED"; event: FileChangeEvent }
  | { type: "SEMANTIC_COMPLETE"; filePath: string }
  | { type: "RECOVER" }
  | { type: "GRAPH_UPDATE_PROGRESS"; phase: string; filePath?: string; nodesCount?: number }
  | { type: "GRAPH_UPDATE_COMPLETE"; filePath: string; nodesUpdated: number }
  | { type: "SEMANTIC_BATCH_STARTED"; filesCount: number }
  | { type: "SEMANTIC_DEPENDENCIES_FOUND"; dependenciesCount: number }
  | { type: "SEMANTIC_BATCH_COMPLETE"; filesProcessed: number; duration: number }
  | { type: "AFFECTED_CALCULATION_STARTED"; filePath: string }
  | { type: "AFFECTED_CALCULATION_COMPLETE"; result: AffectedResult }
  | { type: "VALIDATION_PROGRESS"; packageName: string; phase?: string }
  | { type: "VALIDATION_OUTPUT"; packageName: string; output: string }
  | { type: "VALIDATION_COMPLETE"; packageName: string; exitCode: number; duration: number }
  | { type: "ENQUEUE_SEMANTIC"; filePath: string; priority: "high" | "normal" };

// ============================================================================
// ValidationCoordinatorService
// ============================================================================

export class ValidationCoordinatorService {
  private machine: ReturnType<typeof this.createMachine>;
  private actor: AnyActorRef | null = null;

  constructor(
    private neo4jClient: Neo4jClient,
    private structuralParser: StructuralParser,
    private importResolver: ImportResolver,
    private packages: PackageInfo[],
  ) {
    this.machine = this.createMachine();
  }

  public createMachine() {
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
          error: ({ event }) => {
            if ("error" in event) {
              return event.error as Error;
            }
            return null;
          },
        }),

        setAffectedResult: assign({
          affectedResult: ({ event }) => {
            if (event.type === "AFFECTED_CALCULATION_COMPLETE") {
              return event.result;
            }
            return null;
          },
        }),

        setValidationResults: assign({
          validationResults: ({ event }) => {
            if ("results" in event) {
              const results = event.results as ValidationResult[];
              const map = new Map<string, ValidationResult>();
              for (const result of results) {
                map.set(result.packageName, result);
              }
              return map;
            }
            return new Map();
          },
        }),

        logGraphUpdateProgress: ({ event }) => {
          if (event.type === "GRAPH_UPDATE_PROGRESS") {
            console.log(`[ValidationCoordinator] Graph update progress: ${event.phase}`);
          }
        },

        logGraphUpdateComplete: ({ event }) => {
          if (event.type === "GRAPH_UPDATE_COMPLETE") {
            console.log(
              `[ValidationCoordinator] Structural update complete: ${event.nodesUpdated} nodes`,
            );
          }
        },

        logSemanticQueued: ({ context }) => {
          console.log(
            `[ValidationCoordinator] Queued for semantic: ${context.fileEvent?.path}`,
          );
        },

        logValidationProgress: ({ event }) => {
          if (event.type === "VALIDATION_PROGRESS") {
            console.log(
              `[ValidationCoordinator] Validation progress: ${event.packageName}`,
            );
          }
        },

        logValidationComplete: ({ context }) => {
          console.log(
            `[ValidationCoordinator] Validation complete for ${context.fileEvent?.path}`,
          );
        },

        logDegraded: ({ context }) => {
          console.error("[ValidationCoordinator] Entered degraded mode", {
            error: context.error,
          });
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
          invoke: {
            src: "semanticResolver",
            id: "semanticResolverService",
            input: () => ({
              neo4jClient: this.neo4jClient,
              importResolver: this.importResolver,
              packages: this.packages,
              config: {
                batchSize: 10,
                maxQueueSize: 100,
                processingDelay: 100,
              },
            }),
          },
          after: {
            100: "scanning",
          },
        },

        scanning: {
          invoke: {
            src: fromPromise(async () => {
              // Scan for files needing semantic resolution
              const result = await this.neo4jClient.runTransaction(
                `MATCH (f:File)
                 WHERE f.structuralComplete = true
                   AND f.semanticComplete = false
                 RETURN collect(f.filePath) as files`,
                {},
                "READ",
                "InitialScan",
              );

              const files = result.records[0]?.get("files") || [];

              // Queue all files for semantic resolution
              for (const filePath of files) {
                this.actor?.send({
                  type: "ENQUEUE_SEMANTIC",
                  filePath,
                  priority: "normal",
                });
              }

              return { filesQueued: files.length };
            }),
            onDone: "watching",
            onError: {
              target: "degraded",
              actions: "setError",
            },
          },
        },

        watching: {
          on: {
            FILE_CHANGED: [
              {
                guard: "isProcessing",
                actions: "queueFileChange",
                description: "Queue concurrent file change",
              },
              {
                target: "processing",
                actions: assign({
                  fileEvent: ({ event }) => event.event,
                }),
                description: "Start processing file change",
              },
            ],

            SEMANTIC_COMPLETE: {
              target: "processing.calculatingAffected",
              actions: assign({
                fileEvent: ({ event }) => ({
                  path: event.filePath,
                  type: "change" as const,
                }),
              }),
              description: "Background semantic resolution completed",
            },
          },
        },

        processing: {
          initial: "structuralUpdate",

          states: {
            structuralUpdate: {
              invoke: {
                src: "graphUpdater",
                input: ({ context, self }) => ({
                  filePath: context.fileEvent!.path,
                  changeType: context.fileEvent!.type,
                  workspaceRoot: process.cwd(),
                  neo4jClient: this.neo4jClient,
                  structuralParser: this.structuralParser,
                  parent: self,
                }),
                onDone: {
                  target: "queueSemantic",
                  actions: "logGraphUpdateComplete",
                },
                onError: {
                  target: "#validationCoordinator.degraded",
                  actions: "setError",
                },
              },
              on: {
                GRAPH_UPDATE_PROGRESS: {
                  actions: "logGraphUpdateProgress",
                },
                GRAPH_UPDATE_COMPLETE: {
                  actions: "logGraphUpdateComplete",
                },
              },
            },

            queueSemantic: {
              entry: [
                sendTo("semanticResolverService", ({ context }) => ({
                  type: "ENQUEUE",
                  filePath: context.fileEvent!.path,
                  priority: "high",
                })),
                "logSemanticQueued",
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
              invoke: {
                src: "affectedCalculator",
                input: ({ context, self }) => ({
                  changedFilePath: context.fileEvent!.path,
                  neo4jClient: this.neo4jClient,
                  packages: this.packages,
                  parent: self,
                }),
                onDone: {
                  target: "validating",
                  actions: "setAffectedResult",
                },
                onError: {
                  target: "#validationCoordinator.degraded",
                  actions: "setError",
                },
              },
              on: {
                AFFECTED_CALCULATION_STARTED: {
                  actions: ({ event }) => {
                    console.log(
                      `[ValidationCoordinator] Affected calculation started: ${event.filePath}`,
                    );
                  },
                },
                AFFECTED_CALCULATION_COMPLETE: {
                  actions: "setAffectedResult",
                },
              },
            },

            validating: {
              invoke: {
                src: fromPromise(async ({ input }) => {
                  const { affectedResult, self } = input as {
                    affectedResult: AffectedResult;
                    self: AnyActorRef;
                  };

                  // Create dynamic script executor with affected packages
                  const scriptExecutorMachine = createScriptExecutorWithPackages({
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
                        const results = state.output?.results || Array.from(state.context.results.values());
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
                  actions: "setValidationResults",
                },
                onError: {
                  target: "#validationCoordinator.degraded",
                  actions: "setError",
                },
              },
              on: {
                VALIDATION_PROGRESS: {
                  actions: "logValidationProgress",
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
              entry: ["logValidationComplete", "clearFileEvent"],
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
          entry: "logDegraded",
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

  public start(): void {
    this.actor = createActor(this.machine);
    this.actor.start();
    this.actor.send({ type: "START" });
  }

  public send(event: ValidationCoordinatorEvent): void {
    this.actor?.send(event);
  }

  public stop(): void {
    this.actor?.stop();
  }

  public getSnapshot() {
    return this.actor?.getSnapshot();
  }
}
