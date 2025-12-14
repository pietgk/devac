# DevAC/CodeGraph v2.0 - Comprehensive Review Documentation

**Date:** 2025-12-14 (Final)  
**Purpose:** Enable decision-making for v2.1 spec or implementation  
**Based On:** Consolidated review from Claude, GPT-4, and Gemini  
**Status:** ✅ DECISION-READY - **GO WITH MODIFICATIONS**

> **Companion Document:** See `devac-spec-v2.0-review-recap.md` for the consolidated review summary with prioritized action items.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current System Architecture (v1.x)](#2-current-system-architecture-v1x)
3. [Proposed v2.0 Architecture](#3-proposed-v20-architecture)
4. [Impact of Review Fixes](#4-impact-of-review-fixes)
5. [System Behavior Diagrams](#5-system-behavior-diagrams)
6. [Before vs After Fix Comparison](#6-before-vs-after-fix-comparison)
7. [Risk Assessment](#7-risk-assessment)
8. [Decision Framework](#8-decision-framework)
9. [Appendix: Detailed Fix Specifications](#9-appendix-detailed-fix-specifications)
10. [Appendix A: Current Codebase Mapping](#appendix-a-current-codebase-mapping)
11. [Appendix B: Performance Benchmarks](#appendix-b-performance-benchmarks-current-v1x)
12. [Appendix C: Entity ID Migration Examples](#appendix-c-entity-id-migration-examples)
13. [Appendix D: Quick Reference Cards](#appendix-d-quick-reference-cards)

---

## 1. Executive Summary

### 1.1 What Is DevAC/CodeGraph?

DevAC/CodeGraph is a **multi-language static code analysis tool** that parses codebases and stores them as queryable knowledge graphs. It enables AI-powered code comprehension through the Model Context Protocol (MCP).

### 1.2 Why v2.0?

The v1.x architecture used **Neo4j** as the graph database. This created a fundamental mismatch:
- CodeGraph needs **fast point lookups** (find entity by ID)
- CodeGraph needs **graph traversals** (call graphs, dependencies)
- Neo4j optimizes for graphs but point lookups require cache (NodeIndexCache proposal)

**v2.0 Solution:** Replace Neo4j with **DuckDB + Parquet files**
- Files ARE the database (no sync)
- Point lookups via hash-based IDs
- Graph queries via recursive CTEs
- Source code is truth (seeds regenerable)

### 1.3 Review Verdict

| Aspect | Status |
|--------|--------|
| Core Architecture | ✅ **APPROVED** by all reviewers |
| Technology Choice | ✅ **VALIDATED** (DuckDB + Parquet) |
| Implementation Gaps | ⚠️ **4 CRITICAL** issues identified |
| Timeline | ⚠️ **+7 days** buffer recommended |
| Recommendation | ✅ **GO WITH MODIFICATIONS** |

---

## 2. Current System Architecture (v1.x)

### 2.1 Current Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CURRENT v1.x ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌────────────┐   │
│  │  Source  │───▶│  Parser  │───▶│   Storage    │───▶│   Neo4j    │   │
│  │  Files   │    │ (ts-morph│    │   Manager    │    │  Database  │   │
│  │          │    │  Python) │    │              │    │            │   │
│  └──────────┘    └──────────┘    └──────────────┘    └────────────┘   │
│                       │                                     │          │
│                       ▼                                     ▼          │
│                  ┌──────────┐                        ┌────────────┐   │
│                  │ Temp JSON│                        │   Cypher   │   │
│                  │  Files   │                        │  Queries   │   │
│                  └──────────┘                        └────────────┘   │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘

PROBLEMS IDENTIFIED:
├── Point lookups require full index scan or cache
├── Sync complexity between source and database
├── Neo4j operational overhead (server process)
├── NodeIndexCache proposal = data duplication
└── No native multi-repo federation
```

### 2.2 Current Component Map

```
src/
├── analyzer/
│   ├── analyzer-service.ts    ← Orchestrates analysis pipeline
│   ├── parser.ts              ← Coordinates language parsers
│   ├── parsers/               ← Language-specific parsers (TS, Python, etc.)
│   ├── relationship-resolver.ts ← Pass 2 cross-file resolution
│   ├── storage-manager.ts     ← ❌ NEO4J-SPECIFIC (to be replaced)
│   └── types.ts               ← Core type definitions (reusable)
├── database/
│   └── neo4j-client.ts        ← ❌ TO BE REMOVED
├── scanner/
│   └── file-scanner.ts        ← ✅ Keep (directory scanning)
└── config/
    └── index.ts               ← ✅ Keep (configuration)
```

---

## 3. Proposed v2.0 Architecture

### 3.1 New Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PROPOSED v2.0 ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌────────────┐   │
│  │  Source  │───▶│  Parser  │───▶│    DuckDB    │───▶│  Parquet   │   │
│  │  Files   │    │ (ts-morph│    │  (In-Memory) │    │   Files    │   │
│  │          │    │  Python) │    │              │    │            │   │
│  └──────────┘    └──────────┘    └──────────────┘    └────────────┘   │
│       │                                                    │          │
│       │ (watch)                                           │          │
│       ▼                                                    ▼          │
│  ┌──────────┐                                       ┌────────────┐   │
│  │  File    │                                       │   DuckDB   │   │
│  │ Watcher  │                                       │  read_pq() │   │
│  │(chokidar)│                                       │  Queries   │   │
│  └──────────┘                                       └────────────┘   │
│                                                                        │
│  CHANGES FROM v1.x:                                                   │
│  ├── ✅ No server process (DuckDB is embedded)                        │
│  ├── ✅ No sync step (files ARE the database)                         │
│  ├── ✅ Parquet files are portable and regenerable                   │
│  └── ✅ Native federation via glob patterns                          │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Three-Layer Federation Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    FEDERATION LAYERS                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  LAYER 3: CENTRAL HUB (~/.devac/)                                      │
│  ├── central.duckdb     ← Only cross-repo computed edges               │
│  ├── config.json        ← Registered repositories                      │
│  └── cache/             ← Query result cache (optional)                │
│                                                                         │
│  LAYER 2: REPOSITORY (repo/.devac/)                                    │
│  ├── manifest.json      ← Package list, last analyzed                  │
│                                                                         │
│  LAYER 1: PACKAGE (packages/auth/.devac/)                              │
│  ├── meta.json          ← Schema version only                          │
│  └── seed/                                                              │
│      ├── base/          ← Full content for main branch                 │
│      │   ├── nodes.parquet                                             │
│      │   ├── edges.parquet                                             │
│      │   └── external_refs.parquet                                     │
│      └── branch/        ← Delta for current feature branch             │
│          ├── nodes.parquet      ← Only changed/new/deleted             │
│          ├── edges.parquet                                             │
│          └── external_refs.parquet                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Entity ID Format (v2.1)

```
FORMAT: {repo}:{package_path}:{kind}:{scope_hash}

WHERE: scope_hash = sha256(filePath + scopedName + kind).slice(0,8)

IMPORTANT: Branch is NOT part of entity_id
├── Same code = same entity_id regardless of branch
├── Branch is a storage partition key only
└── Enables cross-branch identity matching

EXAMPLES:
├── repo-api:packages/auth:function:a1b2c3d4
├── repo-web:apps/main:class:e5f6g7h8
└── repo-mobile:packages/ui:component:i9j0k1l2

SCOPED NAME RULES:
├── Top-level function: "handleLogin"
├── Class method: "AuthService.login"
├── Nested function: "processUser.validate"
├── Arrow in variable: "fetchUser"
├── Callback: "users.map.$arg0"
└── Computed property: "Foo.[key]"
```

---

## 4. Impact of Review Fixes

This section explains **what changes** when the CRITICAL, HIGH, and MEDIUM fixes are applied.

### 4.1 Fix Categories Overview

| Priority | Count | Impact Level |
|----------|-------|--------------|
| **CRITICAL** | 4 | Blocks implementation if not fixed |
| **HIGH** | 6 | Causes significant issues if not fixed |
| **MEDIUM** | 5 | Causes minor issues or technical debt |

### 4.2 CRITICAL Fixes Explained

#### C1: Define AnalysisOrchestrator Component

**Problem:** The spec defines individual components (Parser, SeedWriter, FileWatcher) but doesn't specify WHO coordinates them.

```
WITHOUT FIX:                              WITH FIX:
─────────────                             ─────────

FileWatcher ──?──▶ ???                    FileWatcher ──▶ AnalysisOrchestrator
Parser      ──?──▶ ???                                    ├── receives events
SeedWriter  ──?──▶ ???                                    ├── calls LanguageRouter
                                                          ├── invokes Parser
Unclear ownership,                                        ├── handles errors
race conditions,                                          ├── calls SeedWriter
duplicate processing                                      └── logs/metrics
```

**Impact if NOT fixed:**
- No single component owns the data flow
- Race conditions between file changes
- Error handling fragmented
- Logging/metrics scattered

#### C2: Add DuckDB Session Lifecycle Section

**Problem:** DuckDB connections have specific behaviors not addressed:
- Fatal mode on write failure
- Memory management for large datasets
- Connection pooling for watch mode

**Impact if NOT fixed:**
- System hangs after write error
- Memory exhaustion on large repos
- No recovery from system sleep

#### C3: Revise Performance Targets

```
CURRENT SPEC TARGETS:                     REVISED (REALISTIC) TARGETS:
─────────────────────                     ─────────────────────────────

Single file change: <300ms                Single file change: <500ms
Batch (10 files):   <500ms                Batch (10 files):   <800ms
TS parse per file:  <50ms                 TS parse (p95):     <200ms
Python parse:       <200ms                Python parse:       200-500ms
```

**Impact if NOT fixed:**
- Development team chasing impossible targets
- User expectations not met

#### C4: Add Orphan Temp File Cleanup

**Problem:** Atomic write pattern creates `.tmp` files. If interrupted, orphans remain.

```
WITHOUT FIX:                              WITH FIX:
─────────────                             ─────────

1. Write to nodes.parquet.tmp             1. Write to nodes.parquet.tmp
2. System crash/Ctrl+C                    2. System crash/Ctrl+C
3. nodes.parquet.tmp remains              3. nodes.parquet.tmp remains
4. Future analysis:                       4. On startup:
   └── Confusion about state                 └── Scan for .tmp files
                                                 └── Delete all .tmp files
```

### 4.3 HIGH Fixes Summary

| Fix | Problem | Solution |
|-----|---------|----------|
| **H1: Pass 2 trigger** | When does semantic resolution run? | Debounced background (5s settle) |
| **H2: Lock file format** | Concurrent writes corrupt data | Lock file with PID + timestamp |
| **H3: Parallel parsing** | Batch changes too slow | Parse up to 4 files concurrently |
| **H4: Windows retry** | `fs.rename` fails if file locked | Retry with exponential backoff |
| **H5: Base branch behavior** | Write amplification unclear | Document 300-500ms acceptable |
| **H6: Interface unification** | Spec vs code mismatch | Align `StructuralParseResult` |

### 4.4 MEDIUM Fixes Summary

| Fix | Problem | Solution |
|-----|---------|----------|
| **M1: Branch detection** | Detached HEAD, worktrees | Utility function with fallbacks |
| **M2: Python check** | Missing Python not detected | Check on startup, clear error |
| **M3: Scoped name examples** | Edge cases unclear | Add unit test examples to spec |
| **M4: Analysis flow doc** | Initial vs incremental unclear | Separate documentation sections |
| **M5: Interruption handling** | Ctrl+C behavior undefined | Graceful shutdown, no corruption |

---

## 5. System Behavior Diagrams

### 5.1 Sequence Diagram: File Change (Watch Mode)

```
  User         FileWatcher      Orchestrator    Parser      SeedWriter
    │              │                │             │             │
    │  save file   │                │             │             │
    │─────────────▶│                │             │             │
    │              │   change event │             │             │
    │              │───────────────▶│             │             │
    │              │                │ debounce    │             │
    │              │                │ (100ms)     │             │
    │              │                │             │             │
    │              │                │ acquire lock│             │
    │              │                │─────────────────────────────▶
    │              │                │             │             │
    │              │                │ compute hash│             │
    │              │                │             │             │
    │              │                │ [if changed]│             │
    │              │                │ getParser() │             │
    │              │                │─────────────▶             │
    │              │                │  parse file │             │
    │              │                │─────────────▶             │
    │              │                │◀────────────│ ParseResult │
    │              │                │  write seed │             │
    │              │                │─────────────│────────────▶│
    │              │                │             │ atomic write│
    │              │                │             │  .tmp ──▶ .parquet
    │              │                │◀────────────│─────────────│
    │              │                │ release lock│             │
    │              │   done         │             │             │

  TOTAL TIME: 300-500ms (single file, feature branch)
```

### 5.2 State Diagram: Analysis Lifecycle

```
                          ┌───────────┐
                          │   IDLE    │
                          └─────┬─────┘
                                │
                    file change │ or devac analyze
                                ▼
                          ┌───────────┐
                          │ ACQUIRING │
                          │   LOCK    │
                          └─────┬─────┘
                                │
               ┌────────────────┼────────────────┐
               │                │                │
         lock held         lock acquired    timeout
               │                │                │
               ▼                ▼                ▼
        ┌───────────┐    ┌───────────┐    ┌───────────┐
        │  WAITING  │    │  HASHING  │    │   ERROR   │
        │ (retry)   │    │           │    │           │
        └───────────┘    └─────┬─────┘    └───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
         no changes       has changes      hash error
              │                │                │
              ▼                ▼                ▼
        ┌───────────┐    ┌───────────┐    ┌───────────┐
        │   SKIP    │    │  PARSING  │    │   ERROR   │
        │ (release) │    │           │    │           │
        └───────────┘    └─────┬─────┘    └───────────┘
                               │
                               ▼
                         ┌───────────┐
                         │  WRITING  │
                         └─────┬─────┘
                               │
                               ▼
                          ┌───────────┐
                          │  SUCCESS  │
                          │ (release) │
                          └─────┬─────┘
                                │
                                ▼
                          ┌───────────┐
                          │   IDLE    │
                          └───────────┘
```

### 5.3 Flow Diagram: Two-Pass Parsing

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PASS 1: STRUCTURAL                               │
│                     (Per-File, Parallelizable)                          │
└─────────────────────────────────────────────────────────────────────────┘

Source File ──▶ Language Parser ──▶ DuckDB (mem) ──▶ Parquet

OUTPUTS:
├── nodes.parquet       (functions, classes, variables, etc.)
├── edges.parquet       (CONTAINS, HAS_METHOD, DEFINES, etc.)
└── external_refs.parquet (imports - UNRESOLVED)

TIME: ~50ms per TS file (p50), ~200ms (p95)

                              │
                              ▼

┌─────────────────────────────────────────────────────────────────────────┐
│                        PASS 2: SEMANTIC                                 │
│                    (Cross-File, Batched)                                │
└─────────────────────────────────────────────────────────────────────────┘

external_refs.parquet ──▶ Resolution ──▶ Updated Parquet
                              │
                              ▼
                     Query other packages'
                     exported symbols

RESOLUTION FLOW:
1. For each unresolved ref:
   ├── Query local package (same package exports)
   ├── Query sibling packages (monorepo cross-package)
   └── Query central hub (cross-repo dependencies)
2. Update external_refs with resolution results

TIMING (with fixes):
├── IMMEDIATE: Structural queries work after Pass 1
└── DEBOUNCED: Pass 2 runs 5s after last change (background)
```

### 5.4 Flow Diagram: Incremental Update

```
Step 1: Compute Hash (~10-20ms)
───────────────────────────────
SHA-256 of source file content

                              │
                              ▼

Step 2: Compare with Stored Hash (~20-30ms)
───────────────────────────────────────────
Query: SELECT file_content_hash FROM nodes.parquet
       WHERE file_path = ?

         ┌─────────────────┬─────────────────┐
         │                 │                 │
    Hash matches      Hash differs     File new
         │                 │                 │
         ▼                 ▼                 ▼
    ┌─────────┐       ┌─────────┐       ┌─────────┐
    │  SKIP   │       │  PARSE  │       │  PARSE  │
    │ (done)  │       │         │       │         │
    └─────────┘       └────┬────┘       └────┬────┘
                           │                 │
    TIME: ~40ms            │                 │
                           ▼                 ▼

Step 3: Parse Changed File (~50-200ms)
──────────────────────────────────────
Language Router → Parser → ParseResult

                              │
                              ▼

Step 4: Merge with Existing (~20-50ms)
─────────────────────────────────────
Load existing nodes.parquet
Remove old entries for file
Add new entries

                              │
                              ▼

Step 5: Write Package Parquet (~50-100ms)
────────────────────────────────────────
FOR BASE BRANCH: Full package write
FOR FEATURE BRANCH: Delta only (is_deleted markers)

ATOMIC WRITE:
1. DuckDB → nodes.parquet.tmp
2. fs.rename(nodes.parquet.tmp, nodes.parquet)
3. fsync(directory)

─────────────────────────────────────────────────────────────────
TOTAL TIMES:
├── No changes:        ~40-50ms (hash check only)
├── 1 file changed:    ~200-400ms (parse + merge + write)
├── 10 files changed:  ~300-600ms (batch optimized)
└── Full regeneration: ~5-10s (all files)
```

---

## 6. Before vs After Fix Comparison

### 6.1 System Behavior: WITHOUT Fixes

```
SCENARIO: User saves file during active analysis

1. devac watch running
2. User saves auth.ts
3. User immediately saves utils.ts
4. ??? Who coordinates?
     ├── Both fire simultaneously
     ├── No lock → concurrent writes
     └── Corrupted Parquet possible

5. DuckDB write fails mid-stream
6. ??? Connection in "fatal mode"
7. All subsequent queries fail
8. Only fix: restart devac

9. System crashes during write
10. nodes.parquet.tmp left behind
11. ??? Orphan file confusion

RESULT: Unreliable, requires manual intervention
```

### 6.2 System Behavior: WITH Fixes Applied

```
SCENARIO: User saves file during active analysis

1. devac watch running
2. User saves auth.ts → event queued
3. User saves utils.ts → event queued
4. Orchestrator debounces (100ms)
5. Orchestrator acquires lock
     └── Lock file: .devac/seed/.lock
6. Orchestrator processes batch [auth.ts, utils.ts]
7. Parse both files (parallel if H3 fix applied)
8. Single merged write to Parquet
9. Release lock

SCENARIO: DuckDB write fails
10. Error caught by SeedWriter
11. Connection disposed (not reused)
12. Temp file cleaned up
13. Error logged with context
14. Next operation gets fresh connection

SCENARIO: System crashes
15. nodes.parquet.tmp left behind
16. On next startup: cleanup scan
     └── Delete all .tmp files
17. Clean state guaranteed

RESULT: Self-healing, no manual intervention
```

### 6.3 Performance Comparison

```
OPERATION              │ SPEC TARGET │ WITHOUT FIX │ WITH FIX
───────────────────────┼─────────────┼─────────────┼─────────────────
Hash check (no change) │    <50ms    │    ✅ ~40ms │    ✅ ~40ms
Single file change     │   <300ms    │   ❌ ~400ms │    ⚠️ ~400ms
  (revised target)     │   <500ms    │    ✅ ~400ms│    ✅ ~400ms
Batch (10 files)       │   <500ms    │   ❌ ~2s    │    ✅ ~600ms
  (revised + parallel) │   <800ms    │    ✅ ~600ms│    ✅ ~600ms
TS parse (p50)         │    <50ms    │    ✅ ~40ms │    ✅ ~40ms
TS parse (p95)         │   <200ms    │    ✅ ~150ms│    ✅ ~150ms
Python parse           │   <200ms    │   ❌ ~350ms │    ⚠️ ~350ms
  (accepted trade-off) │  200-500ms  │    ✅ ~350ms│    ✅ ~350ms

LEGEND:
✅ = Meets target    ⚠️ = Meets revised target    ❌ = Misses target
```

---

## 7. Risk Assessment

### 7.1 Risk Matrix

```
                       I M P A C T
                   Low         Medium        High
             ┌───────────┬───────────┬───────────┐
        Low  │ L1,L3,L5  │    M3     │           │
  L          ├───────────┼───────────┼───────────┤
  I   Medium │    M1     │  H1,H5    │  C3,H2    │
  K          ├───────────┼───────────┼───────────┤
  E    High  │    M2     │    H4     │ C1,C2,C4  │
  L          └───────────┴───────────┴───────────┘

KEY:
C1 = AnalysisOrchestrator undefined
C2 = DuckDB lifecycle undefined
C3 = Performance targets unrealistic
C4 = Orphan temp files
H1 = Pass 2 trigger undefined
H2 = Lock file format undefined
H4 = Windows file locking
H5 = Base branch write amplification
```

### 7.2 Mitigation Status

| Risk ID | Risk | Mitigation | Status |
|---------|------|------------|--------|
| C1 | No orchestrator | Define in spec | **Pending** |
| C2 | DuckDB fatal mode | Connection pooling, dispose on error | **Pending** |
| C3 | Unrealistic targets | Revise to consensus values | **Pending** |
| C4 | Orphan temp files | Startup cleanup | **Pending** |
| H1 | Pass 2 timing | Debounced background | **Proposed** |
| H2 | Concurrent writes | Lock file with PID | **Proposed** |
| H4 | Windows locking | Retry with backoff | **Proposed** |
| H5 | Write amplification | Document trade-off | **Proposed** |

---

## 8. Decision Framework

### 8.1 Options

| Option | Description | Effort | Risk |
|--------|-------------|--------|------|
| **A: Full Fix** | Address all CRITICAL + HIGH before Phase 1 | 1-2 weeks | Low |
| **B: Critical Only** | Address 4 CRITICAL before Phase 1, HIGH during | 3-4 days | Medium |
| **C: Proceed As-Is** | Start Phase 1 with current spec | 0 days | High |
| **D: Delay** | Full re-review and spec rewrite | 2-3 weeks | Low |

### 8.2 Recommendation: Option B (Critical Only)

**Rationale:**
1. 4 CRITICAL items are spec updates (4-6 hours)
2. HIGH items can be addressed during Phase 1
3. Architecture is sound - reviewers agree
4. v1.11 not implemented - clean slate

**Timeline Impact:**
- Spec updates: +1 day
- Phase 1 buffer: +7 days (18 → 25 days)
- Total delay: ~1 week

### 8.3 Decision Checklist

Before starting Phase 1, confirm:

- [ ] C1: AnalysisOrchestrator defined in spec
- [ ] C2: DuckDB lifecycle section added
- [ ] C3: Performance targets revised
- [ ] C4: Orphan temp cleanup specified
- [ ] Team has reviewed updated spec

### 8.4 Success Criteria for Phase 1

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| TS package analysis | Works | devac analyze → Parquet files |
| Query execution | <100ms | Package query benchmark |
| Watch mode | Works | File change → updated seed |
| Error recovery | Works | Simulated failure → clean recovery |

---

## 9. Appendix: Detailed Fix Specifications

### 9.1 C1: AnalysisOrchestrator Specification

```typescript
/**
 * AnalysisOrchestrator coordinates the analysis pipeline.
 * Owns the state machine and coordinates all components.
 */
interface AnalysisOrchestrator {
  /**
   * Handle a single file change event.
   * Debounces internally (100ms default).
   */
  handleFileChange(event: FileChangeEvent): Promise<void>;
  
  /**
   * Handle multiple file changes as a batch.
   * Used for initial analysis or forced refresh.
   */
  handleBatchChanges(events: FileChangeEvent[]): Promise<void>;
  
  /**
   * Get current analysis state.
   */
  getCurrentState(): AnalysisState;
  
  /**
   * Graceful shutdown.
   */
  shutdown(): Promise<void>;
}

type AnalysisState = 
  | { status: 'idle' }
  | { status: 'acquiring_lock' }
  | { status: 'hashing', files: string[] }
  | { status: 'parsing', current: string, progress: number }
  | { status: 'writing', package: string }
  | { status: 'error', error: Error };
```

### 9.2 C2: DuckDB Lifecycle Specification

```typescript
// Pattern 1: Query connections (pooled, warm)
class QueryConnectionPool {
  private warmConnection: Database | null = null;
  
  async getConnection(): Promise<Database> {
    if (this.warmConnection) return this.warmConnection;
    this.warmConnection = new Database(':memory:');
    return this.warmConnection;
  }
}

// Pattern 2: Write connections (ephemeral, disposed on error)
async function withWriteConnection<T>(
  operation: (db: Database) => Promise<T>
): Promise<T> {
  const db = new Database(':memory:');
  try {
    return await operation(db);
  } finally {
    await db.close(); // Always close - prevents fatal mode
  }
}

// Pattern 3: Error recovery with retry
async function safeWrite(
  operation: () => Promise<void>,
  retries: number = 3
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await operation();
      return;
    } catch (error) {
      if (i === retries - 1) throw error;
      await sleep(100 * Math.pow(2, i)); // Exponential backoff
    }
  }
}
```

### 9.3 C3: Revised Performance Targets

| Operation | Original | Revised | Notes |
|-----------|----------|---------|-------|
| Hash check (no changes) | <50ms | <50ms | Keep |
| Structural parse (TS) | <50ms | p50:<50ms, p95:<200ms | Add percentile |
| Structural parse (Python) | <200ms | 200-500ms | Accept subprocess cost |
| Package Parquet write | <100ms | <150ms | Slight increase |
| Single file change | <300ms | <500ms | More realistic |
| Batch changes (10 files) | <500ms | <800ms | Unless parallelized |
| Package query | <100ms | <100ms | Keep |
| Repo query (10 packages) | <200ms | <200ms | Keep |
| Cross-repo (3 repos) | <600ms | <600ms | Keep |

### 9.4 C4: Orphan Temp File Cleanup

```typescript
/**
 * Run on every DevAC startup (CLI or watch mode).
 */
async function cleanupOrphanTempFiles(seedPath: string): Promise<void> {
  const tempFiles = await glob(`${seedPath}/**/*.tmp`);
  
  for (const tempFile of tempFiles) {
    try {
      await fs.unlink(tempFile);
      logger.debug(`Cleaned up orphan temp file: ${tempFile}`);
    } catch (error) {
      logger.warn(`Failed to clean up ${tempFile}: ${error.message}`);
    }
  }
  
  if (tempFiles.length > 0) {
    logger.info(`Cleaned up ${tempFiles.length} orphan temp files`);
  }
}

// Call on startup
await cleanupOrphanTempFiles(path.join(packagePath, '.devac/seed'));
```

---

## 10. Conclusion

This document provides a comprehensive view of:

1. **Current state** - v1.x architecture and its limitations
2. **Proposed state** - v2.0 architecture with DuckDB + Parquet
3. **Review findings** - Consensus from three independent reviewers
4. **Required fixes** - 4 CRITICAL, 6 HIGH, 5 MEDIUM items
5. **System behavior** - Sequence, state, and flow diagrams
6. **Impact analysis** - Before vs after fix comparison
7. **Risk assessment** - Prioritized mitigation plan
8. **Decision framework** - Actionable next steps

**Recommendation:** Proceed with Option B (Critical Only fixes before Phase 1).

The architecture is sound. The technology choice is validated. With the 4 CRITICAL fixes applied (4-6 hours of spec work), Phase 1 can begin with confidence.

---

*End of Comprehensive Review Documentation*

---

## Appendix A: Current Codebase Mapping

### A.1 Files to Keep (Portable to v2.0)

| File | Location | Notes |
|------|----------|-------|
| TypeScript Parsers | `src/analyzer/parsers/*.ts` | Core parsing logic reusable via adapter |
| Python Parser | `src/analyzer/python-parser.ts` | Subprocess model preserved |
| Type Definitions | `src/analyzer/types.ts` | `AstNode`, `RelationshipInfo` definitions |
| Parser Utils | `src/analyzer/parser-utils.ts` | `generateEntityId`, `generateInstanceId` |
| File Scanner | `src/scanner/file-scanner.ts` | Directory scanning with ignore patterns |
| File Watcher | `src/devac/services/codegraph/file-watcher.ts` | Chokidar-based watching |
| Relationship Resolver | `src/analyzer/relationship-resolver.ts` | Pass 2 logic (evolves to SemanticResolver) |
| Test Fixtures | `test-fixtures/`, `test_fixtures/` | Reusable test data |

### A.2 Files to Replace

| Current File | Replacement | Reason |
|--------------|-------------|--------|
| `src/database/neo4j-client.ts` | `src/seed/duckdb-client.ts` | Storage technology change |
| `src/analyzer/storage-manager.ts` | `src/seed/seed-writer.ts` | Per-package Parquet writes |
| `src/analyzer/analyzer-service.ts` | `src/seed/orchestrator.ts` | New coordination pattern |

### A.3 Key Interface Transformations

```typescript
// CURRENT: src/analyzer/types.ts
interface AstNode {
  id: string;           // Instance ID: "func_0_parseData"
  entityId: string;     // Format: file:<path>:<name>@<line>:<col>
  kind: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  language: string;
  properties?: Record<string, any>;
  createdAt: string;
}

// v2.0: src/seed/types.ts (NEW)
interface ParsedNode {
  entityId: string;     // Format: <kind>:<package>/<module>.<name>
  kind: string;
  scopedName: string;   // NEW: Package-relative qualified name
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  isExported?: boolean;
  signature?: string;   // NEW: For overloaded functions
  parseStatus?: 'success' | 'partial' | 'failed'; // NEW: Error tracking
}

// ADAPTER FUNCTION (Phase 1)
function adaptAstNode(node: AstNode, context: AdaptContext): ParsedNode {
  return {
    entityId: generateScopedEntityId(node, context),
    kind: node.kind,
    scopedName: generateScopedName(node, context),
    filePath: node.filePath,
    startLine: node.startLine,
    endLine: node.endLine,
    language: node.language,
    isExported: node.isExported ?? node.properties?.isExported,
    parseStatus: 'success',
  };
}
```

### A.4 Current Data Flow (for reference)

```
src/cli/commands/analyze.ts (CLI entry)
    │
    └── AnalyzerService.analyze(directory)
           │
           ├── FileScanner.scan()           → FileInfo[]
           │
           ├── Parser.initializePackages()  → PackageInfo[]
           │
           ├── Parser.parseFiles(files)     → Pass 1
           │   │
           │   ├── ts-morph Project (for TS/JS)
           │   ├── PythonAstParser (subprocess)
           │   └── Tree-sitter parsers (Java, Go, C#, C++)
           │
           ├── Parser.collectResults()      → {allNodes, allRelationships}
           │   │
           │   └── Reads temp JSON files + in-memory TS results
           │
           ├── RelationshipResolver.resolveRelationships() → Pass 2
           │   │
           │   ├── resolveTsModules()
           │   ├── resolveTsInheritance()
           │   ├── resolveTsCrossFileInteractions()
           │   ├── resolveImportRelationships()
           │   └── derivePackageDependencies()
           │
           └── StorageManager.saveNodesBatch() / saveRelationshipsBatch()
               │
               └── Neo4j MERGE queries (to be replaced with SeedWriter)
```

---

## Appendix B: Performance Benchmarks (Current v1.x)

These benchmarks from current implementation inform v2.0 targets:

| Repository | Files | Batch Size | Analysis Time | Nodes Extracted |
|------------|-------|------------|---------------|-----------------|
| CodeGraph (this repo) | 76 | 100 | ~3s | 1,537 |
| frontend-monorepo | 945 | 100 | ~57s | 26,670 |
| app | ~3K | 100 | ~2m | 140,563 |
| monorepo-3.0 | 2,099* | 100 | ~5-10m** | TBD |

\* After `.d.ts` filtering (was 180K+ total files)  
\** Estimated based on file count

**Key Insights:**
- Per-file parsing averages 50-100ms for TypeScript
- Batch size of 50-100 optimal for memory management
- Neo4j writes add 30-50% overhead (target for removal)

---

## Appendix C: Entity ID Migration Examples

### C.1 Standard Function

```typescript
// Source: /packages/auth/src/services/authService.ts

export function validateToken(token: string): boolean { ... }

// v1.x entityId (line-based):
"function:/packages/auth/src/services/authService.ts:validateToken@15:0"

// v2.0 entityId (scoped-name):
"function:@auth/services/authService.validateToken"
```

### C.2 Class Method

```typescript
// Source: /packages/auth/src/services/authService.ts

export class AuthService {
  public async login(credentials: Credentials): Promise<User> { ... }
}

// v1.x entityId:
"method:/packages/auth/src/services/authService.ts:login@25:2"

// v2.0 entityId:
"method:@auth/services/authService.AuthService.login"
```

### C.3 Anonymous Function

```typescript
// Source: /packages/utils/src/helpers.ts

export const processItems = items.map(item => item.value);
//                                    ^^^^^ anonymous

// v1.x entityId:
"function:/packages/utils/src/helpers.ts:<anonymous>@10:32"

// v2.0 entityId:
"function:@utils/helpers.processItems.<anon0>"
```

### C.4 Callback Parameter

```typescript
// Source: /packages/api/src/client.ts

export function fetchData(onSuccess: (data: Data) => void) { ... }
//                        ^^^^^^^^^ callback parameter

// v1.x entityId:
"parameter:/packages/api/src/client.ts:onSuccess@5:22"

// v2.0 entityId:
"parameter:@api/client.fetchData.onSuccess"
```

---

## Appendix D: Quick Reference Cards

### D.1 Command Quick Reference

```bash
# v1.x Commands (current)
npm run analyze               # Full analysis to Neo4j
npm run build && npm test     # Build and test

# v2.0 Commands (proposed)
devac analyze <path>          # Analyze to Parquet seeds
devac watch <path>            # Watch mode with live updates
devac query "<cypher>"        # Query via DuckDB
devac verify                  # Validate seed integrity
devac clean                   # Remove all seeds
```

### D.2 File Structure Quick Reference

```
# v1.x (current)
analysis-data/temp/           # Temp JSON files during parsing
src/analyzer/                 # Core analysis
src/database/                 # Neo4j integration

# v2.0 (proposed)
.devac/seeds/<package>/       # Per-package Parquet files
.devac/config.json            # Workspace configuration
.devac/manifest.json          # Package registry
src/seed/                     # New core module
```

### D.3 Error Handling Quick Reference

```
# v1.x Error Flow
Parse error → Log warning → Continue
Neo4j error → Throw → CLI exits with error

# v2.0 Error Flow (with fixes)
Parse error → Mark node with parseStatus='failed' → Continue
Write error → Retry with backoff → Clean up temp → Log
Lock conflict → Wait or fail fast → No corruption
Shutdown signal → Complete current op → Clean up → Exit 0
```
