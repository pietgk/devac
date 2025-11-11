// src/devac/web/eventbus-transport.ts

import winston from "winston";
import Transport from "winston-transport";
import type { EventBus } from "../orchestrator/event-bus.js";
import type { LogEntry } from "../types/logging.js";

/**
 * Configuration for EventBusTransport
 */
export interface EventBusTransportOptions
  extends Transport.TransportStreamOptions {
  /** EventBus instance to publish logs to */
  eventBus: EventBus;
  /** Only forward these log levels (default: ['warn', 'error']) */
  levelsToForward?: string[];
}

/**
 * Winston transport that forwards logs to EventBus for real-time UI streaming.
 *
 * Features:
 * - Only forwards warn/error levels by default (avoids flooding)
 * - Publishes to EventBus for SSE streaming to UI
 * - Logs stored in EventBus memory (last 500 entries)
 *
 * Usage:
 * ```typescript
 * const transport = new EventBusTransport({
 *   eventBus: orchestrator.getEventBus(),
 *   levelsToForward: ['warn', 'error'], // Optional, this is default
 * });
 *
 * addTransport(transport);
 * ```
 */
export class EventBusTransport extends Transport {
  private readonly eventBus: EventBus;
  private readonly levelsToForward: Set<string>;

  constructor(opts: EventBusTransportOptions) {
    super(opts);

    this.eventBus = opts.eventBus;
    this.levelsToForward = new Set(opts.levelsToForward || ["warn", "error"]);
  }

  /**
   * Winston transport log method
   */
  override log(info: any, callback: () => void): void {
    setImmediate(() => {
      try {
        // Only forward configured log levels
        if (!this.levelsToForward.has(info.level)) {
          callback();
          return;
        }

        // Convert Winston log to LogEntry format
        const logEntry: LogEntry = {
          level: info.level as LogEntry["level"],
          message: info.message,
          timestamp: info.timestamp || new Date().toISOString(),
          service: info.context, // Winston context becomes service name
          metadata: this.extractMetadata(info),
          stack: info.stack,
        };

        // Add to EventBus
        this.eventBus.addLog(logEntry);

        this.emit("logged", info);
        callback();
      } catch (error) {
        this.emit("error", error);
        callback();
      }
    });
  }

  /**
   * Extract metadata from Winston info object
   */
  private extractMetadata(info: any): Record<string, any> | undefined {
    const metadata: Record<string, any> = {};
    let hasMetadata = false;

    // Copy all non-standard fields to metadata
    for (const key of Object.keys(info)) {
      if (
        !["level", "message", "timestamp", "context", "stack"].includes(key)
      ) {
        metadata[key] = info[key];
        hasMetadata = true;
      }
    }

    return hasMetadata ? metadata : undefined;
  }
}
