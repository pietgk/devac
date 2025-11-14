import { describe, expect, test } from "vitest";
import {
  DEFAULT_CONFIG,
  CODEBASE_SIZE_PRESETS,
  PERFORMANCE_PRESETS,
  estimateMemoryUsage,
  estimateLatency,
  getRecommendedConcurrency,
  getConfigEstimates,
  getCodebaseSizeCategory,
  getConfigForCodebaseSize,
  getConfigForProfile,
  createConfig,
  printConfigSummary,
} from "./batch-size-config.js";

describe("Batch Size Configuration", () => {
  describe("Default Configuration", () => {
    test("should have sensible defaults", () => {
      expect(DEFAULT_CONFIG.batchSize).toBe(10);
      expect(DEFAULT_CONFIG.maxQueueSize).toBe(100);
      expect(DEFAULT_CONFIG.processingDelay).toBe(100);
    });
  });

  describe("Codebase Size Presets", () => {
    test("should provide small codebase preset", () => {
      const config = CODEBASE_SIZE_PRESETS.small;
      expect(config.batchSize).toBe(5);
      expect(config.maxQueueSize).toBe(50);
      expect(config.processingDelay).toBe(50);
    });

    test("should provide medium codebase preset", () => {
      const config = CODEBASE_SIZE_PRESETS.medium;
      expect(config.batchSize).toBe(10);
      expect(config.maxQueueSize).toBe(100);
      expect(config.processingDelay).toBe(100);
    });

    test("should provide large codebase preset", () => {
      const config = CODEBASE_SIZE_PRESETS.large;
      expect(config.batchSize).toBe(15);
      expect(config.maxQueueSize).toBe(200);
      expect(config.processingDelay).toBe(200);
    });

    test("should provide huge codebase preset", () => {
      const config = CODEBASE_SIZE_PRESETS.huge;
      expect(config.batchSize).toBe(20);
      expect(config.maxQueueSize).toBe(500);
      expect(config.processingDelay).toBe(500);
    });

    test("should scale batch sizes progressively", () => {
      const sizes = Object.values(CODEBASE_SIZE_PRESETS).map((c) => c.batchSize);
      for (let i = 1; i < sizes.length; i++) {
        expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
      }
    });
  });

  describe("Performance Presets", () => {
    test("should provide default preset", () => {
      const config = PERFORMANCE_PRESETS.default;
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    test("should provide low-latency preset", () => {
      const config = PERFORMANCE_PRESETS["low-latency"];
      expect(config.batchSize).toBe(5);
      expect(config.processingDelay).toBe(50);
    });

    test("should provide high-throughput preset", () => {
      const config = PERFORMANCE_PRESETS["high-throughput"];
      expect(config.batchSize).toBe(20);
      expect(config.processingDelay).toBe(300);
    });

    test("should provide CI/CD preset", () => {
      const config = PERFORMANCE_PRESETS["ci-cd"];
      expect(config.batchSize).toBe(20);
      expect(config.maxQueueSize).toBe(500);
    });
  });

  describe("Memory Estimation", () => {
    test("should estimate memory for default config", () => {
      const memory = estimateMemoryUsage(DEFAULT_CONFIG);
      // 30 + (10 × 5) + (0.05 × 10) = 30 + 50 + 0.5 = 80.5 MB
      expect(memory).toBeCloseTo(80.5, 1);
    });

    test("should estimate memory for small batch", () => {
      const config = { batchSize: 5, maxQueueSize: 50, processingDelay: 50 };
      const memory = estimateMemoryUsage(config);
      // 30 + (5 × 5) + (0.05 × 5) = 30 + 25 + 0.25 = 55.25 MB
      expect(memory).toBeCloseTo(55.25, 1);
    });

    test("should estimate memory for large batch", () => {
      const config = { batchSize: 20, maxQueueSize: 200, processingDelay: 200 };
      const memory = estimateMemoryUsage(config);
      // 30 + (20 × 5) + (0.05 × 20) = 30 + 100 + 1 = 131 MB
      expect(memory).toBeCloseTo(131, 1);
    });

    test("should account for larger file sizes", () => {
      const config = { batchSize: 10, maxQueueSize: 100, processingDelay: 100 };
      const memory = estimateMemoryUsage(config, 0.1); // 100KB files
      // 30 + (10 × 5) + (0.1 × 10) = 30 + 50 + 1 = 81 MB
      expect(memory).toBeCloseTo(81, 1);
    });
  });

  describe("Latency Estimation", () => {
    test("should estimate latency for default config", () => {
      const latency = estimateLatency(DEFAULT_CONFIG);
      // 0.5 + (10 × 0.2) = 0.5 + 2 = 2.5s
      expect(latency).toBeCloseTo(2.5, 1);
    });

    test("should estimate latency for small batch", () => {
      const config = { batchSize: 5, maxQueueSize: 50, processingDelay: 50 };
      const latency = estimateLatency(config);
      // 0.5 + (5 × 0.2) = 0.5 + 1 = 1.5s
      expect(latency).toBeCloseTo(1.5, 1);
    });

    test("should estimate latency for large batch", () => {
      const config = { batchSize: 20, maxQueueSize: 200, processingDelay: 200 };
      const latency = estimateLatency(config);
      // 0.5 + (20 × 0.2) = 0.5 + 4 = 4.5s
      expect(latency).toBeCloseTo(4.5, 1);
    });
  });

  describe("Concurrency Recommendation", () => {
    test("should recommend concurrency for default config", () => {
      const concurrency = getRecommendedConcurrency(DEFAULT_CONFIG);
      // 100 / 10 = 10 (capped at 10)
      expect(concurrency).toBe(10);
    });

    test("should recommend concurrency for small queue", () => {
      const config = { batchSize: 10, maxQueueSize: 30, processingDelay: 100 };
      const concurrency = getRecommendedConcurrency(config);
      // 30 / 10 = 3
      expect(concurrency).toBe(3);
    });

    test("should cap concurrency at 10", () => {
      const config = { batchSize: 5, maxQueueSize: 500, processingDelay: 100 };
      const concurrency = getRecommendedConcurrency(config);
      // 500 / 5 = 100, but capped at 10
      expect(concurrency).toBe(10);
    });
  });

  describe("Complete Estimates", () => {
    test("should provide all estimates for a configuration", () => {
      const estimates = getConfigEstimates(DEFAULT_CONFIG);

      expect(estimates.estimatedMemoryMB).toBeCloseTo(80.5, 1);
      expect(estimates.estimatedLatencySeconds).toBeCloseTo(2.5, 1);
      expect(estimates.recommendedMaxConcurrency).toBe(10);
    });

    test("should handle custom file sizes", () => {
      const estimates = getConfigEstimates(DEFAULT_CONFIG, 0.2);

      // Memory: 30 + (10 × 5) + (0.2 × 10) = 30 + 50 + 2 = 82 MB
      expect(estimates.estimatedMemoryMB).toBeCloseTo(82, 1);
    });
  });

  describe("Codebase Size Category", () => {
    test("should categorize small codebase", () => {
      expect(getCodebaseSizeCategory(50)).toBe("small");
      expect(getCodebaseSizeCategory(99)).toBe("small");
    });

    test("should categorize medium codebase", () => {
      expect(getCodebaseSizeCategory(100)).toBe("medium");
      expect(getCodebaseSizeCategory(500)).toBe("medium");
      expect(getCodebaseSizeCategory(999)).toBe("medium");
    });

    test("should categorize large codebase", () => {
      expect(getCodebaseSizeCategory(1000)).toBe("large");
      expect(getCodebaseSizeCategory(3000)).toBe("large");
      expect(getCodebaseSizeCategory(4999)).toBe("large");
    });

    test("should categorize huge codebase", () => {
      expect(getCodebaseSizeCategory(5000)).toBe("huge");
      expect(getCodebaseSizeCategory(10000)).toBe("huge");
    });
  });

  describe("Config for Codebase Size", () => {
    test("should get config for small codebase", () => {
      const config = getConfigForCodebaseSize(50);
      expect(config.batchSize).toBe(5);
    });

    test("should get config for medium codebase", () => {
      const config = getConfigForCodebaseSize(500);
      expect(config.batchSize).toBe(10);
    });

    test("should get config for large codebase", () => {
      const config = getConfigForCodebaseSize(3000);
      expect(config.batchSize).toBe(15);
    });

    test("should get config for huge codebase", () => {
      const config = getConfigForCodebaseSize(10000);
      expect(config.batchSize).toBe(20);
    });
  });

  describe("Config for Profile", () => {
    test("should get default profile config", () => {
      const config = getConfigForProfile("default");
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    test("should get low-latency profile config", () => {
      const config = getConfigForProfile("low-latency");
      expect(config.batchSize).toBe(5);
    });

    test("should get high-throughput profile config", () => {
      const config = getConfigForProfile("high-throughput");
      expect(config.batchSize).toBe(20);
    });

    test("should get CI/CD profile config", () => {
      const config = getConfigForProfile("ci-cd");
      expect(config.maxQueueSize).toBe(500);
    });
  });

  describe("Custom Config Creation", () => {
    test("should create config with defaults", () => {
      const config = createConfig({});
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    test("should create config with partial overrides", () => {
      const config = createConfig({ batchSize: 15 });
      expect(config.batchSize).toBe(15);
      expect(config.maxQueueSize).toBe(DEFAULT_CONFIG.maxQueueSize);
      expect(config.processingDelay).toBe(DEFAULT_CONFIG.processingDelay);
    });

    test("should create config with all overrides", () => {
      const config = createConfig({
        batchSize: 25,
        maxQueueSize: 300,
        processingDelay: 250,
      });
      expect(config.batchSize).toBe(25);
      expect(config.maxQueueSize).toBe(300);
      expect(config.processingDelay).toBe(250);
    });

    test("should validate batchSize minimum", () => {
      expect(() => createConfig({ batchSize: 0 })).toThrow("batchSize must be at least 1");
      expect(() => createConfig({ batchSize: -5 })).toThrow("batchSize must be at least 1");
    });

    test("should validate maxQueueSize vs batchSize", () => {
      expect(() =>
        createConfig({ batchSize: 20, maxQueueSize: 10 }),
      ).toThrow("maxQueueSize must be at least batchSize");
    });

    test("should validate processingDelay minimum", () => {
      expect(() => createConfig({ processingDelay: -100 })).toThrow(
        "processingDelay must be non-negative",
      );
    });
  });

  describe("Config Summary", () => {
    test("should print readable summary", () => {
      const summary = printConfigSummary(DEFAULT_CONFIG);

      expect(summary).toContain("Batch Size: 10 files");
      expect(summary).toContain("Max Queue Size: 100 files");
      expect(summary).toContain("Processing Delay: 100ms");
      expect(summary).toContain("Memory Usage");
      expect(summary).toContain("Processing Latency");
      expect(summary).toContain("Recommended Concurrency");
    });

    test("should include estimates in summary", () => {
      const summary = printConfigSummary(DEFAULT_CONFIG);

      expect(summary).toContain("~80.5 MB");
      expect(summary).toContain("~2.5s");
      expect(summary).toContain("10 batches");
    });

    test("should handle custom file sizes in summary", () => {
      const summary = printConfigSummary(DEFAULT_CONFIG, 0.1);

      expect(summary).toContain("~81.0 MB"); // Slightly higher due to larger files
    });
  });
});
