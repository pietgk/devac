// src/devac/services/codegraph/error-manager.ts

import { Neo4jClient } from '../../../database/neo4j-client.js';
import { createContextLogger } from '../../../utils/logger.js';
import { randomUUID } from 'crypto';

const logger = createContextLogger('ErrorManager');

/**
 * Types of service errors
 */
export type ServiceErrorType =
  | 'PARSING_TIMEOUT'
  | 'PARSING_ERROR'
  | 'NEO4J_ERROR'
  | 'FILE_SYSTEM_ERROR'
  | 'WATCHER_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * Error severity levels
 */
export type ServiceErrorSeverity = 'warning' | 'error' | 'critical';

/**
 * Service error record
 */
export interface ServiceError {
  id: string;
  timestamp: number;
  type: ServiceErrorType;
  message: string;
  severity: ServiceErrorSeverity;
  filePath?: string;
  line?: number;
  column?: number;
  stack?: string;
  collectionId?: string;
}

/**
 * Error manager configuration
 */
export interface ErrorManagerConfig {
  serviceId: string;
  errorThreshold: number;
  countWarningsInThreshold?: boolean;
}

/**
 * Manages errors for a service, including tracking, persistence, and threshold checking.
 */
export class ErrorManager {
  private neo4jClient: Neo4jClient;
  private config: ErrorManagerConfig;
  private errors: ServiceError[] = [];
  private errorCountByType: Map<ServiceErrorType, number> = new Map();

  constructor(neo4jClient: Neo4jClient, config: ErrorManagerConfig) {
    this.neo4jClient = neo4jClient;
    this.config = {
      countWarningsInThreshold: true,
      ...config,
    };

    logger.debug(`ErrorManager initialized for service: ${config.serviceId}`, {
      errorThreshold: config.errorThreshold,
    });
  }

  /**
   * Records an error
   */
  recordError(error: Omit<ServiceError, 'id' | 'timestamp'>): void {
    const fullError: ServiceError = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...error,
    };

    this.errors.push(fullError);

    // Update type count
    const currentCount = this.errorCountByType.get(error.type) || 0;
    this.errorCountByType.set(error.type, currentCount + 1);

    logger.warn(`Error recorded: ${error.type} - ${error.message}`, {
      errorId: fullError.id,
      severity: error.severity,
      filePath: error.filePath,
    });
  }

  /**
   * Gets the total error count (excluding warnings if configured)
   */
  getErrorCount(): number {
    if (this.config.countWarningsInThreshold) {
      return this.errors.length;
    }

    // Only count errors and critical
    return this.errors.filter(
      (e) => e.severity === 'error' || e.severity === 'critical'
    ).length;
  }

  /**
   * Gets all errors
   */
  getErrors(): ServiceError[] {
    return [...this.errors];
  }

  /**
   * Gets errors grouped by type
   */
  getErrorsByType(): Record<ServiceErrorType, ServiceError[]> {
    const grouped: Partial<Record<ServiceErrorType, ServiceError[]>> = {};

    for (const error of this.errors) {
      if (!grouped[error.type]) {
        grouped[error.type] = [];
      }
      grouped[error.type]!.push(error);
    }

    return grouped as Record<ServiceErrorType, ServiceError[]>;
  }

  /**
   * Checks if error threshold is exceeded
   */
  isThresholdExceeded(): boolean {
    return this.getErrorCount() >= this.config.errorThreshold;
  }

  /**
   * Checks threshold and throws if exceeded
   * @throws {Error} If threshold is exceeded
   */
  checkThreshold(): void {
    if (this.isThresholdExceeded()) {
      const errorCount = this.getErrorCount();
      const message = `Error threshold exceeded: ${errorCount} errors`;
      logger.error(message, {
        serviceId: this.config.serviceId,
        threshold: this.config.errorThreshold,
      });
      throw new Error(message);
    }
  }

  /**
   * Persists all errors to Neo4j
   */
  async persistErrors(): Promise<void> {
    if (this.errors.length === 0) {
      logger.debug('No errors to persist');
      return;
    }

    logger.info(`Persisting ${this.errors.length} errors to Neo4j...`);

    try {
      // Prepare errors for Neo4j
      const errorNodes = this.errors.map((error) => ({
        id: error.id,
        serviceId: this.config.serviceId,
        timestamp: new Date(error.timestamp).toISOString(),
        errorType: error.type,
        message: error.message,
        severity: error.severity,
        filePath: error.filePath || null,
        line: error.line || null,
        column: error.column || null,
        stack: error.stack || null,
        collectionId: error.collectionId || null,
      }));

      // Create error nodes
      await this.neo4jClient.runTransaction(
        `
        UNWIND $errors AS error
        CREATE (e:ServiceError {
          id: error.id,
          serviceId: error.serviceId,
          timestamp: error.timestamp,
          errorType: error.errorType,
          message: error.message,
          severity: error.severity,
          filePath: error.filePath,
          line: error.line,
          column: error.column,
          stack: error.stack
        })
        `,
        { errors: errorNodes },
        'WRITE',
        'ErrorManager'
      );

      // Create relationships to collections
      const errorsWithCollections = errorNodes.filter((e) => e.collectionId);
      if (errorsWithCollections.length > 0) {
        await this.neo4jClient.runTransaction(
          `
          UNWIND $errors AS error
          MATCH (e:ServiceError {id: error.id})
          MATCH (c:Collection {id: error.collectionId})
          MERGE (e)-[:ERROR_IN]->(c)
          `,
          { errors: errorsWithCollections },
          'WRITE',
          'ErrorManager'
        );
      }

      logger.info(`Successfully persisted ${this.errors.length} errors to Neo4j`);
    } catch (error: any) {
      logger.error(`Failed to persist errors to Neo4j: ${error.message}`, {
        errorCount: this.errors.length,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Resets error tracking
   */
  reset(): void {
    logger.debug('Resetting error manager');
    this.errors = [];
    this.errorCountByType.clear();
  }
}
