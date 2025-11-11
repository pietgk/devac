import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Server } from "http";
import type { Express } from "express";
import { createWebServer } from "../server.js";
import { createMockOrchestrator } from "./test-helpers.js";

/**
 * API Integration Tests
 *
 * These tests verify the complete API integration works correctly.
 * They test the actual HTTP endpoints that the frontend will use.
 */
describe("API Integration Tests", () => {
  let app: Express;
  let server: Server;

  beforeAll(async () => {
    const orchestrator = createMockOrchestrator();
    const result = await createWebServer({
      port: 0,
      host: "localhost",
      cors: true,
      orchestrator: orchestrator as any,
    });

    app = result.app;
    server = result.server;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });

  describe("Health Check", () => {
    it("should return 200 with status ok", async () => {
      const response = await request(app).get("/health");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: "ok",
        timestamp: expect.any(String),
      });
      expect(response.body).toHaveProperty("orchestrator");
      expect(response.body).toHaveProperty("sse");
    });
  });

  describe("Services API", () => {
    it("should list all services", async () => {
      const response = await request(app).get("/api/services");

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      const service = response.body[0];
      expect(service).toHaveProperty("id");
      expect(service).toHaveProperty("name");
      expect(service).toHaveProperty("type");
      expect(service).toHaveProperty("status");
      expect(service).toHaveProperty("health");
      expect(service).toHaveProperty("stats");
      expect(service.stats).toHaveProperty("uptime");
      expect(service.stats).toHaveProperty("requestCount");
    });

    it("should get specific service details", async () => {
      const response = await request(app).get("/api/services/test-service-1");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: "test-service-1",
        name: expect.any(String),
        type: expect.any(String),
        status: expect.any(String),
        health: expect.any(String),
      });
    });

    it("should return 404 for non-existent service", async () => {
      const response = await request(app).get("/api/services/nonexistent");

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("error");
      expect(response.body.serviceId).toBe("nonexistent");
    });

    it("should start a service", async () => {
      const response = await request(app).post(
        "/api/services/test-service-1/start",
      );

      expect(response.status).toBe(200);
      expect(response.body.message).toContain("start");
      expect(response.body.serviceId).toBe("test-service-1");
      expect(response.body).toHaveProperty("timestamp");
    });

    it("should stop a service", async () => {
      const response = await request(app)
        .post("/api/services/test-service-1/stop")
        .send({ graceful: true });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain("stop");
      expect(response.body.serviceId).toBe("test-service-1");
      expect(response.body.graceful).toBe(true);
    });

    it("should stop a service without graceful flag", async () => {
      const response = await request(app)
        .post("/api/services/test-service-1/stop")
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.graceful).toBe(true); // Defaults to true
    });

    it("should restart a service", async () => {
      const response = await request(app).post(
        "/api/services/test-service-1/restart",
      );

      expect(response.status).toBe(200);
      expect(response.body.message).toContain("restart");
      expect(response.body.serviceId).toBe("test-service-1");
    });

    it("should get service health", async () => {
      const response = await request(app).get(
        "/api/services/test-service-1/health",
      );

      // Health endpoint returns 200 for healthy, 503 for unhealthy
      expect([200, 503]).toContain(response.status);
      expect(response.body).toMatchObject({
        serviceId: "test-service-1",
        health: expect.any(String),
        status: expect.any(String),
      });
      expect(response.body).toHaveProperty("timestamp");
    });
  });

  describe("Events API", () => {
    it("should provide SSE stats endpoint", async () => {
      const response = await request(app).get("/api/events/stats");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("connectedClients");
      expect(response.body).toHaveProperty("totalEventsSent");
      expect(typeof response.body.connectedClients).toBe("number");
      expect(typeof response.body.totalEventsSent).toBe("number");
    });
  });

  describe("CORS Headers", () => {
    it("should include CORS headers in responses", async () => {
      const response = await request(app)
        .get("/health")
        .set("Origin", "http://localhost:3001");

      expect(response.headers["access-control-allow-origin"]).toBeDefined();
    });

    it("should handle OPTIONS preflight requests", async () => {
      const response = await request(app)
        .options("/api/services")
        .set("Origin", "http://localhost:3001")
        .set("Access-Control-Request-Method", "GET");

      expect(response.status).toBe(204);
    });
  });

  describe("Error Handling", () => {
    it("should return 400 for invalid JSON", async () => {
      const response = await request(app)
        .post("/api/services/test-service-1/stop")
        .set("Content-Type", "application/json")
        .send("invalid json");

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });

    it("should return 404 for unknown routes", async () => {
      const response = await request(app).get("/api/unknown");

      expect(response.status).toBe(404);
    });
  });

  describe("Service State Transitions", () => {
    it("should handle start -> stop -> start sequence", async () => {
      // Start
      const startResponse = await request(app).post(
        "/api/services/test-service-2/start",
      );
      expect(startResponse.status).toBe(200);

      // Stop
      const stopResponse = await request(app)
        .post("/api/services/test-service-2/stop")
        .send({ graceful: true });
      expect(stopResponse.status).toBe(200);

      // Start again
      const restartResponse = await request(app).post(
        "/api/services/test-service-2/start",
      );
      expect(restartResponse.status).toBe(200);
    });

    it("should handle restart sequence", async () => {
      const response = await request(app).post(
        "/api/services/test-service-2/restart",
      );

      expect(response.status).toBe(200);
      expect(response.body.message).toContain("restart");
    });
  });
});
