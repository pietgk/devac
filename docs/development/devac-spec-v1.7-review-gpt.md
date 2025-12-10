# Review of devac-spec v1.7

## 1) Feasibility
- Working vs broken components: spec lists LanguageRouter/StructuralParser/GraphUpdater as present, but tree-sitter adapters and ParseResultAdapter are marked to create, so the claim “IMPLEMENTATION-READY” overstates readiness—core parsing for Python/Java is still unimplemented. Verified file locations should be revalidated (some paths e.g., `src/pipeline/*` may not exist yet); otherwise the phase plan assumes future files. The fallback for missing APOC is noted but not designed (no Cypher shown), so GraphUpdater may still be blocked if APOC absent.

## 2) Architecture
- Two-phase parsing (structural → semantic) is sound, but boundaries between ValidationCoordinatorActor, LanguageRouter, and GraphUpdater are only partially defined (no explicit contracts for input/output shapes, error codes, or idempotency). SemanticResolver is enqueued after structural, yet the spec doesn’t state how structural nodes are reconciled with later semantic results (e.g., overwrite vs merge). FileMutex is per-file only; concurrent cross-file relationships (imports) can still race if two files reference each other—needs clarified ownership or transaction strategy.

## 3) Implementation Phases
- Ordering is mostly sane (Phase 0 verification → typing fixes → integration), but Phase 2 tasks (router + adapter + mutex) depend on file creations from Phase 0/1; ensure stubs land before wiring to avoid blocking. Tree-sitter work is in Phase 3 but LanguageRouter already routes to it; until implemented, router must short-circuit or feature-flag to prevent runtime errors. Deletion handling is not called out in phases, yet success criteria require deletes—needs explicit task.

## 4) Performance Targets
- <100ms TS/JS parse and <200ms graph update per file are aggressive: Babel parse + AST walk + disk read + GC + Neo4j round-trip (even batched) will likely exceed 200ms on cold caches; realistic target might be 150–250ms parse and 200–400ms graph update, with 500ms end-to-end only under warm caches and small graphs. No measurements or profiling plan are included; without sampling targets per environment (local vs CI vs desktop), risk of missed SLA is high.

## 5) Missing Pieces / Risks
- Rollback/failure: Graph updates lack atomicity description—if relationship batch partially fails, how is prior state restored? No retry/backoff policy around Neo4j writes beyond a health check; no dead-letter for persistent failures. File delete flow, rename handling, and startup reconciliation semantics (full scan vs incremental diff) are acknowledged but not designed, yet are critical for correctness. Error taxonomy is focused on parse vs graph errors; semantic failures and queue overflows are mentioned but not persisted/observable (no metrics/log schema). No contract for import resolution stubs—downstream components may get nulls without guardrails. Graceful shutdown and in-flight work draining are noted as missing; affects data consistency.

## 6) Integration Points
- FileWatcher → ValidationCoordinatorActor → LanguageRouter → StructuralParser → ParseResultAdapter → GraphUpdater → SemanticResolver is described, but message schemas, expected side effects, and transaction boundaries are unspecified. GraphUpdater input expects structural shape, but adapter mapping is defined only in spec; without a shared type exported from GraphUpdater the integration is brittle. Storage writes (indexes, labels) and APOC/no-APOC modes need an explicit switch to keep the pipeline running. Semantic queue contract is outlined, but signaling from structural phase (e.g., only on success, skip on delete) is unstated.

## Recommendations
- Add explicit contracts (TypeScript interfaces) for events between stages, including success/error/result semantics and idempotency notes. Add a feature flag to disable tree-sitter paths until Phase 3 lands. Define delete/rename handling and rollback strategy for failed graph updates (e.g., wrap in single tx with MERGE+DETACH or compensating delete on failure). Provide a measurement plan with baseline targets and warm/cold budget splits; adjust targets after measuring. Specify APOC fallback Cypher and a runtime mode switch. Document how semantic passes reconcile with structural nodes (replace vs augment) and how cross-file relationships are revalidated.
