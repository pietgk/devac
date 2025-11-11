// src/devac/web/routes/services.ts

import { Router, type Request, type Response } from "express";
import type { ServiceRegistry } from "../../orchestrator/service-registry.js";
import { createContextLogger } from "../../../utils/logger.js";

const logger = createContextLogger("ServicesRoute");

/**
 * Create services API router
 */
export function createServicesRouter(registry: ServiceRegistry): Router {
  const router = Router();

  /**
   * GET /api/services
   * List all services with their metadata
   */
  router.get("/", (req: Request, res: Response) => {
    try {
      const metadata = registry.getAllMetadata();
      const services = Array.from(metadata.entries()).map(([id, meta]) => ({
        id,
        name: meta.config.name,
        type: meta.config.type,
        enabled: meta.config.enabled,
        status: meta.status,
        health: meta.health,
        stats: meta.stats,
        lastError: meta.lastError,
        version: meta.version,
      }));

      logger.debug(`Returning ${services.length} services`);
      res.json(services);
    } catch (error: any) {
      logger.error(`Error listing services: ${error.message}`);
      res.status(500).json({
        error: "Failed to list services",
        message: error.message,
      });
    }
  });

  /**
   * GET /api/services/:serviceId
   * Get details for a specific service
   */
  router.get("/:serviceId", (req: Request, res: Response) => {
    try {
      const { serviceId } = req.params;

      if (!registry.has(serviceId)) {
        return res.status(404).json({
          error: "Service not found",
          serviceId,
        });
      }

      const metadata = registry.getMetadata(serviceId);

      if (!metadata) {
        return res.status(404).json({
          error: "Service metadata not available",
          serviceId,
        });
      }

      res.json({
        id: serviceId,
        name: metadata.config.name,
        type: metadata.config.type,
        enabled: metadata.config.enabled,
        status: metadata.status,
        health: metadata.health,
        stats: metadata.stats,
        config: metadata.config.config,
        lastError: metadata.lastError,
        version: metadata.version,
      });
    } catch (error: any) {
      logger.error(`Error getting service ${req.params.serviceId}: ${error.message}`);
      res.status(500).json({
        error: "Failed to get service details",
        message: error.message,
      });
    }
  });

  /**
   * POST /api/services/:serviceId/start
   * Start a service
   */
  router.post("/:serviceId/start", (req: Request, res: Response) => {
    try {
      const { serviceId } = req.params;

      if (!registry.has(serviceId)) {
        return res.status(404).json({
          error: "Service not found",
          serviceId,
        });
      }

      const service = registry.get(serviceId);

      if (!service) {
        return res.status(404).json({
          error: "Service actor not found",
          serviceId,
        });
      }

      logger.info(`Starting service: ${serviceId}`);
      service.send({ type: "START" });

      res.json({
        message: `Service ${serviceId} start command sent`,
        serviceId,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error(`Error starting service ${req.params.serviceId}: ${error.message}`);
      res.status(500).json({
        error: "Failed to start service",
        message: error.message,
      });
    }
  });

  /**
   * POST /api/services/:serviceId/stop
   * Stop a service
   */
  router.post("/:serviceId/stop", (req: Request, res: Response) => {
    try {
      const { serviceId } = req.params;
      const { graceful = true } = req.body;

      if (!registry.has(serviceId)) {
        return res.status(404).json({
          error: "Service not found",
          serviceId,
        });
      }

      const service = registry.get(serviceId);

      if (!service) {
        return res.status(404).json({
          error: "Service actor not found",
          serviceId,
        });
      }

      logger.info(`Stopping service: ${serviceId}${graceful ? " (graceful)" : ""}`);
      service.send({ type: "STOP", graceful });

      res.json({
        message: `Service ${serviceId} stop command sent${graceful ? " (graceful)" : ""}`,
        serviceId,
        graceful,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error(`Error stopping service ${req.params.serviceId}: ${error.message}`);
      res.status(500).json({
        error: "Failed to stop service",
        message: error.message,
      });
    }
  });

  /**
   * POST /api/services/:serviceId/restart
   * Restart a service
   */
  router.post("/:serviceId/restart", (req: Request, res: Response) => {
    try {
      const { serviceId } = req.params;
      const { graceful = true } = req.body;

      if (!registry.has(serviceId)) {
        return res.status(404).json({
          error: "Service not found",
          serviceId,
        });
      }

      const service = registry.get(serviceId);

      if (!service) {
        return res.status(404).json({
          error: "Service actor not found",
          serviceId,
        });
      }

      logger.info(`Restarting service: ${serviceId}`);

      // Stop then start
      service.send({ type: "STOP", graceful });

      // Start after a short delay to allow graceful shutdown
      setTimeout(() => {
        service.send({ type: "START" });
      }, graceful ? 1000 : 100);

      res.json({
        message: `Service ${serviceId} restart command sent`,
        serviceId,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error(`Error restarting service ${req.params.serviceId}: ${error.message}`);
      res.status(500).json({
        error: "Failed to restart service",
        message: error.message,
      });
    }
  });

  /**
   * GET /api/services/:serviceId/health
   * Get service health status
   */
  router.get("/:serviceId/health", (req: Request, res: Response) => {
    try {
      const { serviceId } = req.params;

      if (!registry.has(serviceId)) {
        return res.status(404).json({
          error: "Service not found",
          serviceId,
        });
      }

      const metadata = registry.getMetadata(serviceId);

      if (!metadata) {
        return res.status(404).json({
          error: "Service metadata not available",
          serviceId,
        });
      }

      const isHealthy = metadata.health === "healthy";

      res.status(isHealthy ? 200 : 503).json({
        serviceId,
        health: metadata.health,
        status: metadata.status,
        lastError: metadata.lastError,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error(`Error getting service health ${req.params.serviceId}: ${error.message}`);
      res.status(500).json({
        error: "Failed to get service health",
        message: error.message,
      });
    }
  });

  return router;
}
