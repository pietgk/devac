// src/devac/services/codegraph/__tests__/error-manager.spec.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ErrorManager, ServiceErrorType, ServiceErrorSeverity } from '../error-manager.js';
import { Neo4jClient } from '../../../../database/neo4j-client.js';
import { Neo4jContainer, StartedNeo4jContainer } from '@testcontainers/neo4j';

describe('ErrorManager', () => {
  let neo4jContainer: StartedNeo4jContainer;
  let neo4jClient: Neo4jClient;
  let errorManager: ErrorManager;

  beforeEach(async () => {
    // Start Neo4j testcontainer
    neo4jContainer = await new Neo4jContainer('neo4j:5-community')
      .withReuse()
      .start();

    const uri = neo4jContainer.getBoltUrl();
    neo4jClient = new Neo4jClient({
      uri,
      username: 'neo4j',
      password: 'password',
      database: 'neo4j',
    });

    await neo4jClient.initializeDriver('ErrorManagerTest');

    errorManager = new ErrorManager(neo4jClient, {
      serviceId: 'test-service',
      errorThreshold: 3,
    });
  });

  afterEach(async () => {
    await neo4jClient.closeDriver('ErrorManagerTest');
    await neo4jContainer.stop();
  });

  describe('Error Tracking', () => {
    it('should track error count', () => {
      // Arrange & Act
      errorManager.recordError({
        type: 'PARSING_TIMEOUT',
        message: 'Parser timeout',
        severity: 'error',
      });

      errorManager.recordError({
        type: 'FILE_SYSTEM_ERROR',
        message: 'File not found',
        severity: 'warning',
      });

      // Assert
      expect(errorManager.getErrorCount()).toBe(2);
    });

    it('should categorize errors by type', () => {
      // Arrange & Act
      errorManager.recordError({
        type: 'PARSING_TIMEOUT',
        message: 'Timeout 1',
        severity: 'error',
      });

      errorManager.recordError({
        type: 'PARSING_TIMEOUT',
        message: 'Timeout 2',
        severity: 'error',
      });

      errorManager.recordError({
        type: 'NEO4J_ERROR',
        message: 'Connection failed',
        severity: 'critical',
      });

      // Assert
      const errorsByType = errorManager.getErrorsByType();
      expect(errorsByType.PARSING_TIMEOUT).toHaveLength(2);
      expect(errorsByType.NEO4J_ERROR).toHaveLength(1);
    });

    it('should include file context when available', () => {
      // Arrange & Act
      errorManager.recordError({
        type: 'PARSING_ERROR',
        message: 'Syntax error',
        severity: 'error',
        filePath: '/path/to/file.ts',
        line: 42,
        column: 10,
      });

      // Assert
      const errors = errorManager.getErrors();
      expect(errors[0]).toMatchObject({
        type: 'PARSING_ERROR',
        filePath: '/path/to/file.ts',
        line: 42,
        column: 10,
      });
    });
  });

  describe('Error Threshold', () => {
    it('should not throw when below threshold', () => {
      // Arrange & Act
      errorManager.recordError({
        type: 'PARSING_ERROR',
        message: 'Error 1',
        severity: 'error',
      });

      errorManager.recordError({
        type: 'PARSING_ERROR',
        message: 'Error 2',
        severity: 'error',
      });

      // Assert - Should not throw
      expect(() => errorManager.checkThreshold()).not.toThrow();
      expect(errorManager.isThresholdExceeded()).toBe(false);
    });

    it('should throw when threshold exceeded', () => {
      // Arrange
      errorManager.recordError({
        type: 'PARSING_ERROR',
        message: 'Error 1',
        severity: 'error',
      });

      errorManager.recordError({
        type: 'PARSING_ERROR',
        message: 'Error 2',
        severity: 'error',
      });

      errorManager.recordError({
        type: 'PARSING_ERROR',
        message: 'Error 3',
        severity: 'error',
      });

      // Act & Assert
      expect(() => errorManager.checkThreshold()).toThrow(
        'Error threshold exceeded: 3 errors'
      );
      expect(errorManager.isThresholdExceeded()).toBe(true);
    });

    it('should allow configuring threshold', () => {
      // Arrange
      const customErrorManager = new ErrorManager(neo4jClient, {
        serviceId: 'test-service',
        errorThreshold: 5,
      });

      // Act - Add 4 errors
      for (let i = 0; i < 4; i++) {
        customErrorManager.recordError({
          type: 'PARSING_ERROR',
          message: `Error ${i}`,
          severity: 'error',
        });
      }

      // Assert - Should not throw
      expect(() => customErrorManager.checkThreshold()).not.toThrow();
      expect(customErrorManager.isThresholdExceeded()).toBe(false);
    });
  });

  describe('Neo4j Integration', () => {
    it('should store errors in Neo4j', async () => {
      // Arrange
      errorManager.recordError({
        type: 'PARSING_TIMEOUT',
        message: 'Parser timeout for file X',
        severity: 'error',
        filePath: '/path/to/file.ts',
        stack: 'Error stack trace...',
      });

      // Act
      await errorManager.persistErrors();

      // Assert - Query Neo4j to verify
      const result = await neo4jClient.runTransaction<any>(
        `
        MATCH (e:ServiceError {serviceId: $serviceId})
        RETURN e.errorType AS errorType,
               e.message AS message,
               e.filePath AS filePath
        ORDER BY e.timestamp DESC
        `,
        { serviceId: 'test-service' },
        'READ',
        'ErrorManagerTest'
      );

      expect(result.records).toHaveLength(1);
      expect(result.records[0].get('errorType')).toBe('PARSING_TIMEOUT');
      expect(result.records[0].get('message')).toBe('Parser timeout for file X');
      expect(result.records[0].get('filePath')).toBe('/path/to/file.ts');
    });

    it('should link errors to collection when provided', async () => {
      // Arrange
      const collectionId = 'coll-123';

      errorManager.recordError({
        type: 'PARSING_ERROR',
        message: 'Syntax error',
        severity: 'error',
        collectionId,
      });

      // Act
      await errorManager.persistErrors();

      // Assert - Check relationship exists
      const result = await neo4jClient.runTransaction<any>(
        `
        MATCH (e:ServiceError {serviceId: $serviceId})-[:ERROR_IN]->(c:Collection {id: $collectionId})
        RETURN count(e) AS errorCount
        `,
        { serviceId: 'test-service', collectionId },
        'READ',
        'ErrorManagerTest'
      );

      expect(result.records[0].get('errorCount').toInt()).toBe(1);
    });

    it('should handle batch error persistence', async () => {
      // Arrange - Add multiple errors
      for (let i = 0; i < 5; i++) {
        errorManager.recordError({
          type: 'PARSING_ERROR',
          message: `Error ${i}`,
          severity: 'error',
        });
      }

      // Act
      await errorManager.persistErrors();

      // Assert
      const result = await neo4jClient.runTransaction<any>(
        `
        MATCH (e:ServiceError {serviceId: $serviceId})
        RETURN count(e) AS errorCount
        `,
        { serviceId: 'test-service' },
        'READ',
        'ErrorManagerTest'
      );

      expect(result.records[0].get('errorCount').toInt()).toBe(5);
    });
  });

  describe('Error Severity', () => {
    it('should differentiate between warning, error, and critical', () => {
      // Arrange & Act
      errorManager.recordError({
        type: 'FILE_SYSTEM_ERROR',
        message: 'File not found',
        severity: 'warning',
      });

      errorManager.recordError({
        type: 'PARSING_ERROR',
        message: 'Syntax error',
        severity: 'error',
      });

      errorManager.recordError({
        type: 'NEO4J_ERROR',
        message: 'Database connection lost',
        severity: 'critical',
      });

      // Assert
      const errors = errorManager.getErrors();
      expect(errors.filter((e) => e.severity === 'warning')).toHaveLength(1);
      expect(errors.filter((e) => e.severity === 'error')).toHaveLength(1);
      expect(errors.filter((e) => e.severity === 'critical')).toHaveLength(1);
    });

    it('should only count errors and critical toward threshold', () => {
      // Arrange
      const customErrorManager = new ErrorManager(neo4jClient, {
        serviceId: 'test-service',
        errorThreshold: 2,
        countWarningsInThreshold: false,
      });

      // Act - Add warnings (should not count)
      customErrorManager.recordError({
        type: 'FILE_SYSTEM_ERROR',
        message: 'Warning 1',
        severity: 'warning',
      });

      customErrorManager.recordError({
        type: 'FILE_SYSTEM_ERROR',
        message: 'Warning 2',
        severity: 'warning',
      });

      // Add one error (should count)
      customErrorManager.recordError({
        type: 'PARSING_ERROR',
        message: 'Error 1',
        severity: 'error',
      });

      // Assert - Should not exceed threshold
      expect(() => customErrorManager.checkThreshold()).not.toThrow();
      expect(customErrorManager.getErrorCount()).toBe(1); // Only errors counted
    });
  });

  describe('Error Reset', () => {
    it('should clear errors on reset', () => {
      // Arrange
      errorManager.recordError({
        type: 'PARSING_ERROR',
        message: 'Error 1',
        severity: 'error',
      });

      // Act
      errorManager.reset();

      // Assert
      expect(errorManager.getErrorCount()).toBe(0);
      expect(errorManager.getErrors()).toHaveLength(0);
    });
  });
});
