import { describe, expect, test, beforeEach, vi } from "vitest";
import {
  PerformanceMonitor,
  globalPerformanceMonitor,
  measurePerformance,
  snapshotMemory,
  trackLatency,
} from "./performance-monitor.js";

describe("PerformanceMonitor", () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor({
      maxSnapshots: 10,
      maxMetrics: 10,
      thresholds: {
        memoryMB: 1000, // High threshold for tests
        latencyMs: 1000,
        memoryPercentage: 90,
      },
    });
    globalPerformanceMonitor.clear();
  });

  describe("Memory Snapshots", () => {
    test("should capture memory snapshot", () => {
      const snapshot = monitor.snapshot();

      expect(snapshot.heapUsed).toBeGreaterThan(0);
      expect(snapshot.heapTotal).toBeGreaterThan(0);
      expect(snapshot.rss).toBeGreaterThan(0);
      expect(snapshot.timestamp).toBeGreaterThan(0);
    });

    test("should store multiple snapshots", () => {
      monitor.snapshot();
      monitor.snapshot();
      monitor.snapshot();

      const recent = monitor.getRecentMemory(3);
      expect(recent).toHaveLength(3);
    });

    test("should enforce max snapshots limit", () => {
      // Create 15 snapshots (max is 10)
      for (let i = 0; i < 15; i++) {
        monitor.snapshot();
      }

      const recent = monitor.getRecentMemory(100);
      expect(recent.length).toBeLessThanOrEqual(10);
    });

    test("should get current memory", () => {
      const current = monitor.getCurrentMemory();
      expect(current.heapUsed).toBeGreaterThan(0);
    });

    test("should get peak memory", () => {
      monitor.snapshot();
      monitor.snapshot();
      const peak = monitor.getPeakMemory();

      expect(peak.heapUsed).toBeGreaterThan(0);
    });

    test("should calculate average memory", () => {
      monitor.snapshot();
      monitor.snapshot();
      monitor.snapshot();

      const avg = monitor.getAverageMemory();
      expect(avg.heapUsed).toBeGreaterThan(0);
      expect(avg.heapTotal).toBeGreaterThan(0);
      expect(avg.rss).toBeGreaterThan(0);
    });
  });

  describe("Latency Tracking", () => {
    test("should track operation latency", () => {
      monitor.trackLatency("test-operation", 150);

      const stats = monitor.getLatencyStats();
      expect(stats["test-operation"]).toBeDefined();
      expect(stats["test-operation"].count).toBe(1);
      expect(stats["test-operation"].avgDuration).toBe(150);
    });

    test("should track multiple operations", () => {
      monitor.trackLatency("op1", 100);
      monitor.trackLatency("op2", 200);
      monitor.trackLatency("op1", 150);

      const stats = monitor.getLatencyStats();
      expect(stats["op1"].count).toBe(2);
      expect(stats["op1"].avgDuration).toBe(125); // (100 + 150) / 2
      expect(stats["op2"].count).toBe(1);
      expect(stats["op2"].avgDuration).toBe(200);
    });

    test("should calculate min/max durations", () => {
      monitor.trackLatency("test", 100);
      monitor.trackLatency("test", 300);
      monitor.trackLatency("test", 200);

      const stats = monitor.getLatencyStats();
      expect(stats["test"].minDuration).toBe(100);
      expect(stats["test"].maxDuration).toBe(300);
      expect(stats["test"].avgDuration).toBe(200);
    });

    test("should enforce max metrics limit", () => {
      // Create 15 metrics (max is 10)
      for (let i = 0; i < 15; i++) {
        monitor.trackLatency("test", i * 10);
      }

      const recent = monitor.getRecentLatency(100);
      expect(recent.length).toBeLessThanOrEqual(10);
    });

    test("should store operation context", () => {
      monitor.trackLatency("test", 150, { userId: 123, action: "parse" });

      const recent = monitor.getRecentLatency(1);
      expect(recent[0].context).toEqual({ userId: 123, action: "parse" });
    });
  });

  describe("Measure Function", () => {
    test("should measure async operation", async () => {
      const result = await monitor.measure("test-op", async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "success";
      });

      expect(result).toBe("success");

      const stats = monitor.getLatencyStats();
      expect(stats["test-op"]).toBeDefined();
      expect(stats["test-op"].count).toBe(1);
      expect(stats["test-op"].avgDuration).toBeGreaterThan(40); // Should be ~50ms
    });

    test("should capture memory before and after operation", async () => {
      const snapshotsBefore = monitor.getRecentMemory(100).length;

      await monitor.measure("test-op", async () => {
        return "done";
      });

      const snapshotsAfter = monitor.getRecentMemory(100).length;
      expect(snapshotsAfter).toBe(snapshotsBefore + 2); // Before and after snapshots
    });

    test("should track errors with latency", async () => {
      await expect(
        monitor.measure("failing-op", async () => {
          throw new Error("Test error");
        }),
      ).rejects.toThrow("Test error");

      const stats = monitor.getLatencyStats();
      expect(stats["failing-op-ERROR"]).toBeDefined();
    });

    test("should pass context to latency tracking", async () => {
      await monitor.measure(
        "contextual-op",
        async () => "result",
        { fileCount: 5 },
      );

      const recent = monitor.getRecentLatency(1);
      expect(recent[0].context).toEqual({ fileCount: 5 });
    });
  });

  describe("Performance Statistics", () => {
    test("should provide complete stats", () => {
      monitor.trackLatency("op1", 100);
      monitor.trackLatency("op2", 200);
      monitor.snapshot();

      const stats = monitor.getStats();

      expect(stats.memory.current).toBeDefined();
      expect(stats.memory.peak).toBeDefined();
      expect(stats.memory.average).toBeDefined();
      expect(stats.latency.operations).toBeDefined();
      expect(stats.alerts).toBeDefined();
    });

    test("should include all latency operations in stats", () => {
      monitor.trackLatency("parse", 50);
      monitor.trackLatency("resolve", 100);
      monitor.trackLatency("parse", 75);

      const stats = monitor.getStats();
      expect(stats.latency.operations["parse"].count).toBe(2);
      expect(stats.latency.operations["resolve"].count).toBe(1);
    });
  });

  describe("Alert Thresholds", () => {
    test("should track latency warnings", () => {
      const lowThresholdMonitor = new PerformanceMonitor({
        thresholds: { latencyMs: 50 },
      });

      lowThresholdMonitor.trackLatency("slow-op", 100); // Exceeds 50ms threshold

      const stats = lowThresholdMonitor.getStats();
      expect(stats.alerts.latencyWarnings).toBe(1);
    });

    test("should not warn when below threshold", () => {
      monitor.trackLatency("fast-op", 50); // Below 1000ms threshold

      const stats = monitor.getStats();
      expect(stats.alerts.latencyWarnings).toBe(0);
    });
  });

  describe("Clear Functionality", () => {
    test("should clear all metrics", () => {
      monitor.trackLatency("op1", 100);
      monitor.trackLatency("op2", 200);
      monitor.snapshot();
      monitor.snapshot();

      monitor.clear();

      const stats = monitor.getStats();
      expect(Object.keys(stats.latency.operations)).toHaveLength(0);
      expect(stats.alerts.memoryWarnings).toBe(0);
      expect(stats.alerts.latencyWarnings).toBe(0);
    });
  });

  describe("Recent Metrics", () => {
    test("should get recent memory snapshots", () => {
      for (let i = 0; i < 5; i++) {
        monitor.snapshot();
      }

      const recent = monitor.getRecentMemory(3);
      expect(recent).toHaveLength(3);
    });

    test("should get recent latency metrics", () => {
      for (let i = 0; i < 5; i++) {
        monitor.trackLatency("op", i * 10);
      }

      const recent = monitor.getRecentLatency(3);
      expect(recent).toHaveLength(3);
      expect(recent[0].duration).toBe(20); // Last 3: 20, 30, 40
    });
  });

  describe("Global Monitor", () => {
    test("should provide global instance", () => {
      expect(globalPerformanceMonitor).toBeInstanceOf(PerformanceMonitor);
    });

    test("measurePerformance should use global monitor", async () => {
      const result = await measurePerformance("global-test", async () => {
        return "success";
      });

      expect(result).toBe("success");

      const stats = globalPerformanceMonitor.getStats();
      expect(stats.latency.operations["global-test"]).toBeDefined();
    });

    test("snapshotMemory should use global monitor", () => {
      const snapshot = snapshotMemory();
      expect(snapshot.heapUsed).toBeGreaterThan(0);
    });

    test("trackLatency should use global monitor", () => {
      trackLatency("global-latency", 150);

      const stats = globalPerformanceMonitor.getStats();
      expect(stats.latency.operations["global-latency"]).toBeDefined();
    });
  });

  describe("Memory Delta Tracking", () => {
    test("should track memory changes during operation", async () => {
      const initialSnapshots = monitor.getRecentMemory(100).length;

      await monitor.measure("memory-test", async () => {
        // Allocate some memory
        const arr = new Array(10000).fill("test");
        return arr.length;
      });

      const finalSnapshots = monitor.getRecentMemory(100).length;
      expect(finalSnapshots).toBeGreaterThan(initialSnapshots);
    });
  });
});
