import { describe, it, expect, beforeEach, vi } from "vitest";
import { LRUCache } from "./lru-cache";

describe("LRUCache", () => {
  describe("Basic Operations", () => {
    let cache: LRUCache<string>;

    beforeEach(() => {
      cache = new LRUCache<string>({
        maxSize: 3,
        ttlMs: 1000,
      });
    });

    it("should store and retrieve values", () => {
      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");
    });

    it("should return undefined for non-existent keys", () => {
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    it("should update existing keys", () => {
      cache.set("key1", "value1");
      cache.set("key1", "value2");
      expect(cache.get("key1")).toBe("value2");
      expect(cache.size()).toBe(1);
    });

    it("should check if key exists", () => {
      cache.set("key1", "value1");
      expect(cache.has("key1")).toBe(true);
      expect(cache.has("key2")).toBe(false);
    });

    it("should delete keys", () => {
      cache.set("key1", "value1");
      expect(cache.delete("key1")).toBe(true);
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.delete("key1")).toBe(false);
    });

    it("should clear all entries", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.clear();
      expect(cache.size()).toBe(0);
      expect(cache.get("key1")).toBeUndefined();
    });
  });

  describe("LRU Eviction", () => {
    it("should evict least recently used item when at capacity", () => {
      const cache = new LRUCache<number>({
        maxSize: 3,
        ttlMs: 10000,
      });

      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.set("d", 4); // Should evict 'a'

      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });

    it("should update LRU order on get", () => {
      const cache = new LRUCache<number>({
        maxSize: 3,
        ttlMs: 10000,
      });

      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // Access 'a' to make it most recently used
      cache.get("a");

      // Add new item, should evict 'b' (now least recently used)
      cache.set("d", 4);

      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });

    it("should update LRU order on set", () => {
      const cache = new LRUCache<number>({
        maxSize: 3,
        ttlMs: 10000,
      });

      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // Update 'a' to make it most recently used
      cache.set("a", 10);

      // Add new item, should evict 'b'
      cache.set("d", 4);

      expect(cache.get("a")).toBe(10);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });
  });

  describe("TTL (Time To Live)", () => {
    it("should expire entries after TTL", async () => {
      vi.useFakeTimers();

      const cache = new LRUCache<string>({
        maxSize: 10,
        ttlMs: 100,
      });

      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");

      // Advance time past TTL
      vi.advanceTimersByTime(150);

      expect(cache.get("key1")).toBeUndefined();
      expect(cache.size()).toBe(0); // Entry removed on access

      vi.useRealTimers();
    });

    it("should not expire entries before TTL", async () => {
      vi.useFakeTimers();

      const cache = new LRUCache<string>({
        maxSize: 10,
        ttlMs: 1000,
      });

      cache.set("key1", "value1");

      // Advance time but not past TTL
      vi.advanceTimersByTime(500);

      expect(cache.get("key1")).toBe("value1");

      vi.useRealTimers();
    });

    it("should handle mixed expired and non-expired entries", async () => {
      vi.useFakeTimers();

      const cache = new LRUCache<string>({
        maxSize: 10,
        ttlMs: 1000,
      });

      cache.set("key1", "value1");

      vi.advanceTimersByTime(500);

      cache.set("key2", "value2");

      vi.advanceTimersByTime(600); // key1 expired (1100ms), key2 not (600ms)

      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBe("value2");

      vi.useRealTimers();
    });
  });

  describe("Pruning", () => {
    it("should remove expired entries on prune", async () => {
      vi.useFakeTimers();

      const cache = new LRUCache<string>({
        maxSize: 10,
        ttlMs: 100,
      });

      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      vi.advanceTimersByTime(150);

      cache.set("key4", "value4"); // Not expired

      const removed = cache.prune();

      expect(removed).toBe(3);
      expect(cache.size()).toBe(1);
      expect(cache.get("key4")).toBe("value4");

      vi.useRealTimers();
    });

    it("should return 0 when no entries expired", () => {
      const cache = new LRUCache<string>({
        maxSize: 10,
        ttlMs: 10000,
      });

      cache.set("key1", "value1");
      cache.set("key2", "value2");

      const removed = cache.prune();
      expect(removed).toBe(0);
      expect(cache.size()).toBe(2);
    });
  });

  describe("Statistics", () => {
    it("should provide accurate stats", async () => {
      vi.useFakeTimers();

      const cache = new LRUCache<string>({
        maxSize: 5,
        ttlMs: 1000,
      });

      cache.set("key1", "value1");
      vi.advanceTimersByTime(100);
      cache.set("key2", "value2");

      const stats = cache.stats();

      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(5);
      expect(stats.ttlMs).toBe(1000);
      expect(stats.oldestEntryAge).toBeGreaterThanOrEqual(100);

      vi.useRealTimers();
    });

    it("should return null for oldest age when empty", () => {
      const cache = new LRUCache<string>({
        maxSize: 5,
        ttlMs: 1000,
      });

      const stats = cache.stats();
      expect(stats.oldestEntryAge).toBeNull();
    });
  });

  describe("Complex Types", () => {
    it("should handle object values", () => {
      const cache = new LRUCache<{ data: string; count: number }>({
        maxSize: 5,
        ttlMs: 1000,
      });

      const obj = { data: "test", count: 42 };
      cache.set("key1", obj);

      const retrieved = cache.get("key1");
      expect(retrieved).toEqual(obj);
      expect(retrieved?.count).toBe(42);
    });

    it("should handle array values", () => {
      const cache = new LRUCache<string[]>({
        maxSize: 5,
        ttlMs: 1000,
      });

      cache.set("key1", ["a", "b", "c"]);
      expect(cache.get("key1")).toEqual(["a", "b", "c"]);
    });
  });
});
