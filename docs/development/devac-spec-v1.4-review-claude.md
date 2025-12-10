# DevAC Spec v1.4 Architecture Review

**Reviewer**: Claude (AI Architecture Review)  
**Date**: 2025-12-10  
**Spec Version**: 1.4  
**Status**: CONDITIONAL APPROVAL with Required Changes

---

## Executive Summary

The spec is well-structured and implementation-ready for ~80% of the work. However, critical gaps exist in error recovery, component integration details, and performance validation. The 17-day timeline is optimistic given the identified issues.

**Verdict**: Approve with 5 required fixes (P0) and 8 recommended improvements (P1).

---

## 1. Feasibility Analysis

### ✅ Working Components Correctly Identified

| Component | Path Verified | Status |
|-----------|---------------|--------|
| FileWatcher | `src/devac/services/codegraph/file-watcher.ts` | ✅ Exists, well-implemented |
| Neo4jClient | `src/database/neo4j-client.ts` | ✅ Exists, production-ready |
| StructuralParser | `src/analyzer/structural-parser.ts` | ✅ Exists, Babel-based, ~570 LOC |
| SemanticResolver | `src/analyzer/semantic-resolver.ts` | ✅ Exists, ts-morph based |
| StorageManager | `src/analyzer/storage-manager.ts` | ✅ Exists |
| Tree-sitter parsers | `src/analyzer/parsers/*.ts` | ✅ All 8 languages have parsers |

### ⚠️ "Broken" Components Assessment

The spec claims 103 TypeScript errors. **Verified**: Exactly 103 errors exist as of review date.

**Error Distribution Accuracy**:

| File | Spec Claims | Actual | Assessment |
|------|-------------|--------|------------|
| `validation-coordinator.actor.ts` | 37 | ~30 | Close, mostly import + XState typing |
| `semantic-resolver.actor.ts` | 7 | 7 | ✅ Accurate |
| `graph-updater.actor.ts` | 4 | 0 | ❌ **No errors** - spec is outdated |
| `affected-calculator.actor.ts` | 5 | ~3 | Overestimated |

**Issue**: `graph-updater.actor.ts` already uses correct imports (`../../database/neo4j-client.js`). The spec's import fixes for this file are not needed.

### 🔴 Critical Finding: Import Path Inconsistency

The spec says to fix imports FROM:
```typescript
import { Neo4jClient } from "../graph/neo4j-client.js";
```

But `validation-coordinator.actor.ts` line 10 actually imports FROM:
```typescript
import type { Neo4jClient } from "../graph/neo4j-client.js";
```

The correct path is:
```typescript
import type { Neo4jClient } from "../../database/neo4j-client.js";
```

This is a **two-directory jump** (`../..`), not single (`..`). The spec's suggested path `"../../database/neo4j-client.js"` is correct, but the framing is confusing.

---

## 2. Architecture Assessment

### ✅ Two-Phase Parsing Design: SOUND

The structural-then-semantic approach is well-justified:

1. **Structural Phase** (Babel, ~20ms): Fast AST extraction, no type resolution
2. **Semantic Phase** (ts-morph, 2-10s): Background resolution with type checking

**Strength**: The `StructuralParseResult` interface in the spec matches the existing implementation in `structural-parser.ts`. No type drift.

**Strength**: Semantic resolution is correctly designed as async/background - it won't block the file change → graph update path.

### ⚠️ Component Boundary Concerns

#### Problem 1: ValidationCoordinatorActor is a God Object

The coordinator handles:
- Event buffering
- Reconciliation
- Parse dispatch
- Graph updates
- Semantic queueing
- Affected calculation
- Script execution

**Risk**: This violates single-responsibility. A parsing failure could theoretically affect script execution state.

**Recommendation**: Extract reconciliation into a separate `ReconciliationActor` spawned at startup.

#### Problem 2: LanguageRouter is Poorly Positioned

The spec places `LanguageRouter` in `src/pipeline/language-router.ts` but it logically belongs closer to the existing parser infrastructure in `src/analyzer/`.

**Recommendation**: Place at `src/analyzer/language-router.ts` to maintain cohesion with existing parsers.

#### Problem 3: GraphUpdater vs StorageManager Confusion

The spec acknowledges two separate write paths but doesn't explain how they avoid conflicts:

```
Bulk Analysis → StorageManager → Neo4j (batched)
Incremental   → GraphUpdater   → Neo4j (atomic per-file)
```

**Question**: What if a bulk analysis is running when an incremental update arrives? The spec has no mutual exclusion mechanism.

**Required Fix**: Add a write lock or queue that prevents concurrent writes from both paths to the same file.

---

## 3. Implementation Phase Assessment

### ✅ Phase Ordering: Mostly Correct

The dependency chain is sound:
1. Fix TypeScript errors (foundation)
2. Add unified types (required for integration)
3. Add reconciliation (required before production use)
4. Add DELETE handling (required for file removals)
5. Wire tree-sitter (extends capability)

### 🔴 Missing Dependency: Schema Migration

The spec mentions:
```cypher
CREATE INDEX file_project IF NOT EXISTS FOR (f:File) ON (f.projectRoot);
```

But there's no migration step in the timeline. **Phase 2, Day 8** should include:
- Add `projectRoot` index via `--update-schema`
- Backfill existing File nodes with `projectRoot`

Without backfill, reconciliation will fail on existing databases.

### ⚠️ Timeline Risks

| Phase | Days | Risk Assessment |
|-------|------|-----------------|
| Phase 1 (Fix TS) | 5 | 🟢 Achievable - errors are mechanical |
| Phase 2 (Integration) | 5 | 🟡 Tight - reconciliation is complex |
| Phase 3 (Tree-sitter) | 3 | 🟢 Low risk - parsers exist |
| Phase 4 (Polish) | 4 | 🔴 **Insufficient** - no time for edge cases |

**Recommendation**: Add 3 buffer days. Total: 20 days.

---

## 4. Performance Target Assessment

### ⚠️ <150ms for TypeScript: Questionable

The spec claims:
> TypeScript/JavaScript: <150ms (Babel ~20ms + Neo4j ~100ms)

**Reality Check**:

| Operation | Spec Estimate | Realistic Estimate |
|-----------|---------------|-------------------|
| File read (fs) | Not mentioned | 1-5ms |
| Babel parse | 20ms | 15-40ms (varies by file size) |
| Node extraction | Not mentioned | 5-15ms |
| Neo4j delete | Not mentioned | 20-50ms |
| Neo4j create | 100ms | 30-80ms |
| Network latency | Not mentioned | 10-30ms |

**Total realistic**: 80-220ms

The <150ms target is achievable for small files (<500 LOC) but will be exceeded for larger files.

### ✅ Python 400ms: Realistic

The revised 400ms target (without keep-alive) is honest. The subprocess spawn overhead (~100-150ms) makes this unavoidable without worker pooling.

### 🔴 Missing: Cold Start Performance

The spec doesn't address cold start (first file after idle):
- ts-morph Project creation: 200-500ms
- Neo4j connection pool warmup: 50-100ms

**Required Addition**: Specify that first-file latency may be 500ms+, which is acceptable.

---

## 5. Missing Pieces

### 🔴 P0: Required Before Implementation

#### 5.1 Rollback on Partial Failure

The spec shows:
```cypher
// Single atomic transaction for cascade delete
MATCH (f:File {filePath: $filePath})
OPTIONAL MATCH (n) WHERE n.filePath = $filePath AND NOT n:File
DETACH DELETE n
WITH f
DETACH DELETE f
```

**Problem**: If the delete succeeds but the subsequent create fails, the file is gone from the graph with no recovery.

**Required Fix**: Add explicit transaction boundaries:
```typescript
async function updateFileAtomic(filePath: string, parseResult: StructuralParseResult) {
  return neo4jClient.runTransactionWork(async (tx) => {
    // Everything in one transaction - auto-rollback on any failure
    await deleteOldData(tx, filePath);
    await createNewData(tx, filePath, parseResult);
  }, "WRITE", "AtomicUpdate");
}
```

The existing `graph-updater.actor.ts` does this correctly (uses `runTransactionWork`), but the spec's standalone Cypher snippets don't make this clear.

#### 5.2 Queue Overflow Handling

The spec mentions "Queue bounded with overflow handling" but doesn't specify the strategy:
- Drop oldest?
- Drop newest?
- Block producer?
- Backpressure signal?

**Required Fix**: Specify explicit strategy. Recommendation: Drop oldest + log warning.

#### 5.3 File System Race Conditions

The spec's rename detection (100ms window) can miss slow renames or trigger on unrelated add/delete pairs.

**Required Fix**: Add content hash comparison:
```typescript
function detectRename(unlink: FileChangeEvent, add: FileChangeEvent): boolean {
  if (add.timestamp - unlink.timestamp > 100) return false;
  
  // Hash the new file, compare to cached hash of deleted file
  const newHash = await computeHash(add.path);
  const oldHash = this.recentlyDeletedHashes.get(unlink.path);
  
  return newHash === oldHash;
}
```

#### 5.4 Semantic Resolution Dependency Cycles

The SemanticResolver uses this query:
```cypher
OPTIONAL MATCH (f)-[:IMPORTS*1..2]->(dep:File)
```

**Problem**: If A imports B and B imports A (cycle), this could cause infinite processing or duplicate work.

**Required Fix**: Track `semanticInProgress` flag to prevent re-entry:
```cypher
MATCH (f:File {filePath: $path})
WHERE f.semanticComplete = false AND f.semanticInProgress <> true
SET f.semanticInProgress = true
```

#### 5.5 Graceful Shutdown

The spec has no shutdown sequence. What happens to:
- In-flight graph updates?
- Queued semantic resolution?
- Buffered events during reconciliation?

**Required Fix**: Add shutdown state:
```typescript
states: {
  shuttingDown: {
    entry: [
      "flushEventBuffer",
      "waitForInFlightUpdates",
      "persistQueueToDisk"  // Optional: resume on restart
    ],
    after: {
      5000: "stopped"  // Force stop after 5s
    }
  }
}
```

### 🟡 P1: Should Address

#### 5.6 Metrics and Observability

The spec mentions "Basic metrics (queue depth, latency)" on Day 15 but provides no interface. Suggest:

```typescript
interface IncrementalMetrics {
  // Counters
  filesProcessedTotal: number;
  parseErrorsTotal: number;
  graphUpdatesTotal: number;
  
  // Gauges
  eventQueueDepth: number;
  semanticQueueDepth: number;
  
  // Histograms
  parseLatencyMs: Histogram;
  graphUpdateLatencyMs: Histogram;
}
```

#### 5.7 Test Strategy

The spec has no test plan. Minimum required:
- Unit tests for LanguageRouter dispatch logic
- Integration test for reconciliation (mock filesystem)
- Performance test validating <200ms target
- Chaos test: kill process mid-update, verify graph consistency

#### 5.8 Configuration

Several magic numbers need configuration:
- 30s parse timeout (should be configurable)
- 100ms rename detection window (should be configurable)
- 3 retry limit (should be configurable)
- 60s degraded mode auto-recovery (should be configurable)

---

## 6. Integration Point Assessment

### FileWatcher → ValidationCoordinator

**Status**: ✅ Well-defined

The existing FileWatcher emits `FileChangeEvent`:
```typescript
interface FileChangeEvent {
  type: FileChangeType;  // 'add' | 'change' | 'unlink' | 'error'
  path: string;
  timestamp: number;
}
```

This matches the spec's expected input.

**Gap**: FileWatcher has a `batch` field that the spec doesn't address. Should batched events be processed together or individually?

### ValidationCoordinator → LanguageRouter

**Status**: ⚠️ Loosely defined

The spec shows:
```typescript
LanguageRouter.parse(filePath) → StructuralParseResult
```

But doesn't specify:
- How LanguageRouter is instantiated (singleton? per-coordinator?)
- How it gets the workspace root configuration
- Whether it should cache parser instances

**Recommendation**: LanguageRouter should be a singleton injected into ValidationCoordinator at construction.

### LanguageRouter → Parsers

**Status**: ✅ Well-defined

The extension map and parser dispatch are clear. The tree-sitter adapter pattern is sound.

**Gap**: The spec shows StructuralParser for TS/JS but the existing `structural-parser.ts` is Babel-based, not tree-sitter. This is correct but the spec should clarify that TS/JS uses Babel, not tree-sitter.

### GraphUpdater → Neo4j

**Status**: ✅ Well-defined

The existing `graph-updater.actor.ts` already implements atomic delete-then-create within a single transaction. This matches the spec's requirements.

**Verified Code**:
```typescript
const result = await neo4jClient.runTransactionWork(
  async (tx) => {
    // First, safe delete old data (same transaction)
    await safeDeleteFileTx(tx, filePath);
    // Then, create new data (same transaction)
    ...
  },
  "WRITE",
  "GraphUpdater-Update"
);
```

### SemanticResolver → Neo4j

**Status**: ⚠️ Has Issues

The SemanticResolver writes relationships like this:
```typescript
await tx.run(
  `MATCH (source:Node {entityId: $sourceId})
   MATCH (target:Node {entityId: $targetId})
   MERGE (source)-[r:\`${rel.type}\`]->(target)
   ...`
);
```

**Problem**: String interpolation for relationship type (`${rel.type}`) is a Cypher injection risk if `rel.type` comes from untrusted input.

**Required Fix**: Validate relationship types against an enum:
```typescript
const VALID_REL_TYPES = new Set(['CALLS', 'IMPORTS', 'EXTENDS', ...]);
if (!VALID_REL_TYPES.has(rel.type)) {
  throw new Error(`Invalid relationship type: ${rel.type}`);
}
```

---

## 7. Summary of Required Changes

### P0 (Must Fix Before Implementation)

| # | Issue | Section | Fix |
|---|-------|---------|-----|
| 1 | Rollback not explicit in spec | 5.1 | Document transaction guarantees |
| 2 | Queue overflow strategy missing | 5.2 | Specify drop-oldest + warning |
| 3 | Rename detection unreliable | 5.3 | Add content hash comparison |
| 4 | Semantic cycle prevention missing | 5.4 | Add `semanticInProgress` flag |
| 5 | No shutdown sequence | 5.5 | Add `shuttingDown` state |

### P1 (Should Fix)

| # | Issue | Section | Fix |
|---|-------|---------|-----|
| 6 | Schema migration not in timeline | 3 | Add Day 8 migration step |
| 7 | No metrics interface | 5.6 | Add IncrementalMetrics interface |
| 8 | No test strategy | 5.7 | Add test plan section |
| 9 | Magic numbers need config | 5.8 | Extract to configuration |
| 10 | Batch event handling unclear | 6 | Specify batch processing strategy |
| 11 | LanguageRouter instantiation unclear | 6 | Specify singleton pattern |
| 12 | Cypher injection risk | 6 | Add relationship type validation |
| 13 | Cold start latency not documented | 4 | Document 500ms+ first-file latency |

---

## 8. Revised Timeline Recommendation

| Phase | Original | Recommended | Changes |
|-------|----------|-------------|---------|
| Phase 1 | 5 days | 5 days | No change |
| Phase 2 | 5 days | 7 days | +2 for reconciliation complexity |
| Phase 3 | 3 days | 3 days | No change |
| Phase 4 | 4 days | 5 days | +1 for edge cases |
| **Total** | **17 days** | **20 days** | +3 days buffer |

---

## 9. Final Verdict

**CONDITIONAL APPROVAL**

The spec demonstrates strong understanding of the problem domain and proposes a sound architecture. The two-phase parsing approach is correct, the XState actor model is appropriate, and the existing codebase provides a solid foundation.

However, the spec has gaps in error handling, failure recovery, and operational concerns that must be addressed before implementation begins.

**Approval Conditions**:
1. Address all 5 P0 items in a spec addendum (v1.4.1)
2. Add 3 buffer days to timeline
3. Define explicit test strategy before Phase 4

Once these conditions are met, implementation may proceed.

---

*Review completed: 2025-12-10T15:30:32.824Z*
