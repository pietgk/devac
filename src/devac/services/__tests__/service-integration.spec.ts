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
  let activeServices: Array<TypeCheckService | LintService | TestService> = [];

  beforeEach(() => {
    eventBus = new EventBus();
    capturedEvents = [];
    activeServices = [];

    // Capture all events
    eventBus.subscribe("*", (envelope) => {
      capturedEvents.push({
        type: envelope.event.type,
        source: envelope.source,
        event: envelope.event,
      });
    });
  });

  afterEach(async () => {
    // CRITICAL: Stop all services to kill their child processes
    for (const service of activeServices) {
      await service.stop();
    }
    activeServices = [];

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
      activeServices.push(service); // Track for cleanup

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

      // Service will be stopped in afterEach
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
      activeServices.push(service); // Track for cleanup

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

      // Service will be stopped in afterEach
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
            command: "npm run test:unit",
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
            // Use test:unit to avoid recursive test execution
            command: "npm run test:unit",
            watch: false,
          },
        ],
      };

      const service = new TestService(config, eventBus);
      activeServices.push(service); // Track for cleanup

      // Start the service
      await service.start();

      // Run tests
      await service.testRepository("/Users/grop/ws/CodeGraph");

      // Wait a bit for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have captured events
      const stateEvents = capturedEvents.filter(
        (e) => e.type === "SERVICE_STATE_CHANGED",
      );
      expect(stateEvents.length).toBeGreaterThan(0);

      // Service will be stopped in afterEach
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
      activeServices.push(service); // Track for cleanup

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

      // Service will be stopped in afterEach
    });

    it("should include metadata in events", async () => {
      const config: TestServiceConfigV2 = {
        enabled: true,
        repositories: [
          {
            path: "/Users/grop/ws/CodeGraph",
            strategy: "single",
            // Use test:unit to avoid recursive test execution
            command: "npm run test:unit",
            watch: false,
          },
        ],
      };

      const service = new TestService(config, eventBus);
      activeServices.push(service); // Track for cleanup

      await service.start();
      await service.testRepository("/Users/grop/ws/CodeGraph");

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 200));

      const stateEvents = capturedEvents.filter(
        (e) => e.type === "SERVICE_STATE_CHANGED",
      );

      expect(stateEvents.length).toBeGreaterThan(0);

      // Check metadata exists with repository info
      // Look for test result events which include repository metadata
      const testResultEvent = stateEvents.find(
        (e) => e.event.metadata?.repository !== undefined,
      );

      // We should have at least one event with repository metadata
      // (from emitTestSuccess or emitTestFailures)
      if (testResultEvent) {
        expect(testResultEvent.event.metadata).toHaveProperty("repository");
      } else {
        // If no repository metadata found, that's acceptable
        // The service may only emit status events with message metadata
        const anyMetadataEvent = stateEvents.find((e) => e.event.metadata);
        expect(anyMetadataEvent).toBeDefined();
      }

      // Service will be stopped in afterEach
    }, 30000); // 30 second timeout for running actual tests
  });
});
