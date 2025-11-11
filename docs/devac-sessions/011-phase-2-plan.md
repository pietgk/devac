# Phase 2: CodeGraphService Integration - Implementation Plan

**Status**: 🚧 Planning Complete - Ready for Implementation
**Estimated Effort**: 3-5 hours
**Branch**: `claude/phase-3-container-strategy-011CUxwSMTDF3T9kek4Rqws2`

---

## 🎯 Objective

Transform the existing static CodeGraph analyzer into a **real-time service** integrated with the DevAC orchestrator using XState v5 actors.

---

## 📊 Current State Analysis

### ✅ Already Complete

**1. Foundation Infrastructure (Phase 1)**
- `BaseService` - Abstract service with XState state machine
- `Orchestrator` - Service registry, event bus, lifecycle management
- Type system - Complete TypeScript definitions
- CLI framework - `init`, `start`, `stop`, `service` commands

**2. CodeGraph Utilities (Fully Tested)**
- ✅ `RoundRobinLogger` (20 tests passing) - Rotating JSON log files
- ✅ `ResourceManager` (19 tests passing) - Large data storage with Neo4j refs
- ✅ `FileWatcher` (23 tests passing) - Chokidar-based file watching
- ✅ `ErrorManager` (13 tests passing) - Error tracking and thresholds

**3. Existing Analyzer (Production Ready)**
- ✅ `AnalyzerService` - Two-pass analyzer (scan → parse → resolve → store)
- ✅ Multi-language support (TS/JS, Python, Java, C#, Go, C++, SQL)
- ✅ `Parser` - Coordinates language-specific parsers
- ✅ `RelationshipResolver` - Cross-file relationship resolution
- ✅ `StorageManager` - Batched Neo4j writes
- ✅ Neo4j integration with connection health monitoring

### 🚧 What Needs to be Built

**CodeGraphService** - A service actor that:
1. Extends `BaseService` abstract class
2. Wraps existing `AnalyzerService` functionality
3. Implements 5 required methods: `initialize()`, `scan()`, `startWatcher()`, `process()`, `cleanup()`
4. Integrates utility components (logger, watcher, resource manager)
5. Handles incremental updates (not full rescans on file change)
6. Tracks collections in Neo4j for DevAC graph queries
7. Produces `ServiceOutput` with resource references

---

## 🏗️ Architecture Design

### Service State Machine Flow

```
┌─────────────────────────────────────────────────┐
│           CodeGraphService Actor                │
└─────────────────────────────────────────────────┘
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
┌─────────┐   ┌──────────┐   ┌───────────┐
│ Logger  │   │ Watcher  │   │ Resources │
│  (RR)   │   │(Chokidar)│   │ (Manager) │
└─────────┘   └──────────┘   └───────────┘
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
┌─────────┐   ┌──────────┐   ┌───────────┐
│ Parser  │   │ Resolver │   │  Storage  │
│(Analyzer)│   │(Analyzer)│   │ (Neo4j)   │
└─────────┘   └──────────┘   └───────────┘

States:
idle → initializing → scanning → watching → processing
       ↑                              ↓
       └──────────── degraded ←───────┘
```

### Class Structure

```typescript
export class CodeGraphService extends BaseService {
  // Core components (existing analyzer)
  private analyzerService: AnalyzerService;

  // DevAC utility components
  private roundRobinLogger: RoundRobinLogger;
  private resourceManager: ResourceManager;
  private fileWatcher: FileWatcher;
  private errorManager: ErrorManager;

  // State tracking
  private currentCollectionId?: string;
  private scanStats?: { itemsProcessed: number; nodesCreated: number; ... };

  // Neo4j client (shared)
  private neo4jClient: Neo4jClient;

  // Methods (implementing BaseService abstract methods)
  protected async initialize(): Promise<void>;
  protected async scan(): Promise<{ itemsFound: number }>;
  protected startWatcher(sendEvent): () => void;
  protected async process(input: any): Promise<ServiceOutput>;
  protected async cleanup(): Promise<void>;
}
```

---

## 📝 Implementation Tasks

### Task 1: CodeGraphService Class Setup
**File**: `src/devac/services/codegraph/codegraph-service.ts`

```typescript
import { BaseService } from '../base-service.js';
import { AnalyzerService } from '../../../analyzer/analyzer-service.js';
import { RoundRobinLogger } from './round-robin-logger.js';
import { ResourceManager } from './resource-manager.js';
import { FileWatcher } from './file-watcher.js';
import { ErrorManager } from './error-manager.js';
import { Neo4jClient } from '../../../database/neo4j-client.js';

export interface CodeGraphServiceConfig {
  directories: string[];
  extensions: string[];
  ignore: string[];
  watch: boolean;
  logDir: string;
  resourceDir: string;
  maxLogFileSize: number;
  maxLogFiles: number;
}

export class CodeGraphService extends BaseService {
  private analyzerService: AnalyzerService;
  private roundRobinLogger: RoundRobinLogger;
  private resourceManager: ResourceManager;
  private fileWatcher: FileWatcher | null = null;
  private errorManager: ErrorManager;
  private neo4jClient: Neo4jClient;
  private currentCollectionId?: string;

  constructor(config: ServiceConfig) {
    super(config);
    // Initialize components...
  }

  // Implement 5 abstract methods...
}
```

**Complexity**: Medium
**Time**: 30 minutes

---

### Task 2: Initialize Method
**Responsibilities**:
- Set up Neo4j connection
- Initialize RoundRobinLogger
- Initialize ResourceManager
- Initialize ErrorManager
- Create service node in Neo4j
- Verify analyzer can connect

```typescript
protected async initialize(): Promise<void> {
  const serviceConfig = this.config.config as CodeGraphServiceConfig;

  // 1. Initialize Neo4j client
  this.neo4jClient = new Neo4jClient({
    uri: this.config.neo4j?.uri,
    username: this.config.neo4j?.username,
    password: this.config.neo4j?.password,
    database: this.config.neo4j?.database,
  });

  await this.neo4jClient.initializeDriver('CodeGraphService');

  // 2. Initialize round-robin logger
  this.roundRobinLogger = new RoundRobinLogger({
    logDir: serviceConfig.logDir,
    maxFileSize: serviceConfig.maxLogFileSize,
    maxFiles: serviceConfig.maxLogFiles,
  });
  await this.roundRobinLogger.initialize();

  // 3. Initialize resource manager
  this.resourceManager = new ResourceManager(this.neo4jClient, {
    resourceDir: serviceConfig.resourceDir,
  });
  await this.resourceManager.initialize();

  // 4. Initialize error manager
  this.errorManager = new ErrorManager({
    maxErrors: 100,
    threshold: 50,
  });

  // 5. Initialize analyzer service
  this.analyzerService = new AnalyzerService(
    {
      uri: this.neo4jClient.getUri(),
      username: this.neo4jClient.getUsername(),
      password: this.neo4jClient.getPassword(),
      database: this.neo4jClient.getDatabase(),
    },
    serviceConfig.directories[0], // workspace root
    {
      repository: this.config.name,
      repositoryPath: serviceConfig.directories[0],
      syncedAt: new Date().toISOString(),
    }
  );

  // 6. Create service node in Neo4j
  await this.createServiceNode();

  this.logger.info('CodeGraphService initialized', {
    directories: serviceConfig.directories,
    extensions: serviceConfig.extensions,
  });
}

private async createServiceNode(): Promise<void> {
  await this.neo4jClient.runTransaction(
    async (tx) => {
      await tx.run(
        `
        MERGE (s:Service {id: $id})
        SET s.name = $name,
            s.type = $type,
            s.status = $status,
            s.startedAt = datetime($startedAt),
            s.version = $version
        RETURN s
        `,
        {
          id: this.config.id,
          name: this.config.name,
          type: this.config.type,
          status: 'initializing',
          startedAt: new Date().toISOString(),
          version: '1.0.0',
        }
      );
    },
    'CodeGraphService:CreateServiceNode'
  );
}
```

**Complexity**: Medium
**Time**: 45 minutes

---

### Task 3: Scan Method (Initial Analysis)
**Responsibilities**:
- Create new collection ID
- Run full analyzer scan
- Log to RoundRobinLogger
- Store collection in Neo4j
- Return itemsFound count

```typescript
protected async scan(): Promise<{ itemsFound: number }> {
  const serviceConfig = this.config.config as CodeGraphServiceConfig;
  const collectionId = randomUUID();
  this.currentCollectionId = collectionId;

  const startTime = Date.now();

  // Log scan start
  await this.roundRobinLogger.write({
    level: 'info',
    message: 'Starting initial code scan',
    serviceId: this.config.id,
    metadata: {
      collectionId,
      directories: serviceConfig.directories,
    },
  });

  try {
    // Run full analysis
    const result = await this.analyzerService.analyze(
      serviceConfig.directories[0],
      {
        ignorePatterns: serviceConfig.ignore,
        supportedExtensions: serviceConfig.extensions,
      }
    );

    const duration = Date.now() - startTime;

    // Create collection node in Neo4j
    await this.createCollectionNode(collectionId, {
      itemsProcessed: result.files.length,
      nodesCreated: result.summary.nodesCreated,
      relationshipsCreated: result.summary.relationshipsCreated,
      duration,
      errors: 0,
      warnings: 0,
    });

    // Log completion
    await this.roundRobinLogger.write({
      level: 'info',
      message: 'Initial scan completed',
      serviceId: this.config.id,
      metadata: {
        collectionId,
        nodesCreated: result.summary.nodesCreated,
        relationshipsCreated: result.summary.relationshipsCreated,
        duration: `${duration}ms`,
      },
    });

    this.logger.info('Scan completed', {
      files: result.files.length,
      nodes: result.summary.nodesCreated,
      duration: `${duration}ms`,
    });

    return { itemsFound: result.files.length };
  } catch (error: any) {
    await this.errorManager.trackError(error, {
      context: 'scan',
      collectionId,
    });

    await this.roundRobinLogger.write({
      level: 'error',
      message: `Scan failed: ${error.message}`,
      serviceId: this.config.id,
      metadata: { collectionId, error: error.stack },
    });

    throw error;
  }
}

private async createCollectionNode(
  collectionId: string,
  stats: CollectionStats
): Promise<void> {
  await this.neo4jClient.runTransaction(
    async (tx) => {
      await tx.run(
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
          ...stats,
        }
      );
    },
    'CodeGraphService:CreateCollection'
  );
}
```

**Complexity**: Medium
**Time**: 45 minutes

---

### Task 4: StartWatcher Method
**Responsibilities**:
- Create FileWatcher instance
- Configure ignore patterns
- Handle file change events
- Send FILE_CHANGED events to state machine
- Return cleanup function

```typescript
protected startWatcher(
  sendEvent: (event: BaseServiceEvent) => void
): () => void {
  const serviceConfig = this.config.config as CodeGraphServiceConfig;

  if (!serviceConfig.watch) {
    this.logger.info('File watching disabled by configuration');
    return () => {}; // No-op cleanup
  }

  this.logger.info('Starting file watcher', {
    directories: serviceConfig.directories,
    extensions: serviceConfig.extensions,
  });

  this.fileWatcher = new FileWatcher({
    watchPath: serviceConfig.directories[0],
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
    this.logger.error('FileWatcher failed to start', { error: error.message });
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
```

**Complexity**: Low
**Time**: 30 minutes

---

### Task 5: Process Method (Incremental Updates)
**Responsibilities**:
- Handle FILE_CHANGED events
- Run incremental analysis (single file)
- Update collection stats
- Create ServiceOutput with resource references
- Store log references in Neo4j

```typescript
protected async process(input: any): Promise<ServiceOutput> {
  const event = input as { type: 'FILE_CHANGED'; path: string; changeType: string };

  const collectionId = randomUUID();
  this.currentCollectionId = collectionId;

  const startTime = Date.now();

  this.logger.info('Processing file change', {
    path: event.path,
    changeType: event.changeType,
  });

  try {
    // For incremental updates, we need to:
    // 1. Parse the changed file
    // 2. Update its nodes in Neo4j (delete old, insert new)
    // 3. Re-resolve relationships involving this file

    // Log processing start
    const logStartLine = await this.roundRobinLogger.getCurrentLineCount();

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

    // Run incremental analysis
    // NOTE: Current AnalyzerService doesn't support incremental updates
    // We'll either need to:
    // Option A: Run full analysis (slower but correct)
    // Option B: Extend AnalyzerService with incremental update method (better)

    // For now, use Option A (full re-analysis)
    const serviceConfig = this.config.config as CodeGraphServiceConfig;
    const result = await this.analyzerService.analyze(
      serviceConfig.directories[0],
      {
        ignorePatterns: serviceConfig.ignore,
        supportedExtensions: serviceConfig.extensions,
      }
    );

    const duration = Date.now() - startTime;
    const logEndLine = await this.roundRobinLogger.getCurrentLineCount();

    // Create collection with log reference
    const stats: CollectionStats = {
      itemsProcessed: 1, // Changed file
      nodesCreated: result.summary.nodesCreated,
      relationshipsCreated: result.summary.relationshipsCreated,
      duration,
      errors: 0,
      warnings: 0,
    };

    await this.createCollectionNode(collectionId, stats);

    // Link collection to log file
    await this.linkCollectionToLog(
      collectionId,
      this.roundRobinLogger.getCurrentFilePath(),
      logStartLine,
      logEndLine
    );

    // Log completion
    await this.roundRobinLogger.write({
      level: 'info',
      message: 'Processing completed',
      serviceId: this.config.id,
      metadata: {
        collectionId,
        duration: `${duration}ms`,
      },
    });

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
          path: this.roundRobinLogger.getCurrentFilePath(),
          format: 'jsonl',
          size: await this.roundRobinLogger.getCurrentFileSize(),
          records: logEndLine - logStartLine + 1,
          lineRange: { start: logStartLine, end: logEndLine },
        },
      ],
      stats,
    };

    return output;
  } catch (error: any) {
    await this.errorManager.trackError(error, {
      context: 'process',
      collectionId,
      path: event.path,
    });

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

    throw error;
  }
}

private async linkCollectionToLog(
  collectionId: string,
  logPath: string,
  startLine: number,
  endLine: number
): Promise<void> {
  await this.neo4jClient.runTransaction(
    async (tx) => {
      await tx.run(
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
        { collectionId, logPath, startLine, endLine }
      );
    },
    'CodeGraphService:LinkCollectionToLog'
  );
}
```

**Complexity**: High
**Time**: 60 minutes

**NOTE**: The current `AnalyzerService` doesn't support true incremental updates. Phase 2 will use full re-analysis. Future optimization (Phase 2.5) can add incremental update support.

---

### Task 6: Cleanup Method
**Responsibilities**:
- Stop file watcher
- Close round-robin logger
- Close resource manager
- Close Neo4j connection
- Update service status in Neo4j

```typescript
protected async cleanup(): Promise<void> {
  this.logger.info('Cleaning up CodeGraphService...');

  try {
    // 1. Stop file watcher
    if (this.fileWatcher) {
      this.fileWatcher[Symbol.dispose]();
      this.fileWatcher = null;
    }

    // 2. Close round-robin logger
    if (this.roundRobinLogger) {
      this.roundRobinLogger[Symbol.dispose]();
    }

    // 3. Close resource manager
    if (this.resourceManager) {
      this.resourceManager[Symbol.dispose]();
    }

    // 4. Update service status in Neo4j
    await this.neo4jClient.runTransaction(
      async (tx) => {
        await tx.run(
          `
          MATCH (s:Service {id: $serviceId})
          SET s.status = 'stopped',
              s.stoppedAt = datetime($stoppedAt)
          RETURN s
          `,
          {
            serviceId: this.config.id,
            stoppedAt: new Date().toISOString(),
          }
        );
      },
      'CodeGraphService:UpdateServiceStatus'
    );

    // 5. Close Neo4j connection
    await this.neo4jClient.closeDriver('CodeGraphService');

    this.logger.info('CodeGraphService cleanup complete');
  } catch (error: any) {
    this.logger.error('Error during cleanup', { error: error.message });
    // Don't throw - cleanup should be best-effort
  }
}
```

**Complexity**: Low
**Time**: 20 minutes

---

### Task 7: Testing

**Unit Tests** (`codegraph-service.spec.ts`):
- Test each method in isolation with mocked dependencies
- Test state machine transitions
- Test error handling

**Integration Tests** (`codegraph-service.integration.spec.ts`):
- Test end-to-end flow: initialize → scan → watch → process → cleanup
- Test with real Neo4j (using universal testing framework ✅)
- Test file changes trigger processing
- Test collection tracking in Neo4j
- Test log file rotation
- Test resource references

**Complexity**: Medium
**Time**: 60 minutes

---

### Task 8: CLI Integration

Update `src/devac/cli/commands/start.ts`:

```typescript
import { CodeGraphService } from '../../services/codegraph/codegraph-service.js';

// Inside start command:
if (config.services.codegraph?.enabled) {
  const serviceConfig: ServiceConfig = {
    id: 'codegraph',
    name: 'CodeGraph Analyzer',
    type: 'codegraph',
    enabled: true,
    config: {
      directories: config.services.codegraph.directories || ['./'],
      extensions: config.services.codegraph.extensions || ['.ts', '.js', '.py'],
      ignore: config.services.codegraph.ignore || ['**/node_modules/**'],
      watch: config.services.codegraph.watch ?? true,
      logDir: path.join(workspaceDir, 'logs', 'codegraph'),
      resourceDir: path.join(workspaceDir, 'resources', 'codegraph'),
      maxLogFileSize: 10 * 1024 * 1024, // 10MB
      maxLogFiles: 10,
    },
  };

  const service = new CodeGraphService(serviceConfig);
  const machine = service.createMachine();
  const actor = createActor(machine, { input: { config: serviceConfig } });

  orchestrator.registerService('codegraph', actor, serviceConfig);
  orchestrator.startService('codegraph');
}
```

**Complexity**: Low
**Time**: 20 minutes

---

## 📈 Success Criteria

- [ ] CodeGraphService extends BaseService ✅
- [ ] All 5 abstract methods implemented ✅
- [ ] Integrates with existing AnalyzerService ✅
- [ ] Uses RoundRobinLogger for service logs ✅
- [ ] Uses ResourceManager for large data ✅
- [ ] Uses FileWatcher for change detection ✅
- [ ] Creates Service and Collection nodes in Neo4j ✅
- [ ] Links collections to log files ✅
- [ ] Handles errors gracefully ✅
- [ ] Unit tests pass (90%+ coverage) ✅
- [ ] Integration tests pass (end-to-end) ✅
- [ ] CLI can start/stop service ✅
- [ ] Documentation complete ✅

---

## 🚀 Implementation Order

1. **Day 1** (2-3 hours):
   - Task 1: Class setup and constructor
   - Task 2: Initialize method
   - Task 3: Scan method
   - Task 6: Cleanup method

2. **Day 2** (1-2 hours):
   - Task 4: StartWatcher method
   - Task 5: Process method
   - Task 8: CLI integration

3. **Day 3** (1 hour):
   - Task 7: Testing
   - Documentation updates

---

## 🎯 Future Enhancements (Phase 2.5)

After Phase 2 is complete and stable:

1. **Incremental Analysis** (High Priority)
   - Add `analyzeFile(filePath)` method to AnalyzerService
   - Only re-parse changed file and its dependents
   - Significantly faster updates (100ms vs 5s)

2. **Batch Processing** (Medium Priority)
   - Buffer multiple file changes
   - Process batch together for efficiency

3. **Smart Invalidation** (Medium Priority)
   - Track file dependencies
   - Only re-resolve affected relationships
   - Further optimize incremental updates

4. **Memory Optimization** (Low Priority)
   - Stream large analysis results
   - Avoid loading entire codebase in memory

---

## 📚 References

- **Architecture**: `DEVAC_README.md`
- **Base Service**: `src/devac/services/base-service.ts`
- **Orchestrator**: `src/devac/orchestrator/orchestrator.ts`
- **Analyzer**: `src/analyzer/analyzer-service.ts`
- **Types**: `src/devac/types/service.ts`
- **Utilities**: `src/devac/services/codegraph/*.ts`

---

**Ready to implement?** Start with Task 1 (Class Setup) and proceed sequentially.

**Estimated Total Time**: 3-5 hours for complete implementation and testing.

**Next Phase**: Phase 3 - Web UI Foundation (Fastify + React + SSE)
