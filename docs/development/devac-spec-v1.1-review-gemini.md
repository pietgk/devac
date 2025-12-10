# Review of DevAC Spec v1.1

## 1. Feasibility
**Assessment: High**
The spec accurately identifies existing components and their states.
*   **Verified Components**: `StructuralParser`, `SemanticResolver`, `FileWatcher`, and the Actor framework (`src/devac/actors/`) all exist in the codebase as described.
*   **Error Categorization**: The breakdown of TypeScript errors (imports, XState v5 typing) appears accurate and actionable.
*   **"Fix vs Rewrite" Decision**: This is the correct pragmatic choice. The actors contain complex logic (retry policies, state management) that would be risky to rewrite from scratch.

## 2. Architecture
**Assessment: Sound**
The **Two-Phase Parsing** (Structural vs. Semantic) is the industry standard for responsive language tooling (similar to LSP implementations).
*   **Decoupling**: Separating the "write to DB" (Phase 1) from "resolve imports" (Phase 2) is crucial for the <200ms target.
*   **Atomic Updates**: The "Delete-then-Insert" strategy within a single transaction is robust and prevents inconsistent states (e.g., duplicate nodes).
*   **Language Router**: Introducing a `LanguageRouter` is a necessary abstraction to handle the multi-language requirement cleanly.

## 3. Implementation Phases
**Assessment: Logical but Aggressive**
*   **Phase 1 (Fix TS)**: Essential prerequisite.
*   **Phase 2 (Integration)**: This is the heaviest phase. Wiring `FileWatcher` -> `Pipeline` -> `Actors` involves significant state management.
*   **Phase 3 & 4**: Pushing Python/Tree-sitter to later phases is good risk management.
*   **Critique**: Phase 2 might take longer than "Day 3-4". The integration testing alone (ensuring race conditions don't corrupt the graph) is complex.

## 4. Performance Targets
**Assessment: Optimistic**
*   **<200ms End-to-End**: This is very tight.
    *   *Budget*: 300ms debounce (wait) + 20ms parse + 50ms DB write.
    *   *Risk*: Neo4j write latency. If the DB is not local or is under load, 50ms for a transaction is optimistic.
    *   *Mitigation*: Ensure `GraphUpdaterActor` uses a dedicated session/connection pool to avoid handshake overhead.
*   **Python <100ms**: Feasible only with the proposed "keep-alive" subprocess. Spawning a new process per file would definitely violate this.

## 5. Missing Pieces & Risks
**Critical Gaps**:
1.  **Initial Reconciliation**: The spec focuses on *updates*. What happens on startup? Does the system compare the DB state vs. File System state? If the tool was off while files changed, the graph is stale. **Recommendation**: Add a "Startup Sync" phase or actor.
2.  **Syntax Error Handling**: The spec says "Log error, skip file".
    *   *Problem*: If I introduce a syntax error in `A.ts`, and the parser skips it, the *old* (valid) version of `A.ts` remains in the DB. The DB is now out of sync with reality.
    *   *Recommendation*: The DB should reflect the "Error" state. Delete the old nodes and create a `File` node with an `error` property, or keep the old nodes but mark them as `stale`.
3.  **Dependency Invalidation**: The `AffectedCalculatorActor` is listed as a component but **missing from the data flow diagrams**.
    *   *Scenario*: I rename `export const A` to `B`. The file updates. But `C.ts` which imports `A` is now broken. Does the pipeline trigger `C.ts` for re-analysis?
    *   *Recommendation*: Explicitly place `AffectedCalculatorActor` in the Phase 2 flow.
4.  **Debounce Edge Cases**: If a user types fast, `FileWatcher` debounces. But if a parse takes >200ms and a new change comes in, does the pipeline cancel the running operation?

## 6. Integration Points
**Assessment: Mostly Clear**
*   The `StructuralParseResult` interface is a good contract.
*   **Tree-sitter Adapter**: The plan to adapt tree-sitter output to `StructuralParseResult` is solid.
*   **Missing Link**: The connection between `GraphUpdaterActor` and `SemanticResolverActor` is described as "Queue TS/JS files". This implies `GraphUpdaterActor` needs to know about `SemanticResolverActor`, or there's an orchestrator. The `ValidationCoordinatorActor` exists in the file list—is this the orchestrator? The spec should clarify who pushes to the queue.

## Summary
The spec is **approved for implementation** with the following caveats:
1.  **Add Startup Sync**: Define how the system initializes.
2.  **Clarify Error State**: Don't just "skip" invalid files; handle the state transition.
3.  **Define Propagation**: Explain where `AffectedCalculator` fits in.
