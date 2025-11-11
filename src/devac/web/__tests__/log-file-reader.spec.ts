// src/devac/web/__tests__/log-file-reader.spec.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readLogs } from '../log-file-reader.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('log-file-reader', () => {
  const testLogDir = path.join(__dirname, 'test-logs');

  beforeEach(async () => {
    // Create test log directory
    await fs.mkdir(testLogDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test log directory
    await fs.rm(testLogDir, { recursive: true, force: true });
  });

  describe('readLogs', () => {
    it('should read logs from combined.log file', async () => {
      // Create test log file
      const logContent = [
        JSON.stringify({ level: 'error', message: 'Error 1', timestamp: '2025-11-11T16:00:00.000Z', context: 'Service1' }),
        JSON.stringify({ level: 'warn', message: 'Warning 1', timestamp: '2025-11-11T16:01:00.000Z', context: 'Service2' }),
        JSON.stringify({ level: 'info', message: 'Info 1', timestamp: '2025-11-11T16:02:00.000Z', context: 'Service1' }),
      ].join('\n');

      await fs.writeFile(path.join(testLogDir, 'combined.log'), logContent);

      const logs = await readLogs({ logDir: testLogDir });

      expect(logs).toHaveLength(3);
      expect(logs[0].message).toBe('Info 1'); // Reverse chronological (newest first)
      expect(logs[1].message).toBe('Warning 1');
      expect(logs[2].message).toBe('Error 1');
    });

    it('should filter logs by level', async () => {
      const logContent = [
        JSON.stringify({ level: 'error', message: 'Error 1', timestamp: '2025-11-11T16:00:00.000Z', context: 'Service1' }),
        JSON.stringify({ level: 'warn', message: 'Warning 1', timestamp: '2025-11-11T16:01:00.000Z', context: 'Service2' }),
        JSON.stringify({ level: 'info', message: 'Info 1', timestamp: '2025-11-11T16:02:00.000Z', context: 'Service1' }),
      ].join('\n');

      await fs.writeFile(path.join(testLogDir, 'combined.log'), logContent);

      const logs = await readLogs({
        logDir: testLogDir,
        filter: { level: ['error', 'warn'] },
      });

      expect(logs).toHaveLength(2);
      expect(logs.every(log => log.level === 'error' || log.level === 'warn')).toBe(true);
    });

    it('should filter logs by service', async () => {
      const logContent = [
        JSON.stringify({ level: 'error', message: 'Error 1', timestamp: '2025-11-11T16:00:00.000Z', context: 'Service1' }),
        JSON.stringify({ level: 'warn', message: 'Warning 1', timestamp: '2025-11-11T16:01:00.000Z', context: 'Service2' }),
        JSON.stringify({ level: 'info', message: 'Info 1', timestamp: '2025-11-11T16:02:00.000Z', context: 'Service1' }),
      ].join('\n');

      await fs.writeFile(path.join(testLogDir, 'combined.log'), logContent);

      const logs = await readLogs({
        logDir: testLogDir,
        filter: { service: 'Service1' },
      });

      expect(logs).toHaveLength(2);
      expect(logs.every(log => log.service === 'Service1')).toBe(true);
    });

    it('should filter logs by timestamp (since)', async () => {
      const logContent = [
        JSON.stringify({ level: 'error', message: 'Error 1', timestamp: '2025-11-11T16:00:00.000Z', context: 'Service1' }),
        JSON.stringify({ level: 'warn', message: 'Warning 1', timestamp: '2025-11-11T16:01:00.000Z', context: 'Service2' }),
        JSON.stringify({ level: 'info', message: 'Info 1', timestamp: '2025-11-11T16:02:00.000Z', context: 'Service1' }),
      ].join('\n');

      await fs.writeFile(path.join(testLogDir, 'combined.log'), logContent);

      const sinceTimestamp = new Date('2025-11-11T16:01:00.000Z').getTime();

      const logs = await readLogs({
        logDir: testLogDir,
        filter: { since: sinceTimestamp },
      });

      expect(logs).toHaveLength(2);
      expect(logs.every(log => new Date(log.timestamp).getTime() >= sinceTimestamp)).toBe(true);
    });

    it('should filter logs by search text', async () => {
      const logContent = [
        JSON.stringify({ level: 'error', message: 'Database connection failed', timestamp: '2025-11-11T16:00:00.000Z', context: 'Service1' }),
        JSON.stringify({ level: 'warn', message: 'Cache miss', timestamp: '2025-11-11T16:01:00.000Z', context: 'Service2' }),
        JSON.stringify({ level: 'error', message: 'Network timeout', timestamp: '2025-11-11T16:02:00.000Z', context: 'Service1' }),
      ].join('\n');

      await fs.writeFile(path.join(testLogDir, 'combined.log'), logContent);

      const logs = await readLogs({
        logDir: testLogDir,
        filter: { search: 'failed' },
      });

      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Database connection failed');
    });

    it('should limit number of returned logs', async () => {
      const logContent = Array.from({ length: 10 }, (_, i) =>
        JSON.stringify({
          level: 'info',
          message: `Log ${i}`,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          context: 'Service1',
        })
      ).join('\n');

      await fs.writeFile(path.join(testLogDir, 'combined.log'), logContent);

      const logs = await readLogs({
        logDir: testLogDir,
        filter: { limit: 5 },
      });

      expect(logs).toHaveLength(5);
    });

    it('should return logs in chronological order when reverse=false', async () => {
      const logContent = [
        JSON.stringify({ level: 'error', message: 'Error 1', timestamp: '2025-11-11T16:00:00.000Z', context: 'Service1' }),
        JSON.stringify({ level: 'warn', message: 'Warning 1', timestamp: '2025-11-11T16:01:00.000Z', context: 'Service2' }),
        JSON.stringify({ level: 'info', message: 'Info 1', timestamp: '2025-11-11T16:02:00.000Z', context: 'Service1' }),
      ].join('\n');

      await fs.writeFile(path.join(testLogDir, 'combined.log'), logContent);

      const logs = await readLogs({
        logDir: testLogDir,
        reverse: false,
      });

      expect(logs[0].message).toBe('Error 1'); // Oldest first
      expect(logs[1].message).toBe('Warning 1');
      expect(logs[2].message).toBe('Info 1');
    });

    it('should handle empty log directory', async () => {
      const logs = await readLogs({ logDir: testLogDir });
      expect(logs).toEqual([]);
    });

    it('should skip malformed JSON lines', async () => {
      const logContent = [
        JSON.stringify({ level: 'error', message: 'Valid log', timestamp: '2025-11-11T16:00:00.000Z', context: 'Service1' }),
        'This is not valid JSON',
        JSON.stringify({ level: 'info', message: 'Another valid log', timestamp: '2025-11-11T16:01:00.000Z', context: 'Service2' }),
      ].join('\n');

      await fs.writeFile(path.join(testLogDir, 'combined.log'), logContent);

      const logs = await readLogs({ logDir: testLogDir });

      expect(logs).toHaveLength(2); // Should skip the invalid line
      expect(logs.every(log => log.message && log.level)).toBe(true);
    });

    it('should handle multiple log files', async () => {
      const log1Content = JSON.stringify({ level: 'error', message: 'Error in file 1', timestamp: '2025-11-11T16:00:00.000Z', context: 'Service1' });
      const log2Content = JSON.stringify({ level: 'warn', message: 'Warning in file 2', timestamp: '2025-11-11T16:01:00.000Z', context: 'Service2' });

      await fs.writeFile(path.join(testLogDir, 'combined.log'), log1Content);
      await fs.writeFile(path.join(testLogDir, 'combined.1'), log2Content);

      const logs = await readLogs({ logDir: testLogDir });

      expect(logs).toHaveLength(2);
    });

    it('should read service-specific log files', async () => {
      const logContent = JSON.stringify({ level: 'error', message: 'CodeGraph error', timestamp: '2025-11-11T16:00:00.000Z', context: 'CodeGraph' });

      await fs.writeFile(path.join(testLogDir, 'codegraph-001.log'), logContent);

      const logs = await readLogs({ logDir: testLogDir });

      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('CodeGraph error');
    });
  });
});
