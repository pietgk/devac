# DevAC Spec v2.0 Review

## 1. Feasibility Assessment

### Working Components
*   **DuckDB + Parquet**: This is a highly feasible and performant choice. It eliminates the operational complexity of Neo4j and aligns well with the "file-based" philosophy.
*   **Atomic Writes**: The `rename + fsync` pattern is the correct approach for data integrity without a transaction log.
*   **Language Parsers**: Reusing the existing logic (ts-morph, python AST) but piping output to Parquet is a low-risk refactor.

### "Broken" Components
*   **Neo4j**: Correctly identified as the bottleneck for this specific use case (point lookups vs. graph traversals).
*   **NodeIndexCache**: Correctly identified as a symptom of the database mismatch. Removing it simplifies the architecture significantly.

### Risks
*   **Write Amplification**: Even with the "branch delta" optimization, changing a single file in the `base` set (e.g., if working directly on main) requires rewriting the entire package's `nodes.parquet`. For large packages (e.g., 500+ files), this could exceed the <200ms target.
*   **Windows File Locking**: While `fs.rename` is atomic, DuckDB (or other readers) holding file locks on Windows could cause write failures during the rename step. This needs robust retry logic.

## 2. Architecture Review

### Soundness
*   **Two-Phase Parsing**: The separation of Structural (Pass 1) and Semantic (Pass 2) is architecturally sound and necessary for resolving cross-file dependencies.
*   **Federation Model**: The 3-layer hierarchy (Package -> Repo -> Hub) is clean. It allows for "shared nothing" operation at the package level, which is great for scalability.
*   **Entity IDs**: The shift to content-hash-based IDs (excluding branch) is a critical improvement. It ensures stable IDs across branches, enabling the delta storage strategy.

### Component Boundaries
*   **Clear**: The separation between `LanguageRouter`, `Parser`, and `SeedWriter` is well-defined.
*   **Source-of-Truth**: The principle that "Source is Truth" and seeds are disposable/regenerable simplifies the system state management immensely.

## 3. Implementation Phases

### Ordering
*   The ordering is logical. Phase 1 (Foundation) and Phase 2 (Incremental) are the correct prerequisites.
*   **Phase 4 (Federation)** containing the Semantic Resolution logic is the right place, as resolution is inherently a cross-entity operation.

### Dependencies
*   **Critical Path**: Phase 1 -> Phase 2 -> Phase 4.
*   **Parallelism**: Phase 3 (Python) and Phase 6 (C#) can indeed be parallelized as they are just plugins to the core architecture.

## 4. Performance Targets

### Realistic?
*   **<50ms Hash Check**: Realistic.
*   **<300ms Single File Change**:
    *   *Optimistic* for large packages if modifying `base`.
    *   *Realistic* for `branch` delta updates (since the delta is small).
    *   *Concern*: If the user is on `main` (base), every save triggers a full package rewrite. The spec might need a "working set" concept even for the base branch to avoid rewriting 50MB files on every keystroke.
*   **Query Performance**: DuckDB is exceptionally fast; the <100ms query targets are likely achievable, provided the partition pruning works as expected.

## 5. Missing Pieces & Gaps

### Error Handling
*   **Partial Failures**: If a batch update fails halfway (e.g., `nodes.parquet` writes but `edges.parquet` fails), the package is in an inconsistent state. The spec relies on "Atomic Write" of individual files, but a "Package Update" involves multiple files.
    *   *Recommendation*: Use a directory-swap pattern for the entire `seed/branch/` folder during updates, or accept eventual consistency where a subsequent run fixes it.

### Rollback/Recovery
*   **Corruption**: The `devac clean` command is a blunt instrument. A more granular `devac repair` that checks checksums and regenerates only broken partitions would be better.

### Concurrency
*   **Reader/Writer Contention**: If a long-running query (e.g., from the MCP server) is reading the Parquet files while the CLI tries to update them, what happens?
    *   *Linux/macOS*: Usually fine (unlink works on open files).
    *   *Windows*: Will likely throw `EPERM`. The spec needs a specific strategy for Windows (e.g., retry with backoff).

### "Base" Branch Definition
*   The spec assumes a `base` vs `branch` structure. How does the system know what "base" is? Is it hardcoded to `main`/`master`? Does it read from git config? This needs to be explicit in the `LanguageRouter` or `FileScanner` config.

## 6. Integration Points

### FileWatcher -> LanguageRouter -> Parser
*   This flow is well-specified. The use of `chokidar` with debouncing is standard.

### Semantic Resolution
*   The connection between "Phase 1 Structural" and "Phase 4 Semantic" is the most complex integration point. The spec notes that `external_refs` are written in Phase 1 but resolved in Phase 4.
*   *Gap*: When does Phase 4 run? Is it triggered automatically after Phase 1? Or is it lazy? The spec implies it's part of the pipeline, but for "Watch Mode", running full cross-repo resolution on every file save might be too heavy. It might need to be asynchronous/debounced.

## Summary
The v2.0 spec is a significant improvement over v1.x. The move to DuckDB/Parquet aligns perfectly with the tool's usage patterns. The primary risks are around **write performance on large packages** and **Windows file locking**, but these are manageable with careful implementation.
