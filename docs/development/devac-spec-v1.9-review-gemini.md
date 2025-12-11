# Review of DevAC Spec v1.9

**Reviewer**: Gemini
**Date**: 2025-12-10
**Target Spec**: `docs/development/devac-spec-v1.9.md`

## 1. Feasibility Assessment

**Verdict**: **High**, with one critical reservation regarding the Semantic Resolver adapter.

*   **Component Identification**: Accurate. The spec correctly identifies existing components (`Neo4jClient`, `StructuralParser`, `FileWatcher`) and those needing work (`ValidationCoordinatorActor`, `GraphUpdaterActor`).
*   **"Broken" Status**: The assessment of `RelationshipResolver` having an "API mismatch" is correct, but the proposed fix in the spec has a flaw (see Section 5).
*   **Timeline**: The 30-day timeline is aggressive but feasible given the "warm" strategy for `ts-morph` and the deferral of non-TS/JS languages.

## 2. Architecture Review

**Verdict**: **Sound**.

*   **Two-Phase Parsing**: The separation of Structural Parsing (Phase 1) and Semantic Resolution (Phase 2) is preserved and well-integrated into the actor model.
*   **Component Boundaries**:
    *   `LanguageRouter` effectively isolates parser selection.
    *   `GraphUpdater` correctly encapsulates Neo4j atomic updates.
    *   `ValidationCoordinator` acts as the proper orchestrator.
*   **Data Flow**: The flow from `FileWatcher` -> `Coordinator` -> `Router` -> `Updater` -> `Resolver` is logical and handles the async nature of the task well.

## 3. Implementation Phases

**Verdict**: **Logical and Pragmatic**.

*   **Phase 1a (Import Fixes)**: Prioritizing import path fixes is the correct first step to get the build stable.
*   **Phase 0.5 (Adapters)**: Essential for bridging the new actor system with the existing analyzer logic.
*   **Phase 2 (Core Integration)**: Grouping Mutex, Retry, and Circuit Breaker makes sense as they form the reliability layer.
*   **Phase 3 (ts-morph)**: Deferring the complex state management of `ts-morph` until after the basic pipeline works is a good risk management strategy.

## 4. Performance Targets

**Verdict**: **Ambitious but Plausible**.

*   **<500ms per file**: Achievable for incremental updates if `ts-morph` project is kept warm.
*   **<100ms structural parse**: Realistic for Babel/ts-morph on single files.
*   **<200ms graph update**: Feasible with batched writes and APOC, though network latency to Neo4j will be the main variable.
*   **Cold Start**: The spec acknowledges the higher cost of cold starts, which is acceptable.

## 5. Missing Pieces & Critical Issues

### CRITICAL: RelationshipResolverAdapter Implementation Flaw
The spec provides a "Complete Implementation" for `RelationshipResolverAdapter` (Section P0.5) that is **incorrect**:

```typescript
// Spec code:
const resolver = new RelationshipResolver(nodes, relationships);
return resolver.resolvePass2(); // METHOD DOES NOT EXIST
```

**Reality**:
The existing `RelationshipResolver.ts` has `resolveRelationships(project: Project, ...)` and **requires** a `ts-morph` `Project` instance to function for TS/JS files. It does not have a `resolvePass2()` method.

**Required Fix**:
The `RelationshipResolverAdapter` must:
1.  Have access to the `TsMorphProjectManager` (or the `Project` instance).
2.  Call `resolveRelationships(project)` instead of `resolvePass2()`.
3.  This implies `SemanticResolverActor` needs the `TsMorphProjectManager` injected.

### Other Missing Pieces
*   **Stale Data Handling**: If the semantic queue backs up or fails, the spec notes "Cross-file edges may be stale". There is no mechanism described to eventually force consistency if the queue is dropped (e.g., a "full rescan needed" flag).
*   **Dependency Tracking**: The spec mentions `TsMorphProjectManager.getDependents` in Phase 3, but it's unclear if this triggers *re-analysis* of those dependent files. If file A changes, file B (which imports A) might need its relationships updated. The current flow updates A, but does it schedule B?

## 6. Integration Points

**Verdict**: **Well-Defined** (mostly).

*   **FileWatcher -> Coordinator**: Clear contract via `FileChangeEvent`.
*   **Coordinator -> Router**: Direct method call is simple and effective.
*   **Router -> Parser**: Standard usage.
*   **Coordinator -> Updater**: Actor messaging is appropriate.
*   **Coordinator -> Resolver**: Actor messaging is appropriate.
*   **Circuit Breaker**: The coordination between `Neo4jHealthCheck` and `ValidationCoordinator` (pausing intake) is a robust design pattern.

## Recommendations

1.  **Update Spec P0.5**: Rewrite `RelationshipResolverAdapter` to accept `TsMorphProjectManager` and call the correct `resolveRelationships` method.
2.  **Clarify Cascading Updates**: Explicitly state in Phase 3 whether dependent files are re-queued for *structural* or just *semantic* analysis.
3.  **Approve with Changes**: The spec is solid overall, but the Adapter implementation needs correction before coding starts to avoid immediate build failures.
