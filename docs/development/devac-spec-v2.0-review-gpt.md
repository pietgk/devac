# DevAC v2.0 Spec Review (GPT)

## 1) Feasibility & component status
- Working pieces correctly identified: DuckDB/Parquet, per-package seeds, content-hash skip, atomic writes, two-pass parsing, LanguageRouter, SeedWriter, structured logging, partitioned seeds, MCP/CLI surface.  
- “Broken/known limits” mostly accurate (Windows rename/lock issues, base-branch write amplification, Python latency, deep CTE costs). Watch/update targets (<100ms) conflict with later table that sets 150–300ms p50; treat earlier <100ms claim as unrealistic with current components.  
- Risk: Python parser via per-invocation subprocess likely >200ms cold; needs warm worker to meet even relaxed goals. Cross-repo edge cache invalidation path only “manual/background” → correctness risk for real usage.

## 2) Architecture
- Two-phase design (structural then semantic) is sound and mirrors v1. Pass boundaries clear: per-file structural, batched cross-file resolution.  
- Boundaries blur at “SeedWriter writes per-file partitions” text; later spec adopts per-package-per-branch files—need to remove leftover per-file mentions to avoid implementation mismatch.  
- Entity IDs exclude branch (good) but relies on scoped-name stability—needs deterministic generator parity across languages to avoid cross-parser drift.  
- Federation layering is coherent (package → repo manifest → hub) but hub read paths for node/edge data are implicit (hub stores only computed edges); spell out how queries combine hub state with package globs.

## 3) Implementation phases & dependencies
- Phase graph mostly correct: Phase 1 prerequisite for Phase 2/3, Phase 4 depends on 1–3, Phase 5 on 4.  
- Text still references per-file partitions in Phase 2 tasks; should align with adopted per-package+delta storage.  
- Incremental updates rely on hash comparison before parse; dependency on LanguageRouter + hashing + SeedWriter should be made explicit in Phase 2 checklist.

## 4) Performance targets
- <200ms/<100ms targets are inconsistent with later table (single file warm 150–300ms p50, 300–500ms p95). Python cold parse (200–500ms) already exceeds <200ms. Base-branch rewrites (300–500ms) contradict <200ms write target. Treat tables as achievable; retire earlier headline targets or restate as stretch.  
- Batch 10-file change <500–800ms assumes full parallelism and small packages; needs justification or measurement plan.

## 5) Missing pieces / failure modes
- Error handling: good fatal DuckDB recovery, but no plan for partial semantic resolution failures (retry/backoff, mark unresolved with reason).  
- Rollback: atomic writes covered; missing strategy for corrupted/partial branch seeds (auto-verify + regenerate).  
- Cross-repo staleness: no invalidation triggers; hub cache rebuild policy needs SLA and detection.  
- Watcher gaps: no documented recovery if chokidar misses events besides hash sweep cadence.  
- Security/permissions not covered (seed file ACLs, temp dir exposure).  
- Concurrency: single-writer assumption stated but not enforced (no locks around SeedWriter).  
- Validation failure paths: what happens if validators crash—no isolation of partial results.

## 6) Integration points (FileWatcher → LanguageRouter → Parser → StorageManager/SeedWriter)
- Interfaces exist but need contract clarity: watcher should filter using router.getSupportedExtensions; seed path resolution per package/branch must be explicit.  
- Semantic resolver path to hub for cross-repo edges is underspecified (API, caching, invalidation).  
- StorageManager/SeedWriter naming: spec mixes terms; pick one to avoid ambiguity.

## Practical implementation challenges
- Scoped-name generation must be identical across parsers and stable under minor edits; define shared fixtures/tests early.  
- Per-package rewrite on base branch may be slow for large packages; consider chunking or background base consolidation.  
- Python cold-start overhead likely breaks tight watch budgets; need warm worker/pool.  
- DuckDB fatal-mode handling exists, but multi-file parallel writes may contend on temp/dir fsync; ensure per-package serialization.  
- Cross-branch queries require consistent branch filtering; ensure all tables partition by branch and APIs expose branch selection defaults.  
- Windows/WSL gap: retries/backoff plan needed before broader rollout.

## Recommendations (minimal spec edits)
1) Remove or clearly mark <100ms/<200ms targets as stretch; keep table values as primary.  
2) Delete remaining per-file partition wording; align Phase 2 tasks and SeedWriter description with per-package-per-branch + delta.  
3) Specify cross-repo edge cache invalidation policy (manual command + optional periodic) and hub query flow.  
4) Add contract/tests for scoped-name generation across languages.  
5) Document watcher recovery via hash sweep cadence (e.g., on start and periodic).  
6) Clarify single-writer constraint and locking strategy for SeedWriter (per-package mutex).  
7) Note Python warm-worker requirement to hit targets; otherwise adjust expectations.  
8) Define error classification for semantic resolution (retryable vs terminal) and how unresolved refs are surfaced.
