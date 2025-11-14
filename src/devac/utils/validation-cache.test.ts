import { describe, expect, test, beforeEach, vi } from "vitest";
import { ValidationCache, globalValidationCache } from "./validation-cache.js";
import type { ValidationResult } from "../actors/script-executor.actor.js";

describe("ValidationCache", () => {
  let cache: ValidationCache;
  let sampleResult: ValidationResult;

  beforeEach(() => {
    cache = new ValidationCache({
      maxSize: 10,
      ttlMs: 60000, // 1 minute for tests
      invalidateOnAnyChange: false,
    });

    sampleResult = {
      packageName: "test-package",
      exitCode: 0,
      output: "All tests passed",
      duration: 1000,
    };

    globalValidationCache.clear();
  });

  describe("Basic Operations", () => {
    test("should initialize empty cache", () => {
      expect(cache.size()).toBe(0);
    });

    test("should set and get cached result", () => {
      const files = ["src/file1.ts", "src/file2.ts"];
      cache.set("pkg-a", sampleResult, files);

      const cached = cache.get("pkg-a", files);
      expect(cached).toEqual(sampleResult);
    });

    test("should return null for cache miss", () => {
      const files = ["src/file1.ts"];
      const cached = cache.get("pkg-a", files);
      expect(cached).toBeNull();
    });

    test("should track cache size", () => {
      cache.set("pkg-a", sampleResult, ["file1.ts"]);
      cache.set("pkg-b", sampleResult, ["file2.ts"]);
      expect(cache.size()).toBe(2);
    });

    test("should check if package is cached", () => {
      const files = ["src/file1.ts"];
      cache.set("pkg-a", sampleResult, files);

      expect(cache.has("pkg-a", files)).toBe(true);
      expect(cache.has("pkg-b", files)).toBe(false);
    });

    test("should clear all entries", () => {
      cache.set("pkg-a", sampleResult, ["file1.ts"]);
      cache.set("pkg-b", sampleResult, ["file2.ts"]);

      cache.clear();
      expect(cache.size()).toBe(0);
    });
  });

  describe("Content Hashing", () => {
    test("should return cached result for same files", () => {
      const files = ["src/a.ts", "src/b.ts"];
      cache.set("pkg-a", sampleResult, files);

      const cached = cache.get("pkg-a", files);
      expect(cached).toEqual(sampleResult);
    });

    test("should return cached result for files in different order", () => {
      const files1 = ["src/a.ts", "src/b.ts"];
      const files2 = ["src/b.ts", "src/a.ts"];

      cache.set("pkg-a", sampleResult, files1);
      const cached = cache.get("pkg-a", files2);

      expect(cached).toEqual(sampleResult);
    });

    test("should invalidate when files change", () => {
      const files1 = ["src/a.ts", "src/b.ts"];
      const files2 = ["src/a.ts", "src/c.ts"]; // Different files

      cache.set("pkg-a", sampleResult, files1);
      const cached = cache.get("pkg-a", files2);

      expect(cached).toBeNull();
    });

    test("should invalidate when file added", () => {
      const files1 = ["src/a.ts"];
      const files2 = ["src/a.ts", "src/b.ts"];

      cache.set("pkg-a", sampleResult, files1);
      const cached = cache.get("pkg-a", files2);

      expect(cached).toBeNull();
    });

    test("should invalidate when file removed", () => {
      const files1 = ["src/a.ts", "src/b.ts"];
      const files2 = ["src/a.ts"];

      cache.set("pkg-a", sampleResult, files1);
      const cached = cache.get("pkg-a", files2);

      expect(cached).toBeNull();
    });
  });

  describe("TTL Expiration", () => {
    test("should expire old entries", () => {
      const shortTTLCache = new ValidationCache({ ttlMs: 100 }); // 100ms TTL

      const files = ["src/file1.ts"];
      shortTTLCache.set("pkg-a", sampleResult, files);

      // Immediate get should work
      expect(shortTTLCache.get("pkg-a", files)).toEqual(sampleResult);

      // After TTL should return null
      return new Promise((resolve) => {
        setTimeout(() => {
          expect(shortTTLCache.get("pkg-a", files)).toBeNull();
          resolve(undefined);
        }, 150);
      });
    });

    test("should prune expired entries", () => {
      const shortTTLCache = new ValidationCache({ ttlMs: 100 });

      shortTTLCache.set("pkg-a", sampleResult, ["file1.ts"]);
      shortTTLCache.set("pkg-b", sampleResult, ["file2.ts"]);

      expect(shortTTLCache.size()).toBe(2);

      return new Promise((resolve) => {
        setTimeout(() => {
          const pruned = shortTTLCache.prune();
          expect(pruned).toBe(2);
          expect(shortTTLCache.size()).toBe(0);
          resolve(undefined);
        }, 150);
      });
    });

    test("should not prune valid entries", () => {
      cache.set("pkg-a", sampleResult, ["file1.ts"]);
      const pruned = cache.prune();
      expect(pruned).toBe(0);
      expect(cache.size()).toBe(1);
    });
  });

  describe("Cache Eviction", () => {
    test("should evict oldest entry when at capacity", () => {
      const smallCache = new ValidationCache({ maxSize: 3 });

      smallCache.set("pkg-a", sampleResult, ["file1.ts"]);
      smallCache.set("pkg-b", sampleResult, ["file2.ts"]);
      smallCache.set("pkg-c", sampleResult, ["file3.ts"]);

      // Adding 4th entry should evict oldest (pkg-a)
      smallCache.set("pkg-d", sampleResult, ["file4.ts"]);

      expect(smallCache.size()).toBe(3);
      expect(smallCache.has("pkg-a", ["file1.ts"])).toBe(false);
      expect(smallCache.has("pkg-d", ["file4.ts"])).toBe(true);
    });

    test("should not evict when updating existing entry", () => {
      const smallCache = new ValidationCache({ maxSize: 2 });

      smallCache.set("pkg-a", sampleResult, ["file1.ts"]);
      smallCache.set("pkg-b", sampleResult, ["file2.ts"]);

      // Update pkg-a (should not trigger eviction)
      smallCache.set("pkg-a", { ...sampleResult, duration: 2000 }, ["file1.ts"]);

      expect(smallCache.size()).toBe(2);
    });
  });

  describe("Manual Invalidation", () => {
    test("should invalidate specific package", () => {
      cache.set("pkg-a", sampleResult, ["file1.ts"]);
      cache.set("pkg-b", sampleResult, ["file2.ts"]);

      const invalidated = cache.invalidate("pkg-a");
      expect(invalidated).toBe(true);
      expect(cache.size()).toBe(1);
      expect(cache.has("pkg-a", ["file1.ts"])).toBe(false);
      expect(cache.has("pkg-b", ["file2.ts"])).toBe(true);
    });

    test("should return false when invalidating non-existent package", () => {
      const invalidated = cache.invalidate("non-existent");
      expect(invalidated).toBe(false);
    });

    test("should invalidate by changed files", () => {
      cache.set("pkg-a", sampleResult, ["src/shared.ts", "src/a.ts"]);
      cache.set("pkg-b", sampleResult, ["src/shared.ts", "src/b.ts"]);
      cache.set("pkg-c", sampleResult, ["src/c.ts"]);

      const invalidated = cache.invalidateByFiles(["src/shared.ts"]);

      expect(invalidated).toContain("pkg-a");
      expect(invalidated).toContain("pkg-b");
      expect(invalidated).not.toContain("pkg-c");
      expect(cache.size()).toBe(1); // Only pkg-c remains
    });

    test("should invalidate all when invalidateOnAnyChange is true", () => {
      const aggressiveCache = new ValidationCache({ invalidateOnAnyChange: true });

      aggressiveCache.set("pkg-a", sampleResult, ["file1.ts"]);
      aggressiveCache.set("pkg-b", sampleResult, ["file2.ts"]);
      aggressiveCache.set("pkg-c", sampleResult, ["file3.ts"]);

      const invalidated = aggressiveCache.invalidateByFiles(["file4.ts"]);

      expect(invalidated).toHaveLength(3);
      expect(aggressiveCache.size()).toBe(0);
    });
  });

  describe("Statistics", () => {
    test("should track cache hits", () => {
      const files = ["file1.ts"];
      cache.set("pkg-a", sampleResult, files);

      cache.get("pkg-a", files); // hit
      cache.get("pkg-a", files); // hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(0);
    });

    test("should track cache misses", () => {
      cache.get("pkg-a", ["file1.ts"]); // miss
      cache.get("pkg-b", ["file2.ts"]); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(2);
    });

    test("should calculate hit rate", () => {
      const files = ["file1.ts"];
      cache.set("pkg-a", sampleResult, files);

      cache.get("pkg-a", files); // hit
      cache.get("pkg-b", ["file2.ts"]); // miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBe(50); // 1 hit, 1 miss = 50%
    });

    test("should track entry ages", () => {
      cache.set("pkg-a", sampleResult, ["file1.ts"]);

      return new Promise((resolve) => {
        setTimeout(() => {
          const stats = cache.getStats();
          expect(stats.oldestEntryAge).toBeGreaterThan(50);
          expect(stats.newestEntryAge).toBeGreaterThan(50);
          resolve(undefined);
        }, 100);
      });
    });

    test("should handle empty cache stats", () => {
      const stats = cache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.oldestEntryAge).toBe(0);
    });
  });

  describe("Utility Methods", () => {
    test("should list cached packages", () => {
      cache.set("pkg-a", sampleResult, ["file1.ts"]);
      cache.set("pkg-b", sampleResult, ["file2.ts"]);

      const packages = cache.getCachedPackages();
      expect(packages).toContain("pkg-a");
      expect(packages).toContain("pkg-b");
      expect(packages).toHaveLength(2);
    });

    test("should get configuration", () => {
      const config = cache.getConfig();
      expect(config.maxSize).toBe(10);
      expect(config.ttlMs).toBe(60000);
      expect(config.invalidateOnAnyChange).toBe(false);
    });
  });

  describe("Global Instance", () => {
    test("should provide global cache instance", () => {
      expect(globalValidationCache).toBeInstanceOf(ValidationCache);
    });

    test("should share state across global instance", () => {
      globalValidationCache.set("pkg-a", sampleResult, ["file1.ts"]);
      expect(globalValidationCache.size()).toBe(1);
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty file list", () => {
      cache.set("pkg-a", sampleResult, []);
      const cached = cache.get("pkg-a", []);
      expect(cached).toEqual(sampleResult);
    });

    test("should handle special characters in filenames", () => {
      const files = ["src/file-with-dashes.ts", "src/file_with_underscores.ts"];
      cache.set("pkg-a", sampleResult, files);
      const cached = cache.get("pkg-a", files);
      expect(cached).toEqual(sampleResult);
    });

    test("should reset stats on clear", () => {
      cache.set("pkg-a", sampleResult, ["file1.ts"]);
      cache.get("pkg-a", ["file1.ts"]); // hit
      cache.get("pkg-b", ["file2.ts"]); // miss

      cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });
});
