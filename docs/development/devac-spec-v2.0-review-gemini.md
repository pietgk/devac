# DevAC/CodeGraph Spec v2.0 Review

## 1. Feasibility Assessment

**Verdict: High Feasibility (with caveats)**

The proposed shift from Neo4j to DuckDB + Parquet is technically sound and aligns with modern data engineering practices for "code as data".

*   **Working Components:**
    *   **`StructuralParser` (Babel-based):** The existence of `src/analyzer/structural-parser.ts` (labeled "Experiment 5") is a massive head start. It already implements the fast, non-type-checked parsing required for Phase 1.
    *   **Two-Pass Logic:** `AnalyzerService` already orchestrates a two-pass flow (Parse -> Resolve). The logic for separating structural extraction from semantic resolution is proven in the current codebase.
    *   **Language Support:** `ts-morph` and `python-parser.ts` are already integrated, reducing the risk for Phase 1 & 3.

*   **"Broken" Components:**
    *   The spec correctly identifies that the current Neo4j-based `StorageManager` and the heavy reliance on `ts-morph` for the initial pass are bottlenecks.
    *   The `NodeIndexCache` mentioned as "broken/deprecated" in v1.11 is indeed absent or irrelevant, confirming a clean slate is possible.

*   **Risks:**
    *   **Windows File Locking:** The spec explicitly punts on Windows support (Phase 1). This is a significant limitation for a cross-platform tool, though acceptable for an initial pivot.
    *   **DuckDB Write Concurrency:** While "atomic write" (rename) is proposed, high-frequency file changes (e.g., `git checkout`) might race with the file watcher. The spec relies heavily on the file system's atomicity.

## 2. Architecture Review

**Verdict: Sound, but `LanguageRouter` is a new abstraction.**

*   **Two-Phase Parsing:** The design is solid. Moving the "Structural" pass to Babel (via `StructuralParser`) and keeping `ts-morph` only for the "Semantic" pass (resolution) is the correct optimization for the <200ms target.
*   **Component Boundaries:**
    *   **Current:** `AnalyzerService` -> `Parser` (Switch) -> `StorageManager` -> `Neo4j`.
    *   **Proposed:** `FileWatcher` -> `LanguageRouter` -> `Parser` -> `SeedWriter` -> `Parquet`.
    *   **Gap:** `LanguageRouter` does not exist. The current `Parser` class mixes orchestration, routing (switch statement), and project management. This needs to be decomposed.
*   **Storage:** The "Source is Truth" principle simplifies the architecture immensely by removing the need for a persistent DB state management (sync/reconcile).

## 3. Implementation Phases

**Verdict: Logical, but Phase 1 is aggressive.**

*   **Phase 1 (Foundation):** 18 days is tight for replacing the entire storage engine and porting the parser.
    *   *Dependency:* `StructuralParser` needs to be promoted from "experiment" to "core".
    *   *Critical Path:* The `SeedWriter` implementation (Parquet/DuckDB) is the hardest part.
*   **Phase 2 (Incremental):** Correctly follows Phase 1. The file watcher integration is the natural next step.
*   **Phase 4 (Federation):** This is the biggest differentiator. Deferring it allows the core "single-repo" experience to stabilize first.

## 4. Performance Targets

**Verdict: Realistic for Read, Challenging for Write.**

*   **<200ms Structural Parse:** **Achievable.** Babel is extremely fast. `StructuralParser` metadata shows it's already measuring this.
*   **<100ms Incremental Update:** **Challenging.**
    *   This target includes: Detect Change -> Parse -> DuckDB Insert -> Parquet Write -> File Rename.
    *   DuckDB's `COPY TO` + `fs.rename` overhead might exceed 100ms for larger files or busy disks.
    *   *Mitigation:* The spec allows for 300-500ms for "Single file change (warm)", which is more realistic than the <100ms mentioned in the summary.

## 5. Missing Pieces & Gaps

1.  **Error Handling & Partial Failures:**
    *   What happens if a Parquet write fails mid-batch? The spec mentions "atomic writes", but if the *process* crashes, we might have `.tmp` files left over. A "cleanup on startup" routine is needed.
2.  **`LanguageRouter` Implementation:**
    *   The spec assumes a `LanguageRouter` but doesn't detail how it interacts with the existing `Parser` class. Does `Parser` become `LanguageRouter`? Or does `AnalyzerService` call `LanguageRouter`?
3.  **Memory Management:**
    *   DuckDB in-memory databases for every file parse could spike memory. The spec mentions "ephemeral in-memory", but managing thousands of DuckDB connections/contexts needs care.
4.  **Query Layer:**
    *   The spec focuses heavily on *writing* seeds. The *reading* / *querying* API (the "DevAC" part) needs to be robust to handle the distributed Parquet files efficiently.

## 6. Integration Points

*   **FileWatcher → LanguageRouter:** Well-defined in spec, but `FileWatcher` is currently missing from the codebase (likely in `src/devac/web/server.ts` or similar, but needs extraction).
*   **Parser → StorageManager:** This link is being severed. `Parser` now produces `StructuralParseResult`, and `SeedWriter` (new) takes that and writes to disk. This decouples parsing from storage, which is excellent.

## Recommendations

1.  **Promote `StructuralParser`:** Immediately refactor `src/analyzer/structural-parser.ts` to match the `LanguageParser` interface defined in the spec.
2.  **Prototype `SeedWriter` First:** Before ripping out Neo4j, build the `SeedWriter` and verify DuckDB/Parquet write performance on the target hardware.
3.  **Relax Phase 1 Targets:** Consider splitting Phase 1 into "Storage Engine" (DuckDB/Parquet) and "Parser Refactor" (Babel port). Doing both simultaneously is risky.
4.  **Clarify `LanguageRouter`:** Define whether this is a new class or a refactor of the existing `Parser` class.

**Sign-off:** The v2.0 spec is approved for implementation, pending the `SeedWriter` prototype validation.
