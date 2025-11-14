/**
 * Batch Size Configuration
 *
 * Provides tuning presets and utilities for SemanticResolver batch processing.
 * Based on codebase size, memory constraints, and performance requirements.
 *
 * @module devac/config/batch-size-config
 */

import type { SemanticResolverConfig } from "../actors/semantic-resolver.actor.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Codebase size categories
 */
export type CodebaseSizeCategory = "small" | "medium" | "large" | "huge";

/**
 * Performance profile presets
 */
export type PerformanceProfile = "default" | "low-latency" | "high-throughput" | "ci-cd";

/**
 * Memory and performance estimates
 */
export type BatchEstimates = {
  estimatedMemoryMB: number;
  estimatedLatencySeconds: number;
  recommendedMaxConcurrency: number;
};

// ============================================================================
// Configuration Presets
// ============================================================================

/**
 * Default configuration (balanced for medium codebases)
 */
export const DEFAULT_CONFIG: SemanticResolverConfig = {
  batchSize: 10,
  maxQueueSize: 100,
  processingDelay: 100,
};

/**
 * Configuration presets by codebase size
 *
 * Based on v8 spec recommendations:
 * - Small: <100 files - Lower latency, less memory
 * - Medium: 100-1000 files - Balanced (default)
 * - Large: 1000-5000 files - Higher throughput
 * - Huge: >5000 files - Batch efficiency critical
 */
export const CODEBASE_SIZE_PRESETS: Record<CodebaseSizeCategory, SemanticResolverConfig> = {
  small: {
    batchSize: 5,
    maxQueueSize: 50,
    processingDelay: 50,
  },
  medium: {
    batchSize: 10,
    maxQueueSize: 100,
    processingDelay: 100,
  },
  large: {
    batchSize: 15,
    maxQueueSize: 200,
    processingDelay: 200,
  },
  huge: {
    batchSize: 20,
    maxQueueSize: 500,
    processingDelay: 500,
  },
};

/**
 * Performance profile presets
 *
 * - default: Balanced approach (same as medium)
 * - low-latency: Optimize for fast response times
 * - high-throughput: Optimize for batch processing efficiency
 * - ci-cd: Optimized for CI/CD pipelines (throughput over latency)
 */
export const PERFORMANCE_PRESETS: Record<PerformanceProfile, SemanticResolverConfig> = {
  default: DEFAULT_CONFIG,

  "low-latency": {
    batchSize: 5,
    maxQueueSize: 50,
    processingDelay: 50,
  },

  "high-throughput": {
    batchSize: 20,
    maxQueueSize: 300,
    processingDelay: 300,
  },

  "ci-cd": {
    batchSize: 20,
    maxQueueSize: 500,
    processingDelay: 500,
  },
};

// ============================================================================
// Configuration Utilities
// ============================================================================

/**
 * Estimate memory usage for a given configuration
 *
 * Formula from v8 spec:
 * estimated_memory_mb = 30 + (batch_size × 5) + (file_size_avg_mb × batch_size)
 *
 * @param config - Semantic resolver configuration
 * @param avgFileSizeMB - Average file size in MB (default: 0.05 = 50KB)
 * @returns Estimated memory usage in MB
 */
export function estimateMemoryUsage(
  config: SemanticResolverConfig,
  avgFileSizeMB = 0.05,
): number {
  return 30 + config.batchSize * 5 + avgFileSizeMB * config.batchSize;
}

/**
 * Estimate processing latency for a given configuration
 *
 * Formula from v8 spec:
 * estimated_time_s = dependency_discovery + (batch_size × 200ms_per_file)
 *                  = 0.5s + (batch_size × 0.2s)
 *
 * @param config - Semantic resolver configuration
 * @returns Estimated latency in seconds
 */
export function estimateLatency(config: SemanticResolverConfig): number {
  return 0.5 + config.batchSize * 0.2;
}

/**
 * Get recommended max concurrency based on batch size
 *
 * Prevents too many concurrent batches from overwhelming memory
 *
 * @param config - Semantic resolver configuration
 * @returns Recommended maximum concurrent batches
 */
export function getRecommendedConcurrency(config: SemanticResolverConfig): number {
  // Rule of thumb: maxQueue / batchSize, capped at 10
  return Math.min(10, Math.ceil(config.maxQueueSize / config.batchSize));
}

/**
 * Get complete estimates for a configuration
 *
 * @param config - Semantic resolver configuration
 * @param avgFileSizeMB - Average file size in MB
 * @returns Memory, latency, and concurrency estimates
 */
export function getConfigEstimates(
  config: SemanticResolverConfig,
  avgFileSizeMB = 0.05,
): BatchEstimates {
  return {
    estimatedMemoryMB: estimateMemoryUsage(config, avgFileSizeMB),
    estimatedLatencySeconds: estimateLatency(config),
    recommendedMaxConcurrency: getRecommendedConcurrency(config),
  };
}

/**
 * Determine codebase size category based on file count
 *
 * @param fileCount - Total number of files in codebase
 * @returns Appropriate size category
 */
export function getCodebaseSizeCategory(fileCount: number): CodebaseSizeCategory {
  if (fileCount < 100) return "small";
  if (fileCount < 1000) return "medium";
  if (fileCount < 5000) return "large";
  return "huge";
}

/**
 * Get configuration for a specific codebase size
 *
 * @param fileCount - Total number of files in codebase
 * @returns Recommended configuration for the codebase size
 */
export function getConfigForCodebaseSize(fileCount: number): SemanticResolverConfig {
  const category = getCodebaseSizeCategory(fileCount);
  return CODEBASE_SIZE_PRESETS[category];
}

/**
 * Get configuration for a specific performance profile
 *
 * @param profile - Performance profile name
 * @returns Configuration for the specified profile
 */
export function getConfigForProfile(profile: PerformanceProfile): SemanticResolverConfig {
  return PERFORMANCE_PRESETS[profile];
}

/**
 * Create custom configuration with validation
 *
 * @param config - Partial configuration (uses defaults for missing values)
 * @returns Validated configuration with defaults applied
 */
export function createConfig(
  config: Partial<SemanticResolverConfig>,
): SemanticResolverConfig {
  const result: SemanticResolverConfig = {
    batchSize: config.batchSize ?? DEFAULT_CONFIG.batchSize,
    maxQueueSize: config.maxQueueSize ?? DEFAULT_CONFIG.maxQueueSize,
    processingDelay: config.processingDelay ?? DEFAULT_CONFIG.processingDelay,
  };

  // Validation
  if (result.batchSize < 1) {
    throw new Error("batchSize must be at least 1");
  }
  if (result.maxQueueSize < result.batchSize) {
    throw new Error("maxQueueSize must be at least batchSize");
  }
  if (result.processingDelay < 0) {
    throw new Error("processingDelay must be non-negative");
  }

  return result;
}

/**
 * Print configuration summary with estimates
 *
 * @param config - Configuration to summarize
 * @param avgFileSizeMB - Average file size for estimates
 * @returns Human-readable configuration summary
 */
export function printConfigSummary(
  config: SemanticResolverConfig,
  avgFileSizeMB = 0.05,
): string {
  const estimates = getConfigEstimates(config, avgFileSizeMB);

  return `
Batch Size Configuration:
  Batch Size: ${config.batchSize} files
  Max Queue Size: ${config.maxQueueSize} files
  Processing Delay: ${config.processingDelay}ms

Estimated Performance:
  Memory Usage: ~${estimates.estimatedMemoryMB.toFixed(1)} MB per batch
  Processing Latency: ~${estimates.estimatedLatencySeconds.toFixed(1)}s per batch
  Recommended Concurrency: ${estimates.recommendedMaxConcurrency} batches
`.trim();
}
