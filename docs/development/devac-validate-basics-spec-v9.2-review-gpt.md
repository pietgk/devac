# Review of devac-validate-basics-spec-v9.2

## Summary
The spec captures several real API contracts (ImportResolver, PackageExtractor, StructuralParser) and correctly notes the shift to an `indexes` array of Cypher strings. However, it overstates “Ready for Implementation” and “all critical API mismatches fixed”—multiple referenced files still diverge from the described state, and some guidance conflicts with existing code or omits edge cases. Below are the main issues and suggested actions.

## Accuracy gaps vs current codebase
- **ValidationCoordinatorService imports still wrong:** The spec claims FileChangeEvent imports were fixed, but `src/devac/services/validation-coordinator.service.ts` still imports from `../types/file-watcher.js` (a path that doesn’t exist) and uses `../actors/*` paths that differ from the new locations (spec §1.2–1.3). This contradicts the “verified” claim and leaves build-breaking imports.
- **Constructor/API mismatch for ValidationCoordinatorService:** The spec proposes a config-object constructor and `getStatus()` API (Phase 2.2) yet the actual class constructor is positional `(neo4jClient, structuralParser, importResolver, packages)` with no status helper. Any new `IncrementalAnalyzer` using the spec’s API will not compile without refactoring the service first.
- **StructuralParser typing still missing:** The spec states Babel traverse callbacks should be typed and “verified,” but `src/analyzer/structural-parser.ts` still uses untyped `path` callbacks. Type-safety remains unresolved.
- **FileChangeEvent location vs usage:** Interface exists at `src/devac/services/codegraph/file-watcher.ts` as described, but no consumers have been updated; the existing imports point to non-existent `../types/file-watcher.js`. The import patterns table is aspirational, not current.
- **Schema indexes:** The document correctly notes the array is named `indexes`, but the suggested new indexes for structural/semantic flags are not present. Also, the current file already creates per-label `filePath` and `name` indexes; adding more without evaluating overlap could create redundant indexes or unnecessary write overhead.

## Architectural/consistency concerns
- **Dual service definitions:** The spec includes two different ValidationCoordinatorService shapes (existing and proposed). It’s unclear whether to preserve the current actor-based service or replace it; without migration steps, contributors risk creating divergent implementations.
- **IncrementalAnalyzer plan assumes a refactored coordinator:** The proposed `IncrementalAnalyzer` wires the coordinator with a new options object and assumes `getStatus()` and `start()` methods exist in the service, which they currently do not. The plan should specify required refactors before adding the new integration layer.
- **ImportNode mapping defaults to “default”:** The mapping helper always sets `name: "default"` / `isDefault: true`, which will misrepresent named imports and may resolve to incorrect files/exports in the semantic phase. Guidance should either parse real specifiers or clarify that this is a temporary placeholder with follow-up resolution.

## Completeness and feasibility issues
- **Performance targets lack measurement plan:** p90 <50ms structural / <500ms semantic are listed as “targets” but no instrumentation, fixtures, or baselines are provided beyond a single micro-benchmark outline. The doc should state how to capture metrics (hardware, sample size, warm-up) and what to do on regression.
- **Test coverage figure unclear:** “Test coverage: 707 / 707+” appears to be a test-count target, not coverage percentage, and is not tied to specific suites. Clarify whether this is number of tests, lines/branches, or a gating threshold.
- **Verification commands are partial:** Grepping for interface names or `discoverPackages` may miss namespaced/aliased imports; the commands also assume `grep` availability and will return non-zero exit codes on `tsc` failures, potentially halting pipelines unless wrapped.
- **Checklist timelines vs scope:** Weeks 2–4 require new integration layers, service refactors, schema changes, and multi-language tests; this seems aggressive without explicit dependency ordering or rollback/flag strategy.

## Recommendations
1. **Clarify current vs desired state:** Mark which sections describe existing code (verified) versus planned changes. Remove “verified” from items that are not yet implemented (e.g., ValidationCoordinator imports, StructuralParser typing).
2. **Sequence refactors:** Explicitly require refactoring `ValidationCoordinatorService` before introducing `IncrementalAnalyzer`, or adjust the analyzer to the existing constructor signature and add `getStatus()` separately.
3. **Fix FileChangeEvent imports first:** Update all consumers to import from `../services/codegraph/file-watcher.js` (actors) or `./codegraph/file-watcher.js` (services) and add a lint/check to prevent regressions.
4. **Improve ImportNode mapping guidance:** Document how to derive `name`, `isDefault`, and `isTypeOnly` from actual import statements; note limitations of the placeholder approach.
5. **Strengthen validation criteria:** Define performance measurement methodology, clarify the “707+” metric, and expand verification commands to be CI-safe (e.g., use `|| true` with explanatory checks).
6. **Schema change review:** Evaluate new indexes for overlap with existing per-label indexes; specify expected read/write impact and how to clean up if unnecessary.
