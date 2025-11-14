import { assign, setup, fromPromise } from "xstate";
import { spawn } from "child_process";
import type { AnyActorRef } from "xstate";

// ============================================================================
// Types
// ============================================================================

export type ScriptExecutorInput = {
  affectedPackages: string[];
  validationCommand: string;
  parent?: AnyActorRef;
};

export type ValidationResult = {
  packageName: string;
  exitCode: number;
  output: string;
  duration: number;
};

export type ScriptExecutorContext = {
  input: ScriptExecutorInput;
  results: Map<string, ValidationResult>;
  error: Error | null;
};

export type ScriptExecutorEvent =
  | { type: "STOP" }
  | { type: "xstate.done.actor.*"; output: ValidationResult }
  | { type: "xstate.error.actor.*"; error: Error };

// ============================================================================
// Actor Implementation
// ============================================================================

export const scriptExecutorActor = setup({
  types: {
    input: {} as ScriptExecutorInput,
    context: {} as ScriptExecutorContext,
    events: {} as ScriptExecutorEvent,
    output: {} as { results: ValidationResult[] },
  },

  actors: {
    executePackage: fromPromise<
      ValidationResult,
      { packageName: string; command: string; parent?: AnyActorRef }
    >(async ({ input }) => {
      const { packageName, command, parent } = input;
      const startTime = performance.now();

      if (parent) {
        parent.send({
          type: "VALIDATION_PROGRESS",
          packageName,
          phase: "starting",
        });
      }

      return new Promise<ValidationResult>((resolve, reject) => {
        let output = "";

        const child = spawn(command, {
          cwd: packageName,
          shell: true,
          timeout: 300000, // 5 minute timeout
        });

        child.stdout?.on("data", (data: Buffer) => {
          const chunk = data.toString();
          output += chunk;
          if (parent) {
            parent.send({
              type: "VALIDATION_OUTPUT",
              packageName,
              output: chunk,
            });
          }
        });

        child.stderr?.on("data", (data: Buffer) => {
          const chunk = data.toString();
          output += chunk;
          if (parent) {
            parent.send({
              type: "VALIDATION_OUTPUT",
              packageName,
              output: chunk,
            });
          }
        });

        child.on("error", (error: Error) => {
          const duration = performance.now() - startTime;
          if (parent) {
            parent.send({
              type: "VALIDATION_ERROR",
              packageName,
              error: error.message,
            });
          }
          reject(error);
        });

        child.on("close", (code: number | null) => {
          const duration = performance.now() - startTime;
          const result: ValidationResult = {
            packageName,
            exitCode: code ?? -1,
            output,
            duration,
          };
          if (parent) {
            parent.send({
              type: "VALIDATION_COMPLETE",
              packageName,
              exitCode: code ?? -1,
              duration,
            });
          }
          resolve(result);
        });
      });
    }),
  },

  actions: {
    collectResult: assign({
      results: ({ context, event }) => {
        if (event.type.startsWith("xstate.done.actor")) {
          const result = event.output as ValidationResult;
          const newResults = new Map(context.results);
          newResults.set(result.packageName, result);
          return newResults;
        }
        return context.results;
      },
    }),

    setError: assign({
      error: ({ event }) => {
        if (event.type.startsWith("xstate.error.actor")) {
          return event.error as Error;
        }
        return null;
      },
    }),

    logStart: ({ context }) => {
      console.log(
        `[ScriptExecutor] Starting validation for ${context.input.affectedPackages.length} package(s)`,
      );
    },

    logSuccess: ({ context }) => {
      console.log(
        `[ScriptExecutor] Completed validation for ${context.results.size} package(s)`,
      );
    },

    logError: ({ context }) => {
      console.error(
        `[ScriptExecutor] Validation failed:`,
        context.error?.message,
      );
    },
  },

  guards: {
    allPackagesCompleted: ({ context }) => {
      return context.results.size === context.input.affectedPackages.length;
    },
  },
}).createMachine({
  id: "scriptExecutor",
  initial: "idle",

  context: ({ input }) => ({
    input,
    results: new Map<string, ValidationResult>(),
    error: null,
  }),

  states: {
    idle: {
      on: {
        EXECUTE: {
          target: "executing",
          actions: "logStart",
        },
        STOP: "stopped",
      },
    },

    executing: {
      type: "parallel",
      states: {},
      on: {
        "*": [
          {
            guard: ({ event }) => event.type.startsWith("xstate.done.actor"),
            actions: "collectResult",
          },
          {
            guard: ({ event }) => event.type.startsWith("xstate.error.actor"),
            target: "failed",
            actions: "setError",
          },
        ],
        STOP: "stopped",
      },
      always: [
        {
          guard: "allPackagesCompleted",
          target: "success",
          actions: "logSuccess",
        },
      ],
    },

    success: {
      type: "final",
      output: ({ context }) => ({
        results: Array.from(context.results.values()),
      }),
    },

    failed: {
      entry: "logError",
      type: "final",
      output: ({ context }) => ({
        results: Array.from(context.results.values()),
      }),
    },

    stopped: {
      type: "final",
      output: ({ context }) => ({
        results: Array.from(context.results.values()),
      }),
    },
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create dynamic state machine with parallel package execution
 */
export function createScriptExecutorWithPackages(input: ScriptExecutorInput) {
  const baseConfig = scriptExecutorActor.config;

  // Create parallel states for each package
  const executingStates: Record<string, unknown> = {};

  for (const packageName of input.affectedPackages) {
    executingStates[packageName] = {
      invoke: {
        src: "executePackage",
        input: {
          packageName,
          command: input.validationCommand,
          parent: input.parent,
        },
      },
    };
  }

  // Override executing state with dynamic parallel states
  const dynamicConfig = {
    ...baseConfig,
    states: {
      ...baseConfig.states,
      executing: {
        ...baseConfig.states.executing,
        type: "parallel" as const,
        states: executingStates,
      },
    },
  };

  return setup({
    types: scriptExecutorActor.types,
    actors: scriptExecutorActor.implementations.actors,
    actions: scriptExecutorActor.implementations.actions,
    guards: scriptExecutorActor.implementations.guards,
  }).createMachine(dynamicConfig);
}
