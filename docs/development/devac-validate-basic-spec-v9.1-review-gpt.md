# DevAC Validate Basics Spec v9.1 - Review (GPT)

**Reviewer**: GPT-5.1-Codex-Max (Preview)  
**Date**: 2025-12-09  
**Spec Version**: 9.1 (with-fixes)  
**Status**: **Critical corrections required before implementation**

---

## Executive Summary

The `v9.1` spec resolves several prior blockers (duplicate coordinator, missing migration runner, XState v5 string actions/guards). But it still contains **blocking API mismatches** with existing code that will prevent compilation and misguide implementation. The largest issues involve `PackageExtractor`, `ImportResolver`, and the schema index shape.

---

## Critical Issues

### 1) `PackageExtractor` API Mismatch
- **Spec assumes**: `new PackageExtractor()` (no args) and `extractPackages(dir)`.
- **Actual code** (`src/analyzer/parsers/package-extractor.ts`): constructor requires `workspaceRoot: string`; method is `discoverPackages(): Promise<PackageInfo[]>`.
- **Impact**: CodeGraphService wiring (Phase 2.5) will not compile; runtime discovery won’t occur.
- **Fix**: `const pkgExtractor = new PackageExtractor(this.getPrimaryDirectory()); const packages = await pkgExtractor.discoverPackages();`

### 2) `ImportResolver` API Mismatch
- **Spec assumes**: `new ImportResolver(workspaceRoot, tsConfigPath?)` and `resolveImport(path, fromFile): string | null`.
- **Actual code** (`src/analyzer/parsers/import-resolver.ts`): constructor signature `(packages: PackageInfo[], workspaceRoot: string, tsConfigPaths?: Record<string,string[]>)`; method `resolve(importNode, fromFile): Promise<ResolvedImport | null>`.
- **Impact**: IncrementalAnalyzer and any `resolveImport` calls will fail to type-check; wrong return type handled.
- **Fix**: Pass `packages` into constructor; call `await importResolver.resolve(importNode, fromFile)` and handle `ResolvedImport` result shape.

### 3) Schema Index Shape Error
- **Spec instructs** adding object entries (`{ type, label, property }`) to `indexes` array.
- **Actual code** (`src/database/schema.ts`): `indexes` is an array of Cypher strings. Mixing objects will break schema application.
- **Fix**: Append Cypher strings, e.g. `CREATE INDEX file_structural_complete_idx IF NOT EXISTS FOR (n:File) ON (n.structuralComplete)`.

### 4) ValidationCoordinator Refactor Understated
- Spec shows a machine export (`const validationCoordinatorActor = setup(...).createMachine(...)`), but current file exports a class-based service and there is a duplicate class in `src/devac/actors/validation-coordinator.service.ts` vs `services/`.
- **Impact**: This is a nontrivial refactor (API surface changes). Needs explicit plan and effort call-out.

### 5) FileWatcher Import Path Drift
- Spec correctly points to `src/devac/services/codegraph/file-watcher.ts`, but actors still import `../types/file-watcher.js` (nonexistent). Needs to be fixed in code during implementation.

### 6) ImportResolver Usage Contract Unspecified
- Spec doesn’t describe how structural parse output maps to `ImportNode` required by `resolve(...)`. Without this, semantic resolution will fail silently.

---

## Verified Improvements
- ✅ Uses `src/devac/services/codegraph/file-watcher.ts` as source of truth for `FileChangeEvent`.
- ✅ Avoids non-existent migration runner; aligns on adding indexes directly in `schema.ts`.
- ✅ Flags XState v5 string action/guard requirements.
- ✅ Calls out consolidation of duplicate `ValidationCoordinatorService`.

---

## Recommendations
1) **CodeGraphService & IncrementalAnalyzer**: Construct `PackageExtractor` with `workspaceRoot`; call `discoverPackages()`. Pass `packages` into `ImportResolver` constructor.
2) **ImportResolver calls**: Replace `resolveImport` usage with `await resolve(importNode, fromFile)` and consume `ResolvedImport` shape.
3) **Schema indexes**: Append Cypher strings to `indexes` in `src/database/schema.ts`, not object literals.
4) **Coordinator refactor**: Plan the class→machine export change explicitly; remove duplicate actor/service file.
5) **FileWatcher imports**: Update actor/service imports to `../services/codegraph/file-watcher.js`.
6) **Document ImportNode mapping**: Specify how structural parsing produces `ImportNode` for the resolver.

---

## Overall Assessment
- **Correctness**: 70% (major API gaps remain)
- **Readiness**: Blocked until API mismatches and schema shape are corrected
- **Next Step**: Patch spec with the fixes above, then proceed with implementation.
