# Review: devac-validate-basics-spec-v9.3

## Overall assessment
- The spec fixes several real problems (wrong import paths, duplicated types, missing Babel traverse types) and documents canonical locations clearly.
- However, multiple sections conflict with the current codebase shape (class exports vs. assumed actors, BaseService lifecycle, existing state machine behavior), and some targets/claims are unverified or incomplete.
- Address the issues below before implementation to avoid regressions and unbuildable states.

## High-risk issues
1. **ValidationCoordinator export mismatch (spec Sections 3.2 & 4.2):** The spec imports `validationCoordinatorActor` from `src/devac/actors/validation-coordinator.actor.ts`, but that file exports only a `ValidationCoordinatorService` class (no `validationCoordinatorActor` const). The canonical service snippet in 4.2 will not compile as written; the spec must decide whether to refactor the actor file to export a machine or adjust the service to use the existing class.
2. **State-machine regression risk (Section 3.2 XState migration):** The provided replacement machine removes major behavior present in the current implementation (affected calculation, validation execution, degraded recovery, batching). Adopting the simplified machine would drop features and observability; the spec should list required parity items or scope this as a rewrite with acceptance criteria.
3. **IncrementalAnalyzer integration plan (Section 7.1/7.2) conflicts with BaseService lifecycle:** `CodeGraphService` today extends `BaseService` and manages `AnalyzerService`, `FileWatcher`, and resource/error managers. The spec adds a new IncrementalAnalyzer but omits how it cooperates with the existing watcher, BaseService `scan/process` flow, and resource/error tracking. Without a concrete integration plan (who owns the watcher, how events reach IncrementalAnalyzer, shutdown order), this section is underspecified and high-risk.
4. **Actor/service duplication cleanup lacks dependency updates:** The spec says to delete the `ValidationCoordinatorService` class inside the actor file and keep the service version, but does not enumerate all references that currently import the actor-class version (e.g., `src/devac/config/README.md`). Without those call sites updated, builds/docs will break.
5. **New Neo4j flags/indexes not wired (Section 6):** Adding schema indexes and StorageManager helpers for `structuralComplete/semanticComplete/semanticQueued` lacks integration points. Current graph-updater/semantic-resolver actors never set these properties, so the indexes would stay empty and queries in `validation-coordinator.actor.ts` that depend on them would still fail. The spec needs explicit write/read touchpoints.
6. **ImportNode mapper defaults may misresolve imports (Section 5):** `createImportNode` defaults `name` to `"default"` and `isDefault` to true when no context is provided. Because `StructuralParser` only emits raw strings, every import would be treated as a default import, which is incorrect for the common named-import case and can misguide ImportResolver. The spec should either require StructuralParser to emit import context or set conservative/unknown flags.
7. **Performance targets conflict with current design:** StructuralParser currently documents a `<200ms` target; the spec demands p90 `<50ms` without providing measurement harness changes or evidence this is achievable. This sets an unvalidated acceptance bar and should either be justified with current benchmarks or relaxed.
8. **Unverified baseline metrics:** Claims of “103 TypeScript errors” and “707 tests” are stated as facts but not validated against the repository. The spec should require measuring current counts before using them as success criteria.

## Medium/operational gaps
- New StorageManager methods (Section 6.2) lack tests, concurrency guarantees, and are not invoked from existing pipeline stages.
- Proposed new files/tests in Section 10 (integration/perf/E2E) omit fixtures and data requirements, making effort estimates unreliable.
- Schema changes add new boolean/timestamp fields without migration/backfill guidance; existing nodes will have nulls, which may break queries expecting booleans.
- The spec repeats “XState v5 migration” although the current code already uses xstate v5 APIs; clarify actual delta (typing cleanup vs. state redesign).
- `createImportNodes`/mapper section duplicates logic already implied in IncrementalAnalyzer.resolveImports; consider consolidating to avoid drift.

## Recommendations
- Decide and document the authoritative ValidationCoordinator shape (class vs. machine export) and list all call sites to update; include tests/docs impact.
- Provide an integration diagram for IncrementalAnalyzer within `CodeGraphService`/BaseService (event flow, ownership of FileWatcher, shutdown semantics).
- Specify where structural/semantic completion flags are written/read (graph-updater, semantic-resolver) and add acceptance checks for those writes.
- Revise ImportNode mapping to represent unknown/default-less cases accurately, or extend StructuralParser to emit import metadata the mapper can consume.
- Revisit performance/test/error targets after measuring current baselines; include measurement scripts in the spec if targets stay.
