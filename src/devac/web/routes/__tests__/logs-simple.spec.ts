// src/devac/web/routes/__tests__/logs-simple.spec.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { createLogsRouter } from "../logs.js";
import { EventBus } from "../../../orchestrator/event-bus.js";
import type { LogEntry } from "../../../types/logging.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

describe("Logs API Routes - Core Functionality", () => {
  let app: Express;
  let eventBus: EventBus;
  let testLogDir: string;

  beforeEach(async () => {
    eventBus = new EventBus(1000, 500);
    testLogDir = await fs.mkdtemp(path.join(os.tmpdir(), "logs-test-"));

    app = express();
    app.use(
      "/api/logs",
      createLogsRouter({
        eventBus,
        logDir: testLogDir,
      }),
    );
  });

  afterEach(async () => {
    await fs.rm(testLogDir, { recursive: true, force: true });
  });

  describe("GET /api/logs - Memory Source", () => {
    beforeEach(() => {
      eventBus.addLog({
        level: "error",
        message: "Recent error",
        timestamp: new Date().toISOString(),
        service: "TestService",
      });

      eventBus.addLog({
        level: "warn",
        message: "Recent warning",
        timestamp: new Date().toISOString(),
        service: "TestService",
      });

      eventBus.addLog({
        level: "info",
        message: "Recent info",
        timestamp: new Date().toISOString(),
        service: "OtherService",
      });
    });

    it("should return logs from memory", async () => {
      const response = await request(app).get("/api/logs").expect(200);

      expect(response.body.source).toBe("memory");
      expect(response.body.logs).toHaveLength(3);
    });

    it("should filter by level", async () => {
      const response = await request(app)
        .get("/api/logs")
        .query({ level: "error,warn" })
        .expect(200);

      expect(response.body.logs).toHaveLength(2);
    });

    it("should filter by service", async () => {
      const response = await request(app)
        .get("/api/logs")
        .query({ service: "TestService" })
        .expect(200);

      expect(response.body.logs).toHaveLength(2);
    });

    it("should limit results", async () => {
      const response = await request(app)
        .get("/api/logs")
        .query({ limit: 2 })
        .expect(200);

      expect(response.body.logs).toHaveLength(2);
    });
  });

  describe("GET /api/logs - File Source", () => {
    beforeEach(async () => {
      const oldTimestamp = new Date(Date.now() - 15 * 60 * 1000).toISOString();

      const logContent = [
        JSON.stringify({
          level: "error",
          message: "Old error",
          timestamp: oldTimestamp,
          context: "HistoricalService",
        }),
        JSON.stringify({
          level: "warn",
          message: "Old warning",
          timestamp: oldTimestamp,
          context: "HistoricalService",
        }),
      ].join("\n");

      await fs.writeFile(path.join(testLogDir, "combined.log"), logContent);
    });

    it("should return logs from files for old data", async () => {
      const oldTimestamp = Date.now() - 20 * 60 * 1000;

      const response = await request(app)
        .get("/api/logs")
        .query({ since: oldTimestamp.toString() })
        .expect(200);

      expect(response.body.source).toBe("file");
      expect(response.body.logs).toHaveLength(2);
    });

    it("should filter file logs by level", async () => {
      const oldTimestamp = Date.now() - 20 * 60 * 1000;

      const response = await request(app)
        .get("/api/logs")
        .query({
          since: oldTimestamp.toString(),
          level: "error",
        })
        .expect(200);

      expect(response.body.source).toBe("file");
      expect(response.body.logs).toHaveLength(1);
      expect(response.body.logs[0].level).toBe("error");
    });
  });

  describe("GET /api/logs/stream - SSE", () => {
    it("should establish SSE connection with proper headers", async () => {
      // SSE connections don't close automatically, so we need manual handling
      const responsePromise = new Promise<any>((resolve) => {
        const req = request(app)
          .get("/api/logs/stream")
          .set("Accept", "text/event-stream")
          .buffer(false);

        req.on("response", (res: any) => {
          req.abort(); // Close connection
          resolve(res);
        });

        req.end();
      });

      const res = await responsePromise;

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("text/event-stream");
      expect(res.headers["cache-control"]).toBe("no-cache");
      expect(res.headers["connection"]).toBe("keep-alive");
    });
  });
});
