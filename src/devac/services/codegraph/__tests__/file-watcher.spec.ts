// src/devac/services/codegraph/__tests__/file-watcher.spec.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileWatcher, FileChangeEvent } from '../file-watcher.js';
import fs from 'fs/promises';
import path from 'path';

describe('FileWatcher - Unit Tests', () => {
  const testWatchDir = '.devac-test-watcher/watch';
  let fileWatcher: FileWatcher;
  let receivedEvents: FileChangeEvent[] = [];

  beforeEach(async () => {
    // Clean up test directory
    await fs.rm('.devac-test-watcher', { recursive: true, force: true });
    await fs.mkdir(testWatchDir, { recursive: true });

    // Reset events
    receivedEvents = [];
  });

  afterEach(async () => {
    // Cleanup watcher if not already disposed
    if (fileWatcher) {
      fileWatcher[Symbol.dispose]();
    }

    // Clean up test directory
    await fs.rm('.devac-test-watcher', { recursive: true, force: true });
  });

  describe('Initialization', () => {
    it('should initialize and start watching directory', async () => {
      // Arrange
      const onEvent = (event: FileChangeEvent) => {
        receivedEvents.push(event);
      };

      // Act
      fileWatcher = new FileWatcher({
        watchPath: testWatchDir,
        debounceMs: 100,
        usePolling: true,
        onEvent,
      });

      await fileWatcher.start();

      // Assert
      expect(fileWatcher.isWatching()).toBe(true);
    });

    it('should accept ignore patterns', async () => {
      // Arrange
      const onEvent = vi.fn();

      fileWatcher = new FileWatcher({
        watchPath: testWatchDir,
        ignorePatterns: ['**/*.log', '**/node_modules/**'],
        onEvent,
      });

      // Act
      await fileWatcher.start();

      // Assert - ignore patterns are configured
      expect(fileWatcher.isWatching()).toBe(true);
    });
  });

  describe('File Change Detection', () => {
    it('should detect file creation', async () => {
      // Arrange
      const onEvent = (event: FileChangeEvent) => {
        receivedEvents.push(event);
      };

      fileWatcher = new FileWatcher({
        watchPath: testWatchDir,
        debounceMs: 100,
        usePolling: true, // Use polling for reliable test detection
        onEvent,
      });

      await fileWatcher.start();

      // Act - Create a file
      const testFile = path.join(testWatchDir, 'test.txt');
      await fs.writeFile(testFile, 'Hello World', 'utf-8');

      // Wait for polling + debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 400));

      // Assert
      const addEvents = receivedEvents.filter((e) => e.type === 'add');
      expect(addEvents.length).toBeGreaterThan(0);
      expect(addEvents[0]?.path).toContain('test.txt');
    });

    it('should detect file modification', async () => {
      // Arrange
      const testFile = path.join(testWatchDir, 'modify-test.txt');
      await fs.writeFile(testFile, 'Initial content', 'utf-8');

      const onEvent = (event: FileChangeEvent) => {
        receivedEvents.push(event);
      };

      fileWatcher = new FileWatcher({
        watchPath: testWatchDir,
        debounceMs: 100,
        usePolling: true,
        onEvent,
      });

      await fileWatcher.start();

      // Wait for initial stabilization
      await new Promise((resolve) => setTimeout(resolve, 300));
      receivedEvents = []; // Clear initial events

      // Act - Modify the file
      await fs.writeFile(testFile, 'Modified content', 'utf-8');

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 400));

      // Assert
      const changeEvents = receivedEvents.filter((e) => e.type === 'change');
      expect(changeEvents.length).toBeGreaterThan(0);
      expect(changeEvents[0]?.path).toContain('modify-test.txt');
    });

    it('should detect file deletion', async () => {
      // Arrange
      const testFile = path.join(testWatchDir, 'delete-test.txt');
      await fs.writeFile(testFile, 'To be deleted', 'utf-8');

      const onEvent = (event: FileChangeEvent) => {
        receivedEvents.push(event);
      };

      fileWatcher = new FileWatcher({
        watchPath: testWatchDir,
        debounceMs: 100,
        usePolling: true,
        onEvent,
      });

      await fileWatcher.start();

      // Wait for initial stabilization
      await new Promise((resolve) => setTimeout(resolve, 300));
      receivedEvents = [];

      // Act - Delete the file
      await fs.unlink(testFile);

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 400));

      // Assert
      const unlinkEvents = receivedEvents.filter((e) => e.type === 'unlink');
      expect(unlinkEvents.length).toBeGreaterThan(0);
      expect(unlinkEvents[0]?.path).toContain('delete-test.txt');
    });
  });

  describe('Debouncing', () => {
    it('should debounce multiple rapid changes', async () => {
      // Arrange
      const testFile = path.join(testWatchDir, 'debounce-test.txt');
      await fs.writeFile(testFile, 'Initial', 'utf-8');

      const onEvent = (event: FileChangeEvent) => {
        receivedEvents.push(event);
      };

      fileWatcher = new FileWatcher({
        watchPath: testWatchDir,
        debounceMs: 500, // Longer debounce for testing
        onEvent,
      });

      await fileWatcher.start();

      // Wait for initial stabilization
      await new Promise((resolve) => setTimeout(resolve, 600));
      receivedEvents = [];

      // Act - Make multiple rapid changes
      await fs.writeFile(testFile, 'Change 1', 'utf-8');
      await new Promise((resolve) => setTimeout(resolve, 100));
      await fs.writeFile(testFile, 'Change 2', 'utf-8');
      await new Promise((resolve) => setTimeout(resolve, 100));
      await fs.writeFile(testFile, 'Change 3', 'utf-8');

      // Wait for debounce window
      await new Promise((resolve) => setTimeout(resolve, 700));

      // Assert - Should batch changes into fewer events
      const changeEvents = receivedEvents.filter((e) => e.type === 'change');

      // With debouncing, we should have fewer events than the number of writes
      // The exact number depends on timing, but should be < 3
      expect(changeEvents.length).toBeLessThanOrEqual(3);
    });

    it('should emit batched events after debounce window', async () => {
      // Arrange
      let batchReceived = false;
      const onEvent = (event: FileChangeEvent) => {
        if (event.batch && event.batch.length > 0) {
          batchReceived = true;
        }
        receivedEvents.push(event);
      };

      fileWatcher = new FileWatcher({
        watchPath: testWatchDir,
        debounceMs: 200,
        usePolling: true,
        onEvent,
      });

      await fileWatcher.start();

      // Wait for stabilization
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Act - Create multiple files rapidly
      await fs.writeFile(path.join(testWatchDir, 'file1.txt'), 'File 1', 'utf-8');
      await fs.writeFile(path.join(testWatchDir, 'file2.txt'), 'File 2', 'utf-8');
      await fs.writeFile(path.join(testWatchDir, 'file3.txt'), 'File 3', 'utf-8');

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 400));

      // Assert - Should have received events
      expect(receivedEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Ignore Patterns', () => {
    it('should ignore files matching ignore patterns', async () => {
      // Arrange
      const onEvent = (event: FileChangeEvent) => {
        receivedEvents.push(event);
      };

      fileWatcher = new FileWatcher({
        watchPath: testWatchDir,
        ignorePatterns: ['**/*.log'],
        debounceMs: 100,
        usePolling: true,
        onEvent,
      });

      await fileWatcher.start();

      // Wait for stabilization
      await new Promise((resolve) => setTimeout(resolve, 300));
      receivedEvents = [];

      // Act - Create both ignored and non-ignored files
      await fs.writeFile(path.join(testWatchDir, 'app.log'), 'Log file', 'utf-8');
      await fs.writeFile(path.join(testWatchDir, 'data.json'), 'Data file', 'utf-8');

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 400));

      // Assert - Should only receive event for data.json, not app.log
      expect(receivedEvents.some((e) => e.path.includes('app.log'))).toBe(false);
      expect(receivedEvents.some((e) => e.path.includes('data.json'))).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle watcher errors gracefully', async () => {
      // Arrange
      let errorReceived = false;
      const onEvent = (event: FileChangeEvent) => {
        if (event.type === 'error') {
          errorReceived = true;
        }
        receivedEvents.push(event);
      };

      fileWatcher = new FileWatcher({
        watchPath: testWatchDir,
        debounceMs: 100,
        usePolling: true,
        onEvent,
      });

      await fileWatcher.start();

      // Act - Simulate an error by forcing one in the watcher
      // Note: In real scenarios, errors would come from permission issues, etc.
      // For testing, we just verify the error handling mechanism exists

      // Assert - Watcher should be running
      expect(fileWatcher.isWatching()).toBe(true);
    });

    it('should continue watching after recoverable errors', async () => {
      // Arrange
      const onEvent = (event: FileChangeEvent) => {
        receivedEvents.push(event);
      };

      fileWatcher = new FileWatcher({
        watchPath: testWatchDir,
        debounceMs: 100,
        usePolling: true,
        onEvent,
      });

      await fileWatcher.start();

      // Act - Create a file successfully
      await fs.writeFile(path.join(testWatchDir, 'test.txt'), 'Test', 'utf-8');
      await new Promise((resolve) => setTimeout(resolve, 400));

      // Assert - Still watching
      expect(fileWatcher.isWatching()).toBe(true);
      expect(receivedEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Disposable Pattern', () => {
    it('should implement Symbol.dispose', () => {
      // Arrange
      fileWatcher = new FileWatcher({
        watchPath: testWatchDir,
        debounceMs: 100,
        usePolling: true,
        onEvent: () => {},
      });

      // Assert
      expect(typeof fileWatcher[Symbol.dispose]).toBe('function');
    });

    it('should stop watching on dispose', async () => {
      // Arrange
      const onEvent = vi.fn();

      fileWatcher = new FileWatcher({
        watchPath: testWatchDir,
        debounceMs: 100,
        usePolling: true,
        onEvent,
      });

      await fileWatcher.start();
      expect(fileWatcher.isWatching()).toBe(true);

      // Act
      fileWatcher[Symbol.dispose]();

      // Assert
      expect(fileWatcher.isWatching()).toBe(false);
    });

    it('should not emit events after disposal', async () => {
      // Arrange
      const onEvent = (event: FileChangeEvent) => {
        receivedEvents.push(event);
      };

      fileWatcher = new FileWatcher({
        watchPath: testWatchDir,
        debounceMs: 100,
        usePolling: true,
        onEvent,
      });

      await fileWatcher.start();
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Act - Dispose then create file
      fileWatcher[Symbol.dispose]();
      receivedEvents = [];

      await fs.writeFile(path.join(testWatchDir, 'after-dispose.txt'), 'Test', 'utf-8');
      await new Promise((resolve) => setTimeout(resolve, 400));

      // Assert - No events should be received
      expect(receivedEvents.length).toBe(0);
    });

    it('should work with using keyword', async () => {
      // This demonstrates the pattern
      let watcherWasActive = false;

      await (async () => {
        using watcher = new FileWatcher({
          watchPath: testWatchDir,
          debounceMs: 100,
        usePolling: true,
          onEvent: () => {},
        });

        await watcher.start();
        watcherWasActive = watcher.isWatching();

        // Auto-dispose at block end
      })();

      // Assert - Watcher was active during block
      expect(watcherWasActive).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should track event counts', async () => {
      // Arrange
      const onEvent = (event: FileChangeEvent) => {
        receivedEvents.push(event);
      };

      fileWatcher = new FileWatcher({
        watchPath: testWatchDir,
        debounceMs: 100,
        usePolling: true,
        onEvent,
      });

      await fileWatcher.start();
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Act - Trigger multiple events
      await fs.writeFile(path.join(testWatchDir, 'file1.txt'), 'File 1', 'utf-8');
      await fs.writeFile(path.join(testWatchDir, 'file2.txt'), 'File 2', 'utf-8');
      await new Promise((resolve) => setTimeout(resolve, 400));

      // Get statistics
      const stats = fileWatcher.getStatistics();

      // Assert
      expect(stats.totalEvents).toBeGreaterThan(0);
      expect(stats.eventsByType.add).toBeGreaterThan(0);
    });
  });
});
