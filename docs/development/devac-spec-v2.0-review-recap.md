# DevAC Spec v2.0 - Consolidated Architecture Review Recap

**Date:** 2025-12-14  
**Reviewers:** Claude (Anthropic), GPT (OpenAI), Gemini (Google)  
**Purpose:** Consolidate findings, identify consensus/disagreements, and provide GO/NO-GO recommendation

---

## Executive Summary

Three independent AI reviewers assessed the DevAC v2.0 specification. The core architectural pivot from Neo4j to DuckDB+Parquet received **unanimous approval** with caveats. Critical gaps exist in error handling and concurrency that must be addressed before implementation.

| Verdict | Status |
|---------|--------|
| **Architecture** | ✅ APPROVED with conditions |
| **Feasibility** | ✅ HIGH (all reviewers agree) |
| **Performance Targets** | ⚠️ NEEDS REVISION (inconsistent) |
| **Error Handling** | ❌ INSUFFICIENT (all agree) |
| **Ready for Phase 1?** | ⚠️ CONDITIONAL GO |

---

## 1. Points of Agreement (Consensus)

All three reviewers agree on the following architectural concerns and assessments:

### 1.1 ✅ Core Architecture is Sound

| Aspect | Consensus |
|--------|-----------|
| Neo4j → DuckDB+Parquet pivot | **Correct decision** - solves real v1.x pain points |
| Two-pass parsing design | **Proven pattern** - structural then semantic |
| Per-package-per-branch partitioning | **Right tradeoff** - avoids 15K+ file explosion |
| Atomic write pattern (temp+rename) | **Correct approach** for data integrity |
| "Source is Truth" principle | **Simplifies architecture** - removes sync complexity |

**Evidence from codebase:**
- `src/analyzer/structural-parser.ts` already implements Babel-based fast parsing
- `src/analyzer/parser.ts` already has two-pass orchestration
- `AnalyzerService` orchestrates Parse → Resolve flow

### 1.2 ✅ Working Components Correctly Identified

All reviewers agree these components are production-ready and should be preserved:

| Component | File Location | Status |
|-----------|---------------|--------|
| StructuralParser (Babel) | `src/analyzer/structural-parser.ts` | ✅ Ready for Phase 1 |
| Python parser (subprocess) | `src/analyzer/python-parser.ts` | ✅ Working |
| FileWatcher (chokidar) | `src/devac/services/codegraph/file-watcher.ts` | ✅ Has debouncing |
| ts-morph integration | `src/analyzer/parser.ts` | ✅ For semantic pass |
| Test fixtures | Various | ✅ Keep |

### 1.3 ✅ "Broken" Components Correctly Identified

| Component | Verdict | Reason |
|-----------|---------|--------|
| Neo4j client | Remove | No longer needed with DuckDB |
| NodeIndexCache | Remove | Was symptom of wrong DB choice |
| StorageManager | Replace | Neo4j-specific, needs SeedWriter |

### 1.4 ❌ Error Handling is Insufficient (Critical Gap)

**All three reviewers flagged this as a critical gap:**

| Scenario | Claude | GPT | Gemini |
|----------|--------|-----|--------|
| Parse failure (syntax error) | ❌ Not specified | ❌ Not specified | ❌ Not specified |
| Partial Parquet write failure | ⚠️ Needs retry | ❌ No plan | ❌ Temp file cleanup needed |
| Corrupt Parquet on read | ❌ Not specified | ❌ No plan | ❌ Not specified |
| OOM during analysis | ❌ Not specified | ❌ Not specified | ❌ Not specified |
| Semantic resolution failures | - | ❌ No retry/backoff | - |

**Recommendation (all agree):** Add explicit error classification and recovery strategies before Phase 1.

### 1.5 ❌ Concurrent Write Protection Missing

All reviewers noted the spec doesn't address:
- Two terminal sessions running `devac analyze` simultaneously
- Watch mode running + manual `devac analyze`
- File locked by IDE (Windows EBUSY)

**Claude's recommendation (endorsed by others):** Add lock file per package:
```
.devac/seed/.lock (advisory lock)
```

### 1.6 ⚠️ Performance Targets are Inconsistent

All reviewers noted conflicting targets in the spec:

| Target Location | Value | Achievability |
|-----------------|-------|---------------|
| Summary section | <100ms incremental | ❌ Unrealistic |
| Latency table | 150-300ms p50 | ✅ Achievable |
| Cold start | Not specified | ~500-700ms realistic |

**Consensus:** Use the latency table values as primary. Retire <100ms as stretch goal.

### 1.7 ⚠️ Python Parser Latency Risk

All reviewers noted:
- Per-invocation subprocess: 200-500ms cold start
- Exceeds tight watch budgets
- **Recommendation:** Warm worker/pool needed for Phase 3

---

## 2. Points of Disagreement (Need Resolution)

### 2.1 Phase 1 Timeline Estimates

| Reviewer | Estimate | Buffer |
|----------|----------|--------|
| Claude | 22-24 days | +20-30% over spec |
| GPT | (Not specified) | Mentions "aggressive" |
| Gemini | 18 days "tight" | Suggests splitting Phase 1 |

**Disagreement:** Whether Phase 1 can be done in 18 days.

**Resolution:** Accept Claude's 22-24 day estimate. Add checkpoint after Phase 1 to validate assumptions before Phase 2.

### 2.2 LanguageRouter Abstraction

| Reviewer | Position |
|----------|----------|
| Claude | New interface needed, underspecified |
| GPT | Refactor of existing Parser class |
| Gemini | New class, but unclear if new or refactor |

**Disagreement:** Whether LanguageRouter is a new component or refactor.

**Resolution:** Define LanguageRouter as a refactor of the existing `Parser` class routing logic (switch statement), extracted to a dedicated interface. Not a ground-up rewrite.

### 2.3 SeedWriter vs StorageManager Naming

| Reviewer | Concern |
|----------|---------|
| Claude | ✅ Clear on SeedWriter interface |
| GPT | Notes "spec mixes terms" |
| Gemini | Suggests prototype first |

**Resolution:** Adopt "SeedWriter" consistently. Retire "StorageManager" naming for v2.0.

### 2.4 Rename Detection Strategy

| Reviewer | Position |
|----------|----------|
| Claude | Treat rename as delete+add (simple) |
| GPT | Not addressed |
| Gemini | Not addressed |

**Resolution:** Accept Claude's recommendation - don't try to track renames. Simpler implementation.

---

## 3. Feasibility Assessment Consensus

### 3.1 Overall Feasibility: HIGH

All reviewers rate feasibility as HIGH with caveats:

| Risk Area | Severity | Mitigation Status |
|-----------|----------|-------------------|
| DuckDB Node.js bindings maturity | Medium | Need careful testing |
| Parquet corruption | Medium | Atomic writes specified ✅ |
| Python parser latency | Low-Medium | Warm worker optional |
| Windows file locking | High | Deferred to Phase 4+ ✅ |
| Memory limits | Medium | Need OOM handling |

### 3.2 Technology Validation

| Technology | Validation Status |
|------------|-------------------|
| DuckDB | ✅ Proven for analytical workloads |
| Parquet | ✅ Columnar, ideal for code queries |
| Babel (StructuralParser) | ✅ Already implemented, <200ms |
| ts-morph | ✅ Keep for semantic resolution |
| chokidar | ✅ FileWatcher already works |

### 3.3 Existing Code Leverage

| Spec Component | Existing Code | Gap |
|----------------|---------------|-----|
| `StructuralParseResult` | `SingleFileParseResult` | Add `externalRefs` field |
| `LanguageParser` | `Parser` class methods | Extract to interface |
| `SeedWriter` | `StorageManager` | Complete replacement |
| `FileWatcher` | `FileWatcher` class | ✅ Ready to use |
| `LanguageRouter` | Switch in Parser | Extract to component |
| `DuckDBPool` | Not implemented | New |

---

## 4. Prioritized Action Items for v2.1

### CRITICAL (Block Phase 1 Start)

| # | Action | Owner | Est. Effort |
|---|--------|-------|-------------|
| C1 | Define concurrent write protection (lock file mechanism) | Architect | 0.5 day |
| C2 | Specify error classification (retryable vs terminal) | Architect | 0.5 day |
| C3 | Document corrupt Parquet recovery (integrity check + auto-regenerate) | Architect | 0.5 day |
| C4 | Clarify entity ID encoding (UTF-8, separators, path normalization) | Architect | 0.5 day |

### HIGH (Before Phase 1 Completion)

| # | Action | Owner | Est. Effort |
|---|--------|-------|-------------|
| H1 | Prototype SeedWriter with DuckDB/Parquet | Dev | 2-3 days |
| H2 | Remove/mark <100ms targets as stretch in spec | Architect | 0.5 day |
| H3 | Add temp file cleanup on startup | Dev | 0.5 day |
| H4 | Define LanguageRouter interface | Architect | 1 day |
| H5 | Add memory pressure detection guidance | Architect | 0.5 day |

### MEDIUM (Before Phase 2)

| # | Action | Owner | Est. Effort |
|---|--------|-------|-------------|
| M1 | Add event dispatcher interface (FileWatcher → Parser) | Dev | 1 day |
| M2 | Define batch vs stream write criteria | Architect | 0.5 day |
| M3 | Document watcher recovery via hash sweep cadence | Architect | 0.5 day |
| M4 | Add scoped-name generation tests (cross-parser parity) | Dev | 1 day |
| M5 | Specify branch detection caching strategy | Architect | 0.5 day |

### LOW (Document for Later)

| # | Action | Owner | Est. Effort |
|---|--------|-------|-------------|
| L1 | Metrics/tracing export (OpenTelemetry) | Dev | 2 days |
| L2 | Health check for MCP server | Dev | 0.5 day |
| L3 | Cross-repo edge cache invalidation policy | Architect | 1 day |
| L4 | Python warm worker implementation | Dev | 2 days |

---

## 5. GO/NO-GO Recommendation

### 🟡 CONDITIONAL GO

**Verdict:** Proceed with Phase 1 implementation **after** completing CRITICAL action items (C1-C4).

### Conditions for GO:

1. ✅ Complete C1-C4 (concurrent write, error handling, recovery, entity IDs) - ~2 days
2. ✅ Update performance targets in spec (retire <100ms) - ~0.5 day
3. ✅ Add 20% buffer to Phase 1 timeline (18 → 22 days)
4. ✅ Plan checkpoint after Phase 1 to validate assumptions

### Rationale:

| Factor | Assessment |
|--------|------------|
| Architecture | ✅ Sound, proven patterns |
| Technology choices | ✅ Well-reasoned |
| Existing code leverage | ✅ 60%+ reuse possible |
| Risk mitigation | ⚠️ Needs CRITICAL items addressed |
| Timeline | ⚠️ Needs +20% buffer |
| Team capability | ✅ Existing codebase shows competence |

### Risk if Conditions Not Met:

| Skipped Condition | Risk |
|-------------------|------|
| C1 (Concurrent writes) | Data corruption in multi-terminal use |
| C2 (Error classification) | Silent failures, inconsistent state |
| C3 (Corrupt recovery) | Manual intervention required on errors |
| C4 (Entity ID encoding) | Cross-parser drift, query failures |

---

## 6. Summary Matrix

| Concern | Claude | GPT | Gemini | Consensus |
|---------|--------|-----|--------|-----------|
| Architecture sound | ✅ | ✅ | ✅ | **AGREE** |
| DuckDB+Parquet right choice | ✅ | ✅ | ✅ | **AGREE** |
| Two-pass design | ✅ | ✅ | ✅ | **AGREE** |
| Error handling gaps | ❌ | ❌ | ❌ | **AGREE - FIX** |
| Concurrency gaps | ❌ | ❌ | ❌ | **AGREE - FIX** |
| Performance targets inconsistent | ⚠️ | ⚠️ | ⚠️ | **AGREE - FIX** |
| Phase 1 timeline | 22-24d | Aggressive | 18d tight | **NEEDS BUFFER** |
| LanguageRouter definition | Underspec | Refactor | New class | **CLARIFY** |
| Python latency risk | Medium | High | Medium | **MONITOR** |
| Windows support defer | ✅ OK | ✅ OK | ✅ OK | **AGREE** |

---

## Appendix A: Reviewer-Specific Insights Worth Preserving

### From Claude:
- Explicit normalization function for entity ID hash generation
- Transaction-like pattern for batch writes with temp directory + atomic swap
- Branch detection interface specification

### From GPT:
- Cross-repo edge cache invalidation needs SLA definition
- Security/permissions (seed file ACLs) not covered
- Validation failure paths need isolation

### From Gemini:
- Promote `StructuralParser` from "experiment" to "core" immediately
- Build SeedWriter prototype BEFORE removing Neo4j
- Consider splitting Phase 1 into "Storage Engine" and "Parser Refactor"

---

*End of Consolidated Recap*
