## DevAC Spec v1.3 Review (GPT)

### 1) Feasibility (working vs broken)
- Working components identified, but “103 TypeScript errors” list indicates most actor wiring is currently broken; spec assumes simple import fixes and XState typing tweaks will clear them, which may underestimate effort (actors likely lack runtime tests and integration coverage).
- StructuralParser/LanguageRouter/Tree-sitter adapter plan is feasible, but “neo4j atomic update” depends on GraphUpdater semantics that are not described (e.g., how deletes cascade). Startup reconciliation before watcher is reasonable, but requires idempotent graph mutations and consistent clocks.
- Labeling components as “fixable via typing/import changes” seems optimistic; XState v5 event model may need statechart refactors, not just guards. No validation that SemanticResolverActor’s enqueue path still matches data shapes after unified types.

### 2) Architecture (two-phase parsing, boundaries)
- Two-phase (structural → semantic) is sound; boundaries are clearer with StructuralParseResult, but semantic phase is TS/JS-only and its contract to GraphUpdater isn’t fully specified (what fields are required for semantic enqueue?).
- LanguageRouter location under `src/pipeline` is fine, yet integration path in ValidationCoordinatorActor is not shown (which actor calls router, where errors surface, how retries work).
- StorageManager/Neo4jClient responsibilities are not re-stated; unclear who owns transactional boundaries and whether GraphUpdater batches multiple files or one per event.

### 3) Implementation phases / dependencies
- Phase ordering is mostly correct: fix types → wire router → reconciliation → mutex → tree-sitter. However, router adoption and unified types should precede reconciliation code so reconciliation can reuse the same parse pipeline; otherwise dual paths appear.
- Dependencies missing: Graph schema/index updates must precede reconciliation to avoid slow scans; per-file mutex depends on stable file keys (normalized paths). Need explicit step to ensure FileWatcher starts only after reconciliation finishes and driver is initialized.
- Phase plan ignores test data/fixtures for non-TS languages; tree-sitter wiring without fixtures risks regressions.

### 4) Performance targets
- <150–200ms per change seems aggressive given Babel/ts-morph init, disk I/O, and Neo4j network cost; feasible only if parsers are warm, file reads cached, and Neo4j is local with pipelined writes. Cold-start and GC costs not accounted for.
- Tree-sitter targets are plausible (<80ms parse) but Neo4j write latency can dominate; need batching or MERGE plan tuning. Python 300ms is optimistic without persistent worker.
- Semantic 2–10s/batch acceptable, but backlog implications (queue depth, staleness) aren’t discussed.

### 5) Missing pieces / failure modes
- Error handling: no rollback or partial-failure strategy for GraphUpdater (e.g., if relationships succeed but file node update fails). No dead-letter queue for repeated parse failures.
- Concurrency: mutex covers per-file, but reconciliation vs live events race needs explicit suppression (buffering events until reconciliation completes). Sequence-based cancellation should log dropped events.
- Deletes: “File deletion removes owned nodes” is a success criterion, but no algorithm for cascading deletes (how to avoid deleting shared nodes?). No policy for renames (unlink+add vs move).
- Observability: metrics/alerts unspecified; performance targets need instrumentation locations. Backpressure config given, but no shed-logging or operator guidance.
- Config/paths: normalization (case sensitivity, symlinks) not covered; import resolution differences across languages unaddressed.

### 6) Integration points (FileWatcher → LanguageRouter → Parser → StorageManager)
- Path is outlined, but message contracts are not: what payload does FileWatcher emit (absolute vs relative path)? What does GraphUpdater expect from StructuralParseResult (entityId semantics, idempotency keys)?
- StorageManager/Neo4jClient transactional scope unclear—are writes per-file or batched? How are stale nodes pruned when a parse drops nodes?
- AffectedCalculatorActor needs the same entityId scheme as StructuralParser; mismatch risk not addressed. SemanticResolver enqueue contract (input shape, dedupe) is unspecified.

### Practical challenges / recommendations
- Define transaction semantics: per-file atomic MERGE/DELETE with deterministic entityIds; add pruning logic spec for removed nodes/relationships.
- Document data contracts: exact shapes for FileWatcher event, router output, GraphUpdater input, SemanticResolver input. Add path normalization and workspace-root handling.
- Add cold-start vs warm latency expectations and require parser/process warmup + persistent Python worker to approach targets.
- Specify reconciliation buffering strategy and logging for dropped superseded events; add dead-letter for repeated failures.
- Provide delete/rename handling algorithm and tests, plus fixtures for each language to validate tree-sitter adapters.
