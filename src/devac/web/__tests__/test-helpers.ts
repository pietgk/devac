// src/devac/web/__tests__/test-helpers.ts

import { EventBus } from "../../orchestrator/event-bus.js";
import { ServiceRegistry } from "../../orchestrator/service-registry.js";
import { createActor, setup, assign } from "xstate";
import type { ServiceActorRef } from "../../services/base-service.js";

/**
 * Create a mock service actor for testing
 */
export function createMockServiceActor(serviceId: string) {
  const machine = setup({
    types: {
      context: {} as {
        status: "idle" | "starting" | "running" | "stopping" | "stopped" | "error";
        health: "healthy" | "unhealthy" | "unknown";
        stats: {
          uptime: number;
          requestCount: number;
        };
        error?: Error;
      },
      events: {} as
        | { type: "START" }
        | { type: "STOP"; graceful?: boolean }
        | { type: "HEALTH_CHECK" }
        | { type: "ERROR"; error: Error },
    },
  }).createMachine({
    id: serviceId,
    initial: "idle",
    context: {
      status: "idle",
      health: "unknown",
      stats: {
        uptime: 0,
        requestCount: 0,
      },
    },
    states: {
      idle: {
        on: {
          START: {
            target: "starting",
            actions: assign({
              status: "starting",
            }),
          },
        },
      },
      starting: {
        after: {
          100: {
            target: "running",
            actions: assign({
              status: "running",
              health: "healthy",
            }),
          },
        },
      },
      running: {
        on: {
          STOP: {
            target: "stopping",
            actions: assign({
              status: "stopping",
            }),
          },
          HEALTH_CHECK: {
            actions: assign({
              health: "healthy",
            }),
          },
          ERROR: {
            target: "error",
            actions: assign({
              status: "error",
              health: "unhealthy",
              error: ({ event }) => event.error,
            }),
          },
        },
      },
      stopping: {
        after: {
          100: {
            target: "stopped",
            actions: assign({
              status: "stopped",
            }),
          },
        },
      },
      stopped: {
        type: "final",
      },
      error: {
        on: {
          START: "starting",
          STOP: "stopping",
        },
      },
    },
  });

  const actor = createActor(machine);
  actor.start();

  return actor as unknown as ServiceActorRef;
}

/**
 * Create a mock orchestrator for testing
 */
export function createMockOrchestrator() {
  const eventBus = new EventBus();
  const registry = new ServiceRegistry();

  // Create test services
  const testService1 = createMockServiceActor("test-service-1");
  const testService2 = createMockServiceActor("test-service-2");

  registry.register("test-service-1", testService1, {
    id: "test-service-1",
    name: "Test Service 1",
    type: "custom",
    enabled: true,
    config: {},
  });

  registry.register("test-service-2", testService2, {
    id: "test-service-2",
    name: "Test Service 2",
    type: "neo4j",
    enabled: true,
    config: {},
  });

  return {
    eventBus,
    registry,
    isRunning: () => true,
    getRegistry: () => registry,
    getEventBus: () => eventBus,
    getStatus: () => ({
      status: "running",
      startedAt: new Date().toISOString(),
      serviceCount: registry.count(),
    }),
  };
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();

  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error("waitFor timeout exceeded");
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Create a mock SSE client for testing
 */
export class MockSSEClient {
  private messages: any[] = [];
  private listeners: Map<string, Function[]> = new Map();

  onMessage(handler: (data: any) => void): void {
    if (!this.listeners.has("message")) {
      this.listeners.set("message", []);
    }
    this.listeners.get("message")!.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    if (!this.listeners.has("error")) {
      this.listeners.set("error", []);
    }
    this.listeners.get("error")!.push(handler);
  }

  simulateMessage(data: any): void {
    this.messages.push(data);
    const handlers = this.listeners.get("message") || [];
    handlers.forEach((handler) => handler(data));
  }

  simulateError(error: Error): void {
    const handlers = this.listeners.get("error") || [];
    handlers.forEach((handler) => handler(error));
  }

  getMessages(): any[] {
    return [...this.messages];
  }

  close(): void {
    this.listeners.clear();
    this.messages = [];
  }
}
