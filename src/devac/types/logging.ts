// src/devac/types/logging.ts

/**
 * Structured log entry format
 */
export interface LogEntry {
  level: 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly';
  message: string;
  timestamp: string;
  service?: string;  // From Winston context
  metadata?: Record<string, any>;
  stack?: string;  // For errors
}

/**
 * Log filter options for querying
 */
export interface LogFilter {
  level?: string[];  // e.g., ['error', 'warn']
  service?: string;  // Filter by service context
  since?: number;    // Unix timestamp
  limit?: number;    // Max entries to return
  search?: string;   // Text search in message
}

/**
 * Line range for linking logs to collections
 */
export interface LineRange {
  startLine: number;
  endLine: number;
}
