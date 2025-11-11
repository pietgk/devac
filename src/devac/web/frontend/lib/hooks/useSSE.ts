// src/devac/web/frontend/lib/hooks/useSSE.ts

import { useEffect, useRef, useState, useCallback } from "react";
import type { SSEEvent, SSEConnectionEvent, SSEHeartbeatEvent } from "../api/types.js";

/**
 * SSE event handler types
 */
export type SSEEventHandler<T> = (data: T) => void;

/**
 * SSE hook options
 */
export interface UseSSEOptions {
  url: string;
  onConnection?: SSEEventHandler<SSEConnectionEvent>;
  onEvent?: SSEEventHandler<SSEEvent>;
  onHeartbeat?: SSEEventHandler<SSEHeartbeatEvent>;
  onError?: (error: Event) => void;
  autoConnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

/**
 * SSE hook return type
 */
export interface UseSSEReturn {
  connected: boolean;
  error: Error | null;
  reconnecting: boolean;
  reconnectAttempts: number;
  lastEvent: SSEEvent | null;
  connect: () => void;
  disconnect: () => void;
}

/**
 * Hook for Server-Sent Events (SSE) connection
 */
export function useSSE(options: UseSSEOptions): UseSSEReturn {
  const {
    url,
    onConnection,
    onEvent,
    onHeartbeat,
    onError,
    autoConnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 5,
  } = options;

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);

  /**
   * Connect to SSE stream
   */
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      return; // Already connected
    }

    try {
      const eventSource = new EventSource(url);

      // Connection opened
      eventSource.onopen = () => {
        setConnected(true);
        setError(null);
        setReconnecting(false);
        setReconnectAttempts(0);
      };

      // Handle connection event
      eventSource.addEventListener("connection", (e: MessageEvent) => {
        try {
          const data: SSEConnectionEvent = JSON.parse(e.data);
          onConnection?.(data);
        } catch (err) {
          console.error("Failed to parse connection event:", err);
        }
      });

      // Handle orchestrator events
      eventSource.addEventListener("event", (e: MessageEvent) => {
        try {
          const data: SSEEvent = JSON.parse(e.data);
          setLastEvent(data);
          onEvent?.(data);
        } catch (err) {
          console.error("Failed to parse event:", err);
        }
      });

      // Handle heartbeat events
      eventSource.addEventListener("heartbeat", (e: MessageEvent) => {
        try {
          const data: SSEHeartbeatEvent = JSON.parse(e.data);
          onHeartbeat?.(data);
        } catch (err) {
          console.error("Failed to parse heartbeat:", err);
        }
      });

      // Handle errors
      eventSource.onerror = (e: Event) => {
        const errorObj = new Error("SSE connection error");
        setError(errorObj);
        setConnected(false);
        onError?.(e);

        // Close the connection
        eventSource.close();
        eventSourceRef.current = null;

        // Attempt reconnection if enabled
        if (shouldReconnectRef.current && reconnectAttempts < maxReconnectAttempts) {
          setReconnecting(true);
          setReconnectAttempts((prev) => prev + 1);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        } else if (reconnectAttempts >= maxReconnectAttempts) {
          setError(new Error("Max reconnection attempts reached"));
        }
      };

      eventSourceRef.current = eventSource;
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error("Failed to connect to SSE");
      setError(errorObj);
      setConnected(false);
    }
  }, [
    url,
    onConnection,
    onEvent,
    onHeartbeat,
    onError,
    reconnectAttempts,
    maxReconnectAttempts,
    reconnectInterval,
  ]);

  /**
   * Disconnect from SSE stream
   */
  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setConnected(false);
    setReconnecting(false);
  }, []);

  /**
   * Auto-connect on mount if enabled
   */
  useEffect(() => {
    if (autoConnect) {
      shouldReconnectRef.current = true;
      connect();
    }

    // Cleanup on unmount
    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    connected,
    error,
    reconnecting,
    reconnectAttempts,
    lastEvent,
    connect,
    disconnect,
  };
}
