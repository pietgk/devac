# DevAC Spec v1.6 Review (Gemini)

**Date**: 2025-12-10
**Reviewer**: Gemini (AI Assistant)
**Status**: **ENDORSED** with minor cautions regarding Phase 3 timing.

---

## 1. Feasibility
**Rating: High**

The shift to "Phase 0: Verification" is the single most important change in this spec. By explicitly acknowledging that previous specs were written against assumed code states rather than actual code states, this spec drastically increases its feasibility.

*   **Working vs. Broken**: The categorization is accurate. Identifying the `ValidationCoordinatorActor` as a full pipeline orchestrator rather than just a graph updater is a critical correction.
*   **Scope Narrowing**: Deferring the "Validation Execution" (running `npm run validate`) is the correct decision. It decouples the graph maintenance problem from the script execution problem.

## 2. Architecture
**Rating: Strong**

The proposed architecture is pragmatic and addresses the "technical debt" of type mismatches without requiring a rewrite.

*   **Adapter Pattern**: The `parse-result-adapter.ts` solution is excellent. It isolates the messiness of the type mismatch (`startLine` vs `line`, etc.) from the core logic. This is much safer than trying to refactor the entire `GraphUpdaterActor` or `StructuralParser` at this stage.
*   **Language Router**: Introducing `LanguageRouter` is necessary. It provides a clean extension point for the tree-sitter languages without polluting the coordinator.
*   **Cross-File Strategy**: The "Accept and Regenerate" strategy for cross-file relationships is a reasonable trade-off for v1.6. It accepts temporary inconsistency (stale incoming edges) in exchange for implementation simplicity and performance.

## 3. Implementation Phases
**Rating: Good (Phase 3 is aggressive)**

*   **Phase 0 & 1 (Verification & Fixes)**: These are well-planned. 7 days to get to a clean build is realistic given the 103 errors.
*   **Phase 2 (Core Integration)**: 7 days for the core loop is reasonable.
*   **Phase 3 (Tree-Sitter)**: **RISK**. Wiring up 6 languages (Java, Go, C/C++, C#, Python) in 4 days (Days 15-18) is very optimistic. While the *pattern* is the same, each language's tree-sitter grammar often has unique AST structures that may require specific mapping logic in the adapter.
    *   *Recommendation*: Be prepared to slip Phase 3 or reduce the language set for the initial v1.6 release if issues arise.
*   **Phase 4 (Polish)**: Standard.

## 4. Performance Targets
**Rating: Realistic**

*   **<300ms Target**: For the structural update (Pass 1), this is highly achievable. The atomic delete+create operation in Neo4j is fast.
*   **Bottlenecks**: The main bottleneck will likely be the `SemanticResolver` queue if a large refactor touches many files. However, since this is decoupled from the initial "File Changed" acknowledgment, the system will *feel* responsive.

## 5. Missing Pieces & Risks

*   **Concurrency Control**: The spec mentions "Add per-file mutex" on Day 12. This is critical. If `FileWatcher` fires rapidly (e.g., "Save All"), we need to ensure we don't have race conditions in the `GraphUpdater`.
*   **Tree-Sitter Adapter Complexity**: The spec assumes a generic `tree-sitter-adapter.ts` will work for all languages. In practice, mapping tree-sitter nodes to the `StructuralParseResult` format (which seems tailored to TS/JS concepts like "imports" and "exports") might be tricky for languages like C++ or Go where these concepts map differently.
*   **Stale Edge Visibility**: There is no mechanism described to warn consumers that the graph might be in a "stale incoming edge" state. This is acceptable for internal tools but might be confusing if a user queries the graph during a heavy update cycle.

## 6. Integration Points
**Rating: Clear**

*   **FileWatcher → Coordinator**: Standard.
*   **Coordinator → LanguageRouter**: Clean interface (`parse(filePath)`).
*   **Router → Adapters**: This is the key integration point. The success of the project depends on the quality of `parse-result-adapter.ts` and `tree-sitter-adapter.ts`.

## Conclusion

This is a solid, implementation-ready spec. The "Phase 0" verification step prevents the "spec-fixing-spec" loop that plagued previous versions. The architecture favors pragmatism (adapters) over purity (rewrites), which is the right choice for getting v1.6 shipped.

**Approval**: Proceed with Phase 0 immediately.
