## Review of devac-spec-v2.0

### 1) Feasibility (working vs broken)
- Working set is mostly well-tagged, but “unresolved” items need clearer owners: cross-repo edge rebuild strategy, DuckDB-per-many-small-files validation, Python parser latency mitigation, and C# parser readiness are still risks. External_refs resolution depends on a yet-to-be-defined resolver pipeline; mark as “not implemented” instead of implicitly working. Central hub caches and repo registry are described but no lifecycle (init/upgrade/migration) is specified—treat as TBD.

### 2) Architecture (two-phase parsing, boundaries)
- Two-pass (structural then semantic) is sound and matches current CodeGraph model; per-file partitioning aligns with the incremental goal. Boundaries are mostly clear (FileWatcher → LanguageRouter/Parser → SeedWriter → Semantic resolver → Query), but the semantic resolver component is underspecified (ownership of import resolution, batching policy, error surfaces). Need an explicit contract for how semantic pass reads/writes Parquet and how it coordinates with the hub for cross-package/ cross-repo lookups.

### 3) Implementation phases & dependencies
- Phase ordering is reasonable; Phase 2 (incremental) depends on a functional SeedWriter and watcher debounce, which requires the structural pass to already emit stable source_file_hash and entity_id. Phase 4 (federation) depends on cross-repo edge computation logic that is only named, not designed; call out as blocking. Phase 5 validation assumes semantic resolution is reliable; make that dependency explicit.

### 4) Performance targets realism
- TS structural <50ms and write <20ms seem achievable for medium files; Python <200ms per file is optimistic without a long-lived parser/RPC. End-to-end <100ms per change ignores chokidar debounce, file hash, DuckDB startup, and fs sync; realistic target is 150–250ms cold / 80–120ms warm with pooling. Repo query targets (<500ms at 10K files) depend heavily on DuckDB handling thousands of small Parquet parts and OS cache; needs benchmark evidence before committing.

### 5) Missing pieces / failure modes
- Error handling: how to surface parser/duckdb write failures, partial writes, and rollback when writing three parquet partitions—need atomicity or temp-file+rename. Rename/delete handling lacks manifest/hub invalidation and cache invalidation rules. Cross-repo edge staleness strategy is still open; no TTL or invalidation. Validation integration: what happens when resolution is incomplete (e.g., missing package)? Should degrade gracefully with explicit flags in external_refs. No story for schema evolution of Parquet (column adds/removals) or versioning of seed format. Crash recovery for mid-write seeds is unaddressed.

### 6) Integration points clarity
- FileWatcher → LanguageRouter/Parser is clear; Parser → SeedWriter is clear for structural output. Structural → Semantic resolver and Semantic → SeedWriter update path is vague (how resolved refs are persisted; whether edges are mutated or external_refs updated in place). StorageManager/Central hub interplay is underspecified: when and how cross-repo edges get materialized, invalidated, and consumed by queries or validators.

### Practical implementation challenges / recommendations
- Define a semantic resolver module with clear inputs (external_refs parquet) and outputs (updated external_refs with resolution flags, optional edges). Specify atomic Parquet writes (write to temp, fsync, rename) to avoid torn seeds. Add cold vs warm latency budgets; adjust targets accordingly and require benchmarks in Phase 1. Add manifest/hub versioning and migration plan. Decide on strategy for many-small-file Parquet performance (benchmarks + fallback single-package file mode). Plan for long-lived Python parser service or cache to meet <200ms. Document cache invalidation (watcher-driven, manual hub rebuild, optional TTL).
