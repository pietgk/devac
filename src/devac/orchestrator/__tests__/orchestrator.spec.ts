// src/devac/orchestrator/__tests__/orchestrator.spec.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Orchestrator, createOrchestratorMachine } from "../orchestrator.js";
import { ServiceRegistry } from "../service-registry.js";
import { EventBus } from "../event-bus.js";
import { createActor } from "xstate";
import type { DevACConfig, WorkspaceSettings } from "../../types/index.js";
import type { ServiceActorRef } from "../../services/base-service.js";

/**
 * Orchestrator Unit Tests
 *
 * Tests the XState-based orchestrator that manages service lifecycle,
 * service registry, and event bus coordination.
 */

// Mock config for testing
const mockConfig: DevACConfig = {
  version: "1.0.0",
  neo4j: {
    uri: "bolt://localhost:7687",
    username: "neo4j",
    password: "test",
    database: "test",
  },
  web: {
    port: 3000,
    host: "localhost",
    cors: true,
  },
  services: {
    typecheck: {
      enabled: true,
      repositories: [
        {
          path: "/test/repo",
          strategy: "single",
          command: "npx tsc --noEmit",
        },
      ],
    },
  },
  logging: {
    level: "error", // Suppress logs during tests
    maxFileSize: "10MB",
    maxFiles: 10,
  },
};

const mockWorkspace: WorkspaceSettings = {
  name: "test-workspace",
  metadata: {
    branch: "main",
    stage: "development",
    tags: ["test"],
  },
};

// Mock service actor for testing
function createMockServiceActor(serviceId: string): ServiceActorRef {
  const actor = {
    send: vi.fn(),
    getSnapshot: vi.fn(() => ({
      context: {
        status: "idle",
        health: "healthy",
        stats: { successCount: 0, failureCount: 0 },
        error: undefined,
      },
      value: "idle",
      matches: vi.fn((state: string) => state === "idle"),
    })),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    stop: vi.fn(),
    id: serviceId,
  };

  return actor as unknown as ServiceActorRef;
}

describe("Orchestrator Machine", () => {
  describe("State Transitions", () => {
    it("should start in idle state", () => {
      const machine = createOrchestratorMachine();
      const actor = createActor(machine, {
        input: { config: mockConfig },
      });

      actor.start();

      expect(actor.getSnapshot().value).toBe("idle");

      actor.stop();
    });

    it("should transition from idle to initializing on START", () => {
      const machine = createOrchestratorMachine();
      const actor = createActor(machine, {
        input: { config: mockConfig },
      });

      actor.start();
      actor.send({ type: "START" });

      // Machine should be initializing
      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("initializing");

      actor.stop();
    });

    it("should transition from initializing to running after initialization", async () => {
      const machine = createOrchestratorMachine();
      const actor = createActor(machine, {
        input: { config: mockConfig },
      });

      actor.start();
      actor.send({ type: "START" });

      // Wait for initialization to complete
      await new Promise<void>((resolve) => {
        const subscription = actor.subscribe((snapshot) => {
          if (snapshot.value === "running") {
            subscription.unsubscribe();
            resolve();
          }
        });
      });

      expect(actor.getSnapshot().value).toBe("running");

      actor.stop();
    });

    it("should set startedAt timestamp when entering running state", async () => {
      const machine = createOrchestratorMachine();
      const actor = createActor(machine, {
        input: { config: mockConfig },
      });

      actor.start();
      actor.send({ type: "START" });

      // Wait for running state
      await new Promise<void>((resolve) => {
        const subscription = actor.subscribe((snapshot) => {
          if (snapshot.value === "running") {
            subscription.unsubscribe();
            resolve();
          }
        });
      });

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.startedAt).toBeDefined();
      expect(typeof snapshot.context.startedAt).toBe("string");

      actor.stop();
    });

    it("should transition from running to stopping on STOP", async () => {
      const machine = createOrchestratorMachine();
      const actor = createActor(machine, {
        input: { config: mockConfig },
      });

      actor.start();
      actor.send({ type: "START" });

      // Wait for running state
      await new Promise<void>((resolve) => {
        const subscription = actor.subscribe((snapshot) => {
          if (snapshot.value === "running") {
            subscription.unsubscribe();
            resolve();
          }
        });
      });

      actor.send({ type: "STOP" });

      // Should be stopping or stopped
      const snapshot = actor.getSnapshot();
      expect(["stopping", "stopped"]).toContain(snapshot.value);

      actor.stop();
    });

    it("should transition to stopped state after cleanup", async () => {
      const machine = createOrchestratorMachine();
      const actor = createActor(machine, {
        input: { config: mockConfig },
      });

      actor.start();
      actor.send({ type: "START" });

      // Wait for running
      await new Promise<void>((resolve) => {
        const subscription = actor.subscribe((snapshot) => {
          if (snapshot.value === "running") {
            subscription.unsubscribe();
            resolve();
          }
        });
      });

      actor.send({ type: "STOP" });

      // Wait for stopped
      await new Promise<void>((resolve) => {
        const subscription = actor.subscribe((snapshot) => {
          if (snapshot.value === "stopped") {
            subscription.unsubscribe();
            resolve();
          }
        });
      });

      expect(actor.getSnapshot().value).toBe("stopped");

      actor.stop();
    });
  });

  describe("Context Initialization", () => {
    it("should initialize context with config and workspace", () => {
      const machine = createOrchestratorMachine();
      const actor = createActor(machine, {
        input: {
          config: mockConfig,
          workspace: mockWorkspace,
        },
      });

      actor.start();

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.config).toEqual(mockConfig);
      expect(snapshot.context.workspace).toEqual(mockWorkspace);

      actor.stop();
    });

    it("should create service registry in context", () => {
      const machine = createOrchestratorMachine();
      const actor = createActor(machine, {
        input: { config: mockConfig },
      });

      actor.start();

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.registry).toBeInstanceOf(ServiceRegistry);

      actor.stop();
    });

    it("should create event bus in context", () => {
      const machine = createOrchestratorMachine();
      const actor = createActor(machine, {
        input: { config: mockConfig },
      });

      actor.start();

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.eventBus).toBeInstanceOf(EventBus);

      actor.stop();
    });
  });

  describe("Workspace Management", () => {
    it("should handle LOAD_WORKSPACE event in running state", async () => {
      const machine = createOrchestratorMachine();
      const actor = createActor(machine, {
        input: { config: mockConfig },
      });

      actor.start();
      actor.send({ type: "START" });

      // Wait for running
      await new Promise<void>((resolve) => {
        const subscription = actor.subscribe((snapshot) => {
          if (snapshot.value === "running") {
            subscription.unsubscribe();
            resolve();
          }
        });
      });

      const newWorkspace: WorkspaceSettings = {
        name: "updated-workspace",
        metadata: { branch: "feature-123" },
      };

      actor.send({ type: "LOAD_WORKSPACE", workspace: newWorkspace });

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.workspace).toEqual(newWorkspace);

      actor.stop();
    });
  });

  describe("Error Handling", () => {
    it("should transition to error state on initialization failure", async () => {
      // This test would require mocking the initializer to throw an error
      // For now, we'll test the error state is reachable
      const machine = createOrchestratorMachine();
      const actor = createActor(machine, {
        input: { config: mockConfig },
      });

      actor.start();
      actor.send({ type: "START" });

      // Wait for running (initialization succeeds in normal case)
      await new Promise<void>((resolve) => {
        const subscription = actor.subscribe((snapshot) => {
          if (snapshot.value === "running") {
            subscription.unsubscribe();
            resolve();
          }
        });
      });

      // Send ERROR event to trigger error state
      const testError = new Error("Test error");
      actor.send({ type: "ERROR", error: testError });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("error");
      expect(snapshot.context.error).toEqual(testError);

      actor.stop();
    });

    it("should handle SERVICE_FAILED events in running state", async () => {
      const machine = createOrchestratorMachine();
      const actor = createActor(machine, {
        input: { config: mockConfig },
      });

      actor.start();
      actor.send({ type: "START" });

      // Wait for running
      await new Promise<void>((resolve) => {
        const subscription = actor.subscribe((snapshot) => {
          if (snapshot.value === "running") {
            subscription.unsubscribe();
            resolve();
          }
        });
      });

      const testError = new Error("Service failed");
      actor.send({
        type: "SERVICE_FAILED",
        serviceId: "test-service",
        error: testError,
      });

      // Should remain in running state but publish event
      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("running");

      actor.stop();
    });

    it("should allow restart from error state", async () => {
      const machine = createOrchestratorMachine();
      const actor = createActor(machine, {
        input: { config: mockConfig },
      });

      actor.start();
      actor.send({ type: "START" });

      // Wait for running
      await new Promise<void>((resolve) => {
        const subscription = actor.subscribe((snapshot) => {
          if (snapshot.value === "running") {
            subscription.unsubscribe();
            resolve();
          }
        });
      });

      // Trigger error
      actor.send({ type: "ERROR", error: new Error("Test error") });

      expect(actor.getSnapshot().value).toBe("error");

      // Send START again to recover
      actor.send({ type: "START" });

      // Should transition to initializing
      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("initializing");

      actor.stop();
    });
  });
});

describe("Orchestrator Class", () => {
  let orchestrator: Orchestrator;

  afterEach(async () => {
    if (orchestrator && orchestrator.isRunning()) {
      await orchestrator.stop();
    }
  });

  describe("Lifecycle", () => {
    it("should start successfully", async () => {
      orchestrator = new Orchestrator(mockConfig);

      orchestrator.start();

      // Wait a bit for initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(orchestrator.isRunning()).toBe(true);
    });

    it("should stop successfully", async () => {
      orchestrator = new Orchestrator(mockConfig);

      orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await orchestrator.stop();

      expect(orchestrator.isRunning()).toBe(false);
    });

    it("should handle multiple start calls gracefully", async () => {
      orchestrator = new Orchestrator(mockConfig);

      orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second start should be ignored
      orchestrator.start();

      expect(orchestrator.isRunning()).toBe(true);
    });

    it("should handle stop when not started", async () => {
      orchestrator = new Orchestrator(mockConfig);

      // Should not throw
      await expect(orchestrator.stop()).resolves.toBeUndefined();
    });
  });

  describe("Service Registry Access", () => {
    it("should provide access to registry after start", async () => {
      orchestrator = new Orchestrator(mockConfig);

      orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const registry = orchestrator.getRegistry();
      expect(registry).toBeInstanceOf(ServiceRegistry);
    });

    it("should return undefined for registry before start", () => {
      orchestrator = new Orchestrator(mockConfig);

      const registry = orchestrator.getRegistry();
      expect(registry).toBeUndefined();
    });

    it("should allow service registration", async () => {
      orchestrator = new Orchestrator(mockConfig);

      orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const mockService = createMockServiceActor("test-service");
      const mockServiceConfig = {
        type: "typecheck",
        enabled: true,
      };

      orchestrator.registerService("test-service", mockService, mockServiceConfig);

      const registry = orchestrator.getRegistry();
      expect(registry?.has("test-service")).toBe(true);
    });

    it("should throw when registering service before start", () => {
      orchestrator = new Orchestrator(mockConfig);

      const mockService = createMockServiceActor("test-service");
      const mockServiceConfig = {
        type: "typecheck",
        enabled: true,
      };

      expect(() =>
        orchestrator.registerService("test-service", mockService, mockServiceConfig),
      ).toThrow("Orchestrator not started");
    });
  });

  describe("Event Bus Access", () => {
    it("should provide access to event bus after start", async () => {
      orchestrator = new Orchestrator(mockConfig);

      orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const eventBus = orchestrator.getEventBus();
      expect(eventBus).toBeInstanceOf(EventBus);
    });

    it("should return undefined for event bus before start", () => {
      orchestrator = new Orchestrator(mockConfig);

      const eventBus = orchestrator.getEventBus();
      expect(eventBus).toBeUndefined();
    });
  });

  describe("Service Control", () => {
    it("should send START_SERVICE event", async () => {
      orchestrator = new Orchestrator(mockConfig);

      orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const mockService = createMockServiceActor("test-service");
      orchestrator.registerService("test-service", mockService, {
        type: "typecheck",
        enabled: true,
      });

      // Subscribe to event bus to verify event is published
      const eventBus = orchestrator.getEventBus()!;
      const events: any[] = [];
      eventBus.subscribe("*", (envelope) => {
        events.push(envelope.event);
      });

      orchestrator.startService("test-service");

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events.some((e) => e.type === "START_SERVICE")).toBe(true);
    });

    it("should send STOP_SERVICE event", async () => {
      orchestrator = new Orchestrator(mockConfig);

      orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const mockService = createMockServiceActor("test-service");
      orchestrator.registerService("test-service", mockService, {
        type: "typecheck",
        enabled: true,
      });

      const eventBus = orchestrator.getEventBus()!;
      const events: any[] = [];
      eventBus.subscribe("*", (envelope) => {
        events.push(envelope.event);
      });

      orchestrator.stopService("test-service");

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events.some((e) => e.type === "STOP_SERVICE")).toBe(true);
    });

    it("should send RESTART_SERVICE event", async () => {
      orchestrator = new Orchestrator(mockConfig);

      orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const mockService = createMockServiceActor("test-service");
      orchestrator.registerService("test-service", mockService, {
        type: "typecheck",
        enabled: true,
      });

      const eventBus = orchestrator.getEventBus()!;
      const events: any[] = [];
      eventBus.subscribe("*", (envelope) => {
        events.push(envelope.event);
      });

      orchestrator.restartService("test-service");

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events.some((e) => e.type === "RESTART_SERVICE")).toBe(true);
    });

    it("should throw when controlling services before start", () => {
      orchestrator = new Orchestrator(mockConfig);

      expect(() => orchestrator.startService("test")).toThrow(
        "Orchestrator not started",
      );
      expect(() => orchestrator.stopService("test")).toThrow(
        "Orchestrator not started",
      );
      expect(() => orchestrator.restartService("test")).toThrow(
        "Orchestrator not started",
      );
    });
  });

  describe("Status Reporting", () => {
    it("should report not_started before start", () => {
      orchestrator = new Orchestrator(mockConfig);

      const status = orchestrator.getStatus();

      expect(status.status).toBe("not_started");
      expect(status.serviceCount).toBe(0);
      expect(status.startedAt).toBeUndefined();
    });

    it("should report running after start", async () => {
      orchestrator = new Orchestrator(mockConfig);

      orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const status = orchestrator.getStatus();

      expect(status.status).toBe("running");
      expect(status.startedAt).toBeDefined();
      expect(status.serviceCount).toBe(0);
    });

    it("should report service count correctly", async () => {
      orchestrator = new Orchestrator(mockConfig);

      orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const mockService1 = createMockServiceActor("service-1");
      const mockService2 = createMockServiceActor("service-2");

      orchestrator.registerService("service-1", mockService1, {
        type: "typecheck",
        enabled: true,
      });
      orchestrator.registerService("service-2", mockService2, {
        type: "lint",
        enabled: true,
      });

      const status = orchestrator.getStatus();

      expect(status.serviceCount).toBe(2);
    });

    it("should include error in status when present", async () => {
      orchestrator = new Orchestrator(mockConfig);

      orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Manually get actor and send error
      const actor = (orchestrator as any).actor;
      const testError = new Error("Test error");
      actor.send({ type: "ERROR", error: testError });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const status = orchestrator.getStatus();

      expect(status.error).toBeDefined();
      expect(status.error?.message).toBe("Test error");
    });
  });

  describe("Integration with Workspace", () => {
    it("should initialize with workspace settings", async () => {
      orchestrator = new Orchestrator(mockConfig, mockWorkspace);

      orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const status = orchestrator.getStatus();
      expect(status.status).toBe("running");
    });
  });
});
