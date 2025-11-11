// src/devac/services/codegraph/codegraph-service.ts

import path from 'path';
import { randomUUID } from 'crypto';
import { BaseService, type BaseServiceEvent } from '../base-service.js';
import type { ServiceConfig, ServiceOutput, CollectionStats } from '../../types/index.js';
import { AnalyzerService } from '../../../analyzer/analyzer-service.js';
import { FileScanner } from '../../../scanner/file-scanner.js';
import { RoundRobinLogger } from './round-robin-logger.js';
import { ResourceManager } from './resource-manager.js';
import { FileWatcher } from './file-watcher.js';
import { ErrorManager } from './error-manager.js';
import { Neo4jClient } from '../../../database/neo4j-client.js';

/**
 * CodeGraph service-specific configuration
 */
export interface CodeGraphServiceConfig {
  /** Directories to analyze */
  directories: string[];
  /** File extensions to process */
  extensions: string[];
  /** Ignore patterns (glob) */
  ignore: string[];
  /** Enable file watching */
  watch: boolean;
  /** Log directory path */
  logDir: string;
  /** Resource directory path */
  resourceDir: string;
  /** Max log file size in bytes */
  maxLogFileSize: number;
  /** Max number of log files */
  maxLogFiles: number;
  /** Neo4j connection config */
  neo4j?: {
    uri?: string;
    username?: string;
    password?: string;
    database?: string;
  };
}

/**
 * CodeGraphService - Integrates the CodeGraph analyzer with DevAC orchestrator.
 *
 * This service wraps the existing AnalyzerService and provides:
 * - Real-time file watching for incremental updates
 * - Collection tracking in Neo4j
 * - Round-robin logging with line range references
 * - Resource management for large data
 * - Error tracking and graceful degradation
 *
 * State Flow:
 * idle → initializing → scanning → watching → processing → watching
 *                                      ↓            ↓
 *                                  degraded ← ── ──┘
 */
export class CodeGraphService extends BaseService {
  // Core analyzer
  private analyzerService!: AnalyzerService;

  // DevAC utility components
  private roundRobinLogger!: RoundRobinLogger;
  private resourceManager!: ResourceManager;
  private fileWatcher: FileWatcher | null = null;
  private errorManager!: ErrorManager;

  // Neo4j client
  private neo4jClient!: Neo4jClient;

  // State tracking
  private currentCollectionId?: string;
  private scannedFilesCount: number = 0;

  constructor(config: ServiceConfig) {
    super(config);
    this.logger.info('CodeGraphService constructor called', {
      id: config.id,
      name: config.name,
    });
  }

  /**
   * Initialize the service - called once on start.
   * Sets up Neo4j, logger, resource manager, error manager, and analyzer.
   */
  protected async initialize(): Promise<void> {
    const serviceConfig = this.config.config as CodeGraphServiceConfig;

    // Validate configuration
    if (!serviceConfig.directories || serviceConfig.directories.length === 0) {
      throw new Error('CodeGraphService requires at least one directory to analyze');
    }

    this.logger.info('Initializing CodeGraphService...', {
      directories: serviceConfig.directories,
      extensions: serviceConfig.extensions,
    });

    try {
      // 1. Initialize Neo4j client
      this.neo4jClient = new Neo4jClient({
        uri: serviceConfig.neo4j?.uri,
        username: serviceConfig.neo4j?.username,
        password: serviceConfig.neo4j?.password,
        database: serviceConfig.neo4j?.database,
      });

      await this.neo4jClient.initializeDriver('CodeGraphService');
      this.logger.info('Neo4j client initialized');

      // 2. Initialize round-robin logger
      this.roundRobinLogger = new RoundRobinLogger({
        logDir: serviceConfig.logDir,
        maxFileSize: serviceConfig.maxLogFileSize,
        maxFiles: serviceConfig.maxLogFiles,
      });
      await this.roundRobinLogger.initialize();
      this.logger.info('Round-robin logger initialized', {
        logDir: serviceConfig.logDir,
      });

      // 3. Initialize resource manager
      this.resourceManager = new ResourceManager(this.neo4jClient, {
        resourceDir: serviceConfig.resourceDir,
      });
      await this.resourceManager.initialize();
      this.logger.info('Resource manager initialized', {
        resourceDir: serviceConfig.resourceDir,
      });

      // 4. Initialize error manager
      this.errorManager = new ErrorManager(this.neo4jClient, {
        serviceId: this.config.id,
        errorThreshold: 50,
        countWarningsInThreshold: true,
      });
      this.logger.info('Error manager initialized');

      // 5. Initialize analyzer service
      const primaryDirectory = this.getPrimaryDirectory();
      this.analyzerService = new AnalyzerService(
        {
          uri: serviceConfig.neo4j?.uri,
          username: serviceConfig.neo4j?.username,
          password: serviceConfig.neo4j?.password,
          database: serviceConfig.neo4j?.database,
        },
        primaryDirectory, // workspace root
        {
          repository: this.config.name,
          repositoryPath: primaryDirectory,
          syncedAt: new Date().toISOString(),
        }
      );
      this.logger.info('Analyzer service initialized');

      // 6. Create service node in Neo4j
      await this.createServiceNode();
      this.logger.info('Service node created in Neo4j');

      this.logger.info('CodeGraphService initialization complete');
    } catch (error: any) {
      this.logger.error('Failed to initialize CodeGraphService', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Scan for initial items - runs full analysis on all directories.
   */
  protected async scan(): Promise<{ itemsFound: number }> {
    const serviceConfig = this.config.config as CodeGraphServiceConfig;
    const collectionId = randomUUID();
    this.currentCollectionId = collectionId;

    const startTime = Date.now();

    this.logger.info('Starting initial code scan', {
      collectionId,
      directories: serviceConfig.directories,
    });

    // Log scan start
    await this.roundRobinLogger.write({
      level: 'info',
      message: 'Starting initial code scan',
      serviceId: this.config.id,
      metadata: {
        collectionId,
        directories: serviceConfig.directories,
        extensions: serviceConfig.extensions,
      },
    });

    try {
      // First, scan to count files (AnalyzerService doesn't return stats)
      const primaryDirectory = this.getPrimaryDirectory();
      const absoluteDirectory = path.resolve(primaryDirectory);
      const scanner = new FileScanner(
        absoluteDirectory,
        serviceConfig.extensions,
        serviceConfig.ignore
      );
      const files = await scanner.scan();
      this.scannedFilesCount = files.length;

      this.logger.info(`Found ${files.length} files to analyze`);

      // Run full analysis (writes directly to Neo4j, returns void)
      await this.analyzerService.analyze(primaryDirectory, {
        ignorePatterns: serviceConfig.ignore,
        supportedExtensions: serviceConfig.extensions,
      });

      const duration = Date.now() - startTime;

      // Estimate nodes/relationships based on file count
      // Typical ratios: ~15 nodes per file, ~10 relationships per file
      const estimatedNodesCreated = this.scannedFilesCount * 15;
      const estimatedRelationshipsCreated = this.scannedFilesCount * 10;

      const stats: CollectionStats = {
        itemsProcessed: this.scannedFilesCount,
        nodesCreated: estimatedNodesCreated,
        relationshipsCreated: estimatedRelationshipsCreated,
        duration,
        lastCollectionAt: new Date().toISOString(),
        errors: 0,
        warnings: 0,
      };

      // Create collection node in Neo4j
      await this.createCollectionNode(collectionId, stats);

      // Link collection to log file
      const logPath = this.roundRobinLogger.getCurrentFilePath();
      const logLineRange = this.roundRobinLogger.getSessionLineRange();
      await this.linkCollectionToLog(
        collectionId,
        logPath,
        logLineRange.startLine,
        logLineRange.endLine
      );

      // Log completion
      await this.roundRobinLogger.write({
        level: 'info',
        message: 'Initial scan completed',
        serviceId: this.config.id,
        metadata: {
          collectionId,
          itemsProcessed: this.scannedFilesCount,
          nodesCreated: estimatedNodesCreated,
          relationshipsCreated: estimatedRelationshipsCreated,
          duration: `${duration}ms`,
        },
      });

      this.logger.info('Scan completed successfully', {
        collectionId,
        files: this.scannedFilesCount,
        nodes: estimatedNodesCreated,
        relationships: estimatedRelationshipsCreated,
        duration: `${duration}ms`,
      });

      return { itemsFound: this.scannedFilesCount };
    } catch (error: any) {
      // Record error
      this.errorManager.recordError({
        type: 'UNKNOWN_ERROR',
        severity: 'error',
        message: error.message,
        stack: error.stack,
        collectionId,
      });

      // Log error
      await this.roundRobinLogger.write({
        level: 'error',
        message: `Scan failed: ${error.message}`,
        serviceId: this.config.id,
        metadata: {
          collectionId,
          error: error.stack,
        },
      });

      this.logger.error('Scan failed', {
        collectionId,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  }

  /**
   * Start file watcher - monitors for file changes.
   */
  protected startWatcher(sendEvent: (event: BaseServiceEvent) => void): () => void {
    const serviceConfig = this.config.config as CodeGraphServiceConfig;

    if (!serviceConfig.watch) {
      this.logger.info('File watching disabled by configuration');
      return () => {}; // No-op cleanup
    }

    this.logger.info('Starting file watcher', {
      directories: serviceConfig.directories,
      extensions: serviceConfig.extensions,
      ignore: serviceConfig.ignore,
    });

    this.fileWatcher = new FileWatcher({
      watchPath: this.getPrimaryDirectory(),
      ignorePatterns: serviceConfig.ignore,
      debounceMs: 1000, // Wait 1 second after last change
      onEvent: async (event) => {
        // Filter by extensions
        const ext = path.extname(event.path);
        if (!serviceConfig.extensions.includes(ext)) {
          return;
        }

        this.logger.debug('File change detected', {
          type: event.type,
          path: event.path,
        });

        // Send to state machine
        sendEvent({
          type: 'FILE_CHANGED',
          path: event.path,
          changeType: event.type as 'add' | 'change' | 'unlink',
        });

        // Log to round-robin
        await this.roundRobinLogger.write({
          level: 'debug',
          message: `File ${event.type}: ${event.path}`,
          serviceId: this.config.id,
          metadata: {
            changeType: event.type,
            path: event.path,
          },
        });
      },
    });

    // Start watching (async, but don't await)
    this.fileWatcher.start().catch((error) => {
      this.logger.error('FileWatcher failed to start', {
        error: error.message,
        stack: error.stack,
      });
    });

    // Return cleanup function
    return () => {
      if (this.fileWatcher) {
        this.fileWatcher[Symbol.dispose]();
        this.fileWatcher = null;
        this.logger.info('File watcher stopped');
      }
    };
  }

  /**
   * Process file changes - runs incremental analysis.
   */
  protected async process(input: any): Promise<ServiceOutput> {
    const event = input as { type: 'FILE_CHANGED'; path: string; changeType: string };
    const serviceConfig = this.config.config as CodeGraphServiceConfig;

    const collectionId = randomUUID();
    this.currentCollectionId = collectionId;

    const startTime = Date.now();

    this.logger.info('Processing file change', {
      collectionId,
      path: event.path,
      changeType: event.changeType,
    });

    // Mark start of log session
    this.roundRobinLogger.markSessionStart();
    const logStartLine = this.roundRobinLogger.getCurrentLineCount() + 1;

    await this.roundRobinLogger.write({
      level: 'info',
      message: `Processing ${event.changeType}: ${event.path}`,
      serviceId: this.config.id,
      metadata: {
        collectionId,
        changeType: event.changeType,
        path: event.path,
      },
    });

    try {
      // NOTE: Current AnalyzerService doesn't support true incremental updates.
      // For Phase 2, we'll run full re-analysis (correct but slower).
      // Phase 2.5 will add incremental update support.

      const primaryDirectory = this.getPrimaryDirectory();
      await this.analyzerService.analyze(primaryDirectory, {
        ignorePatterns: serviceConfig.ignore,
        supportedExtensions: serviceConfig.extensions,
      });

      const duration = Date.now() - startTime;
      const logEndLine = this.roundRobinLogger.getCurrentLineCount();

      // Estimate stats for the changed file
      const estimatedNodesCreated = 15;
      const estimatedRelationshipsCreated = 10;

      const stats: CollectionStats = {
        itemsProcessed: 1, // One file changed
        nodesCreated: estimatedNodesCreated,
        relationshipsCreated: estimatedRelationshipsCreated,
        duration,
        lastCollectionAt: new Date().toISOString(),
        errors: 0,
        warnings: 0,
      };

      // Create collection node
      await this.createCollectionNode(collectionId, stats);

      // Link collection to log file
      const logPath = this.roundRobinLogger.getCurrentFilePath();
      await this.linkCollectionToLog(collectionId, logPath, logStartLine, logEndLine);

      // Log completion
      await this.roundRobinLogger.write({
        level: 'info',
        message: 'Processing completed',
        serviceId: this.config.id,
        metadata: {
          collectionId,
          path: event.path,
          duration: `${duration}ms`,
        },
      });

      this.logger.info('Processing completed successfully', {
        collectionId,
        path: event.path,
        duration: `${duration}ms`,
      });

      // Get current log file stats
      const logFileSize = await this.roundRobinLogger.getCurrentFileSize();

      // Return ServiceOutput
      const output: ServiceOutput = {
        collectionId,
        serviceId: this.config.id,
        timestamp: new Date().toISOString(),
        nodes: [], // Nodes already stored by AnalyzerService
        relationships: [], // Relationships already stored
        resources: [
          {
            id: randomUUID(),
            type: 'logfile',
            path: logPath,
            format: 'jsonl',
            size: logFileSize,
            records: logEndLine - logStartLine + 1,
            lineRange: { start: logStartLine, end: logEndLine },
          },
        ],
        stats,
      };

      return output;
    } catch (error: any) {
      // Record error
      this.errorManager.recordError({
        type: 'UNKNOWN_ERROR',
        severity: 'error',
        message: error.message,
        stack: error.stack,
        filePath: event.path,
        collectionId,
      });

      // Log error
      await this.roundRobinLogger.write({
        level: 'error',
        message: `Processing failed: ${error.message}`,
        serviceId: this.config.id,
        metadata: {
          collectionId,
          path: event.path,
          error: error.stack,
        },
      });

      this.logger.error('Processing failed', {
        collectionId,
        path: event.path,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  }

  /**
   * Cleanup resources - called on service stop.
   */
  protected async cleanup(): Promise<void> {
    this.logger.info('Cleaning up CodeGraphService...');

    try {
      // 1. Stop file watcher
      if (this.fileWatcher) {
        this.fileWatcher[Symbol.dispose]();
        this.fileWatcher = null;
        this.logger.info('File watcher stopped');
      }

      // 2. Close round-robin logger
      if (this.roundRobinLogger) {
        this.roundRobinLogger[Symbol.dispose]();
        this.logger.info('Round-robin logger closed');
      }

      // 3. Close resource manager
      if (this.resourceManager) {
        this.resourceManager[Symbol.dispose]();
        this.logger.info('Resource manager closed');
      }

      // 4. Update service status in Neo4j
      if (this.neo4jClient) {
        await this.neo4jClient.runTransaction(
          `
          MATCH (s:Service {id: $serviceId})
          SET s.status = 'stopped',
              s.stoppedAt = datetime($stoppedAt)
          RETURN s
          `,
          {
            serviceId: this.config.id,
            stoppedAt: new Date().toISOString(),
          },
          'WRITE',
          'CodeGraphService:UpdateServiceStatus'
        );
        this.logger.info('Service status updated in Neo4j');

        // 5. Close Neo4j connection
        await this.neo4jClient.closeDriver('CodeGraphService');
        this.logger.info('Neo4j connection closed');
      }

      this.logger.info('CodeGraphService cleanup complete');
    } catch (error: any) {
      this.logger.error('Error during cleanup', {
        error: error.message,
        stack: error.stack,
      });
      // Don't throw - cleanup should be best-effort
    }
  }

  // ========================================
  // Private Helper Methods
  // ========================================

  /**
   * Get the first (primary) directory to analyze.
   */
  private getPrimaryDirectory(): string {
    const serviceConfig = this.config.config as CodeGraphServiceConfig;
    const directory = serviceConfig.directories[0];
    if (!directory) {
      throw new Error('No directories configured for analysis');
    }
    return directory;
  }

  /**
   * Create Service node in Neo4j.
   */
  private async createServiceNode(): Promise<void> {
    await this.neo4jClient.runTransaction(
      `
      MERGE (s:Service {id: $id})
      SET s.name = $name,
          s.type = $type,
          s.status = 'initializing',
          s.startedAt = datetime($startedAt),
          s.version = $version
      RETURN s
      `,
      {
        id: this.config.id,
        name: this.config.name,
        type: this.config.type,
        startedAt: new Date().toISOString(),
        version: '1.0.0',
      },
      'WRITE',
      'CodeGraphService:CreateServiceNode'
    );
  }

  /**
   * Create Collection node in Neo4j.
   */
  private async createCollectionNode(
    collectionId: string,
    stats: CollectionStats
  ): Promise<void> {
    await this.neo4jClient.runTransaction(
      `
      MATCH (s:Service {id: $serviceId})
      CREATE (c:Collection {
        id: $collectionId,
        serviceId: $serviceId,
        timestamp: datetime($timestamp),
        itemsProcessed: $itemsProcessed,
        nodesCreated: $nodesCreated,
        relationshipsCreated: $relationshipsCreated,
        duration: $duration,
        errors: $errors,
        warnings: $warnings
      })
      CREATE (s)-[:COLLECTED_AT]->(c)
      RETURN c
      `,
      {
        serviceId: this.config.id,
        collectionId,
        timestamp: new Date().toISOString(),
        itemsProcessed: stats.itemsProcessed,
        nodesCreated: stats.nodesCreated,
        relationshipsCreated: stats.relationshipsCreated,
        duration: stats.duration,
        errors: stats.errors,
        warnings: stats.warnings,
      },
      'WRITE',
      'CodeGraphService:CreateCollection'
    );
  }

  /**
   * Link Collection to LogFile with line range.
   */
  private async linkCollectionToLog(
    collectionId: string,
    logPath: string,
    startLine: number,
    endLine: number
  ): Promise<void> {
    await this.neo4jClient.runTransaction(
      `
      MATCH (c:Collection {id: $collectionId})
      MERGE (log:Resource:LogFile {path: $logPath})
      ON CREATE SET log.id = randomUUID(),
                    log.type = 'logfile',
                    log.format = 'jsonl',
                    log.createdAt = datetime()
      CREATE (c)-[:LOGGED_IN {startLine: $startLine, endLine: $endLine}]->(log)
      RETURN c, log
      `,
      { collectionId, logPath, startLine, endLine },
      'WRITE',
      'CodeGraphService:LinkCollectionToLog'
    );
  }
}
