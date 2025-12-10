# DevAC Spec v1.0 Review

## 1. Feasibility
*   **Working Components**: The identified components (`StructuralParser`, `SemanticResolver`, `StorageManager`, `Neo4jClient`) exist and are functional. However, there are interface discrepancies between the TS/JS `StructuralParser` and the other language parsers (e.g., `JavaParser`).
    *   `StructuralParser` (TS/JS) returns a `StructuralParseResult` with `importStrings` and `exportedSymbols`.
    *   `JavaParser` (and others) returns a `SingleFileParseResult` which lacks these specific fields, though it includes `ImportDeclaration` nodes.
*   **Broken Components**: The decision to bypass XState actors is sound given their complexity and current broken state.
*   **Python Parser**: The spec references `src/analyzer/parsers/python-parser.ts`, but the file is actually located at `src/analyzer/python-parser.ts`. This path needs correction.

## 2. Architecture
*   **Two-Phase Parsing**: The architecture is sound. Separating fast structural parsing from slow semantic resolution is the right approach for <200ms feedback.
*   **Data Persistence Gap**: There is a critical gap in how Phase 1 data supports Phase 2.
    *   `StructuralParser` collects `importStrings` but does not convert them into `AstNode` or `RelationshipInfo` objects that `StorageManager` persists.
    *   `SemanticResolver` relies on `[:IMPORTS]` relationships in Neo4j to find dependencies (`findBatchDependencies`).
    *   **Risk**: If Phase 1 does not persist imports (as relationships or properties), Phase 2's dependency resolution will fail or be inefficient.
*   **Component Boundaries**: Clear, but the `LanguageRouter` will need to handle the interface differences between parsers or an adapter layer is required.

## 3. Implementation Phases
*   **Phase 1 (TS/JS)**:
    *   **Critical Task**: Must ensure `StructuralParser` persists imports to Neo4j (e.g., as `IMPORTS` relationships to "unresolved" nodes or as a property on the File node) so Phase 2 can function.
    *   **Interface Alignment**: `StructuralParseResult` needs to be standardized or `StorageManager` adapted.
*   **Phase 2 (Tree-Sitter)**:
    *   The spec assumes existing parsers are ready to plug in. In reality, they return `SingleFileParseResult`. Work is needed to adapt them to the `StructuralParseResult` interface expected by the pipeline.
*   **Phase 3 (Python)**:
    *   Keep-alive process is a good optimization.

## 4. Performance Targets
*   **<200ms Target**:
    *   **TS/JS**: Feasible with `StructuralParser` (in-memory).
    *   **Java/Others**: `JavaParser` currently writes intermediate results to disk (`fs.writeFile` to temp dir). This I/O overhead puts the <200ms target at risk.
    *   **Recommendation**: Modify tree-sitter parsers to return objects directly instead of writing to disk for the "immediate" path.

## 5. Missing Pieces
*   **Interface Standardization**: A shared `StructuralParseResult` interface is defined in `structural-parser.ts` but not exported/used by other parsers. This needs to be centralized in `types.ts`.
*   **Atomic Updates**: The spec mentions deleting old nodes. This requires careful query design to avoid leaving dangling relationships or deleting shared nodes. The `OWNS` relationship is a good candidate for identifying nodes to delete.
*   **Error Handling**: No strategy defined for partial failures (e.g., Phase 1 succeeds, Phase 2 fails).
*   **Concurrency**: Handling rapid updates to the same file (debouncing/cancellation) is not detailed.

## 6. Integration Points
*   **FileWatcher → LanguageRouter**: Straightforward.
*   **LanguageRouter → Parser**: Needs to handle different parser signatures/return types until standardized.
*   **Parser → StorageManager**: `StorageManager` currently handles `AstNode[]` and `RelationshipInfo[]`. It does *not* handle `importStrings` from `StructuralParseResult`. This integration point is currently broken for imports.

## Recommendations
1.  **Fix Import Storage**: Update `StructuralParser` to convert `importStrings` into `ImportDeclaration` nodes (like `JavaParser` does) or `IMPORTS` relationships so `StorageManager` can save them.
2.  **Standardize Interfaces**: Move `StructuralParseResult` to `src/analyzer/types.ts` and update all parsers to return it.
3.  **Remove Disk I/O**: Refactor `JavaParser` (and others) to avoid writing temp files.
4.  **Correct Paths**: Fix the Python parser path in the spec.
