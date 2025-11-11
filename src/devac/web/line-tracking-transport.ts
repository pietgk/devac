// src/devac/web/line-tracking-transport.ts

import winston from "winston";
import Transport from "winston-transport";
import fs from "fs/promises";
import path from "path";
import type { LineRange } from "../types/logging.js";

/**
 * Configuration for LineTrackingTransport
 */
export interface LineTrackingTransportOptions
  extends Transport.TransportStreamOptions {
  /** Directory where log files will be stored */
  dirname: string;
  /** Base filename (e.g., 'service-codegraph.log') */
  filename: string;
  /** Maximum file size in bytes before rotation */
  maxFileSize: number;
  /** Maximum number of rotated files to keep */
  maxFiles: number;
}

/**
 * Winston transport that writes JSON logs with line number tracking.
 *
 * Features:
 * - Writes one JSON object per line (JSONL format)
 * - Tracks line numbers for linking to Neo4j collections
 * - Rotating file support (001.log, 002.log, etc.)
 * - Session markers for grouping related logs
 *
 * Usage:
 * ```typescript
 * const transport = new LineTrackingTransport({
 *   dirname: './logs/services',
 *   filename: 'codegraph.log',
 *   maxFileSize: 5 * 1024 * 1024, // 5MB
 *   maxFiles: 5,
 * });
 *
 * logger.add(transport);
 *
 * // Later, get line ranges for Neo4j
 * const range = transport.getSessionLineRange();
 * ```
 */
export class LineTrackingTransport extends Transport {
  private readonly dirname: string;
  private readonly baseFilename: string;
  private readonly maxFileSize: number;
  private readonly maxFiles: number;

  private currentFileNumber: number = 1;
  private currentFileSize: number = 0;
  private currentLineCount: number = 0;
  private sessionStartLine: number = 0;

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(opts: LineTrackingTransportOptions) {
    super(opts);

    this.dirname = opts.dirname;
    this.baseFilename = opts.filename;
    this.maxFileSize = opts.maxFileSize;
    this.maxFiles = opts.maxFiles;
  }

  /**
   * Initialize the transport (create log directory)
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.dirname, { recursive: true });
  }

  /**
   * Winston transport log method
   */
  override log(info: any, callback: () => void): void {
    setImmediate(() => {
      this.writeQueue = this.writeQueue.then(async () => {
        try {
          await this.writeLog(info);
          this.emit("logged", info);
          callback();
        } catch (error) {
          this.emit("error", error);
          callback();
        }
      });
    });
  }

  /**
   * Write a log entry to file
   */
  private async writeLog(info: any): Promise<void> {
    // Format as single JSON line
    const line =
      JSON.stringify({
        level: info.level,
        message: info.message,
        timestamp: info.timestamp,
        service: info.context,
        metadata: info.metadata || {},
        stack: info.stack,
      }) + "\n";

    const lineBytes = Buffer.byteLength(line, "utf-8");

    // Check if rotation needed
    if (this.currentFileSize >= this.maxFileSize && this.currentLineCount > 0) {
      await this.rotate();
    }

    // Write to current file
    const currentFile = this.getCurrentFilePath();
    await fs.appendFile(currentFile, line, "utf-8");

    // Update tracking
    this.currentFileSize += lineBytes;
    this.currentLineCount++;
  }

  /**
   * Rotate to a new log file
   */
  private async rotate(): Promise<void> {
    // Increment file number
    this.currentFileNumber++;

    // Reset tracking
    this.currentFileSize = 0;
    this.currentLineCount = 0;
    this.sessionStartLine = 0;

    // Cleanup old files
    await this.cleanupOldFiles();
  }

  /**
   * Delete oldest files if exceeding maxFiles limit
   */
  private async cleanupOldFiles(): Promise<void> {
    const files = await this.getLogFiles();

    if (files.length >= this.maxFiles) {
      const filesToDelete = files.length - this.maxFiles + 1;
      for (let i = 0; i < filesToDelete; i++) {
        const oldestFile = files[i];
        if (oldestFile !== undefined) {
          const filePath = path.join(this.dirname, oldestFile);
          try {
            await fs.unlink(filePath);
          } catch (error) {
            // Ignore errors - file may already be deleted
          }
        }
      }
    }
  }

  /**
   * Get all log files in directory, sorted by file number
   */
  private async getLogFiles(): Promise<string[]> {
    try {
      const allFiles = await fs.readdir(this.dirname);
      const logFiles = allFiles.filter(
        (f) => f.startsWith(this.getFilePrefix()) && f.endsWith(".log"),
      );

      // Sort by file number (001.log, 002.log, etc.)
      return logFiles.sort((a, b) => {
        const numA = this.extractFileNumber(a);
        const numB = this.extractFileNumber(b);
        return numA - numB;
      });
    } catch (error) {
      return [];
    }
  }

  /**
   * Extract file number from filename (e.g., "codegraph-001.log" → 1)
   */
  private extractFileNumber(filename: string): number {
    const match = filename.match(/-(\d+)\.log$/);
    return match && match[1] ? parseInt(match[1], 10) : 0;
  }

  /**
   * Get file prefix (e.g., "codegraph" from "codegraph.log")
   */
  private getFilePrefix(): string {
    return this.baseFilename.replace(/\.log$/, "");
  }

  /**
   * Format file number as 3-digit string (001, 002, etc.)
   */
  private formatFileName(num: number): string {
    const prefix = this.getFilePrefix();
    return `${prefix}-${num.toString().padStart(3, "0")}.log`;
  }

  /**
   * Get current log file path
   */
  getCurrentFilePath(): string {
    const fileName = this.formatFileName(this.currentFileNumber);
    return path.join(this.dirname, fileName);
  }

  /**
   * Get current line range for active file
   */
  getCurrentLineRange(): LineRange {
    return {
      startLine: 1,
      endLine: this.currentLineCount,
    };
  }

  /**
   * Get line range for current session
   */
  getSessionLineRange(): LineRange {
    return {
      startLine: this.sessionStartLine || 1,
      endLine: this.currentLineCount,
    };
  }

  /**
   * Mark the start of a new session
   */
  markSessionStart(): void {
    this.sessionStartLine = this.currentLineCount + 1;
  }

  /**
   * Get current line count
   */
  getCurrentLineCount(): number {
    return this.currentLineCount;
  }

  /**
   * Get current file size
   */
  async getCurrentFileSize(): Promise<number> {
    try {
      const filePath = this.getCurrentFilePath();
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (error) {
      return this.currentFileSize;
    }
  }
}
