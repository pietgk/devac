# Review of DevAC Spec v1.5 (Incremental Graph Updates)

## Summary
Spec is detailed and mostly implementation-ready, but some feasibility, integration, and performance claims need sharpening—especially around latency targets, cross-actor boundaries, and failure handling for multi-language parity.

## 1) Feasibility of working vs broken components
- Working components called out (FileWatcher, LanguageRouter/StructuralParser, GraphUpdater, SemanticResolver, AffectedCalculator) align with existing code locations, and import fixes are correctly identified. However, the spec assumes tree-sitter adapters and unified types already exist; they are net-new and unproven (risk).
- "Broken" areas (103 TS errors, import paths, XState event typing) are plausible, but no evidence that error counts reflect current code; reconfirm counts before gating Phase 1.
- Neo4j atomic update snippet is structurally sound, but it deletes all nodes for the file before recreating without preserving relationships to other files; feasibility depends on rehydrating cross-file edges in structural or semantic passes—needs explicit confirmation.

## 2) Architecture (two-phase design & boundaries)
- Two-phase (structural → semantic) remains intact with clear separation, but boundaries blur: StructuralParser now carries import/export metadata and importStrings; semantic phase depends on these—clarify which pass owns normalization and error states.
- GraphUpdater conflates "structuralComplete" and parseError clearing with graph writes. Consider keeping GraphUpdater purely structural and let semantic writes be distinct transactions to avoid mixing concerns.
- LanguageRouter is introduced as a new choke-point; ensure it stays thin (language detection + timeout) and does not duplicate parser responsibilities already in analyzer/parser.ts.

## 3) Implementation phases and dependencies
- Phase ordering is mostly correct: fix TS errors → wire config/types → reconciliation/startup → delete handling → shutdown → semantic cycle prevention. Dependencies called out (types before actors, schema migration before reconciliation) are sound.
- Missing explicit ordering: tree-sitter adapter must land before LanguageRouter usage; per-file mutex and queue overflow handling should be in place before enabling watcher replay to avoid races.
- Reconciliation requires schema migration to be idempotent and fast; ensure migration runs before watcher starts and buffer drain.

## 4) Performance targets realism
- <150–200ms median for TS/JS/tree-sitter languages is aggressive but plausible on warm caches for <500 LOC; Python 400ms without a warm daemon is realistic.
- P95/P99 targets (TS/JS 300/500ms; large 500/1000ms) are optimistic given Neo4j transaction overhead, GC, and TypeScript project warm-up. Expect higher tail unless driver sessions are pooled and AST caching is used; cold-start <2s is reasonable.
- Semantic batches at 2–10s are fine, but they will inflate perceived latency if users expect semantic availability post-structural—document that semantic is async and eventually consistent.

## 5) Missing pieces / failure modes
- Error handling: structural parse errors are captured, but semantic failure handling and retries are not described; need semantic retry/backoff and a way to clear semanticQueued on repeated failure.
- Rollback: atomic delete+create is good, but there is no safeguard against cross-file relationship loss during delete (e.g., callers/callees); consider marking file stale and only deleting after new nodes are ready, or re-deriving external edges post-commit.
- Queue overflow: drop-oldest is defined, but no admission control for bursty writes (e.g., IDE format-on-save) beyond maxQueueSize; consider coalescing per file.
- Rename detection: depends on hashing before unlink; not all platforms guarantee access during rename—spec should define fallback (treat as unlink+add).
- Backpressure path pauses watcher via unwatch("**/*"); re-adding lacks scope—risk of missing ignores; needs explicit patterns.
- Concurrency: GraphWriteLock is proposed but not wired into StorageManager/GraphUpdater flow; also per-file mutex vs global lock interactions not defined.
- Observability: metrics interface lacks histogram aggregation details and budget for emitting; health/readiness signals not covered.
- Crash recovery: buffered events are in-memory; no persistence if process dies during reconciling or draining.

## 6) Integration points (FileWatcher → LanguageRouter → Parser → StorageManager/GraphUpdater)
- Pathing is clearer, but interface contracts need tightening:
  - FileWatcher emits FileChangeEvent with contentHash before unlink; needs guarantee on timing and error propagation.
  - LanguageRouter returns StructuralParseResult or ParseError; clarify how ParseError flows through ValidationCoordinator to GraphUpdater (skip delete+create, mark parseError, preserve prior graph).
  - GraphUpdater expects normalized nodes/relationships (entityId, type enum); spec assumes parsers already emit this, but adapter contract not fully specified (e.g., required properties vs optional).
  - StorageManager vs GraphUpdater concurrency: locking order and priority (incremental over bulk) must be explicit to avoid deadlocks/starvation.
  - SemanticResolver enqueue should be conditional on structural success and should respect semanticInProgress; guard is shown but wiring from coordinator to actor needs a definitive event contract.

## Practical implementation challenges
- XState v5 typing: guard/action/event payloads need consistent discriminated unions; scattered guards can cause type drift—centralize event types.
- Delete-before-create strategy risks temporary graph holes; consider transactional MERGE or shadow nodes to preserve referential integrity for cross-file edges.
- Tree-sitter adapter must align with existing analyzer types; double adaptation (LanguageRouter → adapter → StructuralParseResult) may add overhead; ensure streaming or minimal allocations to hit latency goals.
- Neo4j latency: single-transaction delete+create per file may exceed 150–200ms on remote DBs; need connection pooling, prepared statements, and batched writes for rapid bursts.
- Startup reconciliation on large repos could be slow; needs sampling or chunked scans plus progress logging; also ensure buffered events don’t explode memory.
- Backpressure/unwatch approach risks missing FS events; consider chokidar’s `awaitWriteFinish` or debounced batching instead of pausing the watcher entirely.
- Semantic cycle prevention uses a Set but doesn’t address multi-file dependency cycles triggering mutual enqueue; need per-batch dedupe and max depth/TTL.

## Recommendations
- Re-scope performance targets to include DB RTT budgets and specify measurement points (structural-only vs structural+graph).
- Define strict contracts for StructuralParseResult (required fields, normalized paths) and for ParseError handling in GraphUpdater.
- Clarify reconciliation semantics for cross-file edges: either regenerate after structural write or avoid deleting until replacements are ready.
- Add persistence or replay strategy for buffered events during crash, or explicitly document non-durability.
- Wire GraphWriteLock/per-file mutex ordering and priority; document starvation avoidance.
- Add semantic retry/backoff and a failure flag distinct from parseError/syncError (e.g., semanticError).
- Document fallback behaviors: hash unavailable on unlink, watcher unwatch failure, migration failure (fail-fast vs degraded).
