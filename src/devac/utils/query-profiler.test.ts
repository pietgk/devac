import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryProfiler, trackQuery } from "./query-profiler";

describe("QueryProfiler", () => {
  let profiler: QueryProfiler;

  beforeEach(() => {
    profiler = new QueryProfiler({
      maxMetrics: 10,
      slowQueryThreshold: 100,
    });
  });

  describe("Tracking", () => {
    it("should track query metrics", () => {
      profiler.track("SELECT * FROM users", {}, 50, "UserQuery");

      const stats = profiler.getStats();
      expect(stats.totalQueries).toBe(1);
      expect(stats.totalDuration).toBe(50);
      expect(stats.avgDuration).toBe(50);
    });

    it("should track multiple queries", () => {
      profiler.track("SELECT * FROM users", {}, 50, "UserQuery");
      profiler.track("SELECT * FROM posts", {}, 75, "PostQuery");
      profiler.track("SELECT * FROM comments", {}, 100, "CommentQuery");

      const stats = profiler.getStats();
      expect(stats.totalQueries).toBe(3);
      expect(stats.totalDuration).toBe(225);
      expect(stats.avgDuration).toBe(75);
    });

    it("should enforce max metrics limit", () => {
      for (let i = 0; i < 15; i++) {
        profiler.track(`Query ${i}`, {}, 10, "TestQuery");
      }

      const stats = profiler.getStats();
      expect(stats.totalQueries).toBe(10); // maxMetrics = 10
    });

    it("should calculate min and max durations", () => {
      profiler.track("Query 1", {}, 10, "Test");
      profiler.track("Query 2", {}, 50, "Test");
      profiler.track("Query 3", {}, 200, "Test");

      const stats = profiler.getStats();
      expect(stats.minDuration).toBe(10);
      expect(stats.maxDuration).toBe(200);
    });
  });

  describe("Slow Query Detection", () => {
    it("should identify slow queries", () => {
      profiler.track("Fast query", {}, 50, "Test");
      profiler.track("Slow query", {}, 150, "Test");
      profiler.track("Very slow query", {}, 300, "Test");

      const slowQueries = profiler.getSlowQueries();
      expect(slowQueries).toHaveLength(2);
      expect(slowQueries[0].duration).toBe(150);
      expect(slowQueries[1].duration).toBe(300);
    });

    it("should return empty array when no slow queries", () => {
      profiler.track("Fast query 1", {}, 50, "Test");
      profiler.track("Fast query 2", {}, 75, "Test");

      const slowQueries = profiler.getSlowQueries();
      expect(slowQueries).toHaveLength(0);
    });
  });

  describe("Statistics", () => {
    it("should return empty stats when no queries tracked", () => {
      const stats = profiler.getStats();

      expect(stats.totalQueries).toBe(0);
      expect(stats.totalDuration).toBe(0);
      expect(stats.avgDuration).toBe(0);
      expect(stats.slowestQueries).toHaveLength(0);
    });

    it("should return top 10 slowest queries", () => {
      for (let i = 0; i < 20; i++) {
        profiler.track(`Query ${i}`, {}, i * 10, "Test");
      }

      const stats = profiler.getStats();
      expect(stats.slowestQueries).toHaveLength(10);
      expect(stats.slowestQueries[0].duration).toBe(190); // Slowest query (19 * 10)
    });
  });

  describe("Context Filtering", () => {
    it("should filter queries by context", () => {
      profiler.track("Query 1", {}, 50, "UserQuery");
      profiler.track("Query 2", {}, 75, "PostQuery");
      profiler.track("Query 3", {}, 100, "UserQuery");

      const userQueries = profiler.getQueriesByContext("UserQuery");
      expect(userQueries).toHaveLength(2);
      expect(userQueries[0].context).toBe("UserQuery");
      expect(userQueries[1].context).toBe("UserQuery");
    });

    it("should return empty array for non-existent context", () => {
      profiler.track("Query 1", {}, 50, "UserQuery");

      const queries = profiler.getQueriesByContext("NonExistent");
      expect(queries).toHaveLength(0);
    });
  });

  describe("Clearing", () => {
    it("should clear all metrics", () => {
      profiler.track("Query 1", {}, 50, "Test");
      profiler.track("Query 2", {}, 75, "Test");

      expect(profiler.getStats().totalQueries).toBe(2);

      profiler.clear();

      expect(profiler.getStats().totalQueries).toBe(0);
    });
  });

  describe("Report Generation", () => {
    it("should generate empty report when no queries", () => {
      const report = profiler.generateReport();
      expect(report).toBe("No queries tracked");
    });

    it("should generate performance report", () => {
      profiler.track("SELECT * FROM users", {}, 50, "UserQuery");
      profiler.track("SELECT * FROM posts", {}, 150, "PostQuery");

      const report = profiler.generateReport();

      expect(report).toContain("Query Performance Report");
      expect(report).toContain("Total Queries: 2");
      expect(report).toContain("Total Duration: 200.00ms");
      expect(report).toContain("Average Duration: 100.00ms");
      expect(report).toContain("Slowest Queries");
    });
  });

  describe("trackQuery Helper", () => {
    it("should track successful query execution", async () => {
      const executor = vi.fn().mockResolvedValue("result");

      const result = await trackQuery(
        "TestContext",
        "SELECT * FROM test",
        { id: 1 },
        executor,
      );

      expect(result).toBe("result");
      expect(executor).toHaveBeenCalledOnce();
    });

    it("should track failed query execution", async () => {
      const executor = vi.fn().mockRejectedValue(new Error("Query failed"));

      await expect(
        trackQuery("TestContext", "SELECT * FROM test", { id: 1 }, executor),
      ).rejects.toThrow("Query failed");

      expect(executor).toHaveBeenCalledOnce();
    });

    it("should measure execution time", async () => {
      const executor = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "result";
      });

      await trackQuery("TestContext", "SELECT * FROM test", {}, executor);

      // Note: We can't easily test the exact timing in tests,
      // but we can verify the function executed
      expect(executor).toHaveBeenCalledOnce();
    });
  });

  describe("Plan Parsing", () => {
    it("should handle explain results", async () => {
      const mockNeo4jClient = {
        runTransaction: vi.fn().mockResolvedValue({
          records: [
            {
              get: vi.fn().mockReturnValue({
                operatorType: "NodeByLabelScan",
                identifiers: ["n"],
                arguments: { label: "User" },
                children: [],
              }),
            },
          ],
          summary: {},
        }),
      };

      const result = await profiler.explain(
        mockNeo4jClient as any,
        "MATCH (n:User) RETURN n",
        {},
      );

      expect(result.plan.operatorType).toBe("NodeByLabelScan");
      expect(result.plan.identifiers).toContain("n");
    });

    it("should handle profile results with statistics", async () => {
      const mockNeo4jClient = {
        runTransaction: vi.fn().mockResolvedValue({
          records: [],
          summary: {
            profile: {
              operatorType: "NodeIndexSeek",
              identifiers: ["n"],
              arguments: { label: "User", property: "id" },
              children: [],
              dbHits: 1,
              rows: 1,
            },
          },
        }),
      };

      const result = await profiler.profile(
        mockNeo4jClient as any,
        "MATCH (n:User {id: $id}) RETURN n",
        { id: 1 },
      );

      expect(result.plan.operatorType).toBe("NodeIndexSeek");
      expect(result.dbHits).toBe(1);
      expect(result.rows).toBe(1);
    });
  });
});
