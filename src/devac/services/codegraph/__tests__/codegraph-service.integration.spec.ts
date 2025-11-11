// src/devac/services/codegraph/__tests__/codegraph-service.integration.spec.ts

/**
 * CodeGraphService Integration Tests - Testing Trophy Approach
 *
 * These tests form THE BULK of our test suite (8-10 tests).
 * Focus: Test real user workflows with real dependencies.
 * Mocking: <10% (only AnalyzerService, which is expensive)
 * Approach: Test observable outcomes, not implementation details.
 *
 * Philosophy: "Write tests. Not too many. Mostly integration." - Kent C. Dodds
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { CodeGraphService } from '../codegraph-service.js';
import { Neo4jClient } from '../../../../database/neo4j-client.js';
import {
  createTestNeo4jClient,
  cleanTestDatabase,
} from '../../../../../test-setup/neo4j-test-utils.js';
import {
  createTestProject,
  queryCollections,
  queryCollection,
  queryServiceNode,
  queryLogFileLink,
  createServiceConfig,
  createTempDir,
  waitFor,
} from './test-helpers.js';
import type { BaseServiceEvent } from '../../base-service.js';

describe('CodeGraphService - Integration Tests (Trophy Bulk)', () => {
  let neo4jClient: Neo4jClient;
  let tempDir: string;
  let cleanupTempDir: () => Promise<void>;

  beforeEach(async () => {
    // Setup: Real Neo4j
    neo4jClient = await createTestNeo4jClient();
    await neo4jClient.initializeDriver('CodeGraphServiceIntegration');
    await cleanTestDatabase(neo4jClient, 'CodeGraphServiceIntegration');

    // Setup: Real temp directory
    const result = await createTempDir('codegraph-integration-');
    tempDir = result.tempDir;
    cleanupTempDir = result.cleanup;
  });

  afterEach(async () => {
    await neo4jClient.closeDriver('CodeGraphServiceIntegration');
    await cleanupTempDir();
  });

  // ========================================
  // Integration Test I1: Service Initialization
  // ========================================
  describe('I1: Service Initialization', () => {
    it('should initialize service with all real components', async () => {
      // Arrange: Create service config
      const config = createServiceConfig(tempDir, neo4jClient);

      // Act: Initialize service
      const service = new CodeGraphService(config);
      await service['initialize']();

      // Assert: Service node created in real Neo4j
      const serviceNode = await queryServiceNode(neo4jClient, 'test-codegraph');
      expect(serviceNode).toBeDefined();
      expect(serviceNode.name).toBe('Test CodeGraph Service');
      expect(serviceNode.type).toBe('codegraph');
      expect(serviceNode.status).toBe('initializing');
      expect(serviceNode.version).toBe('1.0.0');

      // Assert: Log directory created (real FS)
      const logDir = path.join(tempDir, 'logs');
      await expect(fs.access(logDir)).resolves.toBeUndefined();

      // Assert: Resource directory created (real FS)
      const resourceDir = path.join(tempDir, 'resources');
      await expect(fs.access(resourceDir)).resolves.toBeUndefined();

      // Cleanup
      await service['cleanup']();
    });

    it('should fail initialization if no directories configured', async () => {
      // Arrange: Config with empty directories
      const config = createServiceConfig(tempDir, neo4jClient, {
        directories: [],
      });

      // Act & Assert: Should throw
      const service = new CodeGraphService(config);
      await expect(service['initialize']()).rejects.toThrow(
        'CodeGraphService requires at least one directory to analyze'
      );
    });
  });

  // ========================================
  // Integration Test I2: Scan Real Files
  // ========================================
  describe('I2: Scan Real Files', () => {
    it('should scan project and create collection in Neo4j', async () => {
      // Arrange: Create real test project
      await createTestProject(tempDir, {
        'src/index.ts': 'console.log("hello");',
        'src/utils.ts': 'export const add = (a: number, b: number) => a + b;',
      });

      const config = createServiceConfig(tempDir, neo4jClient);
      const service = new CodeGraphService(config);
      await service['initialize']();

      // Mock only expensive analyzer (integration test mocking <10%)
      vi.spyOn(service['analyzerService'], 'analyze').mockResolvedValue(undefined);

      // Act: User action - scan
      const result = await service['scan']();

      // Assert: Observable outcomes
      expect(result.itemsFound).toBe(2); // Found 2 files

      // Assert: Collection created in real Neo4j
      const collections = await queryCollections(neo4jClient, 'test-codegraph');
      expect(collections).toHaveLength(1);
      expect(collections[0].itemsProcessed).toBe(2);
      expect(collections[0].nodesCreated).toBe(30); // 2 * 15
      expect(collections[0].relationshipsCreated).toBe(20); // 2 * 10
      expect(collections[0].errors).toBe(0);

      // Assert: Real log file created
      const logFiles = await fs.readdir(path.join(tempDir, 'logs'));
      expect(logFiles).toHaveLength(1);
      expect(logFiles[0]).toMatch(/^\d{3}\.log$/);

      // Assert: Log contains scan messages
      const logContent = await fs.readFile(
        path.join(tempDir, 'logs', logFiles[0]),
        'utf-8'
      );
      expect(logContent).toContain('Starting initial code scan');
      expect(logContent).toContain('Initial scan completed');

      // Cleanup
      await service['cleanup']();
    });

    it('should handle scan with no files found', async () => {
      // Arrange: Empty directory
      const config = createServiceConfig(tempDir, neo4jClient);
      const service = new CodeGraphService(config);
      await service['initialize']();

      vi.spyOn(service['analyzerService'], 'analyze').mockResolvedValue(undefined);

      // Act: Scan empty directory
      const result = await service['scan']();

      // Assert: No items found
      expect(result.itemsFound).toBe(0);

      // Assert: Collection still created (records zero activity)
      const collections = await queryCollections(neo4jClient, 'test-codegraph');
      expect(collections).toHaveLength(1);
      expect(collections[0].itemsProcessed).toBe(0);
      expect(collections[0].nodesCreated).toBe(0);

      // Cleanup
      await service['cleanup']();
    });

    it('should track errors during scan', async () => {
      // Arrange
      await createTestProject(tempDir, {
        'src/broken.ts': 'const x = ;', // Syntax error
      });

      const config = createServiceConfig(tempDir, neo4jClient);
      const service = new CodeGraphService(config);
      await service['initialize']();

      // Mock analyzer to throw error
      vi.spyOn(service['analyzerService'], 'analyze').mockRejectedValue(
        new Error('Parser failed')
      );

      // Act & Assert: Should throw
      await expect(service['scan']()).rejects.toThrow('Parser failed');

      // Assert: Error logged
      const logFiles = await fs.readdir(path.join(tempDir, 'logs'));
      const logContent = await fs.readFile(
        path.join(tempDir, 'logs', logFiles[0]),
        'utf-8'
      );
      expect(logContent).toContain('Scan failed');
      expect(logContent).toContain('Parser failed');

      // Cleanup
      await service['cleanup']();
    });
  });

  // ========================================
  // Integration Test I3: File Watcher Detects Changes
  // ========================================
  describe('I3: File Watcher Detects Changes', () => {
    it('should detect real file changes', async () => {
      // Arrange
      const config = createServiceConfig(tempDir, neo4jClient, {
        watch: true, // Enable watching
      });
      const service = new CodeGraphService(config);
      await service['initialize']();

      const detectedEvents: BaseServiceEvent[] = [];
      const stopWatcher = service['startWatcher']((e) => detectedEvents.push(e));

      // Wait for watcher to start
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Act: Real file system change
      await createTestProject(tempDir, {
        'new.ts': 'console.log("new file");',
      });

      // Wait for debounce (1000ms + buffer)
      await waitFor(() => detectedEvents.length > 0, 3000);

      // Assert: Event detected
      expect(detectedEvents).toHaveLength(1);
      expect(detectedEvents[0].type).toBe('FILE_CHANGED');
      expect(detectedEvents[0].path).toContain('new.ts');

      // Cleanup
      stopWatcher();
      await service['cleanup']();
    });

    it('should not watch if disabled in config', async () => {
      // Arrange
      const config = createServiceConfig(tempDir, neo4jClient, {
        watch: false, // Disabled
      });
      const service = new CodeGraphService(config);
      await service['initialize']();

      const detectedEvents: BaseServiceEvent[] = [];
      const stopWatcher = service['startWatcher']((e) => detectedEvents.push(e));

      // Act: Create file
      await createTestProject(tempDir, {
        'test.ts': 'console.log("test");',
      });

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Assert: No events (watcher disabled)
      expect(detectedEvents).toHaveLength(0);

      // Cleanup
      stopWatcher();
      await service['cleanup']();
    });

    it('should filter files by extension', async () => {
      // Arrange
      const config = createServiceConfig(tempDir, neo4jClient, {
        watch: true,
        extensions: ['.ts'], // Only .ts files
      });
      const service = new CodeGraphService(config);
      await service['initialize']();

      const detectedEvents: BaseServiceEvent[] = [];
      const stopWatcher = service['startWatcher']((e) => detectedEvents.push(e));

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Act: Create non-.ts file
      await createTestProject(tempDir, {
        'README.md': '# Test', // .md file (not in extensions)
      });

      // Wait
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Assert: No events (filtered out)
      expect(detectedEvents).toHaveLength(0);

      // Cleanup
      stopWatcher();
      await service['cleanup']();
    });
  });

  // ========================================
  // Integration Test I4: Process File Change
  // ========================================
  describe('I4: Process File Change', () => {
    it('should process file change and track in Neo4j', async () => {
      // Arrange
      await createTestProject(tempDir, {
        'src/main.ts': 'console.log("main");',
      });

      const config = createServiceConfig(tempDir, neo4jClient);
      const service = new CodeGraphService(config);
      await service['initialize']();

      vi.spyOn(service['analyzerService'], 'analyze').mockResolvedValue(undefined);

      // Do initial scan
      await service['scan']();

      // Act: Process file change
      const output = await service['process']({
        type: 'FILE_CHANGED',
        path: path.join(tempDir, 'src/main.ts'),
        changeType: 'change',
      });

      // Assert: ServiceOutput structure (API contract)
      expect(output.collectionId).toBeDefined();
      expect(output.serviceId).toBe('test-codegraph');
      expect(output.stats.itemsProcessed).toBe(1); // One file processed
      expect(output.stats.duration).toBeGreaterThan(0);
      expect(output.resources).toHaveLength(1);
      expect(output.resources[0].type).toBe('logfile');
      expect(output.resources[0].lineRange).toBeDefined();

      // Assert: New collection in real Neo4j
      const collections = await queryCollections(neo4jClient, 'test-codegraph');
      expect(collections).toHaveLength(2); // scan + process

      const processCollection = collections[0]; // Most recent
      expect(processCollection.itemsProcessed).toBe(1);
      expect(processCollection.nodesCreated).toBe(15); // Estimated
      expect(processCollection.relationshipsCreated).toBe(10); // Estimated

      // Cleanup
      await service['cleanup']();
    });

    it('should handle processing errors gracefully', async () => {
      // Arrange
      const config = createServiceConfig(tempDir, neo4jClient);
      const service = new CodeGraphService(config);
      await service['initialize']();

      // Mock analyzer to fail
      vi.spyOn(service['analyzerService'], 'analyze').mockRejectedValue(
        new Error('Analysis failed')
      );

      // Act & Assert
      await expect(
        service['process']({
          type: 'FILE_CHANGED',
          path: path.join(tempDir, 'test.ts'),
          changeType: 'change',
        })
      ).rejects.toThrow('Analysis failed');

      // Assert: Error logged
      const logFiles = await fs.readdir(path.join(tempDir, 'logs'));
      const logContent = await fs.readFile(
        path.join(tempDir, 'logs', logFiles[0]),
        'utf-8'
      );
      expect(logContent).toContain('Processing failed');

      // Cleanup
      await service['cleanup']();
    });
  });

  // ========================================
  // Integration Test I5: Log File Linking
  // ========================================
  describe('I5: Log File Linking', () => {
    it('should link collection to log file with line ranges', async () => {
      // Arrange
      await createTestProject(tempDir, {
        'src/test.ts': 'const x = 1;',
      });

      const config = createServiceConfig(tempDir, neo4jClient);
      const service = new CodeGraphService(config);
      await service['initialize']();

      vi.spyOn(service['analyzerService'], 'analyze').mockResolvedValue(undefined);

      // Act: Scan
      await service['scan']();

      // Assert: Collection linked to log
      const collections = await queryCollections(neo4jClient, 'test-codegraph');
      const collectionId = collections[0].id;

      const logLink = await queryLogFileLink(neo4jClient, collectionId);
      expect(logLink).toBeDefined();
      expect(logLink!.type).toBe('logfile');
      expect(logLink!.format).toBe('jsonl');
      expect(logLink!.startLine).toBeGreaterThan(0);
      expect(logLink!.endLine).toBeGreaterThanOrEqual(logLink!.startLine);

      // Assert: Log file actually exists
      await expect(fs.access(logLink!.path)).resolves.toBeUndefined();

      // Cleanup
      await service['cleanup']();
    });
  });

  // ========================================
  // Integration Test I6: Error Tracking
  // ========================================
  describe('I6: Error Tracking', () => {
    it('should track errors via ErrorManager', async () => {
      // Arrange
      const config = createServiceConfig(tempDir, neo4jClient);
      const service = new CodeGraphService(config);
      await service['initialize']();

      // Get error manager
      const errorManager = service['errorManager'];
      expect(errorManager).toBeDefined();

      // Act: Record errors
      errorManager.recordError({
        type: 'PARSING_ERROR',
        message: 'Test error',
        severity: 'error',
      });

      // Assert: Error tracked
      expect(errorManager.getErrorCount()).toBe(1);

      // Cleanup
      await service['cleanup']();
    });
  });

  // ========================================
  // Integration Test I7: Resource Manager
  // ========================================
  describe('I7: Resource Manager', () => {
    it('should initialize resource manager with real directory', async () => {
      // Arrange
      const config = createServiceConfig(tempDir, neo4jClient);
      const service = new CodeGraphService(config);

      // Act: Initialize
      await service['initialize']();

      // Assert: Resource directory created
      const resourceDir = path.join(tempDir, 'resources');
      await expect(fs.access(resourceDir)).resolves.toBeUndefined();

      // Assert: Resource manager available
      const resourceManager = service['resourceManager'];
      expect(resourceManager).toBeDefined();

      // Cleanup
      await service['cleanup']();
    });
  });

  // ========================================
  // Integration Test I8: Cleanup
  // ========================================
  describe('I8: Cleanup', () => {
    it('should cleanup all resources', async () => {
      // Arrange
      await createTestProject(tempDir, {
        'test.ts': 'const x = 1;',
      });

      const config = createServiceConfig(tempDir, neo4jClient, {
        watch: true,
      });
      const service = new CodeGraphService(config);
      await service['initialize']();

      vi.spyOn(service['analyzerService'], 'analyze').mockResolvedValue(undefined);

      await service['scan']();

      const stopWatcher = service['startWatcher'](() => {});

      // Act: Cleanup
      await service['cleanup']();

      // Assert: Service status updated in Neo4j
      const serviceNode = await queryServiceNode(neo4jClient, 'test-codegraph');
      expect(serviceNode.status).toBe('stopped');
      expect(serviceNode.stoppedAt).toBeDefined();

      // Assert: Collections still exist (data persisted)
      const collections = await queryCollections(neo4jClient, 'test-codegraph');
      expect(collections).toHaveLength(1);

      // Note: File watcher, logger, and resource manager are disposed via Disposable pattern
      // No explicit assertions needed (cleanup is best-effort)
    });
  });
});
