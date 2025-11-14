/**
 * Query Performance Profiler
 *
 * Utility for profiling Neo4j queries with EXPLAIN and PROFILE.
 * Tracks query execution times and provides performance insights.
 *
 * @module devac/utils/query-profiler
 */

import type { Neo4jClient } from "../../database/neo4j-client.js";
import { createContextLogger } from "../../utils/logger.js";

const logger = createContextLogger("QueryProfiler");

export type QueryMetrics = {
  query: string;
  params: Record<string, unknown>;
  duration: number;
  timestamp: number;
  context: string;
};

export type QueryProfileResult = {
  plan: {
    operatorType: string;
    identifiers: string[];
    arguments: Record<string, unknown>;
    children: QueryProfileResult["plan"][];
  };
  dbHits?: number;
  rows?: number;
  time?: number;
};

export type QueryStats = {
  totalQueries: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  slowestQueries: QueryMetrics[];
};

/**
 * Query profiler for tracking and analyzing Neo4j query performance
 */
export class QueryProfiler {
  private metrics: QueryMetrics[] = [];
  private maxMetrics: number;
  private slowQueryThreshold: number;

  constructor(options: { maxMetrics?: number; slowQueryThreshold?: number } = {}) {
    this.maxMetrics = options.maxMetrics ?? 1000;
    this.slowQueryThreshold = options.slowQueryThreshold ?? 500; // 500ms default
  }

  /**
   * Track a query execution
   */
  track(query: string, params: Record<string, unknown>, duration: number, context: string): void {
    const metric: QueryMetrics = {
      query,
      params,
      duration,
      timestamp: Date.now(),
      context,
    };

    this.metrics.push(metric);

    // Keep only recent metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }

    // Log slow queries
    if (duration > this.slowQueryThreshold) {
      logger.warn(`Slow query detected (${duration}ms): ${context}`, {
        query: this.truncateQuery(query),
        duration,
      });
    }
  }

  /**
   * Run EXPLAIN on a query to see execution plan
   */
  async explain(
    neo4jClient: Neo4jClient,
    query: string,
    params: Record<string, unknown> = {},
  ): Promise<QueryProfileResult> {
    const explainQuery = `EXPLAIN ${query}`;

    const result = await neo4jClient.runTransaction(
      explainQuery,
      params,
      "READ",
      "QueryProfiler-Explain",
    );

    if (result.records.length === 0) {
      throw new Error("No EXPLAIN result returned");
    }

    // Extract plan from result
    const plan = result.records[0].get("plan") || result.summary?.plan;

    return this.parsePlan(plan);
  }

  /**
   * Run PROFILE on a query to get detailed execution statistics
   */
  async profile(
    neo4jClient: Neo4jClient,
    query: string,
    params: Record<string, unknown> = {},
  ): Promise<QueryProfileResult> {
    const profileQuery = `PROFILE ${query}`;

    const result = await neo4jClient.runTransaction(
      profileQuery,
      params,
      "READ",
      "QueryProfiler-Profile",
    );

    // Extract profile from result
    const profile = result.summary?.profile || result.summary?.plan;

    return this.parsePlan(profile);
  }

  /**
   * Get statistics for tracked queries
   */
  getStats(): QueryStats {
    if (this.metrics.length === 0) {
      return {
        totalQueries: 0,
        totalDuration: 0,
        avgDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        slowestQueries: [],
      };
    }

    const durations = this.metrics.map((m) => m.duration);
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);

    // Get top 10 slowest queries
    const slowest = [...this.metrics]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);

    return {
      totalQueries: this.metrics.length,
      totalDuration,
      avgDuration: totalDuration / this.metrics.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      slowestQueries: slowest,
    };
  }

  /**
   * Get queries that exceeded the slow threshold
   */
  getSlowQueries(): QueryMetrics[] {
    return this.metrics.filter((m) => m.duration > this.slowQueryThreshold);
  }

  /**
   * Get queries by context
   */
  getQueriesByContext(context: string): QueryMetrics[] {
    return this.metrics.filter((m) => m.context === context);
  }

  /**
   * Clear all tracked metrics
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * Generate a performance report
   */
  generateReport(): string {
    const stats = this.getStats();

    if (stats.totalQueries === 0) {
      return "No queries tracked";
    }

    const lines: string[] = [];
    lines.push("=== Query Performance Report ===");
    lines.push(`Total Queries: ${stats.totalQueries}`);
    lines.push(`Total Duration: ${stats.totalDuration.toFixed(2)}ms`);
    lines.push(`Average Duration: ${stats.avgDuration.toFixed(2)}ms`);
    lines.push(`Min Duration: ${stats.minDuration.toFixed(2)}ms`);
    lines.push(`Max Duration: ${stats.maxDuration.toFixed(2)}ms`);
    lines.push("");
    lines.push("=== Slowest Queries ===");

    for (const query of stats.slowestQueries) {
      lines.push(`[${query.context}] ${query.duration.toFixed(2)}ms`);
      lines.push(`  ${this.truncateQuery(query.query)}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Parse Neo4j plan/profile object
   */
  private parsePlan(plan: any): QueryProfileResult {
    if (!plan) {
      throw new Error("No plan provided");
    }

    return {
      plan: {
        operatorType: plan.operatorType || "Unknown",
        identifiers: plan.identifiers || [],
        arguments: plan.arguments || {},
        children: (plan.children || []).map((child: any) => this.parsePlan(child).plan),
      },
      dbHits: plan.dbHits,
      rows: plan.rows,
      time: plan.time,
    };
  }

  /**
   * Truncate query for display
   */
  private truncateQuery(query: string, maxLength: number = 100): string {
    const normalized = query.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return normalized.substring(0, maxLength) + "...";
  }
}

/**
 * Global query profiler instance
 */
export const globalQueryProfiler = new QueryProfiler({
  maxMetrics: 1000,
  slowQueryThreshold: 500,
});

/**
 * Wrapper function to track query execution time
 */
export async function trackQuery<T>(
  context: string,
  query: string,
  params: Record<string, unknown>,
  executor: () => Promise<T>,
): Promise<T> {
  const startTime = performance.now();

  try {
    const result = await executor();
    const duration = performance.now() - startTime;

    globalQueryProfiler.track(query, params, duration, context);

    return result;
  } catch (error) {
    const duration = performance.now() - startTime;
    globalQueryProfiler.track(query, params, duration, `${context}-ERROR`);
    throw error;
  }
}
