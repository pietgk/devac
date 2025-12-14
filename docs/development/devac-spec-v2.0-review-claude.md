# DevAC/CodeGraph Specification v2.0 - Architecture Review

**Reviewer:** Claude (Anthropic)  
**Date:** 2025-12-14  
**Spec Version:** 2.0/2.1  
**Review Scope:** Feasibility, Architecture, Implementation Phases, Performance, Missing Pieces, Integration Points

---

## Executive Summary

The v2.0 spec represents a **well-reasoned architectural pivot** from Neo4j to DuckDB+Parquet. The federated, file-based approach solves real problems exposed by v1.x (NodeIndexCache overhead, complex sync logic). The design is sound for single-developer/team use cases.

**Overall Assessment: Feasible with caveats**

| Area | Rating | Notes |
|------|--------|-------|
| Architecture Soundness | ✅ Strong | Two-pass design is proven, DuckDB is excellent choice |
| Component Boundaries | ⚠️ Needs Work | FileWatcher→Parser handoff underspecified |
| Phase Dependencies | ✅ Correct | Critical path identified correctly |
| Performance Targets | ⚠️ Aggressive | <200ms warm achievable; <100ms is stretch goal |
| Error Handling | ❌ Gaps | Partial writes, corruption detection need detail |
| Integration Points | ⚠️ Partial | Some handoffs well-defined, others vague |

---

## 1. Feasibility Analysis

### 1.1 Working Components Correctly Identified ✅

The spec correctly identifies what to preserve from v1.x:

| Component | v1.x Status | Spec Assessment | My Assessment |
|-----------|-------------|-----------------|---------------|
| TypeScript parser (ts-morph) | Working | Port | ✅ Correct |
| Python parser (subprocess) | Working | Port | ✅ Correct |
| StructuralParser (Babel) | Working | Port | ✅ Correct - fast path exists |
| FileWatcher (chokidar) | Working | Keep | ✅ Correct |
| Test fixtures | Working | Keep | ✅ Correct |

**Evidence from codebase:**
- `src/analyzer/structural-parser.ts` - Babel-based, already produces nodes/relationships
- `src/analyzer/python-parser.ts` - subprocess model working
- `src/devac/services/codegraph/file-watcher.ts` - Disposable pattern, debouncing, complete

### 1.2 "Broken" Components Correctly Categorized ✅

| Component | Spec Decision | My Assessment |
|-----------|---------------|---------------|
| Neo4j client | Remove | ✅ Correct |
| NodeIndexCache | Remove | ✅ Correct - was a symptom of wrong DB choice |
| StorageManager | Replace | ✅ Correct - Neo4j-specific |
| XState Actors | Simplify | ⚠️ Partially - current code doesn't show XState usage |

### 1.3 Technology Choices Validated

**DuckDB + Parquet:** Excellent choice for this use case:
- Columnar storage ideal for analytical queries (find all functions, cross-file refs)
- Native Parquet support eliminates ETL
- In-process - no server deployment
- Handles 100K+ rows efficiently

**Concern:** DuckDB's Node.js bindings (`duckdb-async`) are less mature than Python bindings. Edge cases around connection pooling and error recovery need careful testing.

### 1.4 Feasibility Risks

| Risk | Severity | Mitigation in Spec | Additional Mitigation Needed |
|------|----------|-------------------|------------------------------|
| DuckDB memory limits | Medium | ✅ 512MB default config | Add OOM handling guidance |
| Parquet corruption | Medium | ✅ Atomic writes | Need integrity check on read |
| Python parser latency | Low | ✅ Accept 200-500ms | Long-running worker optional |
| Windows file locking | High | ✅ Deferred to Phase 4+ | ✅ Acceptable |

---

## 2. Architecture Analysis

### 2.1 Two-Phase Parsing Design ✅ Sound

```
Pass 1 (Structural) ──► Pass 2 (Semantic)
       │                      │
   Per-file              Cross-file
   Parallel              Batched
   <50ms                 Deferred
```

This is the correct architecture. Evidence:
- Structural pass is embarrassingly parallel
- Semantic resolution (imports → exports) fundamentally requires cross-file knowledge
- The spec correctly defers resolution to save time on initial parse

**Observation from existing code:** The current `StructuralParser` class already implements this pattern:
```typescript
// src/analyzer/structural-parser.ts line 26-39
export interface StructuralParseResult {
  filePath: string;
  nodes: AstNode[];
  relationships: RelationshipInfo[];
  importStrings: string[];           // ← Unresolved imports
  exportedSymbols: ExportedSymbol[]; // ← For resolution
  // ...
}
```

The spec's `externalRefs` schema aligns with `importStrings` conceptually.

### 2.2 Component Boundaries Analysis

#### Well-Defined ✅

| Interface | Definition Quality | Notes |
|-----------|-------------------|-------|
| LanguageParser | ✅ Clear | `parse(filePath): Promise<StructuralParseResult>` |
| SeedWriter | ✅ Clear | Atomic write pattern specified |
| DuckDBPool | ✅ Clear | Acquire/release semantics |

#### Underspecified ⚠️

| Interface | Gap | Recommendation |
|-----------|-----|----------------|
| FileWatcher → LanguageRouter | How events map to parse calls | Add event dispatcher interface |
| LanguageRouter → Parser | Single file vs batch parse API | Clarify when to use each |
| Parser → StorageManager | Streaming vs batch write | Spec mentions streaming but no interface |
| Error propagation | Where errors bubble to | Add error channel design |

### 2.3 Per-Package-Per-Branch Partitioning ✅ Correct

The change from per-file to per-package partitioning was the right call:

**Per-file (rejected):**
```
5000 source files × 3 Parquet files = 15,000 files
DuckDB glob scan: ~500ms overhead
```

**Per-package (adopted):**
```
1 package × 6 files (base + branch) = 6 files
DuckDB scan: ~10ms
```

### 2.4 Entity ID Design ⚠️ Minor Concern

The scoped name approach is correct for stability:
```
{repo}:{package}:{kind}:{scope_hash}
```

**Concern:** The spec says scope_hash = `sha256(filePath + scopedName + kind)` but doesn't specify:
- Encoding (UTF-8?)
- Separator characters between components
- Handling of special characters in file paths (Windows backslashes)

**Recommendation:** Add an explicit normalization step:
```typescript
function normalizeForHash(filePath: string): string {
  return filePath.replace(/\\/g, '/').normalize('NFC');
}
```

### 2.5 Delta Storage Strategy ✅ Sound

```
base/   ← Full package content for main branch
branch/ ← Delta for current working branch
```

The UNION ALL query pattern is correct:
```sql
SELECT * FROM branch WHERE NOT is_deleted
UNION ALL  
SELECT * FROM base WHERE file_path NOT IN (SELECT file_path FROM branch)
```

**Concern:** The `is_deleted` flag adds complexity. Consider:
- What happens if a file is deleted and re-added?
- How to garbage collect old deleted markers?

**Recommendation:** Add periodic compaction (merge branch into base on PR merge).

---

## 3. Implementation Phases Analysis

### 3.1 Phase Dependencies ✅ Correctly Identified

```
Phase 1 (Foundation)
    ↓
Phase 2 (Incremental) ←→ Phase 3 (Python) [Parallel OK]
    ↓
Phase 4 (Federation)
    ↓
Phase 5 (Validation/MCP)
    ↓
Phase 6 (C#) [Optional]
```

The spec correctly identifies:
- Phase 1 is blocking everything
- Phases 2 and 3 can run in parallel (different concerns)
- Phase 4 needs 2 & 3 complete for cross-language resolution

### 3.2 Phase 1 Task Estimates ⚠️ Optimistic

| Task | Spec Estimate | My Estimate | Delta |
|------|---------------|-------------|-------|
| DuckDB Node.js setup | 1 day | 1.5 days | Account for duckdb-async quirks |
| Parquet writer | 2 days | 2 days | ✅ |
| Atomic write infrastructure | 1 day | 2 days | Edge cases (fsync failures, temp file cleanup) |
| Port TS parser | 3 days | 4 days | Need to adapt entity ID generation |
| Error handling framework | 1 day | 2 days | Needs more design upfront |
| **Total** | 18 days | 22-24 days | +20-30% buffer |

### 3.3 Critical Path Risk

The spec's critical path is:
```
Phase 1 → Phase 2 → Phase 4 → Phase 5
```

**Risk:** Phase 2 (incremental updates) depends on understanding the update patterns that emerge from Phase 1. If Phase 1 reveals performance issues with the Parquet write pattern, Phase 2 design may need revision.

**Recommendation:** Add a checkpoint between Phase 1 and 2:
- Run Phase 1 with a real 10K file codebase
- Measure actual write latencies
- Adjust Phase 2 design if needed

### 3.4 Missing Phase Details

#### Phase 2: Rename/Delete Handling

The spec mentions "Rename/delete handling" but doesn't specify:
- How to detect file renames (vs delete+add)
- How to update entity IDs when file path changes
- Cascade behavior for relationships

**Recommendation:** Treat rename as delete+add for simplicity. Don't try to track renames.

#### Phase 4: Semantic Resolution Algorithm

Section 6.5 shows the resolution flow but lacks:
- Caching strategy for resolved imports
- Handling of circular dependencies
- Re-resolution triggers (when does resolution become stale?)

---

## 4. Performance Targets Analysis

### 4.1 Target Breakdown

| Metric | Spec Target | Achievability | Notes |
|--------|-------------|---------------|-------|
| Hash check (no changes) | <50ms | ✅ Achievable | File stat + content hash |
| Structural parse (TS) | <50ms p50 | ⚠️ Stretch | Babel is fast, but 50ms is aggressive for 500+ LOC files |
| Package Parquet write | <100ms | ⚠️ Depends | With ZSTD compression, 100ms for 50MB is tight |
| Single file change (warm) | <300ms | ✅ Achievable | Sum of parts |
| Single file change (cold) | <500ms | ⚠️ Stretch | DuckDB cold start is 100-200ms |

### 4.2 Performance Validation Concerns

The spec's latency budget (Section 12.1) shows:

```
Read file + compute hash       :  5-10ms
Compare with stored hash       :  5-10ms
Parse with ts-morph/Babel      : 50-200ms
Load existing Parquet          : 20-50ms
Merge nodes/edges              : 10-20ms
Write new Parquet (ZSTD)       : 30-100ms
fsync directory                : 10-30ms
────────────────────────────────────────
TOTAL (p50)                    : ~150-300ms
```

**Concern:** This budget assumes warm DuckDB connection. The cold start path adds:
- DuckDB connection init: 100-200ms
- First Parquet metadata scan: 50-100ms

### 4.3 Realistic Revised Targets

| Metric | Spec Target | Recommended Target |
|--------|-------------|-------------------|
| Single file (warm) | <300ms p50 | <400ms p50, <600ms p95 |
| Single file (cold) | <500ms p50 | <700ms p50, <1000ms p95 |
| Hash check (no changes) | <50ms | <100ms (include Parquet metadata read) |

### 4.4 Base Branch Write Amplification

The spec correctly identifies that base-branch edits are slower (300-500ms vs 150-300ms for feature branches). This is acceptable for the stated reason: most development uses feature branches.

**Concern:** CI/CD pipelines often run on main/master. This means:
- Every CI build that regenerates seeds will hit the slower path
- Consider lazy base update (update base only on PR merge, not on every commit)

---

## 5. Missing Pieces

### 5.1 Error Handling Gaps ❌

| Scenario | Current Handling | Recommendation |
|----------|-----------------|----------------|
| Parse failure (syntax error) | Not specified | Skip file, log warning, continue |
| Parquet write failure | Atomic write + cleanup | Add retry with backoff |
| DuckDB fatal mode | ✅ Specified (Section 5.6) | Good |
| Corrupt Parquet on read | Not specified | Add integrity check, auto-regenerate |
| OOM during analysis | Not specified | Add memory pressure detection |

### 5.2 Rollback Scenarios ❌

The spec doesn't address:

**Scenario 1: Partial batch write failure**
- 5 of 10 files parsed, 3rd file write fails
- What's the state of seeds?

**Recommendation:**
```typescript
// Transaction-like pattern for batch writes
async function writeBatchAtomic(files: ParseResult[]): Promise<void> {
  const tempDir = `${seedPath}/.tmp-${Date.now()}`;
  try {
    // Write all to temp
    for (const file of files) {
      await writeToTemp(tempDir, file);
    }
    // Atomic swap
    await atomicSwap(tempDir, seedPath);
  } catch (e) {
    await cleanup(tempDir);
    throw e;
  }
}
```

**Scenario 2: Schema version mismatch recovery**
- User updates DevAC
- Runs query on old seeds
- Query fails

**Current handling:** Log warning, suggest `--force`.

**Missing:** Automatic migration for minor version bumps.

### 5.3 Failure Modes Not Addressed ❌

| Failure Mode | Impact | Recommendation |
|--------------|--------|----------------|
| Disk full | Write fails mid-stream | Pre-check available space |
| File locked by IDE | Windows: EBUSY | Retry with backoff (Phase 4) |
| Slow file system (NFS) | Latency exceeds targets | Detect and warn |
| Concurrent writes | Race condition | File locking per package |
| Git operations during analysis | File changes mid-parse | Pause watcher during git ops |

### 5.4 Concurrent Write Protection ❌

The spec doesn't address what happens when:
- Two terminal sessions run `devac analyze` simultaneously
- Watch mode running + manual `devac analyze`

**Recommendation:** Add lock file per package:
```
.devac/seed/.lock (advisory lock)
```

### 5.5 Observability Gaps

While Section 12.5 specifies logging, missing:
- Metrics export (Prometheus/OpenTelemetry)
- Trace correlation (for debugging slow queries)
- Health check endpoint (for MCP server)

---

## 6. Integration Points Analysis

### 6.1 FileWatcher → LanguageRouter → Parser ⚠️

**Current understanding from spec:**

```
FileWatcher (chokidar)
    │
    ├─► onEvent(FileChangeEvent)
    │       │
    │       ▼
    │   LanguageRouter.getParser(filePath)
    │       │
    │       ▼
    │   Parser.parse(filePath)
    │       │
    │       ▼
    │   SeedWriter.writeFile(result)
```

**Gaps:**
1. **Debouncing strategy:** The FileWatcher has debouncing, but spec doesn't say how this interacts with LanguageRouter
2. **Error propagation:** What happens if parse fails? Does watch mode continue?
3. **Priority handling:** If multiple files change, is there ordering?

**Recommendation:** Add explicit event dispatcher:
```typescript
interface EventDispatcher {
  dispatch(event: FileChangeEvent): Promise<void>;
  setErrorHandler(handler: (error: Error) => void): void;
  setPriority(pattern: string, priority: number): void;
}
```

### 6.2 Parser → StorageManager Connection ⚠️

**Spec defines:** SeedWriter interface with `writeFile`, `deleteFile`, `updateFile`

**Existing code:** `StorageManager` is Neo4j-specific

**Missing:**
- Streaming write API (parse 1 file → write immediately)
- Batch write API (parse N files → write all at once)
- Decision criteria for which to use

**Recommendation:** Default to batch writes per package, stream only in watch mode:
```typescript
interface SeedWriter {
  // Batch mode (default for analyze)
  beginBatch(): WriteBatch;
  
  // Stream mode (for watch)
  writeFile(result: StructuralParseResult): Promise<void>;
}
```

### 6.3 Branch Detection Integration ⚠️

The spec says branch is determined by `git rev-parse --abbrev-ref HEAD`, but doesn't specify:
- When is this called?
- How often is it cached?
- What if git is unavailable?

**Recommendation:**
```typescript
interface BranchDetector {
  getCurrentBranch(): Promise<string>;
  isBaseBranch(branch: string): boolean;
  onBranchChange(callback: (newBranch: string) => void): void;
}
```

### 6.4 MCP Server Integration ✅ Well-Defined

Section 11.6 defines clear MCP tools:
- `find_symbol`
- `get_dependencies`
- `get_call_graph`
- `query_sql`

The read-only validation for SQL queries is correct.

---

## 7. Specific Recommendations

### 7.1 High Priority (Block Phase 1)

1. **Define concurrent write protection**
   - Add lock file mechanism
   - Document behavior when lock is held

2. **Specify corrupt Parquet recovery**
   - Add integrity check on seed load
   - Auto-regenerate if corrupt

3. **Clarify entity ID encoding**
   - Document exact hash algorithm
   - Add path normalization step

### 7.2 Medium Priority (Before Phase 2)

4. **Add event dispatcher interface**
   - Decouple FileWatcher from Parser
   - Enable error isolation

5. **Define batch vs stream write criteria**
   - Document when to use each
   - Add to CLI flags

6. **Add memory pressure detection**
   - Monitor heap usage during parse
   - Pause/reduce batch size if needed

### 7.3 Low Priority (Document for Later)

7. **Metrics/tracing export**
   - OpenTelemetry integration
   - Optional, but useful for large codebases

8. **Health check for MCP server**
   - Simple ping endpoint
   - Useful for Claude Desktop integration

---

## 8. Conclusion

The v2.0 spec is a **solid foundation** for a major architectural improvement. The move from Neo4j to DuckDB+Parquet is well-reasoned and addresses real pain points from v1.x.

**Key Strengths:**
- Two-pass architecture is proven
- Per-package partitioning is right tradeoff
- Atomic write pattern is correct
- Phase dependencies are accurate

**Key Gaps:**
- Error handling needs more specificity
- Concurrent write protection not addressed
- Some integration points underspecified
- Performance targets may be 20-30% optimistic

**Recommendation:** Proceed with Phase 1, but:
1. Add 20% buffer to estimates
2. Define lock file mechanism before starting
3. Add checkpoint after Phase 1 to validate assumptions
4. Accept that cold-start latency will exceed targets initially

---

## Appendix: Existing Code Alignment

| Spec Interface | Existing Code | Alignment |
|----------------|---------------|-----------|
| `StructuralParseResult` | `SingleFileParseResult` | Similar, needs `externalRefs` |
| `LanguageParser` | `Parser` class methods | Needs refactor to interface |
| `SeedWriter` | `StorageManager` | Complete replacement |
| `FileWatcher` | `FileWatcher` class | ✅ Ready to use |
| `LanguageRouter` | Not implemented | New |
| `DuckDBPool` | Not implemented | New |

---

*End of Review*
