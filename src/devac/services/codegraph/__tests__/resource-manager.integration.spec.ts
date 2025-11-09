// src/devac/services/codegraph/__tests__/resource-manager.integration.spec.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ResourceManager } from '../resource-manager.js';
import { Neo4jClient } from '../../../../database/neo4j-client.js';
import {
  createTestNeo4jClient,
  cleanTestDatabase,
  createTestCollection,
  countNodesByLabel,
  countRelationshipsByType,
} from '../../../../../test-setup/neo4j-test-utils.js';
import fs from 'fs/promises';

describe('ResourceManager - Integration Tests', () => {
  const testResourceDir = '.devac-test/resources-integration';
  let neo4jClient: Neo4jClient;
  let resourceManager: ResourceManager;

  beforeEach(async () => {
    // Clean up test directory
    await fs.rm('.devac-test', { recursive: true, force: true });

    // Connect to local test database
    neo4jClient = await createTestNeo4jClient();
    await neo4jClient.initializeDriver('ResourceManagerIntegration');

    // Clean database before each test for isolation
    await cleanTestDatabase(neo4jClient, 'ResourceManagerIntegration');

    resourceManager = new ResourceManager(neo4jClient, {
      resourceDir: testResourceDir,
    });

    await resourceManager.initialize();
  });

  afterEach(async () => {
    // Cleanup resource manager
    if (resourceManager) {
      resourceManager[Symbol.dispose]();
    }

    // Cleanup test directory
    await fs.rm('.devac-test', { recursive: true, force: true });

    // Close Neo4j connection
    await neo4jClient.closeDriver('ResourceManagerIntegration');
  });

  describe('Neo4j Resource Node Creation', () => {
    it('should create Resource node in Neo4j when persistToGraph is true', async () => {
      // Arrange
      const content = 'Test resource content for Neo4j';

      // Act
      const resourceId = await resourceManager.storeResource({
        type: 'log',
        content,
        persistToGraph: true,
      });

      // Assert - Verify node exists in Neo4j
      const result = await neo4jClient.runTransaction<any>(
        `
        MATCH (r:Resource {id: $id})
        RETURN r.id AS id,
               r.type AS type,
               r.size AS size,
               r.hash AS hash,
               r.path AS path
        `,
        { id: resourceId },
        'READ',
        'ResourceManagerIntegration'
      );

      expect(result.records).toHaveLength(1);
      const record = result.records[0];
      expect(record.get('id')).toBe(resourceId);
      expect(record.get('type')).toBe('log');
      expect(record.get('size')).toBe(content.length);
      expect(record.get('hash')).toBeTruthy(); // SHA-256 hash
      expect(record.get('path')).toContain(resourceId);
    });

    it('should not create Resource node when persistToGraph is false', async () => {
      // Arrange & Act
      await resourceManager.storeResource({
        type: 'log',
        content: 'Not persisted to graph',
        persistToGraph: false,
      });

      // Assert - No Resource nodes should exist
      const nodeCount = await countNodesByLabel(neo4jClient, 'Resource');
      expect(nodeCount).toBe(0);
    });

    it('should create multiple Resource nodes', async () => {
      // Arrange & Act
      await resourceManager.storeResource({
        type: 'log',
        content: 'Resource 1',
        persistToGraph: true,
      });

      await resourceManager.storeResource({
        type: 'snapshot',
        content: 'Resource 2',
        persistToGraph: true,
      });

      await resourceManager.storeResource({
        type: 'error-log',
        content: 'Resource 3',
        persistToGraph: true,
      });

      // Assert
      const nodeCount = await countNodesByLabel(neo4jClient, 'Resource');
      expect(nodeCount).toBe(3);
    });
  });

  describe('STORED_IN Relationships', () => {
    it('should create STORED_IN relationship to Collection', async () => {
      // Arrange - Create collection first
      const collectionId = 'test-collection-123';
      await createTestCollection(neo4jClient, collectionId);

      // Act - Store resource with collection
      const resourceId = await resourceManager.storeResource({
        type: 'log',
        content: 'Resource in collection',
        collectionId,
        persistToGraph: true,
      });

      // Assert - Verify relationship exists
      const result = await neo4jClient.runTransaction<any>(
        `
        MATCH (r:Resource {id: $resourceId})-[:STORED_IN]->(c:Collection {id: $collectionId})
        RETURN r.id AS resourceId, c.id AS collectionId
        `,
        { resourceId, collectionId },
        'READ',
        'ResourceManagerIntegration'
      );

      expect(result.records).toHaveLength(1);
      expect(result.records[0].get('resourceId')).toBe(resourceId);
      expect(result.records[0].get('collectionId')).toBe(collectionId);
    });

    it('should create multiple STORED_IN relationships', async () => {
      // Arrange
      const collectionId = 'test-collection-456';
      await createTestCollection(neo4jClient, collectionId);

      // Act - Store 3 resources in same collection
      await resourceManager.storeResource({
        type: 'log',
        content: 'Resource 1',
        collectionId,
        persistToGraph: true,
      });

      await resourceManager.storeResource({
        type: 'log',
        content: 'Resource 2',
        collectionId,
        persistToGraph: true,
      });

      await resourceManager.storeResource({
        type: 'snapshot',
        content: 'Resource 3',
        collectionId,
        persistToGraph: true,
      });

      // Assert - Count relationships
      const relCount = await countRelationshipsByType(neo4jClient, 'STORED_IN');
      expect(relCount).toBe(3);
    });

    it('should handle resources without collections', async () => {
      // Arrange & Act
      await resourceManager.storeResource({
        type: 'log',
        content: 'Resource without collection',
        persistToGraph: true,
      });

      // Assert - Resource exists but no STORED_IN relationships
      const nodeCount = await countNodesByLabel(neo4jClient, 'Resource');
      expect(nodeCount).toBe(1);

      const relCount = await countRelationshipsByType(neo4jClient, 'STORED_IN');
      expect(relCount).toBe(0);
    });
  });

  describe('ATTACHED_TO Relationships', () => {
    it('should create ATTACHED_TO relationship to ServiceError', async () => {
      // Arrange - Create a ServiceError node first
      const errorId = 'error-123';
      await neo4jClient.runTransaction(
        `
        CREATE (e:ServiceError {
          id: $id,
          serviceId: 'test-service',
          errorType: 'PARSING_ERROR',
          message: 'Test error',
          timestamp: timestamp()
        })
        `,
        { id: errorId },
        'WRITE',
        'ResourceManagerIntegration'
      );

      // Act - Store resource attached to error
      const resourceId = await resourceManager.storeResource({
        type: 'error-log',
        content: 'Error log content',
        errorId,
        persistToGraph: true,
      });

      // Assert - Verify relationship exists
      const result = await neo4jClient.runTransaction<any>(
        `
        MATCH (r:Resource {id: $resourceId})-[:ATTACHED_TO]->(e:ServiceError {id: $errorId})
        RETURN r.id AS resourceId, e.id AS errorId
        `,
        { resourceId, errorId },
        'READ',
        'ResourceManagerIntegration'
      );

      expect(result.records).toHaveLength(1);
      expect(result.records[0].get('resourceId')).toBe(resourceId);
      expect(result.records[0].get('errorId')).toBe(errorId);
    });

    it('should support both STORED_IN and ATTACHED_TO relationships', async () => {
      // Arrange - Create both collection and error
      const collectionId = 'test-collection-789';
      const errorId = 'error-456';

      await createTestCollection(neo4jClient, collectionId);
      await neo4jClient.runTransaction(
        `
        CREATE (e:ServiceError {
          id: $id,
          serviceId: 'test-service',
          errorType: 'NEO4J_ERROR',
          message: 'Database error',
          timestamp: timestamp()
        })
        `,
        { id: errorId },
        'WRITE',
        'ResourceManagerIntegration'
      );

      // Act - Store resource with both relationships
      const resourceId = await resourceManager.storeResource({
        type: 'error-log',
        content: 'Error in collection',
        collectionId,
        errorId,
        persistToGraph: true,
      });

      // Assert - Verify both relationships exist
      const result = await neo4jClient.runTransaction<any>(
        `
        MATCH (r:Resource {id: $resourceId})
        OPTIONAL MATCH (r)-[:STORED_IN]->(c:Collection)
        OPTIONAL MATCH (r)-[:ATTACHED_TO]->(e:ServiceError)
        RETURN r.id AS resourceId,
               c.id AS collectionId,
               e.id AS errorId
        `,
        { resourceId },
        'READ',
        'ResourceManagerIntegration'
      );

      expect(result.records).toHaveLength(1);
      expect(result.records[0].get('resourceId')).toBe(resourceId);
      expect(result.records[0].get('collectionId')).toBe(collectionId);
      expect(result.records[0].get('errorId')).toBe(errorId);
    });
  });

  describe('Orphaned Resource Detection', () => {
    it('should detect resources not in graph as orphaned', async () => {
      // Arrange - Create resources (some in graph, some not)
      const persistedId = await resourceManager.storeResource({
        type: 'log',
        content: 'Persisted resource',
        persistToGraph: true,
      });

      const orphanId = await resourceManager.storeResource({
        type: 'log',
        content: 'Orphaned resource',
        persistToGraph: false, // Not in graph
      });

      // Act - Find orphaned resources
      const orphans = await resourceManager.findOrphanedResources();

      // Assert
      expect(orphans).toContain(orphanId);
      expect(orphans).not.toContain(persistedId);
    });

    it('should cleanup orphaned resources', async () => {
      // Arrange - Create orphaned resources
      const orphan1 = await resourceManager.storeResource({
        type: 'log',
        content: 'Orphan 1',
        persistToGraph: false,
      });

      const orphan2 = await resourceManager.storeResource({
        type: 'snapshot',
        content: 'Orphan 2',
        persistToGraph: false,
      });

      // Act - Cleanup orphans
      const deletedCount = await resourceManager.cleanupOrphans();

      // Assert
      expect(deletedCount).toBe(2);

      const resource1 = await resourceManager.getResource(orphan1);
      const resource2 = await resourceManager.getResource(orphan2);
      expect(resource1).toBeNull();
      expect(resource2).toBeNull();
    });

    it('should not cleanup resources that are in graph', async () => {
      // Arrange - Create resources in graph
      await resourceManager.storeResource({
        type: 'log',
        content: 'In graph 1',
        persistToGraph: true,
      });

      await resourceManager.storeResource({
        type: 'log',
        content: 'In graph 2',
        persistToGraph: true,
      });

      // Act - Try to cleanup (should find none)
      const deletedCount = await resourceManager.cleanupOrphans();

      // Assert
      expect(deletedCount).toBe(0);

      const nodeCount = await countNodesByLabel(neo4jClient, 'Resource');
      expect(nodeCount).toBe(2); // Still in graph
    });
  });

  describe('Resource Metadata Persistence', () => {
    it('should persist SHA-256 hash to Neo4j', async () => {
      // Arrange
      const content = 'Content for hashing';

      // Act
      const resourceId = await resourceManager.storeResource({
        type: 'log',
        content,
        persistToGraph: true,
      });

      // Assert - Verify hash in Neo4j
      const result = await neo4jClient.runTransaction<any>(
        `
        MATCH (r:Resource {id: $id})
        RETURN r.hash AS hash
        `,
        { id: resourceId },
        'READ',
        'ResourceManagerIntegration'
      );

      const hash = result.records[0].get('hash');
      expect(hash).toBeTruthy();
      expect(hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hash format
    });

    it('should persist file size to Neo4j', async () => {
      // Arrange
      const content = 'X'.repeat(1000); // 1000 bytes

      // Act
      const resourceId = await resourceManager.storeResource({
        type: 'snapshot',
        content,
        persistToGraph: true,
      });

      // Assert - Verify size in Neo4j
      const result = await neo4jClient.runTransaction<any>(
        `
        MATCH (r:Resource {id: $id})
        RETURN r.size AS size
        `,
        { id: resourceId },
        'READ',
        'ResourceManagerIntegration'
      );

      const size = result.records[0].get('size');
      expect(size).toBe(1000);
    });

    it('should persist resource type to Neo4j', async () => {
      // Arrange & Act
      const logId = await resourceManager.storeResource({
        type: 'log',
        content: 'Log content',
        persistToGraph: true,
      });

      const snapshotId = await resourceManager.storeResource({
        type: 'snapshot',
        content: 'Snapshot content',
        persistToGraph: true,
      });

      // Assert - Query by type
      const logResult = await neo4jClient.runTransaction<any>(
        `MATCH (r:Resource {id: $id}) RETURN r.type AS type`,
        { id: logId },
        'READ',
        'ResourceManagerIntegration'
      );

      const snapshotResult = await neo4jClient.runTransaction<any>(
        `MATCH (r:Resource {id: $id}) RETURN r.type AS type`,
        { id: snapshotId },
        'READ',
        'ResourceManagerIntegration'
      );

      expect(logResult.records[0].get('type')).toBe('log');
      expect(snapshotResult.records[0].get('type')).toBe('snapshot');
    });
  });

  describe('Complex Graph Queries', () => {
    it('should query resources by collection', async () => {
      // Arrange - Create collection with resources
      const collectionId = 'analytics-collection';
      await createTestCollection(neo4jClient, collectionId);

      await resourceManager.storeResource({
        type: 'log',
        content: 'Log 1',
        collectionId,
        persistToGraph: true,
      });

      await resourceManager.storeResource({
        type: 'log',
        content: 'Log 2',
        collectionId,
        persistToGraph: true,
      });

      await resourceManager.storeResource({
        type: 'snapshot',
        content: 'Snapshot 1',
        collectionId,
        persistToGraph: true,
      });

      // Act - Query resources in collection
      const result = await neo4jClient.runTransaction<any>(
        `
        MATCH (r:Resource)-[:STORED_IN]->(c:Collection {id: $collectionId})
        RETURN r.id AS id, r.type AS type
        ORDER BY r.type
        `,
        { collectionId },
        'READ',
        'ResourceManagerIntegration'
      );

      // Assert
      expect(result.records).toHaveLength(3);
      expect(result.records[0].get('type')).toBe('log');
      expect(result.records[1].get('type')).toBe('log');
      expect(result.records[2].get('type')).toBe('snapshot');
    });

    it('should query resources by error severity', async () => {
      // Arrange - Create errors with different severities
      const criticalErrorId = 'critical-error-1';
      const warningErrorId = 'warning-error-1';

      await neo4jClient.runTransaction(
        `
        CREATE (e1:ServiceError {
          id: $criticalId,
          serviceId: 'test-service',
          errorType: 'NEO4J_ERROR',
          severity: 'critical',
          message: 'Critical error',
          timestamp: timestamp()
        }),
        (e2:ServiceError {
          id: $warningId,
          serviceId: 'test-service',
          errorType: 'FILE_SYSTEM_ERROR',
          severity: 'warning',
          message: 'Warning error',
          timestamp: timestamp()
        })
        `,
        { criticalId: criticalErrorId, warningId: warningErrorId },
        'WRITE',
        'ResourceManagerIntegration'
      );

      // Store resources attached to errors
      await resourceManager.storeResource({
        type: 'error-log',
        content: 'Critical error log',
        errorId: criticalErrorId,
        persistToGraph: true,
      });

      await resourceManager.storeResource({
        type: 'error-log',
        content: 'Warning error log',
        errorId: warningErrorId,
        persistToGraph: true,
      });

      // Act - Query resources for critical errors only
      const result = await neo4jClient.runTransaction<any>(
        `
        MATCH (r:Resource)-[:ATTACHED_TO]->(e:ServiceError)
        WHERE e.severity = 'critical'
        RETURN r.id AS resourceId, e.severity AS severity
        `,
        {},
        'READ',
        'ResourceManagerIntegration'
      );

      // Assert
      expect(result.records).toHaveLength(1);
      expect(result.records[0].get('severity')).toBe('critical');
    });
  });
});
