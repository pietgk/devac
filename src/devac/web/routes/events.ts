// src/devac/web/routes/events.ts

import { Router, type Request, type Response } from "express";
import type { SSEManager } from "../sse-manager.js";
import { randomUUID } from "crypto";
import { createContextLogger } from "../../../utils/logger.js";

const logger = createContextLogger("EventsRoute");

/**
 * Create events API router for SSE
 */
export function createEventsRouter(sseManager: SSEManager): Router {
  const router = Router();

  /**
   * GET /api/events
   * Server-Sent Events stream
   */
  router.get("/", (req: Request, res: Response) => {
    const clientId = randomUUID();

    logger.info(`New SSE connection: ${clientId}`, {
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    });

    // Add client to SSE manager
    sseManager.addClient(clientId, res);

    // Handle client disconnect
    req.on("close", () => {
      logger.debug(`SSE client disconnected: ${clientId}`);
    });
  });

  /**
   * GET /api/events/stats
   * Get SSE connection statistics
   */
  router.get("/stats", (req: Request, res: Response) => {
    try {
      const stats = sseManager.getStats();
      res.json(stats);
    } catch (error: any) {
      logger.error(`Error getting SSE stats: ${error.message}`);
      res.status(500).json({
        error: "Failed to get SSE statistics",
        message: error.message,
      });
    }
  });

  return router;
}
