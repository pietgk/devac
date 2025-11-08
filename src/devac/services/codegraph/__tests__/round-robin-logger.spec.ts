// src/devac/services/codegraph/__tests__/round-robin-logger.spec.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RoundRobinLogger } from '../round-robin-logger.js';
import fs from 'fs/promises';
import path from 'path';

describe('RoundRobinLogger', () => {
  const testLogDir = '.devac-test/logs/codegraph';
  let logger: RoundRobinLogger;

  beforeEach(async () => {
    // Clean up test directory
    await fs.rm('.devac-test', { recursive: true, force: true });
  });

  afterEach(async () => {
    // Cleanup logger if not already disposed
    if (logger) {
      logger[Symbol.dispose]();
    }
    // Clean up test directory
    await fs.rm('.devac-test', { recursive: true, force: true });
  });

  describe('Initialization', () => {
    it('should create log directory if it does not exist', async () => {
      // Act
      logger = new RoundRobinLogger({
        logDir: testLogDir,
        maxFileSize: 1024, // 1KB for testing
        maxFiles: 3,
      });

      await logger.initialize();

      // Assert
      const dirExists = await fs
        .access(testLogDir)
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);
    });

    it('should create first log file (001.log)', async () => {
      // Act
      logger = new RoundRobinLogger({
        logDir: testLogDir,
        maxFileSize: 1024,
        maxFiles: 3,
      });

      await logger.initialize();
      await logger.write({ level: 'info', message: 'test' });

      // Assert
      const logFile = path.join(testLogDir, '001.log');
      const fileExists = await fs
        .access(logFile)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);
    });
  });

  describe('Structured JSON Logging', () => {
    it('should write structured JSON entries', async () => {
      // Arrange
      logger = new RoundRobinLogger({
        logDir: testLogDir,
        maxFileSize: 1024,
        maxFiles: 3,
      });

      await logger.initialize();

      // Act
      await logger.write({
        level: 'info',
        message: 'Test message',
        serviceId: 'test-service',
        metadata: { key: 'value' },
      });

      // Assert
      const logFile = path.join(testLogDir, '001.log');
      const content = await fs.readFile(logFile, 'utf-8');
      const lines = content.trim().split('\n');
      const entry = JSON.parse(lines[0]);

      expect(entry).toMatchObject({
        level: 'info',
        message: 'Test message',
        serviceId: 'test-service',
        metadata: { key: 'value' },
      });
      expect(entry.timestamp).toBeTruthy();
    });

    it('should write multiple entries in JSON format', async () => {
      // Arrange
      logger = new RoundRobinLogger({
        logDir: testLogDir,
        maxFileSize: 1024,
        maxFiles: 3,
      });

      await logger.initialize();

      // Act
      await logger.write({ level: 'info', message: 'Entry 1' });
      await logger.write({ level: 'warn', message: 'Entry 2' });
      await logger.write({ level: 'error', message: 'Entry 3' });

      // Assert
      const logFile = path.join(testLogDir, '001.log');
      const content = await fs.readFile(logFile, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]).message).toBe('Entry 1');
      expect(JSON.parse(lines[1]).message).toBe('Entry 2');
      expect(JSON.parse(lines[2]).message).toBe('Entry 3');
    });
  });

  describe('File Rotation', () => {
    it('should rotate to new file when size exceeds maxFileSize', async () => {
      // Arrange
      logger = new RoundRobinLogger({
        logDir: testLogDir,
        maxFileSize: 200, // Very small for testing
        maxFiles: 3,
      });

      await logger.initialize();

      // Act - Write enough to exceed 200 bytes
      const largeMessage = 'A'.repeat(100);
      await logger.write({ level: 'info', message: largeMessage });
      await logger.write({ level: 'info', message: largeMessage });
      await logger.write({ level: 'info', message: largeMessage }); // This should trigger rotation

      // Assert - Should have 2 files
      const files = await fs.readdir(testLogDir);
      expect(files).toContain('001.log');
      expect(files).toContain('002.log');
    });

    it('should delete oldest file when max files exceeded', async () => {
      // Arrange
      logger = new RoundRobinLogger({
        logDir: testLogDir,
        maxFileSize: 100, // Very small - each entry ~120 bytes, so 1 entry per file
        maxFiles: 3, // Only keep 3 files
      });

      await logger.initialize();

      // Act - Write 12 entries (creates 12 files, keeps last 3)
      const message = 'X'.repeat(50);
      for (let i = 0; i < 12; i++) {
        await logger.write({ level: 'info', message });
      }

      // Assert - Should only have 3 files (010.log, 011.log, 012.log)
      // Each entry is ~120 bytes (50 X's + JSON overhead), exceeds maxFileSize=100
      // So we create 1 file per entry, and keep only the last 3 files
      const files = await fs.readdir(testLogDir);
      expect(files).toHaveLength(3);
      expect(files).not.toContain('001.log'); // Oldest deleted
      expect(files).not.toContain('009.log'); // Also deleted
      expect(files).toContain('010.log');
      expect(files).toContain('011.log');
      expect(files).toContain('012.log');
    });
  });

  describe('Line Tracking', () => {
    it('should track line numbers for current file', async () => {
      // Arrange
      logger = new RoundRobinLogger({
        logDir: testLogDir,
        maxFileSize: 1024,
        maxFiles: 3,
      });

      await logger.initialize();

      // Act
      await logger.write({ level: 'info', message: 'Line 1' });
      await logger.write({ level: 'info', message: 'Line 2' });
      await logger.write({ level: 'info', message: 'Line 3' });

      // Assert
      const lineRange = logger.getCurrentLineRange();
      expect(lineRange).toEqual({ startLine: 1, endLine: 3 });
    });

    it('should reset line count on file rotation', async () => {
      // Arrange
      logger = new RoundRobinLogger({
        logDir: testLogDir,
        maxFileSize: 150,
        maxFiles: 3,
      });

      await logger.initialize();

      // Act
      const message = 'A'.repeat(60);
      await logger.write({ level: 'info', message }); // Line 1
      await logger.write({ level: 'info', message }); // Line 2
      await logger.write({ level: 'info', message }); // Rotates to new file, becomes line 1

      // Assert
      const lineRange = logger.getCurrentLineRange();
      expect(lineRange.startLine).toBe(1);
      expect(lineRange.endLine).toBe(1); // One line in new file
    });

    it('should provide current file path', async () => {
      // Arrange
      logger = new RoundRobinLogger({
        logDir: testLogDir,
        maxFileSize: 1024,
        maxFiles: 3,
      });

      await logger.initialize();
      await logger.write({ level: 'info', message: 'Test' });

      // Act
      const currentFile = logger.getCurrentFilePath();

      // Assert
      expect(currentFile).toBe(path.join(testLogDir, '001.log'));
    });
  });

  describe('Disposable Pattern (using keyword)', () => {
    it('should implement Symbol.dispose for using keyword', () => {
      // Arrange
      logger = new RoundRobinLogger({
        logDir: testLogDir,
        maxFileSize: 1024,
        maxFiles: 3,
      });

      // Assert
      expect(typeof logger[Symbol.dispose]).toBe('function');
    });

    it('should cleanup resources on dispose', async () => {
      // Arrange
      logger = new RoundRobinLogger({
        logDir: testLogDir,
        maxFileSize: 1024,
        maxFiles: 3,
      });

      await logger.initialize();
      await logger.write({ level: 'info', message: 'Before dispose' });

      // Act
      logger[Symbol.dispose]();

      // Assert - Should not throw, logger is disposed
      expect(() => logger.getCurrentFilePath()).toThrow();
    });

    it('should work with using keyword syntax', async () => {
      // This test demonstrates the pattern (TypeScript 5.2+)
      await (async () => {
        using testLogger = new RoundRobinLogger({
          logDir: testLogDir,
          maxFileSize: 1024,
          maxFiles: 3,
        });

        await testLogger.initialize();
        await testLogger.write({ level: 'info', message: 'Using keyword test' });

        // No explicit dispose needed - happens automatically
      })();

      // After block, logger should be disposed automatically
      // We can't test this directly without TypeScript 5.2+, but the pattern is demonstrated
    });
  });

  describe('Error Handling', () => {
    it('should not write after dispose', async () => {
      // Arrange
      logger = new RoundRobinLogger({
        logDir: testLogDir,
        maxFileSize: 1024,
        maxFiles: 3,
      });

      await logger.initialize();
      logger[Symbol.dispose]();

      // Act & Assert
      await expect(
        logger.write({ level: 'info', message: 'After dispose' })
      ).rejects.toThrow('RoundRobinLogger has been disposed');
    });

    it('should throw when accessing methods after dispose', () => {
      // Arrange
      logger = new RoundRobinLogger({
        logDir: testLogDir,
        maxFileSize: 1024,
        maxFiles: 3,
      });

      // Act
      logger[Symbol.dispose]();

      // Assert
      expect(() => logger.getCurrentFilePath()).toThrow('RoundRobinLogger has been disposed');
      expect(() => logger.getCurrentLineRange()).toThrow('RoundRobinLogger has been disposed');
    });
  });
});
