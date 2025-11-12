// src/devac/cli/formatters/status-formatter.ts

import type {
  SystemStatus,
  ServiceMetadata,
} from "../api/devac-client.js";

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",

  // Colors
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",

  // Background colors
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
};

/**
 * Status formatter options
 */
export interface StatusFormatterOptions {
  /** Use colors in output */
  color?: boolean;
  /** Show timestamps */
  showTimestamps?: boolean;
  /** Show service IDs */
  showIds?: boolean;
}

/**
 * Base class for status formatters
 */
abstract class BaseFormatter {
  protected options: Required<StatusFormatterOptions>;

  constructor(options: StatusFormatterOptions = {}) {
    this.options = {
      color: options.color ?? true,
      showTimestamps: options.showTimestamps ?? false,
      showIds: options.showIds ?? false,
    };
  }

  /**
   * Apply color if enabled
   */
  protected c(color: keyof typeof colors, text: string): string {
    if (!this.options.color) {
      return text;
    }
    return `${colors[color]}${text}${colors.reset}`;
  }

  /**
   * Get status symbol
   */
  protected getStatusSymbol(status: string): string {
    switch (status) {
      case "running":
        return this.c("green", "●");
      case "stopped":
      case "idle":
        return this.c("gray", "○");
      case "starting":
        return this.c("cyan", "◐");
      case "stopping":
        return this.c("yellow", "◑");
      case "error":
        return this.c("red", "✖");
      default:
        return this.c("gray", "?");
    }
  }

  /**
   * Get health symbol
   */
  protected getHealthSymbol(health: string): string {
    switch (health) {
      case "healthy":
        return this.c("green", "✓");
      case "degraded":
        return this.c("yellow", "⚠");
      case "unhealthy":
        return this.c("red", "✗");
      default:
        return this.c("gray", "?");
    }
  }

  /**
   * Format service name
   */
  protected formatServiceName(service: ServiceMetadata): string {
    let name = service.name;

    if (this.options.showIds && service.id !== service.name) {
      name = `${service.name} (${this.c("gray", service.id)})`;
    }

    return name;
  }

  /**
   * Format timestamp
   */
  protected formatTimestamp(timestamp?: string): string {
    if (!timestamp || !this.options.showTimestamps) {
      return "";
    }

    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // Less than 1 minute
    if (diff < 60000) {
      return this.c("gray", "just now");
    }

    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return this.c("gray", `${minutes}m ago`);
    }

    // Less than 24 hours
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return this.c("gray", `${hours}h ago`);
    }

    // More than 24 hours
    return this.c("gray", date.toLocaleDateString());
  }

  abstract format(status: SystemStatus): string;
}

/**
 * Summary formatter - One line status
 *
 * Example output:
 * ✓ DevAC: 3/3 services running (all healthy)
 * ⚠ DevAC: 2/3 services running (1 degraded)
 * ✗ DevAC: 1/3 services running (2 errors)
 */
export class SummaryFormatter extends BaseFormatter {
  format(status: SystemStatus): string {
    const { summary, hasErrors, hasWarnings } = status;

    // Overall symbol
    let symbol: string;
    if (hasErrors) {
      symbol = this.c("red", "✗");
    } else if (hasWarnings) {
      symbol = this.c("yellow", "⚠");
    } else {
      symbol = this.c("green", "✓");
    }

    // Service counts
    const runningCount = this.c(
      summary.running > 0 ? "green" : "gray",
      summary.running.toString(),
    );
    const totalCount = summary.total.toString();

    // Health status
    let healthText: string;
    if (hasErrors) {
      const errorCount = summary.error + summary.unhealthy;
      healthText = this.c("red", `${errorCount} error${errorCount !== 1 ? "s" : ""}`);
    } else if (hasWarnings) {
      const warnCount = summary.unhealthy;
      healthText = this.c("yellow", `${warnCount} degraded`);
    } else {
      healthText = this.c("green", "all healthy");
    }

    return `${symbol} DevAC: ${runningCount}/${totalCount} services running (${healthText})`;
  }
}

/**
 * Attention formatter - Shows services requiring attention
 *
 * Example output:
 * ⚠ Services Requiring Attention:
 *
 * ✗ lint-service (error)
 *   Last error: Command failed with exit code 2
 *   2 minutes ago
 *
 * ⚠ test-service (degraded)
 *   Slow response time detected
 */
export class AttentionFormatter extends BaseFormatter {
  format(status: SystemStatus): string {
    const problemServices = status.services.filter(
      (s) =>
        s.status === "error" ||
        s.health === "unhealthy" ||
        s.health === "degraded",
    );

    if (problemServices.length === 0) {
      return this.c("green", "✓ All services healthy");
    }

    const lines: string[] = [];

    // Header
    const symbol = status.hasErrors
      ? this.c("red", "✗")
      : this.c("yellow", "⚠");
    lines.push(`${symbol} Services Requiring Attention:\n`);

    // Problem services
    for (const service of problemServices) {
      const healthSymbol = this.getHealthSymbol(service.health);
      const serviceName = this.formatServiceName(service);

      // Service header
      const statusText =
        service.status === "error"
          ? this.c("red", "error")
          : this.c("yellow", service.health);
      lines.push(`${healthSymbol} ${this.c("bold", serviceName)} (${statusText})`);

      // Last error
      if (service.lastError) {
        lines.push(`  ${this.c("gray", "└─")} ${service.lastError.message}`);

        if (this.options.showTimestamps && service.lastError.timestamp) {
          const time = this.formatTimestamp(service.lastError.timestamp);
          if (time) {
            lines.push(`     ${time}`);
          }
        }
      }

      // Stats
      if (service.stats.failureCount > 0) {
        const failures = this.c("red", service.stats.failureCount.toString());
        const successes = this.c("green", service.stats.successCount.toString());
        lines.push(
          `  ${this.c("gray", "└─")} Stats: ${successes} success, ${failures} failures`,
        );
      }

      lines.push(""); // Blank line between services
    }

    return lines.join("\n");
  }
}

/**
 * Detailed formatter - Shows all services with full information
 *
 * Example output:
 * DevAC Status Report
 * ═══════════════════
 *
 * Services: 3 total, 3 running, 0 stopped
 * Health:   2 healthy, 1 degraded, 0 unhealthy
 *
 * Services:
 *
 * ● typecheck-service (running) ✓
 *   Type: typecheck
 *   Status: Running for 2h 15m
 *   Stats: 45 success, 0 failures
 *   Last run: 42ms (5m ago)
 *
 * ● lint-service (running) ⚠
 *   Type: lint
 *   Status: Running for 2h 15m
 *   Stats: 43 success, 2 failures
 *   Last run: 235ms (3m ago)
 *   Warning: Slow response time
 *
 * ○ test-service (stopped)
 *   Type: test
 *   Status: Stopped
 */
export class DetailedFormatter extends BaseFormatter {
  format(status: SystemStatus): string {
    const lines: string[] = [];

    // Header
    lines.push(this.c("bold", "DevAC Status Report"));
    lines.push(this.c("dim", "═".repeat(50)));
    lines.push("");

    // Summary
    lines.push(this.formatSummarySection(status));
    lines.push("");

    // Services header
    lines.push(this.c("bold", "Services:"));
    lines.push("");

    // Service details
    for (const service of status.services) {
      lines.push(this.formatServiceDetails(service));
      lines.push(""); // Blank line between services
    }

    return lines.join("\n");
  }

  private formatSummarySection(status: SystemStatus): string {
    const { summary } = status;
    const lines: string[] = [];

    // Service counts
    const running = this.c(
      summary.running > 0 ? "green" : "gray",
      summary.running.toString(),
    );
    const stopped = this.c("gray", summary.stopped.toString());
    const total = summary.total.toString();

    lines.push(`Services: ${total} total, ${running} running, ${stopped} stopped`);

    // Health counts
    const healthy = this.c(
      summary.healthy > 0 ? "green" : "gray",
      summary.healthy.toString(),
    );
    const unhealthy = this.c(
      summary.unhealthy > 0 ? "red" : "gray",
      summary.unhealthy.toString(),
    );
    const error = this.c(
      summary.error > 0 ? "red" : "gray",
      summary.error.toString(),
    );

    lines.push(
      `Health:   ${healthy} healthy, ${unhealthy} degraded, ${error} unhealthy`,
    );

    return lines.join("\n");
  }

  private formatServiceDetails(service: ServiceMetadata): string {
    const lines: string[] = [];

    // Service header: ● typecheck-service (running) ✓
    const statusSymbol = this.getStatusSymbol(service.status);
    const healthSymbol = this.getHealthSymbol(service.health);
    const serviceName = this.formatServiceName(service);
    const statusText = this.c("gray", `(${service.status})`);

    lines.push(
      `${statusSymbol} ${this.c("bold", serviceName)} ${statusText} ${healthSymbol}`,
    );

    // Type
    lines.push(`  ${this.c("gray", "Type:")} ${service.type}`);

    // Status with duration
    if (service.status === "running" && service.stats.lastRunTimestamp) {
      const duration = this.formatTimestamp(service.stats.lastRunTimestamp);
      if (duration) {
        lines.push(`  ${this.c("gray", "Running:")} ${duration}`);
      }
    }

    // Stats
    const successText = this.c("green", service.stats.successCount.toString());
    const failureText =
      service.stats.failureCount > 0
        ? this.c("red", service.stats.failureCount.toString())
        : this.c("gray", "0");
    lines.push(
      `  ${this.c("gray", "Stats:")} ${successText} success, ${failureText} failures`,
    );

    // Last run info
    if (service.stats.lastRunDuration !== undefined) {
      const duration = `${service.stats.lastRunDuration}ms`;
      const timestamp = this.formatTimestamp(service.stats.lastRunTimestamp);
      lines.push(
        `  ${this.c("gray", "Last run:")} ${duration}${timestamp ? ` (${timestamp})` : ""}`,
      );
    }

    // Last error
    if (service.lastError) {
      lines.push(`  ${this.c("red", "Error:")} ${service.lastError.message}`);
      if (this.options.showTimestamps && service.lastError.timestamp) {
        const time = this.formatTimestamp(service.lastError.timestamp);
        if (time) {
          lines.push(`  ${this.c("gray", "When:")} ${time}`);
        }
      }
    }

    // Health warning
    if (service.health === "degraded") {
      lines.push(`  ${this.c("yellow", "Warning:")} Service degraded`);
    }

    return lines.join("\n");
  }
}

/**
 * JSON formatter - Machine-readable output
 */
export class JSONFormatter extends BaseFormatter {
  format(status: SystemStatus): string {
    return JSON.stringify(status, null, 2);
  }
}

/**
 * Create formatter based on type
 */
export function createFormatter(
  type: "summary" | "attention" | "detailed" | "json",
  options?: StatusFormatterOptions,
): BaseFormatter {
  switch (type) {
    case "summary":
      return new SummaryFormatter(options);
    case "attention":
      return new AttentionFormatter(options);
    case "detailed":
      return new DetailedFormatter(options);
    case "json":
      return new JSONFormatter(options);
    default:
      throw new Error(`Unknown formatter type: ${type}`);
  }
}
