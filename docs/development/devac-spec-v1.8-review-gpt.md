# DevAC Spec v1.8 – Architecture Review (GPT)

## Summary
- Overall direction (structural → semantic, atomic graph update, feature-flagged tree-sitter) is reasonable, but “implementation-ready” is optimistic: several adapters/routers are still stubs, perf targets are tight, and key failure/backpressure behaviors are underspecified.

## Findings by prompt item
1) **Feasibility (working vs. broken components)**  
- Verified locations for ValidationCoordinatorActor / GraphUpdaterActor / SemanticResolverActor / StructuralParser / FileWatcher / Neo4jClient all exist, so the “working components” list is accurate.  
- “Files to Create” are indeed absent today (e.g., language-router.ts), so they are new work, not merely wiring; tree-sitter support is entirely unimplemented, so calling the spec “implementation-ready” overstates readiness.  
- GraphUpdaterResult shape in the spec (nodes with {entityId, kind, name, filePath, line, column}) does **not** match the APOC/non-APOC helpers shown (which expect `properties` and label lists), so GraphUpdater would be broken without an additional adaptation layer.

2) **Architecture (two-phase parsing & boundaries)**  
- Structural → Graph update → enqueue semantic is sound, but boundaries are blurred: StructuralParser output → ParseResultAdapter → GraphUpdaterResult lacks a contract for property bags, labels, and relationship validation; SemanticResolverAdapter is a stub that returns null, so cross-file edges stay stale longer than stated.  
- File-level mutex prevents concurrent processing per file, but there is no version/sequence guard across structural vs. semantic phases (e.g., if a new change arrives after structural but before semantic completes).  
- Rename handling is best-effort; no reconciliation pass exists to repair missed renames or drift, so the guarantee “never zero nodes” can be violated after a missed rename+delete sequence.

3) **Implementation Phases (ordering & dependencies)**  
- Phase 0.5 (adapters) precedes fixing `tsc` errors (Phase 1), so adapter files will likely inherit/expand existing type errors and block compilation—phase order should flip or gate on type fixes.  
- ParseResultAdapter is scheduled in Phase 2 even though LanguageRouter (Phase 2) depends on it; the dependency should be earlier to keep router work unblocked.  
- Phase 0’s “map ALL import paths” and “verify indexes” happen before type stubs are created, so baseline verification may fail noisily; the spec lacks an explicit retry/checkpoint plan if Day 1 tasks fail.

4) **Performance targets (<200ms/<100ms, total <500ms)**  
- <100ms structural parse via Babel/ts-morph is plausible only for small TS/JS files with warm FS/AST caches; cold reads or larger files (React components with JSX) routinely exceed 150-250ms.  
- Graph update <300ms assumes local Neo4j + APOC; without APOC (fallback multi-query) and under transactional delete+create, 300ms is optimistic—network latency or contention easily adds 100-200ms.  
- With locking, queueing, JSON marshalling, and semantic enqueue, the 500ms total budget leaves little headroom; cold start <3s ignores driver warmup and first-query compilation (~1-2s each). Targets need per-path (APOC vs. fallback, cold vs. warm) budgets and SLO error bars.

5) **Missing pieces / failure modes**  
- No dedup/throttle of rapid file events (chokidar bursts) → risk of redundant parses and wasted transactions; no in-flight cancellation when a newer change arrives.  
- Backpressure is mentioned but not specified: no global concurrency limits, queue length caps, or drop/merge policies.  
- Error handling gaps: what happens when GraphUpdater fails after enqueueing semantic? How are retries scheduled and capped? How are poison files quarantined?  
- Crash recovery only requeues `semanticQueued=true AND semanticComplete=false`; it does not reconcile structural completeness, missed deletes/renames, or stale locks.  
- Circuit breaker behavior when open is undefined in the coordinator state machine (do we pause FileWatcher intake, or drop events?).  
- Metrics/observability for latency targets and failure counts are absent, making the success criteria untestable in practice.

6) **Integration points (FileWatcher → LanguageRouter → Parser → StorageManager)**  
- Contracts are partly defined, but the GraphUpdaterResult ↔ createNodesBatched/createRelationshipsBatched mismatch is unresolved; also missing are label/relationship whitelists and property schemas.  
- ValidationCoordinator flow does not specify where `useApoc`/health status is sourced or how failures propagate to the actor (retry vs. circuit-open stop).  
- Mutex acquisition/release paths on error/timeout are not described; deadlock avoidance (e.g., finally-release) should be explicit.  
- Rename detection is external to the actor loop; integration steps for applying `handleRename` vs. normal delete+add are unspecified, risking duplicate nodes.

## Practical implementation risks
- Type-safety and adapter gaps will block early phases unless reordered; performance targets need per-scenario budgets; lack of dedupe/backpressure and retry policy will create instability under real watcher churn; and tree-sitter remains a stub, so Python/Java scope is not actually deliverable within the stated “implementation-ready” window without additional detail. 
