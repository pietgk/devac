# DevAC Spec v1.3: Incremental Graph Updates

> **Version**: 1.3 (Final Implementation-Ready)  
> **Date**: 2025-12-10  
> **Status**: APPROVED FOR IMPLEMENTATION  
> **Timeline**: 13-15 days

---

## Goal

Transform CodeGraph from **batch processing** (30-60s per repo) to **incremental updates** (<300ms per file change) for all 8 supported languages.

---

## Spec Evolution Summary

| Version | Key Decision | Status |
|---------|-------------|--------|
| v1.0 | Bypass XState, create new IncrementalPipeline | ❌ Rejected |
| v1.1 | Fix XState actors, preserve tested POC logic | ✅ Adopted |
| v1.2 | Single orchestrator (ValidationCoordinatorActor) | ✅ Adopted |
| v1.3 | Type unification, correct file paths, realistic timeline | ✅ Current |

**Core architecture is stable. v1.3 focuses on implementation correctness.**

---

## Architecture

### Single Orchestrator Pattern

```
FileWatcher (src/devac/services/codegraph/file-watcher.ts)
    │
    ▼ FileChangeEvent
ValidationCoordinatorActor (ORCHESTRATOR)
    │
    ├─► [1] Startup: Reconcile Neo4j ↔ filesystem
    │
    ├─► [2] LanguageRouter.parse(filePath) → StructuralParseResult
    │
    ├─► [3] GraphUpdaterActor → Neo4j atomic update
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
  type: string;           // CONTAINS, OWNS, IMPORTS, etc.
  sourceId: string;       // Source entityId
  targetId: string;       // Target entityId
  properties?: Record<string, unknown>;
  createdAt?: string;
}

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
| `semantic-resolver.ts` | 2 | null → undefined |

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

## Startup Reconciliation

**CRITICAL**: Must run BEFORE FileWatcher starts to avoid racing.

### Sequence

```
System Start
    │
    ▼
1. Connect to Neo4j
    │
    ▼
2. ValidationCoordinatorActor enters "reconciling" state
    │
    ▼
3. Compare: Neo4j files vs filesystem
    │
    ├─► In Neo4j but not disk → DELETE from graph
    ├─► On disk but not Neo4j → PARSE and ADD
    └─► Both exist, disk newer → PARSE and UPDATE
    │
    ▼
4. Exit "reconciling" → enter "idle"
    │
    ▼
5. Start FileWatcher (NOW safe to process events)
```

### Implementation

```typescript
// Add to ValidationCoordinatorActor machine
states: {
  reconciling: {
    invoke: {
      src: "reconcileOnStartup",
      onDone: "idle",
      onError: "failed"
    }
  },
  idle: {
    on: {
      FILE_CHANGED: "processing"
    }
  },
  // ... rest of states
}
```

---

## Concurrency Control

### Per-File Mutex with Sequence Numbers

Prevents race conditions from rapid saves:

```typescript
interface ConcurrencyState {
  fileSequence: Map<string, number>;
  fileLocks: Map<string, Promise<void>>;
}

async function processWithMutex(
  filePath: string,
  state: ConcurrencyState,
  processor: () => Promise<void>
): Promise<void> {
  // Increment sequence
  const seq = (state.fileSequence.get(filePath) ?? 0) + 1;
  state.fileSequence.set(filePath, seq);
  
  // Wait for existing lock
  const existing = state.fileLocks.get(filePath);
  if (existing) await existing;
  
  // Check if still latest
  if (state.fileSequence.get(filePath) !== seq) return; // Superseded
  
  // Process with lock
  const lock = processor();
  state.fileLocks.set(filePath, lock);
  try {
    await lock;
  } finally {
    state.fileLocks.delete(filePath);
  }
}
```

### Lock Cleanup

Clean up stale entries periodically:

```typescript
// Run every 5 minutes
function cleanupLocks(state: ConcurrencyState): void {
  // Remove entries older than 10 minutes from fileSequence
  // (fileLocks auto-cleanup on completion)
}
```

---

## Error Handling

### Syntax Errors (Parse Failures)

Files with syntax errors are marked, NOT silently skipped:

```typescript
// On parse error, update File node:
await neo4jClient.runTransaction(
  `MATCH (f:File {filePath: $path})
   SET f.parseError = $error,
       f.parseErrorAt = datetime(),
       f.structuralComplete = false`,
  { path: filePath, error: errorMessage },
  "WRITE", "MarkParseError"
);
// DO NOT delete existing nodes - preserve last good state
```

### Neo4j Connection Failures

```typescript
// GraphUpdaterActor already has retry logic:
guards: {
  canRetry: ({ context }) => context.retryCount < 3,
}

// Add reconnection in Neo4jClient:
async runTransaction(...) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await this.session.run(query, params);
    } catch (e) {
      if (isConnectionError(e) && attempt < 2) {
        await this.reconnect();
        continue;
      }
      throw e;
    }
  }
}
```

### Queue Backpressure

```typescript
const QUEUE_CONFIG = {
  maxSize: 500,
  maxRetries: 3,
  batchSize: 10,
  overflowBehavior: "dropOldest" as const,
};
```

---

## Neo4j Schema

### File Node Properties

```cypher
(:File {
  filePath: STRING,              // Primary key
  name: STRING,
  language: STRING,
  loc: INTEGER,
  
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
  parseErrorAt: DATETIME
})
```

### Required Indexes

```cypher
CREATE INDEX file_path IF NOT EXISTS FOR (f:File) ON (f.filePath);
CREATE INDEX node_entityId IF NOT EXISTS FOR (n:Node) ON (n.entityId);
```

---

## LanguageRouter

### Interface

```typescript
// src/pipeline/language-router.ts (NEW FILE)

export class LanguageRouter {
  private structuralParser: StructuralParser;
  private treeSitterParsers: Map<string, TreeSitterParser>;
  
  constructor(config: { workspaceRoot: string }) {
    this.structuralParser = new StructuralParser();
    // Initialize tree-sitter parsers lazily
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
      return { type: "ParseError", filePath, message: "Unsupported file type", timestamp: new Date().toISOString() };
    }
    
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
  
  private async parseWithTreeSitter(filePath: string, language: string): Promise<StructuralParseResult> {
    const parser = this.getTreeSitterParser(language);
    const result = await parser.parseFile({ path: filePath, extension: path.extname(filePath) });
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

### Tree-Sitter Adapter

```typescript
// src/pipeline/adapters/tree-sitter-adapter.ts (NEW FILE)

export function adaptTreeSitterResult(
  result: { nodes: AstNode[]; relationships: RelationshipInfo[] },
  filePath: string,
  language: string
): StructuralParseResult {
  return {
    filePath,
    nodes: result.nodes,
    relationships: result.relationships,
    importStrings: [],      // Tree-sitter doesn't extract imports
    exportedSymbols: [],    // Tree-sitter doesn't extract exports  
    metadata: {
      parseTime: 0,
      nodeCount: result.nodes.length,
      relationshipCount: result.relationships.length,
      loc: 0,
      language: capitalize(language),
    },
  };
}
```

---

## Performance Targets (Realistic)

| Language | Target | Notes |
|----------|--------|-------|
| TypeScript/JavaScript | <150ms | Babel ~20ms + Neo4j ~100ms |
| Java | <200ms | tree-sitter ~80ms + Neo4j |
| Go | <150ms | tree-sitter ~50ms + Neo4j |
| C/C++ | <200ms | tree-sitter ~80ms + Neo4j |
| C# | <200ms | tree-sitter ~70ms + Neo4j |
| Python | <300ms | Subprocess overhead (v1) |

**Semantic Resolution**: 2-10s per batch (background, acceptable)

---

## Implementation Timeline (13-15 days)

### Phase 1: Fix TypeScript Errors (Days 1-4)

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
- Verify: `tsc --noEmit` → 0 errors

### Phase 2: Core Integration (Days 5-8)

**Day 5:**
- Add unified types to `src/analyzer/types.ts`
- Create `LanguageRouter` class
- Create tree-sitter adapter

**Day 6:**
- Add "reconciling" state to ValidationCoordinatorActor
- Implement startup reconciliation logic
- Ensure reconciliation runs before FileWatcher starts

**Day 7:**
- Add per-file mutex to ValidationCoordinatorActor
- Add lock cleanup mechanism
- Add syntax error handling (parseError field)

**Day 8:**
- Wire LanguageRouter into ValidationCoordinatorActor
- Integration smoke tests: FileWatcher → Parser → Neo4j

### Phase 3: Tree-Sitter Languages (Days 9-11)

**Day 9:**
- Wire Java, Go parsers
- Test file changes for each language

**Day 10:**
- Wire C/C++, C# parsers
- Test all tree-sitter languages

**Day 11:**
- End-to-end integration tests
- Fix any issues found

### Phase 4: Polish & Testing (Days 12-15)

**Day 12:**
- Full test suite: `npm test`
- Fix regressions

**Day 13:**
- Performance benchmarks
- Basic metrics (queue depth, latency)

**Day 14-15:**
- Documentation
- Buffer for unexpected issues

---

## Success Criteria

1. `tsc --noEmit` → 0 errors
2. `npm test` → all existing tests pass
3. Startup reconciliation syncs graph before watcher starts
4. Syntax errors marked on File node, not silent
5. No race conditions (per-file mutex working)
6. Queue bounded with overflow handling
7. File deletion removes owned nodes
8. All 8 languages route correctly

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/pipeline/language-router.ts` | Route files to parsers |
| `src/pipeline/adapters/tree-sitter-adapter.ts` | Adapt tree-sitter results |

## Files to Modify

| File | Changes |
|------|---------|
| `package.json` | Add @types/babel__traverse |
| `src/analyzer/types.ts` | Add unified type definitions |
| `src/analyzer/structural-parser.ts` | Fix 9 TS errors |
| `src/analyzer/semantic-resolver.ts` | Fix 2 TS errors |
| `src/devac/actors/validation-coordinator.actor.ts` | Fix 37 errors, add reconciling state, add mutex |
| `src/devac/actors/graph-updater.actor.ts` | Fix 4 errors |
| `src/devac/actors/affected-calculator.actor.ts` | Fix 5 errors |
| `src/devac/actors/semantic-resolver.actor.ts` | Fix 7 errors |
| `src/devac/actors/script-executor.actor.ts` | Fix 8 errors |
| `src/devac/services/validation-coordinator.service.ts` | Fix 19 errors |
| `src/devac/utils/performance-monitor.ts` | Fix 7 errors |
| `src/devac/utils/query-profiler.ts` | Fix 5 errors |

---

## Known Limitations (v1)

1. **Non-TS/JS semantic resolution**: Tree-sitter languages only get structural phase
2. **Python performance**: 300ms acceptable; keep-alive deferred
3. **No graph versioning**: Rollback deferred to future version
4. **No distributed tracing**: Observability deferred

---

## Future Vision

Full **Code Property Graph** (AST + CFG + PDG) with DevAC capabilities:
- OTel Tracing Integration
- Impact Analysis
- Security Analysis
- Performance Profiling
- Test Coverage Mapping

This spec establishes the **incremental foundation** for all future capabilities.
