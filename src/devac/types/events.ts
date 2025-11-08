// src/devac/types/events.ts

/**
 * Event bus event types for orchestrator and services communication
 */

/**
 * Orchestrator events
 */
export type OrchestratorEvent =
  | { type: 'START_ORCHESTRATOR' }
  | { type: 'STOP_ORCHESTRATOR'; graceful?: boolean }
  | { type: 'ORCHESTRATOR_READY' }
  | { type: 'ORCHESTRATOR_STOPPING' }
  | { type: 'ORCHESTRATOR_STOPPED' }
  | { type: 'WORKSPACE_LOADED'; workspaceId: string };

/**
 * Service lifecycle events
 */
export type ServiceLifecycleEvent =
  | { type: 'START_SERVICE'; serviceId: string }
  | { type: 'STOP_SERVICE'; serviceId: string; graceful?: boolean }
  | { type: 'RESTART_SERVICE'; serviceId: string }
  | { type: 'SERVICE_REGISTERED'; serviceId: string; serviceType: string }
  | { type: 'SERVICE_UNREGISTERED'; serviceId: string }
  | { type: 'SERVICE_STARTED'; serviceId: string }
  | { type: 'SERVICE_STOPPED'; serviceId: string }
  | { type: 'SERVICE_FAILED'; serviceId: string; error: Error };

/**
 * Service operation events
 */
export type ServiceOperationEvent =
  | { type: 'FILE_CHANGED'; serviceId: string; path: string; changeType: 'add' | 'change' | 'unlink' }
  | { type: 'SCAN_STARTED'; serviceId: string }
  | { type: 'SCAN_COMPLETED'; serviceId: string; itemsFound: number }
  | { type: 'PROCESSING_STARTED'; serviceId: string; itemId: string }
  | { type: 'PROCESSING_COMPLETED'; serviceId: string; itemId: string }
  | { type: 'BATCH_COMPLETED'; serviceId: string; batchSize: number }
  | { type: 'COLLECTION_COMPLETED'; serviceId: string; collectionId: string; stats: any };

/**
 * Error and health events
 */
export type HealthEvent =
  | { type: 'HEALTH_CHECK'; serviceId: string }
  | { type: 'HEALTH_CHANGED'; serviceId: string; health: 'healthy' | 'degraded' | 'error' }
  | { type: 'ERROR'; serviceId: string; error: Error; severity: 'warning' | 'error' | 'critical' }
  | { type: 'RETRY'; serviceId: string; attemptNumber: number };

/**
 * All event types
 */
export type DevACEvent =
  | OrchestratorEvent
  | ServiceLifecycleEvent
  | ServiceOperationEvent
  | HealthEvent;

/**
 * Event payload with metadata
 */
export interface EventEnvelope<T = DevACEvent> {
  /** Unique event ID */
  id: string;
  /** Event data */
  event: T;
  /** Timestamp when event was created */
  timestamp: number;
  /** Source actor/service ID */
  source: string;
  /** Target actor/service ID (if directed) */
  target?: string;
}
