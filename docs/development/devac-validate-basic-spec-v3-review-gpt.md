# DevAC Validation Basics v3 – Repository & Spec Review (GPT)

## Repository Reality Check
- `src/devac/services/codegraph/codegraph-service.ts` still routes every `FILE_CHANGED` event to a full `AnalyzerService.analyze()` invocation. There is no incremental entry point in `src/analyzer/analyzer-service.ts`; the only exposed method executes the entire two-pass pipeline and tears down the Neo4j driver on completion. Achieving sub-5s updates therefore requires a deep refactor rather than a thin wrapper.
- The parser stack (`src/analyzer/parser.ts`) is tightly coupled to a long-lived `ts-morph` project, temp-file streaming, and pass-two relationship resolution. Single-file parsing would need to rework: (1) batch-based streaming writes, (2) the global `tsResults`/`processedTsFiles` caches, and (3) cleanup expectations. Nothing today isolates AST extraction per file.
- `StorageManager` (`src/analyzer/storage-manager.ts`) only supports UPSERT-style writes. There is no deletion primitive, and relationships are addressed by `entityId`, not by file path. Spec-proposed operations like `DELETE WHERE n.filePath = $path` would currently miss nodes without a `filePath` property and may delete unrelated metadata (packages, tests) that store `path`.
- Package discovery already exists: `PackageExtractor` writes `Package` nodes and `BELONGS_TO` relationships inside `Parser.collectResults()`. The spec’s new `CONTAINS_FILE` relationship contradicts current labeling unless the pipeline is rewritten to emit both or migrate downstream consumers.
- Command runners (`src/devac/services/command-based-service.ts`) already understand the `strategy` enum but per-package execution is sequential and assumes `pkg.workingDirectory || repo.path`. There is no hook for file-scoped commands or parallelism yet, and commands are run via `spawn(command, { shell: true })`, so naive string concatenation of file paths (as suggested in the spec) risks shell injection and exceeds argument length on macOS.
- The XState infrastructure (orchestrator + `BaseService`) is service-centric. Each service actor transitions `watching → processing → watching` per event, meaning batching must be modeled inside `process()` or by queuing upstream. There is currently no notion of spawning child actors for change batches or using `context.events` the way modern XState v5 actor patterns recommend.

## Spec Strengths
- Accurately identifies the full-graph reanalysis bottleneck and quantifies target latencies that would materially change developer experience.
- Emphasizes a staged, TDD-first rollout with performance targets and safety fallbacks (e.g. escalate to package/repo scope, trigger full reanalysis periodically).
- Calls out the need for generic script execution and monorepo awareness—essential for real-world adoption.
- Lays out an implementation order that front-loads the incremental graph work before higher-level niceties (UI, history, etc.).

## Critical Gaps & Risks by Component
### 1. Incremental CodeGraph Analysis
- **Parser coupling**: The spec’s `analyzeFile()` assumes we can parse and emit a single file in isolation. In reality, `Parser.parseFiles()` streams whole batches, relies on temp JSON artifacts for non-TS languages, and only creates relationships after `collectResults()`. Introducing `parseSingleFile()` means restructuring the batch pipeline and rethinking Pass 2 (relationship resolution) which currently expects a populated `ts-morph` project.
- **Deletion semantics**: Proposed `deleteFileData()` (`MATCH (n) WHERE n.filePath = $filePath OR n.path = $filePath DETACH DELETE n`) is unsafe. Not all entities carry `filePath`; `Package` nodes store their path; `Import` nodes store `sourcePath`. Detached deletes would also remove shared nodes (e.g. `Package`, `Repository`) if any share the same path string. A reliable delete must filter on labels (`:File`, AST node labels) and remove relationships without touching package/config metadata.
- **Reverse dependency refresh**: `getFilesImporting(filePath)` presumes actual `IMPORTS` relationships already target canonical file nodes. Currently many relationships are placeholder entries (see `resolveTsModules` fallback). Without fully resolved targets, re-parsing importers risks oscillation. We likely need an import-resolver cache keyed by module specifier + tsconfig context, not just raw Cypher queries.
- **Driver lifecycle**: `AnalyzerService.analyze()` closes the Neo4j driver in `finally`. Incremental mode must manage connection pooling differently; otherwise each file change reopens the driver, defeating the latency goal.

### 2. Generic Script Execution
- The new strategy helpers replicate logic already present in `runRepository`. Rather than a new `ExecutionStrategy`, we should extend the existing method with concurrency controls (e.g. `Promise.allSettled` for packages) and explicit working-directory resolution (`path.join(repo.path, pkg.relativeDir)`), respecting pnpm hoisting.
- Spec’s `runFiles()` that appends file paths to the command string collides with current `command` usage (often a script alias like `npm run typecheck`). Those scripts expect to discover files via config, not CLI args. Passing file paths only works for tools that accept them (eslint, vitest’s `--runTestsByPath`). We need per-tool adapters or to reuse built-in caches (`eslint --cache`, `tsc --build --incremental`).
- No mention of environment parity: turborepo/nx rely on `.turbo`, `.nx`. The spec should plan cache cleanup and concurrency limits to avoid CPU spikes.

### 3. Monorepo Package Independence
- Existing graph already adds `Package` nodes and `BELONGS_TO` relationships. Spec reintroduces `CONTAINS_FILE` without migration guidance and assumes `PackageInfo` has a `type` taxonomy (`frontend/shared-library/tool`) which today is a guess. Align on a single relationship semantics to avoid conflicting analytics.
- `getPackageForFile` assumes package directories don’t overlap; however, pnpm workspaces often include nested `examples/` or `docs/` packages. The existing extractor already stores both a map by name and by path—reuse it.
- Parallel package validation is proposed but the current command runner is synchronous. We need resource guards (limit concurrency, capture logs per package) and defensive process management (kill tree on failure). Without them, running `npm run lint` concurrently inside multiple packages may thrash CI.

### 4. Affected Calculation
- The spec calls `calculateAffected()` immediately after `analyzeFile()`. In the current service architecture, `process()` returns immediately after reanalysis. We need to rethink the service state machine to (a) await incremental graph updates and (b) batch multiple changes before calling affected. Right now each `FILE_CHANGED` event pushes the machine into `processing` and back; there is no queue.
- Cypher snippets assume `:File` nodes and `:Package` nodes. In practice, all AST nodes carry the generic `:Node` label plus `kind`. Queries must target `:Node {kind: "File"}` or index on `entityId`. Without adjusting, the queries will perform poorly or miss nodes.
- Transitive queries assume fully resolved `IMPORTS` edges. The current graph still contains placeholder edges for unresolved modules (see `isPlaceholder` property). Affected calculations must filter placeholders or escalate to package scope when placeholders exist.
- Test discovery is still heuristic. As long as the `TESTS` relationship is missing for non-standard conventions (vite’s `import.meta.glob`, playwright tests), relying on `findTestFile` risks false negatives.

### 5. Change Batching & Coordination
- `FileWatcher` already performs 500ms debouncing and can emit batches via `event.batch`, but `BaseService` ignores them. Implementing the proposed `ChangeCoordinator` requires either (a) plugging into `FileWatcher`’s batch output and storing state in service context, or (b) rewriting the service machine so watcher events are handled by an actor with its own queue.
- Suggested architecture invokes `codeGraphService.analyzeFile()` directly from the coordinator. That bypasses the `BaseService` machine which expects `process()` to encapsulate work. We either need to refactor `BaseService` to delegate to a coordinator actor or accept that the spec’s coordinator lives outside the service machine (e.g., owned by orchestrator). Right now, there’s no clean injection point.
- Actor model opportunity: XState v5 supports spawning child actors per batch and modeling completion via observables. The spec should leverage this to orchestrate typecheck/lint/test execution instead of chaining `Promise.allSettled` manually.

## Overlaps & Inconsistencies
- Relationship taxonomy mismatch: spec introduces `CONTAINS_FILE`, `USES_CONFIG`, `VALIDATED_BY`, while current graph uses `BELONGS_TO`, `CALLS`, etc. We need a migration plan or aliasing strategy; otherwise analytics break. Beware of duplicating edges (e.g., `BELONGS_TO` vs `CONTAINS` for the same pair).
- Generic script execution plan overlaps with previous `devac-validate-implementation-plan.md`. Consolidate to avoid divergent instructions.
- Success metrics ("single file analysis <5s") ignore the cost of ts-morph project warm-up. On repo start, the first incremental parse likely exceeds 5s due to compiler host initialization. Document expected cold vs warm behavior.
- Spec forbids building UI/history until foundation completes, yet repo already writes validation telemetry to logs and Neo4j. Decide whether to retain existing telemetry or strip it during the incremental rewrite.

## Architectural Recommendations (with XState Angle)
1. **Refactor `BaseService` to actorize change handling**: Introduce a child actor (`changeBatcher`) per service that collects events from `FileWatcher` (supported via `fromCallback`). Utilize XState v5’s `spawnChild` to model `idle -> buffering -> dispatching`, making batching declarative and testable.
2. **Model incremental analysis as a separate actor**: Rather than bolting `analyzeFile()` onto `AnalyzerService`, build a dedicated `analysisWorker` actor that receives `{type:"ANALYZE", files:[...]}` messages, maintains a pooled `ts-morph` project, and exposes status via contexts. This better aligns with the spec’s desire for actor-based testing.
3. **Adopt model-based tests**: XState’s test utils can validate service machines across happy/error paths. Incorporate them for the revamped coordinator to ensure batching, retries, and escalation behave as intended.
4. **Clarify graph schema migrations**: Document how new relationships coexist with legacy ones, and add automated validations (e.g., Cypher unit tests) so the Neo4j shape remains predictable.

## Open Questions to Resolve Before Implementation
- How will `AnalyzerService` manage tsconfig/project state between incremental runs? Rebuilding the project per file negates performance gains.
- What is the authoritative source for package boundaries—`PackageExtractor`, workspace config, or Neo4j nodes? We must pick one to avoid divergent logic between spec and code.
- Which toolchains genuinely support file-scoped invocation? For TypeScript we likely need `tsc --build` with project references or the language-service API (tsserver). The spec must pick a feasible approach rather than relying on `tsc <files>`.
- How do we keep Neo4j clean when millions of `ValidationRun` nodes accumulate (the earlier spec planned them)? Even in this foundation phase, we should anticipate retention policies.

## Verdict
The vision in v3 is directionally sound—incremental graph updates are the blocker—but the current codebase needs substantial re-architecture to support it. Critical assumptions (easy single-file parsing, simple deletes, CLI file arguments) do not hold in the repository today. I recommend (1) drafting a concrete incremental parsing design that respects the existing two-pass pipeline, (2) aligning relationship names with current graph semantics, and (3) reshaping service state machines using XState actors before codifying the rest of the plan. Only after those proofs-of-concept pass should we lock in the remaining foundation work.
