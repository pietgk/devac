// src/devac/web/sse-manager.ts

import type { Response } from "express";
import type { EventBus } from "../orchestrator/event-bus.js";
import type { EventEnvelope } from "../types/index.js";
import { createContextLogger } from "../../utils/logger.js";

const logger = createContextLogger("SSEManager");

/**
 * SSE client connection
 */
interface SSEClient {
  id: string;
  response: Response;
  connectedAt: number;
  eventsSent: number;
}

/**
 * SSE Manager for handling Server-Sent Events
 * Manages client connections and broadcasts events from the event bus
 */
export class SSEManager {
  private clients: Map<string, SSEClient> = new Map();
  private eventBus: EventBus;
  private unsubscribe?: () => void;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Start listening to event bus
   */
  start(): void {
    if (this.unsubscribe) {
      logger.warn("SSE Manager already started");
      return;
    }

    logger.info("Starting SSE Manager...");

    // Subscribe to all events on the bus
    this.unsubscribe = this.eventBus.subscribe("*", (envelope: EventEnvelope) => {
      this.broadcastEvent(envelope);
    });

    logger.info("SSE Manager started, listening to event bus");
  }

  /**
   * Stop listening to event bus and close all connections
   */
  stop(): void {
    logger.info("Stopping SSE Manager...");

    // Unsubscribe from event bus
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }

    // Close all client connections
    for (const [clientId, client] of this.clients.entries()) {
      this.removeClient(clientId);
    }

    logger.info("SSE Manager stopped");
  }

  /**
   * Add a new SSE client
   */
  addClient(clientId: string, response: Response): void {
    // Set up SSE headers
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

    // Handle client disconnect
    response.on("close", () => {
      this.removeClient(clientId);
    });

    // Add to clients map
    const client: SSEClient = {
      id: clientId,
      response,
      connectedAt: Date.now(),
      eventsSent: 0,
    };

    this.clients.set(clientId, client);

    logger.info(`SSE client connected: ${clientId}`, {
      totalClients: this.clients.size,
    });

    // Send initial connection event
    this.sendToClient(clientId, {
      type: "connection",
      data: {
        clientId,
        timestamp: new Date().toISOString(),
        message: "Connected to DevAC event stream",
      },
    });

    // Send initial history (last 10 events)
    const history = this.eventBus.getHistory();
    const recentHistory = history.slice(-10);

    for (const envelope of recentHistory) {
      this.sendToClient(clientId, {
        type: "event",
        data: this.formatEventEnvelope(envelope),
      });
    }
  }

  /**
   * Remove an SSE client
   */
  private removeClient(clientId: string): void {
    const client = this.clients.get(clientId);

    if (client) {
      try {
        client.response.end();
      } catch (error) {
        // Client may already be closed
      }

      this.clients.delete(clientId);

      logger.info(`SSE client disconnected: ${clientId}`, {
        totalClients: this.clients.size,
        eventsSent: client.eventsSent,
        duration: Date.now() - client.connectedAt,
      });
    }
  }

  /**
   * Broadcast event to all connected clients
   */
  private broadcastEvent(envelope: EventEnvelope): void {
    const formattedEvent = {
      type: "event",
      data: this.formatEventEnvelope(envelope),
    };

    for (const clientId of this.clients.keys()) {
      this.sendToClient(clientId, formattedEvent);
    }
  }

  /**
   * Send event to specific client
   */
  private sendToClient(clientId: string, event: { type: string; data: any }): void {
    const client = this.clients.get(clientId);

    if (!client) {
      return;
    }

    try {
      // Format SSE message
      const sseMessage = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;

      // Send to client
      client.response.write(sseMessage);
      client.eventsSent++;
    } catch (error: any) {
      logger.error(`Error sending SSE event to client ${clientId}: ${error.message}`);
      this.removeClient(clientId);
    }
  }

  /**
   * Format event envelope for SSE transmission
   */
  private formatEventEnvelope(envelope: EventEnvelope): any {
    return {
      id: envelope.id,
      type: envelope.event.type,
      timestamp: envelope.timestamp,
      source: envelope.source,
      target: envelope.target,
      payload: envelope.event,
    };
  }

  /**
   * Get statistics about SSE connections
   */
  getStats(): {
    connectedClients: number;
    totalEventsSent: number;
    clients: Array<{
      id: string;
      connectedAt: number;
      eventsSent: number;
      duration: number;
    }>;
  } {
    const clients = Array.from(this.clients.values()).map((client) => ({
      id: client.id,
      connectedAt: client.connectedAt,
      eventsSent: client.eventsSent,
      duration: Date.now() - client.connectedAt,
    }));

    const totalEventsSent = clients.reduce((sum, client) => sum + client.eventsSent, 0);

    return {
      connectedClients: this.clients.size,
      totalEventsSent,
      clients,
    };
  }

  /**
   * Send heartbeat to all clients (to keep connection alive)
   */
  sendHeartbeat(): void {
    for (const clientId of this.clients.keys()) {
      this.sendToClient(clientId, {
        type: "heartbeat",
        data: { timestamp: new Date().toISOString() },
      });
    }
  }
}

/**
 * Create SSE manager instance
 */
export function createSSEManager(eventBus: EventBus): SSEManager {
  return new SSEManager(eventBus);
}
