# Review of DevAC Spec v1.10

**Reviewer**: Gemini
**Date**: 2025-12-10
**Spec Version**: v1.10

## 1. Feasibility Assessment

The specification is **highly feasible** and grounded in the current reality of the codebase.

*   **Working Components**:
    *   `src/analyzer/structural-parser.ts`: Verified. It uses `@babel/parser` and produces the `StructuralParseResult` structure described. It is fast and ready for the "Phase 1" structural pass.
    *   `src/database/neo4j-client.ts`: Verified. It provides the necessary transaction management (`runTransaction`, `runTransactionWork`) required for the atomic updates.
    *   `src/analyzer/relationship-resolver.ts`: Verified. It exists and contains the logic for Pass 2, but as noted, its API (`resolveRelationships(project, ...)`) requires the proposed `RelationshipResolverAdapter` to interface with the actor system.

*   **"Broken" Components**:
    *   `ValidationCoordinatorActor`: Confirmed. The current implementation lacks handling for `FILE_RENAMED`, `CIRCUIT_OPEN`, `PAUSE`, and `SHUTDOWN`. It also misses the `FileMutex` and `structuralInProgress` logic. The spec correctly identifies these gaps.
    *   `GraphUpdaterActor`: Confirmed. Needs the robust transaction rollback and retry logic described in P0.1 and P0.2.

## 2. Architecture Review

The **Two-Phase Analysis Pipeline** is architecturally sound and addresses the performance bottlenecks of the previous batch-based approach.

*   **Phase 1 (Structural)**: Using Babel for a fast, syntax-only parse to update the graph structure (<100ms) is the correct strategy for interactive feedback. This decouples the "graph existence" from "semantic correctness".
*   **Phase 2 (Semantic)**: Offloading `ts-morph` type checking to a background process (`SemanticResolverActor`) prevents blocking the main validation loop. The `RelationshipResolverAdapter` is the correct pattern to bridge the stateless actor world with the stateful `ts-morph` Project.
*   **Atomic Updates**: The strategy of "Delete old nodes -> Create new nodes" in a single transaction (P0.1) is robust. It ensures consistency without complex diffing logic.

## 3. Implementation Phases

The ordering of phases is logical and risk-mitigated.

*   **Phase 0.5 (API Reconciliation)** is the most critical addition. Creating the adapters (`ParseResultAdapter`, `RelationshipResolverAdapter`) *before* fixing the actors ensures that the actors have stable interfaces to program against.
*   **Phase 1a/1b (Fixes)**: Cleaning up the import paths and TypeScript errors is a necessary prerequisite. The codebase currently has significant "lint rot" that must be cleared.
*   **Phase 2 (Core Integration)**: Implementing the `FileMutex`, `CircuitBreaker`, and `RetryPolicy` here is correct. These are foundational reliability features.
*   **Phase 3 (Semantic)**: Deferring the complex `ts-morph` integration until the structural pipeline is stable is a wise move.

## 4. Performance Targets

The targets are aggressive but realistic **if and only if** the environment qualifications are respected.

*   **<100ms Structural Parse**: Achievable with Babel.
*   **<400ms Total (Warm/Local/APOC)**: Achievable. The key is the `APOC` batching. Without APOC, the fallback queries (P0.3) will likely push this to 500-600ms, which the spec acknowledges.
*   **Remote Neo4j**: The spec correctly adds latency buffers (+200-400ms) for network round-trips.

## 5. Missing Pieces & Risks

*   **Rename Handling**: The heuristic-based rename detection (window of 100ms) is "best effort". There is a risk of false positives (treating a rename as a delete+add) if the file system events are delayed beyond the window. The `Reconciliation` pass (P2.3) helps, but it's a post-hoc fix.
*   **Memory Leaks**: `ts-morph` Projects can grow indefinitely. The `TsMorphProjectManager` needs to be very aggressive about memory management. The `MemoryMonitor` (P1.7) is a good safeguard, but we might need explicit "project reset" logic if memory fragmentation becomes an issue.
*   **Edge Cases**:
    *   **Rapid Fire Changes**: The `BoundedPriorityQueue` with deduplication (H5) handles this well.
    *   **Neo4j Downtime**: The `CircuitBreaker` (P1.3) handles this well.

## 6. Integration Points

The connections are well-defined:

1.  **FileWatcher -> Coordinator**: Via `connectFileWatcherToCoordinator` (adapter pattern).
2.  **Coordinator -> LanguageRouter**: Direct call.
3.  **LanguageRouter -> StructuralParser**: Direct call.
4.  **Coordinator -> GraphUpdater**: Actor message.
5.  **Coordinator -> SemanticResolver**: Actor message.
6.  **SemanticResolver -> RelationshipResolverAdapter**: Direct call (dependency injection).

## Conclusion

**Status: APPROVED**.

The spec is comprehensive, addresses the technical debt accurately, and provides a clear path forward. The code snippets provided in the spec are high-quality and directly usable.

**Recommendation**: Proceed immediately with **Phase 0 (Verification)** and **Phase 0.5 (API Reconciliation)**.
