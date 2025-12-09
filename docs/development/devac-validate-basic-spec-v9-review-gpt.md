# Review: DevAC Validation Basics v9 Spec

## Overall take
- The spec is strong on intent (two-phase integration, XState cleanup, multi-language fallback) and correctly identifies many existing gaps (missing type files, path drift, XState v5 API changes).
- A few structural inconsistencies and type/data mismatches will block implementation unless reconciled. Most are resolvable by clarifying single sources of truth and aligning with current code paths.

## Strengths
- Phased plan with clear success metrics (tsc/noEmit, build/test, perf target) is actionable.
- Correctly calls out XState v5 changes (function-based actions/guards, done actor type narrowing) and Babel traverse typings.
- Sensible design choice: keep TS/JS fast path incremental while leaving other languages on existing parsers.

## High-priority issues (should be addressed in the spec before coding)
1) PackageInfo type divergence
- Spec introduces a new `PackageInfo` (`src/devac/types/package.ts`) with `relativePath`, dependencies/devDependencies, scripts, etc.
- Current code already exports `PackageInfo` from `src/analyzer/parsers/package-extractor.ts` (fields: name, type, path, version, entryPoint). `ValidationCoordinatorService` currently imports that version.
- If `IncrementalAnalyzer` or `ValidationCoordinatorService` consume the new shape while `PackageExtractor` still returns the old shape, types and data will break (undefined fields at runtime).
- Fix: choose a single canonical `PackageInfo` (prefer updating `package-extractor.ts` + its type) or add a well-defined adapter layer; update imports consistently.

2) ImportResolver duplication and signature drift
- Spec suggests creating `src/resolver/import-resolver.ts` with `resolveImport/resolveModuleSpecifier`.
- Repo already has a full `ImportResolver` class at `src/analyzer/parsers/import-resolver.ts` (async `resolve(importNode, fromFile)` plus alias/tsconfig handling). `validation-coordinator.service.ts` currently imports this existing class.
- Adding a parallel interface will fragment types and omit required behavior (path aliases, workspace packages). Fix: point the spec to the existing resolver; extend it if new methods are required, rather than creating a duplicate.

3) Event/FileChange type overlap
- `src/devac/types/events.ts` already defines `ServiceOperationEvent` with `FILE_CHANGED` carrying `path` and `changeType`.
- Spec adds a new `FileChangeEvent` in `src/devac/types/file-watcher.ts`. Without an explicit mapping, watcher → coordinator wiring may see incompatible shapes (e.g., `type` vs `changeType`). Clarify whether the new type replaces or adapts the existing event type, and document the conversion.

4) Schema/migration pathway mismatch
- Spec says to add indexes to `CONSTRAINTS_AND_INDEXES` and create `src/database/migrations/001-add-semantic-flags.ts`.
- Current schema management uses `schema.ts` with `indexes`/constraints arrays and no `migrations` runner folder. A new migration file will not run unless a runner is added. Also there is no `CONSTRAINTS_AND_INDEXES` symbol.
- Fix: specify how schema updates are applied (extend `indexes` in `schema.ts` and ensure `SchemaManager.applySchema` covers them, or introduce a migration runner and wire it into service startup/tests).

5) Import path in Task 1.2.1 is still wrong
- Spec’s "fixed" import path for `ImportResolver` points to `../../resolver/import-resolver.js`, which does not exist. The correct path is `../../analyzer/parsers/import-resolver.js` (matches existing class). Align all references.

6) IncrementalAnalyzer stubbed ImportResolver
- Spec’s `IncrementalAnalyzer.initialize()` builds an `importResolver` that returns `null`. Downstream semantic resolution depends on real resolution logic. Running with the stub will silently drop relationships. Fix: reuse the real `ImportResolver` and pass packages/workspaceRoot, or state explicitly that this is a temporary stub with a follow-up task.

7) tsconfig nullability
- `findNearestTsConfig` returns `string | null`; `SemanticResolver` currently passes the result directly to `new Project({ tsConfigFilePath })`. Under strict null checks this is unsafe, and even without, ts-morph may error on `null`. Add a guard/behavior when no tsconfig is found (fallback options or explicit error).

## Medium-priority issues / clarifications
- Type error count (103) is cited from prior runs; may have changed on current branch—spec should note it as a target to re-measure.
- Performance target (<50ms structural) is stated, but there is no concrete measurement plan beyond a future perf test. Recommend defining the fixture set and measuring methodology.
- Multi-language fallback relies on `CodeGraphService`’s current full-analysis flow; the spec should explicitly describe how the file watcher routes TS/JS changes to the incremental path while preserving existing error manager/resource manager behaviors.
- New type exports: `src/devac/types/index.ts` currently only exports service/workspace/events/config. Adding file-watcher/package exports will change the public surface—call out any expected downstream impacts.

## Recommended spec edits
- Declare a single source of truth for `PackageInfo`; update `package-extractor.ts` (and its consumers) or add an adapter, but avoid parallel definitions.
- Reuse the existing `ImportResolver` class; extend it if needed instead of creating a new interface in a new path.
- Define the mapping between existing `ServiceOperationEvent.FILE_CHANGED` and the new `FileChangeEvent`, or replace the former; document the shape used by `ValidationCoordinator`.
- Align schema changes with the actual `SchemaManager` mechanism, or specify/introduce a migration runner that will execute the new migration file.
- Fix the import path in Task 1.2.1 to `../../analyzer/parsers/import-resolver.js`.
- Replace the stubbed resolver in `IncrementalAnalyzer` with the real resolver wiring, or mark it as a blocking follow-up before shipping.
- Add null-handling for `tsConfigFilePath` acquisition in `SemanticResolver` and define the fallback behavior.

## Verdict
- The spec is close and directionally correct. Address the type alignment (`PackageInfo`, `ImportResolver`), event shape, and schema/migration wiring to prevent rework and early failures.
