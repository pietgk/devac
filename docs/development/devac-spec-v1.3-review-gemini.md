# Review of DevAC Spec v1.3

**Reviewer**: Gemini
**Date**: 2025-12-10
**Target Spec**: `docs/development/devac-spec-v1.3.md`

---

## 1. Feasibility Assessment

**Verdict**: ✅ **High Feasibility**

The specification is grounded in the existing codebase reality.
*   **Working Components**: Correctly identifies `FileWatcher`, `Neo4jClient`, and the XState actors (`ValidationCoordinatorActor`, etc.) as the foundation.
*   **Broken/Missing Components**: Accurately pinpoints the need for a `LanguageRouter` to abstract away the Babel vs. Tree-sitter difference, and the need for unified types (`StructuralParseResult`).
*   **Timeline**: The 13-15 day timeline is aggressive but achievable for a focused sprint, provided the "Fix TypeScript Errors" phase (Days 1-4) clears the path effectively.

## 2. Architecture Review

**Verdict**: ✅ **Sound**

*   **Two-Phase Parsing**: The separation of **Structural** (fast, per-file) and **Semantic** (slower, batch/background) analysis is the correct approach for an interactive tool. It ensures the UI/Graph remains responsive (<200ms) while complex resolution happens asynchronously.
*   **Single Orchestrator**: Centralizing logic in `ValidationCoordinatorActor` using XState is excellent. It avoids the "distributed state hell" of previous iterations.
*   **Startup Reconciliation**: The addition of a "reconciling" state is critical. Without it, the graph would drift from the filesystem over time (e.g., changes made while the tool was off).

**Critique**:
*   **GraphUpdater Integration**: The spec implies `GraphUpdaterActor` handles the update. Ensure `GraphUpdaterActor` is updated to use the new `LanguageRouter` instead of directly importing `StructuralParser`. The current code in `ValidationCoordinatorService` passes `structuralParser` directly to the actor. This dependency injection needs to change to `languageRouter`.

## 3. Implementation Phases

**Verdict**: ✅ **Logical Ordering**

1.  **Type Safety First**: Fixing the 103 TS errors is the right place to start. It prevents "building on quicksand."
2.  **Core Logic**: Implementing `LanguageRouter` and `Reconciliation` before adding more languages is the correct dependency chain.
3.  **Language Expansion**: Adding Tree-sitter languages one by one after the core is stable minimizes risk.

## 4. Performance Targets

**Verdict**: ⚠️ **Optimistic but Plausible**

*   **TS/JS (<150ms)**: Achievable with Babel. The bottleneck will be the Neo4j transaction. Using `UNWIND` and optimized Cypher queries in `GraphUpdaterActor` is essential.
*   **Tree-sitter (<200ms)**: Tree-sitter itself is extremely fast (<50ms). The overhead will be the Node.js <-> C++ binding and the Neo4j write.
*   **Python (<300ms)**: The subprocess overhead is the main concern. For v1.3, this is acceptable. Future versions might need a persistent Python server or a native Node.js Python parser.

## 5. Missing Pieces & Risks

*   **File Renames**: The spec mentions `add` and `unlink`. `rename` events often come as a pair or a specific rename event depending on the watcher (Chokidar). The `FileWatcher` normalization logic needs to ensure these are handled gracefully to avoid losing history or creating duplicate nodes.
*   **Reconciliation Safety**: The "In Neo4j but not disk → DELETE" logic must be scoped strictly to the **current project root**. If the query is `MATCH (f:File) ...`, it might delete files from *other* projects if the database is shared. **Recommendation**: Ensure all Cypher queries are scoped by a `projectRoot` property or label.
*   **Error Recovery**: While "Degraded" mode is defined, the strategy for *exiting* degraded mode (auto-recover after 60s) is simple. Consider adding a manual "Retry" trigger from the UI.

## 6. Integration Points

*   **FileWatcher → Coordinator**: Well-defined.
*   **Coordinator → Router**: New connection, looks correct.
*   **Router → Parsers**: Internal abstraction, good.
*   **Coordinator → GraphUpdater**: **Action Item**: The `ValidationCoordinatorService` needs to instantiate `LanguageRouter` and pass *that* (or a factory) to `GraphUpdaterActor`, replacing the direct `StructuralParser` dependency.

## 7. Final Recommendation

**Proceed with Implementation.**

The spec is mature enough. The identified risks (Reconciliation scope, GraphUpdater refactoring) can be addressed during the implementation of Phase 2.

**Immediate Next Step**: Execute Phase 1 (Fix TypeScript Errors) as defined.
