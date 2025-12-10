# Review: DevAC Spec v1.2 (Incremental Graph Updates)

## Summary
- Direction is reasonable (single orchestrator with actors), but timelines and perf targets are optimistic; key correctness/operational gaps remain (ordering, backpressure semantics, rollback, observability).
- Critical integration surfaces (FileWatcher → LanguageRouter → Parser → GraphUpdater/Neo4j → SemanticResolver) are outlined but not fully specified for contracts, idempotency, and failure handling.

## 1) Feasibility (working vs broken)
- Working components listed as “implementation-ready” are not validated; XState typing errors and missing adapters imply core control plane is currently broken. Treat orchestration and graph updates as red/yellow until types compile and contract tests exist.
- Structural parsing across 8 languages via LanguageRouter + tree-sitter adapter is only partially described; no confirmation of parser parity (imports/exports, symbols, language detection) so feasibility for non-TS/JS is uncertain.
- Marking “Semantic resolution TS/JS only” is fine, but graph consistency depends on robust structural extraction; spec underestimates effort to align per-language outputs to shared schema.

## 2) Architecture (two-phase parsing, boundaries)
- Two-phase (structural → semantic) is sound, but boundaries are fuzzy: who owns normalization of import/export strings, symbol identity, and file-level metadata? Need explicit contracts for StructuralParseResult and GraphUpdater expectations (idempotent writes, delete semantics).
- LanguageRouter abstraction is plausible; unclear how language detection is done (extension-only vs shebang) and how multi-language files or generated files are handled.
- GraphUpdater responsibilities need clearer scope: reconcile deletions, partial updates, and error markers without leaving orphaned nodes/relationships.

## 3) Implementation Phases / Ordering
- Phase ordering mostly sane (types first, then integration), but startup reconciliation should precede enabling FileWatcher to avoid racing live events with stale graph state.
- Concurrency/mutex and backpressure need to be implemented before broad parser wiring; otherwise races will mask correctness bugs.
- Tree-sitter language wiring (Phase 3) depends on router + adapter contracts and schema decisions in Phases 1–2; make explicit that adapter/schema stabilization is a blocker for Phase 3.

## 4) Performance Targets
- <100–150ms per structural pass for TS/JS/Go/C#/C/C++/Java is aggressive once including disk I/O, parse, JSON/AST normalization, and Neo4j writes; expect 150–300ms realistic without warm caches. Python <300ms is plausible only with warm interpreter; <100ms future target is unrealistic without a long-lived worker and minimized IPC.
- Neo4j latency dominates; spec assumes ~50ms writes without batching/transaction contention. Need batching, reuse sessions, and possibly in-memory diffing to avoid per-file transaction overhead.
- Debounce + mutex sequencing adds ~50–150ms wall time; targets should clarify cold vs warm cache and include persistence time.

## 5) Missing Pieces / Failure Modes
- No rollback/compensation: if GraphUpdater partially writes and fails, there is no transactional boundary or retry policy; need idempotent UPSERT + delete-orphan strategy or explicit “replace-by-file” transaction.
- Error handling: ParseError is captured, but no retry policy, alerting, or decay of error state after success; no policy for repeated transient parse failures or corrupted AST outputs.
- File deletion semantics: Not fully specified—need guarantees to remove owned nodes/edges atomically and to drain semantic queue entries for deleted files.
- Observability: Missing metrics/tracing (queue depth, latency buckets per stage, Neo4j timings, lock contention); no health checks for watchers or actor crashes.
- Startup reconciliation: No cap on diff size, no batching, no backoff; glob on large repos may be slow and memory-heavy, and mtime comparisons need timezone/clock-skew handling.
- Configuration/ops: No mention of configurable debounce, queue limits per language, or feature flags to disable expensive phases; no guidance for multi-repo/multi-root scenarios.
- Security/robustness: No sandboxing for parsers, no guard against large files or pathological inputs; no circuit breakers on repeated failures.

## 6) Integration Points (FileWatcher → LanguageRouter → Parser → StorageManager/GraphUpdater)
- Contracts are only partially defined: need explicit event schemas, retry semantics, idempotency, and ordering guarantees. Especially: how to dedupe batched events, how to drop superseded work by seq numbers, and how to handle re-entrancy from reconciliation outputs.
- LanguageRouter should define: input (path, language hint), output (StructuralParseResult | ParseError), error taxonomy, and resource cleanup (tree-sitter parser lifecycle, Python subprocess lifecycle).
- GraphUpdater/StorageManager needs: atomic replace-per-file, deletion handling, parseError persistence without wiping prior good state, and guarantees that semantic queue enqueues only after structural write succeeds.

## Practical Implementation Risks
- XState v5 typing and actor boundaries: risk of mismatched event shapes; need shared event schema module and tests.
- Tree-sitter adapter: mapping to shared AST schema and relationship shapes is non-trivial; risk of inconsistent relationship names and missing import strings, which will break downstream semantic phases.
- Backpressure: Queue overflow strategy (“dropOldest”) can silently lose critical updates; must log+metric and possibly prioritize latest change per file.
- File locks and sequence numbers: need expiration or cleanup to avoid unbounded Map growth; must ensure lock promise rejection doesn’t leave stale entries.
- Neo4j contention: Per-file transactions may serialize under load; consider batch writes and session pooling; ensure delete+create is atomic to prevent dangling relationships.

## Recommendations (minimal changes to spec)
- Make contracts explicit: detail inputs/outputs for FileWatcher, LanguageRouter, GraphUpdater, SemanticResolver, including idempotency and versioning (seq).
- Clarify ordering: run reconciliation before watcher activation; enforce structural commit before semantic enqueue; discard stale results by seq in GraphUpdater too.
- Adjust performance targets to “p50/p90 warm” with ranges; budget separate envelopes for parse, transform, and storage; add batching guidance.
- Add rollback/atomicity plan: replace-per-file transaction (delete owned nodes/edges by filePath + insert new) with retries; metric/log on partial failures.
- Add operational guardrails: queue depth metrics, overflow alerts, lock map cleanup, configurable debounce/backpressure, and health checks for watchers/parsers.
- Specify parser lifecycle: per-language initialization, caching, and keep-alive strategy (especially Python) to approach targets.
