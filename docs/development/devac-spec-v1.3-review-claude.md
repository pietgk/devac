# DevAC Spec v1.3 Review

> **Reviewer**: Claude (Anthropic)  
> **Date**: 2025-12-10  
> **Spec Version**: 1.3  
> **Status**: DETAILED TECHNICAL REVIEW

---

## Executive Summary

The spec is **well-structured and implementable**, with accurate component identification and realistic timelines. However, there are **critical gaps in error handling, rollback semantics, and integration contract definitions** that need addressing before implementation begins.

**Overall Assessment**: 🟡 **Approved with required revisions**

---

## 1. Feasibility Analysis

### ✅ Working Components (Correctly Identified)

| Component | Verification | Notes |
|-----------|--------------|-------|
| FileWatcher | ✅ Exists at `src/devac/services/codegraph/file-watcher.ts` | Full implementation with debouncing, statistics, Disposable pattern |
| StructuralParser | ✅ Exists at `src/analyzer/structural-parser.ts` | Babel-based, produces `StructuralParseResult` |
| SemanticResolver | ✅ Exists at `src/analyzer/semantic-resolver.ts` | Queue-based batch processing with ts-morph |
| Neo4jClient | ✅ Exists at `src/database/neo4j-client.ts` | Transaction management, connection handling |
| StorageManager | ✅ Exists at `src/analyzer/storage-manager.ts` | Batch MERGE operations |
| Tree-sitter parsers | ✅ All 6 languages present | Java, Go, C/C++, C#, SQL in `src/analyzer/parsers/` |

### ✅ Broken Components (Correctly Identified)

The 103 TypeScript errors are **real and accurately categorized**:

```bash
$ npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
103
```

**Import path errors** (5 modules not found in `validation-coordinator.actor.ts`):
- `../types/file-watcher.js` → should be `../services/codegraph/file-watcher.js`
- `../graph/neo4j-client.js` → should be `../../database/neo4j-client.js`
- `../parsers/structural-parser.js` → should be `../../analyzer/structural-parser.js`
- `../resolution/import-resolver.js` → should be `../../analyzer/parsers/import-resolver.js`
- `../types/package.js` → should be `../../analyzer/parsers/package-extractor.js`

### ⚠️ Missing Feasibility Concern

**XState v5 Migration Complexity**: The spec underestimates XState v5 typing issues. The pattern suggested:

```typescript
if ("output" in event) {
  return event.output as ResultType;
}
```

This **is correct** but the spec doesn't address:
1. **Actor type inference** - `StateMachine<Context, never, ...>` errors require explicit generic parameters
2. **Guard/action string references** - XState v5 strict mode rejects string references in some contexts
3. **Invoke source typing** - `fromPromise` return types need explicit annotation

**Recommendation**: Add 1 day to Phase 1 for XState v5 typing rework.

---

## 2. Architecture Analysis

### ✅ Two-Phase Parsing Design

The structural → semantic split is **sound and proven**:

```
Pass 1 (Structural): Babel/tree-sitter → AstNode[] + RelationshipInfo[]
                     ~20-80ms per file (no type resolution)

Pass 2 (Semantic):   ts-morph mini-project → CALLS, EXTENDS relationships
                     ~2-10s per batch of 10 files (deferred, background)
```

**Strengths**:
- Decouples fast UI feedback from slow type analysis
- Queue-based semantic resolution handles backpressure
- File isolation prevents cascading failures

**Gap**: The spec doesn't define what happens when a file is modified **during** semantic resolution. Current `SemanticResolver.enqueue()` only checks for duplicates, not superseded entries.

### ✅ Component Boundaries

| Boundary | Interface Defined? | Notes |
|----------|-------------------|-------|
| FileWatcher → Coordinator | ✅ `FileChangeEvent` | Well-defined |
| Coordinator → GraphUpdater | ⚠️ Partial | `StructuralParseResult` shape differs between spec and actual code |
| GraphUpdater → Neo4j | ✅ Transaction work | Uses `runTransactionWork` |
| Coordinator → SemanticResolver | ✅ `enqueue(filePath, priority)` | Clean interface |

### ⚠️ Type Mismatch: `StructuralParseResult`

**Spec definition** (line 74-128):
```typescript
interface StructuralParseResult {
  filePath: string;
  nodes: AstNode[];
  relationships: RelationshipInfo[];
  importStrings: string[];
  exportedSymbols: ExportedSymbol[];
  metadata: ParseMetadata;
}
```

**Actual `graph-updater.actor.ts` expects** (line 33-52):
```typescript
type StructuralParseResult = {
  nodes: Array<{
    entityId: string;
    kind: string;
    name: string;
    filePath: string;
    line: number;    // ← Different: uses `line` not `startLine`
    column: number;  // ← Different: uses `column` not `startColumn`
  }>;
  relationships: Array<{
    source: string;  // ← Different: uses `source` not `sourceId`
    target: string;  // ← Different: uses `target` not `targetId`
    type: string;
  }>;
  importStrings: string[];
  exportedSymbols: Array<{ name: string; kind: string }>;  // ← Missing: entityId
};
```

**Impact**: GraphUpdater will fail at runtime if StructuralParser output isn't adapted.

**Recommendation**: Add adapter layer or update GraphUpdater to match spec types.

### ⚠️ Missing: LanguageRouter → Existing Parsers Integration

The spec defines `LanguageRouter` but doesn't address:

1. **Return type normalization**: Existing tree-sitter parsers return `{ nodes: AstNode[], relationships: RelationshipInfo[] }` not `StructuralParseResult`
2. **Import/export extraction**: Tree-sitter parsers don't extract `importStrings` or `exportedSymbols`
3. **Metadata calculation**: Tree-sitter parsers don't return `ParseMetadata`

The `tree-sitter-adapter.ts` stub acknowledges this with empty arrays, but this means **non-TS/JS languages lose import tracking**.

---

## 3. Implementation Phases Review

### Phase 1: Fix TypeScript Errors (Days 1-4) ✅

**Assessment**: Realistic but aggressive.

| Day | Task | Risk |
|-----|------|------|
| Day 1 | Install `@types/babel__traverse`, fix 11 errors | Low |
| Day 2 | Fix 37 coordinator errors | Medium - XState v5 typing is tricky |
| Day 3 | Fix 31 remaining errors | Medium |
| Day 4 | Verify `tsc --noEmit` → 0 | Low |

**Hidden dependency**: `@types/babel__traverse` may have peer dependency issues with existing Babel versions.

### Phase 2: Core Integration (Days 5-8) ⚠️

**Assessment**: Underestimated.

| Day | Task | Risk |
|-----|------|------|
| Day 5 | Add types, create LanguageRouter | Low |
| Day 6 | Add reconciling state | **High** - Reconciliation logic is complex |
| Day 7 | Add mutex, error handling | Medium |
| Day 8 | Wire and test | **High** - Integration failures likely |

**Concern**: Day 6 reconciliation is non-trivial:
- Must handle partial failures (some files sync, some fail)
- Must handle large file counts (could take minutes)
- Must emit progress events for UI feedback

**Recommendation**: Extend Phase 2 to 5 days (Days 5-9).

### Phase 3: Tree-Sitter Languages (Days 9-11) ✅

**Assessment**: Realistic.

Parsers already exist and work. Main task is wiring through `LanguageRouter`.

### Phase 4: Polish & Testing (Days 12-15) ✅

**Assessment**: Appropriate buffer.

---

## 4. Performance Targets Analysis

### Structural Phase Targets

| Language | Spec Target | Realistic? | Notes |
|----------|-------------|------------|-------|
| TypeScript | <150ms | ✅ Yes | Babel is fast (~20ms), Neo4j write is the bottleneck |
| JavaScript | <150ms | ✅ Yes | Same as TS |
| Java | <200ms | ✅ Yes | tree-sitter-java is well-optimized |
| Go | <150ms | ✅ Yes | tree-sitter-go is fast |
| C/C++ | <200ms | ⚠️ Borderline | Large header files can be slow |
| C# | <200ms | ✅ Yes | tree-sitter-c-sharp is decent |
| Python | <300ms | ❌ Optimistic | Python subprocess spawn is ~150-200ms alone |

**Python Reality Check**:
```
Subprocess spawn:     ~150ms (fork + exec)
Python AST parse:     ~20-50ms
JSON serialization:   ~10-20ms
Total:                ~180-270ms (best case)
```

For 300ms target to be achievable, Python must be warm (keep-alive). Without keep-alive, 400-500ms is more realistic.

### Neo4j Write Overhead

The spec assumes ~100ms for Neo4j writes. This is **accurate for small files** but scales:

| Nodes | Relationships | Expected Write Time |
|-------|---------------|---------------------|
| 10 | 5 | ~50ms |
| 50 | 30 | ~100ms |
| 200 | 150 | ~300ms |
| 500 | 400 | ~800ms |

**Large files** (500+ nodes) will exceed targets. Consider:
- Batch size tuning
- Async write acknowledgment (optimistic UI update)

### Semantic Phase Targets

| Metric | Spec Target | Realistic? |
|--------|-------------|------------|
| Batch of 10 files | 2-10s | ✅ Yes |
| Queue backpressure | 500 items | ⚠️ May need tuning |

**Concern**: If structural updates outpace semantic resolution, queue will grow unbounded. The spec's `dropOldest` overflow behavior means **stale semantic data** for rapidly changing files.

---

## 5. Missing Pieces

### ❌ Critical: Rollback Semantics

**Scenario**: GraphUpdater deletes old nodes, then fails to create new ones.

**Current behavior** (`graph-updater.actor.ts` line 147-256):
```typescript
// Uses single transaction for entire operation (atomic)
const result = await neo4jClient.runTransactionWork(async (tx) => {
  // First, safe delete old data (same transaction)
  await safeDeleteFileTx(tx, filePath);
  // Then, create new data (same transaction)
  ...
});
```

This is **correct** - Neo4j transaction rollback handles failures. But the spec doesn't document this clearly.

**Recommendation**: Add "Atomicity Guarantees" section to spec.

### ❌ Critical: Error Propagation

**Scenario**: StructuralParser returns `ParseError` (syntax error).

**Current behavior**: GraphUpdater is never invoked. File retains stale data.

**Spec behavior** (line 330-340):
```cypher
MATCH (f:File {filePath: $path})
SET f.parseError = $error,
    f.parseErrorAt = datetime(),
    f.structuralComplete = false
```

**Gap**: Who calls this? The spec says "On parse error, update File node" but doesn't show the orchestration.

**Recommendation**: Add error handling state to ValidationCoordinatorActor machine.

### ❌ Missing: File Deletion Cascade

**Scenario**: File is deleted (`unlink` event).

**Current behavior** (`graph-updater.actor.ts`): No explicit delete handling.

**Spec reference** (line 105): `In Neo4j but not disk → DELETE from graph`

**Implementation gap**: The reconciliation phase handles this, but what about real-time deletes during watching? The spec's `changeType` includes "unlink" but GraphUpdater only has "UPDATE" event.

**Recommendation**: Add "DELETE" event to GraphUpdaterActor.

### ❌ Missing: Concurrent File Modification

**Scenario**: User saves file, semantic resolution starts, user saves again.

**Spec solution** (line 276-306): Per-file mutex with sequence numbers.

**Gap**: Mutex is described in prose but not integrated into ValidationCoordinatorActor machine. Where does `ConcurrencyState` live? Who increments sequence numbers?

**Recommendation**: Add `ConcurrencyState` to context, add sequence check guards.

### ⚠️ Partial: Startup Reconciliation

The spec describes reconciliation but doesn't address:

1. **Progress reporting**: No events for UI feedback during potentially long reconciliation
2. **Cancellation**: What if user quits during reconciliation?
3. **Partial failure**: What if 10 of 100 files fail to sync?

### ⚠️ Missing: Health Checks

No mechanism to verify:
- Neo4j connection health
- FileWatcher health
- Queue health (size, throughput)

---

## 6. Integration Points Review

### FileWatcher → ValidationCoordinator ✅

**Interface**: `FileChangeEvent`
```typescript
interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink' | 'error';
  path: string;
  timestamp: number;
  batch?: FileChangeEvent[];
  error?: Error;
}
```

**Well-defined**: Event types, timestamps, batch grouping all present.

### ValidationCoordinator → LanguageRouter ⚠️

**Gap**: LanguageRouter doesn't exist yet. Spec defines interface but:
- No error contract (what happens on unsupported file type?)
- No timeout handling (what if parser hangs?)

**Recommendation**: Add 30s timeout wrapper to `LanguageRouter.parse()`.

### LanguageRouter → Parsers ⚠️

**Gap**: StructuralParser and tree-sitter parsers have **different return types**.

```typescript
// StructuralParser returns:
StructuralParseResult { nodes, relationships, importStrings, exportedSymbols, metadata }

// Tree-sitter parsers return:
{ nodes: AstNode[], relationships: RelationshipInfo[] }
```

The adapter in the spec (`adaptTreeSitterResult`) handles this, but loses semantic information.

### GraphUpdater → StorageManager ❌

**Gap**: GraphUpdater uses `runTransactionWork` directly, bypassing StorageManager.

This is **intentional** (atomic delete+create) but creates two code paths for Neo4j writes:
1. Bulk analysis → StorageManager.saveNodesBatch()
2. Incremental → GraphUpdater.updateFileData()

**Risk**: Schema/constraint mismatches between paths.

**Recommendation**: Document this intentional divergence or unify.

### SemanticResolver → RelationshipResolver ✅

**Well-defined**: SemanticResolver creates mini ts-morph project, calls RelationshipResolver.resolveRelationships().

---

## 7. Recommendations Summary

### Must Fix Before Implementation

1. **Unify StructuralParseResult type** - Reconcile spec, StructuralParser, and GraphUpdater definitions
2. **Add DELETE event to GraphUpdater** - Handle file unlink during watching
3. **Define error handling flow** - Add `parseErrorHandling` state to coordinator
4. **Add reconciliation progress events** - UI needs feedback during startup sync

### Should Fix During Implementation

5. **Add 30s timeout to LanguageRouter.parse()** - Prevent hanging parsers
6. **Revise Python target to 400ms** - Or implement keep-alive
7. **Add ConcurrencyState to coordinator context** - Implement mutex properly
8. **Document StorageManager vs GraphUpdater divergence** - Or unify

### Nice to Have (Future Version)

9. **Health check endpoints** - Monitor Neo4j, FileWatcher, queue
10. **Distributed tracing** - OTel integration as noted
11. **Graph versioning** - Enable rollback to previous state

---

## 8. Revised Timeline

| Phase | Original | Revised | Delta |
|-------|----------|---------|-------|
| Phase 1: TypeScript | 4 days | 5 days | +1 (XState complexity) |
| Phase 2: Integration | 4 days | 5 days | +1 (reconciliation) |
| Phase 3: Tree-sitter | 3 days | 3 days | 0 |
| Phase 4: Polish | 4 days | 4 days | 0 |
| **Total** | **15 days** | **17 days** | **+2 days** |

---

## Appendix: Verified File Locations

```
src/
├── analyzer/
│   ├── structural-parser.ts       ✅ Exists, working
│   ├── semantic-resolver.ts       ✅ Exists, working
│   ├── storage-manager.ts         ✅ Exists, working
│   ├── types.ts                   ✅ Exists, needs extension
│   └── parsers/
│       ├── java-parser.ts         ✅ tree-sitter
│       ├── go-parser.ts           ✅ tree-sitter
│       ├── c-cpp-parser.ts        ✅ tree-sitter
│       ├── csharp-parser.ts       ✅ tree-sitter
│       ├── sql-parser.ts          ✅ tree-sitter
│       └── import-resolver.ts     ✅ Exists
├── database/
│   └── neo4j-client.ts            ✅ Exists, working
├── devac/
│   ├── actors/
│   │   ├── validation-coordinator.actor.ts  ⚠️ 37 errors
│   │   ├── graph-updater.actor.ts           ⚠️ 4 errors
│   │   ├── affected-calculator.actor.ts     ⚠️ 5 errors
│   │   ├── semantic-resolver.actor.ts       ⚠️ 7 errors
│   │   └── script-executor.actor.ts         ⚠️ 8 errors
│   ├── services/
│   │   ├── codegraph/
│   │   │   └── file-watcher.ts    ✅ Exists, working
│   │   └── validation-coordinator.service.ts ⚠️ 19 errors
│   └── utils/
│       ├── performance-monitor.ts ⚠️ 7 errors
│       └── query-profiler.ts      ⚠️ 5 errors
└── pipeline/                      ❌ Does not exist (to be created)
    ├── language-router.ts         ❌ To be created
    └── adapters/
        └── tree-sitter-adapter.ts ❌ To be created
```

---

**Review completed**: 2025-12-10T15:00:00Z
