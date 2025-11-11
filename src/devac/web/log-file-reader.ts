// src/devac/web/log-file-reader.ts

import fs from 'fs/promises';
import path from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { LogEntry, LogFilter } from '../types/logging.js';

/**
 * Options for reading log files
 */
export interface ReadLogsOptions {
  /** Directory containing log files */
  logDir: string;
  /** Filter options */
  filter?: LogFilter;
  /** Read in reverse chronological order (newest first) */
  reverse?: boolean;
}

/**
 * Log file reader for parsing Winston JSON logs.
 *
 * Features:
 * - Reads from combined.log and rotated files
 * - Parses JSONL format (one JSON per line)
 * - Applies filters (level, service, time, search)
 * - Supports reverse chronological order
 *
 * Usage:
 * ```typescript
 * const logs = await readLogs({
 *   logDir: './logs',
 *   filter: { level: ['error', 'warn'], limit: 100 },
 *   reverse: true,
 * });
 * ```
 */
export async function readLogs(options: ReadLogsOptions): Promise<LogEntry[]> {
  const { logDir, filter, reverse = true } = options;

  // Get all log files
  const logFiles = await getLogFiles(logDir);

  if (logFiles.length === 0) {
    return [];
  }

  // Read logs from files
  const logs: LogEntry[] = [];

  for (const fileName of logFiles) {
    const filePath = path.join(logDir, fileName);
    const fileLogs = await readLogFile(filePath);
    logs.push(...fileLogs);
  }

  // Apply filters
  let filteredLogs = applyFilters(logs, filter);

  // Sort by timestamp
  filteredLogs.sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return reverse ? timeB - timeA : timeA - timeB;
  });

  // Apply limit
  if (filter?.limit && filter.limit > 0) {
    filteredLogs = filteredLogs.slice(0, filter.limit);
  }

  return filteredLogs;
}

/**
 * Get all log files in directory, sorted by modification time
 */
async function getLogFiles(logDir: string): Promise<string[]> {
  try {
    const allFiles = await fs.readdir(logDir);

    // Get log files (combined.log and rotated files)
    const logFiles = allFiles.filter((f) =>
      f === 'combined.log' ||
      f.startsWith('combined.') ||
      f.match(/^[a-z-]+-\d{3}\.log$/) // Match service-specific logs like codegraph-001.log
    );

    // Get file stats for sorting
    const fileStats = await Promise.all(
      logFiles.map(async (file) => {
        const filePath = path.join(logDir, file);
        const stats = await fs.stat(filePath);
        return { file, mtime: stats.mtime };
      })
    );

    // Sort by modification time (newest first)
    fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    return fileStats.map((f) => f.file);
  } catch (error) {
    console.error('Failed to read log directory:', error);
    return [];
  }
}

/**
 * Read a single log file (JSONL format)
 */
async function readLogFile(filePath: string): Promise<LogEntry[]> {
  const logs: LogEntry[] = [];

  return new Promise((resolve, reject) => {
    const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      if (!line.trim()) return; // Skip empty lines

      try {
        const parsed = JSON.parse(line);

        // Convert Winston log format to LogEntry
        const logEntry: LogEntry = {
          level: parsed.level as LogEntry['level'],
          message: parsed.message,
          timestamp: parsed.timestamp,
          service: parsed.context, // Winston context = service name
          metadata: extractMetadata(parsed),
          stack: parsed.stack,
        };

        logs.push(logEntry);
      } catch (error) {
        // Skip malformed lines
        console.warn(`Failed to parse log line: ${line.substring(0, 100)}`);
      }
    });

    rl.on('close', () => {
      resolve(logs);
    });

    rl.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Extract metadata from parsed log object
 */
function extractMetadata(parsed: any): Record<string, any> | undefined {
  const metadata: Record<string, any> = {};
  let hasMetadata = false;

  // Copy all non-standard fields
  for (const key of Object.keys(parsed)) {
    if (!['level', 'message', 'timestamp', 'context', 'stack'].includes(key)) {
      metadata[key] = parsed[key];
      hasMetadata = true;
    }
  }

  return hasMetadata ? metadata : undefined;
}

/**
 * Apply filters to log entries
 */
function applyFilters(logs: LogEntry[], filter?: LogFilter): LogEntry[] {
  if (!filter) return logs;

  return logs.filter((log) => {
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
      const stackMatch = log.stack?.toLowerCase().includes(searchLower);

      if (!messageMatch && !serviceMatch && !stackMatch) {
        return false;
      }
    }

    return true;
  });
}
