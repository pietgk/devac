import { describe, expect, test, beforeEach } from "vitest";
import {
  ValidationAggregator,
  createAggregatorFromMap,
  mergeAggregators,
  compareSummaries,
} from "./validation-aggregator.js";
import type { ValidationResult } from "../actors/script-executor.actor.js";

describe("ValidationAggregator", () => {
  let aggregator: ValidationAggregator;
  let sampleResults: ValidationResult[];

  beforeEach(() => {
    sampleResults = [
      { packageName: "pkg-a", exitCode: 0, output: "Success", duration: 1000 },
      { packageName: "pkg-b", exitCode: 1, output: "Failed", duration: 2000 },
      { packageName: "pkg-c", exitCode: 0, output: "Success", duration: 1500 },
      { packageName: "pkg-d", exitCode: 2, output: "Error", duration: 3000 },
      { packageName: "pkg-e", exitCode: 0, output: "Success", duration: 500 },
    ];
    aggregator = new ValidationAggregator(sampleResults);
  });

  describe("Basic Operations", () => {
    test("should initialize with empty results", () => {
      const empty = new ValidationAggregator();
      expect(empty.getAll()).toHaveLength(0);
    });

    test("should initialize with provided results", () => {
      expect(aggregator.getAll()).toHaveLength(5);
    });

    test("should add single result", () => {
      const newAgg = new ValidationAggregator();
      newAgg.add(sampleResults[0]);
      expect(newAgg.getAll()).toHaveLength(1);
    });

    test("should add multiple results", () => {
      const newAgg = new ValidationAggregator();
      newAgg.addMany(sampleResults);
      expect(newAgg.getAll()).toHaveLength(5);
    });

    test("should clear all results", () => {
      aggregator.clear();
      expect(aggregator.getAll()).toHaveLength(0);
    });
  });

  describe("Statistics", () => {
    test("should calculate total count", () => {
      const stats = aggregator.getStats();
      expect(stats.total).toBe(5);
    });

    test("should count passed validations", () => {
      const stats = aggregator.getStats();
      expect(stats.passed).toBe(3); // pkg-a, pkg-c, pkg-e
    });

    test("should count failed validations", () => {
      const stats = aggregator.getStats();
      expect(stats.failed).toBe(2); // pkg-b, pkg-d
    });

    test("should calculate total duration", () => {
      const stats = aggregator.getStats();
      expect(stats.totalDuration).toBe(8000); // 1000 + 2000 + 1500 + 3000 + 500
    });

    test("should calculate average duration", () => {
      const stats = aggregator.getStats();
      expect(stats.avgDuration).toBe(1600); // 8000 / 5
    });

    test("should find min duration", () => {
      const stats = aggregator.getStats();
      expect(stats.minDuration).toBe(500);
    });

    test("should find max duration", () => {
      const stats = aggregator.getStats();
      expect(stats.maxDuration).toBe(3000);
    });

    test("should identify slowest package", () => {
      const stats = aggregator.getStats();
      expect(stats.slowestPackage).toBe("pkg-d");
    });

    test("should identify fastest package", () => {
      const stats = aggregator.getStats();
      expect(stats.fastestPackage).toBe("pkg-e");
    });

    test("should handle empty results", () => {
      const empty = new ValidationAggregator();
      const stats = empty.getStats();
      expect(stats.total).toBe(0);
      expect(stats.passed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.slowestPackage).toBeNull();
      expect(stats.fastestPackage).toBeNull();
    });
  });

  describe("Filtering", () => {
    test("should filter passed results", () => {
      const passed = aggregator.filter({ status: "passed" });
      expect(passed).toHaveLength(3);
      expect(passed.every((r) => r.exitCode === 0)).toBe(true);
    });

    test("should filter failed results", () => {
      const failed = aggregator.filter({ status: "failed" });
      expect(failed).toHaveLength(2);
      expect(failed.every((r) => r.exitCode !== 0)).toBe(true);
    });

    test("should filter by minimum duration", () => {
      const slow = aggregator.filter({ minDuration: 2000 });
      expect(slow).toHaveLength(2); // pkg-b (2000), pkg-d (3000)
    });

    test("should filter by maximum duration", () => {
      const fast = aggregator.filter({ maxDuration: 1500 });
      expect(fast).toHaveLength(3); // pkg-a (1000), pkg-c (1500), pkg-e (500)
    });

    test("should filter by package pattern", () => {
      const filtered = aggregator.filter({ packagePattern: /pkg-[ab]/ });
      expect(filtered).toHaveLength(2); // pkg-a, pkg-b
    });

    test("should combine multiple filters", () => {
      const filtered = aggregator.filter({
        status: "passed",
        minDuration: 1000,
      });
      expect(filtered).toHaveLength(2); // pkg-a (1000), pkg-c (1500)
    });
  });

  describe("Summary", () => {
    test("should generate complete summary", () => {
      const summary = aggregator.getSummary();
      expect(summary.stats.total).toBe(5);
      expect(summary.passedPackages).toHaveLength(3);
      expect(summary.failedPackages).toHaveLength(2);
      expect(summary.results).toHaveLength(5);
      expect(summary.timestamp).toBeGreaterThan(0);
    });

    test("should include passed packages", () => {
      const summary = aggregator.getSummary();
      expect(summary.passedPackages).toContain("pkg-a");
      expect(summary.passedPackages).toContain("pkg-c");
      expect(summary.passedPackages).toContain("pkg-e");
    });

    test("should include failed packages", () => {
      const summary = aggregator.getSummary();
      expect(summary.failedPackages).toContain("pkg-b");
      expect(summary.failedPackages).toContain("pkg-d");
    });
  });

  describe("Convenience Methods", () => {
    test("should get passed results", () => {
      const passed = aggregator.getPassed();
      expect(passed).toHaveLength(3);
      expect(passed.map((r) => r.packageName)).toEqual(["pkg-a", "pkg-c", "pkg-e"]);
    });

    test("should get failed results", () => {
      const failed = aggregator.getFailed();
      expect(failed).toHaveLength(2);
      expect(failed.map((r) => r.packageName)).toEqual(["pkg-b", "pkg-d"]);
    });

    test("should check if all passed", () => {
      expect(aggregator.allPassed()).toBe(false);

      const allPass = new ValidationAggregator([
        { packageName: "pkg-a", exitCode: 0, output: "", duration: 1000 },
        { packageName: "pkg-b", exitCode: 0, output: "", duration: 1000 },
      ]);
      expect(allPass.allPassed()).toBe(true);
    });

    test("should check if any failed", () => {
      expect(aggregator.anyFailed()).toBe(true);

      const allPass = new ValidationAggregator([
        { packageName: "pkg-a", exitCode: 0, output: "", duration: 1000 },
      ]);
      expect(allPass.anyFailed()).toBe(false);
    });

    test("should get slowest packages", () => {
      const slowest = aggregator.getSlowest(3);
      expect(slowest).toHaveLength(3);
      expect(slowest[0].packageName).toBe("pkg-d"); // 3000ms
      expect(slowest[1].packageName).toBe("pkg-b"); // 2000ms
      expect(slowest[2].packageName).toBe("pkg-c"); // 1500ms
    });

    test("should get fastest packages", () => {
      const fastest = aggregator.getFastest(3);
      expect(fastest).toHaveLength(3);
      expect(fastest[0].packageName).toBe("pkg-e"); // 500ms
      expect(fastest[1].packageName).toBe("pkg-a"); // 1000ms
      expect(fastest[2].packageName).toBe("pkg-c"); // 1500ms
    });
  });

  describe("Reports", () => {
    test("should generate formatted report", () => {
      const report = aggregator.generateReport();
      expect(report).toContain("Total Packages: 5");
      expect(report).toContain("Passed: 3");
      expect(report).toContain("Failed: 2");
      expect(report).toContain("pkg-d");
      expect(report).toContain("pkg-e");
    });

    test("should generate JSON report", () => {
      const json = aggregator.generateJSONReport();
      const parsed = JSON.parse(json);
      expect(parsed.stats.total).toBe(5);
      expect(parsed.passedPackages).toHaveLength(3);
      expect(parsed.failedPackages).toHaveLength(2);
    });

    test("should export to JSON", () => {
      const json = aggregator.toJSON();
      expect(json.stats.total).toBe(5);
      expect(json.passedPackages).toHaveLength(3);
    });
  });

  describe("Utility Functions", () => {
    test("should create aggregator from Map", () => {
      const map = new Map<string, ValidationResult>([
        ["pkg-a", sampleResults[0]],
        ["pkg-b", sampleResults[1]],
      ]);
      const agg = createAggregatorFromMap(map);
      expect(agg.getAll()).toHaveLength(2);
    });

    test("should merge multiple aggregators", () => {
      const agg1 = new ValidationAggregator([sampleResults[0], sampleResults[1]]);
      const agg2 = new ValidationAggregator([sampleResults[2], sampleResults[3]]);
      const merged = mergeAggregators(agg1, agg2);
      expect(merged.getAll()).toHaveLength(4);
    });

    test("should compare summaries", () => {
      const before = new ValidationAggregator([
        { packageName: "pkg-a", exitCode: 0, output: "", duration: 1000 },
        { packageName: "pkg-b", exitCode: 1, output: "", duration: 2000 },
      ]);

      const after = new ValidationAggregator([
        { packageName: "pkg-a", exitCode: 1, output: "", duration: 1200 },
        { packageName: "pkg-b", exitCode: 0, output: "", duration: 1800 },
      ]);

      const comparison = compareSummaries(before.getSummary(), after.getSummary());
      expect(comparison.newFailures).toContain("pkg-a");
      expect(comparison.newPasses).toContain("pkg-b");
    });

    test("should calculate performance change", () => {
      const before = new ValidationAggregator([
        { packageName: "pkg-a", exitCode: 0, output: "", duration: 1000 },
        { packageName: "pkg-b", exitCode: 0, output: "", duration: 1000 },
      ]);

      const after = new ValidationAggregator([
        { packageName: "pkg-a", exitCode: 0, output: "", duration: 1200 },
        { packageName: "pkg-b", exitCode: 0, output: "", duration: 1200 },
      ]);

      const comparison = compareSummaries(before.getSummary(), after.getSummary());
      expect(comparison.performanceChange).toBeCloseTo(20, 1); // 20% slower
    });
  });
});
