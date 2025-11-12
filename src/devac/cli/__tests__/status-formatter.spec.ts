// src/devac/cli/__tests__/status-formatter.spec.ts

import { describe, it, expect } from "vitest";
import {
  SummaryFormatter,
  AttentionFormatter,
  DetailedFormatter,
  JSONFormatter,
  createFormatter,
} from "../formatters/status-formatter.js";
import type { SystemStatus } from "../api/devac-client.js";

/**
 * Status Formatter Tests
 *
 * Tests the various formatters for DevAC status output.
 */

// Mock system status data
const mockHealthyStatus: SystemStatus = {
  services: [
    {
      id: "typecheck",
      name: "TypeCheck Service",
      type: "typecheck",
      enabled: true,
      status: "running",
      health: "healthy",
      stats: {
        successCount: 10,
        failureCount: 0,
        lastRunDuration: 150,
        lastRunTimestamp: new Date().toISOString(),
      },
      version: "1.0.0",
    },
    {
      id: "lint",
      name: "Lint Service",
      type: "lint",
      enabled: true,
      status: "running",
      health: "healthy",
      stats: {
        successCount: 8,
        failureCount: 0,
      },
      version: "1.0.0",
    },
  ],
  summary: {
    total: 2,
    running: 2,
    stopped: 0,
    error: 0,
    healthy: 2,
    unhealthy: 0,
  },
  hasErrors: false,
  hasWarnings: false,
};

const mockErrorStatus: SystemStatus = {
  services: [
    {
      id: "typecheck",
      name: "TypeCheck Service",
      type: "typecheck",
      enabled: true,
      status: "error",
      health: "unhealthy",
      stats: {
        successCount: 5,
        failureCount: 3,
      },
      lastError: {
        message: "Type check failed with 5 errors",
        timestamp: new Date(Date.now() - 120000).toISOString(), // 2 minutes ago
      },
      version: "1.0.0",
    },
    {
      id: "lint",
      name: "Lint Service",
      type: "lint",
      enabled: true,
      status: "running",
      health: "healthy",
      stats: {
        successCount: 8,
        failureCount: 0,
      },
      version: "1.0.0",
    },
  ],
  summary: {
    total: 2,
    running: 1,
    stopped: 0,
    error: 1,
    healthy: 1,
    unhealthy: 1,
  },
  hasErrors: true,
  hasWarnings: false,
};

const mockWarningStatus: SystemStatus = {
  services: [
    {
      id: "typecheck",
      name: "TypeCheck Service",
      type: "typecheck",
      enabled: true,
      status: "running",
      health: "degraded",
      stats: {
        successCount: 8,
        failureCount: 2,
        lastRunDuration: 5000, // Slow
      },
      version: "1.0.0",
    },
  ],
  summary: {
    total: 1,
    running: 1,
    stopped: 0,
    error: 0,
    healthy: 0,
    unhealthy: 1,
  },
  hasErrors: false,
  hasWarnings: true,
};

describe("SummaryFormatter", () => {
  it("should format healthy status as one line", () => {
    const formatter = new SummaryFormatter({ color: false });
    const output = formatter.format(mockHealthyStatus);

    expect(output).toContain("DevAC:");
    expect(output).toContain("2/2 services running");
    expect(output).toContain("all healthy");
  });

  it("should show error status in summary", () => {
    const formatter = new SummaryFormatter({ color: false });
    const output = formatter.format(mockErrorStatus);

    expect(output).toContain("1/2 services running");
    expect(output).toContain("error");
  });

  it("should show warning status in summary", () => {
    const formatter = new SummaryFormatter({ color: false });
    const output = formatter.format(mockWarningStatus);

    expect(output).toContain("1/1 services running");
    expect(output).toContain("degraded");
  });

  it("should use colors when enabled", () => {
    const formatter = new SummaryFormatter({ color: true });
    const output = formatter.format(mockHealthyStatus);

    // Should contain ANSI color codes
    expect(output).toMatch(/\x1b\[\d+m/);
  });

  it("should not use colors when disabled", () => {
    const formatter = new SummaryFormatter({ color: false });
    const output = formatter.format(mockHealthyStatus);

    // Should not contain ANSI color codes
    expect(output).not.toMatch(/\x1b\[\d+m/);
  });
});

describe("AttentionFormatter", () => {
  it("should show 'all healthy' when no problems", () => {
    const formatter = new AttentionFormatter({ color: false });
    const output = formatter.format(mockHealthyStatus);

    expect(output).toContain("All services healthy");
  });

  it("should list services with errors", () => {
    const formatter = new AttentionFormatter({ color: false });
    const output = formatter.format(mockErrorStatus);

    expect(output).toContain("Services Requiring Attention");
    expect(output).toContain("TypeCheck Service");
    expect(output).toContain("Type check failed with 5 errors");
  });

  it("should show failure stats for problem services", () => {
    const formatter = new AttentionFormatter({ color: false });
    const output = formatter.format(mockErrorStatus);

    expect(output).toContain("5 success");
    expect(output).toContain("3 failures");
  });

  it("should list degraded services", () => {
    const formatter = new AttentionFormatter({ color: false });
    const output = formatter.format(mockWarningStatus);

    expect(output).toContain("TypeCheck Service");
    expect(output).toContain("degraded");
  });

  it("should show service IDs when enabled", () => {
    const formatter = new AttentionFormatter({
      color: false,
      showIds: true,
    });
    const output = formatter.format(mockErrorStatus);

    expect(output).toContain("typecheck");
  });
});

describe("DetailedFormatter", () => {
  it("should show report header", () => {
    const formatter = new DetailedFormatter({ color: false });
    const output = formatter.format(mockHealthyStatus);

    expect(output).toContain("DevAC Status Report");
  });

  it("should show summary statistics", () => {
    const formatter = new DetailedFormatter({ color: false });
    const output = formatter.format(mockHealthyStatus);

    expect(output).toContain("Services: 2 total, 2 running, 0 stopped");
    expect(output).toContain("Health:   2 healthy");
  });

  it("should show all services with details", () => {
    const formatter = new DetailedFormatter({ color: false });
    const output = formatter.format(mockHealthyStatus);

    // Should contain both services
    expect(output).toContain("TypeCheck Service");
    expect(output).toContain("Lint Service");

    // Should show types
    expect(output).toContain("Type: typecheck");
    expect(output).toContain("Type: lint");

    // Should show stats
    expect(output).toContain("10 success");
    expect(output).toContain("8 success");
  });

  it("should show last run duration", () => {
    const formatter = new DetailedFormatter({ color: false });
    const output = formatter.format(mockHealthyStatus);

    expect(output).toContain("Last run: 150ms");
  });

  it("should show errors for failed services", () => {
    const formatter = new DetailedFormatter({ color: false });
    const output = formatter.format(mockErrorStatus);

    expect(output).toContain("Error: Type check failed with 5 errors");
  });

  it("should show warning for degraded services", () => {
    const formatter = new DetailedFormatter({ color: false });
    const output = formatter.format(mockWarningStatus);

    expect(output).toContain("Warning: Service degraded");
  });

  it("should show timestamps when enabled", () => {
    const formatter = new DetailedFormatter({
      color: false,
      showTimestamps: true,
    });
    const output = formatter.format(mockErrorStatus);

    // Should show relative time
    expect(output).toMatch(/ago|now/i);
  });
});

describe("JSONFormatter", () => {
  it("should output valid JSON", () => {
    const formatter = new JSONFormatter();
    const output = formatter.format(mockHealthyStatus);

    const parsed = JSON.parse(output);
    expect(parsed).toEqual(mockHealthyStatus);
  });

  it("should format JSON with indentation", () => {
    const formatter = new JSONFormatter();
    const output = formatter.format(mockHealthyStatus);

    // Should be indented (contains newlines and spaces)
    expect(output).toContain("\n");
    expect(output).toContain("  ");
  });

  it("should include all system status fields", () => {
    const formatter = new JSONFormatter();
    const output = formatter.format(mockHealthyStatus);

    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("services");
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("hasErrors");
    expect(parsed).toHaveProperty("hasWarnings");
  });
});

describe("createFormatter", () => {
  it("should create SummaryFormatter", () => {
    const formatter = createFormatter("summary");
    expect(formatter).toBeInstanceOf(SummaryFormatter);
  });

  it("should create AttentionFormatter", () => {
    const formatter = createFormatter("attention");
    expect(formatter).toBeInstanceOf(AttentionFormatter);
  });

  it("should create DetailedFormatter", () => {
    const formatter = createFormatter("detailed");
    expect(formatter).toBeInstanceOf(DetailedFormatter);
  });

  it("should create JSONFormatter", () => {
    const formatter = createFormatter("json");
    expect(formatter).toBeInstanceOf(JSONFormatter);
  });

  it("should pass options to formatter", () => {
    const formatter = createFormatter("summary", {
      color: false,
      showTimestamps: true,
    });

    expect(formatter).toBeDefined();
  });

  it("should throw error for unknown formatter type", () => {
    expect(() => {
      createFormatter("unknown" as any);
    }).toThrow("Unknown formatter type: unknown");
  });
});

describe("Formatter Options", () => {
  describe("Color Option", () => {
    it("should respect color: false option", () => {
      const formatter = new SummaryFormatter({ color: false });
      const output = formatter.format(mockHealthyStatus);

      expect(output).not.toMatch(/\x1b\[\d+m/);
    });

    it("should use colors by default", () => {
      const formatter = new SummaryFormatter();
      const output = formatter.format(mockHealthyStatus);

      expect(output).toMatch(/\x1b\[\d+m/);
    });
  });

  describe("ShowTimestamps Option", () => {
    it("should show timestamps when enabled", () => {
      const formatter = new AttentionFormatter({
        color: false,
        showTimestamps: true,
      });
      const output = formatter.format(mockErrorStatus);

      // Should contain relative time
      expect(output).toMatch(/ago|now/i);
    });

    it("should not show timestamps by default", () => {
      const formatter = new AttentionFormatter({
        color: false,
        showTimestamps: false,
      });
      const output = formatter.format(mockErrorStatus);

      // Service name should still appear
      expect(output).toContain("TypeCheck Service");
    });
  });

  describe("ShowIds Option", () => {
    it("should show service IDs when enabled", () => {
      const formatter = new DetailedFormatter({
        color: false,
        showIds: true,
      });
      const output = formatter.format(mockHealthyStatus);

      expect(output).toContain("(typecheck)");
      expect(output).toContain("(lint)");
    });

    it("should not show IDs by default", () => {
      const formatter = new DetailedFormatter({
        color: false,
        showIds: false,
      });
      const output = formatter.format(mockHealthyStatus);

      // Should show service name but not ID in parentheses
      expect(output).toContain("TypeCheck Service");
      expect(output).not.toContain("(typecheck)");
    });
  });
});
