# DevAC Spec v1.2 Review

## 1. Feasibility Assessment
**Status: High**

The specification accurately reflects the current state of the codebase.
- **Component Verification**: The "broken" components (`ValidationCoordinatorActor`, `GraphUpdaterActor`, etc.) exist in `src/devac/actors/` and `src/devac/services/`.
- **Error Counts**: The reported error counts (e.g., 37 in `validation-coordinator.actor.ts`) align with a codebase undergoing a major refactor (XState v5 migration).
- **Dependencies**: The missing `@types/babel__traverse` is confirmed by the content of `src/analyzer/structural-parser.ts`, which relies heavily on Babel.

## 2. Architecture Review
**Status: Sound**

The decision to use a **Single Orchestrator (`ValidationCoordinatorActor`)** instead of a separate pipeline is architecturally sound and simplifies state management.
- **Two-Phase Parsing**: The separation of "Structural" (fast, AST-only) and "Semantic" (slow, resolution) is the correct approach for an interactive tool requiring <200ms latency.
- **State Management**: Using XState for the coordinator allows for robust handling of race conditions and error states, which is superior to ad-hoc promise chaining.
- **Data Flow**: The flow `FileWatcher -> Coordinator -> LanguageRouter -> GraphUpdater` is logical and minimizes coupling.

## 3. Implementation Phases
**Status: Logical, but aggressive**

The phased approach is correct, prioritizing the broken build.
- **Phase 1 (Fix TS Errors)**: Absolutely critical. The system cannot be tested until it compiles.
- **Phase 2 (Core Integration)**: Introducing `LanguageRouter` early is the right move to decouple the coordinator from specific parsers.
- **Phase 3 (Tree-Sitter)**: Deferring this allows focusing on the "happy path" for TS/JS first.
- **Timeline**: 10-12 days is realistic *if* the developer is familiar with XState v5. If not, the "Fix TS Errors" phase might drag on due to the complexity of actor typing.

## 4. Performance Targets
**Status: Optimistic but Achievable**

- **TS/JS < 100ms**: `src/analyzer/structural-parser.ts` uses `@babel/parser`, which is extremely fast. The bottleneck will likely be the Neo4j write transaction, not the parsing. 100ms is achievable for the *parse*, but end-to-end latency (including DB commit) might hover around 150-200ms on standard hardware.
- **Python < 300ms**: Using a subprocess for every file parse is heavy. The "keep-alive" process mentioned as a future optimization will likely be needed sooner than later if the user edits rapidly.

## 5. Missing Pieces & Risks

### A. Testing Strategy
The spec mentions "Integration smoke tests" but lacks detail on **Unit Testing Actors**.
- **Risk**: XState actors are complex. Testing them requires a specific harness (`@xstate/test` or similar).
- **Recommendation**: Add a specific task in Phase 1 to set up an Actor Test Harness.

### B. Database Resilience
The spec covers "Startup Reconciliation" well, but misses **Runtime Disconnection**.
- **Scenario**: What if the Neo4j container restarts or the connection drops while the watcher is running?
- **Risk**: The `GraphUpdaterActor` might crash or hang.
- **Recommendation**: Add a `CheckConnection` state or retry logic in the `GraphUpdaterActor`.

### C. Language Router Complexity
The `LanguageRouter` needs to unify two very different worlds:
1.  `StructuralParser` (Babel-based, returns `StructuralParseResult` directly).
2.  `TreeSitter` parsers (currently in `src/analyzer/parsers/`, likely return different structures).
- **Risk**: The `TreeSitterAdapter` might be more complex than anticipated to map generic TreeSitter nodes to the specific `StructuralParseResult` interface.

## 6. Integration Points
The connections are well-defined, but the **LanguageRouter** interface is the linchpin.

- **Current**: `ValidationCoordinator` calls `LanguageRouter.parse(filePath)`.
- **Requirement**: `LanguageRouter` must abstract away the fact that TS/JS uses `StructuralParser` (Babel) while Java uses `JavaParser` (Tree-sitter).
- **Verification**: Ensure `StructuralParseResult` is generic enough to hold data from both Babel and Tree-sitter without losing critical language-specific metadata.

## Conclusion
The spec is solid and ready for implementation. The primary risks are the complexity of XState v5 typing and the potential overhead of Neo4j transactions in the hot path.

**Approval**: **APPROVED** with the recommendation to add explicit Actor unit tests in Phase 1.
