// src/devac/web/frontend/lib/api/types.ts

/**
 * Service metadata from backend API
 */
export interface Service {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  status: "idle" | "starting" | "running" | "stopping" | "stopped" | "error";
  health: "healthy" | "unhealthy" | "unknown";
  stats: {
    uptime: number;
    requestCount: number;
  };
  lastError?: {
    message: string;
    timestamp: string;
    stack?: string;
  };
  version: string;
}

/**
 * Detailed service information
 */
export interface ServiceDetails extends Service {
  config: Record<string, unknown>;
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  status: "ok" | "error";
  timestamp: string;
  orchestrator: {
    status: string;
    startedAt?: string;
    serviceCount: number;
    error?: {
      message: string;
      stack?: string;
    };
  };
  sse: {
    connectedClients: number;
    totalEventsSent: number;
    clients: Array<{
      id: string;
      connectedAt: number;
      eventsSent: number;
      duration: number;
    }>;
  };
}

/**
 * Service action response
 */
export interface ServiceActionResponse {
  message: string;
  serviceId: string;
  timestamp: string;
  graceful?: boolean;
}

/**
 * SSE event types
 */
export type SSEEventType = "connection" | "event" | "heartbeat";

/**
 * SSE connection event
 */
export interface SSEConnectionEvent {
  clientId: string;
  timestamp: string;
  message: string;
}

/**
 * SSE orchestrator event
 */
export interface SSEEvent {
  id: string;
  type: string;
  timestamp: number;
  source: string;
  target?: string;
  payload: Record<string, unknown>;
}

/**
 * SSE heartbeat event
 */
export interface SSEHeartbeatEvent {
  timestamp: string;
}

/**
 * SSE stats response
 */
export interface SSEStats {
  connectedClients: number;
  totalEventsSent: number;
  clients: Array<{
    id: string;
    connectedAt: number;
    eventsSent: number;
    duration: number;
  }>;
}

/**
 * API error response
 */
export interface APIError {
  error: string;
  message?: string;
  serviceId?: string;
  path?: string;
}
