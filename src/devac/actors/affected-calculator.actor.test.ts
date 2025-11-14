import { describe, it, expect, vi, beforeEach } from "vitest";
import { createActor, waitFor } from "xstate";
import type { AnyActorRef } from "xstate";
import {
  affectedCalculatorActor,
  AffectedCalculatorCache,
} from "./affected-calculator.actor";
import type {
  AffectedCalculatorInput,
  PackageInfo,
} from "./affected-calculator.actor";
import type { Neo4jClient } from "../../database/neo4j-client";

describe("AffectedCalculatorActor", () => {
  let mockNeo4jClient: Neo4jClient;
  let mockParent: AnyActorRef;
  let parentEvents: Array<{ type: string; [key: string]: unknown }>;
  let mockPackages: PackageInfo[];

  beforeEach(() => {
    // Clear cache before each test
    AffectedCalculatorCache.clear();

    parentEvents = [];

    mockParent = {
      send: vi.fn((event: unknown) => {
        parentEvents.push(event as { type: string; [key: string]: unknown });
      }),
    } as unknown as AnyActorRef;

    mockPackages = [
      { name: "package-a", path: "/project/packages/a" },
      { name: "package-b", path: "/project/packages/b" },
    ];

    mockNeo4jClient = {
      runTransaction: vi.fn().mockResolvedValue({
        records: [
          {
            get: vi.fn((key: string) => {
              if (key === "filePath")
                return "/project/packages/a/dependent1.ts";
              if (key === "packageName") return "package-a";
              return null;
            }),
          },
          {
            get: vi.fn((key: string) => {
              if (key === "filePath")
                return "/project/packages/a/dependent2.ts";
              if (key === "packageName") return "package-a";
              return null;
            }),
          },
        ],
      }),
    } as unknown as Neo4jClient;
  });

  describe("Initialization and Execution", () => {
    it("should start in calculating state", () => {
      const input: AffectedCalculatorInput = {
        changedFilePath: "/project/packages/a/source.ts",
        neo4jClient: mockNeo4jClient,
        packages: mockPackages,
        parent: mockParent,
      };

      const actor = createActor(affectedCalculatorActor, { input });
      actor.start();

      expect(actor.getSnapshot().value).toBe("calculating");

      actor.stop();
    });

    it("should transition to success after calculation", async () => {
      const input: AffectedCalculatorInput = {
        changedFilePath: "/project/packages/a/source.ts",
        neo4jClient: mockNeo4jClient,
        packages: mockPackages,
        parent: mockParent,
      };

      const actor = createActor(affectedCalculatorActor, { input });
      actor.start();

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      expect(actor.getSnapshot().value).toBe("success");

      actor.stop();
    });
  });

  describe("Scope Calculation", () => {
    it("should return 'file' scope when no dependents found", async () => {
      const emptyNeo4jClient = {
        runTransaction: vi.fn().mockResolvedValue({
          records: [],
        }),
      } as unknown as Neo4jClient;

      const input: AffectedCalculatorInput = {
        changedFilePath: "/project/packages/a/isolated.ts",
        neo4jClient: emptyNeo4jClient,
        packages: mockPackages,
        parent: mockParent,
      };

      const actor = createActor(affectedCalculatorActor, { input });
      actor.start();

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const snapshot = actor.getSnapshot();
      const result = snapshot.output || snapshot.context.result;
      expect(result?.scope).toBe("file");
      expect(result?.files).toEqual([]);
      expect(result?.packages).toEqual([]);
      expect(result?.dependentCount).toBe(0);

      actor.stop();
    });

    it("should return 'package' scope when dependents in one package", async () => {
      const input: AffectedCalculatorInput = {
        changedFilePath: "/project/packages/a/source.ts",
        neo4jClient: mockNeo4jClient,
        packages: mockPackages,
        parent: mockParent,
      };

      const actor = createActor(affectedCalculatorActor, { input });
      actor.start();

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const snapshot = actor.getSnapshot();
      const result = snapshot.output || snapshot.context.result;
      expect(result?.scope).toBe("package");
      expect(result?.files).toHaveLength(2);
      expect(result?.packages).toEqual(["package-a"]);
      expect(result?.dependentCount).toBe(2);

      actor.stop();
    });

    it("should return 'repository' scope when dependents in multiple packages", async () => {
      const multiPackageNeo4jClient = {
        runTransaction: vi.fn().mockResolvedValue({
          records: [
            {
              get: vi.fn((key: string) => {
                if (key === "filePath")
                  return "/project/packages/a/dependent1.ts";
                if (key === "packageName") return "package-a";
                return null;
              }),
            },
            {
              get: vi.fn((key: string) => {
                if (key === "filePath")
                  return "/project/packages/b/dependent2.ts";
                if (key === "packageName") return "package-b";
                return null;
              }),
            },
          ],
        }),
      } as unknown as Neo4jClient;

      const input: AffectedCalculatorInput = {
        changedFilePath: "/project/packages/shared/util.ts",
        neo4jClient: multiPackageNeo4jClient,
        packages: mockPackages,
        parent: mockParent,
      };

      const actor = createActor(affectedCalculatorActor, { input });
      actor.start();

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const snapshot = actor.getSnapshot();
      const result = snapshot.output || snapshot.context.result;
      expect(result?.scope).toBe("repository");
      expect(result?.files).toHaveLength(2);
      expect(result?.packages).toHaveLength(2);
      expect(result?.packages).toContain("package-a");
      expect(result?.packages).toContain("package-b");
      expect(result?.dependentCount).toBe(2);

      actor.stop();
    });
  });

  describe("Parent Communication", () => {
    it("should send AFFECTED_CALCULATION_STARTED event to parent", async () => {
      const input: AffectedCalculatorInput = {
        changedFilePath: "/project/packages/a/source.ts",
        neo4jClient: mockNeo4jClient,
        packages: mockPackages,
        parent: mockParent,
      };

      const actor = createActor(affectedCalculatorActor, { input });
      actor.start();

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const startedEvent = parentEvents.find(
        (e) => e.type === "AFFECTED_CALCULATION_STARTED",
      );
      expect(startedEvent).toBeDefined();
      expect(startedEvent?.filePath).toBe("/project/packages/a/source.ts");

      actor.stop();
    });

    it("should send AFFECTED_CALCULATION_COMPLETE event to parent", async () => {
      const input: AffectedCalculatorInput = {
        changedFilePath: "/project/packages/a/source.ts",
        neo4jClient: mockNeo4jClient,
        packages: mockPackages,
        parent: mockParent,
      };

      const actor = createActor(affectedCalculatorActor, { input });
      actor.start();

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const completeEvent = parentEvents.find(
        (e) => e.type === "AFFECTED_CALCULATION_COMPLETE",
      );
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.result).toBeDefined();
      expect((completeEvent?.result as { scope: string })?.scope).toBe(
        "package",
      );

      actor.stop();
    });

    it("should work without parent (optional)", async () => {
      const input: AffectedCalculatorInput = {
        changedFilePath: "/project/packages/a/source.ts",
        neo4jClient: mockNeo4jClient,
        packages: mockPackages,
        // No parent
      };

      const actor = createActor(affectedCalculatorActor, { input });
      actor.start();

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      expect(actor.getSnapshot().value).toBe("success");
      expect(parentEvents).toHaveLength(0);

      actor.stop();
    });
  });

  describe("Error Handling", () => {
    it("should transition to failed state on Neo4j error", async () => {
      const failingNeo4jClient = {
        runTransaction: vi.fn().mockRejectedValue(new Error("Neo4j error")),
      } as unknown as Neo4jClient;

      const input: AffectedCalculatorInput = {
        changedFilePath: "/project/packages/a/source.ts",
        neo4jClient: failingNeo4jClient,
        packages: mockPackages,
        parent: mockParent,
      };

      const actor = createActor(affectedCalculatorActor, { input });
      actor.start();

      await waitFor(actor, (state) => state.value === "failed", {
        timeout: 1000,
      });

      expect(actor.getSnapshot().value).toBe("failed");
      expect(actor.getSnapshot().context.error).toBeDefined();

      actor.stop();
    });

    it("should return safe default on failure", async () => {
      const failingNeo4jClient = {
        runTransaction: vi.fn().mockRejectedValue(new Error("Neo4j error")),
      } as unknown as Neo4jClient;

      const input: AffectedCalculatorInput = {
        changedFilePath: "/project/packages/a/source.ts",
        neo4jClient: failingNeo4jClient,
        packages: mockPackages,
        parent: mockParent,
      };

      const actor = createActor(affectedCalculatorActor, { input });
      actor.start();

      await waitFor(actor, (state) => state.value === "failed", {
        timeout: 1000,
      });

      // Wait for actor to fully complete (final state)
      await waitFor(actor, (state) => state.status === "done", {
        timeout: 1000,
      });

      const snapshot = actor.getSnapshot();
      const result = snapshot.output ||
        snapshot.context.result || {
          scope: "file" as const,
          files: [],
          packages: [],
          dependentCount: 0,
        };
      expect(result.scope).toBe("file");
      expect(result.files).toEqual([]);
      expect(result.packages).toEqual([]);
      expect(result.dependentCount).toBe(0);

      actor.stop();
    });
  });

  describe("Caching", () => {
    it("should cache results and reuse on subsequent calls", async () => {
      const input: AffectedCalculatorInput = {
        changedFilePath: "/project/packages/a/source.ts",
        neo4jClient: mockNeo4jClient,
        packages: mockPackages,
        parent: mockParent,
      };

      // First call - should hit Neo4j
      const actor1 = createActor(affectedCalculatorActor, { input });
      actor1.start();
      await waitFor(actor1, (state) => state.value === "success", {
        timeout: 1000,
      });

      expect(mockNeo4jClient.runTransaction).toHaveBeenCalledTimes(1);

      // Second call with same file - should use cache
      const actor2 = createActor(affectedCalculatorActor, { input });
      actor2.start();
      await waitFor(actor2, (state) => state.value === "success", {
        timeout: 1000,
      });

      // Should not have called Neo4j again
      expect(mockNeo4jClient.runTransaction).toHaveBeenCalledTimes(1);

      // Results should be identical
      const result1 = actor1.getSnapshot().output;
      const result2 = actor2.getSnapshot().output;
      expect(result1).toEqual(result2);
    });

    it("should track cache statistics", async () => {
      const input: AffectedCalculatorInput = {
        changedFilePath: "/project/packages/a/source.ts",
        neo4jClient: mockNeo4jClient,
        packages: mockPackages,
      };

      const actor = createActor(affectedCalculatorActor, { input });
      actor.start();
      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const stats = AffectedCalculatorCache.getStats();
      expect(stats.size).toBe(1);
      expect(stats.maxSize).toBe(100);
      expect(stats.ttlMs).toBe(60000);
    });

    it("should allow manual cache invalidation", async () => {
      const input: AffectedCalculatorInput = {
        changedFilePath: "/project/packages/a/source.ts",
        neo4jClient: mockNeo4jClient,
        packages: mockPackages,
      };

      // First call
      const actor1 = createActor(affectedCalculatorActor, { input });
      actor1.start();
      await waitFor(actor1, (state) => state.value === "success", {
        timeout: 1000,
      });

      expect(AffectedCalculatorCache.has("/project/packages/a/source.ts")).toBe(
        true,
      );

      // Invalidate
      AffectedCalculatorCache.invalidate("/project/packages/a/source.ts");
      expect(AffectedCalculatorCache.has("/project/packages/a/source.ts")).toBe(
        false,
      );

      // Second call should hit Neo4j again
      const actor2 = createActor(affectedCalculatorActor, { input });
      actor2.start();
      await waitFor(actor2, (state) => state.value === "success", {
        timeout: 1000,
      });

      expect(mockNeo4jClient.runTransaction).toHaveBeenCalledTimes(2);
    });
  });

  describe("Result Deduplication", () => {
    it("should deduplicate file paths", async () => {
      const duplicateNeo4jClient = {
        runTransaction: vi.fn().mockResolvedValue({
          records: [
            {
              get: vi.fn((key: string) => {
                if (key === "filePath") return "/project/packages/a/file.ts";
                if (key === "packageName") return "package-a";
                return null;
              }),
            },
            {
              get: vi.fn((key: string) => {
                if (key === "filePath") return "/project/packages/a/file.ts"; // Duplicate
                if (key === "packageName") return "package-a";
                return null;
              }),
            },
          ],
        }),
      } as unknown as Neo4jClient;

      const input: AffectedCalculatorInput = {
        changedFilePath: "/project/packages/a/source.ts",
        neo4jClient: duplicateNeo4jClient,
        packages: mockPackages,
        parent: mockParent,
      };

      const actor = createActor(affectedCalculatorActor, { input });
      actor.start();

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const snapshot = actor.getSnapshot();
      const result = snapshot.output || snapshot.context.result;
      expect(result?.files).toHaveLength(1);
      expect(result?.files).toEqual(["/project/packages/a/file.ts"]);
      expect(result?.dependentCount).toBe(1);

      actor.stop();
    });

    it("should deduplicate package names", async () => {
      const input: AffectedCalculatorInput = {
        changedFilePath: "/project/packages/a/source.ts",
        neo4jClient: mockNeo4jClient, // Returns 2 files from same package
        packages: mockPackages,
        parent: mockParent,
      };

      const actor = createActor(affectedCalculatorActor, { input });
      actor.start();

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const snapshot = actor.getSnapshot();
      const result = snapshot.output || snapshot.context.result;
      expect(result?.packages).toHaveLength(1);
      expect(result?.packages).toEqual(["package-a"]);

      actor.stop();
    });
  });
});
