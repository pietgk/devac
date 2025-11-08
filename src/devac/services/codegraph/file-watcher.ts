// src/devac/services/codegraph/file-watcher.ts

import chokidar, { FSWatcher } from 'chokidar';

export type FileChangeType = 'add' | 'change' | 'unlink' | 'error';

export interface FileChangeEvent {
  type: FileChangeType;
  path: string;
  timestamp: number;
  batch?: FileChangeEvent[];
  error?: Error;
}

export interface FileWatcherOptions {
  watchPath: string;
  ignorePatterns?: string[];
  debounceMs?: number;
  onEvent: (event: FileChangeEvent) => void;
  usePolling?: boolean; // Enable polling for test environments
}

export interface WatcherStatistics {
  totalEvents: number;
  eventsByType: {
    add: number;
    change: number;
    unlink: number;
    error: number;
  };
  startTime: number;
  uptime: number;
}

/**
 * FileWatcher monitors file system changes with debouncing.
 * Implements Disposable pattern for use with TypeScript 'using' keyword.
 */
export class FileWatcher implements Disposable {
  private readonly watchPath: string;
  private readonly ignorePatterns: string[];
  private readonly debounceMs: number;
  private readonly onEvent: (event: FileChangeEvent) => void;

  private watcher: FSWatcher | null = null;
  private disposed: boolean = false;
  private watching: boolean = false;

  // Debouncing state
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingEvents: FileChangeEvent[] = [];

  // Statistics
  private stats: WatcherStatistics = {
    totalEvents: 0,
    eventsByType: {
      add: 0,
      change: 0,
      unlink: 0,
      error: 0,
    },
    startTime: 0,
    uptime: 0,
  };

  private readonly usePolling: boolean;

  constructor(options: FileWatcherOptions) {
    this.watchPath = options.watchPath;
    this.ignorePatterns = options.ignorePatterns || [];
    this.debounceMs = options.debounceMs ?? 500;
    this.onEvent = options.onEvent;
    this.usePolling = options.usePolling ?? false;
  }

  /**
   * Start watching for file changes.
   */
  async start(): Promise<void> {
    this.checkDisposed();

    if (this.watching) {
      return;
    }

    this.stats.startTime = Date.now();

    try {
      this.watcher = chokidar.watch(this.watchPath, {
        ignored: this.ignorePatterns,
        persistent: true,
        ignoreInitial: true, // Ignore files that exist before watching starts
        awaitWriteFinish: false, // Don't wait for write to finish - faster event detection
        usePolling: this.usePolling, // Use polling if requested (for test environments)
        interval: this.usePolling ? 100 : undefined, // Poll every 100ms if using polling
      });

      // Register event handlers
      this.watcher.on('add', (path: string) => this.handleFileEvent('add', path));
      this.watcher.on('change', (path: string) => this.handleFileEvent('change', path));
      this.watcher.on('unlink', (path: string) => this.handleFileEvent('unlink', path));
      this.watcher.on('error', (error: Error) => this.handleError(error));

      // Wait for watcher to be ready
      await new Promise<void>((resolve, reject) => {
        this.watcher!.on('ready', () => {
          this.watching = true;
          resolve();
        });

        this.watcher!.on('error', (error: Error) => {
          this.watching = false;
          reject(error);
        });
      });
    } catch (error: any) {
      this.watching = false;
      this.handleError(error);
      throw error;
    }
  }

  /**
   * Stop watching for file changes.
   */
  async stop(): Promise<void> {
    if (!this.watching || !this.watcher) {
      return;
    }

    // Flush any pending events
    this.flushPendingEvents();

    // Close watcher
    await this.watcher.close();
    this.watcher = null;
    this.watching = false;

    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Check if watcher is currently active.
   */
  isWatching(): boolean {
    return this.watching;
  }

  /**
   * Get watcher statistics.
   */
  getStatistics(): WatcherStatistics {
    return {
      ...this.stats,
      uptime: this.watching ? Date.now() - this.stats.startTime : 0,
    };
  }

  /**
   * Force flush pending events (useful for testing).
   * @internal
   */
  _forceFlush(): void {
    this.flushPendingEvents();
  }

  /**
   * Dispose of resources (implements Disposable pattern).
   */
  [Symbol.dispose](): void {
    this.disposed = true;
    this.watching = false; // Set immediately for synchronous checks

    // Async cleanup in background
    this.stop().catch(() => {
      // Ignore errors during disposal
    });
  }

  /**
   * Handle file system event.
   */
  private handleFileEvent(type: FileChangeType, filePath: string): void {
    if (this.disposed || !this.watching) {
      return;
    }

    const event: FileChangeEvent = {
      type,
      path: filePath,
      timestamp: Date.now(),
    };

    // Add to pending events
    this.pendingEvents.push(event);

    // Update statistics
    this.stats.totalEvents++;
    this.stats.eventsByType[type]++;

    // Reset debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flushPendingEvents();
    }, this.debounceMs);
  }

  /**
   * Handle watcher error.
   */
  private handleError(error: Error): void {
    if (this.disposed) {
      return;
    }

    const errorEvent: FileChangeEvent = {
      type: 'error',
      path: this.watchPath,
      timestamp: Date.now(),
      error,
    };

    this.stats.totalEvents++;
    this.stats.eventsByType.error++;

    this.onEvent(errorEvent);
  }

  /**
   * Flush pending events to the callback.
   */
  private flushPendingEvents(): void {
    if (this.disposed || this.pendingEvents.length === 0) {
      return;
    }

    try {
      // If we have multiple events, batch them
      if (this.pendingEvents.length > 1) {
        // Send each event with batch context
        const batch = [...this.pendingEvents];
        for (const event of batch) {
          this.onEvent({ ...event, batch });
        }
      } else {
        // Single event, send directly
        const event = this.pendingEvents[0];
        if (event) {
          this.onEvent(event);
        }
      }
    } catch (error) {
      // Ignore callback errors
    } finally {
      // Clear pending events
      this.pendingEvents = [];

      // Clear timer
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
    }
  }

  /**
   * Check if watcher is disposed and throw if so.
   */
  private checkDisposed(): void {
    if (this.disposed) {
      throw new Error('FileWatcher has been disposed');
    }
  }
}
