/**
 * Validation Cache
 *
 * Caches validation results to avoid redundant test runs.
 * Uses content hashing and timestamp-based invalidation.
 *
 * @module devac/utils/validation-cache
 */

import { createHash } from "crypto";
import type { ValidationResult } from "../actors/script-executor.actor.js";
import { createContextLogger } from "../../utils/logger.js";

const logger = createContextLogger("ValidationCache");

// ============================================================================
// Types
// ============================================================================

/**
 * Cached validation entry
 */
export type CachedValidation = {
  result: ValidationResult;
  hash: string; // Content hash of files
  timestamp: number;
  filesChanged: string[]; // Files that triggered validation
};

/**
 * Cache configuration
 */
export type ValidationCacheConfig = {
  maxSize?: number; // Maximum cache entries (default: 100)
  ttlMs?: number; // Time to live in milliseconds (default: 3600000 = 1 hour)
  invalidateOnAnyChange?: boolean; // Invalidate if any file changes (default: false)
};

/**
 * Cache statistics
 */
export type ValidationCacheStats = {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
  oldestEntryAge: number; // milliseconds
  newestEntryAge: number; // milliseconds
};

// ============================================================================
// ValidationCache Class
// ============================================================================

/**
 * Cache for validation results
 */
export class ValidationCache {
  private cache: Map<string, CachedValidation> = new Map();
  private config: Required<ValidationCacheConfig>;
  private stats = {
    hits: 0,
    misses: 0,
  };

  constructor(config: ValidationCacheConfig = {}) {
    this.config = {
      maxSize: config.maxSize ?? 100,
      ttlMs: config.ttlMs ?? 3600000, // 1 hour default
      invalidateOnAnyChange: config.invalidateOnAnyChange ?? false,
    };
  }

  /**
   * Generate cache key for a package
   */
  private getCacheKey(packageName: string): string {
    return `pkg:${packageName}`;
  }

  /**
   * Generate content hash from file paths
   */
  private hashContent(filePaths: string[]): string {
    const sorted = [...filePaths].sort();
    const content = sorted.join("\n");
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  /**
   * Check if cache entry is valid
   */
  private isValid(entry: CachedValidation): boolean {
    const now = Date.now();
    const age = now - entry.timestamp;
    return age <= this.config.ttlMs;
  }

  /**
   * Get cached validation result
   */
  get(
    packageName: string,
    changedFiles: string[],
  ): ValidationResult | null {
    const key = this.getCacheKey(packageName);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      logger.debug(`Cache miss for ${packageName}`);
      return null;
    }

    // Check TTL
    if (!this.isValid(entry)) {
      this.cache.delete(key);
      this.stats.misses++;
      logger.debug(`Cache expired for ${packageName}`);
      return null;
    }

    // Check content hash
    const currentHash = this.hashContent(changedFiles);
    if (entry.hash !== currentHash) {
      this.cache.delete(key);
      this.stats.misses++;
      logger.debug(`Cache invalidated for ${packageName} (content changed)`);
      return null;
    }

    this.stats.hits++;
    logger.debug(`Cache hit for ${packageName}`);
    return entry.result;
  }

  /**
   * Set validation result in cache
   */
  set(
    packageName: string,
    result: ValidationResult,
    changedFiles: string[],
  ): void {
    const key = this.getCacheKey(packageName);
    const hash = this.hashContent(changedFiles);

    const entry: CachedValidation = {
      result,
      hash,
      timestamp: Date.now(),
      filesChanged: changedFiles,
    };

    // Evict oldest if at capacity
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      const oldest = this.getOldest();
      if (oldest) {
        this.cache.delete(oldest);
        logger.debug(`Evicted oldest entry: ${oldest}`);
      }
    }

    this.cache.set(key, entry);
    logger.debug(`Cached validation for ${packageName}`, {
      hash: hash.slice(0, 8),
      filesCount: changedFiles.length,
    });
  }

  /**
   * Invalidate cache for a specific package
   */
  invalidate(packageName: string): boolean {
    const key = this.getCacheKey(packageName);
    const deleted = this.cache.delete(key);
    if (deleted) {
      logger.debug(`Invalidated cache for ${packageName}`);
    }
    return deleted;
  }

  /**
   * Invalidate all packages that depend on changed files
   */
  invalidateByFiles(changedFiles: string[]): string[] {
    const invalidated: string[] = [];

    if (this.config.invalidateOnAnyChange) {
      // Invalidate all entries if any file changes
      const packages = Array.from(this.cache.keys());
      this.cache.clear();
      logger.info(`Invalidated all ${packages.length} cache entries (any change policy)`);
      return packages.map((key) => key.replace("pkg:", ""));
    }

    // Invalidate only entries that reference changed files
    for (const [key, entry] of this.cache.entries()) {
      const hasChangedFile = entry.filesChanged.some((file) =>
        changedFiles.includes(file),
      );
      if (hasChangedFile) {
        this.cache.delete(key);
        invalidated.push(key.replace("pkg:", ""));
      }
    }

    if (invalidated.length > 0) {
      logger.info(`Invalidated ${invalidated.length} cache entries due to file changes`);
    }

    return invalidated;
  }

  /**
   * Check if package has cached result
   */
  has(packageName: string, changedFiles: string[]): boolean {
    return this.get(packageName, changedFiles) !== null;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
    logger.debug(`Cleared ${size} cache entries`);
  }

  /**
   * Prune expired entries
   */
  prune(): number {
    let pruned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (!this.isValid(entry)) {
        this.cache.delete(key);
        pruned++;
      }
    }

    if (pruned > 0) {
      logger.debug(`Pruned ${pruned} expired cache entries`);
    }

    return pruned;
  }

  /**
   * Get oldest cache entry key
   */
  private getOldest(): string | null {
    let oldest: [string, CachedValidation] | null = null;

    for (const entry of this.cache.entries()) {
      if (!oldest || entry[1].timestamp < oldest[1].timestamp) {
        oldest = entry;
      }
    }

    return oldest ? oldest[0] : null;
  }

  /**
   * Get cache statistics
   */
  getStats(): ValidationCacheStats {
    const now = Date.now();
    const entries = Array.from(this.cache.values());

    let oldestAge = 0;
    let newestAge = Infinity;

    for (const entry of entries) {
      const age = now - entry.timestamp;
      oldestAge = Math.max(oldestAge, age);
      newestAge = Math.min(newestAge, age);
    }

    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;

    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate,
      oldestEntryAge: entries.length > 0 ? oldestAge : 0,
      newestEntryAge: entries.length > 0 ? newestAge : 0,
    };
  }

  /**
   * Get all cached packages
   */
  getCachedPackages(): string[] {
    return Array.from(this.cache.keys()).map((key) => key.replace("pkg:", ""));
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get cache configuration
   */
  getConfig(): Required<ValidationCacheConfig> {
    return { ...this.config };
  }
}

// ============================================================================
// Global Instance
// ============================================================================

/**
 * Global validation cache instance
 */
export const globalValidationCache = new ValidationCache({
  maxSize: 100,
  ttlMs: 3600000, // 1 hour
  invalidateOnAnyChange: false,
});
