# Review of DevAC Spec v1.4

## 1) Feasibility: working vs broken components
- Working pieces identified: FileWatcher, Neo4jClient, existing parsers, GraphUpdater, XState actors. However, the spec treats them as “working” while also listing 103 TS errors across those actors/parsers; that means they are not implementation-ready and should be classified as broken/needs-fix until the imports/types compile.
- Import path corrections are accurate; feasibility depends on completing those fixes first. No validation that StructuralParser and SemanticResolver already expose the unified `StructuralParseResult` shape—risk of hidden gaps.
- StorageManager is excluded from the incremental path; that’s fine, but it leaves bulk vs incremental divergence to maintain in parallel (feasible but higher ongoing cost).

## 2) Architecture soundness (two-phase parsing & boundaries)
- Two-phase (structural → semantic) is clear and aligns with current CodeGraph design. Boundaries are mostly explicit: LanguageRouter → parser (structural), GraphUpdater for structural persistence, SemanticResolver as background phase.
- Missing clarity on where semantic results are written (GraphUpdater vs StorageManager) and how semantic completion updates `File` flags; boundary between ValidationCoordinator and SemanticResolver is underspecified.
- Error-handling boundary: ValidationCoordinator writes parseError, but recovery/clear-on-success is not described.

## 3) Implementation phases & dependencies
- Ordering is mostly sensible: fix TS errors → add types/router → reconciliation → deletes → mutex → integration. Dependency callouts are light: reconciliation requires projectRoot index/migration before use; LanguageRouter depends on unified types; GraphUpdater delete path depends on reconciler emitting DELETE/UNLINK correctly.
- Tree-sitter wiring (Phase 3) depends on LanguageRouter and adapter from Phase 2—implied but not called out.
- Rename handling (Day 16) depends on per-file mutex and reconciliation being stable; risk if deferred that event buffer coalescing plus rename heuristic interact unexpectedly.

## 4) Performance targets realism
- TS/JS <150ms assumes ~20ms parse + ~100ms Neo4j; with actor overhead, FS reads, chokidar batching, and driver latency, 150ms median is optimistic; P95/P99 likely higher without warm caches and Neo4j connection pooling benchmarks.
- Java/C#/C++ targets (<200ms) may be tight given tree-sitter parse + graph write + XState overhead; no evidence from current measurements. Python 400ms without a persistent worker is still aggressive because process spin + IPC often exceeds 400ms cold; must require keep-alive or pool.
- No target split for cold vs warm starts or reconciling backlog; performance budget omits event buffering/sequence-mutex cost and Cypher index hits.

## 5) Missing pieces / failure modes
- Queue/backpressure: success criteria mention “queue bounded with overflow handling” but no design for overflow behavior (drop, backoff, persist).
- Error handling: parseError set, but no policy for clearing on successful re-parse, nor retry/backoff for transient Neo4j failures. Semantic failures handling not described.
- Rollback/partial writes: GraphUpdater path lacks explicit transaction retry/backoff and does not cover mid-transaction failures (e.g., Neo4j timeouts).
- Watcher/link failures: no behavior for chokidar errors or when projectRoot changes. File content hashing not used for coalescing or rename detection (100ms window is fragile).
- Observability: progress events only for reconciliation; no metrics/logging requirements for steady-state latency or error rates.

## 6) Integration points (FileWatcher → LanguageRouter → Parser → StorageManager/GraphUpdater)
- High-level flow is stated, but interface contracts are thin: not specified how FileWatcher batches map to ValidationCoordinator events (single vs batch), nor how LanguageRouter returns errors vs results into actor events.
- GraphUpdater vs StorageManager split is justified, but the spec doesn’t define when StorageManager is invoked in incremental mode (or never). SemanticResolver ingestion path (where semantic updates are stored) is not defined.
- Neo4j scoping: projectRoot scoping is specified for reconciliation, but not for normal GraphUpdater writes/renames/deletes—must be enforced consistently.

## Practical risks / recommendations
- Reclassify the 103-error components as “broken” until tsc clean; make TypeScript error burn-down a gate for all later phases.
- Add explicit contracts: event shapes through the actor pipeline, LanguageRouter return types, semantic update writes, and how parseError is cleared.
- Define queue/backpressure policy (cap + drop vs block vs spill), transaction retry/backoff for Neo4j, and how to handle chokidar/watch errors.
- Revisit latency targets with measured baselines (cold/warm) and include actor + Neo4j overhead; add success criteria for P95/P99, not just medians.
- Make rename detection content-hash aware and consistent with per-file mutex to avoid false deletes/adds; document behavior when rename detection misses.
