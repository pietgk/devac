# Review of DevAC Spec v1.5: Incremental Graph Updates

**Reviewer**: Gemini
**Date**: 2025-12-10
**Target Spec**: `docs/development/devac-spec-v1.5.md`

## 1. Feasibility Assessment
**Rating**: High

The specification is grounded in the existing codebase reality.
*   **Working Components**: The identification of `FileWatcher`, `Neo4jClient`, and `StructuralParser` as core building blocks is accurate. Verification confirms these files exist in the `src` tree.
*   **"Broken" Components**: The explicit listing of 103 TypeScript errors and the strategy to fix them (Phase 1) is a pragmatic and necessary starting point. It acknowledges technical debt before adding features.
*   **Risk**: The reliance on `python-parser.ts` (subprocess) meeting the <400ms target is a risk, but the spec acknowledges this limitation.

## 2. Architecture Review
**Rating**: Strong

The **Single Orchestrator Pattern** using XState actors is a robust choice for managing the complex state of asynchronous file processing.
*   **Two-Phase Parsing**: Retaining the Structural (Pass 1) vs. Semantic (Pass 2) split is crucial for performance. It allows the UI to be responsive (structural graph) while deep analysis happens in the background.
*   **Atomic Updates**: The "Delete + Create" transaction strategy in `GraphUpdaterActor` is excellent for data integrity. It avoids the complexity of diffing graph nodes in memory.
*   **Component Boundaries**: The separation of concerns is clear:
    *   `LanguageRouter`: Abstraction over parsers.
    *   `GraphUpdater`: Abstraction over Neo4j writes.
    *   `Coordinator`: State management.

## 3. Implementation Phases
**Rating**: Logical

The ordering of phases minimizes risk:
1.  **Stabilization (Phase 1)**: Fixing TS errors first is non-negotiable.
2.  **Core Infrastructure (Phase 2)**: Establishing the router, config, and reconciliation before adding languages ensures a solid foundation.
3.  **Expansion (Phase 3)**: Adding languages one by one allows for isolated testing.
4.  **Polish (Phase 4)**: Performance tuning and edge cases.

**Critique**: Phase 2 (Days 6-11) is heavy. Implementing reconciliation, rename detection, and graceful shutdown in 6 days is aggressive. Consider splitting "Reconciliation" and "Rename/Shutdown" into separate sub-phases if slippage occurs.

## 4. Performance Targets
**Rating**: Ambitious but Realistic

*   **<150ms for TS/JS**: Achievable for incremental updates if `ts-morph` or the structural parser is efficient.
*   **<200ms for Tree-sitter**: Very realistic; tree-sitter is extremely fast. The bottleneck will be the Neo4j round-trip.
*   **<400ms for Python**: Realistic given the subprocess overhead.
*   **Cold Start (2s)**: Honest assessment.

**Concern**: The spec assumes `GraphUpdaterActor`'s "Delete + Create" is fast enough. For large files (thousands of nodes), deleting and recreating might exceed 200ms. The "P95 < 500ms" target covers this, but monitoring is key.

## 5. Missing Pieces & Risks

While the spec is comprehensive, a few areas need attention during implementation:

1.  **Dependency Invalidation (`AffectedCalculatorActor`)**:
    *   The architecture diagram shows `AffectedCalculatorActor`, but the text details are sparse compared to other actors.
    *   **Risk**: If `A.ts` changes, does `B.ts` (which imports A) get re-analyzed? The spec focuses on the *changed file*. For full semantic correctness, dependents often need re-resolution. This might be out of scope for v1.5 (purely incremental file update), but it should be clarified.

2.  **Neo4j Connection Resilience**:
    *   The spec mentions "Retry 3x", but does not specify the backoff strategy (exponential vs. linear).
    *   What happens if the DB goes down for 1 minute? Does the queue fill up and drop events? (Addressed by Queue Overflow strategy, but worth testing).

3.  **Large File Handling**:
    *   A 10k LOC file might block the `GraphUpdaterActor` for >1s. Since the actor processes sequentially, this could stall the pipeline.
    *   **Mitigation**: Ensure `parseTimeoutMs` applies to the *entire* pipeline or just the parse phase? (Spec says `parseTimeoutMs`, implying just parsing).

## 6. Integration Points
**Rating**: Well-Defined

*   **FileWatcher → Coordinator**: The `FileChangeEvent` interface is clear.
*   **Coordinator → Router**: The `LanguageRouter` interface is simple and effective.
*   **Coordinator → GraphUpdater**: The hand-off of `StructuralParseResult` is the correct integration point.
*   **Shutdown**: The signal handling and draining logic is a critical addition for data safety.

## Conclusion

This is a high-quality, implementation-ready specification. It addresses the critical flaws of previous versions (lack of rollback, race conditions) and provides a clear path forward.

**Recommendation**: **PROCEED**.
Pay special attention to the `AffectedCalculatorActor` implementation details during Phase 2, as that is the least defined component in the text.
