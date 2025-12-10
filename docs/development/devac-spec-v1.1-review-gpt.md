# DevAC Spec v1.1 – Architecture/Integration Review (GPT)

Date: 2025-12-10

## 1) Feasibility (working vs broken)
- “Implementation-Ready” components still have blocking TypeScript errors (StructuralParser, SemanticResolver) and missing adapters; they are not yet plug-and-play. The “working” tree-sitter parsers do not emit imports/exports, so they cannot satisfy the declared cross-file requirements without additional extraction. ValidationCoordinator has the largest error surface; calling it ready-to-fix in 1-2 days feels optimistic without confirming test coverage breadth.

## 2) Architecture (two-phase parsing, boundaries)
- Two-phase split (structural then semantic) is sound for TS/JS, but Phase 2 is only defined for TS/JS; other languages never get semantic import resolution, so cross-language edges are absent by design. GraphUpdater relies on parse results to be complete; if parsers omit imports/exports (tree-sitter adapters zero them), the graph will silently miss dependencies with no fallback queue. Boundaries between FileWatcher → LanguageRouter → GraphUpdater are high level but lack contract detail (event schema, retries, idempotency, batching behavior).

## 3) Implementation phases and dependencies
- Phase ordering ignores schema/versioning: adding pendingImports/exportedSymbols to File nodes needs migration/version gates before ingestion. IncrementalPipeline (Phase 2) depends on LanguageRouter and actors being typed/compiled; sequencing should enforce “fix errors + add interfaces” before wiring. Queue handoff from GraphUpdater to SemanticResolver (enqueue TS/JS files) is implied but not specified—missing concrete API/event names and failure handling between phases.

## 4) Performance targets realism
- <200ms post-debounce end-to-end is unlikely for Python (200–500ms parse) and remote Neo4j transactions; even TS/JS <50ms parse + <50ms write leaves little budget for routing, serialization, and network. Tree-sitter parsers at <80ms plus transaction overhead similarly squeeze the 200ms target; background GC, logging, and driver pooling are not accounted for. Semantic batch of 10 files in 2–10s is fine for background, but repeated retries can starve fresh events without backpressure controls.

## 5) Missing pieces / failure modes
- Backpressure and coalescing: no strategy for bursty change sets, rename storms, or multi-file atomic edits (e.g., branch switch). Crash/restart recovery: no persisted queue or replay plan; in-flight deletes/inserts could leave the graph stale if a process dies after delete but before reinsert. Idempotency/dedup not addressed—duplicate FileWatcher events could thrash Neo4j. No metrics/tracing at key points (parse time, queue depth, transaction latency) to validate the <200ms target. Rollback for semantic failures is “drop after 3 attempts” with no alerting or manual requeue path. File deletions and semantic queues are not coordinated—pending imports may reference removed files without cleanup.

## 6) Integration points clarity
- FileWatcher → LanguageRouter: debounce parameters given, but no ignore pattern source of truth or normalization for symlinks/renames. LanguageRouter → Parser: interface defined, but unsupported extensions/error surfaces (exceptions vs. null) and timeout policies are unspecified. Parser → GraphUpdater: StructuralParseResult is defined, yet required fields (importStrings/exportedSymbols) are optional in adapters, so contract compliance is weakly enforced. GraphUpdater → SemanticResolver: enqueue semantics, priority rules, and retry budgets are not defined; failure/retry signals between actors are missing.

## Practical implementation risks
- Type fixes alone do not guarantee behavior; actor logic needs integration tests with Neo4j to validate atomicity and delete-reinsert correctness under concurrent changes. Python keep-alive (Phase 4) changes the perf envelope and error modes; watchdog and restart policies are absent. Without schema guards (constraints/indexes) and size limits on pendingImports/exportedSymbols, large files may bloat File nodes and slow transactions.

## Recommendations (minimal to unblock)
1) Define concrete event/DTO contracts for each hop (WatcherEvent, RouteResult, ParseResult, UpdateCommand), including error shapes and idempotency keys.  
2) Add backpressure + coalescing plan (batch multiple changes per file, collapse rapid successive events, cap concurrent transactions).  
3) Re-baseline the <200ms target by language and environment (local vs. remote Neo4j); publish P50/P95 budgets and instrumentation points.  
4) Specify queue durability and recovery (persisted work log or checkpoint) so delete/insert cannot leave gaps after crashes.  
5) Extend StructuralParseResult requirements or language-specific adapters to extract imports/exports where possible; otherwise document that cross-file edges are TS/JS-only.  
6) Gate rollout with schema migration/versioning and small-scope integration tests covering delete+insert, rename, and retry exhaustion.
