/**
 * Validation Result Aggregator
 *
 * Aggregates and summarizes validation results from multiple packages.
 * Provides statistics, filtering, and reporting capabilities.
 *
 * @module devac/utils/validation-aggregator
 */

import type { ValidationResult } from "../actors/script-executor.actor.js";
import { createContextLogger } from "../../utils/logger.js";

const logger = createContextLogger("ValidationAggregator");

// ============================================================================
// Types
// ============================================================================

/**
 * Aggregated validation statistics
 */
export type ValidationStats = {
  total: number;
  passed: number;
  failed: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  slowestPackage: string | null;
  fastestPackage: string | null;
};

/**
 * Validation summary report
 */
export type ValidationSummary = {
  stats: ValidationStats;
  passedPackages: string[];
  failedPackages: string[];
  results: ValidationResult[];
  timestamp: number;
};

/**
 * Validation filter options
 */
export type ValidationFilter = {
  status?: "passed" | "failed" | "all";
  minDuration?: number;
  maxDuration?: number;
  packagePattern?: RegExp;
};

// ============================================================================
// ValidationAggregator Class
// ============================================================================

/**
 * Aggregates and analyzes validation results
 */
export class ValidationAggregator {
  private results: ValidationResult[] = [];

  constructor(results: ValidationResult[] = []) {
    this.results = results;
  }

  /**
   * Add a validation result
   */
  add(result: ValidationResult): void {
    this.results.push(result);
    logger.debug(`Added validation result for ${result.packageName}`, {
      exitCode: result.exitCode,
      duration: `${result.duration.toFixed(2)}ms`,
    });
  }

  /**
   * Add multiple validation results
   */
  addMany(results: ValidationResult[]): void {
    this.results.push(...results);
    logger.debug(`Added ${results.length} validation results`);
  }

  /**
   * Get all results
   */
  getAll(): ValidationResult[] {
    return [...this.results];
  }

  /**
   * Filter results
   */
  filter(options: ValidationFilter): ValidationResult[] {
    let filtered = this.results;

    if (options.status === "passed") {
      filtered = filtered.filter((r) => r.exitCode === 0);
    } else if (options.status === "failed") {
      filtered = filtered.filter((r) => r.exitCode !== 0);
    }

    if (options.minDuration !== undefined) {
      filtered = filtered.filter((r) => r.duration >= options.minDuration!);
    }

    if (options.maxDuration !== undefined) {
      filtered = filtered.filter((r) => r.duration <= options.maxDuration!);
    }

    if (options.packagePattern) {
      filtered = filtered.filter((r) =>
        options.packagePattern!.test(r.packageName),
      );
    }

    return filtered;
  }

  /**
   * Get validation statistics
   */
  getStats(): ValidationStats {
    if (this.results.length === 0) {
      return {
        total: 0,
        passed: 0,
        failed: 0,
        totalDuration: 0,
        avgDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        slowestPackage: null,
        fastestPackage: null,
      };
    }

    const passed = this.results.filter((r) => r.exitCode === 0);
    const failed = this.results.filter((r) => r.exitCode !== 0);
    const durations = this.results.map((r) => r.duration);
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);

    const slowest = this.results.reduce((prev, curr) =>
      curr.duration > prev.duration ? curr : prev,
    );
    const fastest = this.results.reduce((prev, curr) =>
      curr.duration < prev.duration ? curr : prev,
    );

    return {
      total: this.results.length,
      passed: passed.length,
      failed: failed.length,
      totalDuration,
      avgDuration: totalDuration / this.results.length,
      minDuration,
      maxDuration,
      slowestPackage: slowest.packageName,
      fastestPackage: fastest.packageName,
    };
  }

  /**
   * Get full validation summary
   */
  getSummary(): ValidationSummary {
    const stats = this.getStats();
    const passed = this.results
      .filter((r) => r.exitCode === 0)
      .map((r) => r.packageName);
    const failed = this.results
      .filter((r) => r.exitCode !== 0)
      .map((r) => r.packageName);

    return {
      stats,
      passedPackages: passed,
      failedPackages: failed,
      results: this.getAll(),
      timestamp: Date.now(),
    };
  }

  /**
   * Get passed results
   */
  getPassed(): ValidationResult[] {
    return this.results.filter((r) => r.exitCode === 0);
  }

  /**
   * Get failed results
   */
  getFailed(): ValidationResult[] {
    return this.results.filter((r) => r.exitCode !== 0);
  }

  /**
   * Check if all validations passed
   */
  allPassed(): boolean {
    return this.results.length > 0 && this.results.every((r) => r.exitCode === 0);
  }

  /**
   * Check if any validations failed
   */
  anyFailed(): boolean {
    return this.results.some((r) => r.exitCode !== 0);
  }

  /**
   * Get slowest N packages
   */
  getSlowest(count = 5): ValidationResult[] {
    return [...this.results].sort((a, b) => b.duration - a.duration).slice(0, count);
  }

  /**
   * Get fastest N packages
   */
  getFastest(count = 5): ValidationResult[] {
    return [...this.results].sort((a, b) => a.duration - b.duration).slice(0, count);
  }

  /**
   * Clear all results
   */
  clear(): void {
    this.results = [];
    logger.debug("Cleared all validation results");
  }

  /**
   * Generate formatted report
   */
  generateReport(): string {
    const stats = this.getStats();
    const failed = this.getFailed();

    let report = `
Validation Results Summary
=========================

Total Packages: ${stats.total}
✅ Passed: ${stats.passed}
❌ Failed: ${stats.failed}

Performance:
  Total Duration: ${(stats.totalDuration / 1000).toFixed(2)}s
  Average Duration: ${(stats.avgDuration / 1000).toFixed(2)}s
  Fastest: ${stats.fastestPackage} (${(stats.minDuration / 1000).toFixed(2)}s)
  Slowest: ${stats.slowestPackage} (${(stats.maxDuration / 1000).toFixed(2)}s)
`;

    if (failed.length > 0) {
      report += `
Failed Packages:
`;
      for (const result of failed) {
        report += `  - ${result.packageName} (exit code: ${result.exitCode})\n`;
      }
    }

    return report.trim();
  }

  /**
   * Generate JSON report
   */
  generateJSONReport(): string {
    return JSON.stringify(this.getSummary(), null, 2);
  }

  /**
   * Export results to object
   */
  toJSON(): ValidationSummary {
    return this.getSummary();
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create aggregator from Map of results
 */
export function createAggregatorFromMap(
  resultsMap: Map<string, ValidationResult>,
): ValidationAggregator {
  return new ValidationAggregator(Array.from(resultsMap.values()));
}

/**
 * Merge multiple aggregators
 */
export function mergeAggregators(
  ...aggregators: ValidationAggregator[]
): ValidationAggregator {
  const merged = new ValidationAggregator();
  for (const aggregator of aggregators) {
    merged.addMany(aggregator.getAll());
  }
  return merged;
}

/**
 * Compare two validation summaries
 */
export function compareSummaries(
  before: ValidationSummary,
  after: ValidationSummary,
): {
  newFailures: string[];
  newPasses: string[];
  stillFailing: string[];
  stillPassing: string[];
  performanceChange: number; // % change in average duration
} {
  const beforeFailed = new Set(before.failedPackages);
  const afterFailed = new Set(after.failedPackages);
  const beforePassed = new Set(before.passedPackages);
  const afterPassed = new Set(after.passedPackages);

  const newFailures = after.failedPackages.filter((pkg) => !beforeFailed.has(pkg));
  const newPasses = after.passedPackages.filter((pkg) => !beforePassed.has(pkg));
  const stillFailing = after.failedPackages.filter((pkg) => beforeFailed.has(pkg));
  const stillPassing = after.passedPackages.filter((pkg) => beforePassed.has(pkg));

  const performanceChange =
    before.stats.avgDuration > 0
      ? ((after.stats.avgDuration - before.stats.avgDuration) /
          before.stats.avgDuration) *
        100
      : 0;

  return {
    newFailures,
    newPasses,
    stillFailing,
    stillPassing,
    performanceChange,
  };
}
