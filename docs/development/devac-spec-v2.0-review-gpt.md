# DevAC Spec v2.0 Review (GPT)

## 1) Feasibility (working vs broken)
- **Working/clear:** Package seed layout (base/branch), atomic Parquet writes, scoped entity IDs without branch, LanguageRouter/Parser contracts, two-pass parsing, central hub storing only computed edges, CLI surface, hash-based skip flow, crash-safe temp+rename+fsync.
- **Likely brittle/missing:** Python parser latency acknowledged but not mitigated (no worker pool/warm process); Babel+ts-morph dual-path not described for error reconciliation; external ref resolution flow depends on `findExportInSiblings/Hub` implementations that are unspecified; Windows rename/locking called out as known limitation with only a future retry plan.

## 2) Architecture (two-phase and boundaries)
- Two-phase split (structural per-file → semantic cross-file) is sound and mirrors v1; boundaries between FileWatcher → LanguageRouter → StructuralParser → SeedWriter are conceptually clear.
- Semantic Resolver responsibilities are under-specified: who orchestrates reading/writing updated external_refs and coordinating hub lookups? The “phase 4” location is noted but no owning component/module boundary is named.
- Storage layering (package seeds, repo manifest, central hub) is coherent; however, the hub contract (API/schema, cache invalidation rules) needs explicit interface definitions.

## 3) Implementation phases/dependencies
- Phase graph is mostly correct: P1 foundation → P2 incremental → P4 federation → P5 validation is the critical path; P2 and P3 parallelization is plausible.
- Missing explicit prerequisites: P2 incremental depends on a stable SeedWriter API and deterministic entity IDs; P4 federation depends on external_ref resolution semantics being implemented (not just structural data); P5 validation depends on cross-repo resolution availability and affected-file queries over unified base+branch views.

## 4) Performance targets realism (<200ms/<100ms)
- Hash-check (<50ms) and Parquet write (<100-200ms) are plausible; TS parse <50-200ms/file is realistic for median files.
- End-to-end 150-300ms warm / 300-500ms cold per file change is optimistic but feasible only if: (a) DuckDB connection warm, (b) Parquet write size small, (c) no semantic resolution executed on the hot path. If semantic resolution or cross-package queries occur per change, targets will slip.
- Batch 10-file change in <500-800ms assumes parallel parsing and a single merged Parquet write; spec doesn’t describe batching mechanics in SeedWriter/merger.

## 5) Missing pieces / failure modes
- **Error handling:** No contract for parser partial failures (per-file timeouts, malformed AST) or how to mark files as “errored” in seeds; no structured error schema in Parquet.
- **Rollback/atomicity:** Writes are atomic per file, but multi-file operations lack a transaction story—partial package rewrites can leave branch/base divergence; no orphan-cleanup procedure for failed semantic resolution writes.
- **Recovery:** No boot-time reconciliation for dangling `.tmp`, mismatch between manifest and seeds, or corrupted Parquet detection beyond DuckDB fatal handling.
- **Validation of hub data:** Cross-repo edges staleness detection and invalidation policy are not specified (only “manual rebuild” suggestion).
- **Watch gaps:** If watcher misses events, the hash-scan path exists, but the cadence/trigger for running it in watch mode is unspecified.

## 6) Integration points (FileWatcher → LanguageRouter → Parser → SeedWriter)
- Router/Parser interface is defined, but FileWatcher contract (event coalescing, rename handling, debounce) and how it passes work units (paths + branch context) to parsers is absent.
- SeedWriter API covers single-file operations, but merge/update semantics for package-level Parquet rewriting (especially base branch amplification) are not fully described.
- Semantic resolver-to-SeedWriter update path (who rewrites external_refs.parquet and ensures read-after-write visibility) is unspecified.

## Practical implementation risks / recommendations
- Define explicit module owners: `watcher -> work queue -> parser workers -> seed writer -> semantic resolver -> hub updater`, with backpressure and retries.
- Add an error lane: per-file status table (in Parquet or sidecar) for parse failures/timeouts; ensure `verify` surfaces them.
- Specify batching/merging strategy for multi-file updates to hit the batch latency targets; otherwise per-file rewrites will exceed budgets.
- Document hub API (tables, invalidation) and cross-repo edge rebuild triggers to avoid stale resolutions.
- Add Windows retry/backoff plan to the mainline spec or explicitly mark Phase 1 as *nix-only and fail-fast on Windows.
