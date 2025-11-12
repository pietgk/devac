// src/devac/services/__tests__/service-integration.spec.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TypeCheckService } from "../typecheck/typecheck-service.js";
import { LintService } from "../lint/lint-service.js";
import { TestService } from "../test/test-service.js";
import { EventBus } from "../../orchestrator/event-bus.js";
import type {
  TypeCheckServiceConfig,
  LintServiceConfig,
  TestServiceConfigV2,
} from "../../types/config.js";

describe("Command-Based Services Integration", () => {
  let eventBus: EventBus;
  let capturedEvents: any[] = [];

  beforeEach(() => {
    eventBus = new EventBus();
    capturedEvents = [];

    // Capture all events
    eventBus.subscribe("*", (envelope) => {
      capturedEvents.push({
        type: envelope.event.type,
        source: envelope.source,
        event: envelope.event,
      });
    });
  });

  afterEach(() => {
    eventBus.removeAllListeners();
    eventBus.clearHistory();
  });

  describe("TypeCheckService", () => {
    it("should instantiate with valid config", () => {
      const config: TypeCheckServiceConfig = {
        enabled: true,
        repositories: [
          {
            path: "/Users/grop/ws/CodeGraph",
            strategy: "single",
            command: "npx tsc --noEmit",
            watch: false,
          },
        ],
      };

      const service = new TypeCheckService(config, eventBus);
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe("TypeCheckService");
    });

    it("should run type checking and parse errors", async () => {
      const config: TypeCheckServiceConfig = {
        enabled: true,
        repositories: [
          {
            path: "/Users/grop/ws/CodeGraph",
            strategy: "single",
            command: "npx tsc --noEmit",
            watch: false,
          },
        ],
      };

      const service = new TypeCheckService(config, eventBus);

      // Start the service
      await service.start();

      // Check repository
      await service.checkRepository("/Users/grop/ws/CodeGraph");

      // Wait a bit for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have captured SERVICE_STATE_CHANGED events
      const stateEvents = capturedEvents.filter(
        (e) => e.type === "SERVICE_STATE_CHANGED",
      );
      expect(stateEvents.length).toBeGreaterThan(0);

      // Stop the service
      await service.stop();
    });
  });

  describe("LintService", () => {
    it("should instantiate with valid config", () => {
      const config: LintServiceConfig = {
        enabled: true,
        repositories: [
          {
            path: "/Users/grop/ws/CodeGraph",
            strategy: "single",
            command: "npm run lint",
            watch: false,
          },
        ],
        includeSnippets: true,
      };

      const service = new LintService(config, eventBus);
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe("LintService");
    });

    it("should run linting and include code snippets", async () => {
      const config: LintServiceConfig = {
        enabled: true,
        repositories: [
          {
            path: "/Users/grop/ws/CodeGraph",
            strategy: "single",
            command: "npm run lint",
            watch: false,
          },
        ],
        includeSnippets: true,
      };

      const service = new LintService(config, eventBus);

      // Start the service
      await service.start();

      // Lint repository
      await service.lintRepository("/Users/grop/ws/CodeGraph");

      // Wait a bit for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have captured events
      const stateEvents = capturedEvents.filter(
        (e) => e.type === "SERVICE_STATE_CHANGED",
      );
      expect(stateEvents.length).toBeGreaterThan(0);

      // Stop the service
      await service.stop();
    });

    it("should include snippets when enabled", async () => {
      const config: LintServiceConfig = {
        enabled: true,
        repositories: [
          {
            path: "/Users/grop/ws/CodeGraph",
            strategy: "single",
            command: "npm run lint",
            watch: false,
          },
        ],
        includeSnippets: true,
      };

      const service = new LintService(config, eventBus);
      expect((service as any).config.includeSnippets).toBe(true);
    });
  });

  describe("TestService", () => {
    it("should instantiate with valid config", () => {
      const config: TestServiceConfigV2 = {
        enabled: true,
        repositories: [
          {
            path: "/Users/grop/ws/CodeGraph",
            strategy: "single",
            command: "npm run test",
            watch: false,
          },
        ],
      };

      const service = new TestService(config, eventBus);
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe("TestService");
    });

    it("should run tests and parse results", async () => {
      const config: TestServiceConfigV2 = {
        enabled: true,
        repositories: [
          {
            path: "/Users/grop/ws/CodeGraph",
            strategy: "single",
            command: "npm run test",
            watch: false,
          },
        ],
      };

      const service = new TestService(config, eventBus);

      // Start the service
      await service.start();

      // Run tests
      await service.runTests("/Users/grop/ws/CodeGraph");

      // Wait a bit for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have captured events
      const stateEvents = capturedEvents.filter(
        (e) => e.type === "SERVICE_STATE_CHANGED",
      );
      expect(stateEvents.length).toBeGreaterThan(0);

      // Stop the service
      await service.stop();
    }, 30000); // 30 second timeout for running actual tests
  });

  describe("Event Publishing", () => {
    it("should publish SERVICE_STATE_CHANGED events", async () => {
      const config: TypeCheckServiceConfig = {
        enabled: true,
        repositories: [
          {
            path: "/Users/grop/ws/CodeGraph",
            strategy: "single",
            command: "npx tsc --noEmit",
            watch: false,
          },
        ],
      };

      const service = new TypeCheckService(config, eventBus);
      await service.start();
      await service.checkRepository("/Users/grop/ws/CodeGraph");

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 200));

      const stateEvents = capturedEvents.filter(
        (e) => e.type === "SERVICE_STATE_CHANGED",
      );

      expect(stateEvents.length).toBeGreaterThan(0);

      // Check event structure
      const firstEvent = stateEvents[0];
      expect(firstEvent.event).toHaveProperty("service");
      expect(firstEvent.event).toHaveProperty("state");
      expect(firstEvent.event).toHaveProperty("timestamp");
      expect(firstEvent.source).toBe("typecheck");

      await service.stop();
    });

    it("should include metadata in events", async () => {
      const config: TestServiceConfigV2 = {
        enabled: true,
        repositories: [
          {
            path: "/Users/grop/ws/CodeGraph",
            strategy: "single",
            command: "npm run test",
            watch: false,
          },
        ],
      };

      const service = new TestService(config, eventBus);
      await service.start();
      await service.runTests("/Users/grop/ws/CodeGraph");

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 200));

      const stateEvents = capturedEvents.filter(
        (e) => e.type === "SERVICE_STATE_CHANGED",
      );

      expect(stateEvents.length).toBeGreaterThan(0);

      // Check metadata exists
      const eventWithMetadata = stateEvents.find((e) => e.event.metadata);
      if (eventWithMetadata) {
        expect(eventWithMetadata.event.metadata).toHaveProperty("repository");
      }

      await service.stop();
    }, 30000); // 30 second timeout for running actual tests
  });
});
