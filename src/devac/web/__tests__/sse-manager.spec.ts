// src/devac/web/__tests__/sse-manager.spec.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Response } from "express";
import { SSEManager, createSSEManager } from "../sse-manager.js";
import { EventBus } from "../../orchestrator/event-bus.js";
import { ServiceRegistry } from "../../orchestrator/service-registry.js";
import type { ServiceConfig } from "../../types/service.js";

describe("SSEManager", () => {
  let eventBus: EventBus;
  let registry: ServiceRegistry;
  let sseManager: SSEManager;

  beforeEach(() => {
    eventBus = new EventBus();
    registry = new ServiceRegistry(eventBus);
    sseManager = createSSEManager(eventBus, registry);
  });

  afterEach(() => {
    sseManager.stop();
  });

  describe("Client Connection Management", () => {
    it("should accept new SSE client connections", () => {
      const mockRes = createMockResponse();
      const clientId = "test-client-1";
      sseManager.addClient(clientId, mockRes);

      const stats = sseManager.getStats();
      expect(stats.connectedClients).toBe(1);
    });

    it("should handle multiple client connections", () => {
      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();

      sseManager.addClient("client-1", mockRes1);
      sseManager.addClient("client-2", mockRes2);

      expect(sseManager.getStats().connectedClients).toBe(2);
    });

    it("should remove clients when disconnected", () => {
      const mockRes = createMockResponse();
      const clientId = "test-client";
      sseManager.addClient(clientId, mockRes);

      expect(sseManager.getStats().connectedClients).toBe(1);

      sseManager.removeClient(clientId);

      expect(sseManager.getStats().connectedClients).toBe(0);
    });

    it("should send connection confirmation to new clients", () => {
      const mockRes = createMockResponse();
      sseManager.addClient("test-client", mockRes);

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining("event: connection"),
      );
      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining("clientId"),
      );
    });
  });

  describe("Event Broadcasting", () => {
    it("should broadcast events to all connected clients", () => {
      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();

      sseManager.addClient("client-1", mockRes1);
      sseManager.addClient("client-2", mockRes2);

      // Clear previous calls
      vi.clearAllMocks();

      // Start the manager to enable broadcasting
      sseManager.start();

      // Publish an event
      eventBus.publish({
        type: "SERVICE_STARTED",
        serviceId: "test-service",
        timestamp: new Date().toISOString(),
      });

      // Give event bus time to process
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(mockRes1.write).toHaveBeenCalled();
          expect(mockRes2.write).toHaveBeenCalled();
          resolve();
        }, 100);
      });
    });

    it("should not broadcast events when stopped", () => {
      const mockRes = createMockResponse();
      sseManager.addClient("client-1", mockRes);

      sseManager.start();
      sseManager.stop();

      // Clear previous calls
      vi.clearAllMocks();

      // Publish an event
      eventBus.publish({
        type: "SERVICE_STARTED",
        serviceId: "test-service",
        timestamp: new Date().toISOString(),
      });

      // Give time for potential processing
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // Should not have written any events
          expect(mockRes.write).not.toHaveBeenCalled();
          resolve();
        }, 100);
      });
    });
  });

  describe("Heartbeat Mechanism", () => {
    it("should send heartbeat to all connected clients", () => {
      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();

      sseManager.addClient("client-1", mockRes1);
      sseManager.addClient("client-2", mockRes2);

      // Clear connection messages
      vi.clearAllMocks();

      sseManager.sendHeartbeat();

      expect(mockRes1.write).toHaveBeenCalledWith(
        expect.stringContaining("event: heartbeat"),
      );
      expect(mockRes2.write).toHaveBeenCalledWith(
        expect.stringContaining("event: heartbeat"),
      );
    });

    it("should include timestamp in heartbeat", () => {
      const mockRes = createMockResponse();
      sseManager.addClient("client-1", mockRes);

      vi.clearAllMocks();

      sseManager.sendHeartbeat();

      const writeCall = mockRes.write.mock.calls.find((call) =>
        call[0].includes("event: heartbeat"),
      );

      expect(writeCall).toBeDefined();
      expect(writeCall![0]).toContain("timestamp");
    });

    it("should start automatic heartbeats when started", () => {
      vi.useFakeTimers();

      const mockRes = createMockResponse();
      sseManager.addClient("test-client", mockRes);

      sseManager.start();

      vi.clearAllMocks();

      // Advance time by 30 seconds (heartbeat interval)
      vi.advanceTimersByTime(30000);

      expect(mockRes.write).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("should stop heartbeats when stopped", () => {
      vi.useFakeTimers();

      const mockRes = createMockResponse();
      sseManager.addClient("test-client", mockRes);

      sseManager.start();
      sseManager.stop();

      vi.clearAllMocks();

      // Advance time - should not send heartbeat
      vi.advanceTimersByTime(30000);

      expect(mockRes.write).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe("Status Snapshot Broadcasting", () => {
    it("should broadcast status snapshots when registry is available", () => {
      vi.useFakeTimers();

      const mockRes = createMockResponse();
      sseManager.addClient("test-client", mockRes);

      // Register a test service
      const serviceConfig: ServiceConfig = {
        id: "test-service",
        name: "Test Service",
        type: "codegraph",
        enabled: true,
        config: {},
      };

      // Create mock actor with getSnapshot method
      const mockActor = {
        getSnapshot: () => ({
          context: {
            status: "watching" as const,
            health: "healthy" as const,
            stats: {
              itemsProcessed: 0,
              nodesCreated: 0,
              relationshipsCreated: 0,
              duration: 0,
              errors: 0,
              warnings: 0,
            },
            error: undefined,
          },
        }),
      };

      registry.register(serviceConfig.id, mockActor as any, serviceConfig);

      sseManager.start();

      vi.clearAllMocks();

      // Advance time by 5 seconds (status snapshot interval)
      vi.advanceTimersByTime(5000);

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining("event: status"),
      );

      vi.useRealTimers();
    });

    it("should include service list in status snapshot", () => {
      vi.useFakeTimers();

      const mockRes = createMockResponse();
      sseManager.addClient("test-client", mockRes);

      // Register multiple services
      const services = [
        { id: "service-1", name: "Service 1", type: "codegraph" as const },
        { id: "service-2", name: "Service 2", type: "git" as const },
      ];

      // Create mock actor factory
      const createMockActor = () => ({
        getSnapshot: () => ({
          context: {
            status: "watching" as const,
            health: "healthy" as const,
            stats: {
              itemsProcessed: 0,
              nodesCreated: 0,
              relationshipsCreated: 0,
              duration: 0,
              errors: 0,
              warnings: 0,
            },
            error: undefined,
          },
        }),
      });

      services.forEach((svc) => {
        const config = { ...svc, enabled: true, config: {} };
        registry.register(svc.id, createMockActor() as any, config);
      });

      sseManager.start();

      vi.clearAllMocks();

      vi.advanceTimersByTime(5000);

      // Should have status event writes
      const statusWrites = mockRes.write.mock.calls.filter((call) =>
        call[0].includes("event: status"),
      );

      expect(statusWrites.length).toBeGreaterThan(0);

      vi.useRealTimers();
    });

    it("should include summary statistics in status snapshot", () => {
      vi.useFakeTimers();

      const mockRes = createMockResponse();
      sseManager.addClient("test-client", mockRes);

      // Register a service with mock actor
      const mockActor = {
        getSnapshot: () => ({
          context: {
            status: "watching" as const,
            health: "healthy" as const,
            stats: {
              itemsProcessed: 0,
              nodesCreated: 0,
              relationshipsCreated: 0,
              duration: 0,
              errors: 0,
              warnings: 0,
            },
            error: undefined,
          },
        }),
      };

      const serviceConfig = {
        id: "test-service",
        name: "Test",
        type: "codegraph",
        enabled: true,
        config: {},
      };

      registry.register("test-service", mockActor as any, serviceConfig);

      sseManager.start();

      vi.clearAllMocks();

      vi.advanceTimersByTime(5000);

      const statusWrites = mockRes.write.mock.calls.filter((call) =>
        call[0].includes("event: status"),
      );

      expect(statusWrites.length).toBeGreaterThan(0);

      // Check that the status data contains summary fields
      const statusData = statusWrites[0][0];
      expect(statusData).toContain("summary");
      expect(statusData).toContain("total");

      vi.useRealTimers();
    });

    it("should not broadcast status snapshots without registry", () => {
      vi.useFakeTimers();

      // Create SSE manager without registry
      const sseWithoutRegistry = createSSEManager(eventBus);
      const mockRes = createMockResponse();
      sseWithoutRegistry.addClient("test-client", mockRes);

      sseWithoutRegistry.start();

      vi.clearAllMocks();

      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000);

      // Should not have sent status events
      const statusCalls = mockRes.write.mock.calls.filter((call) =>
        call[0].includes("event: status"),
      );
      expect(statusCalls.length).toBe(0);

      sseWithoutRegistry.stop();
      vi.useRealTimers();
    });

    it("should stop status snapshots when stopped", () => {
      vi.useFakeTimers();

      const mockRes = createMockResponse();
      sseManager.addClient("test-client", mockRes);

      sseManager.start();
      sseManager.stop();

      vi.clearAllMocks();

      // Advance time - should not send status snapshot
      vi.advanceTimersByTime(5000);

      expect(mockRes.write).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe("Error Handling", () => {
    it("should handle client write errors gracefully", () => {
      const mockRes = createMockResponse();

      // Add client normally
      sseManager.addClient("error-client", mockRes);

      // Verify client was added
      expect(sseManager.getStats().connectedClients).toBe(1);

      // Clear the connection message calls
      vi.clearAllMocks();

      // Make write fail for future writes
      mockRes.write.mockImplementation(() => {
        throw new Error("Write failed");
      });

      // Should not throw when sending heartbeat (error is caught internally)
      expect(() => sseManager.sendHeartbeat()).not.toThrow();
    });

    it("should handle registry errors in status snapshots", () => {
      vi.useFakeTimers();

      const mockRes = createMockResponse();
      sseManager.addClient("test-client", mockRes);

      // Create a registry that throws on getAllMetadata
      const brokenRegistry = {
        getAllMetadata: () => {
          throw new Error("Registry failure");
        },
      } as any;

      const brokenSSE = createSSEManager(eventBus, brokenRegistry);
      brokenSSE.addClient("test-client", mockRes);
      brokenSSE.start();

      vi.clearAllMocks();

      // Should not throw
      expect(() => vi.advanceTimersByTime(5000)).not.toThrow();

      brokenSSE.stop();
      vi.useRealTimers();
    });
  });

  describe("Statistics", () => {
    it("should track client count accurately", () => {
      expect(sseManager.getStats().connectedClients).toBe(0);

      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();

      sseManager.addClient("client-1", mockRes1);
      expect(sseManager.getStats().connectedClients).toBe(1);

      sseManager.addClient("client-2", mockRes2);
      expect(sseManager.getStats().connectedClients).toBe(2);

      sseManager.removeClient("client-1");
      expect(sseManager.getStats().connectedClients).toBe(1);

      sseManager.removeClient("client-2");
      expect(sseManager.getStats().connectedClients).toBe(0);
    });

    it("should track total messages sent", () => {
      const mockRes = createMockResponse();
      sseManager.addClient("test-client", mockRes);

      const initialStats = sseManager.getStats();

      sseManager.sendHeartbeat();

      const updatedStats = sseManager.getStats();
      expect(updatedStats.totalEventsSent).toBeGreaterThan(
        initialStats.totalEventsSent,
      );
    });
  });

  describe("Cleanup", () => {
    it("should clean up all resources on stop", () => {
      vi.useFakeTimers();

      const mockRes = createMockResponse();
      sseManager.addClient("test-client", mockRes);

      sseManager.start();
      sseManager.stop();

      vi.clearAllMocks();

      // Advance time - nothing should happen
      vi.advanceTimersByTime(60000);

      expect(mockRes.write).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("should handle multiple stop calls safely", () => {
      sseManager.start();

      expect(() => {
        sseManager.stop();
        sseManager.stop();
        sseManager.stop();
      }).not.toThrow();
    });

    it("should close all client connections on stop", () => {
      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();

      sseManager.addClient("client-1", mockRes1);
      sseManager.addClient("client-2", mockRes2);

      expect(sseManager.getStats().connectedClients).toBe(2);

      sseManager.stop();

      expect(sseManager.getStats().connectedClients).toBe(0);
    });
  });

  describe("Factory Function", () => {
    it("should create SSE manager with event bus only", () => {
      const manager = createSSEManager(eventBus);
      expect(manager).toBeInstanceOf(SSEManager);
      manager.stop();
    });

    it("should create SSE manager with event bus and registry", () => {
      const manager = createSSEManager(eventBus, registry);
      expect(manager).toBeInstanceOf(SSEManager);
      manager.stop();
    });
  });
});

// Helper function to create mock Express Response
function createMockResponse(): Response {
  const closeHandlers: Array<() => void> = [];

  return {
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "close") {
        closeHandlers.push(handler);
      }
    }),
    writeHead: vi.fn(),
    setHeader: vi.fn(),
    // Helper to simulate client disconnect
    _simulateClose: () => {
      closeHandlers.forEach((handler) => handler());
    },
  } as any;
}
