// src/devac/orchestrator/event-bus.ts

import { EventEmitter } from "events";
import { createContextLogger } from "../../utils/logger.js";
import type { DevACEvent, EventEnvelope } from "../types/index.js";
import type { LogEntry, LogFilter } from "../types/logging.js";
import { randomUUID } from "crypto";

const logger = createContextLogger("EventBus");

/**
 * Event bus for inter-service communication and log aggregation
 * Provides pub/sub pattern for services and orchestrator
 * Also stores recent logs for real-time UI display
 */
export class EventBus extends EventEmitter {
  private eventHistory: EventEnvelope[] = [];
  private logHistory: LogEntry[] = [];
  private maxHistorySize: number;
  private maxLogHistorySize: number;

  constructor(maxHistorySize = 1000, maxLogHistorySize = 500) {
    super();
    this.maxHistorySize = maxHistorySize;
    this.maxLogHistorySize = maxLogHistorySize;
    this.setMaxListeners(100); // Allow many listeners
  }

  /**
   * Publish an event to the bus
   */
  publish<T extends DevACEvent>(
    event: T,
    source: string,
    target?: string,
  ): void {
    const envelope: EventEnvelope<T> = {
      id: randomUUID(),
      event,
      timestamp: Date.now(),
      source,
      target,
    };

    // Add to history
    this.eventHistory.push(envelope as EventEnvelope);

    // Trim history if needed
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    logger.debug(`Event published: ${event.type} from ${source}`, {
      eventId: envelope.id,
      target,
    });

    // Emit the event
    this.emit(event.type, envelope);

    // Also emit a wildcard event for subscribers that want all events
    this.emit("*", envelope);
  }

  /**
   * Subscribe to specific event types
   */
  subscribe<T extends DevACEvent>(
    eventType: T["type"] | "*",
    handler: (envelope: EventEnvelope<T>) => void,
  ): () => void {
    this.on(eventType, handler);

    // Return unsubscribe function
    return () => {
      this.off(eventType, handler);
    };
  }

  /**
   * Subscribe to events once
   */
  subscribeOnce<T extends DevACEvent>(
    eventType: T["type"],
    handler: (envelope: EventEnvelope<T>) => void,
  ): void {
    this.once(eventType, handler);
  }

  /**
   * Get event history
   */
  getHistory(filter?: {
    eventType?: string;
    source?: string;
    target?: string;
    since?: number;
  }): EventEnvelope[] {
    let history = this.eventHistory;

    if (filter) {
      history = history.filter((envelope) => {
        if (filter.eventType && envelope.event.type !== filter.eventType) {
          return false;
        }
        if (filter.source && envelope.source !== filter.source) {
          return false;
        }
        if (filter.target && envelope.target !== filter.target) {
          return false;
        }
        if (filter.since && envelope.timestamp < filter.since) {
          return false;
        }
        return true;
      });
    }

    return history;
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
    logger.debug("Event history cleared");
  }

  /**
   * Add a log entry to history (called by Winston EventBusTransport)
   */
  addLog(entry: LogEntry): void {
    this.logHistory.push(entry);

    // Trim log history if needed (FIFO)
    if (this.logHistory.length > this.maxLogHistorySize) {
      this.logHistory.shift();
    }

    // Emit log entry event for real-time streaming
    this.emit("log", entry);

    logger.debug(
      `Log added: ${entry.level} from ${entry.service || "unknown"}`,
      {
        message: entry.message,
      },
    );
  }

  /**
   * Get log history with optional filtering
   */
  getLogHistory(filter?: LogFilter): LogEntry[] {
    let logs = this.logHistory;

    if (filter) {
      logs = logs.filter((log) => {
        // Filter by level
        if (filter.level && filter.level.length > 0) {
          if (!filter.level.includes(log.level)) {
            return false;
          }
        }

        // Filter by service
        if (filter.service && log.service !== filter.service) {
          return false;
        }

        // Filter by time
        if (filter.since) {
          const logTime = new Date(log.timestamp).getTime();
          if (logTime < filter.since) {
            return false;
          }
        }

        // Filter by search text
        if (filter.search) {
          const searchLower = filter.search.toLowerCase();
          const messageMatch = log.message.toLowerCase().includes(searchLower);
          const serviceMatch = log.service?.toLowerCase().includes(searchLower);
          if (!messageMatch && !serviceMatch) {
            return false;
          }
        }

        return true;
      });
    }

    // Apply limit
    if (filter?.limit && filter.limit > 0) {
      logs = logs.slice(-filter.limit); // Get last N logs
    }

    return logs;
  }

  /**
   * Clear log history
   */
  clearLogHistory(): void {
    this.logHistory = [];
    logger.debug("Log history cleared");
  }

  /**
   * Get statistics about the event bus
   */
  getStats(): {
    historySize: number;
    logHistorySize: number;
    listenerCounts: Record<string, number>;
  } {
    const listenerCounts: Record<string, number> = {};

    for (const eventName of this.eventNames()) {
      listenerCounts[eventName.toString()] = this.listenerCount(eventName);
    }

    return {
      historySize: this.eventHistory.length,
      logHistorySize: this.logHistory.length,
      listenerCounts,
    };
  }
}
