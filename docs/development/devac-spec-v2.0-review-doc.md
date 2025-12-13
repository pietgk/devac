# DevAC/CodeGraph v2.0 - Comprehensive Architecture Documentation

**Date:** 2025-12-12  
**Purpose:** Enable informed decision-making for v2.1 specification or implementation  
**Based On:** v2.0 Spec + Consolidated Review Feedback from Claude, GPT, and Gemini

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Current Architecture (v1.x)](#2-current-architecture-v1x)
3. [Proposed Architecture (v2.0)](#3-proposed-architecture-v20)
4. [Critical Issues Identified](#4-critical-issues-identified)
5. [Impact Analysis: With vs Without Fixes](#5-impact-analysis-with-vs-without-fixes)
6. [Detailed Diagrams](#6-detailed-diagrams)
7. [Decision Matrix](#7-decision-matrix)
8. [Implementation Scenarios](#8-implementation-scenarios)
9. [Recommendations](#9-recommendations)

---

## 1. Executive Overview

### 1.1 What is DevAC/CodeGraph?

DevAC/CodeGraph is a **multi-language static code analysis tool** that:
- Parses codebases to extract AST nodes (classes, functions, variables, etc.)
- Stores them as queryable knowledge graphs
- Enables AI-powered code comprehension through the Model Context Protocol (MCP)

### 1.2 Why v2.0?

The v1.x architecture has a fundamental problem: **Neo4j is optimized for graph traversal but slow for point lookups**. This led to the proposed v1.11 NodeIndexCache - an in-memory cache duplicating all nodes. This duplication signals an architectural mismatch.

**v2.0 proposes:** Replace Neo4j with DuckDB + Parquet files.

### 1.3 Review Consensus

| Aspect | Verdict |
|--------|---------|
| Core Architecture | APPROVED |
| Technology Choice | APPROVED |
| Performance Targets | NEEDS REVISION |
| Error Handling | MISSING |
| Atomic Writes | MISSING |

---

## 2. Current Architecture (v1.x)

### 2.1 Component Overview

```
+-------------------------------------------------------------------------+
|                        CURRENT ARCHITECTURE (v1.x)                       |
+-------------------------------------------------------------------------+
|                                                                         |
|  +------------+    +----------------+    +------------------------+     |
|  |    CLI     |--->| AnalyzerService|--->|      Neo4j DB          |     |
|  | (Commander)|    |                |    | (bolt://localhost)     |     |
|  +------------+    +----------------+    +------------------------+     |
|                            |                        ^                   |
|                            v                        |                   |
|                    +---------------+                |                   |
|                    |    Parser     |                |                   |
|                    |  (Two-Pass)   |                |                   |
|                    +---------------+                |                   |
|                            |                        |                   |
|           +----------------+----------------+       |                   |
|           v                v                v       |                   |
|    +------------+  +----------------+ +----------+  |                   |
|    | TypeScript |  |    Python      | | Tree-    |  |                   |
|    |  ts-morph  |  |   subprocess   | | sitter   |  |                   |
|    +------------+  +----------------+ +----------+  |                   |
|                            |                        |                   |
|                            v                        |                   |
|                    +---------------+                |                   |
|                    |StorageManager |-----------------                   |
|                    | (batch writes)|                                    |
|                    +---------------+                                    |
|                                                                         |
+-------------------------------------------------------------------------+
```

### 2.2 Current Data Flow

**PHASE 1: SCANNING**
```
Directory ---> FileScanner ---> FileInfo[]
  path         (micromatch)     {path, ext, name}
```

**PHASE 2: PASS 1 (STRUCTURAL)**
```
FileInfo[] ---> Parser.parse() ---> AstNode[]
               (ts-morph/Babel)     RelationshipInfo[]
                      |
                      v
                StorageManager
                .saveNodes()
                      |
                      v
                  Neo4j DB
```

**PHASE 3: PASS 2 (SEMANTIC)**
```
RelationshipResolver -----> Neo4j DB
.resolveRelationships()     (writes resolved relationships)
```

### 2.3 Current Key Files

| File | Purpose |
|------|---------|
| src/analyzer/analyzer-service.ts | Orchestrates the analysis pipeline |
| src/analyzer/parser.ts | Coordinates language-specific parsers |
| src/analyzer/structural-parser.ts | Babel-based fast structural parsing |
| src/analyzer/relationship-resolver.ts | Pass 2: resolves cross-file references |
| src/analyzer/storage-manager.ts | Batched writes to Neo4j |
| src/database/neo4j-client.ts | Neo4j driver lifecycle |
| src/scanner/file-scanner.ts | Recursive directory scanning |

### 2.4 Current Problems

| Problem | Impact | Evidence |
|---------|--------|----------|
| Neo4j slow for lookups | High | v1.11 proposed NodeIndexCache |
| Neo4j requires server | Medium | Not truly "local-first" |
| Complex transaction logic | Medium | Rollback scenarios complex |
| No incremental updates | High | Full re-analysis required |

---

## 3. Proposed Architecture (v2.0)

### 3.1 Component Overview

```
+-------------------------------------------------------------------------+
|                      PROPOSED ARCHITECTURE (v2.0)                        |
+-------------------------------------------------------------------------+
|                                                                         |
|  +------------+    +----------------+    +------------------------+     |
|  |    CLI     |--->| AnalyzerService|--->|    Parquet Files       |     |
|  | (Commander)|    |  (simplified)  |    |  (.devac/seed/)        |     |
|  +------------+    +----------------+    +------------------------+     |
|                            |                        ^                   |
|                            v                        |                   |
|                    +---------------+                |                   |
|                    |    Parser     |                |                   |
|                    |  (Two-Pass)   |                |                   |
|                    +---------------+                |                   |
|                            |                        |                   |
|           +----------------+----------------+       |                   |
|           v                v                v       |                   |
|    +------------+  +----------------+ +----------+  |                   |
|    | TypeScript |  |    Python      | | Tree-    |  |                   |
|    |  Babel     |  |   subprocess   | | sitter   |  |                   |
|    +------------+  +----------------+ +----------+  |                   |
|                            |                        |                   |
|                            v                        |                   |
|                    +---------------+                |                   |
|                    |  SeedWriter   |-----------------                   |
|                    |(DuckDB->Parq) |                                    |
|                    +---------------+                                    |
|                            |                                            |
|                            v                                            |
|                    +---------------+                                    |
|                    |  DuckDB Query |<--- read_parquet()                 |
|                    |    Engine     |                                    |
|                    +---------------+                                    |
|                                                                         |
+-------------------------------------------------------------------------+
```

### 3.2 Three-Layer Federation Model

```
LAYER 3: CENTRAL HUB (Optional - ~/.devac/)
+-------------------------------------------------------------+
| ~/.devac/central.duckdb                                     |
|                                                             |
| Tables:                                                     |
| - repo_registry (known repos)                               |
| - cross_repo_edges (computed import->export mappings)       |
|                                                             |
| Does NOT store raw nodes - queries Parquet directly!        |
+-------------------------------------------------------------+
                    ^
                    | register
--------------------+---------------------------------------------

LAYER 2: REPOSITORY MANIFEST (repo/.devac/)
+-------------------------------------------------------------+
| repo/.devac/manifest.json                                   |
|                                                             |
| {                                                           |
|   "name": "my-repo",                                        |
|   "packages": [                                             |
|     {"path": "packages/auth", "seedPath": ".../.devac/seed"}|
|   ]                                                         |
| }                                                           |
+-------------------------------------------------------------+
                    ^
                    | discover
--------------------+---------------------------------------------

LAYER 1: PACKAGE SEEDS (Ground Truth)
+-------------------------------------------------------------+
| packages/auth/.devac/seed/                                  |
|                                                             |
| nodes/              edges/              external_refs/      |
| +-- src_auth_ts.pq  +-- src_auth_ts.pq  +-- src_auth_ts.pq |
| +-- src_index_ts.pq +-- src_index_ts.pq +-- src_index_ts.pq|
|                                                             |
| meta.json (timestamps, stats)                               |
+-------------------------------------------------------------+
```

### 3.3 Proposed Data Flow

**PHASE 1: SCANNING (unchanged)**
```
Directory ---> FileScanner ---> FileInfo[]
```

**PHASE 2: PASS 1 (STRUCTURAL) - NEW OUTPUT FORMAT**
```
FileInfo    ---> StructuralParser ---> StructuralParseResult
(single)         (Babel-based)         {nodes, edges, externalRefs}
                                              |
                                              v
                                        SeedWriter
                                              |
                                        DuckDB (mem)
                                              |
                                        COPY TO Parquet
                                              |
                                              v
                                        .parquet files
```

**PHASE 3: PASS 2 (SEMANTIC) - PARQUET UPDATE**
```
SemanticResolver  <---> .devac/seed/
(read external_refs     +-- nodes/
 resolve targets)       +-- edges/
       |                +-- external_refs/
       |
       v
Update is_resolved, resolved_entity_id
       |
       v
SeedWriter.update()
```

**PHASE 4: QUERY**
```
DuckDB Engine
    |
SELECT * FROM read_parquet('**/*.parquet')
```

---

## 4. Critical Issues Identified

### 4.1 Issue Matrix

| ID | Issue | Severity | All Reviewers Agree? |
|----|-------|----------|---------------------|
| C1 | Per-file Parquet may not scale | CRITICAL | Yes |
| C2 | <100ms target unrealistic | CRITICAL | Yes |
| C3 | Atomic writes missing | CRITICAL | Yes |
| C4 | Error handling undefined | CRITICAL | Yes |
| H1 | Semantic resolver underspecified | HIGH | Claude + GPT |
| H2 | Entity ID stability issue | HIGH | Claude only |
| H3 | File locking for concurrency | HIGH | Claude + Gemini |
| M1 | Python parser latency | MEDIUM | Claude only |
| M2 | Schema versioning missing | MEDIUM | Claude only |

### 4.2 C1: Per-File Parquet Scaling

**Problem:**
The spec proposes one Parquet file per source file. For a monorepo with 5,000 files:

```
5,000 files x 3 partitions = 15,000 Parquet files
```

**Risk Assessment:**

| Scenario | Parquet Files | Expected Query Time | Risk |
|----------|---------------|---------------------|------|
| Small Package (100 files) | 300 | <50ms | LOW |
| Medium Package (1,000 files) | 3,000 | 100-200ms | MEDIUM |
| Large Monorepo (10,000 files) | 30,000 | 500ms-2s | HIGH |

**FALLBACK STRATEGY:**
If per-file fails, switch to per-package single files with row-level filtering by source_file column.

### 4.3 C2: Performance Target Unrealistic

**Spec Target:** <100ms incremental update per file

**Realistic Breakdown:**

| Step | Time (ms) | Notes |
|------|-----------|-------|
| 1. File change detected | 0 | |
| 2. Debounce wait | 50 | Prevent rapid fire |
| 3. Read file | 5 | |
| 4. Babel parse | 30 | Structural only |
| 5. Generate nodes/edges/refs | 10 | |
| 6. Delete old Parquet (3) | 5 | 3 files x ~2ms |
| 7. DuckDB connection | 15 | Cold start (0 if warm) |
| 8. Insert to DuckDB | 10 | |
| 9. Export 3 Parquet files | 30 | 3 x 10ms |
| **TOTAL (cold)** | **155** | EXCEEDS 100ms |
| **TOTAL (warm, no debounce)** | **90** | POSSIBLE |

**RECOMMENDATION:** Revise target to <200ms

### 4.4 C3: Atomic Writes Missing

**Problem:** Spec says "rm then write". Crash between delete and write = corrupt state.

**CURRENT (DANGEROUS):**
```
1. rm old.parquet          <- FILE DELETED
2. [PROCESS CRASH]         <- OLD DATA GONE, NEW DATA NOT WRITTEN
3. write new.parquet       <- NEVER HAPPENS
Result: Data loss, corrupt state
```

**FIXED (ATOMIC):**
```
1. write new.parquet.tmp   <- TEMP FILE CREATED
2. fsync()                 <- ENSURE WRITTEN TO DISK
3. rename(tmp -> target)   <- ATOMIC OPERATION

If crash at step 1-2: temp file exists, old file intact
If crash at step 3: rename is atomic, either old or new exists
Result: Always consistent state
```

### 4.5 C4: Error Handling Undefined

**Missing Error Scenarios:**

| Scenario | Current Handling | Required |
|----------|------------------|----------|
| Parse error in file | Undefined | Emit partial result + mark as error |
| Parquet write fails | Undefined | Atomic write prevents corruption |
| DuckDB connection fails | Undefined | Retry with backoff |
| Corrupt Parquet file | Undefined | Regenerate from source |
| Disk full | Undefined | Fail gracefully, preserve existing |

---

## 5. Impact Analysis: With vs Without Fixes

### 5.1 Scenario A: Implement WITHOUT Fixes

**WHAT HAPPENS:**

1. **Per-file Parquet (C1 not addressed)**
   - Small repos: Works fine
   - Medium repos: Noticeable slowdown
   - Large repos: Query times >1s, possibly unusable

2. **<100ms target (C2 not revised)**
   - Developers expect fast updates
   - Actual: 150-250ms
   - Perceived as "slow" vs promise

3. **Non-atomic writes (C3 not fixed)**
   - Normal operation: Works
   - System crash/sleep: POTENTIAL DATA LOSS
   - Recovery: Manual regeneration required

4. **No error handling (C4 not addressed)**
   - Happy path: Works
   - Parse errors: ANALYSIS FAILS COMPLETELY
   - Partial failures: UNDEFINED BEHAVIOR

**OVERALL RISK: HIGH**
- Works for demos and small projects
- Breaks on real-world codebases
- Data corruption risk on crashes

### 5.2 Scenario B: Implement WITH Critical Fixes

**WHAT HAPPENS:**

1. **Per-file Parquet + Fallback (C1 addressed)**
   - Benchmark before Phase 1 completion
   - If >500ms for 10K files: Switch to per-package
   - Guaranteed acceptable performance

2. **Revised target: <200ms (C2 addressed)**
   - Achievable with warm DuckDB connection
   - Document warm vs cold expectations
   - Meets revised expectations

3. **Atomic writes (C3 addressed)**
   - Write to temp, rename to target
   - System crash: Either old or new state, never corrupt
   - Data integrity guaranteed

4. **Error handling strategy (C4 addressed)**
   - Parse errors: Skip file, log warning, continue
   - Write errors: Retry with backoff, then skip
   - Graceful degradation

**OVERALL RISK: LOW**
- Production-ready implementation
- Handles real-world edge cases
- Data integrity maintained

### 5.3 HIGH Priority Fixes Impact

**H1: Semantic Resolver Interface**

WITHOUT:
```
Parse file --?--> How to resolve imports? --?--> Who owns this?
               No clear interface
```

WITH:
```
Parse file ---> SemanticResolver.resolve() ---> Resolved refs
               Clear contract, testable
```

**H2: Entity ID Stability**

CURRENT (line-based): `hash(file + name + startLine)`
- Problem: Add comment above function -> line changes -> ID changes

FIXED (position-independent): `hash(file + qualifiedName + signature)`
- Result: Stable IDs across minor edits

**H3: File Locking**

WITHOUT:
```
devac watch (writing)  |  devac query (reading)
         |             |         |
         v             |         v
    Write file     <conflict>   Read file
    (partial)          |       (corrupt)
```

WITH:
```
devac watch           |  devac query
     |                |      |
     v                |      v
  acquire lock -------|-- wait for lock
     |                |      |
  write file          |      |
     |                |      |
  release lock -------|-> acquire lock
                      |      |
                      |   read file (consistent)
```

---

## 6. Detailed Diagrams

### 6.1 Sequence Diagram: Full Analysis Pipeline (v2.0)

```
User          CLI           Analyzer        Parser        SeedWriter
 |             |               |              |              |
 | devac       |               |              |              |
 | analyze     |               |              |              |
 |------------>|               |              |              |
 |             |               |              |              |
 |             |  analyze()    |              |              |
 |             |-------------->|              |              |
 |             |               |              |              |
 |             |               | scan files   |              |
 |             |               |------------->|              |
 |             |               |              |              |
 |             |               |<-------------|              |
 |             |               | FileInfo[]   |              |
 |             |               |              |              |
 |             |               |----------------------------------|
 |             |               |  LOOP: for each file             |
 |             |               |                                  |
 |             |               |  parseStructural()               |
 |             |               |------------->|                   |
 |             |               |              |                   |
 |             |               |<-------------|                   |
 |             |               | ParseResult  |                   |
 |             |               |              |                   |
 |             |               | writeFile()  |                   |
 |             |               |-------------------------->|      |
 |             |               |              |             |      |
 |             |               |              | DuckDB->    |      |
 |             |               |              | Parquet     |      |
 |             |               |              |             |      |
 |             |               |<--------------------------|      |
 |             |               |----------------------------------|
 |             |               |                                  |
 |             |               | resolveSemantics()               |
 |             |               |-------------------->|             |
 |             |               |                     |             |
 |             |               | read external_refs  |             |
 |             |               |<--------------------|             |
 |             |               |                     |             |
 |             |               | query other packages|             |
 |             |               |---------------------|------------>|
 |             |               |                     |             |
 |             |               | update refs         |             |
 |             |               |---------------------------------->|
 |             |               |                                   |
 |             |<--------------|                                   |
 |             | complete      |                                   |
 |<------------|               |                                   |
 | Analysis    |               |                                   |
 | complete    |               |                                   |
```

### 6.2 Sequence Diagram: Incremental Update (v2.0)

```
FileSystem    Watcher       Parser         SeedWriter      Parquet
    |            |            |               |              |
    | file       |            |               |              |
    | change     |            |               |              |
    |----------->|            |               |              |
    |            |            |               |              |
    |            | debounce   |               |              |
    |            | (50ms)     |               |              |
    |            |------|     |               |              |
    |            |      |     |               |              |
    |            |<-----|     |               |              |
    |            |            |               |              |
    |            | parse()    |               |              |
    |            |----------->|               |              |
    |            |            |               |              |
    |            |            | Babel parse   |              |
    |            |            |------|        |              |
    |            |            |      |        |              |
    |            |            |<-----|        |              |
    |            |            |               |              |
    |            |<-----------|               |              |
    |            | ParseResult|               |              |
    |            |            |               |              |
    |            | updateFile()               |              |
    |            |-------------------------->|              |
    |            |            |               |              |
    |            |            |               | write temp   |
    |            |            |               |------------>|
    |            |            |               |              |
    |            |            |               | fsync        |
    |            |            |               |------------>|
    |            |            |               |              |
    |            |            |               | rename       |
    |            |            |               | (atomic)     |
    |            |            |               |------------>|
    |            |            |               |              |
    |            |<---------------------------|              |
    |            | complete (~150ms total)    |              |

TIMING BREAKDOWN:
Debounce:    50ms
Parse:       30ms
DuckDB:      25ms
Write:       30ms (3 files x 10ms)
-----------------
TOTAL:      135ms (warm path)
```

### 6.3 State Diagram: File Watcher States

```
                      +-------------+
                      |             |
      start()         |    IDLE     |<-----------+
 +------------------>|             |            |
 |                   +-------------+            |
 |                         |                    |
 |                         | file change event  | complete
 |                         v                    |
 |                   +-------------+            |
 |                   |             |            |
 |                   |  DEBOUNCING |            |
 |                   |  (50ms wait)|            |
 |                   |             |            |
 |                   +-------------+            |
 |                         |                    |
 |                         | timeout            |
 |                         v                    |
 |                   +-------------+            |
 |                   |             |            |
 |                   |   PARSING   |------------+
 |                   |             |  success   |
 |                   +-------------+            |
 |                         |                    |
 |                         | error              |
 |                         v                    |
 |                   +-------------+            |
 |                   |             |            |
 |                   |    ERROR    |------------+
 |                   | (log, skip) |  recover
 |                   |             |
 |                   +-------------+
 |
 |  stop()
 +------------------------------------------+
                                            |
                                            v
                                      +-------------+
                                      |             |
                                      |   STOPPED   |
                                      |             |
                                      +-------------+
```

### 6.4 State Diagram: Parquet File Lifecycle

```
                     +---------------+
                     |               |
    initial analysis |  NOT EXISTS   |<-------------+
    +--------------->|               |              |
    |                +---------------+              |
    |                       |                       |
    |                       | parse + write         |
    |                       v                       |
    |                +---------------+              |
    |                |               |              |
    |                |   TEMP FILE   |              |
    |                |  (.parquet    |              |
    |                |   .tmp)       |              |
    |                |               |              |
    |                +---------------+              |
    |                       |                       |
    |       +---------------+---------------+       |
    |       |                               |       |
    |       v                               v       |
    | +---------------+             +---------------+
    | |               |             |               |
    | |   WRITTEN     |  fsync fail |   ORPHANED    |
    | |  (rename ok)  |<------------|  (crash/err)  |
    | |               |             |               |
    | +---------------+             +---------------+
    |       |                               |
    |       |                               | cleanup
    |       |                               v
    |       |                       +---------------+
    |       |                       |               |
    |       |                       |   DELETED     |--+
    |       |                       |               |  | next analysis
    |       |                       +---------------+  |
    |       |                                          |
    |       +------------------------------------------+
    |       |
    |       | source file changed
    |       v
    | +---------------+
    | |               |
    | |    STALE      |
    | |               |
    | +---------------+
    |       |
    |       | update triggered
    |       v
    | +---------------+
    | |               |
    | |   UPDATING    |---> back to WRITTEN
    | |               |
    | +---------------+
    |
    | source file deleted
    +------------------------------------------------------+
```

### 6.5 Flow Diagram: Query Resolution

```
+---------------------------------------------------------------------+
|  devac find handleLogin --kind function                             |
+---------------------------------------------------------------------+
                            |
                            v
+---------------------------------------------------------------------+
|  Determine scope: package / repo / cross-repo                       |
+---------------------------------------------------------------------+
                            |
        +-------------------+-------------------+
        v                   v                   v
+---------------+   +---------------+   +---------------+
|  PACKAGE      |   |  REPOSITORY   |   |  CROSS-REPO   |
|  (local .dev- |   |  (all pkgs in |   |  (central hub |
|   ac/seed/)   |   |   repo)       |   |   + all repos)|
+---------------+   +---------------+   +---------------+
        |                   |                   |
        v                   v                   v
+---------------------------------------------------------------------+
|  Build glob pattern(s)                                              |
|                                                                     |
|  Package:    '.devac/seed/nodes/*.parquet'                          |
|  Repo:       'packages/*/.devac/seed/nodes/*.parquet'               |
|  Cross-repo: ['/path/repo1/**', '/path/repo2/**', ...]              |
+---------------------------------------------------------------------+
                            |
                            v
+---------------------------------------------------------------------+
|  Execute DuckDB query                                               |
|                                                                     |
|  SELECT entity_id, name, file_path, start_line                      |
|  FROM read_parquet(${glob})                                         |
|  WHERE name = 'handleLogin'                                         |
|    AND kind = 'function'                                            |
+---------------------------------------------------------------------+
                            |
                            v
+---------------------------------------------------------------------+
|  Format output                                                      |
|                                                                     |
|  Found 3 matches:                                                   |
|                                                                     |
|  1. packages/auth/src/auth.ts:45                                    |
|     function handleLogin(user: User): Promise<Token>                |
|                                                                     |
|  2. packages/api/src/handlers.ts:102                                |
|     function handleLogin(req: Request): Response                    |
|                                                                     |
|  3. apps/web/src/pages/login.tsx:78                                 |
|     const handleLogin = async () => { ... }                         |
+---------------------------------------------------------------------+
```

---

## 7. Decision Matrix

### 7.1 Implementation Decision Points

| Decision | Option A | Option B | Recommendation |
|----------|----------|----------|----------------|
| **Parquet Strategy** | Per-file (spec) | Per-package (fallback) | Start per-file, benchmark, fallback if >500ms |
| **Update Target** | <100ms (spec) | <200ms (revised) | Revise to <200ms |
| **Error Handling** | Skip file, continue | Fail fast | Skip file, log, continue |
| **Atomic Writes** | None (spec) | Write-temp-rename | Write-temp-rename |
| **File Locking** | None | Lock per package | Lock per package |
| **Entity IDs** | Line-based | Position-independent | Position-independent |

### 7.2 Phase Gate Criteria

| Gate | Criteria | Pass Condition |
|------|----------|----------------|
| **Phase 0->1** | Critical fixes in spec | C1-C4 addressed in spec |
| **Phase 1->2** | Parquet benchmark | Query time <500ms for 10K files |
| **Phase 1->2** | Atomic writes work | Crash test shows no corruption |
| **Phase 2->3** | Incremental <200ms | Measured on real codebase |

---

## 8. Implementation Scenarios

### 8.1 Recommended Path

**WEEK 0 (Pre-Phase 1): Fix Spec**
- [ ] Add atomic write pattern to spec
- [ ] Add error handling section to spec
- [ ] Revise performance target to <200ms
- [ ] Create Parquet benchmark script

**WEEK 1-2: Phase 1A (Foundation)**
- [ ] DuckDB integration with atomic writes
- [ ] SeedWriter implementation
- [ ] Run Parquet benchmark
- [ ] GATE: If >500ms, pivot to per-package

**WEEK 3: Phase 1B (Parser Port)**
- [ ] Port TS structural parser
- [ ] Implement SemanticResolver interface
- [ ] Position-independent entity IDs

**WEEK 4-5: Phase 2 (Incremental)**
- [ ] File watcher integration
- [ ] File locking
- [ ] Validate <200ms target
- [ ] GATE: If >300ms, optimize or adjust expectations

**WEEK 6+: Phase 3-6 (Python, Federation, etc.)**
- [ ] As specified in v2.0 spec

### 8.2 Risk Mitigation Checkpoints

| Checkpoint | Risk | Mitigation |
|------------|------|------------|
| End of Week 1 | Parquet doesn't scale | Switch to per-package |
| End of Week 4 | Incremental too slow | Add DuckDB connection pool |
| End of Week 6 | Python parser too slow | Add long-running process |

---

## 9. Recommendations

### 9.1 For Specification v2.1

1. **Add Section 8.5: Error Handling**
   - Define behavior for parse errors, write errors, corrupt files
   - Specify retry logic and fallback strategies

2. **Revise Section 12.1: Performance Targets**
   - Change <100ms to <200ms
   - Add warm vs cold distinction
   - Add Windows-specific notes

3. **Add Section 5.4: Atomic Write Pattern**
   - Specify write-temp-rename pattern
   - Include fsync requirements

4. **Add Section 6.5: SemanticResolver Interface**
   - Define clear input/output contract
   - Specify batching and concurrency

5. **Revise Section 4.4: Entity ID Format**
   - Remove line number from hash input
   - Use qualified name + signature instead

### 9.2 For Implementation

1. **Before starting:** Run Parquet benchmark with 10K files
2. **Week 1 priority:** Atomic writes and error handling
3. **Continuous:** Measure actual performance vs targets
4. **Gate decisions:** Don't proceed if gates fail

### 9.3 Final Verdict

| Aspect | Recommendation |
|--------|----------------|
| **Proceed with v2.0?** | YES, with modifications |
| **Critical fixes required?** | YES, before Phase 1 |
| **Timeline adjustment?** | Add 1 week for fixes |
| **Risk level after fixes?** | LOW |

---

## Appendix: Key Files to Modify for v2.0

### Files to Remove
- `src/database/neo4j-client.ts`
- `src/analyzer/storage-manager.ts` (replace with SeedWriter)

### Files to Modify
- `src/analyzer/analyzer-service.ts` -> Remove Neo4j, add SeedWriter
- `src/analyzer/structural-parser.ts` -> Add externalRefs extraction
- `src/analyzer/relationship-resolver.ts` -> Add SemanticResolver interface
- `src/config/index.ts` -> Remove Neo4j config, add seed config

### Files to Add
- `src/seed/seed-writer.ts` -> DuckDB to Parquet writer
- `src/seed/seed-reader.ts` -> Parquet query helper
- `src/seed/atomic-write.ts` -> Write-temp-rename utilities
- `src/watcher/file-watcher.ts` -> Chokidar-based watcher
- `src/query/duckdb-engine.ts` -> Query execution

---

## Appendix: Interface Definitions

### StructuralParseResult (v2.0 proposal)

```typescript
interface StructuralParseResult {
  filePath: string;
  sourceFileHash: string;           // For partition naming
  
  nodes: ParsedNode[];
  edges: ParsedEdge[];
  externalRefs: ParsedExternalRef[];
  
  metadata: {
    parseTimeMs: number;
    language: string;
    nodeCount: number;
    edgeCount: number;
    refCount: number;
  };
}
```

### ParsedExternalRef (v2.0 proposal)

```typescript
interface ParsedExternalRef {
  id: string;
  sourceEntityId: string;           // Node making the reference
  sourceFilePath: string;           // File containing the import
  sourceLine: number;               // Line number of import statement
  
  moduleSpecifier: string;          // "@shared/schema", "react", "./utils"
  importedSymbol: string;           // "User", "default", "*"
  importKind: "named" | "default" | "namespace" | "side-effect";
  
  isResolved: boolean;              // Populated by semantic pass
  resolvedEntityId?: string;        // Resolved target entity
  resolvedFilePath?: string;        // Resolved target file
  isTypeOnly: boolean;              // TypeScript "import type"
}
```

### SeedWriter (v2.0 proposal)

```typescript
interface SeedWriter {
  writeFile(seedPath: string, result: StructuralParseResult): Promise<void>;
  deleteFile(seedPath: string, sourceFileHash: string): Promise<void>;
  updateFile(seedPath: string, result: StructuralParseResult): Promise<void>;
}
```

### SemanticResolver (v2.0 proposal - from reviews)

```typescript
interface SemanticResolver {
  resolveExternalRefs(
    refs: ParsedExternalRef[],
    packageIndex: PackageIndex
  ): Promise<ResolvedExternalRef[]>;
  
  batchSize: number;
  maxConcurrency: number;
}
```

---

*End of Documentation*
