# Review of DevAC Spec v1.10 (Incremental Graph Updates)

## Summary
- Overall direction is solid (incremental TS/JS only, atomic structural writes, queued semantic pass) but several implementation and operational gaps remain.
- Key risks: optimistic latency targets, unclear coordination between actors (especially semantic completion signaling), and insufficient coverage of recovery/backpressure interactions.

## Feasibility (working vs broken components)
- Marked “Working” components (FileWatcher, StructuralParser, Neo4jClient) are plausible; however, StructuralParser “working” still depends on unresolved tsc errors noted in timeline (Phase 1b), so its status is overstated.
- Components tagged “Needs fixes” (actors, RelationshipResolver) are correctly categorized; adapter/API mismatches are acknowledged, but the spec assumes ts-morph + resolver APIs are stable—any deviation will reintroduce the same mismatch.
- Missing: confirmation that SemanticResolverActor can actually run with the current RelationshipResolver API and ts-morph project lifecycle—no proof via tests or spike.

## Architecture (two-phase parsing & boundaries)
- Two-phase (structural → semantic) split is sound, with FileMutex and atomic graph writes containing structural-only data before semantic edges. Boundaries are described but the “GraphUpdaterActor → SemanticResolverActor” contract relies on the SemanticQueued flag without specifying who clears or requeues on failure beyond writeSemanticResults (needs clearer state machine transitions).
- FileWatcher → ValidationCoordinator → LanguageRouter → GraphUpdater → SemanticResolver → Storage is mostly explicit, but the coordinator responsibilities (dedupe, mutex, guard, enqueue, crash recovery, circuit breaker responses) need a state chart to avoid overlapping transitions and race conditions (e.g., simultaneous delete + change).

## Implementation Phases / Dependencies
- Phase ordering is mostly correct (types/adapters before integration; lifecycle + backpressure before semantic). However, Phase 0.5 (adapters) precedes confirmed import-path fixes (Phase 1a), so adapters may compile against unstable paths. Consider swapping: finish import path/tsconfig resolution before adapter work.
- Crash-recovery logic (structuralInProgress clearing) happens in startup (Phase 2) but depends on FileMutex correctness (Phase 2) and ValidationCoordinator behaviors; ensure these land together or recovery may misclassify states.
- Integration tests (P2.4) are listed late (Phase 4) but required earlier to validate wiring; suggest smoke/integration at end of Phase 2/3 to de-risk.

## Performance Targets (<200ms/<100ms)
- Targets (<150ms graph update, <100ms parse, <400ms total warm local+APOC) are aggressive but possibly achievable only for small TS files, warm caches, and local Neo4j. Cold-start and remote multipliers are acknowledged, yet the structural parse still depends on disk I/O and ts-morph project warming—realistic P50 may exceed 400ms without persistent project preload and file cache.
- Graph update path includes delete+create with per-type batching; APOC fallback will be substantially slower and may exceed the stated budgets. Recommend publishing expected ranges with/without APOC and with varying node counts (small/medium/large files).

## Missing Pieces / Failure Modes
- Error handling: No explicit policy for LanguageRouter.parse failures beyond per-file return; who marks parseError and requeues? Structural parse errors are not written anywhere except via GraphUpdater transaction; needs consistent status update when parsing fails before graph write.
- Rollback: Assumes single Neo4j transaction handles all structural writes, but semantic write-back deletes/recreates cross-file edges without version checks—concurrent semantic runs could clobber newer data. Need structuralVersion/semanticVersion guards or optimistic concurrency.
- Circuit breaker: Not specified how ValidationCoordinator throttles/pauses the FileWatcher queue when the circuit is open; events may still accumulate and exhaust memory.
- Backpressure + crash recovery interaction: No policy on what happens to queued items when PAUSE/RESUME is toggled or after restart (queue is in-memory only).
- Rename reconciliation: Reconciliation pass runs late; no protection against entityId drift for in-flight semantic edges referencing old paths.
- Metrics/observability: Logging metrics exists, but no aggregation/export; cannot validate SLOs or spot regressions.

## Integration Points (FileWatcher → LanguageRouter → Parser → StorageManager)
- FileWatcher integration is mostly defined (debounce, rename detector), but the handoff to ValidationCoordinator lacks explicit acknowledgment or retry on watcher errors.
- LanguageRouter covers only TS/JS and skips unsupported languages, but ValidationCoordinator behavior for skipped files (mark skipped? drop silently?) is unspecified, risking stuck semanticQueued flags.
- Parser → GraphUpdater contract is clear via adaptParseResult, but GraphUpdater’s side effects on flags (structuralComplete, semanticQueued) need to be mirrored in ValidationCoordinator state to avoid double-enqueue or missed semantic runs.
- SemanticResolverAdapter relies on Neo4j reads to reconstruct nodes/relationships; this is slower and may stale-cache entityIds if structuralVersion changes between reads—should be version-gated or use in-memory pass-through from prior structural result when possible.

## Practical implementation challenges
- ts-morph project warm-up and file refresh costs will dominate early phases; without persistent process and preloading, latency targets fail.
- Frequent file changes risk overtaking the bounded queue even with dedupe; drop policies need telemetry and alerts.
- EntityId rewrite on rename assumes a prefix match that strips extensions; corner cases (same basename in different dirs, index files) may mis-rewrite.
- Semantic deletion of cross-file edges (MATCH ... WHERE target.filePath <> filePath) can remove same-file semantic edges unintentionally; needs tighter labels/flags to avoid over-deletion.

## Recommendations
- Add state-machine diagram for ValidationCoordinator with explicit transitions for PAUSE/RESUME, CIRCUIT_OPEN/CLOSED, FILE_RENAMED/DELETED, and failure paths.
- Introduce version checks (structuralVersion/semanticVersion) in semantic write-back to prevent stale overwrites; optionally store semanticVersion on File node.
- Move minimal integration tests earlier (end of Phase 2) and add a hot-path benchmark script to validate latency targets with/without APOC.
- Specify queue persistence/clearing rules on crash/shutdown; consider writing pending items to disk or at least counting dropped events.
- Clarify parse-error handling: set parseError, clear structuralInProgress, do not set structuralComplete, and emit metrics for failures.
