// src/devac/cli/__tests__/devac-client.spec.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DevACClient } from "../api/devac-client.js";
import type { ServiceMetadata } from "../api/devac-client.js";

/**
 * DevAC Client Tests
 *
 * Tests the API client that communicates with the DevAC web server.
 */

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe("DevACClient", () => {
  let client: DevACClient;

  beforeEach(() => {
    client = new DevACClient("http://localhost:3000", 5000);
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Constructor", () => {
    it("should create client with default URL", () => {
      const defaultClient = new DevACClient();
      expect(defaultClient).toBeDefined();
    });

    it("should remove trailing slash from URL", () => {
      const clientWithSlash = new DevACClient("http://localhost:3000/");
      expect(clientWithSlash).toBeDefined();
    });
  });

  describe("isServerRunning", () => {
    it("should return true when server is accessible", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await client.isServerRunning();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/services",
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it("should return false when server is not accessible", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await client.isServerRunning();

      expect(result).toBe(false);
    });

    it("should return false when request times out", async () => {
      // Mock AbortController to simulate timeout
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";

      mockFetch.mockRejectedValueOnce(abortError);

      const result = await client.isServerRunning();

      expect(result).toBe(false);
    });
  });

  describe("getServices", () => {
    it("should fetch and return services list", async () => {
      const mockServices: ServiceMetadata[] = [
        {
          id: "service-1",
          name: "TypeCheck Service",
          type: "typecheck",
          enabled: true,
          status: "running",
          health: "healthy",
          stats: {
            successCount: 10,
            failureCount: 0,
          },
          version: "1.0.0",
        },
        {
          id: "service-2",
          name: "Lint Service",
          type: "lint",
          enabled: true,
          status: "running",
          health: "degraded",
          stats: {
            successCount: 8,
            failureCount: 2,
          },
          version: "1.0.0",
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServices,
      });

      const result = await client.getServices();

      expect(result).toEqual(mockServices);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/services",
        expect.any(Object),
      );
    });

    it("should throw error when fetch fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
      });

      await expect(client.getServices()).rejects.toThrow(
        "Failed to fetch services: Internal Server Error",
      );
    });

    it("should throw connection error with helpful message", async () => {
      mockFetch.mockRejectedValueOnce({
        code: "ECONNREFUSED",
        message: "connect ECONNREFUSED",
      });

      await expect(client.getServices()).rejects.toThrow(
        "Cannot connect to DevAC server at http://localhost:3000. Is it running?",
      );
    });
  });

  describe("getServiceDetails", () => {
    it("should fetch service details", async () => {
      const mockDetails = {
        id: "service-1",
        name: "TypeCheck Service",
        type: "typecheck",
        enabled: true,
        status: "running",
        health: "healthy",
        stats: {
          successCount: 10,
          failureCount: 0,
        },
        config: {
          repositories: [
            { path: "/test/repo", strategy: "single", command: "tsc" },
          ],
        },
        version: "1.0.0",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDetails,
      });

      const result = await client.getServiceDetails("service-1");

      expect(result).toEqual(mockDetails);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/services/service-1",
        expect.any(Object),
      );
    });

    it("should throw error for non-existent service", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(client.getServiceDetails("non-existent")).rejects.toThrow(
        "Service not found: non-existent",
      );
    });
  });

  describe("getServiceHealth", () => {
    it("should fetch service health", async () => {
      const mockHealth = {
        serviceId: "service-1",
        health: "healthy",
        status: "running",
        timestamp: new Date().toISOString(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockHealth,
      });

      const result = await client.getServiceHealth("service-1");

      expect(result).toEqual(mockHealth);
    });

    it("should handle 503 for unhealthy services", async () => {
      const mockHealth = {
        serviceId: "service-1",
        health: "unhealthy",
        status: "error",
        lastError: { message: "Service error" },
        timestamp: new Date().toISOString(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => mockHealth,
      });

      const result = await client.getServiceHealth("service-1");

      expect(result).toEqual(mockHealth);
    });
  });

  describe("Service Control", () => {
    it("should start a service", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: "Service started" }),
      });

      await expect(client.startService("service-1")).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/services/service-1/start",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    it("should stop a service", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: "Service stopped" }),
      });

      await expect(client.stopService("service-1")).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/services/service-1/stop",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ graceful: true }),
        }),
      );
    });

    it("should stop a service forcefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: "Service stopped" }),
      });

      await client.stopService("service-1", false);

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.graceful).toBe(false);
    });

    it("should restart a service", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: "Service restarted" }),
      });

      await expect(client.restartService("service-1")).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/services/service-1/restart",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
  });

  describe("getSystemStatus", () => {
    it("should aggregate system status from services", async () => {
      const mockServices: ServiceMetadata[] = [
        {
          id: "service-1",
          name: "Service 1",
          type: "typecheck",
          enabled: true,
          status: "running",
          health: "healthy",
          stats: { successCount: 10, failureCount: 0 },
          version: "1.0.0",
        },
        {
          id: "service-2",
          name: "Service 2",
          type: "lint",
          enabled: true,
          status: "running",
          health: "healthy",
          stats: { successCount: 8, failureCount: 0 },
          version: "1.0.0",
        },
        {
          id: "service-3",
          name: "Service 3",
          type: "test",
          enabled: true,
          status: "stopped",
          health: "unknown",
          stats: { successCount: 0, failureCount: 0 },
          version: "1.0.0",
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServices,
      });

      const result = await client.getSystemStatus();

      expect(result.services).toEqual(mockServices);
      expect(result.summary).toEqual({
        total: 3,
        running: 2,
        stopped: 1,
        error: 0,
        healthy: 2,
        unhealthy: 0,
      });
      expect(result.hasErrors).toBe(false);
      expect(result.hasWarnings).toBe(false);
    });

    it("should detect errors in system status", async () => {
      const mockServices: ServiceMetadata[] = [
        {
          id: "service-1",
          name: "Service 1",
          type: "typecheck",
          enabled: true,
          status: "error",
          health: "unhealthy",
          stats: { successCount: 0, failureCount: 5 },
          lastError: {
            message: "Type check failed",
            timestamp: new Date().toISOString(),
          },
          version: "1.0.0",
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServices,
      });

      const result = await client.getSystemStatus();

      expect(result.hasErrors).toBe(true);
      expect(result.summary.error).toBe(1);
      expect(result.summary.unhealthy).toBe(1);
    });

    it("should detect warnings (degraded services)", async () => {
      const mockServices: ServiceMetadata[] = [
        {
          id: "service-1",
          name: "Service 1",
          type: "lint",
          enabled: true,
          status: "running",
          health: "degraded",
          stats: { successCount: 8, failureCount: 2 },
          version: "1.0.0",
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServices,
      });

      const result = await client.getSystemStatus();

      expect(result.hasWarnings).toBe(true);
      expect(result.hasErrors).toBe(false);
    });
  });

  describe("Timeout Handling", () => {
    it("should timeout after specified duration", async () => {
      const slowClient = new DevACClient("http://localhost:3000", 100);

      // Mock AbortController abort signal
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";

      mockFetch.mockRejectedValueOnce(abortError);

      await expect(slowClient.getServices()).rejects.toThrow(
        "Request timeout after 100ms",
      );
    });
  });
});
