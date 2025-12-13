# Review of DevAC/CodeGraph Specification v2.0

**Reviewer:** Gemini (AI Assistant)
**Date:** 2025-12-12
**Spec Version:** v2.0

## 1. Feasibility Assessment

### Working Components
*   **Parsers:** The reuse of `ts-morph` (TypeScript) and `python-parser.py` (Python) is feasible and leverages existing working code. The transition to `tree-sitter` for other languages is a standard industry practice.
*   **DuckDB + Parquet:** This stack is proven for analytical workloads. Using it for "code as data" is innovative but technically sound.

### "Broken" Components & Categorization
*   **Neo4j Removal:** Correctly identified as a bottleneck for a local-first CLI tool. Removing the dependency on a heavy database process significantly improves the "developer laptop" feasibility.
*   **NodeIndexCache:** Correctly identified as a symptom of the "Neo4j is slow for point lookups" problem. Removing it simplifies the architecture.

### Critical Risks
*   **"Many Small Files" Problem:** The decision to partition Parquet files *per source file* (resulting in thousands of small files) is the highest risk.
    *   **Risk:** DuckDB may struggle with metadata overhead when querying 10,000+ small Parquet files.
    *   **Risk:** OS file handle limits (`ulimit -n`) could be exhausted during repository-wide queries.
    *   **Mitigation:** The spec mentions this in "Open Questions", but it needs a concrete fallback plan (e.g., coalescing small files into larger "package chunks" periodically).

## 2. Architecture Review

### Soundness
*   **Two-Phase Parsing:** The retention of the Structural (Pass 1) vs. Semantic (Pass 2) split is excellent. It allows for fast incremental updates (Pass 1) while deferring expensive resolution (Pass 2).
*   **Federation:** The "Central Hub" as a lightweight registry (only storing computed edges) rather than a data warehouse is a strong design choice. It avoids the "monolithic central database" trap.

### Component Boundaries
*   **Clear:** The separation between `Package Seeds` (Ground Truth), `Repository Manifest` (Discovery), and `Central Hub` (Federation) is well-defined.
*   **Query Engine:** Decoupling the query engine (DuckDB) from the storage (Parquet files) allows for flexible consumption (CLI, MCP, etc.).

## 3. Implementation Phases

### Ordering
*   **Phase 1 (Foundation):** Correctly prioritizes the storage layer.
*   **Phase 2 (Incremental):** Critical. If the "interactive" promise isn't met early, the v2.0 architecture fails.
*   **Phase 3 & 4:** Logical progression.

### Dependencies
*   **Implicit Dependency:** Phase 2 (Incremental) heavily depends on the performance validation in Phase 1. If Parquet writing is too slow, Phase 2 is blocked.

## 4. Performance Targets

### Reality Check
*   **<100ms Incremental Update:**
    *   **Challenge:** Writing 3 Parquet files (nodes, edges, refs) per source file change involves significant I/O overhead (open, write, close, fsync).
    *   **Verdict:** Optimistic. On standard SSDs, this might be 50-150ms. On Windows (with Defender/Antivirus), it could easily exceed 200ms.
*   **Query Performance:**
    *   **Challenge:** `read_parquet('**/*.parquet')` with 50k files will be metadata-heavy.
    *   **Verdict:** Likely to miss the <500ms target for large repos without optimization (e.g., Hive-style partitioning or file coalescing).

## 5. Missing Pieces

### Error Handling & Reliability
*   **Atomic Writes:** The spec mentions `rm` then `write`. If the process crashes in between, the seed is corrupt/missing.
    *   **Recommendation:** Use "write to temp, then rename" pattern for atomicity.
*   **Concurrency:** What happens if `devac watch` is writing while `devac query` is reading?
    *   **Risk:** DuckDB might throw errors reading partially written files.
    *   **Recommendation:** File locking or strict "single writer" coordination.

### Platform Specifics
*   **Windows:** File locking semantics on Windows are stricter. Deleting a file that DuckDB has open for reading (even momentarily) will fail.
*   **Path Lengths:** Deeply nested node_modules + `.devac/seed/...` might hit 260 char limit on Windows.

### Rollback/Recovery
*   **State Drift:** If the file watcher misses an event (common with `chokidar` under load), the seeds drift from source.
    *   **Recommendation:** Need a "reconcile" command or startup check to verify seed timestamps vs. source file timestamps.

## 6. Integration Points

### FileWatcher → Pipeline
*   **Debouncing:** Essential. Saving a file might trigger multiple FS events.
*   **Rename Handling:** The spec mentions correlating `unlink` + `add`. This is notoriously flaky.
    *   **Recommendation:** Rely on `git status` or robust heuristics if the watcher doesn't support native renames.

### StorageManager
*   **Abstraction:** The `SeedWriter` interface is good, but it needs to hide the complexity of the "many files" vs "coalesced files" strategy so the strategy can change without breaking parsers.

## Summary & Recommendations

The v2.0 specification is **architecturally sound** and addresses the core limitations of v1.x (Neo4j dependency). However, the **"Per-File Parquet" strategy is a high-risk bet**.

**Immediate Actions:**
1.  **Benchmark First:** Before building the full pipeline, write a script to generate 10,000 small Parquet files and query them with DuckDB. If this fails, pivot to "Per-Package" partitioning immediately.
2.  **Atomic Writes:** Update the spec to mandate atomic file operations (write-temp-move).
3.  **Reconciliation:** Add a startup step to check for stale seeds (source.mtime > seed.mtime).
