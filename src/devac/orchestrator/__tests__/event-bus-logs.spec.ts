// src/devac/orchestrator/__tests__/event-bus-logs.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventBus } from "../event-bus.js";
import type { LogEntry } from "../../types/logging.js";

describe("EventBus - Log Management", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus(1000, 500); // 1000 events, 500 logs
  });

  describe("addLog", () => {
    it("should add log entry to history", () => {
      const logEntry: LogEntry = {
        level: "error",
        message: "Test error",
        timestamp: "2025-11-11T16:00:00.000Z",
        service: "TestService",
      };

      eventBus.addLog(logEntry);

      const logs = eventBus.getLogHistory();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toEqual(logEntry);
    });

    it("should emit log event when log is added", async () => {
      const logEntry: LogEntry = {
        level: "error",
        message: "Test error",
        timestamp: "2025-11-11T16:00:00.000Z",
      };

      const logPromise = new Promise<LogEntry>((resolve) => {
        eventBus.on("log", (emittedLog) => {
          resolve(emittedLog);
        });
      });

      eventBus.addLog(logEntry);

      const emittedLog = await logPromise;
      expect(emittedLog).toEqual(logEntry);
    });

    it("should maintain FIFO queue when exceeding max size", () => {
      const smallEventBus = new EventBus(1000, 3); // Max 3 logs

      for (let i = 0; i < 5; i++) {
        smallEventBus.addLog({
          level: "info",
          message: `Log ${i}`,
          timestamp: new Date().toISOString(),
        });
      }

      const logs = smallEventBus.getLogHistory();
      expect(logs).toHaveLength(3);
      expect(logs[0].message).toBe("Log 2"); // Oldest remaining
      expect(logs[2].message).toBe("Log 4"); // Newest
    });
  });

  describe("getLogHistory", () => {
    beforeEach(() => {
      // Add sample logs
      eventBus.addLog({
        level: "error",
        message: "Error message",
        timestamp: "2025-11-11T16:00:00.000Z",
        service: "Service1",
      });
      eventBus.addLog({
        level: "warn",
        message: "Warning message",
        timestamp: "2025-11-11T16:01:00.000Z",
        service: "Service2",
      });
      eventBus.addLog({
        level: "info",
        message: "Info message",
        timestamp: "2025-11-11T16:02:00.000Z",
        service: "Service1",
      });
    });

    it("should return all logs when no filter provided", () => {
      const logs = eventBus.getLogHistory();
      expect(logs).toHaveLength(3);
    });

    it("should filter logs by level", () => {
      const logs = eventBus.getLogHistory({ level: ["error", "warn"] });
      expect(logs).toHaveLength(2);
      expect(
        logs.every((log) => log.level === "error" || log.level === "warn"),
      ).toBe(true);
    });

    it("should filter logs by single level", () => {
      const logs = eventBus.getLogHistory({ level: ["error"] });
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe("error");
    });

    it("should filter logs by service", () => {
      const logs = eventBus.getLogHistory({ service: "Service1" });
      expect(logs).toHaveLength(2);
      expect(logs.every((log) => log.service === "Service1")).toBe(true);
    });

    it("should filter logs by timestamp (since)", () => {
      const sinceTimestamp = new Date("2025-11-11T16:01:00.000Z").getTime();
      const logs = eventBus.getLogHistory({ since: sinceTimestamp });

      expect(logs).toHaveLength(2); // warn and info
      expect(
        logs.every(
          (log) => new Date(log.timestamp).getTime() >= sinceTimestamp,
        ),
      ).toBe(true);
    });

    it("should filter logs by search text in message", () => {
      const logs = eventBus.getLogHistory({ search: "error" });
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe("Error message");
    });

    it("should filter logs by search text in service", () => {
      const logs = eventBus.getLogHistory({ search: "Service2" });
      expect(logs).toHaveLength(1);
      expect(logs[0].service).toBe("Service2");
    });

    it("should be case-insensitive for search", () => {
      const logs = eventBus.getLogHistory({ search: "ERROR" });
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe("Error message");
    });

    it("should limit number of returned logs", () => {
      const logs = eventBus.getLogHistory({ limit: 2 });
      expect(logs).toHaveLength(2);
    });

    it("should return last N logs when limit is applied", () => {
      const logs = eventBus.getLogHistory({ limit: 1 });
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe("Info message"); // Last log added
    });

    it("should combine multiple filters", () => {
      const logs = eventBus.getLogHistory({
        level: ["error", "info"],
        service: "Service1",
      });

      expect(logs).toHaveLength(2);
      expect(logs.every((log) => log.service === "Service1")).toBe(true);
      expect(
        logs.every((log) => log.level === "error" || log.level === "info"),
      ).toBe(true);
    });

    it("should return empty array when no logs match filter", () => {
      const logs = eventBus.getLogHistory({ service: "NonexistentService" });
      expect(logs).toEqual([]);
    });
  });

  describe("clearLogHistory", () => {
    it("should clear all logs", () => {
      eventBus.addLog({
        level: "error",
        message: "Test error",
        timestamp: "2025-11-11T16:00:00.000Z",
      });

      expect(eventBus.getLogHistory()).toHaveLength(1);

      eventBus.clearLogHistory();

      expect(eventBus.getLogHistory()).toHaveLength(0);
    });
  });

  describe("getStats", () => {
    it("should include logHistorySize in stats", () => {
      eventBus.addLog({
        level: "error",
        message: "Test error",
        timestamp: "2025-11-11T16:00:00.000Z",
      });

      const stats = eventBus.getStats();
      expect(stats.logHistorySize).toBe(1);
    });

    it("should update logHistorySize as logs are added", () => {
      expect(eventBus.getStats().logHistorySize).toBe(0);

      eventBus.addLog({
        level: "error",
        message: "Test 1",
        timestamp: "2025-11-11T16:00:00.000Z",
      });

      expect(eventBus.getStats().logHistorySize).toBe(1);

      eventBus.addLog({
        level: "warn",
        message: "Test 2",
        timestamp: "2025-11-11T16:01:00.000Z",
      });

      expect(eventBus.getStats().logHistorySize).toBe(2);
    });
  });

  describe("log metadata handling", () => {
    it("should preserve log metadata", () => {
      const logEntry: LogEntry = {
        level: "error",
        message: "Error with metadata",
        timestamp: "2025-11-11T16:00:00.000Z",
        service: "TestService",
        metadata: {
          requestId: "abc-123",
          userId: 42,
          nested: { value: true },
        },
      };

      eventBus.addLog(logEntry);

      const logs = eventBus.getLogHistory();
      expect(logs[0].metadata).toEqual({
        requestId: "abc-123",
        userId: 42,
        nested: { value: true },
      });
    });

    it("should preserve stack traces", () => {
      const logEntry: LogEntry = {
        level: "error",
        message: "Error with stack",
        timestamp: "2025-11-11T16:00:00.000Z",
        stack: "Error: Test\n  at file.ts:10:5",
      };

      eventBus.addLog(logEntry);

      const logs = eventBus.getLogHistory();
      expect(logs[0].stack).toBe("Error: Test\n  at file.ts:10:5");
    });
  });
});
