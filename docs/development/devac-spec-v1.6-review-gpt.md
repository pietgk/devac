# DevAC Spec v1.6 Review (GPT) — 2025-12-10

## 1) Feasibility (working vs broken)
- Working components are mostly identified, but “works” claims for `AffectedCalculatorActor` and `ScriptExecutorActor` are unproven for incremental use (they were batch-oriented); treat them as “needs adaptation,” not “works.”  
- Wrong-path imports called out correctly; missing `ImportResolver`/`PackageInfo` definitions remain unresolved and must be classified as blockers in Phase 0.  
- GraphUpdater type vs StructuralParser output mismatch is accurately diagnosed; adapter is a feasible fix.  
- Tree-sitter coverage is listed but no evidence of existing adapters or outputs matching GraphUpdater; this should be marked “missing,” not “ready.”

## 2) Architecture (two-phase parsing + boundaries)
- Two-phase flow (structural parse → graph update, then semantic enqueue) is sound, but boundaries blur because LanguageRouter is specified as both a router and an adapter host—consider keeping adaptation outside the router to avoid hidden coupling.  
- GraphUpdater does DETACH DELETE per file; this is acceptable but makes incoming edges stale until semantic re-resolution—documented as a limitation, but the design assumes a later dependent re-parse mechanism that is deferred to v2.  
- FileWatcher → Coordinator → Router → Parser → Adapter → GraphUpdater → Semantic queue is clear; the semantic side’s contract (what’s enqueued, de-dupe, retry) is unspecified.  
- Startup reconciliation and event buffering are listed but not defined (what gets reconciled? how do we diff FS vs DB?).

## 3) Implementation phases & dependencies
- Phase ordering is mostly correct, but Phase 2 assumes `parse-result-adapter` exists before wiring Router; make that an explicit prerequisite.  
- DELETE handling in GraphUpdater is Phase 2 Day 11, yet LanguageRouter wiring (Day 9) can already emit delete events—ensure delete path exists before end-to-end wiring.  
- Tree-sitter wiring (Phase 3) depends on a `tree-sitter-adapter` that isn’t specified; add it as a hard prerequisite for Day 15.  
- Phase 0 should explicitly include resolving/creating `ImportResolver`/`PackageInfo` and verifying semantic queue contract; otherwise Phase 1 typing cannot converge.  
- No gating for Neo4j connectivity/retries before integration; add to Phase 2 entry criteria.

## 4) Performance targets (<200ms/<100ms)
- <300ms stated; prompt mentions <200/<100ms—TS/JS via ts-morph cold parse will exceed 200ms per file unless the project is hot, AST reused, and GC avoided.  
- Tree-sitter languages can meet <100ms with cached grammars, but IO + adapter + Neo4j write round-trip will likely exceed 100ms unless using in-process batching or async write-behind.  
- GraphUpdater doing per-file DETACH DELETE + create is unlikely to stay under 200ms with Neo4j over network; would need persisted sessions, pipelined queries, and batched writes. Targets are optimistic unless these optimizations are in scope.

## 5) Missing pieces / failure modes
- Error handling: no strategy for parser failures (marking stale?), Neo4j transient errors (retries/backoff), or partial writes (transaction rollback path is mentioned in v1.5 but not described here).  
- Restart/recovery: reconciliation is named but not defined (how to diff FS vs DB? how to heal partial state?).  
- Backpressure: no per-file mutex details (only listed), no queue limits, no debounce/coalescing for rapid successive changes.  
- Event de-duplication and ordering (rename sequences CREATE/DELETE) not covered.  
- Metrics/observability: only “in-memory,” no logging contract for perf budgets.  
- Schema drift/migrations not addressed for incremental runs.  
- Affected reprocessing loop (to refresh incoming edges) is deferred, so staleness window is unbounded—call out as operational risk.

## 6) Integration points clarity
- FileWatcher → ValidationCoordinator: clear, but buffering semantics and start-up reconciliation entry/exit conditions are unspecified.  
- LanguageRouter → Parser → Adapter: types are called out; still need explicit parser outputs per language and error shape (`ParseResult` union).  
- Adapter → GraphUpdater: contract depends on canonicalizing `StructuralParseResult`; ensure single source of truth lives with GraphUpdater.  
- GraphUpdater → SemanticResolver queue: enqueue contract (payload, idempotency, dedupe) is not defined; failure path (enqueue fails) unspecified.

## Practical implementation challenges
- Achieving sub-200ms end-to-end will require hot ts-morph project, disabled repeated program rebuilds, pooled Neo4j sessions, and possibly write-behind batching.  
- Without affected-file recalculation wired, incoming edges remain stale; must accept correctness lag or implement a minimal dependent-enqueue shim in v1.6.  
- Tree-sitter adapters must normalize positions and node IDs to GraphUpdater schema; otherwise cross-language support will fail in Phase 3.  
- Startup reconciliation needs a concrete algorithm (list files in FS vs File nodes, delete-orphan vs add-missing) before “implementation-ready” is credible.  
- Ensure DELETE is idempotent and safe to run after CREATE in rename races; consider versioning or per-file mutex plus last-write-wins policy.
