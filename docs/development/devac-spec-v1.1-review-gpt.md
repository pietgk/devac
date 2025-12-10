# Review of devac-spec-v1.1 (Incremental Graph Updates)

## Summary
- The high-level two-phase design (fast structural write, deferred semantic resolution) is sound and aligns with CodeGraph’s existing batch pipeline, but the spec overstates readiness of several components and under-specifies operational concerns (failure handling, ordering, backpressure, and consistency guarantees).
- Performance targets (<200ms end-to-end structural after debounce) are only plausible for TS/JS and fast tree-sitter paths; Python (200–500ms) and any cold-start overheads make the target unrealistic without a keep-alive plus pre-warm strategy and stricter scope (e.g., “<200ms for TS/JS, <300–500ms for others”).
- Integration points are sketched but not contractually defined (event shapes, required fields, error/timeout semantics), which risks coupling bugs and brittle retries.

## Feasibility (working vs. broken components)
- Labeling StructuralParser/SemanticResolver as “ready” is optimistic: structural-parser has 9 TS errors and currently uses Babel; it does not yet emit the new `StructuralParseResult` (importStrings/exportedSymbols/metadata), so it is not integration-ready. SemanticResolver currently operates in batch mode; the queueing semantics and `pendingImports` consumption for incremental are not implemented.
- Tree-sitter parsers are described as “ready” but lack the adapter and per-language structural shapes; they also currently do not extract imports/exports, so cross-file edges will be missing for non-TS languages unless a follow-on semantic step is defined (not covered).
- FileWatcher and StorageManager are likely usable, but concurrency and ordering guarantees (per-file serialization) are unspecified; without these, atomicity in GraphUpdater can still see races from simultaneous events on the same file.
- Neo4jClient/GraphUpdater actors provide atomic delete-then-insert, but “safe delete” needs confirmation that it removes relationships created by semantic resolution; otherwise, stale IMPORTS edges can linger if semantic runs out-of-band.

## Architecture (two-phase design and boundaries)
- Two-phase separation is good, but boundaries need explicit contracts: Structural → GraphUpdater must guarantee the `StructuralParseResult` shape (including language, loc, parseTime), and GraphUpdater must write a consistent schema (e.g., `pendingImports`, `exportedSymbols`, `semanticComplete=false`).
- Semantic phase is described as TS-only, but the spec doesn’t define what happens for other languages (do they stay permanently without import edges? do we run language-specific semantic steps?). This affects downstream correctness.
- LanguageRouter responsibilities are under-specified: how to handle unsupported extensions, mixed-mode files, or routing failures (should they short-circuit to “drop with log” vs. “retry” vs. “poison queue”)?
- Adapter layer is one-way; no contract for reverse mapping (e.g., when SemanticResolver needs original structural metadata). Consider standardizing IDs/entity keys across phases to avoid duplicated nodes.

## Implementation phases and dependencies
- Phase ordering (fix TS errors → integrate router/pipeline → add adapters → optimize Python) is reasonable, but Phase 2 assumes Phase 1 introduces `StructuralParseResult` and that all parsers implement it; this dependency should be explicit.
- Integration plan omits migration of existing analyzer entrypoints/tests to exercise incremental pipeline; without that, regressions may hide. Add smoke tests for FileWatcher → LanguageRouter → GraphUpdater happy path and failure path before Phase 3.
- Tree-sitter enablement (Phase 3) depends on adapter plus LanguageRouter coverage, but also on per-language parser outputs conforming to the canonical interface—called out, but no task to retrofit each parser.
- Python keep-alive (Phase 4) is listed as perf work but is prerequisite to meeting latency targets; treat as required for SLA, not “optimization.”

## Performance targets
- <200ms structural end-to-end after debounce is tight: budget after 300ms debounce leaves ~200ms for parse + transaction. TS/JS (~20–50ms parse + ~50ms Neo4j) is plausible if Neo4j is warm and network local; tree-sitter paths might fit. Python at 200–500ms violates the target unless parallelized/pre-warmed; spec should split targets by language and note cold-start vs. steady-state.
- Semantic batch 2–10s is acceptable as background, but the spec should define queue throughput/backpressure (max concurrency, max queue length, drop/slowpath behavior) to avoid backlog under large churn.
- No mention of GC/heap impact for ts-morph in incremental mode; prior batch mitigations (source file eviction) should be reused or restated.

## Missing pieces / failure modes
- Retry/rollback: GraphUpdater retries are noted, but no idempotency guidance (e.g., detecting partial writes if transaction aborts mid-batch) or poison-queue handling after max retries. SemanticResolver retry policy is proposed but not tied to metrics/alerts.
- Out-of-order events: FileWatcher may emit rapid sequences (save → format → save); need per-file sequencing and de-duping to avoid thrash and accidental deletion of fresh data.
- Deletions vs. pending semantic work: spec doesn’t define what happens if a file is deleted while queued for semantic resolution—should drop queued items and ensure IMPORTS edges are removed.
- Schema changes: storing `pendingImports`/`exportedSymbols` needs explicit schema migration (existing `dist` builds, tests) and data shape validation.
- Observability: no metrics/logging requirements (latency histograms, retry counts, queue depth, Neo4j transaction timing) to validate the SLAs.
- Testing: success criteria mention `npm test`, but there are no outlined integration tests for the incremental pipeline, nor fixtures for cross-language routes.

## Integration points (FileWatcher → LanguageRouter → Parser → StorageManager)
- Event contract is implied, not defined: FileWatcher should emit {filePath, eventType, mtime, language?}; LanguageRouter needs to return {language, parseResult|error}. Define these as types and enforce in actors to avoid structural drift.
- Parser → GraphUpdater: need guarantees on uniqueness of node IDs/entity IDs, handling of zero-results (e.g., empty file), and explicit marking of `semanticComplete=false` so SemanticResolver knows what to pick up.
- GraphUpdater → SemanticResolver: enqueue policy for TS/JS only is stated but not codified; define an explicit hook or event with backpressure (e.g., bounded channel) to avoid unbounded memory.
- StorageManager expectations (batch size, transaction boundaries) are not tied to the incremental path; clarify whether it is bypassed (actors write directly) or used as a shared abstraction.

## Practical implementation challenges
- Type alignment: XState v5 event typing fixes must be paired with shared event schemas; ad hoc type guards will rot unless events are centralized.
- Concurrency: Multiple file changes in parallel will contend on Neo4j; need either per-file mutex or transactional guards to prevent interleaved delete/insert of the same file.
- Non-TS languages currently lack semantic resolution; consumers must tolerate missing IMPORTS/EXPORTS edges or the spec should commit to minimal import extraction for tree-sitter languages.
- Python latency will dominate unless the keep-alive is implemented; the SLA and rollout plan should reflect this.

## Recommendations
- Add explicit contracts (TypeScript types) for all inter-component messages/events and enforce them in actors.
- Split performance targets by language and state cold vs. warm expectations; require Python keep-alive for SLA.
- Define backpressure/sequencing: bounded queues, per-file dedupe, and drop/merge policies for rapid successive events.
- Add integration tests for the incremental path (watcher → router → parser → updater) and deletion + retry scenarios before expanding languages.
- Document schema fields (`pendingImports`, `exportedSymbols`, `semanticComplete`) and ensure safe deletion removes semantic edges.
