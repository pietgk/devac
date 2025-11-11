// src/devac/web/__tests__/eventbus-transport.spec.ts

import { describe, it, expect, beforeEach } from "vitest";
import { EventBusTransport } from "../eventbus-transport.js";
import { EventBus } from "../../orchestrator/event-bus.js";

describe("EventBusTransport", () => {
  let eventBus: EventBus;
  let transport: EventBusTransport;

  beforeEach(() => {
    eventBus = new EventBus();
    transport = new EventBusTransport({
      eventBus,
      levelsToForward: ["warn", "error"],
    });
  });

  describe("log forwarding", () => {
    it("should forward error logs to EventBus", async () => {
      const logInfo = {
        level: "error",
        message: "Test error message",
        timestamp: "2025-11-11T16:00:00.000Z",
        context: "TestService",
        stack: "Error: Test\n  at ...",
        metadata: { key: "value" },
      };

      await new Promise<void>((resolve) => {
        transport.log(logInfo, resolve);
      });

      const logs = eventBus.getLogHistory();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        level: "error",
        message: "Test error message",
        service: "TestService",
        stack: "Error: Test\n  at ...",
      });
    });

    it("should forward warn logs to EventBus", async () => {
      const logInfo = {
        level: "warn",
        message: "Test warning",
        timestamp: "2025-11-11T16:00:00.000Z",
        context: "TestService",
      };

      await new Promise<void>((resolve) => {
        transport.log(logInfo, resolve);
      });

      const logs = eventBus.getLogHistory();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe("warn");
      expect(logs[0].message).toBe("Test warning");
    });

    it("should NOT forward info logs by default", async () => {
      const logInfo = {
        level: "info",
        message: "Test info message",
        timestamp: "2025-11-11T16:00:00.000Z",
        context: "TestService",
      };

      await new Promise<void>((resolve) => {
        transport.log(logInfo, resolve);
      });

      const logs = eventBus.getLogHistory();
      expect(logs).toHaveLength(0);
    });

    it("should NOT forward debug logs by default", async () => {
      const logInfo = {
        level: "debug",
        message: "Test debug message",
        timestamp: "2025-11-11T16:00:00.000Z",
        context: "TestService",
      };

      await new Promise<void>((resolve) => {
        transport.log(logInfo, resolve);
      });

      const logs = eventBus.getLogHistory();
      expect(logs).toHaveLength(0);
    });
  });

  describe("custom levels configuration", () => {
    it("should respect custom levelsToForward", async () => {
      const customTransport = new EventBusTransport({
        eventBus,
        levelsToForward: ["info", "error"], // Include info, exclude warn
      });

      const infoLog = {
        level: "info",
        message: "Info message",
        timestamp: "2025-11-11T16:00:00.000Z",
        context: "TestService",
      };

      await new Promise<void>((resolve) => {
        customTransport.log(infoLog, resolve);
      });

      const logs = eventBus.getLogHistory();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe("info");
    });
  });

  describe("metadata extraction", () => {
    it("should extract metadata from log info", async () => {
      const logInfo = {
        level: "error",
        message: "Error with metadata",
        timestamp: "2025-11-11T16:00:00.000Z",
        context: "TestService",
        customField: "customValue",
        anotherField: { nested: true },
      };

      await new Promise<void>((resolve) => {
        transport.log(logInfo, resolve);
      });

      const logs = eventBus.getLogHistory();
      expect(logs[0].metadata).toBeDefined();
      expect(logs[0].metadata?.customField).toBe("customValue");
      expect(logs[0].metadata?.anotherField).toEqual({ nested: true });
    });

    it("should not include standard fields in metadata", async () => {
      const logInfo = {
        level: "error",
        message: "Test message",
        timestamp: "2025-11-11T16:00:00.000Z",
        context: "TestService",
        stack: "Error stack",
      };

      await new Promise<void>((resolve) => {
        transport.log(logInfo, resolve);
      });

      const logs = eventBus.getLogHistory();
      expect(logs[0].metadata).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("should emit error event on failure", async () => {
      const brokenEventBus = {
        addLog: () => {
          throw new Error("EventBus failure");
        },
      } as any;

      const brokenTransport = new EventBusTransport({
        eventBus: brokenEventBus,
      });

      let errorEmitted = false;
      brokenTransport.on("error", () => {
        errorEmitted = true;
      });

      const logInfo = {
        level: "error",
        message: "Test",
        timestamp: "2025-11-11T16:00:00.000Z",
      };

      await new Promise<void>((resolve) => {
        brokenTransport.log(logInfo, resolve);
      });

      expect(errorEmitted).toBe(true);
    });
  });

  describe("event emission", () => {
    it("should emit logged event on successful log", async () => {
      let loggedEmitted = false;
      transport.on("logged", () => {
        loggedEmitted = true;
      });

      const logInfo = {
        level: "error",
        message: "Test",
        timestamp: "2025-11-11T16:00:00.000Z",
        context: "TestService",
      };

      await new Promise<void>((resolve) => {
        transport.log(logInfo, resolve);
      });

      expect(loggedEmitted).toBe(true);
    });
  });

  describe("timestamp handling", () => {
    it("should use provided timestamp", async () => {
      const logInfo = {
        level: "error",
        message: "Test",
        timestamp: "2025-01-01T00:00:00.000Z",
        context: "TestService",
      };

      await new Promise<void>((resolve) => {
        transport.log(logInfo, resolve);
      });

      const logs = eventBus.getLogHistory();
      expect(logs[0].timestamp).toBe("2025-01-01T00:00:00.000Z");
    });

    it("should generate timestamp if not provided", async () => {
      const logInfo = {
        level: "error",
        message: "Test",
        context: "TestService",
      };

      await new Promise<void>((resolve) => {
        transport.log(logInfo, resolve);
      });

      const logs = eventBus.getLogHistory();
      expect(logs[0].timestamp).toBeDefined();
      expect(new Date(logs[0].timestamp).getTime()).toBeGreaterThan(0);
    });
  });
});
