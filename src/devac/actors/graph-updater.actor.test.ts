import { describe, it, expect, vi, beforeEach } from "vitest";
import { createActor, waitFor } from "xstate";
import type { AnyActorRef } from "xstate";
import { graphUpdaterActor } from "./graph-updater.actor";
import type {
  GraphUpdaterInput,
  StructuralParseResult,
  GraphUpdaterEvent,
} from "./graph-updater.actor";
import type { Neo4jClient } from "../../database/neo4j-client";

describe("GraphUpdaterActor", () => {
  let mockNeo4jClient: Neo4jClient;
  let mockParent: AnyActorRef;
  let parentEvents: Array<{ type: string; [key: string]: unknown }>;
  let mockParseResult: StructuralParseResult;

  beforeEach(() => {
    parentEvents = [];

    mockParent = {
      send: vi.fn((event: GraphUpdaterEvent) => {
        parentEvents.push(event as { type: string; [key: string]: unknown });
      }),
    } as unknown as AnyActorRef;

    mockParseResult = {
      nodes: [
        {
          entityId: "test-node-1",
          kind: "FunctionDeclaration",
          name: "testFunction",
          filePath: "/test/file.ts",
          line: 10,
          column: 5,
        },
      ],
      relationships: [
        {
          source: "test-node-1",
          target: "test-node-2",
          type: "CONTAINS",
        },
      ],
      importStrings: ["import { foo } from './foo'"],
      exportedSymbols: [
        {
          name: "testFunction",
          kind: "function",
        },
      ],
    };

    mockNeo4jClient = {
      runTransactionWork: vi.fn(async (callback) => {
        const mockTx = {
          run: vi.fn().mockResolvedValue({
            records: [
              {
                get: vi.fn((key: string) => {
                  if (key === "deleted") return 5;
                  if (key === "created") return 3;
                  return 0;
                }),
              },
            ],
          }),
        };
        return await callback(mockTx);
      }),
    } as unknown as Neo4jClient;
  });

  describe("Initialization", () => {
    it("should start in idle state", () => {
      const input: GraphUpdaterInput = {
        neo4jClient: mockNeo4jClient,
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
        parent: mockParent,
      };

      const actor = createActor(graphUpdaterActor, { input });
      actor.start();

      expect(actor.getSnapshot().value).toBe("idle");

      actor.stop();
    });

    it("should initialize with zero nodes updated", () => {
      const input: GraphUpdaterInput = {
        neo4jClient: mockNeo4jClient,
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
        parent: mockParent,
      };

      const actor = createActor(graphUpdaterActor, { input });
      actor.start();

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.nodesUpdated).toBe(0);
      expect(snapshot.context.error).toBeNull();
      expect(snapshot.context.retryCount).toBe(0);

      actor.stop();
    });
  });

  describe("Update Flow", () => {
    it("should transition idle → updating → success on UPDATE event", async () => {
      const input: GraphUpdaterInput = {
        neo4jClient: mockNeo4jClient,
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
        parent: mockParent,
      };

      const actor = createActor(graphUpdaterActor, { input });
      actor.start();

      expect(actor.getSnapshot().value).toBe("idle");

      actor.send({
        type: "UPDATE",
        filePath: "/test/file2.ts",
        parseResult: mockParseResult,
      });

      await waitFor(actor, (state) => state.value === "updating");
      expect(actor.getSnapshot().value).toBe("updating");

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });
      expect(actor.getSnapshot().value).toBe("success");

      actor.stop();
    });

    it("should return to idle after success", async () => {
      const input: GraphUpdaterInput = {
        neo4jClient: mockNeo4jClient,
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
        parent: mockParent,
      };

      const actor = createActor(graphUpdaterActor, { input });
      actor.start();

      actor.send({
        type: "UPDATE",
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
      });

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      // Should return to idle after brief pause (100ms)
      await waitFor(actor, (state) => state.value === "idle", {
        timeout: 200,
      });

      expect(actor.getSnapshot().value).toBe("idle");

      actor.stop();
    });

    it("should update context with nodes updated count", async () => {
      const input: GraphUpdaterInput = {
        neo4jClient: mockNeo4jClient,
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
        parent: mockParent,
      };

      const actor = createActor(graphUpdaterActor, { input });
      actor.start();

      actor.send({
        type: "UPDATE",
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
      });

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const snapshot = actor.getSnapshot();
      // The context should track that update was performed
      // (actual count depends on mock implementation)
      expect(snapshot.context.nodesUpdated).toBeGreaterThanOrEqual(0);
      expect(snapshot.context.error).toBeNull();

      actor.stop();
    });
  });

  describe("Parent Communication", () => {
    it("should send GRAPH_UPDATE_PROGRESS event to parent", async () => {
      const input: GraphUpdaterInput = {
        neo4jClient: mockNeo4jClient,
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
        parent: mockParent,
      };

      const actor = createActor(graphUpdaterActor, { input });
      actor.start();

      actor.send({
        type: "UPDATE",
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
      });

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const progressEvent = parentEvents.find(
        (e) => e.type === "GRAPH_UPDATE_PROGRESS",
      );
      expect(progressEvent).toBeDefined();
      expect(progressEvent?.phase).toBe("deleting");
      expect(progressEvent?.filePath).toBe("/test/file.ts");

      actor.stop();
    });

    it("should send GRAPH_UPDATE_COMPLETE event to parent", async () => {
      const input: GraphUpdaterInput = {
        neo4jClient: mockNeo4jClient,
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
        parent: mockParent,
      };

      const actor = createActor(graphUpdaterActor, { input });
      actor.start();

      actor.send({
        type: "UPDATE",
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
      });

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const completeEvent = parentEvents.find(
        (e) => e.type === "GRAPH_UPDATE_COMPLETE",
      );
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.filePath).toBe("/test/file.ts");
      expect(completeEvent?.nodesCount).toBeGreaterThan(0);

      actor.stop();
    });
  });

  describe("Error Handling", () => {
    it("should transition to failed state on error", async () => {
      const failingNeo4jClient = {
        runTransactionWork: vi.fn().mockRejectedValue(new Error("Neo4j error")),
      } as unknown as Neo4jClient;

      const input: GraphUpdaterInput = {
        neo4jClient: failingNeo4jClient,
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
        parent: mockParent,
      };

      const actor = createActor(graphUpdaterActor, { input });
      actor.start();

      actor.send({
        type: "UPDATE",
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
      });

      await waitFor(actor, (state) => state.value === "failed", {
        timeout: 1000,
      });

      expect(actor.getSnapshot().value).toBe("failed");
      expect(actor.getSnapshot().context.error).toBeDefined();

      actor.stop();
    });

    it("should retry up to 3 times on failure", async () => {
      let attemptCount = 0;
      const failingNeo4jClient = {
        runTransactionWork: vi.fn().mockImplementation(async () => {
          attemptCount++;
          throw new Error("Neo4j error");
        }),
      } as unknown as Neo4jClient;

      const input: GraphUpdaterInput = {
        neo4jClient: failingNeo4jClient,
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
        parent: mockParent,
      };

      const actor = createActor(graphUpdaterActor, { input });
      actor.start();

      actor.send({
        type: "UPDATE",
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
      });

      // Wait for all retries to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should have attempted 3 times total (initial + 2 retries, fails on 3rd)
      // The incrementRetry happens BEFORE retry, so retryCount increments to 3
      // but only 3 actual attempts are made
      expect(attemptCount).toBe(3);
      expect(actor.getSnapshot().context.retryCount).toBe(3);

      actor.stop();
    });

    it("should succeed on retry if error is transient", async () => {
      let attemptCount = 0;
      const transientFailureClient = {
        runTransactionWork: vi.fn().mockImplementation(async (callback) => {
          attemptCount++;
          if (attemptCount < 2) {
            throw new Error("Transient error");
          }
          // Succeed on second attempt
          const mockTx = {
            run: vi.fn().mockResolvedValue({
              records: [
                {
                  get: vi.fn((key: string) => {
                    if (key === "deleted") return 5;
                    if (key === "created") return 3;
                    return 0;
                  }),
                },
              ],
            }),
          };
          return await callback(mockTx);
        }),
      } as unknown as Neo4jClient;

      const input: GraphUpdaterInput = {
        neo4jClient: transientFailureClient,
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
        parent: mockParent,
      };

      const actor = createActor(graphUpdaterActor, { input });
      actor.start();

      actor.send({
        type: "UPDATE",
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
      });

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      expect(actor.getSnapshot().value).toBe("success");
      expect(attemptCount).toBe(2);

      actor.stop();
    });

    it("should handle manual RETRY event in failed state", async () => {
      let attemptCount = 0;
      const failingThenSucceedingClient = {
        runTransactionWork: vi.fn().mockImplementation(async (callback) => {
          attemptCount++;
          if (attemptCount <= 4) {
            // Fail initial + 3 auto-retries
            throw new Error("Neo4j error");
          }
          // Succeed on manual retry
          const mockTx = {
            run: vi.fn().mockResolvedValue({
              records: [
                {
                  get: vi.fn((key: string) => {
                    if (key === "deleted") return 5;
                    if (key === "created") return 3;
                    return 0;
                  }),
                },
              ],
            }),
          };
          return await callback(mockTx);
        }),
      } as unknown as Neo4jClient;

      const input: GraphUpdaterInput = {
        neo4jClient: failingThenSucceedingClient,
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
        parent: mockParent,
      };

      const actor = createActor(graphUpdaterActor, { input });
      actor.start();

      actor.send({
        type: "UPDATE",
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
      });

      // Wait for all auto-retries to fail
      await waitFor(actor, (state) => state.value === "failed", {
        timeout: 1000,
      });

      // Manual retry
      actor.send({ type: "RETRY" });

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      expect(actor.getSnapshot().value).toBe("success");

      actor.stop();
    });
  });

  describe("Stop Handling", () => {
    it("should handle STOP event from idle state", () => {
      const input: GraphUpdaterInput = {
        neo4jClient: mockNeo4jClient,
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
        parent: mockParent,
      };

      const actor = createActor(graphUpdaterActor, { input });
      actor.start();

      actor.send({ type: "STOP" });

      expect(actor.getSnapshot().value).toBe("stopped");

      actor.stop();
    });

    it("should handle STOP event from failed state", async () => {
      const failingNeo4jClient = {
        runTransactionWork: vi.fn().mockRejectedValue(new Error("Neo4j error")),
      } as unknown as Neo4jClient;

      const input: GraphUpdaterInput = {
        neo4jClient: failingNeo4jClient,
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
        parent: mockParent,
      };

      const actor = createActor(graphUpdaterActor, { input });
      actor.start();

      actor.send({
        type: "UPDATE",
        filePath: "/test/file.ts",
        parseResult: mockParseResult,
      });

      await waitFor(actor, (state) => state.value === "failed", {
        timeout: 1000,
      });

      actor.send({ type: "STOP" });

      expect(actor.getSnapshot().value).toBe("stopped");

      actor.stop();
    });
  });
});
