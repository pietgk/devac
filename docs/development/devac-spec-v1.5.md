# DevAC Spec v1.5: Incremental Graph Updates

> **Version**: 1.5 (Final Implementation-Ready)  
> **Date**: 2025-12-10  
> **Status**: APPROVED FOR IMPLEMENTATION  
> **Timeline**: 19 days

---

## Goal

Transform CodeGraph from **batch processing** (30-60s per repo) to **incremental updates** (<300ms per file change) for all 8 supported languages.

---

## Spec Evolution Summary

| Version | Key Decision | Status |
|---------|-------------|--------|
| v1.0 | Bypass XState, create new IncrementalPipeline | Rejected |
| v1.1 | Fix XState actors, preserve tested POC logic | Adopted |
| v1.2 | Single orchestrator (ValidationCoordinatorActor) | Adopted |
| v1.3 | Type unification, correct file paths, realistic timeline | Adopted |
| v1.4 | DELETE events, projectRoot scoping, event buffering | Adopted |
| v1.5 | Transaction rollback, graceful shutdown, semantic cycle prevention, content-hash rename | Current |

**Core architecture is stable. v1.5 addresses failure recovery and operational concerns.**

---

## Architecture

### Single Orchestrator Pattern

```
FileWatcher (src/devac/services/codegraph/file-watcher.ts)
    │
    ▼ FileChangeEvent
ValidationCoordinatorActor (ORCHESTRATOR)
    │
    ├─► [1] Startup: Reconcile Neo4j ↔ filesystem (events buffered)
    │
    ├─► [2] LanguageRouter.parse(filePath) → StructuralParseResult
    │
    ├─► [3] GraphUpdaterActor → Neo4j atomic update
    │       ├─► ADD/CHANGE: Delete old nodes, insert new (single transaction)
    │       └─► DELETE: Remove File and owned nodes (cascade)
    │
    ├─► [4] SemanticResolverActor.enqueue() [TS/JS only]
    │
    └─► [5] AffectedCalculatorActor → scope detection
```

### Correct File Locations

| Component | Actual Path |
|-----------|-------------|
| FileWatcher | `src/devac/services/codegraph/file-watcher.ts` |
| Neo4jClient | `src/database/neo4j-client.ts` |
| StructuralParser | `src/analyzer/structural-parser.ts` |
| SemanticResolver | `src/analyzer/semantic-resolver.ts` |
| StorageManager | `src/analyzer/storage-manager.ts` |
| Types | `src/analyzer/types.ts` |

**Import Fix Required**: Actors have wrong import paths like `../types/file-watcher.js` and `../graph/neo4j-client.js`. Must update to correct paths above.

---

## Configuration (P1)

All magic numbers extracted to configuration:

```typescript
// src/devac/config/incremental.config.ts (NEW FILE)

export interface IncrementalConfig {
  // Timeouts
  parseTimeoutMs: number;           // Default: 30000 (30s)
  neo4jConnectionTimeoutMs: number; // Default: 5000 (5s)
  
  // Retry behavior
  maxRetries: number;               // Default: 3
  retryDelayMs: number;             // Default: 1000 (1s)
  
  // Queue management
  maxQueueSize: number;             // Default: 500
  queueOverflowStrategy: "dropOldest" | "backpressure";  // Default: "dropOldest"
  
  // Rename detection
  renameWindowMs: number;           // Default: 200 (increased from 100)
  useContentHash: boolean;          // Default: true
  
  // Concurrency
  lockCleanupIntervalMs: number;    // Default: 300000 (5 min)
  lockStaleThresholdMs: number;     // Default: 600000 (10 min)
  
  // Semantic phase
  semanticBatchSize: number;        // Default: 10
  semanticDebounceMs: number;       // Default: 2000 (2s)
}

export const DEFAULT_CONFIG: IncrementalConfig = {
  parseTimeoutMs: 30000,
  neo4jConnectionTimeoutMs: 5000,
  maxRetries: 3,
  retryDelayMs: 1000,
  maxQueueSize: 500,
  queueOverflowStrategy: "dropOldest",
  renameWindowMs: 200,
  useContentHash: true,
  lockCleanupIntervalMs: 300000,
  lockStaleThresholdMs: 600000,
  semanticBatchSize: 10,
  semanticDebounceMs: 2000,
};
```

---

## Unified Type Definitions

### StructuralParseResult (Single Source of Truth)

All parsers must return this exact shape:

```typescript
// src/analyzer/types.ts - ADD/UPDATE

export interface StructuralParseResult {
  filePath: string;
  nodes: AstNode[];
  relationships: RelationshipInfo[];
  importStrings: string[];
  exportedSymbols: ExportedSymbol[];
  metadata: ParseMetadata;
}

export interface AstNode {
  id: string;
  entityId: string;
  kind: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  language: string;
  // Optional properties
  parentId?: string;
  isExported?: boolean;
  isAsync?: boolean;
  isStatic?: boolean;
  isAbstract?: boolean;
  isGenerator?: boolean;
  loc?: number;
  createdAt?: string;
}

export interface RelationshipInfo {
  id: string;
  entityId: string;
  type: RelationshipType;  // Enum, not string (P1: Cypher injection prevention)
  sourceId: string;
  targetId: string;
  properties?: Record<string, unknown>;
  createdAt?: string;
}

// P1: Whitelist relationship types to prevent Cypher injection
export type RelationshipType = 
  | "CONTAINS"
  | "OWNS"
  | "IMPORTS"
  | "EXPORTS"
  | "CALLS"
  | "REFERENCES"
  | "EXTENDS"
  | "IMPLEMENTS"
  | "DEPENDS_ON";

export interface ExportedSymbol {
  name: string;
  kind: "default" | "named";
  nodeKind: string;
  entityId?: string;
}

export interface ParseMetadata {
  parseTime: number;
  nodeCount: number;
  relationshipCount: number;
  loc: number;
  language: string;
}

export interface ParseError {
  type: "ParseError";
  filePath: string;
  message: string;
  timestamp: string;
}

export type ParseOutcome = StructuralParseResult | ParseError;
```

### FileChangeEvent

```typescript
// Already exists in src/devac/services/codegraph/file-watcher.ts
export type FileChangeType = "add" | "change" | "unlink" | "error";

export interface FileChangeEvent {
  type: FileChangeType;
  path: string;
  timestamp: number;
  contentHash?: string;  // Added for rename detection (P0)
  batch?: FileChangeEvent[];
  error?: Error;
}
```

---

## Error Count & Import Fixes

### Total: 103 TypeScript Errors

| File | Errors | Primary Fix |
|------|--------|-------------|
| `validation-coordinator.actor.ts` | 37 | Fix imports, XState v5 typing |
| `validation-coordinator.service.ts` | 19 | Fix imports, XState v5 typing |
| `structural-parser.ts` | 9 | Install @types/babel__traverse |
| `script-executor.actor.ts` | 8 | XState v5 event typing |
| `semantic-resolver.actor.ts` | 7 | Fix args, add types |
| `performance-monitor.ts` | 7 | Undefined checks |
| `query-profiler.ts` | 5 | Unknown type casts |
| `affected-calculator.actor.ts` | 5 | XState v5 event typing |
| `graph-updater.actor.ts` | 4 | XState v5 event typing |
| `semantic-resolver.ts` | 2 | null to undefined |

### Import Path Corrections

```typescript
// validation-coordinator.actor.ts - CHANGE FROM:
import { FileChangeEvent } from "../types/file-watcher.js";
import { Neo4jClient } from "../graph/neo4j-client.js";
import { StructuralParser } from "../parsers/structural-parser.js";

// TO:
import { FileChangeEvent } from "../services/codegraph/file-watcher.js";
import { Neo4jClient } from "../../database/neo4j-client.js";
import { StructuralParser } from "../../analyzer/structural-parser.js";
```

### XState v5 Event Typing Fix Pattern

```typescript
// Problem: XState v5 uses different event type format
// Error: Type '"xstate.done.actor.performUpdate"' has no overlap with event types

// Solution: Use type guards with "in" operator
actions: {
  setResult: assign({
    result: ({ event }) => {
      if ("output" in event) {
        return event.output as ResultType;
      }
      return null;
    },
  }),
  setError: assign({
    error: ({ event }) => {
      if ("error" in event) {
        return event.error as Error;
      }
      return null;
    },
  }),
}
```

---

## Transaction Guarantees & Rollback (P0)

### Atomic Update Strategy

Graph updates use **single-transaction delete+create** to ensure atomicity:

```typescript
// GraphUpdaterActor - atomic update implementation
async function updateFileInGraph(
  neo4jClient: Neo4jClient,
  filePath: string,
  parseResult: StructuralParseResult,
  projectRoot: string
): Promise<void> {
  // SINGLE TRANSACTION: delete old + create new
  // If ANY part fails, entire transaction rolls back
  await neo4jClient.runTransaction(
    `
    // Step 1: Delete existing nodes for this file
    MATCH (n) WHERE n.filePath = $filePath
    DETACH DELETE n
    
    // Step 2: Create new File node
    WITH 1 as dummy
    CREATE (f:File {
      filePath: $filePath,
      projectRoot: $projectRoot,
      name: $name,
      language: $language,
      loc: $loc,
      structuralComplete: true,
      parseError: null,
      lastModified: datetime(),
      createdAt: datetime()
    })
    
    // Step 3: Create AST nodes (via UNWIND)
    WITH f
    UNWIND $nodes as nodeData
    CREATE (n:Node)
    SET n = nodeData
    CREATE (f)-[:CONTAINS]->(n)
    `,
    {
      filePath,
      projectRoot,
      name: path.basename(filePath),
      language: parseResult.metadata.language,
      loc: parseResult.metadata.loc,
      nodes: parseResult.nodes
    },
    "WRITE",
    "AtomicFileUpdate"
  );
}
```

### Failure Scenarios

| Scenario | Behavior | Data State |
|----------|----------|------------|
| Parse fails | Mark `parseError` on File node | Old nodes preserved |
| Neo4j transaction fails mid-update | Auto-rollback | Old nodes preserved |
| Neo4j connection lost | Retry 3x, then mark error | Old nodes preserved |
| Process crashes during update | Transaction uncommitted | Old nodes preserved |

**Guarantee**: At no point will a file have "zero nodes" due to partial failure.

### Rollback on Parse Success but Graph Failure

```typescript
// If parse succeeds but graph update fails after retries:
actions: {
  handleGraphFailure: async ({ context }) => {
    // Log for manual recovery
    console.error(`Graph update failed for ${context.currentFilePath} after ${context.config.maxRetries} retries`);
    
    // Mark file as needing re-sync (not parseError, different flag)
    await context.neo4jClient.runTransaction(
      `MERGE (f:File {filePath: $path})
       SET f.syncError = $error,
           f.syncErrorAt = datetime()`,
      { path: context.currentFilePath, error: context.lastError?.message },
      "WRITE",
      "MarkSyncError"
    );
    
    // Emit metric for alerting
    context.metrics.incrementCounter("graph_update_failures");
  }
}
```

---

## Queue Overflow Strategy (P0)

### Drop-Oldest with Warning

```typescript
interface QueueState {
  pending: FileChangeEvent[];
  maxSize: number;
  droppedCount: number;
}

function enqueueEvent(
  state: QueueState,
  event: FileChangeEvent,
  metrics: IncrementalMetrics
): void {
  if (state.pending.length >= state.maxSize) {
    // Drop oldest event
    const dropped = state.pending.shift();
    state.droppedCount++;
    
    // Log warning
    console.warn(
      `Queue overflow: dropped event for ${dropped?.path}. ` +
      `Total dropped this session: ${state.droppedCount}`
    );
    
    // Emit metric
    metrics.incrementCounter("queue_overflow_drops");
  }
  
  state.pending.push(event);
}
```

### Backpressure Alternative (Optional)

If `queueOverflowStrategy: "backpressure"`:

```typescript
// FileWatcher pauses when queue is full
async function handleBackpressure(
  watcher: FSWatcher,
  queue: QueueState
): Promise<void> {
  if (queue.pending.length >= queue.maxSize * 0.9) {
    // Pause watching at 90% capacity
    watcher.unwatch("**/*");
    console.warn("Backpressure: pausing file watcher");
    
    // Resume when queue drains to 50%
    await waitUntil(() => queue.pending.length < queue.maxSize * 0.5);
    watcher.add("**/*");
    console.info("Backpressure: resuming file watcher");
  }
}
```

---

## Rename Detection with Content Hash (P0)

### Enhanced Rename Detection

```typescript
interface RenameDetection {
  pendingUnlinks: Map<string, {
    timestamp: number;
    contentHash: string;  // Required for reliable detection
    size: number;
  }>;
}

async function detectRename(
  event: FileChangeEvent,
  state: RenameDetection,
  config: IncrementalConfig
): Promise<{ type: "rename"; oldPath: string; newPath: string } | null> {
  if (event.type === "unlink") {
    // Compute and store content hash before file is gone
    // NOTE: FileWatcher must compute hash BEFORE emitting unlink
    if (event.contentHash) {
      state.pendingUnlinks.set(event.path, {
        timestamp: event.timestamp,
        contentHash: event.contentHash,
        size: 0  // Size from stat if available
      });
    }
    return null;
  }
  
  if (event.type === "add" && event.contentHash && config.useContentHash) {
    // Look for matching content hash within time window
    for (const [oldPath, info] of state.pendingUnlinks) {
      const withinWindow = event.timestamp - info.timestamp < config.renameWindowMs;
      const hashMatches = info.contentHash === event.contentHash;
      
      if (withinWindow && hashMatches) {
        state.pendingUnlinks.delete(oldPath);
        return { type: "rename", oldPath, newPath: event.path };
      }
    }
  }
  
  // Cleanup stale entries (older than 2x window)
  const staleThreshold = Date.now() - (config.renameWindowMs * 2);
  for (const [path, info] of state.pendingUnlinks) {
    if (info.timestamp < staleThreshold) {
      state.pendingUnlinks.delete(path);
    }
  }
  
  return null;
}
```

### FileWatcher Content Hash Integration

```typescript
// FileWatcher must compute hash for unlink events
// Add to src/devac/services/codegraph/file-watcher.ts

import { createHash } from "crypto";
import { readFile } from "fs/promises";

async function computeContentHash(filePath: string): Promise<string | undefined> {
  try {
    const content = await readFile(filePath);
    return createHash("md5").update(content).digest("hex");
  } catch {
    return undefined;  // File already deleted or inaccessible
  }
}

// In watcher setup:
watcher.on("unlink", async (path) => {
  // Hash computed BEFORE emitting event (file might be gone soon)
  // Note: For rename, file is briefly accessible during the rename operation
  const contentHash = await computeContentHash(path);
  emitEvent({ type: "unlink", path, timestamp: Date.now(), contentHash });
});
```

---

## Graceful Shutdown (P0)

### Shutdown State Machine

```typescript
// Add to ValidationCoordinatorActor
states: {
  // ... existing states ...
  
  shuttingDown: {
    entry: [
      "stopAcceptingNewEvents",
      "logShutdownStarted"
    ],
    invoke: {
      src: "drainInFlightUpdates",
      onDone: "shutdown",
      onError: "forceShutdown"
    },
    after: {
      // Force shutdown after 30s even if updates pending
      30000: "forceShutdown"
    }
  },
  
  forceShutdown: {
    entry: [
      "logForceShutdown",
      "emitShutdownMetrics"
    ],
    type: "final"
  },
  
  shutdown: {
    entry: [
      "logCleanShutdown",
      "emitShutdownMetrics"
    ],
    type: "final"
  }
}

// Trigger shutdown on SIGTERM/SIGINT
on: {
  SHUTDOWN_REQUESTED: {
    target: "shuttingDown"
  }
}
```

### Shutdown Sequence

```
SIGTERM/SIGINT received
    │
    ▼
1. Enter "shuttingDown" state
    │
    ▼
2. Stop accepting new FILE_CHANGED events
    │
    ▼
3. Wait for in-flight updates to complete (max 30s)
    │
    ├─► All complete → "shutdown" (clean exit)
    └─► Timeout → "forceShutdown" (log warning, exit)
    │
    ▼
4. Emit final metrics
    │
    ▼
5. Process exits
```

### Implementation

```typescript
// src/devac/shutdown.ts (NEW FILE)

export function setupGracefulShutdown(
  coordinator: ValidationCoordinatorActor
): void {
  const shutdown = () => {
    console.info("Shutdown signal received, draining in-flight updates...");
    coordinator.send({ type: "SHUTDOWN_REQUESTED" });
  };
  
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Drain service implementation
async function drainInFlightUpdates(context: CoordinatorContext): Promise<void> {
  // Wait for all file locks to release
  const locks = Array.from(context.concurrency.fileLocks.values());
  await Promise.all(locks);
  
  // Wait for semantic queue to flush (with timeout)
  if (context.semanticQueue.length > 0) {
    await context.semanticResolver.flush();
  }
}
```

---

## Semantic Phase Specification (P0)

### Trigger Mechanism

Semantic resolution is triggered after structural updates complete:

```typescript
// ValidationCoordinatorActor
states: {
  updatingGraph: {
    invoke: {
      src: "updateGraph",
      onDone: {
        target: "checkSemanticPhase",
        actions: "recordStructuralComplete"
      }
    }
  },
  
  checkSemanticPhase: {
    always: [
      {
        guard: "isTypeScriptOrJavaScript",
        target: "queueSemanticResolution"
      },
      {
        target: "idle"  // Non-TS/JS skips semantic
      }
    ]
  },
  
  queueSemanticResolution: {
    entry: "enqueueForSemantic",
    always: "idle"  // Don't wait for semantic - it's background
  }
}

actions: {
  enqueueForSemantic: ({ context }) => {
    // Check cycle prevention flag
    if (context.semanticInProgress.has(context.currentFilePath)) {
      console.warn(`Skipping semantic for ${context.currentFilePath} - already in progress`);
      return;
    }
    
    context.semanticResolver.enqueue(context.currentFilePath);
  }
}
```

### Cycle Prevention (P0)

```typescript
interface CoordinatorContext {
  // ... other fields ...
  semanticInProgress: Set<string>;  // Files currently being semantically analyzed
}

// SemanticResolverActor
actions: {
  startSemanticAnalysis: assign({
    semanticInProgress: ({ context, event }) => {
      const files = event.files as string[];
      const updated = new Set(context.semanticInProgress);
      files.forEach(f => updated.add(f));
      return updated;
    }
  }),
  
  completeSemanticAnalysis: assign({
    semanticInProgress: ({ context, event }) => {
      const files = event.files as string[];
      const updated = new Set(context.semanticInProgress);
      files.forEach(f => updated.delete(f));
      return updated;
    }
  })
}

// Before enqueuing, check:
guards: {
  canEnqueueSemantic: ({ context, event }) => {
    const filePath = event.filePath as string;
    return !context.semanticInProgress.has(filePath);
  }
}
```

### Semantic Persistence

```typescript
// How semantic updates are written to graph
async function persistSemanticResults(
  neo4jClient: Neo4jClient,
  filePath: string,
  results: SemanticResult
): Promise<void> {
  await neo4jClient.runTransaction(
    `MATCH (f:File {filePath: $filePath})
     SET f.semanticComplete = true,
         f.semanticUpdatedAt = datetime(),
         f.semanticQueued = false
     
     // Update resolved imports
     WITH f
     UNWIND $resolvedImports as imp
     MATCH (target:File {filePath: imp.targetPath})
     MERGE (f)-[r:IMPORTS]->(target)
     SET r.symbols = imp.symbols,
         r.resolvedAt = datetime()
     
     // Update type information on nodes
     WITH f
     UNWIND $typeAnnotations as ta
     MATCH (n:Node {entityId: ta.entityId})
     SET n.resolvedType = ta.type,
         n.typeSource = ta.source`,
    {
      filePath,
      resolvedImports: results.imports,
      typeAnnotations: results.types
    },
    "WRITE",
    "PersistSemanticResults"
  );
}
```

---

## parseError Clearing (P1)

When a file is successfully re-parsed after a previous error:

```typescript
// In GraphUpdater atomic update, parseError is explicitly cleared
`CREATE (f:File {
  filePath: $filePath,
  ...
  parseError: null,        // Explicitly clear on success
  parseErrorAt: null,      // Clear timestamp too
  structuralComplete: true
})`

// Alternative: If updating existing File node
`MATCH (f:File {filePath: $filePath})
 SET f.parseError = null,
     f.parseErrorAt = null,
     f.structuralComplete = true,
     f.lastModified = datetime()`
```

---

## Metrics Interface (P1)

```typescript
// src/devac/metrics/incremental-metrics.ts (NEW FILE)

export interface IncrementalMetrics {
  // Counters
  incrementCounter(name: MetricName): void;
  
  // Gauges
  setGauge(name: MetricName, value: number): void;
  
  // Histograms
  recordHistogram(name: MetricName, value: number): void;
  
  // Get current values (for health checks)
  getSnapshot(): MetricsSnapshot;
}

export type MetricName = 
  | "files_processed"
  | "parse_errors"
  | "graph_update_failures"
  | "queue_overflow_drops"
  | "semantic_queue_depth"
  | "parse_latency_ms"
  | "graph_update_latency_ms"
  | "reconciliation_files_synced";

export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, { p50: number; p95: number; p99: number }>;
}

// Simple in-memory implementation
export class InMemoryMetrics implements IncrementalMetrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  
  incrementCounter(name: MetricName): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
  }
  
  setGauge(name: MetricName, value: number): void {
    this.gauges.set(name, value);
  }
  
  recordHistogram(name: MetricName, value: number): void {
    const values = this.histograms.get(name) ?? [];
    values.push(value);
    // Keep last 1000 values
    if (values.length > 1000) values.shift();
    this.histograms.set(name, values);
  }
  
  getSnapshot(): MetricsSnapshot {
    // Implementation details...
  }
}
```

---

## StorageManager vs GraphUpdater Concurrency (P1)

### Write Lock for Concurrent Operations

When bulk analysis (StorageManager) and incremental updates (GraphUpdater) might run simultaneously:

```typescript
interface WriteLock {
  holder: "bulk" | "incremental" | null;
  acquiredAt: number | null;
  waitingQueue: Array<{ type: "bulk" | "incremental"; resolve: () => void }>;
}

class GraphWriteLock {
  private state: WriteLock = {
    holder: null,
    acquiredAt: null,
    waitingQueue: []
  };
  
  async acquire(type: "bulk" | "incremental"): Promise<void> {
    if (this.state.holder === null) {
      this.state.holder = type;
      this.state.acquiredAt = Date.now();
      return;
    }
    
    // Wait in queue
    return new Promise((resolve) => {
      this.state.waitingQueue.push({ type, resolve });
    });
  }
  
  release(): void {
    this.state.holder = null;
    this.state.acquiredAt = null;
    
    // Give priority to incremental (user-facing latency)
    const next = this.state.waitingQueue.find(w => w.type === "incremental")
      ?? this.state.waitingQueue.shift();
    
    if (next) {
      this.state.holder = next.type;
      this.state.acquiredAt = Date.now();
      next.resolve();
    }
  }
}
```

---

## Startup Reconciliation with Schema Migration (P0)

### Sequence with Event Buffering

```
System Start
    │
    ▼
1. Connect to Neo4j
    │
    ▼
2. Run schema migration (create indexes if missing)
    │
    ▼
3. ValidationCoordinatorActor enters "reconciling" state
    │
    ▼
4. Start FileWatcher (events go to buffer, NOT processed)
    │
    ▼
5. Compare: Neo4j files vs filesystem (scoped by projectRoot)
    │
    ├─► In Neo4j but not disk → DELETE from graph
    ├─► On disk but not Neo4j → PARSE and ADD
    └─► Both exist, disk newer → PARSE and UPDATE
    │
    ▼
6. Exit "reconciling" → enter "idle"
    │
    ▼
7. Replay buffered events (coalesce duplicates)
    │
    ▼
8. Normal event processing begins
```

### Schema Migration (P1)

```typescript
// src/database/migrations/001-incremental-indexes.ts

export async function runMigration(neo4jClient: Neo4jClient): Promise<void> {
  const migrations = [
    // File indexes
    `CREATE INDEX file_path IF NOT EXISTS FOR (f:File) ON (f.filePath)`,
    `CREATE INDEX file_project IF NOT EXISTS FOR (f:File) ON (f.projectRoot)`,
    `CREATE INDEX file_sync_error IF NOT EXISTS FOR (f:File) ON (f.syncError)`,
    
    // Node indexes
    `CREATE INDEX node_entityId IF NOT EXISTS FOR (n:Node) ON (n.entityId)`,
    `CREATE INDEX node_filePath IF NOT EXISTS FOR (n:Node) ON (n.filePath)`,
  ];
  
  for (const migration of migrations) {
    await neo4jClient.runTransaction(migration, {}, "WRITE", "SchemaMigration");
  }
  
  console.info(`Schema migration complete: ${migrations.length} indexes verified`);
}
```

### projectRoot Scoping (P0)

All reconciliation queries MUST be scoped to prevent data loss in shared database:

```cypher
// CORRECT: Scoped query
MATCH (f:File)
WHERE f.filePath STARTS WITH $projectRoot
AND NOT f.filePath IN $filesOnDisk
DETACH DELETE f

// WRONG: Unscoped query (would delete other projects' data)
MATCH (f:File)
WHERE NOT f.filePath IN $filesOnDisk
DETACH DELETE f
```

---

## Performance Targets (Revised)

### Primary Targets (Median)

| Language | Target | Conditions |
|----------|--------|------------|
| TypeScript/JavaScript | <150ms | Files <500 LOC, warm start |
| Java | <200ms | tree-sitter ~80ms + Neo4j |
| Go | <150ms | tree-sitter ~50ms + Neo4j |
| C/C++ | <200ms | tree-sitter ~80ms + Neo4j |
| C# | <200ms | tree-sitter ~70ms + Neo4j |
| Python | <400ms | Subprocess overhead (no keep-alive) |

### P95/P99 Targets (P1)

| Metric | P95 | P99 |
|--------|-----|-----|
| TS/JS parse + update | <300ms | <500ms |
| Large file (>1000 LOC) | <500ms | <1000ms |
| Cold start (first file) | <1000ms | <2000ms |

**Cold Start**: First file after process start may take 500ms-2s due to:
- Parser initialization
- Neo4j connection warming
- tree-sitter WASM loading

This is acceptable and documented.

**Semantic Resolution**: 2-10s per batch (background, acceptable)

---

## Neo4j Schema

### File Node Properties

```cypher
(:File {
  filePath: STRING,              // Primary key
  name: STRING,
  language: STRING,
  loc: INTEGER,
  projectRoot: STRING,
  
  // Timestamps
  lastModified: DATETIME,
  createdAt: DATETIME,
  
  // Structural phase
  structuralComplete: BOOLEAN,
  pendingImports: LIST<STRING>,
  exportedSymbols: LIST<MAP>,
  
  // Semantic phase  
  semanticQueued: BOOLEAN,
  semanticComplete: BOOLEAN,
  semanticUpdatedAt: DATETIME,
  
  // Error tracking
  parseError: STRING,
  parseErrorAt: DATETIME,
  syncError: STRING,           // Added: graph update failure
  syncErrorAt: DATETIME
})
```

### Required Indexes

```cypher
CREATE INDEX file_path IF NOT EXISTS FOR (f:File) ON (f.filePath);
CREATE INDEX file_project IF NOT EXISTS FOR (f:File) ON (f.projectRoot);
CREATE INDEX file_sync_error IF NOT EXISTS FOR (f:File) ON (f.syncError);
CREATE INDEX node_entityId IF NOT EXISTS FOR (n:Node) ON (n.entityId);
CREATE INDEX node_filePath IF NOT EXISTS FOR (n:Node) ON (n.filePath);
```

---

## LanguageRouter

### Interface with Timeout

```typescript
// src/pipeline/language-router.ts (NEW FILE)

export class LanguageRouter {
  private structuralParser: StructuralParser;
  private treeSitterParsers: Map<string, TreeSitterParser>;
  private config: IncrementalConfig;
  
  constructor(config: IncrementalConfig & { workspaceRoot: string }) {
    this.config = config;
    this.structuralParser = new StructuralParser();
  }
  
  canHandle(filePath: string): boolean {
    return this.getLanguage(filePath) !== null;
  }
  
  getLanguage(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_MAP[ext] ?? null;
  }
  
  async parse(filePath: string): Promise<ParseOutcome> {
    const language = this.getLanguage(filePath);
    if (!language) {
      return { 
        type: "ParseError", 
        filePath, 
        message: "Unsupported file type", 
        timestamp: new Date().toISOString() 
      };
    }
    
    return Promise.race([
      this.parseInternal(filePath, language),
      this.createTimeoutError(filePath, this.config.parseTimeoutMs)
    ]);
  }
  
  private async parseInternal(filePath: string, language: string): Promise<ParseOutcome> {
    try {
      switch (language) {
        case "typescript":
        case "javascript":
          return await this.structuralParser.parseStructural(filePath);
        default:
          return await this.parseWithTreeSitter(filePath, language);
      }
    } catch (error) {
      return {
        type: "ParseError",
        filePath,
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      };
    }
  }
  
  private createTimeoutError(filePath: string, timeoutMs: number): Promise<ParseError> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          type: "ParseError",
          filePath,
          message: `Parse timeout after ${timeoutMs}ms`,
          timestamp: new Date().toISOString()
        });
      }, timeoutMs);
    });
  }
  
  private async parseWithTreeSitter(
    filePath: string, 
    language: string
  ): Promise<StructuralParseResult> {
    const parser = this.getTreeSitterParser(language);
    const result = await parser.parseFile({ 
      path: filePath, 
      extension: path.extname(filePath) 
    });
    return adaptTreeSitterResult(result, filePath, language);
  }
}

const EXTENSION_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript", 
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".java": "java",
  ".go": "go",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
};
```

---

## Implementation Timeline (19 days)

### Phase 1: Fix TypeScript Errors (Days 1-5)

**Day 1:**
- `npm install --save-dev @types/babel__traverse --legacy-peer-deps`
- Fix `structural-parser.ts` (9 errors)
- Fix `semantic-resolver.ts` (2 errors)

**Day 2:**
- Fix `validation-coordinator.actor.ts` (37 errors)
  - Update all import paths
  - Apply XState v5 event typing pattern

**Day 3:**
- Fix `validation-coordinator.service.ts` (19 errors)
- Fix `performance-monitor.ts` (7 errors)
- Fix `query-profiler.ts` (5 errors)

**Day 4:**
- Fix remaining actors (24 errors):
  - `graph-updater.actor.ts` (4)
  - `affected-calculator.actor.ts` (5)
  - `semantic-resolver.actor.ts` (7)
  - `script-executor.actor.ts` (8)

**Day 5:**
- Verify: `tsc --noEmit` produces 0 errors
- **EXIT GATE**: Must have 0 TS errors to proceed

### Phase 2: Core Integration (Days 6-11)

**Day 6:**
- Create `src/devac/config/incremental.config.ts`
- Add unified types to `src/analyzer/types.ts`
- Add `RelationshipType` enum

**Day 7:**
- Create `LanguageRouter` class with configurable timeout
- Create tree-sitter adapter

**Day 8:**
- Run schema migration (create indexes)
- Add "reconciling" state to ValidationCoordinatorActor
- Add event buffer and coalescing logic

**Day 9:**
- Implement startup reconciliation with projectRoot scoping
- Add content hash to FileWatcher for rename detection

**Day 10:**
- Add DELETE_FILE event to GraphUpdaterActor
- Implement cascade delete with atomic transactions
- Add parseErrorHandling state

**Day 11:**
- Add graceful shutdown state machine
- Add per-file mutex
- Wire LanguageRouter into pipeline
- Integration smoke tests

### Phase 3: Tree-Sitter Languages (Days 12-14)

**Day 12:**
- Wire Java, Go parsers
- Test file changes for each language

**Day 13:**
- Wire C/C++, C# parsers
- Test all tree-sitter languages

**Day 14:**
- End-to-end integration tests
- Fix issues found

### Phase 4: Polish & Testing (Days 15-19)

**Day 15:**
- Full test suite: `npm test`
- Fix regressions

**Day 16:**
- Performance benchmarks
- Implement IncrementalMetrics interface

**Day 17:**
- Add semantic cycle prevention
- Add GraphWriteLock for concurrent operations

**Day 18:**
- Documentation updates
- Edge case testing (large files, rapid saves)

**Day 19:**
- Final testing
- Buffer for unexpected issues

---

## Test Strategy (P1)

### Unit Tests

| Component | Test Focus |
|-----------|------------|
| LanguageRouter | Extension mapping, timeout behavior, error handling |
| RenameDetection | Content hash matching, window expiry, cleanup |
| QueueOverflow | Drop-oldest behavior, metrics emission |
| ConcurrencyMutex | Sequence superseding, lock cleanup |

### Integration Tests

| Scenario | Expected Behavior |
|----------|-------------------|
| File add | Parse → Graph update → Semantic queue |
| File change | Delete old → Insert new (atomic) |
| File delete | Cascade delete owned nodes |
| Syntax error | Mark parseError, preserve old nodes |
| Neo4j disconnect | Retry 3x, mark syncError |
| Rapid saves | Only latest processed |
| Rename | Detect via hash, update paths |
| Shutdown during update | Drain in-flight, clean exit |

### Performance Tests

| Test | Target |
|------|--------|
| Small file (<100 LOC) | <100ms |
| Medium file (100-500 LOC) | <150ms |
| Large file (>1000 LOC) | <500ms |
| Cold start | <2000ms |
| 100 rapid changes | No dropped events (queue < max) |

---

## Success Criteria

1. `tsc --noEmit` produces 0 errors
2. `npm test` all existing tests pass
3. Startup reconciliation syncs graph before processing events (with projectRoot scoping)
4. File events buffered during reconciliation, replayed after
5. File deletion removes File node and all owned nodes (cascade)
6. Syntax errors marked on File node via parseError field
7. No race conditions (per-file mutex working)
8. Queue overflow drops oldest and logs warning
9. All 8 languages route correctly through LanguageRouter
10. Parse timeout prevents hanging (configurable limit)
11. Graceful shutdown drains in-flight updates
12. Semantic phase has cycle prevention
13. Rename detection uses content hash
14. Metrics interface emits key counters

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/devac/config/incremental.config.ts` | Configuration with defaults |
| `src/pipeline/language-router.ts` | Route files to parsers with timeout |
| `src/pipeline/adapters/tree-sitter-adapter.ts` | Adapt tree-sitter results |
| `src/devac/metrics/incremental-metrics.ts` | Metrics interface |
| `src/devac/shutdown.ts` | Graceful shutdown setup |
| `src/database/migrations/001-incremental-indexes.ts` | Schema migration |

## Files to Modify

| File | Changes |
|------|---------|
| `package.json` | Add @types/babel__traverse |
| `src/analyzer/types.ts` | Add unified types, RelationshipType enum |
| `src/analyzer/structural-parser.ts` | Fix 9 TS errors |
| `src/analyzer/semantic-resolver.ts` | Fix 2 TS errors |
| `src/devac/actors/validation-coordinator.actor.ts` | Fix 37 errors, add reconciling, shutdown, mutex, event buffer, projectRoot |
| `src/devac/actors/graph-updater.actor.ts` | Fix 4 errors, add DELETE_FILE, atomic transactions |
| `src/devac/actors/affected-calculator.actor.ts` | Fix 5 errors |
| `src/devac/actors/semantic-resolver.actor.ts` | Fix 7 errors, add cycle prevention |
| `src/devac/actors/script-executor.actor.ts` | Fix 8 errors |
| `src/devac/services/validation-coordinator.service.ts` | Fix 19 errors |
| `src/devac/services/codegraph/file-watcher.ts` | Add content hash computation |
| `src/devac/utils/performance-monitor.ts` | Fix 7 errors |
| `src/devac/utils/query-profiler.ts` | Fix 5 errors |
| `src/database/neo4j-client.ts` | Run schema migration on startup |

---

## Known Limitations (v1)

1. **Non-TS/JS semantic resolution**: Tree-sitter languages only get structural phase
2. **Python performance**: 400ms acceptable; keep-alive deferred
3. **No graph versioning**: Rollback deferred to future version
4. **No distributed tracing**: OTel integration deferred
5. **Rename detection**: Best-effort with content hash + 200ms window

---

## Future Vision

Full **Code Property Graph** (AST + CFG + PDG) with DevAC capabilities:
- OTel Tracing Integration
- Impact Analysis
- Security Analysis
- Performance Profiling
- Test Coverage Mapping

This spec establishes the **incremental foundation** for all future capabilities.

---

## Validation Checklist

### P0 Items from v1.4 Review

| Issue | Section | Status |
|-------|---------|--------|
| No rollback/partial failure handling | Transaction Guarantees & Rollback | ADDRESSED |
| Queue overflow strategy missing | Queue Overflow Strategy | ADDRESSED |
| Rename detection unreliable | Rename Detection with Content Hash | ADDRESSED |
| No graceful shutdown sequence | Graceful Shutdown | ADDRESSED |
| Semantic cycle prevention missing | Semantic Phase Specification | ADDRESSED |

### P1 Items from v1.4 Review

| Issue | Section | Status |
|-------|---------|--------|
| Schema migration not in timeline | Implementation Timeline Day 8 | ADDRESSED |
| No metrics/observability interface | Metrics Interface | ADDRESSED |
| No test strategy | Test Strategy | ADDRESSED |
| Magic numbers need configuration | Configuration | ADDRESSED |
| Cold-start latency not documented | Performance Targets | ADDRESSED |
| Cypher injection risk | RelationshipType enum | ADDRESSED |
| GraphUpdater vs StorageManager conflict | StorageManager vs GraphUpdater Concurrency | ADDRESSED |
| parseError clearing not specified | parseError Clearing | ADDRESSED |

### Architecture Validation

| Check | Result |
|-------|--------|
| Single orchestrator pattern preserved | YES |
| Two-phase parsing preserved | YES |
| XState actors preserved (not rewritten) | YES |
| Working components reused | YES |
| 103 errors addressed with specific fixes | YES |
| Timeline includes buffer | YES (19 days) |
| Phase 1 exit gate defined | YES (0 TS errors) |
| Self-contained spec | YES |

### Implementation Readiness

| Criterion | Status |
|-----------|--------|
| All file paths verified | YES |
| All types defined | YES |
| All state transitions defined | YES |
| All Cypher queries scoped | YES |
| Error handling explicit | YES |
| Concurrency model complete | YES |
| Configuration externalized | YES |
| Metrics defined | YES |
| Test strategy defined | YES |
| Shutdown handling defined | YES |

**Spec v1.5 is IMPLEMENTATION-READY.**
