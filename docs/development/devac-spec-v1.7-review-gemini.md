# Review of DevAC Spec v1.7

**Reviewer**: Gemini
**Date**: 2025-12-10
**Target Spec**: `docs/development/devac-spec-v1.7.md`

## 1. Executive Summary

The v1.7 specification is **robust, well-structured, and implementation-ready**. It correctly identifies the current state of the codebase and proposes a logical, phased approach to achieving incremental graph updates. The decision to defer `AffectedCalculator` and complex language support (C++, Go) is pragmatic and increases the likelihood of success within the 22-day timeline.

**Overall Assessment**: ✅ **APPROVED** with minor caveats regarding the "Stale Graph" risk.

## 2. Feasibility Analysis

*   **Component Identification**: Accurate. I verified the existence of key actors (`ValidationCoordinatorActor`, `GraphUpdaterActor`) and services (`FileWatcher`, `Neo4jClient`). The "broken" components (missing types, adapters) are correctly identified as P0/P1 tasks.
*   **Type Mismatches**: The spec explicitly addresses the disconnect between `StructuralParser` output and `GraphUpdater` input via `ParseResultAdapter`. This is a critical integration detail that is often overlooked.
*   **Dependencies**: The requirement for `apoc` and `@types/babel__traverse` is noted.

## 3. Architecture Review

### Strengths
*   **Actor Model**: Using XState actors (`ValidationCoordinatorActor`) is an excellent choice for managing the complex asynchronous state of file processing (locking, parsing, updating, error handling).
*   **Concurrency Control**: The `FileMutex` design (P0.5) is essential. Without it, rapid `Ctrl+S` actions would almost certainly corrupt the graph or cause race conditions in Neo4j.
*   **Error Handling**: The explicit error states (`parseError`, `syncError`) and the strategy to persist these errors to the `File` node in Neo4j is a strong design choice for observability.

### Weaknesses / Trade-offs
*   **Stale Relationships**: By deferring `AffectedCalculator`, the graph will become semantically inconsistent. If `FileA` changes a function signature, `FileB` (which calls it) will retain a valid `CALLS` relationship until `FileB` is also touched or a full re-scan occurs. This limitation must be clearly communicated to users/consumers of the graph.
*   **Tree-Sitter Strategy**: The spec implies a new Tree-sitter integration for Python/Java in Phase 3. The repository README mentions an existing `python-parser.ts` that spawns a subprocess. The spec should clarify if we are replacing the subprocess approach with native Node.js bindings (faster) or wrapping the existing one.

## 4. Implementation Phases

The ordering is logical:
1.  **Phase 0/1 (Foundation)**: Fixing TS errors and verifying the environment is the correct first step. You cannot build on a broken build.
2.  **Phase 2 (Core)**: Wiring the pipeline for TS/JS first reduces complexity.
3.  **Phase 3 (Expansion)**: Adding Python/Java later isolates language-specific parsing issues from pipeline logic issues.

**Risk**: Phase 3 (3 days) is tight for implementing two new language parsers if "Tree-sitter integration" means writing new bindings/adapters from scratch.

## 5. Performance Targets

*   **<500ms Total Latency**: Achievable for TS/JS using `ts-morph` or Babel for structural parsing.
*   **<200ms Graph Update**: This relies heavily on the `Batched Relationship Creation` (P1.1). Single-statement writes would likely blow this budget due to network RTT. The batching strategy is critical.
*   **Bottleneck**: The primary bottleneck will likely be the Neo4j transaction commit time, not the parsing.

## 6. Missing Pieces & Recommendations

1.  **Tree-Sitter Clarification**: Explicitly define the library/approach for Tree-sitter (e.g., `node-tree-sitter` vs WASM vs subprocess).
2.  **Stale Data Indicator**: Consider adding a global or per-project flag in Neo4j (e.g., `Project.needsFullRescan = true`) when incremental updates occur, to hint that cross-file analysis might be slightly off.
3.  **Test Environment**: The spec mentions "Integration smoke tests". Ensure there is a mechanism to spin up a clean Neo4j instance (e.g., Docker/Testcontainers) for these tests to avoid polluting the dev database.

## 7. Integration Points

The connections are well-defined:
*   `FileWatcher` -> `ValidationCoordinator` (Event-driven)
*   `ValidationCoordinator` -> `LanguageRouter` (Direct call)
*   `LanguageRouter` -> `GraphUpdater` (via Adapter)

The `ParseResultAdapter` is the linchpin here. It must robustly handle missing fields or slightly different shapes from different parsers.

## Conclusion

Proceed with the implementation plan as written. The P0 and P1 items are correctly prioritized. Pay special attention to the **FileMutex** implementation to ensure it handles promise rejection/cancellation correctly.
