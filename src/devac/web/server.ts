// src/devac/web/server.ts

import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createSSEManager, type SSEManager } from "./sse-manager.js";
import { createServicesRouter } from "./routes/services.js";
import { createEventsRouter } from "./routes/events.js";
import { createLogsRouter } from "./routes/logs.js";
import type { ServiceRegistry } from "../orchestrator/service-registry.js";
import type { EventBus } from "../orchestrator/event-bus.js";
import { createContextLogger } from "../../utils/logger.js";
import { EventBusTransport } from "./eventbus-transport.js";
import { addTransport } from "../../utils/logger.js";
import type { Server } from "http";

const logger = createContextLogger("WebServer");

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Orchestrator interface for web server
 */
export interface WebServerOrchestrator {
  getRegistry(): ServiceRegistry | undefined;
  getEventBus(): EventBus | undefined;
  isRunning(): boolean;
  getStatus(): {
    status: string;
    startedAt?: string;
    serviceCount: number;
    error?: { message: string; stack?: string };
  };
}

/**
 * Web server configuration options
 */
export interface WebServerOptions {
  port: number;
  host: string;
  cors: boolean;
  orchestrator: WebServerOrchestrator;
}

/**
 * Web server result
 */
export interface WebServerResult {
  app: Express;
  server: Server;
  sseManager: SSEManager;
}

/**
 * Create and configure Express web server
 */
export async function createWebServer(
  options: WebServerOptions,
): Promise<WebServerResult> {
  const { port, host, cors: enableCors, orchestrator } = options;

  logger.info("Creating web server...", { port, host, cors: enableCors });

  // Create Express app
  const app = express();

  // Middleware
  if (enableCors) {
    app.use(
      cors({
        origin: true, // Allow all origins in dev
        credentials: true,
      }),
    );
  }

  app.use(express.json());

  // Request logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    res.on("finish", () => {
      const duration = Date.now() - start;
      logger.debug(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });

    next();
  });

  // Get registry and event bus from orchestrator
  const registry = orchestrator.getRegistry();
  const eventBus = orchestrator.getEventBus();

  if (!registry) {
    throw new Error("Service registry not available from orchestrator");
  }

  if (!eventBus) {
    throw new Error("Event bus not available from orchestrator");
  }

  // Create and start SSE manager
  const sseManager = createSSEManager(eventBus);
  sseManager.start();

  // Set up heartbeat for SSE connections (every 30 seconds)
  const heartbeatInterval = setInterval(() => {
    sseManager.sendHeartbeat();
  }, 30000);

  // Add EventBusTransport to Winston for log streaming to UI
  const eventBusTransport = new EventBusTransport({
    eventBus,
    levelsToForward: ["warn", "error"], // Only stream warnings and errors
  });
  addTransport(eventBusTransport);

  logger.info("EventBus transport added to Winston logger");

  // Health check endpoint
  app.get("/health", (req: Request, res: Response) => {
    const orchestratorStatus = orchestrator.getStatus();

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      orchestrator: orchestratorStatus,
      sse: sseManager.getStats(),
    });
  });

  // API routes
  app.use("/api/services", createServicesRouter(registry));
  app.use("/api/events", createEventsRouter(sseManager));
  app.use(
    "/api/logs",
    createLogsRouter({
      eventBus,
      logDir: path.resolve(process.cwd(), "logs"),
    }),
  );

  // Serve static files from frontend directory
  const frontendDir = path.join(__dirname, "frontend");
  logger.info(`Serving static files from: ${frontendDir}`);
  app.use(express.static(frontendDir));

  // Serve demo.html as the index page
  app.get("/", (req: Request, res: Response) => {
    res.sendFile(path.join(frontendDir, "demo.html"));
  });

  // 404 handler (only for routes that don't match anything)
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: "Not found",
      path: req.path,
    });
  });

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error(`Server error: ${err.message}`, {
      path: req.path,
      method: req.method,
      stack: err.stack,
    });

    // Handle JSON parsing errors
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({
        error: "Invalid JSON",
        message: err.message,
      });
    }

    res.status(500).json({
      error: "Internal server error",
      message: err.message,
    });
  });

  // Start HTTP server
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, host, () => {
      const address = s.address();
      const actualPort =
        typeof address === "object" && address ? address.port : port;
      logger.info(`Web server listening on http://${host}:${actualPort}`);
      resolve(s);
    });

    s.on("error", (error: any) => {
      logger.error(`Server error: ${error.message}`);
      reject(error);
    });
  });

  // Cleanup on server close
  server.on("close", () => {
    logger.info("Web server closing...");
    clearInterval(heartbeatInterval);
    sseManager.stop();
  });

  logger.info("Web server created successfully");

  return {
    app,
    server,
    sseManager,
  };
}

/**
 * Stop web server
 */
export async function stopWebServer(result: WebServerResult): Promise<void> {
  logger.info("Stopping web server...");

  // Stop SSE manager
  result.sseManager.stop();

  // Close HTTP server
  await new Promise<void>((resolve, reject) => {
    result.server.close((err) => {
      if (err) {
        logger.error(`Error closing server: ${err.message}`);
        reject(err);
      } else {
        logger.info("Web server stopped");
        resolve();
      }
    });
  });
}
