# DevAC Spec v1.2: Incremental Graph Updates

> **Version**: 1.2  
> **Date**: 2025-12-10  
> **Status**: Implementation-Ready  
> **Timeline**: 10-12 days (revised from 7)

---

## Goal

Transform CodeGraph from **batch processing** (analyze entire repo, 30-60s) to **incremental updates** (react to file changes in <200ms post-debounce) for all 8 supported languages.

**Why**: Reduce validation time from 30-60s (full repo) to 2-5s (affected files only).

---

## Architecture Decision: Single Orchestrator

**Decision**: Use `ValidationCoordinatorActor` as the sole orchestrator. Do NOT create a separate `IncrementalPipeline` class.

**Rationale**:
- ValidationCoordinatorActor already coordinates FileWatcher → Parser → GraphUpdater → SemanticResolver
- Creating IncrementalPipeline would duplicate orchestration logic
- XState provides clean state management, retry, and parent-child communication

**Data Flow**:
```
FileWatcher
    │
    ▼ FileChangeEvent
ValidationCoordinatorActor (ORCHESTRATOR)
    │
    ├─► LanguageRouter.parse(filePath)
    │       │
    │       └─► StructuralParseResult
    │
    ├─► GraphUpdaterActor.UPDATE(parseResult)
    │       │
    │       └─► Neo4j atomic update
    │
    ├─► SemanticResolverActor.enqueue(filePath)  [TS/JS only]
    │
    └─► AffectedCalculatorActor.calculate(filePath)
            │
            └─► AffectedResult { scope, files, packages }
```

---

## Error Count & Fix Plan

**Verified Error Count**: 103 TypeScript errors (not 71)

| File | Errors | Root Cause |
|------|--------|------------|
| `validation-coordinator.actor.ts` | 37 | Wrong imports, XState v5 typing |
| `validation-coordinator.service.ts` | 19 | Duplicate, XState v5 typing |
| `structural-parser.ts` | 9 | Missing @types/babel__traverse |
| `script-executor.actor.ts` | 8 | XState v5 event typing |
| `semantic-resolver.actor.ts` | 7 | Implicit any, arg mismatch |
| `performance-monitor.ts` | 7 | Possibly undefined access |
| `query-profiler.ts` | 5 | Unknown type errors |
| `affected-calculator.actor.ts` | 5 | XState v5 event typing |
| `graph-updater.actor.ts` | 4 | XState v5 event typing |
| `semantic-resolver.ts` | 2 | null vs undefined |

---

## Startup Reconciliation (Critical Gap #1)

When the system starts after offline changes, the Neo4j graph may be stale.

### Startup Sequence

```
System Start
    │
    ▼
1. Connect to Neo4j
    │
    ▼
2. Get tracked files: MATCH (f:File) RETURN f.filePath, f.lastModified
    │
    ▼
3. Scan workspace filesystem
    │
    ▼
4. Compare:
    ├─► File exists in Neo4j but not filesystem → DELETE from graph
    ├─► File exists in filesystem but not Neo4j → PARSE and ADD
    └─► File exists in both, mtime newer → PARSE and UPDATE
    │
    ▼
5. Start FileWatcher (incremental mode)
```

### Implementation

```typescript
// In ValidationCoordinatorActor - new state: "reconciling"
states: {
  reconciling: {
    invoke: {
      src: "reconcileOnStartup",
      onDone: "idle",
      onError: "failed"
    }
  },
  idle: { /* existing */ },
  // ...
}

async function reconcileOnStartup(
  neo4jClient: Neo4jClient,
  workspaceRoot: string
): Promise<ReconcileResult> {
  // 1. Get tracked files from Neo4j
  const tracked = await neo4jClient.runTransaction(
    `MATCH (f:File) RETURN f.filePath as path, f.lastModified as mtime`,
    {}, "READ", "Reconcile-GetTracked"
  );
  
  // 2. Scan filesystem
  const onDisk = await glob("**/*.{ts,tsx,js,jsx,py,java,go,c,cpp,cs}", {
    cwd: workspaceRoot,
    absolute: true
  });
  
  // 3. Compute diff
  const toDelete = tracked.filter(f => !onDisk.includes(f.path));
  const toAdd = onDisk.filter(f => !tracked.find(t => t.path === f));
  const toUpdate = onDisk.filter(f => {
    const t = tracked.find(t => t.path === f);
    return t && fs.statSync(f).mtimeMs > new Date(t.mtime).getTime();
  });
  
  return { toDelete, toAdd, toUpdate };
}
```

---

## Syntax Error Handling (Critical Gap #2)

Files with parse errors must NOT be silently skipped. This leaves stale data in the graph.

### File Node Error State

```typescript
// Schema addition to File nodes
interface FileNodeProperties {
  filePath: string;
  lastModified: string;
  structuralComplete: boolean;
  semanticComplete: boolean;
  semanticQueued: boolean;
  pendingImports: string[];
  exportedSymbols: object[];
  // NEW: Error tracking
  parseError: string | null;      // Error message if parse failed
  parseErrorAt: string | null;    // ISO timestamp of last error
}
```

### Error Handling Flow

```
Parse Attempt
    │
    ├─► SUCCESS: 
    │       Set f.structuralComplete = true
    │       Set f.parseError = null
    │       Update nodes/relationships
    │
    └─► FAILURE (syntax error):
            Set f.structuralComplete = false
            Set f.parseError = "SyntaxError: Unexpected token..."
            Set f.parseErrorAt = datetime()
            DO NOT delete existing nodes (preserve last good state)
            Log warning
```

### Implementation in GraphUpdaterActor

```typescript
// Add error handling action
actions: {
  markParseError: assign({
    // Store error but don't delete existing data
  }),
}

// In LanguageRouter
async parse(filePath: string): Promise<StructuralParseResult | ParseError> {
  try {
    return await this.doParse(filePath);
  } catch (error) {
    return {
      type: "ParseError",
      filePath,
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
}
```

---

## Concurrency Model (Critical Gap #3)

Rapid saves can cause race conditions where an older parse result overwrites a newer one.

### Per-File Mutex with Sequence Numbers

```typescript
// In ValidationCoordinatorActor context
interface ValidationCoordinatorContext {
  // ... existing fields
  fileSequence: Map<string, number>;  // Track latest sequence per file
  fileLocks: Map<string, Promise<void>>;  // Per-file mutex
}

// When processing a file change
async function processFileChange(
  filePath: string,
  context: ValidationCoordinatorContext
): Promise<void> {
  // 1. Increment sequence number
  const seq = (context.fileSequence.get(filePath) ?? 0) + 1;
  context.fileSequence.set(filePath, seq);
  
  // 2. Wait for any existing operation on this file
  const existingLock = context.fileLocks.get(filePath);
  if (existingLock) {
    await existingLock;
  }
  
  // 3. Check if we're still the latest
  if (context.fileSequence.get(filePath) !== seq) {
    // A newer change came in, skip this one
    return;
  }
  
  // 4. Process with lock
  const lock = (async () => {
    await parseAndUpdate(filePath);
  })();
  context.fileLocks.set(filePath, lock);
  await lock;
  context.fileLocks.delete(filePath);
}
```

### Debounce Interaction

FileWatcher debounce (300ms) handles rapid keystrokes. Per-file mutex handles overlapping debounce windows:

```
t=0ms:    User saves file A
t=50ms:   User saves file A again
t=300ms:  Debounce fires for first save → seq=1, starts parsing
t=350ms:  Debounce fires for second save → seq=2, waits for lock
t=400ms:  First parse completes, but seq=1 < current seq=2, result discarded
t=450ms:  Second parse starts (seq=2)
t=550ms:  Second parse completes, seq=2 matches, result committed
```

---

## Backpressure & Queue Management (Critical Gap #4)

### Semantic Queue Limits

```typescript
const SEMANTIC_QUEUE_CONFIG = {
  maxQueueSize: 500,           // Max files in queue
  maxRetries: 3,               // Per-file retry limit
  batchSize: 10,               // Files per batch
  processingDelayMs: 100,      // Delay between batches
  overflowBehavior: "dropOldest" as const,  // When queue full
};

// Queue overflow handling
function enqueue(filePath: string, priority: "high" | "normal"): void {
  if (this.queue.length >= SEMANTIC_QUEUE_CONFIG.maxQueueSize) {
    if (SEMANTIC_QUEUE_CONFIG.overflowBehavior === "dropOldest") {
      const dropped = this.queue.shift();
      logger.warn(`Queue overflow, dropped: ${dropped?.filePath}`);
    }
  }
  // ... add to queue
}
```

### File Deletion During Processing

When a file is deleted while in semantic queue:

```typescript
// In SemanticResolver.processQueue()
for (const item of batch) {
  // Check if file still exists before processing
  if (!fs.existsSync(item.filePath)) {
    logger.info(`File deleted, removing from queue: ${item.filePath}`);
    continue;  // Skip, don't re-queue
  }
  
  // Check if file was deleted from Neo4j
  const exists = await neo4jClient.runTransaction(
    `MATCH (f:File {filePath: $path}) RETURN count(f) > 0 as exists`,
    { path: item.filePath }, "READ", "CheckExists"
  );
  if (!exists) {
    continue;  // File node was deleted, skip
  }
  
  // Process normally
  await resolveSemantics(item.filePath);
}
```

---

## Neo4j Schema

### File Node Properties

```cypher
// Full schema for File nodes
(:File {
  // Identity
  filePath: STRING,           // Absolute path (unique key)
  name: STRING,               // Filename only
  
  // Timestamps
  lastModified: DATETIME,     // Last successful update
  createdAt: DATETIME,        // First seen
  
  // Structural phase
  structuralComplete: BOOLEAN,
  pendingImports: LIST<STRING>,
  exportedSymbols: LIST<MAP>,
  
  // Semantic phase
  semanticQueued: BOOLEAN,
  semanticComplete: BOOLEAN,
  semanticUpdatedAt: DATETIME,
  
  // Error tracking
  parseError: STRING | NULL,
  parseErrorAt: DATETIME | NULL,
  
  // Metadata
  language: STRING,
  loc: INTEGER
})
```

### Indexes

```cypher
CREATE INDEX file_path IF NOT EXISTS FOR (f:File) ON (f.filePath);
CREATE INDEX node_entityId IF NOT EXISTS FOR (n:Node) ON (n.entityId);
CREATE INDEX semantic_queued IF NOT EXISTS FOR (f:File) ON (f.semanticQueued);
```

### Migration (from existing schema)

```cypher
// Add new properties with defaults
MATCH (f:File)
WHERE f.parseError IS NULL
SET f.parseError = null,
    f.parseErrorAt = null,
    f.structuralComplete = true;  // Assume existing files were parsed OK
```

---

## Event Contracts

### FileChangeEvent (from FileWatcher)

```typescript
type FileChangeType = "add" | "change" | "unlink" | "error";

interface FileChangeEvent {
  type: FileChangeType;
  path: string;           // Absolute path
  timestamp: number;      // Unix timestamp ms
  batch?: FileChangeEvent[];  // For batched changes
  error?: Error;          // For type="error"
}
```

### StructuralParseResult (from LanguageRouter)

```typescript
interface StructuralParseResult {
  filePath: string;
  nodes: AstNode[];
  relationships: RelationshipInfo[];
  importStrings: string[];
  exportedSymbols: ExportedSymbol[];
  metadata: {
    parseTime: number;
    nodeCount: number;
    relationshipCount: number;
    loc: number;
    language: string;
  };
}

interface ParseError {
  type: "ParseError";
  filePath: string;
  message: string;
  timestamp: string;
}

type ParseOutcome = StructuralParseResult | ParseError;
```

### Actor Events

```typescript
// GraphUpdaterActor
type GraphUpdaterEvent =
  | { type: "UPDATE"; filePath: string; parseResult: StructuralParseResult }
  | { type: "MARK_ERROR"; filePath: string; error: string }
  | { type: "DELETE"; filePath: string }
  | { type: "RETRY" }
  | { type: "STOP" };

// AffectedCalculatorActor  
interface AffectedResult {
  scope: "file" | "package" | "repository";
  files: string[];
  packages: string[];
  dependentCount: number;
}

// SemanticResolverActor
interface QueueItem {
  filePath: string;
  priority: "high" | "normal";
  queuedAt: Date;
  attempts: number;
}
```

---

## Performance Targets (Revised)

| Language | Phase 1 Target | Notes |
|----------|---------------|-------|
| TypeScript/JavaScript | <100ms | Babel ~20ms + Neo4j ~50ms |
| Java | <150ms | tree-sitter ~80ms + Neo4j |
| Go | <100ms | tree-sitter ~50ms + Neo4j |
| C/C++ | <150ms | tree-sitter ~80ms + Neo4j |
| C# | <150ms | tree-sitter ~70ms + Neo4j |
| **Python** | **<300ms** | Subprocess overhead (v1 target) |
| Python (future) | <100ms | With keep-alive process |

**Semantic Resolution**: 2-10s per batch of 10 files (acceptable for background)

---

## Implementation Phases (Revised Timeline: 10-12 days)

### Phase 1: Fix TypeScript Errors (Days 1-3)

**Day 1:**
- Install `@types/babel__traverse --legacy-peer-deps`
- Fix `structural-parser.ts` (9 errors): Add Babel traverse types
- Fix `semantic-resolver.ts` (2 errors): null → undefined

**Day 2:**
- Fix `validation-coordinator.actor.ts` (37 errors):
  - Update imports to correct paths
  - Fix XState v5 event typing with type guards
- Fix `validation-coordinator.service.ts` (19 errors): Same pattern

**Day 3:**
- Fix remaining actors (24 errors total):
  - `graph-updater.actor.ts` (4)
  - `affected-calculator.actor.ts` (5)
  - `semantic-resolver.actor.ts` (7)
  - `script-executor.actor.ts` (8)
- Fix utilities:
  - `performance-monitor.ts` (7)
  - `query-profiler.ts` (5)
- Verify: `tsc --noEmit` → 0 errors

### Phase 2: Core Integration (Days 4-6)

**Day 4:**
- Create `LanguageRouter` class
- Implement tree-sitter adapter
- Wire LanguageRouter into ValidationCoordinatorActor

**Day 5:**
- Add startup reconciliation state to ValidationCoordinatorActor
- Implement `reconcileOnStartup` function
- Add per-file mutex for concurrency control

**Day 6:**
- Add syntax error handling (parseError field)
- Add queue backpressure handling
- Integration smoke tests

### Phase 3: Tree-Sitter Languages (Days 7-8)

**Day 7:**
- Wire Java, Go parsers through LanguageRouter
- Test: File change → Neo4j update for each language

**Day 8:**
- Wire C/C++, C# parsers
- End-to-end tests for all tree-sitter languages

### Phase 4: Polish & Testing (Days 9-10)

**Day 9:**
- Run full test suite: `npm test`
- Fix any regressions
- Performance benchmarks

**Day 10:**
- Documentation updates
- Manual testing scenarios
- Buffer for unexpected issues

### Phase 5: Python (Days 11-12, if time permits)

**Day 11-12:**
- Implement keep-alive Python process (optional)
- Or accept 200-300ms as v1 target

---

## Success Criteria

1. **TypeScript compiles**: `tsc --noEmit` → 0 errors
2. **Existing tests pass**: `npm test` → all green
3. **Startup reconciliation**: System syncs graph with filesystem on start
4. **Syntax errors handled**: Parse failures marked on File node, not silent
5. **No race conditions**: Per-file mutex prevents stale overwrites
6. **Queue bounded**: Semantic queue has max size and overflow handling
7. **File deletion works**: Deleting file removes all owned nodes
8. **All 8 languages**: Route to correct parser via LanguageRouter

---

## Files to Modify

| File | Changes |
|------|---------|
| `package.json` | Add `@types/babel__traverse` |
| `src/analyzer/structural-parser.ts` | Fix 9 TS errors |
| `src/analyzer/semantic-resolver.ts` | Fix 2 TS errors |
| `src/analyzer/types.ts` | Add ParseError type |
| `src/devac/actors/validation-coordinator.actor.ts` | Fix 37 errors, add reconcile state, add mutex |
| `src/devac/actors/graph-updater.actor.ts` | Fix 4 errors, add MARK_ERROR event |
| `src/devac/actors/affected-calculator.actor.ts` | Fix 5 errors |
| `src/devac/actors/semantic-resolver.actor.ts` | Fix 7 errors, add backpressure |
| `src/devac/actors/script-executor.actor.ts` | Fix 8 errors |
| `src/devac/utils/performance-monitor.ts` | Fix 7 errors |
| `src/devac/utils/query-profiler.ts` | Fix 5 errors |
| `src/devac/services/validation-coordinator.service.ts` | Fix 19 errors |

## Files to Create

| File | Purpose |
|------|---------|
| `src/pipeline/language-router.ts` | Route files to correct parser |
| `src/pipeline/adapters/tree-sitter-adapter.ts` | Adapt tree-sitter results |

---

## Known Limitations (v1)

1. **Non-TS/JS semantic resolution**: Tree-sitter adapter sets `importStrings: []`, so semantic phase is TS/JS only
2. **Python performance**: 200-300ms acceptable in v1; keep-alive process deferred
3. **No distributed tracing**: Observability deferred to v1.3
4. **No graph versioning**: Rollback capability deferred

---

## Future: Full CPG + DevAC

End goal: Complete **Code Property Graph** (AST + CFG + PDG) with DevAC capabilities:
- OTel Tracing Integration
- Impact Analysis  
- Security Analysis
- Performance Profiling
- Test Coverage Mapping

This spec establishes the **incremental foundation** for all future capabilities.
