// src/devac/services/codegraph/__tests__/codegraph-service.e2e.spec.ts

/**
 * CodeGraphService E2E Tests - Testing Trophy Approach
 *
 * These tests are at THE TOP of the trophy (1-2 tests).
 * Focus: Full system test with all real components.
 * Mocking: <10% (only AnalyzerService)
 * Goal: Highest confidence in critical user journeys.
 *
 * Philosophy: E2E tests are expensive but provide high confidence.
 * Use sparingly for critical paths only.
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
  queryServiceNode,
  createServiceConfig,
  createTempDir,
  waitFor,
} from './test-helpers.js';
import type { BaseServiceEvent } from '../../base-service.js';

describe('CodeGraphService - E2E Tests (Trophy Top)', () => {
  let neo4jClient: Neo4jClient;
  let tempDir: string;
  let cleanupTempDir: () => Promise<void>;

  beforeEach(async () => {
    // Setup: Real Neo4j
    neo4jClient = await createTestNeo4jClient();
    await neo4jClient.initializeDriver('CodeGraphServiceE2E');
    await cleanTestDatabase(neo4jClient, 'CodeGraphServiceE2E');

    // Setup: Real temp directory
    const result = await createTempDir('codegraph-e2e-');
    tempDir = result.tempDir;
    cleanupTempDir = result.cleanup;
  });

  afterEach(async () => {
    await neo4jClient.closeDriver('CodeGraphServiceE2E');
    await cleanupTempDir();
  });

  // ========================================
  // E2E Test E1: Complete User Workflow
  // ========================================
  describe('E1: Complete Lifecycle', () => {
    it('should handle complete lifecycle: init → scan → watch → process → cleanup', async () => {
      // ========================================
      // Setup: Real project with real files
      // ========================================
      await createTestProject(tempDir, {
        'src/main.ts': 'console.log("main");',
        'src/utils.ts': 'export const add = (a: number, b: number) => a + b;',
      });

      const config = createServiceConfig(tempDir, neo4jClient, {
        watch: true, // Enable file watching
      });
      const service = new CodeGraphService(config);

      // Mock only analyzer (expensive operation)
      vi.spyOn(service['analyzerService'], 'analyze').mockResolvedValue(undefined);

      // ========================================
      // Step 1: Initialize (user starts service)
      // ========================================
      await service['initialize']();

      // Verify: Service node created
      let serviceNode = await queryServiceNode(neo4jClient, 'test-codegraph');
      expect(serviceNode).toBeDefined();
      expect(serviceNode.status).toBe('initializing');
      expect(serviceNode.name).toBe('Test CodeGraph Service');
      expect(serviceNode.version).toBe('1.0.0');

      // Verify: Directories created
      await expect(fs.access(path.join(tempDir, 'logs'))).resolves.toBeUndefined();
      await expect(fs.access(path.join(tempDir, 'resources'))).resolves.toBeUndefined();

      // ========================================
      // Step 2: Scan (initial analysis)
      // ========================================
      const scanResult = await service['scan']();

      // Verify: Files found
      expect(scanResult.itemsFound).toBe(2);

      // Verify: Collection created
      let collections = await queryCollections(neo4jClient, 'test-codegraph');
      expect(collections).toHaveLength(1);
      expect(collections[0].itemsProcessed).toBe(2);
      expect(collections[0].nodesCreated).toBe(30); // 2 * 15
      expect(collections[0].relationshipsCreated).toBe(20); // 2 * 10
      expect(collections[0].errors).toBe(0);

      // Verify: Log file created
      const logFiles = await fs.readdir(path.join(tempDir, 'logs'));
      expect(logFiles).toHaveLength(1);

      const logContent = await fs.readFile(
        path.join(tempDir, 'logs', logFiles[0]),
        'utf-8'
      );
      expect(logContent).toContain('Starting initial code scan');
      expect(logContent).toContain('Initial scan completed');

      // ========================================
      // Step 3: Watch (file monitoring)
      // ========================================
      const detectedEvents: BaseServiceEvent[] = [];
      const stopWatcher = service['startWatcher']((e) => detectedEvents.push(e));

      // Wait for watcher to start
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Simulate file change
      await fs.writeFile(
        path.join(tempDir, 'src/main.ts'),
        'console.log("updated");'
      );

      // Wait for file change detection (debounce + buffer)
      await waitFor(() => detectedEvents.length > 0, 3000);

      // Verify: File change detected
      expect(detectedEvents).toHaveLength(1);
      expect(detectedEvents[0].type).toBe('FILE_CHANGED');
      expect(detectedEvents[0].path).toContain('main.ts');
      expect(detectedEvents[0].changeType).toBe('change');

      // ========================================
      // Step 4: Process (handle change)
      // ========================================
      const output = await service['process']({
        type: 'FILE_CHANGED',
        path: path.join(tempDir, 'src/main.ts'),
        changeType: 'change',
      });

      // Verify: ServiceOutput returned
      expect(output.collectionId).toBeDefined();
      expect(output.serviceId).toBe('test-codegraph');
      expect(output.stats.itemsProcessed).toBe(1);
      expect(output.stats.duration).toBeGreaterThan(0);
      expect(output.resources).toHaveLength(1);
      expect(output.resources[0].type).toBe('logfile');

      // Verify: Second collection created
      collections = await queryCollections(neo4jClient, 'test-codegraph');
      expect(collections).toHaveLength(2); // scan + process

      const processCollection = collections[0]; // Most recent
      expect(processCollection.itemsProcessed).toBe(1);
      expect(processCollection.nodesCreated).toBe(15);
      expect(processCollection.relationshipsCreated).toBe(10);

      // ========================================
      // Step 5: Cleanup (user stops service)
      // ========================================
      stopWatcher(); // Stop watching first
      await service['cleanup']();

      // Verify: Service status updated
      serviceNode = await queryServiceNode(neo4jClient, 'test-codegraph');
      expect(serviceNode.status).toBe('stopped');
      expect(serviceNode.stoppedAt).toBeDefined();

      // Verify: Collections still exist (data persisted)
      const finalCollections = await queryCollections(neo4jClient, 'test-codegraph');
      expect(finalCollections).toHaveLength(2);

      // Verify: Log files still exist
      const finalLogFiles = await fs.readdir(path.join(tempDir, 'logs'));
      expect(finalLogFiles).toHaveLength(1);

      // ========================================
      // Success: Complete user journey verified! 🎉
      // ========================================
    });

    it('should handle errors gracefully throughout lifecycle', async () => {
      // Arrange: Project with problematic file
      await createTestProject(tempDir, {
        'src/broken.ts': 'const x = ;', // Syntax error
      });

      const config = createServiceConfig(tempDir, neo4jClient);
      const service = new CodeGraphService(config);

      // Mock analyzer to fail
      vi.spyOn(service['analyzerService'], 'analyze').mockRejectedValue(
        new Error('Parser failed')
      );

      // Act: Initialize successfully
      await service['initialize']();

      const serviceNode = await queryServiceNode(neo4jClient, 'test-codegraph');
      expect(serviceNode.status).toBe('initializing');

      // Act: Scan fails
      await expect(service['scan']()).rejects.toThrow('Parser failed');

      // Assert: Error logged
      const logFiles = await fs.readdir(path.join(tempDir, 'logs'));
      const logContent = await fs.readFile(
        path.join(tempDir, 'logs', logFiles[0]),
        'utf-8'
      );
      expect(logContent).toContain('Scan failed');
      expect(logContent).toContain('Parser failed');

      // Act: Cleanup still works (graceful degradation)
      await expect(service['cleanup']()).resolves.toBeUndefined();

      // Assert: Service marked as stopped
      const finalServiceNode = await queryServiceNode(neo4jClient, 'test-codegraph');
      expect(finalServiceNode.status).toBe('stopped');
    });
  });

  // ========================================
  // E2E Test E2: Multiple Scan Cycles
  // ========================================
  describe('E2: Multiple Scan Cycles', () => {
    it('should handle multiple scan-process cycles correctly', async () => {
      // Arrange
      await createTestProject(tempDir, {
        'file1.ts': 'const a = 1;',
      });

      const config = createServiceConfig(tempDir, neo4jClient);
      const service = new CodeGraphService(config);
      await service['initialize']();

      vi.spyOn(service['analyzerService'], 'analyze').mockResolvedValue(undefined);

      // Act: First scan
      await service['scan']();
      let collections = await queryCollections(neo4jClient, 'test-codegraph');
      expect(collections).toHaveLength(1);

      // Act: Process change
      await service['process']({
        type: 'FILE_CHANGED',
        path: path.join(tempDir, 'file1.ts'),
        changeType: 'change',
      });
      collections = await queryCollections(neo4jClient, 'test-codegraph');
      expect(collections).toHaveLength(2);

      // Act: Second scan (full re-analysis)
      await service['scan']();
      collections = await queryCollections(neo4jClient, 'test-codegraph');
      expect(collections).toHaveLength(3);

      // Act: Another process
      await service['process']({
        type: 'FILE_CHANGED',
        path: path.join(tempDir, 'file1.ts'),
        changeType: 'change',
      });
      collections = await queryCollections(neo4jClient, 'test-codegraph');
      expect(collections).toHaveLength(4);

      // Assert: All collections tracked correctly
      expect(collections[0].itemsProcessed).toBe(1); // Latest process
      expect(collections[1].itemsProcessed).toBe(1); // Latest scan
      expect(collections[2].itemsProcessed).toBe(1); // First process
      expect(collections[3].itemsProcessed).toBe(1); // First scan

      // Cleanup
      await service['cleanup']();
    });
  });
});
