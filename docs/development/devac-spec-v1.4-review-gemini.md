# DevAC Spec v1.4 Review (Gemini)

## 1. Feasibility Assessment

**Verdict: HIGH**

The specification is grounded in the actual state of the codebase.
*   **"Broken" Components**: Confirmed. `ValidationCoordinatorActor` and others have incorrect imports (e.g., `../types/file-watcher.js`) and XState v5 typing issues. The count of ~103 errors appears accurate based on a sampling of the files.
*   **"Working" Components**: Confirmed. `Neo4jClient` and `StructuralParser` are present and functional. Crucially, `StructuralParser` uses `@babel/parser` (not `ts-morph`), making the <150ms performance target highly feasible.
*   **New Components**: The spec correctly identifies `LanguageRouter` and `TreeSitterAdapter` as missing files that need creation.

## 2. Architecture Review

**Verdict: SOUND**

*   **Single Orchestrator**: The `ValidationCoordinatorActor` as the central point of control is the correct pattern for managing the complexity of file events, reconciliation, and graph updates. It avoids the "split brain" issues of previous designs.
*   **Two-Phase Parsing**: The separation of Structural (Babel/Tree-sitter) and Semantic phases is preserved. This is essential for performance, allowing immediate graph updates for structure while deferring expensive type resolution.
*   **LanguageRouter**: Introducing this component provides a clean abstraction layer, decoupling the orchestrator from specific parser implementations.
*   **GraphUpdater vs StorageManager**: The explicit decision to keep these separate (Atomic vs Batch) is architecturally mature and addresses the specific needs of incremental updates vs full scans.

## 3. Implementation Phases

**Verdict: LOGICAL & CORRECT**

*   **Phase 1 (Fixes)**: Prioritizing the 103 TS errors is the only way forward. You cannot build on broken foundations.
*   **Phase 2 (Core Integration)**: Building the `LanguageRouter` and `ValidationCoordinator` logic before adding more languages is the right order.
*   **Phase 3 (Languages)**: Adding languages one by one after the core pipeline is stable minimizes risk.
*   **Phase 4 (Polish)**: Leaving optimization and full testing for the end is standard, though I would suggest moving "Integration smoke tests" earlier into Phase 2 (which is already there, good).

## 4. Performance Targets

**Verdict: REALISTIC**

*   **TS/JS < 150ms**: **Achievable.** Since `StructuralParser` uses `@babel/parser`, parsing is negligible (~20ms). The remaining 130ms is sufficient for a local Neo4j write transaction.
*   **Tree-sitter Languages < 200ms**: **Achievable.** Tree-sitter is highly optimized.
*   **Python < 400ms**: **Acceptable.** Spawning a subprocess is expensive. The 400ms target acknowledges this reality without over-engineering a persistent worker for v1.4.

## 5. Missing Pieces & Risks

While the spec is "Implementation-Ready", a few areas need attention during development:

1.  **Semantic Phase Detail**: The spec focuses heavily on the Structural phase. The Semantic phase (Pass 2) is mentioned ("SemanticResolverActor.enqueue()"), but the mechanism for triggering it *after* a batch of structural updates is less defined. There's a risk of the semantic queue backing up or not triggering correctly.
2.  **Tree-Sitter Uniformity**: The spec assumes existing parsers in `src/analyzer/parsers/` can be easily adapted. If they have divergent interfaces, the `TreeSitterAdapter` might become complex.
3.  **Rollback/Consistency**: The spec notes "No graph versioning". If a rename operation (which might be modeled as delete+add or a specific rename op) fails halfway, the graph could be left in an inconsistent state. The `rename` optimization in P1 helps, but true transactional safety across multiple nodes is tricky.
4.  **Dependency Updates**: The architecture diagram shows `AffectedCalculatorActor`, but the spec doesn't detail *how* it determines affected files. If file A changes, does file B (which imports A) get re-analyzed? This is critical for semantic correctness but might be out of scope for the "Structural" focus of v1.4.

## 6. Integration Points

**Verdict: WELL-DEFINED**

*   **FileWatcher → Coordinator**: Clear event flow.
*   **Coordinator → LanguageRouter**: Direct method call (good for latency).
*   **Coordinator → GraphUpdater**: Actor messaging (good for isolation).
*   **Startup Reconciliation**: The "Event Buffering" mechanism is a critical addition that solves the race condition between watcher startup and initial scan.

## Conclusion

This is a solid, well-thought-out specification. It addresses the technical debt (TS errors) while establishing a performant architecture for incremental updates. The use of Babel for TS/JS parsing is the key enabler for the performance goals.

**Recommendation**: Proceed with implementation immediately, following the 17-day timeline.
