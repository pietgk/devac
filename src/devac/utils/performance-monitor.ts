/**
 * Performance Monitor
 *
 * Tracks memory usage and latency metrics for DevAC actors.
 * Provides real-time monitoring and alerting capabilities.
 *
 * @module devac/utils/performance-monitor
 */

import { performance } from "perf_hooks";
import { createContextLogger } from "../../utils/logger.js";

const logger = createContextLogger("PerformanceMonitor");

// ============================================================================
// Types
// ============================================================================

/**
 * Memory snapshot
 */
export type MemorySnapshot = {
  heapUsed: number; // MB
  heapTotal: number; // MB
  external: number; // MB
  rss: number; // MB (Resident Set Size)
  timestamp: number;
};

/**
 * Latency metrics for an operation
 */
export type LatencyMetrics = {
  operation: string;
  duration: number; // milliseconds
  timestamp: number;
  context?: Record<string, unknown>;
};

/**
 * Performance statistics
 */
export type PerformanceStats = {
  memory: {
    current: MemorySnapshot;
    peak: MemorySnapshot;
    average: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
  };
  latency: {
    operations: Record<string, {
      count: number;
      totalDuration: number;
      avgDuration: number;
      minDuration: number;
      maxDuration: number;
    }>;
  };
  alerts: {
    memoryWarnings: number;
    latencyWarnings: number;
  };
};

/**
 * Alert thresholds
 */
export type AlertThresholds = {
  memoryMB?: number; // Alert when heap used exceeds this (default: 400MB)
  latencyMs?: number; // Alert when operation exceeds this (default: 5000ms)
  memoryPercentage?: number; // Alert when heap used exceeds % of total (default: 80%)
};

// ============================================================================
// PerformanceMonitor Class
// ============================================================================

/**
 * Performance monitoring for memory and latency tracking
 */
export class PerformanceMonitor {
  private memorySnapshots: MemorySnapshot[] = [];
  private latencyMetrics: LatencyMetrics[] = [];
  private maxSnapshots: number;
  private maxMetrics: number;
  private thresholds: Required<AlertThresholds>;
  private alertCounts = {
    memory: 0,
    latency: 0,
  };

  constructor(options: {
    maxSnapshots?: number;
    maxMetrics?: number;
    thresholds?: AlertThresholds;
  } = {}) {
    this.maxSnapshots = options.maxSnapshots ?? 1000;
    this.maxMetrics = options.maxMetrics ?? 1000;
    this.thresholds = {
      memoryMB: options.thresholds?.memoryMB ?? 400,
      latencyMs: options.thresholds?.latencyMs ?? 5000,
      memoryPercentage: options.thresholds?.memoryPercentage ?? 80,
    };
  }

  /**
   * Take a memory snapshot
   */
  snapshot(): MemorySnapshot {
    const mem = process.memoryUsage();
    const snapshot: MemorySnapshot = {
      heapUsed: mem.heapUsed / 1024 / 1024,
      heapTotal: mem.heapTotal / 1024 / 1024,
      external: mem.external / 1024 / 1024,
      rss: mem.rss / 1024 / 1024,
      timestamp: Date.now(),
    };

    this.memorySnapshots.push(snapshot);

    // Enforce max snapshots
    if (this.memorySnapshots.length > this.maxSnapshots) {
      this.memorySnapshots.shift();
    }

    // Check memory thresholds
    this.checkMemoryThresholds(snapshot);

    return snapshot;
  }

  /**
   * Track operation latency
   */
  trackLatency(
    operation: string,
    duration: number,
    context?: Record<string, unknown>,
  ): void {
    const metric: LatencyMetrics = {
      operation,
      duration,
      timestamp: Date.now(),
      context,
    };

    this.latencyMetrics.push(metric);

    // Enforce max metrics
    if (this.latencyMetrics.length > this.maxMetrics) {
      this.latencyMetrics.shift();
    }

    // Check latency threshold
    this.checkLatencyThreshold(metric);
  }

  /**
   * Measure and track an async operation
   */
  async measure<T>(
    operation: string,
    fn: () => Promise<T>,
    context?: Record<string, unknown>,
  ): Promise<T> {
    const startTime = performance.now();
    const startSnapshot = this.snapshot();

    try {
      const result = await fn();
      const duration = performance.now() - startTime;

      this.trackLatency(operation, duration, context);
      this.snapshot(); // Track memory after operation

      logger.debug(`Operation completed: ${operation}`, {
        duration: `${duration.toFixed(2)}ms`,
        memoryDelta: `${(this.memorySnapshots[this.memorySnapshots.length - 1].heapUsed - startSnapshot.heapUsed).toFixed(2)}MB`,
      });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      this.trackLatency(`${operation}-ERROR`, duration, context);
      this.snapshot();
      throw error;
    }
  }

  /**
   * Get current memory snapshot
   */
  getCurrentMemory(): MemorySnapshot {
    return this.snapshot();
  }

  /**
   * Get peak memory usage
   */
  getPeakMemory(): MemorySnapshot {
    if (this.memorySnapshots.length === 0) {
      return this.snapshot();
    }

    return this.memorySnapshots.reduce((peak, current) =>
      current.heapUsed > peak.heapUsed ? current : peak,
    );
  }

  /**
   * Get average memory usage
   */
  getAverageMemory(): { heapUsed: number; heapTotal: number; rss: number } {
    if (this.memorySnapshots.length === 0) {
      const current = this.snapshot();
      return {
        heapUsed: current.heapUsed,
        heapTotal: current.heapTotal,
        rss: current.rss,
      };
    }

    const sum = this.memorySnapshots.reduce(
      (acc, snapshot) => ({
        heapUsed: acc.heapUsed + snapshot.heapUsed,
        heapTotal: acc.heapTotal + snapshot.heapTotal,
        rss: acc.rss + snapshot.rss,
      }),
      { heapUsed: 0, heapTotal: 0, rss: 0 },
    );

    const count = this.memorySnapshots.length;
    return {
      heapUsed: sum.heapUsed / count,
      heapTotal: sum.heapTotal / count,
      rss: sum.rss / count,
    };
  }

  /**
   * Get latency statistics for all operations
   */
  getLatencyStats(): Record<string, {
    count: number;
    totalDuration: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
  }> {
    const stats: Record<string, {
      count: number;
      totalDuration: number;
      minDuration: number;
      maxDuration: number;
    }> = {};

    for (const metric of this.latencyMetrics) {
      if (!stats[metric.operation]) {
        stats[metric.operation] = {
          count: 0,
          totalDuration: 0,
          minDuration: Infinity,
          maxDuration: 0,
        };
      }

      const opStats = stats[metric.operation];
      opStats.count++;
      opStats.totalDuration += metric.duration;
      opStats.minDuration = Math.min(opStats.minDuration, metric.duration);
      opStats.maxDuration = Math.max(opStats.maxDuration, metric.duration);
    }

    // Calculate averages
    return Object.fromEntries(
      Object.entries(stats).map(([op, s]) => [
        op,
        {
          ...s,
          avgDuration: s.totalDuration / s.count,
        },
      ]),
    );
  }

  /**
   * Get complete performance statistics
   */
  getStats(): PerformanceStats {
    return {
      memory: {
        current: this.getCurrentMemory(),
        peak: this.getPeakMemory(),
        average: this.getAverageMemory(),
      },
      latency: {
        operations: this.getLatencyStats(),
      },
      alerts: {
        memoryWarnings: this.alertCounts.memory,
        latencyWarnings: this.alertCounts.latency,
      },
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.memorySnapshots = [];
    this.latencyMetrics = [];
    this.alertCounts = { memory: 0, latency: 0 };
  }

  /**
   * Get recent memory snapshots
   */
  getRecentMemory(count = 10): MemorySnapshot[] {
    return this.memorySnapshots.slice(-count);
  }

  /**
   * Get recent latency metrics
   */
  getRecentLatency(count = 10): LatencyMetrics[] {
    return this.latencyMetrics.slice(-count);
  }

  /**
   * Check if memory exceeds thresholds
   */
  private checkMemoryThresholds(snapshot: MemorySnapshot): void {
    const heapUsedMB = snapshot.heapUsed;
    const heapTotalMB = snapshot.heapTotal;
    const heapPercentage = (heapUsedMB / heapTotalMB) * 100;

    if (heapUsedMB > this.thresholds.memoryMB) {
      this.alertCounts.memory++;
      logger.warn("Memory threshold exceeded", {
        heapUsedMB: heapUsedMB.toFixed(2),
        thresholdMB: this.thresholds.memoryMB,
        heapPercentage: heapPercentage.toFixed(1),
      });
    }

    if (heapPercentage > this.thresholds.memoryPercentage) {
      this.alertCounts.memory++;
      logger.warn("Heap usage percentage high", {
        heapPercentage: heapPercentage.toFixed(1),
        thresholdPercentage: this.thresholds.memoryPercentage,
        heapUsedMB: heapUsedMB.toFixed(2),
      });
    }
  }

  /**
   * Check if latency exceeds threshold
   */
  private checkLatencyThreshold(metric: LatencyMetrics): void {
    if (metric.duration > this.thresholds.latencyMs) {
      this.alertCounts.latency++;
      logger.warn("Latency threshold exceeded", {
        operation: metric.operation,
        duration: `${metric.duration.toFixed(2)}ms`,
        threshold: `${this.thresholds.latencyMs}ms`,
        context: metric.context,
      });
    }
  }
}

// ============================================================================
// Global Instance
// ============================================================================

/**
 * Global performance monitor instance
 */
export const globalPerformanceMonitor = new PerformanceMonitor({
  maxSnapshots: 1000,
  maxMetrics: 1000,
  thresholds: {
    memoryMB: 400, // Alert at 400MB
    latencyMs: 5000, // Alert at 5s
    memoryPercentage: 80, // Alert at 80% heap usage
  },
});

/**
 * Convenience function to measure performance
 */
export async function measurePerformance<T>(
  operation: string,
  fn: () => Promise<T>,
  context?: Record<string, unknown>,
): Promise<T> {
  return globalPerformanceMonitor.measure(operation, fn, context);
}

/**
 * Convenience function to take memory snapshot
 */
export function snapshotMemory(): MemorySnapshot {
  return globalPerformanceMonitor.snapshot();
}

/**
 * Convenience function to track latency
 */
export function trackLatency(
  operation: string,
  duration: number,
  context?: Record<string, unknown>,
): void {
  globalPerformanceMonitor.trackLatency(operation, duration, context);
}
