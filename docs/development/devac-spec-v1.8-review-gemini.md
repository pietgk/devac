# Review of DevAC Spec v1.8

**Reviewer**: Gemini (via GitHub Copilot CLI)
**Date**: 2025-12-10
**Target Spec**: `docs/development/devac-spec-v1.8.md`

## 1. Feasibility Assessment

The specification accurately reflects the current state of the codebase.

*   **Component Identification**: The distinction between working components (`StructuralParser`, `Neo4jClient`) and those needing work (`ValidationCoordinatorActor`, `RelationshipResolver`) is correct.
*   **"Broken" Components**:
    *   `ValidationCoordinatorActor` exists but has significant import path issues (e.g., referencing `../types/file-watcher.js` instead of the actual service location) and likely type errors, confirming the need for Phase 1.
    *   `RelationshipResolver` constructor signature (`allNodes: AstNode[], pass1Relationships: RelationshipInfo[]`) is indeed incompatible with the proposed actor instantiation, validating the need for the `RelationshipResolverAdapter` in Phase 0.5.
*   **Missing Components**: The `LanguageRouter` and `src/pipeline` directory are correctly identified as missing.

**Verdict**: High feasibility. The spec addresses actual, verified gaps in the codebase.

## 2. Architecture Review

The proposed architecture is sound and aligns with the performance goals.

*   **Two-Phase Parsing**: The separation into Structural (Babel-based, fast) and Semantic (Resolution-based, slower) phases is preserved and reinforced. This is critical for the <500ms target.
*   **Component Boundaries**:
    *   **LanguageRouter**: Introducing this component is excellent for extensibility (Tree-sitter support) and decoupling the actor from specific parsers.
    *   **Adapters**: Using adapters (`ParseResultAdapter`, `RelationshipResolverAdapter`) is a pragmatic approach to bridge the gap between the new actor-based system and the existing analyzer logic without a full rewrite.
*   **Transaction Management**: The "Single Transaction" principle (P0.1) is the correct architectural choice for data integrity, preventing "zombie" nodes.

**Risk**: The management of the `ts-morph` `Project` instance within the `SemanticResolverActor` (or via the adapter) is not fully detailed. Incremental updates to the `ts-morph` project (updating just the changed source file) are crucial for performance. If the project is re-initialized or re-parsed entirely, the performance target will be missed.

## 3. Implementation Phases

The phasing is logical and addresses dependencies correctly.

*   **Phase 0.5 (API Reconciliation)**: This is a critical addition. Without it, Phase 1 would be blocked by structural type mismatches.
*   **Phase 1 (TS Errors)**: Essential cleanup. The current state of `ValidationCoordinatorActor` suggests it's non-functional until these are resolved.
*   **Phase 2 (Core Integration)**: The ordering (Router -> Mutex -> Neo4j) makes sense.
*   **Phase 3 (Tree-sitter)**: Deferring this allows focus on the core TS/JS pipeline first.

**Observation**: The timeline (26 days) is aggressive but achievable if the "Exit Gates" are strictly enforced.

## 4. Performance Targets

*   **<100ms Structural Parse**: Highly realistic using `StructuralParser` (Babel).
*   **<300ms Graph Update**: Achievable with batched writes and APOC. Without APOC, the fallback might struggle with large files, but the fallback strategy is sound.
*   **<500ms Total**: This leaves ~100ms for overhead (FileWatcher, Actor messaging, Mutex). This is tight but possible.

**Concern**: The "Warm Cache" assumption for total latency implies the `ts-morph` project is already loaded. Cold start times will be significantly higher, which is acknowledged in the spec (<3s).

## 5. Missing Pieces & Risks

*   **`ts-morph` Incremental Strategy**: The spec doesn't explicitly detail how the `SemanticResolverActor` updates the `ts-morph` `Project` object when a file changes. Does it call `project.getSourceFile(path).refreshFromFileSystem()`? This detail is vital for the semantic phase.
*   **Directory Structure**: The spec implies a `src/pipeline` directory which doesn't exist. The implementation plan should explicitly include creating this structure.
*   **Testing Strategy**: While `npm test` is mentioned, specific integration tests for the *incremental* aspect (e.g., "modify file X, verify only X and its dependents are updated") are crucial and should be emphasized in Phase 2.

## 6. Integration Points

*   **FileWatcher → Actor**: The glue code (P1.2) is well-defined.
*   **LanguageRouter → Parser**: Clear interface.
*   **Actor → Neo4j**: The `GraphUpdaterActor` interface is clear, and the transaction logic is robust.

## Conclusion

The spec is **APPROVED** with the following recommendation:

*   **Add Detail on `ts-morph` Lifecycle**: In Phase 2 or Phase 0.5, explicitly define how the `ts-morph` `Project` instance is maintained and updated incrementally to avoid full re-parsing.

The plan is solid and ready for implementation.
