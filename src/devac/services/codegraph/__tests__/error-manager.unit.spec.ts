// src/devac/services/codegraph/__tests__/error-manager.unit.spec.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorManager } from '../error-manager.js';
import { Neo4jClient } from '../../../../database/neo4j-client.js';

describe('ErrorManager - Unit Tests', () => {
  let mockNeo4jClient: Neo4jClient;
  let errorManager: ErrorManager;

  beforeEach(() => {
    // Mock Neo4j client (no actual connection)
    mockNeo4jClient = {
      runTransaction: vi.fn(),
      initializeDriver: vi.fn(),
      closeDriver: vi.fn(),
    } as unknown as Neo4jClient;

    errorManager = new ErrorManager(mockNeo4jClient, {
      serviceId: 'test-service',
      errorThreshold: 3,
    });
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

    it('should assign unique IDs and timestamps', () => {
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

      // Assert
      const errors = errorManager.getErrors();
      expect(errors[0].id).toBeTruthy();
      expect(errors[1].id).toBeTruthy();
      expect(errors[0].id).not.toBe(errors[1].id);
      expect(errors[0].timestamp).toBeGreaterThan(0);
      expect(errors[1].timestamp).toBeGreaterThan(0);
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
      const customErrorManager = new ErrorManager(mockNeo4jClient, {
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
      const customErrorManager = new ErrorManager(mockNeo4jClient, {
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

  describe('Neo4j Persistence (Mocked)', () => {
    it('should call Neo4j client to persist errors', async () => {
      // Arrange
      errorManager.recordError({
        type: 'PARSING_TIMEOUT',
        message: 'Parser timeout for file X',
        severity: 'error',
        filePath: '/path/to/file.ts',
      });

      // Act
      await errorManager.persistErrors();

      // Assert
      expect(mockNeo4jClient.runTransaction).toHaveBeenCalledTimes(1);
      expect(mockNeo4jClient.runTransaction).toHaveBeenCalledWith(
        expect.stringContaining('CREATE (e:ServiceError'),
        expect.objectContaining({
          errors: expect.arrayContaining([
            expect.objectContaining({
              errorType: 'PARSING_TIMEOUT',
              message: 'Parser timeout for file X',
            }),
          ]),
        }),
        'WRITE',
        'ErrorManager'
      );
    });

    it('should batch persist multiple errors', async () => {
      // Arrange - Add 5 errors
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
      expect(mockNeo4jClient.runTransaction).toHaveBeenCalled();
      const callArgs = (mockNeo4jClient.runTransaction as any).mock.calls[0];
      expect(callArgs[1].errors).toHaveLength(5);
    });

    it('should link errors to collections when collectionId provided', async () => {
      // Arrange
      errorManager.recordError({
        type: 'PARSING_ERROR',
        message: 'Error in collection',
        severity: 'error',
        collectionId: 'coll-123',
      });

      // Act
      await errorManager.persistErrors();

      // Assert - Should call runTransaction twice (once for errors, once for relationships)
      expect(mockNeo4jClient.runTransaction).toHaveBeenCalledTimes(2);
    });
  });
});
