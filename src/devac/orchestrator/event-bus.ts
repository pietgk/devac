// src/devac/orchestrator/event-bus.ts

import { EventEmitter } from 'events';
import { createContextLogger } from '../../utils/logger.js';
import type { DevACEvent, EventEnvelope } from '../types/index.js';
import { randomUUID } from 'crypto';

const logger = createContextLogger('EventBus');

/**
 * Event bus for inter-service communication
 * Provides pub/sub pattern for services and orchestrator
 */
export class EventBus extends EventEmitter {
  private eventHistory: EventEnvelope[] = [];
  private maxHistorySize: number;

  constructor(maxHistorySize = 1000) {
    super();
    this.maxHistorySize = maxHistorySize;
    this.setMaxListeners(100); // Allow many listeners
  }

  /**
   * Publish an event to the bus
   */
  publish<T extends DevACEvent>(event: T, source: string, target?: string): void {
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
    this.emit('*', envelope);
  }

  /**
   * Subscribe to specific event types
   */
  subscribe<T extends DevACEvent>(
    eventType: T['type'] | '*',
    handler: (envelope: EventEnvelope<T>) => void
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
    eventType: T['type'],
    handler: (envelope: EventEnvelope<T>) => void
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
    logger.debug('Event history cleared');
  }

  /**
   * Get statistics about the event bus
   */
  getStats(): {
    historySize: number;
    listenerCounts: Record<string, number>;
  } {
    const listenerCounts: Record<string, number> = {};

    for (const eventName of this.eventNames()) {
      listenerCounts[eventName.toString()] = this.listenerCount(eventName);
    }

    return {
      historySize: this.eventHistory.length,
      listenerCounts,
    };
  }
}
