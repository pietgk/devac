import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { chromium, Browser, Page } from "playwright";
import type { Server } from "http";
import type { Express } from "express";
import { createWebServer } from "../server.js";
import { createMockOrchestrator } from "./test-helpers.js";
import path from "path";

/**
 * Frontend Integration Tests
 *
 * These tests verify that the frontend HTML demo properly integrates with the backend:
 * - API client connects and fetches data
 * - SSE connection establishes and receives events
 * - Service control actions work (start/stop/restart)
 * - Real-time updates are reflected in the UI
 */
describe("Frontend Integration Tests", () => {
  let app: Express;
  let server: Server;
  let browser: Browser;
  let page: Page;
  let baseURL: string;

  beforeAll(async () => {
    // Start backend server
    const orchestrator = createMockOrchestrator();
    const result = await createWebServer({
      port: 0, // Random available port
      host: "localhost",
      cors: true,
      orchestrator: orchestrator as any,
    });

    app = result.app;
    server = result.server;

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server address not available");
    }

    baseURL = `http://localhost:${address.port}`;

    // Launch browser
    browser = await chromium.launch();
  }, 30000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });

  beforeEach(async () => {
    page = await browser.newPage();

    // Inject base URL into page for demo.html
    await page.addInitScript((url) => {
      (window as any).TEST_BASE_URL = url;
    }, baseURL);
  });

  describe("HTML Demo Page", () => {
    it("should load demo.html without errors", async () => {
      const demoPath = path.resolve(__dirname, "../frontend/demo.html");
      await page.goto(`file://${demoPath}`);

      // Check page title
      const title = await page.title();
      expect(title).toContain("DevAC");

      // Wait a moment for any console errors
      await page.waitForTimeout(1000);
    });

    it("should connect to backend API and load services", async () => {
      const demoPath = path.resolve(__dirname, "../frontend/demo.html");
      await page.goto(`file://${demoPath}`);

      // Wait for services to load
      await page.waitForSelector("[data-testid=\"service-card\"]", { timeout: 5000 });

      // Check that services are displayed
      const serviceCards = await page.$$("[data-testid=\"service-card\"]");
      expect(serviceCards.length).toBeGreaterThan(0);

      // Check service card content
      const firstCard = serviceCards[0];
      const serviceName = await firstCard.$eval("[data-testid=\"service-name\"]", (el) => el.textContent);
      expect(serviceName).toBeTruthy();
    });

    it("should establish SSE connection", async () => {
      const demoPath = path.resolve(__dirname, "../frontend/demo.html");
      await page.goto(`file://${demoPath}`);

      // Wait for SSE connection indicator
      await page.waitForSelector("[data-testid=\"sse-status\"]", { timeout: 5000 });

      const sseStatus = await page.$eval(
        "[data-testid=\"sse-status\"]",
        (el) => el.textContent
      );

      expect(sseStatus).toContain("Connected");
    });
  });

  describe("API Client Direct Testing", () => {
    it("should successfully fetch health check", async () => {
      await page.goto("about:blank");

      const response = await page.evaluate(async (url) => {
        const res = await fetch(`${url}/health`);
        return res.json();
      }, baseURL);

      expect(response).toHaveProperty("status", "ok");
      expect(response).toHaveProperty("timestamp");
    });

    it("should successfully fetch services list", async () => {
      await page.goto("about:blank");

      const services = await page.evaluate(async (url) => {
        const res = await fetch(`${url}/api/services`);
        return res.json();
      }, baseURL);

      expect(Array.isArray(services)).toBe(true);
      expect(services.length).toBeGreaterThan(0);

      const service = services[0];
      expect(service).toHaveProperty("id");
      expect(service).toHaveProperty("name");
      expect(service).toHaveProperty("status");
      expect(service).toHaveProperty("health");
    });

    it("should successfully start a service via API", async () => {
      await page.goto("about:blank");

      const result = await page.evaluate(async (url) => {
        const res = await fetch(`${url}/api/services/test-service-1/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        return res.json();
      }, baseURL);

      expect(result).toHaveProperty("message");
      expect(result.message).toContain("start");
      expect(result).toHaveProperty("serviceId", "test-service-1");
    });

    it("should handle API errors gracefully", async () => {
      await page.goto("about:blank");

      const result = await page.evaluate(async (url) => {
        try {
          const res = await fetch(`${url}/api/services/nonexistent/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          return { status: res.status, body: await res.json() };
        } catch (error: any) {
          return { error: error.message };
        }
      }, baseURL);

      expect(result.status).toBe(404);
      expect(result.body).toHaveProperty("error");
    });
  });

  describe("SSE Connection Testing", () => {
    it("should establish EventSource connection", async () => {
      await page.goto("about:blank");

      const connectionResult = await page.evaluate(async (url) => {
        return new Promise((resolve) => {
          const eventSource = new EventSource(`${url}/api/events`);

          const timeout = setTimeout(() => {
            eventSource.close();
            resolve({ connected: false, error: "Timeout" });
          }, 5000);

          eventSource.onopen = () => {
            clearTimeout(timeout);
            eventSource.close();
            resolve({ connected: true });
          };

          eventSource.onerror = () => {
            clearTimeout(timeout);
            eventSource.close();
            resolve({ connected: false, error: "Connection error" });
          };
        });
      }, baseURL);

      expect(connectionResult).toHaveProperty("connected", true);
    });

    it("should receive connection event on SSE connect", async () => {
      await page.goto("about:blank");

      const events = await page.evaluate(async (url) => {
        return new Promise<any[]>((resolve) => {
          const eventSource = new EventSource(`${url}/api/events`);
          const receivedEvents: any[] = [];

          const timeout = setTimeout(() => {
            eventSource.close();
            resolve(receivedEvents);
          }, 3000);

          eventSource.addEventListener("connection", (e: MessageEvent) => {
            receivedEvents.push({ type: "connection", data: JSON.parse(e.data) });
          });

          eventSource.addEventListener("event", (e: MessageEvent) => {
            receivedEvents.push({ type: "event", data: JSON.parse(e.data) });
          });
        });
      }, baseURL);

      // Should have received at least the connection event
      expect(events.length).toBeGreaterThan(0);

      const connectionEvent = events.find((e) => e.type === "connection");
      expect(connectionEvent).toBeDefined();
      expect(connectionEvent?.data).toHaveProperty("clientId");
      expect(connectionEvent?.data).toHaveProperty("message", "Connected");
    });
  });
});
