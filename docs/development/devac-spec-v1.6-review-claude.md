# DevAC Spec v1.6 Review

**Reviewer**: Claude  
**Date**: 2025-12-10  
**Document**: `docs/development/devac-spec-v1.6.md`

---

## Executive Summary

The spec is **implementation-viable** with the narrowed scope. The Phase 0 verification approach is a critical improvement over previous iterations. However, several practical implementation challenges need addressing before execution begins.

**Verdict**: Proceed with Phase 0, but address gaps identified below.

---

## 1. Feasibility Analysis

### 1.1 Working Components (Correctly Identified ✓)

| Component | Status | Notes |
|-----------|--------|-------|
| `FileWatcher` | ✓ Working | Verified: chokidar-based, debouncing, Disposable pattern |
| `GraphUpdaterActor` | ✓ Working | Verified: XState v5, atomic delete+create, retry logic |
| `AffectedCalculatorActor` | ✓ Working | Verified: LRU cache, Neo4j queries, proper typing |
| `SemanticResolverActor` | ⚠️ Mostly Working | Has 8 TS errors; core logic sound |
| `StructuralParser` | ✓ Working | Babel-based, <200ms target feasible |

### 1.2 Broken Components (Correctly Categorized ✓)

| Component | Error Count | Assessment |
|-----------|-------------|------------|
| `validation-coordinator.actor.ts` | ~37 errors | **Understated**: Import paths + XState v5 typing + closure scope issues |
| `script-executor.actor.ts` | 8 errors | Accurate |
| `semantic-resolver.actor.ts` | 8 errors | Slightly understated (spec says 7) |

### 1.3 Error Count Discrepancy

**Spec claims**: 103 TypeScript errors  
**Actual verified**: 103 errors (confirmed via `tsc --noEmit | grep -c "error TS"`)  

**Assessment**: Error count is accurate.

### 1.4 Missing/Unverified Items

The spec identifies missing types but doesn't quantify the work:

```typescript
// These don't exist and must be created:
import type { ImportResolver } from "../resolution/import-resolver.js";  // MISSING
import type { PackageInfo } from "../types/package.js";                   // MISSING
```

**Found alternatives**:
- `ImportResolver` exists at `src/analyzer/parsers/import-resolver.ts`
- `PackageInfo` exists at `src/analyzer/parsers/package-extractor.ts` and `src/devac/actors/affected-calculator.actor.ts`

**Recommendation**: Import paths need mapping, not type creation.

---

## 2. Architecture Analysis

### 2.1 Two-Phase Parsing Design

**Assessment**: Sound.

```
Pass 1 (Structural): FileChange → Babel AST → Nodes + Import Strings
Pass 2 (Semantic):   Queue → ts-morph mini-project → Relationship Resolution
```

**Strengths**:
- Structural phase uses Babel (fast, no type resolution)
- Semantic phase is deferred/queued (non-blocking)
- Clear separation of concerns

**Concerns**:
1. **Memory pressure**: `SemanticResolverActor` creates a new `ts-morph` Project per batch. For large batches in monorepos, this could cause OOM.
2. **tsconfig discovery**: `findNearestTsConfig()` called per batch—could be cached.

### 2.2 Component Boundaries

| Boundary | Definition | Assessment |
|----------|------------|------------|
| FileWatcher → Coordinator | `FileChangeEvent` | ✓ Well-defined |
| Coordinator → Parser | `filePath: string` | ✓ Simple |
| Parser → GraphUpdater | `StructuralParseResult` | ⚠️ Type mismatch (spec acknowledges) |
| GraphUpdater → Semantic | `ENQUEUE` event | ✓ Clear |

**Critical Gap**: The adapter pattern for `StructuralParseResult` is proposed but not implemented. The spec shows the adapter code but doesn't estimate implementation time.

### 2.3 XState v5 Issues

The spec correctly identifies XState v5 typing issues. Pattern shown is correct:

```typescript
// Correct fix pattern:
actions: {
  setResult: assign({
    result: ({ event }) => {
      if (event.type === "xstate.done.actor.performUpdate") {
        return event.output as ResultType;
      }
      return null;
    },
  }),
}
```

**However**: The `validation-coordinator.actor.ts` has additional issues not covered:

1. **Closure scope**: The machine uses `this.neo4jClient` inside `setup()` which may not work correctly
2. **Actor registration**: `actors: { graphUpdater: graphUpdaterActor }` may not match invoke expectations
3. **Input typing**: `invoke.input` functions have implicit `any` types

---

## 3. Implementation Phase Analysis

### 3.1 Phase Dependencies

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
   │           │           │           │
   │           │           │           └── Tree-sitter adapters
   │           │           └── LanguageRouter, GraphUpdater DELETE
   │           └── @types/babel__traverse, XState fixes
   └── Verify imports, find missing types
```

**Assessment**: Correctly ordered. Each phase depends on prior completion.

### 3.2 Timeline Realism

| Phase | Spec Days | Assessment | Risk |
|-------|-----------|------------|------|
| Phase 0 | 2 days | Realistic | Low |
| Phase 1 | 5 days | **Optimistic** | Medium - XState v5 fixes often cascade |
| Phase 2 | 7 days | Realistic | Medium |
| Phase 3 | 4 days | Realistic | Low - tree-sitter adapters are mechanical |
| Phase 4 | 4 days | **Buffer may be consumed** | High |

**Recommendation**: Add 2-3 buffer days to Phase 1. XState v5 typing issues tend to reveal more issues as you fix them.

### 3.3 Critical Path Items

1. **Day 3**: `@types/babel__traverse` installation - blocking for structural parser
2. **Day 7**: Zero TS errors gate - non-negotiable
3. **Day 14**: End-to-end test - reveals integration issues

---

## 4. Performance Targets

### 4.1 Target Analysis

| Metric | Target | Assessment |
|--------|--------|------------|
| Structural parse | <200ms | ✓ **Achievable** - Babel is fast |
| Graph update | <100ms | ⚠️ **Risky** - Neo4j transaction overhead |
| Total per-file | <300ms | ⚠️ **Risky** - cumulative |

### 4.2 Neo4j Transaction Overhead

Looking at `graph-updater.actor.ts`:

```typescript
// Single transaction, but multiple queries:
await tx.run(...); // Delete
await tx.run(...); // Create File
await tx.run(...); // Create nodes (UNWIND)
await tx.run(...); // Create OWNS
await tx.run(...); // Create relationships (loop!)
await tx.run(...); // Store imports
await tx.run(...); // Store exports
```

**Issue**: The relationship creation loop (`for (const rel of parseResult.relationships)`) runs a separate query per relationship. For files with 50+ relationships, this adds significant latency.

**Recommendation**: Batch relationship creation:
```typescript
// Group by type, then UNWIND
await tx.run(`
  UNWIND $rels AS rel
  MATCH (source:Node {entityId: rel.source})
  MATCH (target:Node {entityId: rel.target})
  CALL apoc.create.relationship(source, rel.type, {phase: "structural"}, target)
  YIELD rel as r
  RETURN count(r)
`, { rels: parseResult.relationships });
```

### 4.3 Realistic Targets

| Metric | Spec Target | Realistic Target |
|--------|-------------|------------------|
| Small file (<100 LOC) | <300ms | ✓ Achievable |
| Medium file (100-500 LOC) | <300ms | ~400-500ms |
| Large file (>500 LOC) | <300ms | ~800ms-1.5s |

---

## 5. Missing Pieces

### 5.1 Error Handling Gaps

| Scenario | Spec Coverage | Recommendation |
|----------|---------------|----------------|
| Parse error (syntax) | ✓ `handleParseError` state | Adequate |
| Neo4j connection lost | ❌ Not addressed | Add reconnection logic |
| File deleted during parse | ❌ Not addressed | Check file existence before parse |
| Out of memory | ❌ Not addressed | Add heap monitoring |
| Concurrent file changes (same file) | ⚠️ Partial | Per-file mutex mentioned but not designed |

### 5.2 Rollback Scenarios

**Spec says**: "Transaction rollback" (from v1.5)

**Reality check**: Neo4j transactions are atomic, but the spec doesn't address:

1. **Partial batch failure**: If node creation succeeds but relationship creation fails, nodes exist without relationships
2. **Semantic phase failure**: File marked `semanticQueued=true` but semantic processing fails—stuck state

**Recommendation**: Add explicit rollback/recovery states:
```
degraded → RECOVER → scanning (re-scan for stuck files)
```

### 5.3 Failure Modes Not Addressed

1. **Parser timeout**: Babel can hang on malformed files. Add `Promise.race` with timeout.
2. **APOC missing**: `apoc.create.addLabels` is used but APOC might not be installed.
3. **Index missing**: Queries use `USING INDEX` hints but indexes might not exist.

### 5.4 Graceful Shutdown

**Spec says**: "Added in Phase 4 if time permits"

**Problem**: Without graceful shutdown, in-flight transactions may corrupt graph state.

**Minimum viable**:
```typescript
process.on('SIGTERM', async () => {
  coordinator.send({ type: 'STOP' });
  await new Promise(r => setTimeout(r, 5000)); // Drain timeout
  process.exit(0);
});
```

---

## 6. Integration Points

### 6.1 FileWatcher → ValidationCoordinator

**Spec design**:
```
FileWatcher.onEvent → coordinator.send({ type: "FILE_CHANGED", event })
```

**Gap**: No backpressure mechanism. If coordinator is processing, events queue unboundedly.

**Current implementation**:
```typescript
// validation-coordinator.actor.ts
FILE_CHANGED: [
  { guard: "isProcessing", actions: "queueFileChange" },
  { target: "processing" }
]
```

This queues but has no limit. Add:
```typescript
guards: {
  queueNotFull: ({ context }) => context.processingQueue.length < 100,
}
```

### 6.2 LanguageRouter → Parser

**Spec proposes**:
```typescript
class LanguageRouter {
  async parse(filePath: string): Promise<ParseResult>
}
```

**Missing**:
1. Parser instance caching (creating new `StructuralParser` per file is wasteful)
2. Tree-sitter grammar loading (should be lazy-loaded)
3. Error normalization (different parsers throw different errors)

### 6.3 Parser → StorageManager

**Gap**: Spec doesn't mention `StorageManager`. It's bypassed—`GraphUpdaterActor` writes directly.

This is fine for incremental updates, but creates two paths:
- Batch analysis: `Parser → StorageManager → Neo4j`
- Incremental: `Parser → GraphUpdaterActor → Neo4j`

**Recommendation**: Document this divergence. May cause schema drift.

### 6.4 Neo4j Client Lifecycle

**Current**: `Neo4jClient` passed as dependency injection.

**Gap**: No health check. If Neo4j goes down, actors will fail silently until retry exhaustion.

**Recommendation**: Add liveness probe:
```typescript
setInterval(() => neo4jClient.runTransaction('RETURN 1', {}, 'READ', 'HealthCheck'), 30000);
```

---

## 7. Additional Recommendations

### 7.1 Pre-Implementation Checklist

Before Phase 1:

- [ ] Verify APOC is installed: `RETURN apoc.version()`
- [ ] Verify indexes exist: `SHOW INDEXES`
- [ ] Verify Neo4j version: `CALL dbms.components()` (need 5.x for some syntax)
- [ ] Run `npm install --save-dev @types/babel__traverse --legacy-peer-deps`

### 7.2 Test Strategy Gap

**Spec mentions**: "Full test suite: `npm test`"

**Gap**: No unit tests for new components (LanguageRouter, adapters).

**Recommendation**: Add to Phase 2:
- `language-router.spec.ts`
- `parse-result-adapter.spec.ts`

### 7.3 Observability

**Spec mentions**: "In-memory metrics only"

**Minimum viable**: Add structured logging:
```typescript
logger.info('file.processed', { 
  filePath, 
  parseTime, 
  nodesCreated,
  phase: 'structural'
});
```

### 7.4 Type Mismatch Resolution

The adapter approach is correct. Implementation note:

```typescript
// The actual StructuralParser returns:
interface ParserOutput {
  nodes: AstNode[];          // Has startLine, startColumn
  relationships: RelationshipInfo[];  // Has sourceId, targetId
}

// GraphUpdater expects:
interface GraphUpdaterInput {
  nodes: { line, column }[];     // Different property names
  relationships: { source, target }[];
}
```

The adapter is simple but must be tested for edge cases:
- `startLine` is 0 (file-level nodes)
- `sourceId` is undefined (orphaned relationships)

---

## 8. Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| XState v5 fixes cascade | Medium | High | Buffer days in Phase 1 |
| Neo4j latency exceeds target | High | Medium | Batch relationship creation |
| Memory pressure on large batches | Medium | High | Limit batch size, add heap monitoring |
| Missing APOC | Low | High | Pre-check in Phase 0 |
| Spec-implementation drift | Medium | Medium | Phase 0 verification |

---

## 9. Conclusion

### Strengths

1. Phase 0 verification is a significant improvement
2. Narrowed scope (defer validation execution) is pragmatic
3. Type mismatch acknowledged with concrete adapter solution
4. Error count is accurate

### Gaps to Address

1. **Add** Neo4j health check and reconnection logic
2. **Add** per-file mutex design (not just mention)
3. **Add** heap monitoring for semantic batches
4. **Extend** Phase 1 timeline by 2-3 days
5. **Batch** relationship creation in GraphUpdater
6. **Document** batch vs incremental path divergence

### Recommended Phase 0 Additions

1. Verify APOC installation
2. Verify required indexes exist
3. Map ALL import paths (not just 5 shown)
4. Measure baseline Neo4j transaction latency
5. Create test file set for each supported language

---

**Overall Assessment**: Spec is 85% ready. Address gaps above before implementation.
