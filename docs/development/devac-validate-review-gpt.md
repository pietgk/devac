# DevAC Validation System – Repository and Spec Review (GPT)

## Repo Baseline
- `src/devac/services/` shows the current orchestration relies on coarse-grained command runners (`TypeCheckService`, `LintService`, `TestService`) that operate at repository scope and have no notion of dependency-driven scoping; `TypeCheckService` in particular still shells out to `tsc` per repo and lacks watch-mode integration.
- The `CodeGraphService` already streams file system events (`FileWatcher`) but still re-executes a full `AnalyzerService` scan on every change, confirming the motivation stated in the spec (no incremental persistence, heavy reprocessing).
- Neo4j usage today centers on AST extraction and collection metadata; there is not yet a schema for packages, configs, or validation history. The driver plumbing is mature, but higher-level abstractions for graph updates appear manual and imperative.
- Test coverage is concentrated around the CodeGraph service internals; there is little to no automation around validation orchestration, which will complicate verifying the new change-impact logic.
- Docs in `docs/development/` are detailed and aspirational, but there is a gap between documentation and currently shipped behavior (e.g., plans mention TypeScript incremental support that is not yet present in code). Overall code quality is solid, but there is significant technical debt around incrementalism and dependency resolution that the new plan must address explicitly.

## Concept Evaluation
- Leveraging Neo4j as the single source of truth for dependency and configuration data is compelling: the project already invests in rich AST extraction, so reusing the graph for validation scoping is a natural extension and differentiates DevAC from tooling like Nx or Turborepo which build their own in-memory graphs.
- The approach aligns with the guiding principle of “never validate unchanged code twice”; the batching and cache ideas mirror proven patterns in Bazel/Nx/Turborepo and should materially improve feedback loops if the dependency graph is sufficiently accurate.
- A key conceptual risk is that TypeScript, ESLint, and test runners all have global or project-level semantics. Running them on narrow slices (per file) only works when the tooling natively supports that mode. The spec assumes per-file `tsc --noEmit` is sufficient, but TypeScript’s CLI ignores project references and compiler options in that mode, so the concept could produce false negatives. Without a precise plan to use `tsc --build --incremental`, Project References, or the language service API, the intended granularity may not be achievable.
- Relying on Neo4j change impact presumes near-perfect graph completeness. The current extractor reports only 68% coverage and lacks config/package/test nodes. Until coverage gaps are closed, the system must bias toward safety (falling back to larger scopes), otherwise it risks skipping necessary validation. The concept is solid, but success hinges on graph accuracy being production-grade.

## Specification Review (`docs/development/devac-validate-spec.md`)
- The specification is exhaustive and clearly articulates motivation, data gaps, desired schema extensions, and operational flows. It demonstrates strong awareness of industry precedents (Nx, Turborepo, Bazel), which lends confidence in the overarching direction.
- Strengths:
  - Thorough dependency taxonomy (file, package, config, test, validation history) with Cypher snippets that are implementable in Neo4j.
  - Realistic change detection strategies (watcher, git diff, manual full sync) and batching heuristics.
  - Appreciation of config fan-out (tsconfig, ESLint) and fallbacks (daily full validation, feature flags) to maintain correctness guarantees.
  - Performance considerations (indexes, batch windows, caching, depth limits) and observability metrics are thoughtful.
- Concerns / observations:
  - TypeScript strategy: The spec suggests running typecheck only on changed files when isolated, but `tsc` cannot accurately type-check a single file without compiling its dependencies. Any per-file run misses type relationships (e.g., updating a type alias used elsewhere). The spec acknowledges transitive traversal for affected sets but still proposes `runTypeCheck([file])` for isolated cases. This is likely unsound unless the plan integrates the TypeScript server API or project references. Needs clarification.
  - Import resolution: Resolving to node modules (`resolvePackageImport`) assumes the analyzer has visibility into installed packages. Persisting `IMPORTS_FILE` edges into `node_modules` is expensive and may explode the graph. There is no mitigation for optional peer dependencies or conditional exports.
  - Config tracking: Mapping `affectsFilePatterns` from tsconfig include/exclude is simplistic. TypeScript includes many implicit root files (e.g., via `compilerOptions.files`, `references`, or default `**/*.ts`). Without replicating the compiler’s resolution logic, the `USES_CONFIG` relationships may become inaccurate, forcing conservative fallbacks.
  - Test relationships: The heuristic-based discovery covers only conventional naming patterns. For projects using custom test discovery (Jest projects with dynamic requires, vitest `import.meta.glob`, React Native `*.spec.ts` co-located in packages), the approach risks false negatives. The spec should plan for integrating with existing test runner metadata or require manual mapping.
  - Validation history caching: The plan stores per-file hashes in Neo4j and marks runs as `cached` if hashed results match. However, type errors often originate in files other than the edited one. Caching success per file risks missing cross-file errors if only one dependent changed. A more robust cache should hash the set of inputs per scope (similar to Nx/Turborepo task hashing) rather than individual files.
  - Success metrics are ambitious (80-95% reduction, <5s feedback). Without benchmarking current analyzer latency and tsc execution times, these targets could prove unrealistic, especially in repositories with thousands of TS files.

## Implementation Plan Review (`docs/development/devac-validate-implementation-plan.md`)
- Phase 1 (Graph schema):
  - Repository discovery via globbing `package.json` is feasible, but the plan does not discuss pnpm/pnpm-workspace.yaml or yarn workspaces, which govern package boundaries. Simply globbing will misclassify nested example apps or tool directories.
  - ImportResolver pseudo-code still calls `resolvePackageImport` that presumably resolves into `node_modules`. The plan omits how to handle ambiguous extensions (`.ts` vs `.tsx`, index files) or TypeScript path aliases defined in tsconfig—although Tsconfig support is mentioned, there is no explicit algorithm for merging `baseUrl`, `paths`, and fallback resolution order.
  - ConfigTracker uses globbing and simple include/exclude extraction; there is no handling of `extends`, project references, or composite configs. Without these pieces, `USES_CONFIG` relationships may misrepresent actual compiler scopes.
  - TestMapper’s `findSourceForTest` just replaces `.test.` with `.` which will not work for integration tests, nested directories, or frameworks like Cypress/Jest with custom resolution. The plan should at minimum integrate with graph data (e.g., by analyzing import statements inside test files) instead of string heuristics.
- Phase 2 (Affected analysis):
  - The `MATCH (changed:File {path: $filePath})<-[:IMPORTS*1..${this.maxDepth}]-(dependent:File)` query requires `IMPORTS` relationships pointing to concrete files. Until import resolution is solved reliably, this step cannot work. The plan should call out gating criteria (e.g., achieve ≥95% resolved imports before enabling affected analysis).
  - Scope determination thresholds (10 files → package, >50 files → repo) are arbitrary. They likely need calibration per repository size. There is no mention of how to align these numbers with actual package boundaries or repo size (e.g., small packages with <20 files would always escalate to repo scope).
  - Caching the entire affected set for five minutes assumes a static workspace. Under ongoing edits, the cache could return stale scope results (e.g., new imports added). Cache invalidation tying to git state or file mtimes should be specified.
- Phase 3 (Validation coordinator):
  - The plan implies `TypeCheckService.checkFiles(affected.files)` will run `tsc` on just those files. As noted, TypeScript does not expose that capability via CLI unless the repo uses Project References and incremental build APIs. This is the biggest gap in the plan.
  - For linting, most ESLint setups can lint individual files, but the plan does not discuss caching/partial results (e.g., leveraging `eslint --cache`) which already handles much of this functionality out of the box.
  - Test service integration only filters for files with `.test` or `.spec` in the path. That approach misses E2E suites (Playwright, Cypress) or integration tests triggered by watchers. Additionally, the plan does not integrate with existing `test` service code which likely runs `npm test` at repo level.
  - SSE/UI broadcasting is a nice touch, but the plan assumes the orchestrator has an event bus subscription ready. Need to confirm existing services align.
- Phase 4 (Caching):
  - Storing validation runs in Neo4j for every file validation may create significant write amplification (one node per file per validation). For large repos with frequent edits this could bloat the database quickly. There is no mention of retention policies.
  - Cache invalidation relies on SHA-256 of file content, but TypeScript results depend on transitive closure of files. If a dependent file changes, cached success on the current file could still be returned. The plan needs to hash scopes (file plus all dependencies) to be safe.
  - Validation history queries that join per-file runs will become expensive. Consider storing aggregated runs per scope (package/repo) instead.
- Phase 5 (UI/Monitoring):
  - API endpoints assume fast Cypher queries over large result sets. Without pagination and proper indexes, returning validation history could impact Neo4j performance.
  - SSE fan-out lacks backpressure handling; broadcasting large payloads for every validation might overwhelm the frontend if edits are frequent.

## Key Risks & Unanswered Questions
- **TypeScript execution model**: The plan must define how to run scoped checks that remain sound. Options include using `tsc --build` with project references, leveraging the TS language service via `tsserver`, or integrating an existing tool like `tsx`/`esbuild` for fast diagnostics. Without this, the central promise falls apart.
- **Graph completeness**: Prior to depending on affected analysis, the project must achieve near-total import resolution and coverage. The current analyzer occasionally hangs on files, lacks config awareness, and does not parse JSON/Node resolution. A staged rollout with verification (run affected and full validation in parallel) is essential.
- **Data volume in Neo4j**: Adding `ValidationRun` nodes per file could produce millions of nodes over time. Retention strategies, summarization, or offloading to a time-series store should be considered.
- **External dependency changes**: The spec mentions hashing lockfiles but the implementation plan does not detail how lockfile changes propagate to package-level invalidations.
- **Testing strategy realism**: The proposed unit/integration/E2E tests are good on paper, but they rely on heavy graph fixtures and potentially slow commands (`tsc`). CI time might balloon. Consider mocking or using `ts-node --project` for faster checks during tests.
- **Developer workflow**: Batching with a 1s debounce is reasonable, but the plan should explicitly describe developer feedback surfaces (CLI, UI, editor integration) to ensure the results are consumable.

## Recommendations
- Prioritize building a minimal viable affected analyzer that only escalates from file → package → repo but still runs existing repo-level commands; measure current accuracy before attempting per-file execution.
- Reassess TypeScript strategy: consider integrating the TS language service (e.g., via `typescript` API) or using `tsc --build` with project references to maintain correctness. Alternatively, accept package-level granularity as the initial target.
- Upgrade specification of import/config resolution to mirror the TypeScript compiler behavior. Leverage `ts-morph` (already in dependencies) to resolve imports/path mappings instead of manual path math.
- For caching, adopt task-level hashing similar to Nx/Turborepo—hash the tuple (command, env, input files). Store cache metadata outside Neo4j (e.g., filesystem or Redis) and only push summaries/metrics into the graph to keep it lean.
- Expand test plan to include golden datasets from real monorepos the team cares about, ensuring heuristics (test mapping, config usage) are validated against reality.
- Document rollout plan with feature flags and health checks (e.g., compare affected-vs-full results for a trial period, alert on mismatches).

## Verdict
- The concept is promising and consistent with the project’s mission, but the current plan underestimates the complexity of making TypeScript, lint, and test tooling truly scope-aware. Before implementation, clarify the TypeScript execution story, define measurable thresholds for graph completeness, and revisit caching/storage implications. With those adjustments, the approach can deliver the desired performance wins while maintaining correctness.
