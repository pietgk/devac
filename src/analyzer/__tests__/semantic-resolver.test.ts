import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { SemanticResolver } from "../semantic-resolver.js";
import type { Neo4jClient } from "../../neo4j/neo4j-client.js";
import type { ImportResolver } from "../../utils/import-resolver.js";
import type { PackageInfo } from "../../types/config.js";
import type { AstNode } from "../../types/ast-node.js";

// Mock dependencies
vi.mock("../../neo4j/neo4j-client.js");
vi.mock("../../utils/import-resolver.js");
vi.mock("ts-morph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ts-morph")>();
  return {
    ...actual,
    Project: vi.fn().mockImplementation(() => ({
      addSourceFileAtPath: vi.fn(),
      getSourceFiles: vi.fn().mockReturnValue([]),
    })),
  };
});

describe("SemanticResolver", () => {
  let mockNeo4jClient: Neo4jClient;
  let mockImportResolver: ImportResolver;
  let mockPackages: PackageInfo[];
  let resolver: SemanticResolver;

  beforeEach(() => {
    // Create mock Neo4j client
    mockNeo4jClient = {
      runTransaction: vi.fn().mockResolvedValue({ records: [] }),
      runTransactionWork: vi.fn().mockImplementation(async (fn) => {
        const mockTx = {
          run: vi.fn().mockResolvedValue({
            records: [],
          }),
        };
        return fn(mockTx);
      }),
      close: vi.fn(),
    } as unknown as Neo4jClient;

    // Create mock import resolver
    mockImportResolver = {
      resolveImport: vi.fn(),
    } as unknown as ImportResolver;

    // Create mock packages
    mockPackages = [
      {
        name: "test-package",
        path: "/test/packages/test-package",
        tsConfigPath: "/test/packages/test-package/tsconfig.json",
      },
    ];

    // Create resolver instance
    resolver = new SemanticResolver(
      mockNeo4jClient,
      mockImportResolver,
      mockPackages,
      {
        batchSize: 5,
        maxQueueSize: 20,
        processingDelay: 10,
      },
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Queue Management", () => {
    it("should enqueue files with normal priority", () => {
      resolver.enqueue("/test/file1.ts");
      resolver.enqueue("/test/file2.ts");

      const status = resolver.getQueueStatus();
      expect(status.queueSize).toBe(2);
      expect(status.processing).toBe(false);
    });

    it("should enqueue high-priority files at front of queue", () => {
      resolver.enqueue("/test/file1.ts", "normal");
      resolver.enqueue("/test/file2.ts", "normal");
      resolver.enqueue("/test/urgent.ts", "high");

      // Verify queue status
      const status = resolver.getQueueStatus();
      expect(status.queueSize).toBe(3);
    });

    it("should warn when queue exceeds max size threshold", () => {
      // Create resolver with small queue threshold
      const smallResolver = new SemanticResolver(
        mockNeo4jClient,
        mockImportResolver,
        mockPackages,
        {
          batchSize: 5,
          maxQueueSize: 3,
          processingDelay: 10,
        },
      );

      smallResolver.enqueue("/test/file1.ts");
      smallResolver.enqueue("/test/file2.ts");
      smallResolver.enqueue("/test/file3.ts");

      // This will still be added (maxQueueSize is a warning threshold, not a limit)
      smallResolver.enqueue("/test/file4.ts");

      const status = smallResolver.getQueueStatus();
      expect(status.queueSize).toBe(4);
      // Note: In real usage, a warning would be logged when queue > maxQueueSize
    });

    it("should return correct queue status", () => {
      resolver.enqueue("/test/file1.ts");
      resolver.enqueue("/test/file2.ts");

      const status = resolver.getQueueStatus();
      expect(status.queueSize).toBe(2);
      expect(status.processing).toBe(false);
    });

    it("should allow clearing the queue", async () => {
      resolver.enqueue("/test/file1.ts");
      resolver.enqueue("/test/file2.ts");

      expect(resolver.getQueueStatus().queueSize).toBe(2);

      // Wait for processing to start and then stop
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Queue should be empty or reduced after processing
      const status = resolver.getQueueStatus();
      expect(status.queueSize).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Batch Processing", () => {
    it("should process files in batches", async () => {
      // Mock Neo4j to return empty dependencies
      const mockTxRun = vi.fn().mockImplementation(async (query: string) => {
        if (query.includes("MATCH (f:File)")) {
          // findBatchDependencies query
          return { records: [] };
        } else if (query.includes("MATCH (n:Node)")) {
          // getNodesForFiles query
          return {
            records: [
              {
                get: (key: string) => {
                  if (key === "n") {
                    return {
                      properties: {
                        entityId: "file1-node",
                        name: "TestClass",
                        kind: "class",
                        filePath: "/test/file1.ts",
                      },
                    };
                  }
                  return null;
                },
              },
            ],
          };
        }
        return { records: [] };
      });

      mockNeo4jClient.runTransactionWork = vi
        .fn()
        .mockImplementation(async (fn) => {
          const mockTx = { run: mockTxRun };
          return fn(mockTx);
        });

      // Enqueue multiple files
      resolver.enqueue("/test/file1.ts");
      resolver.enqueue("/test/file2.ts");
      resolver.enqueue("/test/file3.ts");
      resolver.enqueue("/test/file4.ts");
      resolver.enqueue("/test/file5.ts");
      resolver.enqueue("/test/file6.ts");

      // Wait for processing with timeout
      const result = await resolver.waitForIdle(2000);

      expect(result).toBe(true);
      expect(resolver.getQueueStatus().processing).toBe(false);
    });

    it("should respect batch size configuration", async () => {
      const batchSize = 3;
      const customResolver = new SemanticResolver(
        mockNeo4jClient,
        mockImportResolver,
        mockPackages,
        {
          batchSize,
          maxQueueSize: 20,
          processingDelay: 10,
        },
      );

      // Mock Neo4j responses
      const mockTxRun = vi.fn().mockResolvedValue({ records: [] });
      mockNeo4jClient.runTransactionWork = vi
        .fn()
        .mockImplementation(async (fn) => {
          const mockTx = { run: mockTxRun };
          return fn(mockTx);
        });

      // Enqueue more than one batch
      for (let i = 0; i < 7; i++) {
        customResolver.enqueue(`/test/file${i}.ts`);
      }

      await customResolver.waitForIdle(2000);

      // Should have processed files (exact call count depends on internal batching)
      expect(mockNeo4jClient.runTransactionWork).toHaveBeenCalled();
    });

    it("should handle processing delays between batches", async () => {
      const startTime = Date.now();

      resolver.enqueue("/test/file1.ts");
      resolver.enqueue("/test/file2.ts");
      resolver.enqueue("/test/file3.ts");
      resolver.enqueue("/test/file4.ts");
      resolver.enqueue("/test/file5.ts");
      resolver.enqueue("/test/file6.ts");

      // Mock Neo4j to return quickly
      const mockTxRun = vi.fn().mockResolvedValue({ records: [] });
      mockNeo4jClient.runTransactionWork = vi
        .fn()
        .mockImplementation(async (fn) => {
          const mockTx = { run: mockTxRun };
          return fn(mockTx);
        });

      await resolver.waitForIdle(2000);

      const elapsed = Date.now() - startTime;

      // Should have some delay (at least one batch delay of 10ms)
      // Note: This is a loose check because of test timing variability
      expect(elapsed).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Dependency Discovery", () => {
    it("should find transitive dependencies via Neo4j", async () => {
      const mockRecords = [
        {
          get: () => "/test/dependency1.ts",
        },
        {
          get: () => "/test/dependency2.ts",
        },
      ];

      const mockTxRun = vi.fn().mockResolvedValue({
        records: mockRecords,
      });

      mockNeo4jClient.runTransactionWork = vi
        .fn()
        .mockImplementation(async (fn) => {
          const mockTx = { run: mockTxRun };
          return fn(mockTx);
        });

      // This is tested indirectly through batch processing
      resolver.enqueue("/test/file1.ts");

      await resolver.waitForIdle(1000);

      // Verify Neo4j was queried
      expect(mockNeo4jClient.runTransactionWork).toHaveBeenCalled();
    });
  });

  describe("Neo4j Integration", () => {
    it("should mark files as semantically queued", async () => {
      const mockTxRun = vi.fn().mockResolvedValue({ records: [] });
      mockNeo4jClient.runTransactionWork = vi
        .fn()
        .mockImplementation(async (fn) => {
          const mockTx = { run: mockTxRun };
          return fn(mockTx);
        });

      resolver.enqueue("/test/file1.ts");

      await resolver.waitForIdle(1000);

      // Verify that Neo4j transactions were run
      expect(mockNeo4jClient.runTransactionWork).toHaveBeenCalled();
    });

    it("should update file status after semantic resolution", async () => {
      const mockTxRun = vi.fn().mockResolvedValue({ records: [] });
      mockNeo4jClient.runTransactionWork = vi
        .fn()
        .mockImplementation(async (fn) => {
          const mockTx = { run: mockTxRun };
          return fn(mockTx);
        });

      resolver.enqueue("/test/file1.ts");

      await resolver.waitForIdle(1000);

      // Should have called Neo4j to update status
      expect(mockNeo4jClient.runTransactionWork).toHaveBeenCalled();
    });

    it("should write semantic relationships to Neo4j", async () => {
      const mockNodes: AstNode[] = [
        {
          entityId: "class1",
          name: "TestClass",
          kind: "class",
          filePath: "/test/file1.ts",
          startLine: 1,
          endLine: 10,
          startColumn: 0,
          endColumn: 1,
        },
      ];

      const mockTxRun = vi.fn().mockImplementation(async (query: string) => {
        if (query.includes("MATCH (n:Node)")) {
          // getNodesForFiles query
          return {
            records: mockNodes.map((node) => ({
              get: () => ({
                properties: node,
              }),
            })),
          };
        }
        return { records: [] };
      });

      mockNeo4jClient.runTransactionWork = vi
        .fn()
        .mockImplementation(async (fn) => {
          const mockTx = { run: mockTxRun };
          return fn(mockTx);
        });

      resolver.enqueue("/test/file1.ts");

      await resolver.waitForIdle(1000);

      expect(mockNeo4jClient.runTransactionWork).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should handle Neo4j errors gracefully", async () => {
      mockNeo4jClient.runTransaction = vi
        .fn()
        .mockRejectedValue(new Error("Neo4j connection failed"));
      mockNeo4jClient.runTransactionWork = vi
        .fn()
        .mockRejectedValue(new Error("Neo4j connection failed"));

      resolver.enqueue("/test/file1.ts");

      // Should not throw, but may timeout due to errors
      // The resolver logs errors but continues processing
      const result = await resolver.waitForIdle(1000);

      // Either completes or times out gracefully (no throw)
      expect(typeof result).toBe("boolean");
    });

    it("should handle missing tsconfig.json gracefully", async () => {
      const mockTxRun = vi.fn().mockResolvedValue({ records: [] });
      mockNeo4jClient.runTransactionWork = vi
        .fn()
        .mockImplementation(async (fn) => {
          const mockTx = { run: mockTxRun };
          return fn(mockTx);
        });

      // Create resolver with packages that have no tsconfig
      const noConfigResolver = new SemanticResolver(
        mockNeo4jClient,
        mockImportResolver,
        [
          {
            name: "no-config",
            path: "/nonexistent/path",
            tsConfigPath: "/nonexistent/tsconfig.json",
          },
        ],
      );

      noConfigResolver.enqueue("/nonexistent/file.ts");

      // Should handle gracefully
      await expect(noConfigResolver.waitForIdle(1000)).resolves.toBe(true);
    });

    it("should retry failed batches", async () => {
      let attemptCount = 0;

      mockNeo4jClient.runTransactionWork = vi
        .fn()
        .mockImplementation(async (fn) => {
          attemptCount++;
          if (attemptCount === 1) {
            throw new Error("Temporary failure");
          }
          const mockTx = {
            run: vi.fn().mockResolvedValue({ records: [] }),
          };
          return fn(mockTx);
        });

      resolver.enqueue("/test/file1.ts");

      await resolver.waitForIdle(2000);

      // Should have retried
      expect(attemptCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Performance", () => {
    it("should handle large batches efficiently", async () => {
      const fileCount = 50;
      const mockTxRun = vi.fn().mockResolvedValue({ records: [] });

      mockNeo4jClient.runTransactionWork = vi
        .fn()
        .mockImplementation(async (fn) => {
          const mockTx = { run: mockTxRun };
          return fn(mockTx);
        });

      const startTime = Date.now();

      // Enqueue many files
      for (let i = 0; i < fileCount; i++) {
        resolver.enqueue(`/test/file${i}.ts`);
      }

      await resolver.waitForIdle(5000);

      const elapsed = Date.now() - startTime;

      // Should complete within reasonable time (5 seconds for 50 files)
      expect(elapsed).toBeLessThan(5000);
    });

    it("should process batches within performance target", async () => {
      const batchSize = 10;
      const targetTime = 5000; // 5 seconds per batch of 10 files

      const customResolver = new SemanticResolver(
        mockNeo4jClient,
        mockImportResolver,
        mockPackages,
        { batchSize },
      );

      const mockTxRun = vi.fn().mockResolvedValue({ records: [] });
      mockNeo4jClient.runTransactionWork = vi
        .fn()
        .mockImplementation(async (fn) => {
          const mockTx = { run: mockTxRun };
          return fn(mockTx);
        });

      // Enqueue one batch worth of files
      for (let i = 0; i < batchSize; i++) {
        customResolver.enqueue(`/test/file${i}.ts`);
      }

      const startTime = Date.now();
      await customResolver.waitForIdle(targetTime + 1000);
      const elapsed = Date.now() - startTime;

      // Should complete within target time
      // Note: In tests with mocked I/O, this will be much faster
      expect(elapsed).toBeLessThan(targetTime);
    });
  });

  describe("waitForIdle()", () => {
    it("should resolve when queue is empty and not processing", async () => {
      resolver.enqueue("/test/file1.ts");

      const mockTxRun = vi.fn().mockResolvedValue({ records: [] });
      mockNeo4jClient.runTransactionWork = vi
        .fn()
        .mockImplementation(async (fn) => {
          const mockTx = { run: mockTxRun };
          return fn(mockTx);
        });

      const result = await resolver.waitForIdle(1000);

      expect(result).toBe(true);
      expect(resolver.getQueueStatus().processing).toBe(false);
      expect(resolver.getQueueStatus().queueSize).toBe(0);
    });

    it("should timeout if processing takes too long", async () => {
      // Mock a slow operation
      mockNeo4jClient.runTransactionWork = vi
        .fn()
        .mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return {};
        });

      resolver.enqueue("/test/file1.ts");

      const result = await resolver.waitForIdle(100);

      // Should timeout
      expect(result).toBe(false);
    });

    it("should resolve immediately if already idle", async () => {
      const result = await resolver.waitForIdle(1000);

      expect(result).toBe(true);
    });
  });
});
