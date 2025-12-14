# DevAC Specification v2.0 Review

## 1. Feasibility Assessment

**Verdict: High Feasibility**

The specification accurately categorizes the system components:
*   **Working Components:** The core language parsing logic (`ts-morph`, `python-parser`) is reusable. The file scanning infrastructure is solid.
*   **"Broken" Components:** The diagnosis of Neo4j as an architectural mismatch is correct. Replacing the complex `StorageManager` and `Neo4jClient` with a stateless `SeedWriter` and DuckDB is a feasible and necessary simplification.
*   **Technology Stack:** DuckDB and Parquet are mature, high-performance technologies well-suited for this "read-heavy, write-batch" workload.

**Risk:** The transition from `ts-morph` (which carries heavy type-checking overhead) to a "Babel fast path" for the structural pass (Phase 1) requires careful implementation. If the current `TypeScriptParser` is tightly coupled to `ts-morph`'s `Project` object, refactoring it to be purely AST-based for Pass 1 might be more work than estimated.

## 2. Architecture Review

**Verdict: Sound and Robust**

The **Two-Phase Parsing** architecture is the strongest part of this spec.
1.  **Decoupling:** Separating "Structural" (Pass 1) from "Semantic" (Pass 2) allows for massive parallelism in Pass 1.
2.  **Source is Truth:** Treating Parquet files as derived artifacts that can be blown away and regenerated eliminates the "state drift" bugs common in the v1.x Neo4j sync logic.
3.  **Federation:** The "Three-Layer Federation Model" (Package -> Repo -> Hub) maps perfectly to how developers actually work (monorepos, polyrepos).

**Critique:**
*   **Branch Partitioning:** The move from "per-file parquet" (v2.0 original) to "per-package-per-branch" (v2.1) is architecturally superior for read performance but introduces the "write amplification" risk on the base branch. This is an acceptable trade-off, but the architecture relies heavily on the assumption that most edits happen on feature branches.

## 3. Implementation Phases

**Verdict: Logical Ordering**

The phases are correctly ordered to minimize risk.
*   **Phase 1 (Foundation):** Rightly focuses on the storage layer (DuckDB/Parquet) and the primary language (TS). Without this, nothing else matters.
*   **Phase 2 (Incremental):** Essential for DX. Doing this before adding more languages (Phase 3) is the correct prioritization.
*   **Phase 4 (Federation):** Pushed to later. This is smart; get the single-repo experience right first.

**Missing Dependency:** Phase 5 (Validation) relies on "Affected Detection". This logic needs to be robust. The spec implies this comes from querying the graph. This dependency is clear.

## 4. Performance Targets

**Verdict: Aggressive but Plausible**

*   **<300ms Single File Change (Feature Branch):** Realistic. Parsing one file (~50ms) + writing a small delta Parquet (~50ms) + overhead fits the budget.
*   **Base Branch Edits:** The spec acknowledges the 300-500ms latency for base branch edits due to full package rewriting. This is the primary performance risk. If a "utils" package has 2,000 files, rewriting its `nodes.parquet` on every save might exceed 500ms.
    *   *Mitigation:* The spec mentions "Adaptive Batch Sizing" in the current codebase. A similar logic might be needed here: if a package is >500 files, force it into "chunked" mode or warn the user? The spec doesn't explicitly handle "Huge Package" edge cases for the base branch write.

## 5. Missing Pieces & Risks

1.  **Windows Support:** The spec explicitly excludes Windows file locking handling for Phase 1. While acceptable for a prototype, this is a major blocker for general adoption. The `rename` + `fsync` dance is notoriously flaky on Windows/NTFS.
2.  **Concurrency:** The spec mentions `DuckDB` single-writer limitations. What happens if a user runs `devac analyze` in one terminal and `devac watch` in another? Or two VS Code windows open?
    *   *Recommendation:* Implement a PID lock file (`.devac/lock`) early in Phase 1 to prevent concurrent writers to the same package seeds.
3.  **Error Handling in Watch Mode:** If a file has a syntax error, the parser fails. Does the old seed remain? Is it marked as "error"? The spec mentions `StructuralParseResult` but doesn't detail how "broken code" is represented in the graph. (e.g., does a syntax error file disappear from the graph, breaking all references to it?)

## 6. Integration Points

**Verdict: Well-Defined**

The interfaces are clear:
*   `LanguageRouter` correctly abstracts the file extension mapping.
*   `SeedWriter` abstracts the storage complexity.
*   The `FileWatcher` integration is standard.

**Refinement:** The connection between `FileWatcher` and `LanguageRouter` needs to be efficient. The watcher should only watch relevant extensions. The spec mentions `router.getSupportedExtensions()`, which covers this.

## Summary

This is a high-quality, well-thought-out specification. It addresses the fundamental flaws of the v1.x architecture (Neo4j complexity, sync issues) with a radical but sound "file-based database" approach. The risks are primarily in the low-level file I/O performance on the base branch and Windows compatibility, both of which are managed risks.

**Recommendation:** Proceed with Phase 1 immediately.
