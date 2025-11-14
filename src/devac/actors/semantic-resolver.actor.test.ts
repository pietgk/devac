import { describe, it, expect, vi, beforeEach } from "vitest";
import { createActor, waitFor } from "xstate";
import type { AnyActorRef } from "xstate";
import { semanticResolverActor } from "./semantic-resolver.actor";
import type {
  SemanticResolverInput,
  SemanticResolverEvent,
} from "./semantic-resolver.actor";
import type { Neo4jClient } from "../../database/neo4j-client";
import type { ImportResolver } from "../../analyzer/import-resolver";

// Mock dependencies
vi.mock("../../analyzer/lazy-semantic", () => ({
  RelationshipResolver: vi.fn().mockImplementation(() => ({
    resolveRelationships: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock("ts-morph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ts-morph")>();
  return {
    ...actual,
    Project: vi.fn().mockImplementation(() => ({
      addSourceFileAtPath: vi.fn(),
      addSourceFilesAtPaths: vi.fn(),
      getSourceFiles: vi.fn().mockReturnValue([]),
    })),
  };
});

// Mock path helper
vi.mock("../../utils/path-helpers", () => ({
  findNearestTsConfig: vi.fn().mockResolvedValue("/test/tsconfig.json"),
}));

describe("SemanticResolverActor", () => {
  let mockNeo4jClient: Neo4jClient;
  let mockImportResolver: ImportResolver;
  let mockParent: AnyActorRef;
  let parentEvents: Array<{ type: string; [key: string]: unknown }>;

  beforeEach(() => {
    parentEvents = [];

    mockParent = {
      send: vi.fn((event: SemanticResolverEvent) => {
        parentEvents.push(event as { type: string; [key: string]: unknown });
      }),
    } as unknown as AnyActorRef;

    mockNeo4jClient = {
      runTransaction: vi.fn().mockResolvedValue({
        records: [
          {
            get: vi.fn((key: string) => {
              if (key === "depPath") return "/test/dependency.ts";
              return null;
            }),
          },
        ],
      }),
      runTransactionWork: vi.fn(async () => {
        // Successful transaction
        return Promise.resolve();
      }),
    } as unknown as Neo4jClient;

    mockImportResolver = {
      resolve: vi.fn().mockReturnValue("/resolved/path.ts"),
    } as unknown as ImportResolver;
  });

  describe("Initialization", () => {
    it("should start in idle state", () => {
      const input: SemanticResolverInput = {
        neo4jClient: mockNeo4jClient,
        importResolver: mockImportResolver,
        packages: [],
        config: {
          batchSize: 10,
          maxQueueSize: 100,
          processingDelay: 100,
        },
        parent: mockParent,
      };

      const actor = createActor(semanticResolverActor, { input });
      actor.start();

      expect(actor.getSnapshot().value).toBe("idle");

      actor.stop();
    });

    it("should initialize with empty queue", () => {
      const input: SemanticResolverInput = {
        neo4jClient: mockNeo4jClient,
        importResolver: mockImportResolver,
        packages: [],
        config: {
          batchSize: 10,
          maxQueueSize: 100,
          processingDelay: 100,
        },
        parent: mockParent,
      };

      const actor = createActor(semanticResolverActor, { input });
      actor.start();

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.queue).toEqual([]);
      expect(snapshot.context.processing).toBe(false);

      actor.stop();
    });
  });

  describe("Queue Management", () => {
    it("should add file to queue and transition to queueing state", async () => {
      const input: SemanticResolverInput = {
        neo4jClient: mockNeo4jClient,
        importResolver: mockImportResolver,
        packages: [],
        config: {
          batchSize: 10,
          maxQueueSize: 100,
          processingDelay: 100,
        },
        parent: mockParent,
      };

      const actor = createActor(semanticResolverActor, { input });
      actor.start();

      actor.send({
        type: "ENQUEUE",
        filePath: "/test/file1.ts",
        priority: "normal",
      });

      await waitFor(
        actor,
        (state) => state.value === "queueing" || state.value === "debouncing",
      );

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.queue.length).toBeGreaterThan(0);
      expect(snapshot.context.queue[0]?.filePath).toBe("/test/file1.ts");

      actor.stop();
    });

    it("should deduplicate files in queue keeping highest priority", async () => {
      const input: SemanticResolverInput = {
        neo4jClient: mockNeo4jClient,
        importResolver: mockImportResolver,
        packages: [],
        config: {
          batchSize: 10,
          maxQueueSize: 100,
          processingDelay: 1000, // Long delay to inspect queue
        },
        parent: mockParent,
      };

      const actor = createActor(semanticResolverActor, { input });
      actor.start();

      // Send normal priority first
      actor.send({
        type: "ENQUEUE",
        filePath: "/test/file1.ts",
        priority: "normal",
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Send high priority - should replace normal
      actor.send({
        type: "ENQUEUE",
        filePath: "/test/file1.ts",
        priority: "high",
      });

      await waitFor(actor, (state) => state.value === "debouncing", {
        timeout: 200,
      });

      const snapshot = actor.getSnapshot();
      const file1Entries = snapshot.context.queue.filter(
        (item) => item.filePath === "/test/file1.ts",
      );

      // Should only have one entry
      expect(file1Entries.length).toBe(1);
      // Should be high priority (100)
      expect(file1Entries[0]?.priority).toBe(100);

      actor.stop();
    });

    it("should sort queue by priority (highest first)", async () => {
      const input: SemanticResolverInput = {
        neo4jClient: mockNeo4jClient,
        importResolver: mockImportResolver,
        packages: [],
        config: {
          batchSize: 10,
          maxQueueSize: 100,
          processingDelay: 1000, // Long delay to inspect queue
        },
        parent: mockParent,
      };

      const actor = createActor(semanticResolverActor, { input });
      actor.start();

      actor.send({
        type: "ENQUEUE",
        filePath: "/test/file1.ts",
        priority: "normal",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      actor.send({
        type: "ENQUEUE",
        filePath: "/test/file2.ts",
        priority: "high",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      actor.send({
        type: "ENQUEUE",
        filePath: "/test/file3.ts",
        priority: "normal",
      });

      await waitFor(actor, (state) => state.value === "debouncing", {
        timeout: 200,
      });

      const snapshot = actor.getSnapshot();
      // high = 100 should be first
      expect(snapshot.context.queue[0]?.priority).toBe(100);
      expect(snapshot.context.queue[0]?.filePath).toBe("/test/file2.ts");

      actor.stop();
    });
  });

  describe("State Machine Transitions", () => {
    it("should transition idle → queueing → debouncing when file enqueued", async () => {
      const input: SemanticResolverInput = {
        neo4jClient: mockNeo4jClient,
        importResolver: mockImportResolver,
        packages: [],
        config: {
          batchSize: 10,
          maxQueueSize: 100,
          processingDelay: 50,
        },
        parent: mockParent,
      };

      const actor = createActor(semanticResolverActor, { input });
      actor.start();

      expect(actor.getSnapshot().value).toBe("idle");

      actor.send({
        type: "ENQUEUE",
        filePath: "/test/file1.ts",
        priority: "normal",
      });

      await waitFor(actor, (state) => state.value === "debouncing");

      expect(actor.getSnapshot().value).toBe("debouncing");

      actor.stop();
    });

    it("should handle STOP event and transition to stopped state", async () => {
      const input: SemanticResolverInput = {
        neo4jClient: mockNeo4jClient,
        importResolver: mockImportResolver,
        packages: [],
        config: {
          batchSize: 10,
          maxQueueSize: 100,
          processingDelay: 50,
        },
        parent: mockParent,
      };

      const actor = createActor(semanticResolverActor, { input });
      actor.start();

      actor.send({
        type: "ENQUEUE",
        filePath: "/test/file1.ts",
        priority: "normal",
      });

      await waitFor(actor, (state) => state.value === "debouncing");

      actor.send({ type: "STOP" });

      await waitFor(actor, (state) => state.value === "stopped");

      expect(actor.getSnapshot().value).toBe("stopped");

      actor.stop();
    });
  });

  describe("Parent Communication", () => {
    it("should send events to parent during processing", async () => {
      const input: SemanticResolverInput = {
        neo4jClient: mockNeo4jClient,
        importResolver: mockImportResolver,
        packages: [],
        config: {
          batchSize: 10,
          maxQueueSize: 100,
          processingDelay: 50,
        },
        parent: mockParent,
      };

      const actor = createActor(semanticResolverActor, { input });
      actor.start();

      actor.send({
        type: "ENQUEUE",
        filePath: "/test/file1.ts",
        priority: "normal",
      });

      // Wait for processing to start
      await waitFor(
        actor,
        (state) =>
          state.value === "processing" ||
          state.value === "batchComplete" ||
          state.value === "error",
        { timeout: 500 },
      );

      // Should have sent at least one event to parent
      expect(parentEvents.length).toBeGreaterThan(0);

      actor.stop();
    });
  });

  describe("Error Handling", () => {
    it("should transition to error state when processing fails", async () => {
      // Mock Neo4j to throw error
      const failingNeo4jClient = {
        runTransaction: vi.fn().mockResolvedValue({ records: [] }),
        runTransactionWork: vi.fn().mockRejectedValue(new Error("Neo4j error")),
      } as unknown as Neo4jClient;

      const input: SemanticResolverInput = {
        neo4jClient: failingNeo4jClient,
        importResolver: mockImportResolver,
        packages: [],
        config: {
          batchSize: 10,
          maxQueueSize: 100,
          processingDelay: 50,
        },
        parent: mockParent,
      };

      const actor = createActor(semanticResolverActor, { input });
      actor.start();

      actor.send({
        type: "ENQUEUE",
        filePath: "/test/file1.ts",
        priority: "normal",
      });

      // Wait for error state
      await waitFor(actor, (state) => state.value === "error", {
        timeout: 500,
      });

      expect(actor.getSnapshot().value).toBe("error");
      expect(actor.getSnapshot().context.error).toBeDefined();

      actor.stop();
    });

    it("should auto-recover from error state after delay", async () => {
      // Mock Neo4j to throw error
      const failingNeo4jClient = {
        runTransaction: vi.fn().mockResolvedValue({ records: [] }),
        runTransactionWork: vi.fn().mockRejectedValue(new Error("Neo4j error")),
      } as unknown as Neo4jClient;

      const input: SemanticResolverInput = {
        neo4jClient: failingNeo4jClient,
        importResolver: mockImportResolver,
        packages: [],
        config: {
          batchSize: 10,
          maxQueueSize: 100,
          processingDelay: 50,
        },
        parent: mockParent,
      };

      const actor = createActor(semanticResolverActor, { input });
      actor.start();

      actor.send({
        type: "ENQUEUE",
        filePath: "/test/file1.ts",
        priority: "normal",
      });

      // Wait for error state
      await waitFor(actor, (state) => state.value === "error", {
        timeout: 500,
      });

      // Wait for auto-recovery (5 second delay in actor)
      await waitFor(actor, (state) => state.value === "idle", {
        timeout: 6000,
      });

      expect(actor.getSnapshot().value).toBe("idle");

      actor.stop();
    }, 10000);
  });

  describe("Debouncing Behavior", () => {
    it("should restart debounce timer when new file is enqueued", async () => {
      const input: SemanticResolverInput = {
        neo4jClient: mockNeo4jClient,
        importResolver: mockImportResolver,
        packages: [],
        config: {
          batchSize: 10,
          maxQueueSize: 100,
          processingDelay: 200,
        },
        parent: mockParent,
      };

      const actor = createActor(semanticResolverActor, { input });
      actor.start();

      actor.send({
        type: "ENQUEUE",
        filePath: "/test/file1.ts",
        priority: "normal",
      });

      await waitFor(actor, (state) => state.value === "debouncing");

      // Wait 100ms (half of delay)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Add another file - should restart debounce
      actor.send({
        type: "ENQUEUE",
        filePath: "/test/file2.ts",
        priority: "normal",
      });

      // Should still be in debouncing after another 100ms (total 200ms from first file)
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(actor.getSnapshot().value).toBe("debouncing");

      actor.stop();
    });
  });
});
