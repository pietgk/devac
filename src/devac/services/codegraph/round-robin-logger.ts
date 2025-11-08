// src/devac/services/codegraph/round-robin-logger.ts

import fs from 'fs/promises';
import path from 'path';

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
  message: string;
  serviceId?: string;
  metadata?: Record<string, any>;
  timestamp?: string;
}

export interface RoundRobinLoggerOptions {
  logDir: string;
  maxFileSize: number; // bytes
  maxFiles: number;
}

export interface LineRange {
  startLine: number;
  endLine: number;
}

/**
 * Round-robin logger that writes structured JSON logs to rotating files.
 * Implements Disposable pattern for use with TypeScript 'using' keyword.
 */
export class RoundRobinLogger implements Disposable {
  private readonly logDir: string;
  private readonly maxFileSize: number;
  private readonly maxFiles: number;

  private currentFileNumber: number = 1;
  private currentFileSize: number = 0;
  private currentLineCount: number = 0;
  private disposed: boolean = false;

  constructor(options: RoundRobinLoggerOptions) {
    this.logDir = options.logDir;
    this.maxFileSize = options.maxFileSize;
    this.maxFiles = options.maxFiles;
  }

  /**
   * Initialize the logger by creating the log directory.
   */
  async initialize(): Promise<void> {
    this.checkDisposed();
    await fs.mkdir(this.logDir, { recursive: true });
  }

  /**
   * Write a log entry as structured JSON.
   */
  async write(entry: LogEntry): Promise<void> {
    this.checkDisposed();

    // Add timestamp if not present
    const fullEntry: LogEntry & { timestamp: string } = {
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
    };

    // Serialize to JSON with newline
    const line = JSON.stringify(fullEntry) + '\n';
    const lineBytes = Buffer.byteLength(line, 'utf-8');

    // Check if current file is full, rotate before writing
    // (but not on the very first write)
    if (this.currentFileSize >= this.maxFileSize && this.currentLineCount > 0) {
      await this.rotate();
    }

    // Write to current file
    const currentFile = this.getCurrentFilePath();
    await fs.appendFile(currentFile, line, 'utf-8');

    // Update tracking
    this.currentFileSize += lineBytes;
    this.currentLineCount++;
  }

  /**
   * Get the current line range for the active log file.
   */
  getCurrentLineRange(): LineRange {
    this.checkDisposed();
    return {
      startLine: 1,
      endLine: this.currentLineCount,
    };
  }

  /**
   * Get the current log file path.
   */
  getCurrentFilePath(): string {
    this.checkDisposed();
    const fileName = this.formatFileName(this.currentFileNumber);
    return path.join(this.logDir, fileName);
  }

  /**
   * Dispose of resources (implements Disposable pattern).
   */
  [Symbol.dispose](): void {
    this.disposed = true;
  }

  /**
   * Rotate to a new log file.
   */
  private async rotate(): Promise<void> {
    // Increment file number
    this.currentFileNumber++;

    // Reset tracking for new file
    this.currentFileSize = 0;
    this.currentLineCount = 0;

    // Delete oldest file if we exceed maxFiles
    await this.cleanupOldFiles();
  }

  /**
   * Delete oldest files if we exceed maxFiles limit.
   */
  private async cleanupOldFiles(): Promise<void> {
    // Get all log files
    const files = await this.getLogFiles();

    // If we exceed maxFiles, delete the oldest
    if (files.length >= this.maxFiles) {
      const filesToDelete = files.length - this.maxFiles + 1;
      for (let i = 0; i < filesToDelete; i++) {
        const oldestFile = files[i];
        if (oldestFile) {
          const filePath = path.join(this.logDir, oldestFile);
          await fs.unlink(filePath);
        }
      }
    }
  }

  /**
   * Get all log files in the directory, sorted by file number.
   */
  private async getLogFiles(): Promise<string[]> {
    try {
      const allFiles = await fs.readdir(this.logDir);
      const logFiles = allFiles.filter((f) => f.endsWith('.log'));

      // Sort by file number (001.log, 002.log, etc.)
      return logFiles.sort((a, b) => {
        const numA = parseInt(a.replace('.log', ''), 10);
        const numB = parseInt(b.replace('.log', ''), 10);
        return numA - numB;
      });
    } catch (error) {
      return [];
    }
  }

  /**
   * Format file number as 3-digit string (001, 002, etc.).
   */
  private formatFileName(num: number): string {
    return `${num.toString().padStart(3, '0')}.log`;
  }

  /**
   * Check if logger is disposed and throw if so.
   */
  private checkDisposed(): void {
    if (this.disposed) {
      throw new Error('RoundRobinLogger has been disposed');
    }
  }
}
