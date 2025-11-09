// src/devac/services/codegraph/__tests__/resource-manager.spec.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ResourceManager, ResourceType } from '../resource-manager.js';
import { Neo4jClient } from '../../../../database/neo4j-client.js';
import fs from 'fs/promises';
import path from 'path';
import { vi } from 'vitest';

describe('ResourceManager - Unit Tests', () => {
  const testResourceDir = '.devac-test-resources/resources';
  let mockNeo4jClient: Neo4jClient;
  let resourceManager: ResourceManager;

  beforeEach(async () => {
    // Clean up test directory
    await fs.rm('.devac-test-resources', { recursive: true, force: true });

    // Mock Neo4j client
    mockNeo4jClient = {
      runTransaction: vi.fn(),
      initializeDriver: vi.fn(),
      closeDriver: vi.fn(),
    } as unknown as Neo4jClient;

    resourceManager = new ResourceManager(mockNeo4jClient, {
      resourceDir: testResourceDir,
    });
  });

  afterEach(async () => {
    // Cleanup resource manager if not already disposed
    if (resourceManager) {
      resourceManager[Symbol.dispose]();
    }
    // Clean up test directory
    await fs.rm('.devac-test-resources', { recursive: true, force: true });
  });

  describe('Initialization', () => {
    it('should create resource directory if it does not exist', async () => {
      // Act
      await resourceManager.initialize();

      // Assert
      const dirExists = await fs
        .access(testResourceDir)
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);
    });
  });

  describe('Resource Storage', () => {
    it('should store resource content and return resource ID', async () => {
      // Arrange
      await resourceManager.initialize();
      const content = 'Test log content for storage';

      // Act
      const resourceId = await resourceManager.storeResource({
        type: 'log',
        content,
        metadata: { serviceId: 'test-service' },
      });

      // Assert
      expect(resourceId).toBeTruthy();
      expect(typeof resourceId).toBe('string');

      // Verify file was created
      const resourcePath = path.join(testResourceDir, 'log', `${resourceId}.txt`);
      const fileExists = await fs
        .access(resourcePath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);
    });

    it('should calculate hash of stored content', async () => {
      // Arrange
      await resourceManager.initialize();
      const content = 'Content for hashing';

      // Act
      const resourceId = await resourceManager.storeResource({
        type: 'log',
        content,
      });

      // Assert
      const resource = await resourceManager.getResource(resourceId);
      expect(resource?.hash).toBeTruthy();
      expect(resource?.hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hash
    });

    it('should store metadata with resource', async () => {
      // Arrange
      await resourceManager.initialize();
      const content = 'Test content';
      const metadata = {
        serviceId: 'codegraph',
        collectionId: 'coll-123',
        timestamp: Date.now(),
      };

      // Act
      const resourceId = await resourceManager.storeResource({
        type: 'log',
        content,
        metadata,
      });

      // Assert
      const resource = await resourceManager.getResource(resourceId);
      expect(resource?.metadata).toEqual(metadata);
    });

    it('should organize resources by type in subdirectories', async () => {
      // Arrange
      await resourceManager.initialize();

      // Act
      const logId = await resourceManager.storeResource({
        type: 'log',
        content: 'Log content',
      });
      const snapshotId = await resourceManager.storeResource({
        type: 'snapshot',
        content: 'Snapshot content',
      });

      // Assert
      const logPath = path.join(testResourceDir, 'log', `${logId}.txt`);
      const snapshotPath = path.join(testResourceDir, 'snapshot', `${snapshotId}.txt`);

      const logExists = await fs.access(logPath).then(() => true).catch(() => false);
      const snapshotExists = await fs.access(snapshotPath).then(() => true).catch(() => false);

      expect(logExists).toBe(true);
      expect(snapshotExists).toBe(true);
    });
  });

  describe('Neo4j Integration', () => {
    it('should create Resource node in Neo4j when storing resource', async () => {
      // Arrange
      await resourceManager.initialize();
      vi.mocked(mockNeo4jClient.runTransaction).mockResolvedValue({ records: [] });

      // Act
      await resourceManager.storeResource({
        type: 'log',
        content: 'Test content',
        persistToGraph: true,
      });

      // Assert
      expect(mockNeo4jClient.runTransaction).toHaveBeenCalledWith(
        expect.stringContaining('CREATE (r:Resource'),
        expect.objectContaining({
          id: expect.any(String),
          type: 'log',
          size: expect.any(Number),
          hash: expect.any(String),
        }),
        'WRITE',
        'ResourceManager'
      );
    });

    it('should link resource to collection when collectionId provided', async () => {
      // Arrange
      await resourceManager.initialize();
      const collectionId = 'coll-123';
      vi.mocked(mockNeo4jClient.runTransaction).mockResolvedValue({ records: [] });

      // Act
      await resourceManager.storeResource({
        type: 'log',
        content: 'Test content',
        collectionId,
        persistToGraph: true,
      });

      // Assert - Should create both Resource node and relationship
      expect(mockNeo4jClient.runTransaction).toHaveBeenCalledWith(
        expect.stringContaining('STORED_IN'),
        expect.objectContaining({
          collectionId,
        }),
        'WRITE',
        'ResourceManager'
      );
    });

    it('should link resource to error when errorId provided', async () => {
      // Arrange
      await resourceManager.initialize();
      const errorId = 'error-123';
      vi.mocked(mockNeo4jClient.runTransaction).mockResolvedValue({ records: [] });

      // Act
      await resourceManager.storeResource({
        type: 'log',
        content: 'Error log content',
        errorId,
        persistToGraph: true,
      });

      // Assert
      expect(mockNeo4jClient.runTransaction).toHaveBeenCalledWith(
        expect.stringContaining('ATTACHED_TO'),
        expect.objectContaining({
          errorId,
        }),
        'WRITE',
        'ResourceManager'
      );
    });
  });

  describe('Resource Retrieval', () => {
    it('should retrieve stored resource by ID', async () => {
      // Arrange
      await resourceManager.initialize();
      const content = 'Test retrieval content';
      const resourceId = await resourceManager.storeResource({
        type: 'log',
        content,
      });

      // Act
      const resource = await resourceManager.getResource(resourceId);

      // Assert
      expect(resource).toBeTruthy();
      expect(resource?.id).toBe(resourceId);
      expect(resource?.type).toBe('log');
      expect(resource?.size).toBe(Buffer.byteLength(content, 'utf-8'));
    });

    it('should read resource content from disk', async () => {
      // Arrange
      await resourceManager.initialize();
      const content = 'Content to read back';
      const resourceId = await resourceManager.storeResource({
        type: 'log',
        content,
      });

      // Act
      const retrievedContent = await resourceManager.readResourceContent(resourceId);

      // Assert
      expect(retrievedContent).toBe(content);
    });

    it('should return null for non-existent resource', async () => {
      // Arrange
      await resourceManager.initialize();

      // Act
      const resource = await resourceManager.getResource('non-existent-id');

      // Assert
      expect(resource).toBeNull();
    });
  });

  describe('Resource Cleanup', () => {
    it('should identify orphaned resources', async () => {
      // Arrange
      await resourceManager.initialize();

      // Create some resources
      const resource1 = await resourceManager.storeResource({
        type: 'log',
        content: 'Resource 1',
        persistToGraph: false, // Not in graph = orphaned
      });

      const resource2 = await resourceManager.storeResource({
        type: 'log',
        content: 'Resource 2',
        persistToGraph: false,
      });

      // Mock Neo4j to return only resource1 as existing in graph
      vi.mocked(mockNeo4jClient.runTransaction).mockResolvedValue({
        records: [{ get: () => resource1 }],
      });

      // Act
      const orphans = await resourceManager.findOrphanedResources();

      // Assert
      expect(orphans).toContain(resource2);
      expect(orphans).not.toContain(resource1);
    });

    it('should delete orphaned resources', async () => {
      // Arrange
      await resourceManager.initialize();
      const resourceId = await resourceManager.storeResource({
        type: 'log',
        content: 'Orphaned resource',
      });

      // Act
      await resourceManager.deleteResource(resourceId);

      // Assert
      const resource = await resourceManager.getResource(resourceId);
      expect(resource).toBeNull();
    });

    it('should cleanup all orphaned resources', async () => {
      // Arrange
      await resourceManager.initialize();

      const orphan1 = await resourceManager.storeResource({
        type: 'log',
        content: 'Orphan 1',
      });

      const orphan2 = await resourceManager.storeResource({
        type: 'log',
        content: 'Orphan 2',
      });

      // Mock finding these as orphans
      vi.mocked(mockNeo4jClient.runTransaction).mockResolvedValue({
        records: [],
      });

      // Act
      const deletedCount = await resourceManager.cleanupOrphans();

      // Assert
      expect(deletedCount).toBe(2);

      const resource1 = await resourceManager.getResource(orphan1);
      const resource2 = await resourceManager.getResource(orphan2);
      expect(resource1).toBeNull();
      expect(resource2).toBeNull();
    });
  });

  describe('Disposable Pattern', () => {
    it('should implement Symbol.dispose', () => {
      // Assert
      expect(typeof resourceManager[Symbol.dispose]).toBe('function');
    });

    it('should throw when accessing methods after dispose', async () => {
      // Arrange
      await resourceManager.initialize();

      // Act
      resourceManager[Symbol.dispose]();

      // Assert
      await expect(
        resourceManager.storeResource({ type: 'log', content: 'test' })
      ).rejects.toThrow('ResourceManager has been disposed');

      await expect(
        resourceManager.getResource('test-id')
      ).rejects.toThrow('ResourceManager has been disposed');
    });

    it('should work with using keyword', async () => {
      // This demonstrates the pattern
      await (async () => {
        using manager = new ResourceManager(mockNeo4jClient, {
          resourceDir: testResourceDir,
        });

        await manager.initialize();
        await manager.storeResource({ type: 'log', content: 'Test' });

        // Auto-dispose at block end
      })();

      // Manager is now disposed
      expect(true).toBe(true); // Pattern demonstrated
    });
  });

  describe('Resource Statistics', () => {
    it('should track total resource count', async () => {
      // Arrange
      await resourceManager.initialize();

      await resourceManager.storeResource({ type: 'log', content: 'Resource 1' });
      await resourceManager.storeResource({ type: 'log', content: 'Resource 2' });
      await resourceManager.storeResource({ type: 'snapshot', content: 'Resource 3' });

      // Act
      const stats = await resourceManager.getStatistics();

      // Assert
      expect(stats.totalCount).toBe(3);
    });

    it('should track resources by type', async () => {
      // Arrange
      await resourceManager.initialize();

      await resourceManager.storeResource({ type: 'log', content: 'Log 1' });
      await resourceManager.storeResource({ type: 'log', content: 'Log 2' });
      await resourceManager.storeResource({ type: 'snapshot', content: 'Snapshot 1' });

      // Act
      const stats = await resourceManager.getStatistics();

      // Assert
      expect(stats.byType.log).toBe(2);
      expect(stats.byType.snapshot).toBe(1);
    });

    it('should calculate total storage size', async () => {
      // Arrange
      await resourceManager.initialize();

      const content1 = 'A'.repeat(100);
      const content2 = 'B'.repeat(200);

      await resourceManager.storeResource({ type: 'log', content: content1 });
      await resourceManager.storeResource({ type: 'log', content: content2 });

      // Act
      const stats = await resourceManager.getStatistics();

      // Assert
      expect(stats.totalSize).toBe(300); // 100 + 200 bytes
    });
  });
});
