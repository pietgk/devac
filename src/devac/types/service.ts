// src/devac/types/service.ts

/**
 * Service status enumeration
 */
export type ServiceStatus = 'idle' | 'initializing' | 'watching' | 'processing' | 'degraded' | 'error' | 'stopping' | 'stopped';

/**
 * Service health status
 */
export type HealthStatus = 'healthy' | 'degraded' | 'error';

/**
 * Service configuration base interface
 */
export interface ServiceConfig {
  /** Service unique identifier */
  id: string;
  /** Service display name */
  name: string;
  /** Service type */
  type: ServiceType;
  /** Whether service is enabled */
  enabled: boolean;
  /** Service-specific configuration */
  config: Record<string, any>;
}

/**
 * Service types
 */
export type ServiceType =
  | 'codegraph'
  | 'git'
  | 'build'
  | 'test'
  | 'import'
  | 'export'
  | 'custom';

/**
 * Collection statistics
 */
export interface CollectionStats {
  /** Number of files/items processed */
  itemsProcessed: number;
  /** Number of nodes created */
  nodesCreated: number;
  /** Number of relationships created */
  relationshipsCreated: number;
  /** Processing duration in milliseconds */
  duration: number;
  /** Timestamp of last collection */
  lastCollectionAt?: string;
  /** Number of errors encountered */
  errors: number;
  /** Number of warnings */
  warnings: number;
}

/**
 * Service metadata
 */
export interface ServiceMetadata {
  /** Service configuration */
  config: ServiceConfig;
  /** Current service status */
  status: ServiceStatus;
  /** Health status */
  health: HealthStatus;
  /** Collection statistics */
  stats: CollectionStats;
  /** When service was started */
  startedAt?: string;
  /** Last error if any */
  lastError?: {
    message: string;
    timestamp: string;
    stack?: string;
  };
  /** Service version */
  version: string;
}

/**
 * Resource reference for large data or logs
 */
export interface ResourceReference {
  /** Resource unique identifier */
  id: string;
  /** Resource type */
  type: 'logfile' | 'datafile' | 'artifact';
  /** File path */
  path: string;
  /** File format */
  format: string;
  /** File size in bytes */
  size: number;
  /** Number of records/lines (for structured data/logs) */
  records?: number;
  /** Line range reference (for logs) */
  lineRange?: {
    start: number;
    end: number;
  };
}

/**
 * Service output - nodes, relationships, and resource references
 */
export interface ServiceOutput {
  /** Collection identifier */
  collectionId: string;
  /** Service ID that produced this output */
  serviceId: string;
  /** Timestamp of collection */
  timestamp: string;
  /** Nodes to be stored in graph */
  nodes: any[];
  /** Relationships to be stored in graph */
  relationships: any[];
  /** Resource references (logs, large data files) */
  resources: ResourceReference[];
  /** Statistics */
  stats: CollectionStats;
}

/**
 * Service event types for inter-service communication
 */
export type ServiceEventType =
  | 'SERVICE_STARTED'
  | 'SERVICE_STOPPED'
  | 'SERVICE_ERROR'
  | 'COLLECTION_STARTED'
  | 'COLLECTION_COMPLETED'
  | 'COLLECTION_FAILED'
  | 'HEALTH_CHANGED'
  | 'CONFIG_UPDATED';

/**
 * Service event
 */
export interface ServiceEvent {
  /** Event unique identifier */
  id: string;
  /** Event type */
  type: ServiceEventType;
  /** Service ID that emitted the event */
  serviceId: string;
  /** Event timestamp */
  timestamp: string;
  /** Event payload */
  payload: Record<string, any>;
}
