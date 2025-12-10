# DevAC Spec v1.1: Incremental Graph Updates

> **Version**: 1.1  
> **Date**: 2025-12-10  
> **Status**: Implementation-Ready  
> **Previous**: v1.0 (reviewed by Claude, GPT, Gemini)

---

## Goal

Transform CodeGraph from **batch processing** (analyze entire repo, 30-60s) to **incremental updates** (react to file changes in <200ms post-debounce) for all 8 supported languages.

**Why**: Reduce validation time from 30-60s (full repo) to 2-5s (affected files only).

**How**: Fix and integrate existing POC actors with working parsers.

---

## Key Decision: Fix POC, Don't Rewrite

The v1.0 spec proposed bypassing XState actors due to 103 TypeScript errors. After review:

1. **The POC actors contain valuable, tested logic**:
   - `graph-updater.actor.ts`: Atomic delete-then-insert, retry logic, import/export storage
   - `affected-calculator.actor.ts`: LRU caching, dependency queries, scope detection
   - All actors have passing tests

2. **XState provides clean state management** for:
   - Retry with backoff
   - Parent-child actor communication
   - Clear state transitions

3. **The errors are fixable** (categorized below)

**Decision**: Fix the 58 TypeScript errors in actors, preserve the architecture.

---

## Error Analysis & Fix Plan

### Error Breakdown (58 total in actors)

| File | Errors | Root Cause | Fix |
|------|--------|------------|-----|
| `validation-coordinator.actor.ts` | 37 | Wrong import paths | Update imports |
| `script-executor.actor.ts` | 8 | XState v5 event typing | Add type guards |
| `semantic-resolver.actor.ts` | 7 | Implicit any, arg mismatch | Add types, fix calls |
| `affected-calculator.actor.ts` | 5 | XState v5 event typing | Add type guards |
| `graph-updater.actor.ts` | 4 | XState v5 event typing | Add type guards |

### Additional Errors (13 in core components)

| File | Errors | Root Cause | Fix |
|------|--------|------------|-----|
| `structural-parser.ts` | 9 | Missing @types/babel__traverse | Install types, add annotations |
| `semantic-resolver.ts` | 2 | null vs undefined | Convert null to undefined |

**Total: 71 errors → 0 errors**

---

## Component Architecture

### Working Components (Integration-Ready)

| Component | Location | Speed | Notes |
|-----------|----------|-------|-------|
| StructuralParser | `src/analyzer/structural-parser.ts` | ~20ms | 9 TS errors to fix |
| SemanticResolver | `src/analyzer/semantic-resolver.ts` | 2-5s/batch | 2 TS errors to fix |
| FileWatcher | `src/devac/services/codegraph/file-watcher.ts` | - | Ready |
| StorageManager | `src/analyzer/storage-manager.ts` | <50ms | Ready |
| Neo4jClient | `src/database/neo4j-client.ts` | - | Ready |
| tree-sitter parsers | `src/analyzer/parsers/*.ts` | <100ms | Ready (need adapters) |

### POC Actors (Fix TypeScript Errors)

| Actor | Location | Purpose | Errors |
|-------|----------|---------|--------|
| GraphUpdaterActor | `src/devac/actors/graph-updater.actor.ts` | Atomic Neo4j updates | 4 |
| AffectedCalculatorActor | `src/devac/actors/affected-calculator.actor.ts` | Dependency queries | 5 |
| SemanticResolverActor | `src/devac/actors/semantic-resolver.actor.ts` | Batch semantic resolution | 7 |
| ScriptExecutorActor | `src/devac/actors/script-executor.actor.ts` | Validation script runner | 8 |
| ValidationCoordinatorActor | `src/devac/actors/validation-coordinator.actor.ts` | Orchestration | 37 |

---

## Standardized Interfaces

### StructuralParseResult (Canonical Interface)

All structural parsers must return this interface:

```typescript
// src/analyzer/types.ts (add or update)

export interface StructuralParseResult {
  filePath: string;
  nodes: AstNode[];
  relationships: RelationshipInfo[];
  importStrings: string[];           // Unresolved import specifiers
  exportedSymbols: ExportedSymbol[]; // What this file exports
  metadata: {
    parseTime: number;
    nodeCount: number;
    relationshipCount: number;
    loc: number;
    language: string;
  };
}

export interface ExportedSymbol {
  name: string;
  kind: "default" | "named";
  nodeKind: string;
  entityId?: string;
}
```

### Tree-Sitter Adapter

Tree-sitter parsers return `SingleFileParseResult`. Create adapter:

```typescript
// src/pipeline/adapters/tree-sitter-adapter.ts

export function adaptTreeSitterResult(
  result: SingleFileParseResult,
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
      language,
    },
  };
}
```

---

## Two-Phase Parsing Architecture

### Phase 1: Structural (Immediate, <100ms post-debounce)

```
FileChangeEvent (from FileWatcher, 300ms debounce)
    │
    ▼
LanguageRouter (routes by extension)
    │
    ├─► .ts/.tsx/.js/.jsx → StructuralParser (Babel, ~20ms)
    ├─► .py → PythonParser (subprocess, 200-500ms) 
    ├─► .java → JavaParser (tree-sitter, <80ms)
    ├─► .go → GoParser (tree-sitter, <50ms)
    ├─► .c/.cpp/.h → CppParser (tree-sitter, <80ms)
    └─► .cs → CSharpParser (tree-sitter, <70ms)
    │
    ▼
GraphUpdaterActor (atomic Neo4j update)
    │
    ├─► Delete existing file nodes (same transaction)
    ├─► Create new nodes with OWNS relationships
    ├─► Store importStrings on File node (f.pendingImports)
    └─► Store exportedSymbols on File node (f.exportedSymbols)
```

### Phase 2: Semantic (Deferred, batched, TS/JS only)

```
SemanticResolverActor (background queue)
    │
    ├─► Reads f.pendingImports from Neo4j
    ├─► Uses ts-morph to resolve actual file targets
    ├─► Creates IMPORTS relationships
    └─► Sets f.semanticComplete = true
```

### Import Storage Strategy (Addresses Review Critical #2)

GraphUpdaterActor already implements this correctly:

```typescript
// From graph-updater.actor.ts lines 174-182
if (parseResult.importStrings.length > 0) {
  await tx.run(
    `MATCH (f:File {filePath: $filePath})
     SET f.pendingImports = $imports`,
    { filePath, imports: parseResult.importStrings }
  );
}
```

This stores imports on the File node for Phase 2 resolution.

---

## Atomic Updates (Addresses Review Critical #3)

GraphUpdaterActor implements atomic delete-then-insert:

```typescript
// From graph-updater.actor.ts - updateFileData function
const result = await neo4jClient.runTransactionWork(
  async (tx) => {
    // First, safe delete old data (same transaction)
    await safeDeleteFileTx(tx, filePath);
    
    // Then, create new data (same transaction)
    // ... creates File node, child nodes, relationships
  },
  "WRITE",
  "GraphUpdater-Update"
);
```

**File Deletion Handling**: `safeDeleteFile()` function handles `unlink` events.

---

## Error Handling Strategy (Addresses Review #8)

| Error Type | Handler | Behavior |
|------------|---------|----------|
| Parse failure | LanguageRouter | Log error, skip file, don't crash pipeline |
| Neo4j unavailable | GraphUpdaterActor | Retry 3x with backoff, then fail to `failed` state |
| Transaction failure | GraphUpdaterActor | Retry 3x, log error, emit failure event |
| Semantic resolution failure | SemanticResolverActor | Re-queue at end of queue (max 3 attempts) |
| File watcher error | FileWatcher | Emit error event, continue watching |

### Retry Configuration

```typescript
// GraphUpdaterActor already has:
guards: {
  canRetry: ({ context }) => context.retryCount < 3,
}
```

### Queue Retry Limits (Addresses Review #7)

Add to SemanticResolverActor:

```typescript
interface QueueItem {
  filePath: string;
  priority: "high" | "normal";
  queuedAt: Date;
  attempts: number;  // NEW: track retry attempts
}

// In processQueue:
if (item.attempts >= 3) {
  logger.error(`Max retries exceeded for ${item.filePath}, dropping`);
  continue;
}
```

---

## Performance Targets (Clarified - Addresses Review #9)

| Metric | Target | Measurement Point |
|--------|--------|-------------------|
| File change → structural complete | <200ms | Post-debounce (300ms) to Neo4j write complete |
| Structural parse (TS/JS) | <50ms | StructuralParser.parseStructural() |
| Structural parse (tree-sitter) | <100ms | Parser.parseFile() |
| Neo4j atomic update | <50ms | GraphUpdaterActor transaction |
| Semantic batch (10 files) | 2-10s | Acceptable for background processing |

**Note**: FileWatcher uses 300ms debounce. The <200ms target is measured after debounce completes.

---

## Implementation Phases

### Phase 1: Fix TypeScript Errors (Day 1-2)

**1.1 Install missing dependency**
```bash
npm install --save-dev @types/babel__traverse --legacy-peer-deps
```

**1.2 Fix structural-parser.ts (9 errors)**
- Add explicit Babel traverse types
- Fix error handling type

**1.3 Fix semantic-resolver.ts (2 errors)**
- Convert `null` to `undefined` for tsConfigFilePath

**1.4 Fix validation-coordinator.actor.ts (37 errors)**
- Update import paths:
  ```typescript
  // FROM: import { FileChangeEvent } from '../types/file-watcher.js';
  // TO:   import { FileChangeEvent } from '../services/codegraph/file-watcher.js';
  ```

**1.5 Fix XState v5 event typing (24 errors across 4 actors)**
- Add type guards for `xstate.done.actor.*` and `xstate.error.actor.*` events
- Example fix:
  ```typescript
  setResult: assign({
    result: ({ event }) => {
      if ("output" in event) {
        return event.output as ResultType;
      }
      return null;
    },
  }),
  ```

### Phase 2: Integration (Day 3-4)

**2.1 Create LanguageRouter**
```typescript
// src/pipeline/language-router.ts
export class LanguageRouter {
  canHandle(filePath: string): boolean;
  getLanguage(filePath: string): string | null;
  async parse(filePath: string): Promise<StructuralParseResult>;
}
```

**2.2 Create IncrementalPipeline (Addresses Review #4)**
```typescript
// src/pipeline/incremental-pipeline.ts
export class IncrementalPipeline {
  constructor(config: PipelineConfig);
  
  async start(): Promise<void>;
  async stop(): Promise<void>;
  async handleFileChange(event: FileChangeEvent): Promise<void>;
  
  getStats(): PipelineStats;
}

interface PipelineConfig {
  neo4jClient: Neo4jClient;
  workspaceRoot: string;      // Addresses Review #11
  watchPaths: string[];
  ignorePatterns: string[];
  enableSemanticResolution: boolean;
}
```

**2.3 Wire components**
- FileWatcher → IncrementalPipeline.handleFileChange
- LanguageRouter → GraphUpdaterActor
- GraphUpdaterActor → SemanticResolverActor (queue TS/JS files)

### Phase 3: Tree-Sitter Languages (Day 5)

**3.1 Create tree-sitter adapter**
- Implement `adaptTreeSitterResult()` function

**3.2 Add languages to LanguageRouter**
- Java, Go, C/C++, C#

**3.3 Test all languages**

### Phase 4: Python Optimization (Day 6-7)

**4.1 Implement keep-alive process**
- Persistent Python subprocess
- stdin/stdout JSON protocol
- Process lifecycle management

**4.2 Target**: <100ms per Python file

---

## File Changes Summary

### Files to Modify

| File | Changes |
|------|---------|
| `package.json` | Add `@types/babel__traverse` |
| `src/analyzer/structural-parser.ts` | Fix 9 TS errors (add types) |
| `src/analyzer/semantic-resolver.ts` | Fix 2 TS errors (null → undefined) |
| `src/analyzer/types.ts` | Add `StructuralParseResult` interface |
| `src/devac/actors/validation-coordinator.actor.ts` | Fix 37 TS errors (imports, typing) |
| `src/devac/actors/graph-updater.actor.ts` | Fix 4 TS errors (event typing) |
| `src/devac/actors/affected-calculator.actor.ts` | Fix 5 TS errors (event typing) |
| `src/devac/actors/semantic-resolver.actor.ts` | Fix 7 TS errors (typing, args) |
| `src/devac/actors/script-executor.actor.ts` | Fix 8 TS errors (event typing) |

### Files to Create

| File | Purpose |
|------|---------|
| `src/pipeline/language-router.ts` | Route files to parsers |
| `src/pipeline/incremental-pipeline.ts` | Orchestrate incremental updates |
| `src/pipeline/adapters/tree-sitter-adapter.ts` | Adapt tree-sitter results |

---

## Success Criteria

1. **TypeScript compiles**: `tsc --noEmit` → 0 errors
2. **Existing tests pass**: `npm test` → all green
3. **Single file change reflected in Neo4j** within 200ms (post-debounce)
4. **File deletion removes all owned nodes** (no orphans)
5. **SemanticResolver processes queue** without infinite loops
6. **All 8 languages** route to correct parser

---

## Future: Language-Specific Structural Parsers

Per `multi-language-incremental-parsing-support-analysis-plan.md`, future work:

```
src/analyzer/structural-parsers/
├── typescript-structural-parser.ts  (EXISTS - Babel)
├── python-structural-parser.ts      (keep-alive process)
├── java-structural-parser.ts        (optimized tree-sitter)
├── go-structural-parser.ts          (optimized tree-sitter)
├── cpp-structural-parser.ts         (optimized tree-sitter)
├── csharp-structural-parser.ts      (optimized tree-sitter)
└── sql-structural-parser.ts         (tree-sitter)
```

---

## Long-Term Vision: Full CPG + DevAC

End goal: Complete **Code Property Graph (CPG)** for all languages.

| Component | Description | Status |
|-----------|-------------|--------|
| **AST** | Abstract Syntax Tree | ✅ Current focus |
| **CFG** | Control Flow Graph | ❌ Future |
| **PDG** | Program Dependency Graph | ❌ Future |

**DevAC Capabilities** (future):
- OTel Tracing Integration
- Impact Analysis
- Security Analysis
- Performance Profiling
- Test Coverage Mapping

This spec establishes the **incremental foundation** for all future capabilities.
