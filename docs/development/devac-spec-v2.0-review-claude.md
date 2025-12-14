# DevAC/CodeGraph Spec v2.0 Architecture Review

**Reviewer:** Claude (AI Assistant)  
**Date:** 2025-12-13  
**Spec Version Reviewed:** 2.1 (updated 2025-12-13)  
**Status:** DETAILED REVIEW WITH ACTIONABLE CONCERNS

---

## Executive Summary

The v2.0 spec represents a **sound architectural direction** with the shift from Neo4j to DuckDB+Parquet. The federated, file-based approach aligns well with the "source code is truth" principle and eliminates the complex sync issues that plagued v1.x. However, several implementation gaps and unrealistic performance targets require attention before development begins.

**Overall Assessment:** ✅ Proceed with modifications

**Key Risks:**
1. Performance targets are aggressive and may not account for real-world overhead
2. Missing rollback/recovery scenarios for mid-operation failures
3. LanguageRouter→Parser integration undefined at runtime level
4. Python subprocess optimization deferred without fallback plan
5. Cross-branch query complexity underestimated

---

## 1. Feasibility Assessment

### 1.1 Working Components Correctly Identified ✅

The spec correctly identifies these v1.x components as portable:

| Component | Spec Claim | Reality | Verdict |
|-----------|------------|---------|---------|
| TypeScript parser (ts-morph) | Port | Exists in `src/analyzer/parser.ts`, uses ts-morph Project | ✅ Accurate |
| Python parser (subprocess) | Port | Exists in `python_parser.py` + `src/analyzer/python-parser.ts` | ✅ Accurate |
| C/C++, Java, Go, C# parsers | Port (tree-sitter) | All exist in `src/analyzer/parsers/` | ✅ Accurate |
| Entity ID generation | Adapt | Exists in `src/analyzer/parser-utils.ts` | ✅ Accurate |
| Relationship types | Keep | Defined in `src/analyzer/types.ts` | ✅ Accurate |
| File watcher (chokidar) | Keep | Exists in `src/devac/services/codegraph/file-watcher.ts` | ✅ Accurate |

### 1.2 "Broken" Components Correctly Categorized ✅

| Component | Spec Claim | Reality | Verdict |
|-----------|------------|---------|---------|
| Neo4j Client | Remove | `src/database/neo4j-client.ts` - correctly identified for removal | ✅ Accurate |
| NodeIndexCache | Remove | Was proposed in v1.11, never implemented | ✅ Accurate |
| StorageManager | Replace | `src/analyzer/storage-manager.ts` is Neo4j-specific | ✅ Accurate |

### 1.3 Missing Feasibility Considerations ⚠️

**a) DuckDB Node.js Binding Maturity**

The spec assumes `duckdb-async` is production-ready but doesn't address:
- Memory management for large in-memory databases
- Connection pooling (DuckDB Node.js is single-threaded per connection)
- Error recovery when DuckDB enters "fatal mode"

**Recommendation:** Add Phase 1 task: "DuckDB stress test with 50K+ rows, validate memory behavior"

**b) Parquet Write Performance**

The spec assumes "~50-100ms" for package Parquet writes but doesn't account for:
- ZSTD compression CPU overhead
- Multiple concurrent writes (watch mode with multiple file changes)
- File system sync (fsync) overhead

**Recommendation:** Benchmark actual write performance in Phase 1 before committing to targets.

---

## 2. Architecture Assessment

### 2.1 Two-Pass Parsing Design ✅ Sound

The two-pass architecture (Structural → Semantic) is correctly preserved from v1.x:

```
Pass 1: File → AST → Nodes + Edges + External Refs (per-file, parallelizable)
Pass 2: External Refs → Resolved Refs (cross-file, requires index)
```

**Strengths:**
- Clear separation of concerns
- Pass 1 can run in parallel (spec correctly identifies this)
- Pass 2 deferred to Phase 4 (smart - reduces initial complexity)

**Concern:** The spec doesn't define when Pass 2 runs in watch mode:
- On every file change? (expensive)
- On demand? (stale refs)
- Periodic background? (complexity)

**Recommendation:** Add explicit trigger definition for Pass 2 in watch mode.

### 2.2 Component Boundaries ⚠️ Partially Clear

**Well-defined boundaries:**
- SeedWriter (Section 6.4) - clear interface
- StructuralParser (Section 6.2) - clear interface
- LanguageRouter (Section 6.2.1) - clear interface

**Unclear boundaries:**

**a) StorageManager vs SeedWriter**

The spec introduces SeedWriter but doesn't clarify:
- Is SeedWriter a 1:1 replacement for StorageManager?
- What happens to batch processing logic?

Current `StorageManager.saveNodesBatch()` handles batching internally. SeedWriter interface shows single-file operations. **Gap: batch optimization path unclear.**

**b) Parser coordination**

Current `Parser` class in `src/analyzer/parser.ts` orchestrates all language parsers. The spec's `LanguageRouter` is a simpler extension mapping. **Gap: Who owns the ts-morph Project lifecycle in v2.0?**

**Recommendation:** Add component diagram showing SeedWriter, LanguageRouter, and Parser relationships.

### 2.3 Data Model ✅ Solid

The node/edge/external_refs Parquet schema is well-designed:
- `entity_id` without branch (correct - enables cross-branch identity)
- `file_content_hash` for incremental optimization (correct)
- `is_deleted` for delta storage (correct approach for branch deltas)

**Minor concern:** The `scoped_name` generation rules (Section 4.5) are complex. Edge cases like computed properties (`Foo.[key]`) and reassigned variables (`handler$1`) will be tricky to implement correctly.

**Recommendation:** Add unit test examples for each scoped_name case to the spec.

---

## 3. Implementation Phases Assessment

### 3.1 Phase Ordering ✅ Correct

```
Phase 1 (Foundation) → Phase 2 (Incremental) ↘
                                              → Phase 4 (Federation) → Phase 5 (Validation)
Phase 1 (Foundation) → Phase 3 (Python)     ↗
```

The dependency graph is correct:
- Phase 1 must complete before 2 or 3
- Phases 2 and 3 can run in parallel ✅
- Phase 4 requires 2 and 3 ✅
- Phase 5 requires 4 ✅
- Phase 6 (C#) is optional ✅

### 3.2 Phase 1 Task Estimates ⚠️ Optimistic

| Task | Spec Estimate | Realistic Estimate | Notes |
|------|---------------|-------------------|-------|
| DuckDB Node.js setup | 1 day | 1-2 days | Include error handling research |
| Parquet writer | 2 days | 3-4 days | Atomic write complexity underestimated |
| Port TS parser | 3 days | 5-7 days | Entity ID format change touches many callsites |
| Entity ID generation | 1 day | 2-3 days | Scoped name edge cases |
| Performance tests | 2 days | 3-4 days | Need real-world dataset |
| **Total** | 18 days | **25-30 days** | ~50% buffer recommended |

### 3.3 Missing Phase Dependencies ⚠️

**a) Phase 2 depends on branch detection**

The spec assumes `git rev-parse --abbrev-ref HEAD` but doesn't address:
- Detached HEAD state
- Worktrees (multiple checkouts of same repo)
- Submodules

**Recommendation:** Add branch detection utility to Phase 1.

**b) Phase 4 semantic resolution depends on export index**

The resolution algorithm queries "target package's exports" but the export index doesn't exist until all packages are analyzed. **Chicken-and-egg problem for initial analysis.**

**Recommendation:** Document initial analysis flow vs incremental flow separately.

---

## 4. Performance Targets Assessment

### 4.1 Targets Summary

| Operation | Spec Target | Assessment |
|-----------|-------------|------------|
| Hash check (no changes) | <50ms | ✅ Realistic |
| Structural parse (TS) | <50ms/file | ⚠️ Optimistic for large files |
| Structural parse (Python) | <200ms/file | ✅ Realistic (subprocess overhead) |
| Package Parquet write | <100ms | ⚠️ Depends heavily on package size |
| Single file change | <300ms | ⚠️ Aggressive, includes parse+merge+write |
| Batch changes (10 files) | <500ms | ❌ Unlikely without parallelization |

### 4.2 Detailed Analysis

**a) <50ms TypeScript parsing is optimistic**

The existing codebase uses ts-morph with full type checker. The spec mentions "Babel for fast structural parsing" as an alternative, but:
- Babel doesn't provide type information
- Switching to Babel loses export resolution accuracy
- Current `parseFunctions`, `parseClasses`, etc. use ts-morph APIs

**Reality check:** 50ms is achievable for small files (<100 LOC). Files with complex types, generics, or heavy JSX will take 100-300ms.

**Recommendation:** Set realistic target: "p95 <200ms, p50 <50ms"

**b) <300ms single file change is aggressive**

Breakdown of expected time:
- Read file + compute hash: 5-10ms
- Parse with ts-morph: 50-200ms
- Load existing Parquet: 20-50ms
- Merge nodes: 10-20ms
- Write new Parquet (ZSTD): 30-100ms
- **Total:** 115-380ms

The 300ms target is at the optimistic end. **Watch mode UX will suffer if average is 200-300ms.**

**Recommendation:** 
- Target <500ms for watch mode (still feels responsive)
- Target <100ms for "no changes" case (critical for perceived speed)

**c) <500ms for 10 files is unrealistic without parallelization**

If single file = 200-300ms, 10 files sequentially = 2-3 seconds. The spec needs to explicitly state parallel parsing strategy.

**Recommendation:** Add "parallel parse up to 4 files concurrently" to Phase 2.

### 4.3 Recursive CTE Warning ✅ Good

The spec correctly identifies recursive CTE performance degradation at depth >3. The mitigation strategies are appropriate.

---

## 5. Missing Pieces

### 5.1 Error Handling ⚠️ Partially Addressed

**Covered:**
- Parse errors (Section 8.5) - partial results, continue
- Write failures (Section 8.5) - atomic write prevents corruption
- Corruption recovery (Section 8.5) - regenerate from source

**Not covered:**

**a) Mid-operation failures**

What happens if:
- System crashes during `writeParquetAtomic()` after temp file write but before rename?
- Power failure during fsync?

The atomic write pattern handles this (temp file remains, original intact), but **startup should clean orphan .tmp files**.

**Recommendation:** Add to Phase 1: "Orphan temp file cleanup on startup"

**b) Concurrent access conflicts**

The spec mentions file locking (Section 8.5) but:
- Lock timeout is 30s - what if legitimate long operation?
- Stale lock detection via PID - what about container restarts?

**Recommendation:** Add lock file format specification with PID + timestamp + hostname.

**c) Schema migration failures**

Section 5.5 says "Regenerate over migrate" but doesn't specify:
- What if regeneration fails midway?
- What if source code was deleted?

**Recommendation:** Add "graceful degradation" mode - serve stale data with warning.

### 5.2 Rollback Scenarios ❌ Not Addressed

**Missing scenarios:**

| Scenario | Expected Behavior | Currently Specified |
|----------|-------------------|---------------------|
| Failed analysis mid-package | Rollback to previous state | ❌ Not specified |
| Branch switch during analysis | Cancel and restart | ❌ Not specified |
| User cancellation (Ctrl+C) | Clean shutdown, no corruption | ❌ Not specified |
| Disk full during write | Graceful error, no corruption | Partial (atomic write helps) |

**Recommendation:** Add Section 8.6 "Interruption Handling" with explicit behaviors.

### 5.3 Failure Modes ⚠️ Partially Addressed

**Covered:**
- Parse failures → continue with other files ✅
- Write failures → atomic pattern ✅

**Not covered:**

**a) DuckDB connection failures**

DuckDB in-memory connections can fail on:
- Out of memory
- File handle exhaustion
- Thread pool exhaustion

**Recommendation:** Add retry logic with exponential backoff for DuckDB operations.

**b) Filesystem full**

The spec mentions "Check before write, fail gracefully" but:
- How much space to check for?
- What's the error message?
- Can user recover without data loss?

**Recommendation:** Add pre-flight check: "Require 2x estimated Parquet size free"

**c) Python subprocess failures**

Current Python parser spawns subprocess per file. If Python is not installed:
- Silent failure?
- Skip Python files?
- Error to user?

**Recommendation:** Add Python availability check on startup with clear error.

---

## 6. Integration Points Assessment

### 6.1 FileWatcher → LanguageRouter → Parser ⚠️ Needs Clarification

The spec shows:
```
FileChangeEvent → LanguageRouter.getParser() → Parser.parse() → SeedWriter.writeFile()
```

**Existing code shows:**
```typescript
// src/devac/services/codegraph/file-watcher.ts
onEvent: (event: FileChangeEvent) => void  // What calls this?
```

**Gap:** The spec defines the interfaces but not the **orchestrator** that:
1. Receives FileChangeEvent
2. Calls LanguageRouter
3. Manages Parser lifecycle
4. Calls SeedWriter
5. Handles errors

**Recommendation:** Add "AnalysisOrchestrator" component to spec or clarify existing component ownership.

### 6.2 SeedWriter → Parquet ✅ Well-Defined

The atomic write pattern is clear:
1. Write to .tmp
2. Rename to final
3. Fsync directory

**Minor issue:** The `writeParquetAtomic` function signature shows DuckDB Database parameter, but DuckDB connections are ephemeral. **Clarify connection lifecycle.**

### 6.3 Parser → DuckDB (in-memory) → Parquet ⚠️ Partially Defined

The data flow is:
```
Parse AST → Insert into DuckDB tables → COPY to Parquet
```

**Not specified:**
- Table schema creation (CREATE TABLE?) - happens each time?
- Connection pooling - new connection per file?
- Memory limits - what if file produces 100K nodes?

**Recommendation:** Add DuckDB session management section.

### 6.4 Central Hub → Package Seeds ✅ Well-Defined

The federated query pattern using `read_parquet([glob patterns])` is elegant and correct.

### 6.5 MCP Server Integration ⚠️ Spec vs Reality Gap

**Spec says:** MCP tools query DuckDB directly with read_parquet.

**Current code shows:** (`mcp/src/index.ts`)
```typescript
// Returns command to execute externally
return {
  content: [{ type: "text", text: JSON.stringify(commandDetails) }],
  _meta: { requires_execute_command: true }
};
```

The current MCP server **delegates to CLI** rather than querying directly. The spec's MCP integration is a significant rewrite.

**Recommendation:** Clarify MCP migration path - is direct DuckDB query a Phase 5 goal?

---

## 7. Additional Recommendations

### 7.1 Testing Strategy Gaps

The spec's test strategy (Section 15.4) is good but missing:

**a) Integration test for branch switching**
```typescript
describe("branch switching", () => {
  it("updates seeds when branch changes", async () => {
    await git.checkout("feature-branch");
    await devac.analyze("--if-changed");
    // Verify branch/ directory updated
  });
});
```

**b) Chaos testing for concurrent access**
```typescript
describe("concurrent access", () => {
  it("handles simultaneous file changes", async () => {
    await Promise.all([
      writeFile("a.ts"),
      writeFile("b.ts"),
      writeFile("c.ts"),
    ]);
    // Verify no corruption
  });
});
```

### 7.2 Observability Gaps

Section 12.5 covers logging but not:

**a) Metrics export**
- How to integrate with Prometheus/Grafana?
- OpenTelemetry support?

**b) Health checks**
- Is there a `/health` endpoint for MCP server?
- Watch mode heartbeat?

### 7.3 Documentation Gaps

**a) Troubleshooting guide**
- "Seeds out of sync" symptoms and solutions
- "DuckDB query timeout" debugging
- "Python parser fails" resolution

**b) Migration guide for existing users**
- Step-by-step from v1.x to v2.0
- Data migration (if any)

---

## 8. Summary of Required Spec Changes

### Critical (Block Phase 1)

1. **Add orphan temp file cleanup** to Phase 1 tasks
2. **Define AnalysisOrchestrator** component or clarify ownership
3. **Add DuckDB session management** section
4. **Clarify MCP migration path** (direct query vs CLI delegation)

### Important (Address in Phase 1)

5. **Revise performance targets** to realistic p95 values
6. **Add parallel parsing strategy** for batch changes
7. **Define Pass 2 trigger** for watch mode
8. **Add lock file format** specification

### Recommended (Pre-Phase 2)

9. **Add interruption handling** section (Ctrl+C, branch switch)
10. **Add branch detection utility** requirements
11. **Add Python availability check** requirement
12. **Add scoped_name unit test examples**

### Nice-to-Have (Future)

13. Metrics export (OpenTelemetry)
14. Troubleshooting guide
15. Migration guide

---

## 9. Conclusion

The DevAC v2.0 specification is **architecturally sound** and represents a significant improvement over v1.x. The shift to DuckDB+Parquet eliminates the fundamental mismatch between graph queries and point lookups that motivated the NodeIndexCache proposal.

**Proceed with Phase 1** after addressing the critical gaps:
1. Define the orchestration layer
2. Add DuckDB lifecycle management
3. Revise performance targets to realistic values
4. Add error recovery mechanisms

The 18-day Phase 1 estimate should be extended to **25-30 days** to account for:
- Entity ID format migration complexity
- DuckDB integration learning curve
- Real-world performance validation

With these adjustments, the spec provides a solid foundation for implementation.

---

*Review complete. Questions welcome.*
