# DevAC Spec v1.11 - Comprehensive Implementation Documentation

> **Purpose**: Visual guide to understand the incremental graph update system
> **Spec Reference**: devac-spec-v1.11.md
> **Date**: 2025-12-11

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Component Deep Dive](#3-component-deep-dive)
4. [Data Flow Diagrams](#4-data-flow-diagrams)
5. [State Machine Diagrams](#5-state-machine-diagrams)
6. [Sequence Diagrams](#6-sequence-diagrams)
7. [Type Contracts](#7-type-contracts)
8. [Error Handling Flows](#8-error-handling-flows)
9. [Implementation Phases](#9-implementation-phases)
10. [Quick Reference](#10-quick-reference)

---

## 1. Executive Summary

### What We're Building

Transform CodeGraph from **batch processing** (30-60s full repo scan) to **incremental updates** (<500ms per file change).

### The Core Idea

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BEFORE (Batch)                               │
│  File Change → Wait → Scan ALL files → Update ALL nodes → 30-60s    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         AFTER (Incremental)                          │
│  File Change → Parse ONE file → Update ONE file's nodes → <500ms    │
└─────────────────────────────────────────────────────────────────────┘
```

### Two-Phase Architecture

| Phase | Name | Speed | Purpose |
|-------|------|-------|---------|
| **Phase 1** | Structural | <200ms | Fast AST extraction (Babel) |
| **Phase 2** | Semantic | 2-5s batched | Cross-file resolution (ts-morph) |

**Why two phases?**
- Users see immediate updates (Phase 1)
- Cross-file relationships appear shortly after (Phase 2)
- Neither blocks the other

---

## 2. System Architecture Overview

### High-Level Component Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DevAC System                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐     ┌─────────────────────────────────────────────────┐   │
│  │              │     │         ValidationCoordinatorActor               │   │
│  │  FileWatcher │────▶│  ┌─────────────────────────────────────────┐    │   │
│  │  (chokidar)  │     │  │           XState v5 Machine              │    │   │
│  │              │     │  │  idle → running → processing → idle      │    │   │
│  └──────────────┘     │  └─────────────────────────────────────────┘    │   │
│                       │                     │                            │   │
│                       │          ┌──────────┴──────────┐                 │   │
│                       │          ▼                     ▼                 │   │
│                       │  ┌──────────────┐     ┌──────────────────┐      │   │
│                       │  │LanguageRouter│     │SemanticResolver  │      │   │
│                       │  │              │     │    Actor         │      │   │
│                       │  └──────┬───────┘     └────────┬─────────┘      │   │
│                       │         │                      │                 │   │
│                       └─────────┼──────────────────────┼─────────────────┘   │
│                                 │                      │                     │
│                                 ▼                      ▼                     │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        Core Services                                  │   │
│  │  ┌────────────────┐  ┌───────────────┐  ┌─────────────────────────┐  │   │
│  │  │StructuralParser│  │NodeIndexCache │  │RelationshipResolver     │  │   │
│  │  │    (Babel)     │  │  (in-memory)  │  │Adapter (ts-morph)       │  │   │
│  │  └────────────────┘  └───────────────┘  └─────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                 │                                            │
│                                 ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         Data Layer                                    │   │
│  │  ┌────────────────┐  ┌───────────────┐  ┌─────────────────────────┐  │   │
│  │  │  Neo4jClient   │  │GraphUpdater   │  │  SemanticUpdater        │  │   │
│  │  │               │  │    Actor      │  │  (version-guarded)      │  │   │
│  │  └────────────────┘  └───────────────┘  └─────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Key Files |
|-----------|---------------|-----------|
| **FileWatcher** | Monitor filesystem, debounce events | `src/devac/services/codegraph/file-watcher.ts` |
| **ValidationCoordinator** | Orchestrate pipeline, manage state | `src/devac/actors/validation-coordinator.actor.ts` |
| **LanguageRouter** | Route files to correct parser | `src/pipeline/language-router.ts` (NEW) |
| **StructuralParser** | Fast Babel AST extraction | `src/analyzer/structural-parser.ts` |
| **GraphUpdater** | Atomic Neo4j updates | `src/devac/actors/graph-updater.actor.ts` |
| **NodeIndexCache** | In-memory node index for semantic | `src/devac/services/node-index-cache.ts` (NEW) |
| **SemanticResolver** | Cross-file relationship resolution | `src/devac/actors/semantic-resolver.actor.ts` |
| **RelationshipResolverAdapter** | Wrap ts-morph resolution | `src/pipeline/adapters/relationship-resolver-adapter.ts` (NEW) |
| **Neo4jClient** | Database transactions | `src/database/neo4j-client.ts` |

---

## 3. Component Deep Dive

### 3.1 FileWatcher

**Purpose**: Detect file changes with intelligent debouncing.

```
┌─────────────────────────────────────────────────────────────────┐
│                        FileWatcher                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  File System Events                                              │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────┐    │
│  │   chokidar  │────▶│  Debouncer  │────▶│ FileChangeEvent │    │
│  │   watcher   │     │   (500ms)   │     │                 │    │
│  └─────────────┘     └─────────────┘     └─────────────────┘    │
│                                                                  │
│  Ignore Patterns:                                                │
│  • node_modules/**                                               │
│  • dist/**                                                       │
│  • .git/**                                                       │
│  • *.d.ts                                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Output Event**:
```typescript
{
  type: "add" | "change" | "unlink",
  path: "/absolute/path/to/file.ts",
  timestamp: 1702300000000
}
```

### 3.2 StructuralParser

**Purpose**: Fast AST extraction without type checking.

```
┌─────────────────────────────────────────────────────────────────┐
│                     StructuralParser                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Input: filePath                                                 │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────┐    │
│  │  Read File  │────▶│ Babel Parse │────▶│  Walk AST       │    │
│  │             │     │ (error-     │     │                 │    │
│  │             │     │  recovery)  │     │  Extract:       │    │
│  └─────────────┘     └─────────────┘     │  • Classes      │    │
│                                          │  • Functions    │    │
│                                          │  • Methods      │    │
│                                          │  • Imports      │    │
│                                          │  • Exports      │    │
│                                          └─────────────────┘    │
│                                                   │              │
│                                                   ▼              │
│                                          StructuralParseResult   │
│                                                                  │
│  Performance: <200ms per file (target)                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**What Gets Extracted**:

| AST Node | Creates | Relationships |
|----------|---------|---------------|
| ClassDeclaration | Class node | CONTAINS → methods |
| FunctionDeclaration | Function node | - |
| MethodDefinition | Method node | - |
| ImportDeclaration | (stored as string) | - |
| ExportDeclaration | ExportedSymbol | - |

### 3.3 NodeIndexCache (NEW in v1.11)

**Purpose**: In-memory cache of all nodes for cross-file resolution.

```
┌─────────────────────────────────────────────────────────────────┐
│                      NodeIndexCache                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              nodesByEntityId: Map                        │    │
│  │  ┌──────────────────────┬───────────────────────────┐   │    │
│  │  │ entityId             │ NodeIndexEntry            │   │    │
│  │  ├──────────────────────┼───────────────────────────┤   │    │
│  │  │ "Function:/a.ts:foo" │ {name:"foo", kind:"Fn"..} │   │    │
│  │  │ "Class:/b.ts:Bar"    │ {name:"Bar", kind:"Cl"..} │   │    │
│  │  └──────────────────────┴───────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              nodesByFile: Map                            │    │
│  │  ┌──────────────────────┬───────────────────────────┐   │    │
│  │  │ filePath             │ Set<entityId>             │   │    │
│  │  ├──────────────────────┼───────────────────────────┤   │    │
│  │  │ "/src/a.ts"          │ {"Function:/a.ts:foo"..}  │   │    │
│  │  └──────────────────────┴───────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              exportsByFile: Map                          │    │
│  │  ┌──────────────────────┬───────────────────────────┐   │    │
│  │  │ filePath             │ Map<exportName, entityId> │   │    │
│  │  ├──────────────────────┼───────────────────────────┤   │    │
│  │  │ "/src/a.ts"          │ {"default" → "Fn:a:foo"}  │   │    │
│  │  └──────────────────────┴───────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Methods:                                                        │
│  • updateFile(path, nodes, exports) — Add/update file nodes     │
│  • removeFile(path) — Remove all nodes for file                 │
│  • getNode(entityId) — Fast lookup                              │
│  • getAllNodes() — For RelationshipResolver                     │
│  • resolveImport(path, name) — Resolve import to entityId       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Why This Matters**:
- v1.10 passed only single-file nodes to semantic resolver
- Cross-file resolution NEEDS all nodes
- NodeIndexCache provides O(1) lookup for any node

### 3.4 GraphUpdater Actor

**Purpose**: Atomic Neo4j updates with delete-then-create.

```
┌─────────────────────────────────────────────────────────────────┐
│                     GraphUpdater Actor                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Input: GraphUpdaterInput                                        │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Single Neo4j Transaction                    │    │
│  │                                                          │    │
│  │  Step 1: DELETE old nodes                                │    │
│  │  ┌────────────────────────────────────────────────────┐ │    │
│  │  │ MATCH (f:File {filePath: $path})-[:OWNS]->(n:Node) │ │    │
│  │  │ DETACH DELETE n                                     │ │    │
│  │  └────────────────────────────────────────────────────┘ │    │
│  │                         │                                │    │
│  │                         ▼                                │    │
│  │  Step 2: UPDATE File node status                         │    │
│  │  ┌────────────────────────────────────────────────────┐ │    │
│  │  │ MERGE (f:File {filePath: $path})                   │ │    │
│  │  │ SET f.structuralComplete = true,                   │ │    │
│  │  │     f.structuralInProgress = false,                │ │    │
│  │  │     f.semanticQueued = true,                       │ │    │
│  │  │     f.structuralVersion = $version                 │ │    │
│  │  └────────────────────────────────────────────────────┘ │    │
│  │                         │                                │    │
│  │                         ▼                                │    │
│  │  Step 3: CREATE new nodes                                │    │
│  │  ┌────────────────────────────────────────────────────┐ │    │
│  │  │ UNWIND $nodes AS nodeData                          │ │    │
│  │  │ CREATE (n:Node) SET n = nodeData.properties        │ │    │
│  │  │ // With APOC: addLabels for dynamic labels         │ │    │
│  │  └────────────────────────────────────────────────────┘ │    │
│  │                         │                                │    │
│  │                         ▼                                │    │
│  │  Step 4: CREATE OWNS relationships                       │    │
│  │  ┌────────────────────────────────────────────────────┐ │    │
│  │  │ MATCH (f:File {filePath: $path})                   │ │    │
│  │  │ MATCH (n:Node {filePath: $path})                   │ │    │
│  │  │ MERGE (f)-[:OWNS]->(n)                             │ │    │
│  │  └────────────────────────────────────────────────────┘ │    │
│  │                         │                                │    │
│  │                         ▼                                │    │
│  │  Step 5: CREATE structural relationships                 │    │
│  │  ┌────────────────────────────────────────────────────┐ │    │
│  │  │ // CONTAINS, etc. - batched by type                │ │    │
│  │  └────────────────────────────────────────────────────┘ │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                         │                                        │
│                         ▼                                        │
│              GraphUpdaterResult                                  │
│              { success, nodesCreated, structuralVersion }        │
│                                                                  │
│  GUARANTEE: File never has "zero nodes" due to partial failure  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.5 SemanticUpdater (NEW in v1.11)

**Purpose**: Write semantic relationships with version guard.

```
┌─────────────────────────────────────────────────────────────────┐
│                     SemanticUpdater                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Input: SemanticResolutionResult + expectedStructuralVersion     │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              VERSION GUARD CHECK (NEW)                   │    │
│  │                                                          │    │
│  │  MATCH (f:File {filePath: $path})                       │    │
│  │  RETURN f.structuralVersion as version                  │    │
│  │                                                          │    │
│  │  if (currentVersion !== expectedVersion) {              │    │
│  │    // Structural parse happened while we were resolving │    │
│  │    // SKIP write - our data is stale                    │    │
│  │    return { success: true, skippedDueToVersion: true }  │    │
│  │  }                                                       │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                         │                                        │
│                         ▼ (version matches)                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  DELETE old semantic relationships (cross-file only)    │    │
│  │                                                          │    │
│  │  MATCH (f:File {filePath: $path})-[:OWNS]->(n:Node)     │    │
│  │  MATCH (n)-[r]->(target:Node)                           │    │
│  │  WHERE r.semantic = true                                │    │
│  │    AND target.filePath <> $path   // Only cross-file    │    │
│  │  DELETE r                                                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                         │                                        │
│                         ▼                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  CREATE new semantic relationships                       │    │
│  │                                                          │    │
│  │  For each resolved relationship:                        │    │
│  │    MATCH (source:Node {entityId: $sourceId})            │    │
│  │    MATCH (target:Node {entityId: $targetId})            │    │
│  │    CREATE (source)-[:IMPORTS {semantic: true}]->(target)│    │
│  └─────────────────────────────────────────────────────────┘    │
│                         │                                        │
│                         ▼                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Mark semantic complete (with version check again)       │    │
│  │                                                          │    │
│  │  MATCH (f:File {filePath: $path})                       │    │
│  │  WHERE f.structuralVersion = $expectedVersion           │    │
│  │  SET f.semanticComplete = true                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Why Version Guard?**

```
Timeline without version guard (BUG):
─────────────────────────────────────────────────────────────────
t=0   File changed (v1)
t=10  Structural parse starts
t=50  Structural parse complete, semantic queued (v1)
t=100 File changed AGAIN (v2)        ← User keeps editing
t=110 Structural parse starts (v2)
t=150 Semantic resolution starts for v1
t=160 Structural parse complete (v2)
t=200 Semantic write for v1          ← WRONG! Writing stale data
─────────────────────────────────────────────────────────────────

Timeline WITH version guard (CORRECT):
─────────────────────────────────────────────────────────────────
t=200 Semantic write checks: version=2, expected=1
      → SKIP (version mismatch)
      → v1 semantic data discarded
      → v2 semantic resolution will run with fresh data
─────────────────────────────────────────────────────────────────
```

---

## 4. Data Flow Diagrams

### 4.1 Complete Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INCREMENTAL UPDATE PIPELINE                          │
└─────────────────────────────────────────────────────────────────────────────┘

     FILE SYSTEM                    COORDINATOR                    NEO4J
         │                              │                            │
         │  FileChangeEvent             │                            │
         │  {type:"change",             │                            │
         │   path:"/src/foo.ts"}        │                            │
         │─────────────────────────────▶│                            │
         │                              │                            │
         │                              │ [1] Deduplicate            │
         │                              │     (by path, keep latest) │
         │                              │                            │
         │                              │ [2] FileMutex.acquire()    │
         │                              │                            │
         │                              │ [3] FileGuard.checkExists()│
         │                              │     → handle delete if     │
         │                              │       missing (NEW v1.11)  │
         │                              │                            │
         │                              │ [4] FileGuard.checkSize()  │
         │                              │     → reject if >500KB     │
         │                              │                            │
         │                              │ [5] Set structuralInProgress│
         │                              │────────────────────────────▶│
         │                              │                            │
         │                              │ [6] LanguageRouter.parse() │
         │                              │     │                      │
         │                              │     ▼                      │
         │                      ┌───────────────────────┐            │
         │                      │   StructuralParser    │            │
         │                      │   (Babel, <200ms)     │            │
         │                      └───────────────────────┘            │
         │                              │                            │
         │                              │ StructuralParseResult      │
         │                              │                            │
         │                              │ [7] GraphUpdater           │
         │                              │     │                      │
         │                              │     └─────────────────────▶│
         │                              │        DELETE old nodes    │
         │                              │        CREATE new nodes    │
         │                              │        (atomic tx)         │
         │                              │                            │
         │                              │ [8] NodeIndexCache.update()│
         │                              │     (NEW v1.11)            │
         │                              │                            │
         │                              │ [9] SemanticResolver.      │
         │                              │     enqueue() [TS/JS only] │
         │                              │                            │
         │                              │ [10] FileMutex.release()   │
         │                              │                            │
         │                              │                            │
         │                              │  ─ ─ ─ BACKGROUND ─ ─ ─   │
         │                              │                            │
         │                      ┌───────────────────────┐            │
         │                      │ SemanticResolverActor │            │
         │                      │ (batched, debounced)  │            │
         │                      └───────────────────────┘            │
         │                              │                            │
         │                              │ [B1] TsMorphProjectManager │
         │                              │      .updateFile()         │
         │                              │                            │
         │                              │ [B2] RelationshipResolver  │
         │                              │      Adapter.resolve()     │
         │                              │      (uses NodeIndexCache) │
         │                              │                            │
         │                              │ [B3] SemanticUpdater       │
         │                              │      (version-guarded)     │
         │                              │─────────────────────────────▶│
         │                              │        Write semantic edges │
         │                              │        Set semanticComplete │
         │                              │                            │
         │                              │ [B4] Queue dependents      │
         │                              │      for re-analysis       │
         │                              │                            │
```

### 4.2 Delete Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      FILE DELETE FLOW                            │
└─────────────────────────────────────────────────────────────────┘

  FileWatcher                Coordinator              Neo4j
      │                          │                      │
      │ {type: "unlink",         │                      │
      │  path: "/src/foo.ts"}    │                      │
      │─────────────────────────▶│                      │
      │                          │                      │
      │                          │ NodeIndexCache       │
      │                          │ .removeFile()        │
      │                          │                      │
      │                          │ Delete query:        │
      │                          │──────────────────────▶│
      │                          │                      │
      │                          │ MATCH (f:File        │
      │                          │   {filePath: $path}) │
      │                          │ OPTIONAL MATCH       │
      │                          │   (f)-[:OWNS]->(n)   │
      │                          │ DETACH DELETE n, f   │
      │                          │                      │
      │                          │◀──────────────────────│
      │                          │ Done                 │
      │                          │                      │
```

### 4.3 Rename Detection Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     FILE RENAME DETECTION                        │
└─────────────────────────────────────────────────────────────────┘

  FileWatcher              RenameDetector           Coordinator
      │                         │                       │
      │ {type: "unlink",        │                       │
      │  path: "/old.ts"}       │                       │
      │────────────────────────▶│                       │
      │                         │                       │
      │                         │ Store in              │
      │                         │ pendingUnlinks        │
      │                         │ with timestamp        │
      │                         │                       │
      │ {type: "add",           │                       │
      │  path: "/new.ts"}       │                       │
      │────────────────────────▶│                       │
      │                    (within 100ms window)        │
      │                         │                       │
      │                         │ Detected as RENAME    │
      │                         │──────────────────────▶│
      │                         │                       │
      │                         │           Update Neo4j:
      │                         │           • File.filePath
      │                         │           • Node.filePath
      │                         │           • Node.entityId
      │                         │                       │
```

---

## 5. State Machine Diagrams

### 5.1 ValidationCoordinator State Machine

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ValidationCoordinator State Machine                       │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────┐
                              │  IDLE   │
                              └────┬────┘
                                   │ START
                                   ▼
                              ┌─────────┐
                              │RUNNING  │◀─────────────────────────┐
                              └────┬────┘                          │
                                   │ FILE_CHANGED                  │
                                   ▼                               │
┌──────────────────────────────────────────────────────────────┐   │
│                        PROCESSING                             │   │
│  ┌─────────────────────────────────────────────────────────┐ │   │
│  │                                                          │ │   │
│  │   ┌──────────┐     ┌───────────┐     ┌──────────────┐   │ │   │
│  │   │ CHECK    │────▶│STRUCTURAL │────▶│   QUEUE      │   │ │   │
│  │   │ FILE     │     │  UPDATE   │     │  SEMANTIC    │   │ │   │
│  │   └──────────┘     └───────────┘     └──────────────┘   │ │   │
│  │        │                 │                   │          │ │   │
│  │        │ file deleted    │ parse error       │          │ │   │
│  │        ▼                 ▼                   │          │ │   │
│  │   ┌──────────┐     ┌───────────┐            │          │ │   │
│  │   │ HANDLE   │     │  MARK     │            │          │ │   │
│  │   │ DELETE   │     │  ERROR    │            │          │ │   │
│  │   └──────────┘     └───────────┘            │          │ │   │
│  │                                              │          │ │   │
│  └──────────────────────────────────────────────┼──────────┘ │   │
│                                                 │            │   │
│                                                 ▼            │   │
│                                          ┌──────────────┐    │   │
│                                          │  COMPLETE    │────┼───┘
│                                          │  (check      │    │
│                                          │   queue)     │    │
│                                          └──────────────┘    │
│                                                              │
└──────────────────────────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════
                       SUSPENDED STATES
═══════════════════════════════════════════════════════════════════

                    CIRCUIT_OPEN event
                          │
                          ▼
                   ┌──────────────┐
                   │ CIRCUIT_OPEN │
                   │              │
                   │ • Queue      │
                   │   paused     │
                   │ • Events     │
                   │   accepted   │
                   └──────┬───────┘
                          │ CIRCUIT_CLOSED
                          ▼
                    Back to RUNNING


                    PAUSE event (memory critical)
                          │
                          ▼
                   ┌──────────────────┐
                   │ MEMORY_CRITICAL  │
                   │                  │
                   │ • All processing │
                   │   stopped        │
                   └────────┬─────────┘
                            │ RESUME
                            ▼
                      Back to RUNNING
```

### 5.2 SemanticResolver State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                SemanticResolver State Machine                    │
└─────────────────────────────────────────────────────────────────┘

                         ┌────────┐
                         │  IDLE  │◀──────────────────┐
                         └───┬────┘                   │
                             │ ENQUEUE                │
                             ▼                        │
                        ┌─────────┐                   │
                        │QUEUEING │                   │
                        └────┬────┘                   │
                             │                        │
                             ▼                        │
                       ┌───────────┐                  │
                       │DEBOUNCING │                  │
                       │  (100ms)  │                  │
                       └─────┬─────┘                  │
                             │ timeout                │
                             ▼                        │
                       ┌───────────┐                  │
                       │PROCESSING │                  │
                       │           │                  │
                       │ • Load    │                  │
                       │   batch   │                  │
                       │ • ts-morph│                  │
                       │   resolve │                  │
                       │ • Write   │                  │
                       │   edges   │                  │
                       └─────┬─────┘                  │
                             │                        │
                    ┌────────┴────────┐               │
                    │                 │               │
                success            error              │
                    │                 │               │
                    ▼                 ▼               │
            ┌─────────────┐    ┌───────────┐         │
            │BATCH_COMPLETE│    │   ERROR   │         │
            │             │    │           │         │
            │ More files? │    │ Retry in  │         │
            │ Yes → queue │    │ 5 seconds │         │
            │ No → idle   │    └─────┬─────┘         │
            └──────┬──────┘          │               │
                   │                 │               │
                   └─────────────────┴───────────────┘
```

### 5.3 GraphUpdater State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                  GraphUpdater State Machine                      │
└─────────────────────────────────────────────────────────────────┘

                         ┌────────┐
                   ┌────▶│  IDLE  │◀────┐
                   │     └───┬────┘     │
                   │         │ UPDATE   │
                   │         ▼          │
                   │    ┌──────────┐    │
                   │    │ UPDATING │    │
                   │    │          │    │
                   │    │ • Delete │    │
                   │    │   old    │    │
                   │    │ • Create │    │
                   │    │   new    │    │
                   │    └────┬─────┘    │
                   │         │          │
                   │    ┌────┴────┐     │
                   │    │         │     │
                success      error      │
                   │         │          │
                   │         ▼          │
                   │    ┌──────────┐    │
                   │    │  FAILED  │    │
                   │    │          │    │
                   │    │ retries  │    │
                   │    │   < 3?   │────┘
                   │    │          │  yes (retry)
                   │    └────┬─────┘
                   │         │ no (max retries)
                   │         ▼
                   │    ┌──────────┐
                   └────│ SUCCESS  │
                        └──────────┘
```

---

## 6. Sequence Diagrams

### 6.1 Happy Path: File Change

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SEQUENCE: File Change (Happy Path)                        │
└─────────────────────────────────────────────────────────────────────────────┘

  User       FileWatcher    Coordinator    LanguageRouter   GraphUpdater    Neo4j
   │              │              │              │              │              │
   │ save file    │              │              │              │              │
   │─────────────▶│              │              │              │              │
   │              │              │              │              │              │
   │              │ FILE_CHANGED │              │              │              │
   │              │─────────────▶│              │              │              │
   │              │              │              │              │              │
   │              │              │ acquire mutex│              │              │
   │              │              │──────┐       │              │              │
   │              │              │◀─────┘       │              │              │
   │              │              │              │              │              │
   │              │              │ checkFile()  │              │              │
   │              │              │─────────────▶│              │              │
   │              │              │◀─────────────│              │              │
   │              │              │   allowed    │              │              │
   │              │              │              │              │              │
   │              │              │    parse()   │              │              │
   │              │              │─────────────▶│              │              │
   │              │              │              │──────┐       │              │
   │              │              │              │ Babel│       │              │
   │              │              │              │◀─────┘       │              │
   │              │              │◀─────────────│              │              │
   │              │              │ ParseResult  │              │              │
   │              │              │              │              │              │
   │              │              │         updateGraph()       │              │
   │              │              │─────────────────────────────▶│              │
   │              │              │              │              │              │
   │              │              │              │              │ BEGIN TX     │
   │              │              │              │              │─────────────▶│
   │              │              │              │              │              │
   │              │              │              │              │ DELETE old   │
   │              │              │              │              │─────────────▶│
   │              │              │              │              │              │
   │              │              │              │              │ CREATE new   │
   │              │              │              │              │─────────────▶│
   │              │              │              │              │              │
   │              │              │              │              │ COMMIT       │
   │              │              │              │              │─────────────▶│
   │              │              │              │              │◀─────────────│
   │              │              │◀─────────────────────────────│              │
   │              │              │    success                  │              │
   │              │              │              │              │              │
   │              │              │ update cache │              │              │
   │              │              │──────┐       │              │              │
   │              │              │◀─────┘       │              │              │
   │              │              │              │              │              │
   │              │              │ enqueue semantic            │              │
   │              │              │──────┐       │              │              │
   │              │              │◀─────┘       │              │              │
   │              │              │              │              │              │
   │              │              │ release mutex│              │              │
   │              │              │──────┐       │              │              │
   │              │              │◀─────┘       │              │              │
   │              │              │              │              │              │
   │◀─────────────────────────────│              │              │              │
   │  Graph updated (<500ms)     │              │              │              │
   │              │              │              │              │              │
```

### 6.2 Semantic Resolution Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SEQUENCE: Semantic Resolution                             │
└─────────────────────────────────────────────────────────────────────────────┘

  Coordinator    SemanticActor    TsMorph    NodeCache    Resolver    Neo4j
      │               │              │           │           │          │
      │ ENQUEUE       │              │           │           │          │
      │──────────────▶│              │           │           │          │
      │               │              │           │           │          │
      │               │ (debounce 100ms)         │           │          │
      │               │──────┐       │           │           │          │
      │               │◀─────┘       │           │           │          │
      │               │              │           │           │          │
      │               │ updateFile() │           │           │          │
      │               │─────────────▶│           │           │          │
      │               │◀─────────────│           │           │          │
      │               │  SourceFile  │           │           │          │
      │               │              │           │           │          │
      │               │         getAllNodes()    │           │          │
      │               │─────────────────────────▶│           │          │
      │               │◀─────────────────────────│           │          │
      │               │          all nodes       │           │          │
      │               │              │           │           │          │
      │               │              resolve()               │          │
      │               │──────────────────────────────────────▶│          │
      │               │              │           │           │          │
      │               │              │           │ resolve import       │
      │               │              │           │◀──────────│          │
      │               │              │           │──────────▶│          │
      │               │              │           │           │          │
      │               │◀──────────────────────────────────────│          │
      │               │  resolved relationships  │           │          │
      │               │              │           │           │          │
      │               │              │           │  VERSION CHECK       │
      │               │─────────────────────────────────────────────────▶│
      │               │◀─────────────────────────────────────────────────│
      │               │              │           │           │ v matches│
      │               │              │           │           │          │
      │               │              │           │   WRITE EDGES        │
      │               │─────────────────────────────────────────────────▶│
      │               │◀─────────────────────────────────────────────────│
      │               │              │           │           │  done    │
      │               │              │           │           │          │
      │ SEMANTIC_     │              │           │           │          │
      │ COMPLETE      │              │           │           │          │
      │◀──────────────│              │           │           │          │
      │               │              │           │           │          │
```

### 6.3 Error Recovery Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SEQUENCE: Parse Error Recovery                            │
└─────────────────────────────────────────────────────────────────────────────┘

  FileWatcher    Coordinator    LanguageRouter    Neo4j
      │               │              │              │
      │ FILE_CHANGED  │              │              │
      │──────────────▶│              │              │
      │               │              │              │
      │               │ parse()      │              │
      │               │─────────────▶│              │
      │               │              │              │
      │               │              │──────┐       │
      │               │              │ Babel│       │
      │               │              │ ERROR│       │
      │               │              │◀─────┘       │
      │               │              │              │
      │               │◀─────────────│              │
      │               │ ParseError   │              │
      │               │              │              │
      │               │ Mark error on File node    │
      │               │────────────────────────────▶│
      │               │              │              │
      │               │ MERGE (f:File {path: $p})  │
      │               │ SET f.structuralInProgress │
      │               │     = false,               │
      │               │     f.parseError = $error  │
      │               │              │              │
      │               │◀────────────────────────────│
      │               │              │              │
      │               │ emit PARSE_ERROR event     │
      │               │──────┐       │              │
      │               │◀─────┘       │              │
      │               │              │              │
      │               │ (existing nodes preserved) │
      │               │              │              │
```

---

## 7. Type Contracts

### 7.1 Core Types Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TYPE FLOW DIAGRAM                                  │
└─────────────────────────────────────────────────────────────────────────────┘

  FileWatcher              StructuralParser           GraphUpdater
      │                          │                        │
      │                          │                        │
      ▼                          ▼                        ▼
┌─────────────┐          ┌──────────────────┐     ┌─────────────────┐
│FileChange   │          │StructuralParse   │     │GraphUpdater     │
│Event        │          │Result            │     │Input            │
├─────────────┤          ├──────────────────┤     ├─────────────────┤
│type: string │   ────▶  │filePath: string  │ ──▶ │filePath: string │
│path: string │   parse  │nodes: AstNode[]  │adapt│nodes: GraphNode[]
│timestamp: # │          │relationships:[]  │     │relationships:[] │
└─────────────┘          │importStrings:[]  │     │structuralVersion│
                         │exportedSymbols:[]│     └─────────────────┘
                         └──────────────────┘
                                  │
                                  │ stored
                                  ▼
                         ┌──────────────────┐
                         │NodeIndexCache    │
                         ├──────────────────┤
                         │nodesByEntityId   │
                         │nodesByFile       │
                         │exportsByFile     │
                         └──────────────────┘
                                  │
                                  │ getAllNodes()
                                  ▼
                         ┌──────────────────┐     ┌─────────────────┐
                         │Semantic          │     │SemanticWrite    │
                         │ResolutionResult  │ ──▶ │Result           │
                         ├──────────────────┤     ├─────────────────┤
                         │resolvedRels:[]   │     │success: boolean │
                         │dependentFiles:[] │     │skippedDueToVer  │
                         │structuralVersion │     └─────────────────┘
                         └──────────────────┘
```

### 7.2 Key Type Definitions

```typescript
// ═══════════════════════════════════════════════════════════════
//                    FILE WATCHER TYPES
// ═══════════════════════════════════════════════════════════════

type FileChangeType = "add" | "change" | "unlink";

interface FileChangeEvent {
  type: FileChangeType;
  path: string;           // Absolute file path
  timestamp: number;      // Unix timestamp ms
}

// ═══════════════════════════════════════════════════════════════
//                    STRUCTURAL PARSER TYPES
// ═══════════════════════════════════════════════════════════════

interface AstNode {
  id: string;             // Unique identifier
  entityId: string;       // "kind:filePath:name:line"
  kind: string;           // "Function", "Class", "Method"
  name: string;
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  language: string;       // "typescript" | "javascript"
  createdAt: string;      // ISO timestamp
  parentId?: string;
  modifierFlags?: string[];
}

interface ExportedSymbol {
  name: string;
  kind: "default" | "named";  // NOT free-form (v1.11 fix)
  nodeKind: string;           // The AST node kind
  entityId?: string;          // Reference to exported node
}

interface StructuralParseResult {
  filePath: string;
  nodes: AstNode[];
  relationships: RelationshipInfo[];
  importStrings: string[];      // Unresolved import paths
  exportedSymbols: ExportedSymbol[];
  metadata: {
    parseTimeMs: number;
    nodeCount: number;
    relationshipCount: number;
  };
}

// ═══════════════════════════════════════════════════════════════
//                    GRAPH UPDATER TYPES
// ═══════════════════════════════════════════════════════════════

interface GraphUpdaterInput {
  neo4jClient: Neo4jClient;
  filePath: string;
  nodes: GraphNode[];
  relationships: GraphRelationship[];
  importStrings: string[];
  exportedSymbols: ExportedSymbol[];
  useApoc: boolean;
  structuralVersion: number;  // NEW v1.11
}

interface GraphUpdaterResult {
  success: boolean;
  nodesCreated: number;
  relationshipsCreated: number;
  structuralVersion: number;  // Return for semantic queue
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
//                    SEMANTIC RESOLUTION TYPES
// ═══════════════════════════════════════════════════════════════

interface SemanticQueueEvent {
  type: "ENQUEUE";
  filePath: string;
  priority: "high" | "normal";
  structuralVersion: number;  // NEW v1.11
}

interface SemanticResolutionResult {
  filePath: string;
  resolvedRelationships: ResolvedRelationship[];
  dependentFiles: string[];
  structuralVersion: number;  // Version that was resolved
  success: boolean;
  error?: string;
}

interface ResolvedRelationship {
  sourceEntityId: string;
  targetEntityId: string;
  type: string;               // "IMPORTS", "CALLS", etc.
  resolvedTargetFile?: string;
  resolvedTargetName?: string;
}
```

---

## 8. Error Handling Flows

### 8.1 Error Recovery Matrix

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ERROR RECOVERY MATRIX                                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┬─────────────────────┬─────────────────────────────────┐
│ Error Type          │ Behavior            │ Data State                      │
├─────────────────────┼─────────────────────┼─────────────────────────────────┤
│ Parse fails         │ Mark parseError on  │ Existing nodes PRESERVED        │
│                     │ File node, clear    │                                 │
│                     │ structuralInProgress│                                 │
├─────────────────────┼─────────────────────┼─────────────────────────────────┤
│ Neo4j tx fails      │ Auto-rollback by    │ Existing nodes PRESERVED        │
│ mid-update          │ Neo4j               │ (transaction never committed)   │
├─────────────────────┼─────────────────────┼─────────────────────────────────┤
│ Neo4j connection    │ Retry with backoff  │ Existing nodes PRESERVED        │
│ lost                │ (3 attempts, exp)   │                                 │
├─────────────────────┼─────────────────────┼─────────────────────────────────┤
│ Process crash       │ Uncommitted tx      │ Existing nodes PRESERVED        │
│ during tx           │ discarded, recover  │ structuralInProgress=true       │
│                     │ on restart          │ (cleared on recovery)           │
├─────────────────────┼─────────────────────┼─────────────────────────────────┤
│ File deleted        │ Check existence     │ Clean deletion                  │
│ during parse        │ first, handle as    │                                 │
│                     │ delete              │                                 │
├─────────────────────┼─────────────────────┼─────────────────────────────────┤
│ Semantic version    │ Skip write, log     │ Old semantic edges preserved    │
│ mismatch            │ info, wait for new  │ (will be updated on next        │
│                     │ structural version  │ semantic resolution)            │
├─────────────────────┼─────────────────────┼─────────────────────────────────┤
│ Circuit breaker     │ Queue paused,       │ Existing data preserved         │
│ open                │ events accepted,    │ Queue drains when closed        │
│                     │ auto-retry in 30s   │                                 │
├─────────────────────┼─────────────────────┼─────────────────────────────────┤
│ Memory critical     │ All processing      │ Existing data preserved         │
│                     │ stopped, resume     │ Processing resumes when         │
│                     │ when memory ok      │ memory recovers                 │
└─────────────────────┴─────────────────────┴─────────────────────────────────┘
```

### 8.2 Retry Policy

```
┌─────────────────────────────────────────────────────────────────┐
│                     RETRY WITH BACKOFF                           │
└─────────────────────────────────────────────────────────────────┘

  Attempt 1        Attempt 2        Attempt 3        Give Up
      │                │                │                │
      │ fail           │ fail           │ fail           │
      │────▶ wait ────▶│────▶ wait ────▶│────▶ wait ────▶│
      │     100ms      │     200ms      │     400ms      │
      │                │                │                │
      │                │                │                │
  ┌───┴───┐        ┌───┴───┐        ┌───┴───┐        ┌───┴───┐
  │Success│        │Success│        │Success│        │ Error │
  │ exit  │        │ exit  │        │ exit  │        │ throw │
  └───────┘        └───────┘        └───────┘        └───────┘

  Config:
  • maxRetries: 3
  • initialDelayMs: 100
  • maxDelayMs: 5000
  • backoffMultiplier: 2
  • retryableErrors: ECONNRESET, ETIMEDOUT, ServiceUnavailable, etc.
```

### 8.3 Circuit Breaker Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     CIRCUIT BREAKER FLOW                         │
└─────────────────────────────────────────────────────────────────┘

                    ┌─────────┐
             ┌─────▶│ CLOSED  │◀─────┐
             │      └────┬────┘      │
             │           │           │
        success          │ failure   │ success
             │           │           │ (health check)
             │           ▼           │
             │      ┌─────────┐      │
             │      │failures │      │
             │      │   ++    │      │
             │      └────┬────┘      │
             │           │           │
             │           │ >= 5 failures
             │           ▼           │
             │      ┌─────────┐      │
             └──────│  OPEN   │──────┘
                    │         │
                    │ • Queue │
                    │   paused│
                    │ • 30s   │
                    │   timer │
                    └────┬────┘
                         │
                         │ timer expires
                         ▼
                    ┌──────────┐
                    │HALF-OPEN │
                    │          │
                    │ Try one  │
                    │ health   │
                    │ check    │
                    └────┬─────┘
                         │
                    ┌────┴────┐
                    │         │
               success     failure
                    │         │
                    ▼         ▼
               CLOSED       OPEN
```

---

## 9. Implementation Phases

### 9.1 Phase Timeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        48-DAY IMPLEMENTATION TIMELINE                        │
└─────────────────────────────────────────────────────────────────────────────┘

    Phase 0        Phase 1a       Phase 0.5       Phase 1b
  Verification   Import Fixes   API Reconcile   Fix TS Errors
   ┌─────┐        ┌─────┐        ┌──────┐        ┌───────────┐
   │ 1-3 │        │ 4-7 │        │ 8-13 │        │  14-25    │
   └─────┘        └─────┘        └──────┘        └───────────┘
      │              │              │                  │
      │              │              │                  │
      ▼              ▼              ▼                  ▼
   Schema        Fix paths      Create NEW        Zero TS
   verified      in actors      components        errors
                               (NodeIndexCache,
                                Adapters, etc.)

    Phase 2                    Phase 3            Phase 4
  Core Integration        Semantic Resolution     Polish
   ┌───────────────┐        ┌───────────┐        ┌─────┐
   │    26-37      │        │   38-45   │        │46-48│
   └───────────────┘        └───────────┘        └─────┘
        │                        │                  │
        │                        │                  │
        ▼                        ▼                  ▼
   Pipeline works            ts-morph            Final
   for TS/JS                 resolution          tests
   (smoke tests)             working
```

### 9.2 Phase Dependencies

```
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE DEPENDENCIES                            │
└─────────────────────────────────────────────────────────────────┘

  Phase 0 ─────────────▶ Phase 1a ────────────▶ Phase 0.5
  (Schema)               (Imports)              (Types)
     │                      │                      │
     │                      │                      │
     └──────────────────────┴──────────────────────┘
                            │
                            ▼
                       Phase 1b
                    (Fix TS errors)
                            │
                            │
                            ▼
                       Phase 2 ────────────────▶ Phase 3
                    (Core pipeline)           (Semantic)
                            │                      │
                            │                      │
                            └──────────────────────┘
                                       │
                                       ▼
                                   Phase 4
                                   (Polish)
```

### 9.3 Exit Gates

```
┌─────────────────────────────────────────────────────────────────┐
│                       EXIT GATES                                 │
└─────────────────────────────────────────────────────────────────┘

  Phase 0 Exit:
  ├─ [ ] APOC status determined
  ├─ [ ] Neo4j schema verified (indexes exist)
  ├─ [ ] Import paths mapped
  └─ [ ] Type contracts verified against actual code

  Phase 1a Exit:
  └─ [ ] Import path errors resolved in all actors

  Phase 0.5 Exit:
  ├─ [ ] All type contracts defined
  ├─ [ ] ExportedSymbol type matches actual code
  ├─ [ ] NodeIndexCache created
  ├─ [ ] All adapters created
  └─ [ ] Adapter unit tests pass

  Phase 1b Exit:
  ├─ [ ] tsc --noEmit produces 0 errors
  └─ [ ] Existing unit tests pass

  Phase 2 Exit:
  ├─ [ ] File add/change/delete triggers graph updates
  ├─ [ ] File existence race condition handled
  ├─ [ ] Parse errors properly marked
  ├─ [ ] Circuit breaker pauses queue
  └─ [ ] Integration smoke tests pass

  Phase 3 Exit:
  ├─ [ ] ts-morph warm-up reduces latency
  ├─ [ ] Semantic resolution uses NodeIndexCache
  ├─ [ ] Version guard prevents stale writes
  └─ [ ] Cascading updates working

  Final Exit:
  ├─ [ ] npm test passes
  ├─ [ ] P50 <400ms (warm, local, APOC)
  └─ [ ] Documentation updated
```

---

## 10. Quick Reference

### 10.1 Files to Create

| File | Purpose | Phase |
|------|---------|-------|
| `src/devac/types/events.ts` | Complete event types | 0.5 |
| `src/devac/services/node-index-cache.ts` | In-memory node cache | 0.5 |
| `src/devac/actors/semantic-updater.ts` | Version-guarded writes | 0.5 |
| `src/pipeline/language-router.ts` | Route files to parsers | 2 |
| `src/pipeline/adapters/parse-result-adapter.ts` | Type bridge | 0.5 |
| `src/pipeline/adapters/relationship-resolver-adapter.ts` | Wrap resolver | 0.5 |
| `src/devac/utils/file-mutex.ts` | Per-file locking | 2 |
| `src/devac/utils/file-guard.ts` | File validation | 2 |
| `src/devac/utils/retry.ts` | Exponential backoff | 2 |
| `src/devac/utils/bounded-queue.ts` | Backpressure queue | 2 |
| `src/devac/utils/rename-detector.ts` | Rename heuristic | 2 |
| `src/devac/utils/memory-monitor.ts` | Memory pressure | 2 |
| `src/database/neo4j-health.ts` | Circuit breaker | 2 |
| `src/devac/startup.ts` | Initialization | 2 |
| `src/devac/shutdown.ts` | Graceful shutdown | 2 |

### 10.2 Performance Targets

| Scenario | Target (Local+APOC) | Target (No APOC) |
|----------|---------------------|------------------|
| Structural parse | <100ms | <100ms |
| Graph update | <150ms | <300ms |
| **Total (warm)** | **<400ms** | **<550ms** |
| Cold start | <1500ms | <2000ms |

**SLO**: P50 <400ms, P95 <800ms, P99 <2000ms

### 10.3 Key Configuration

```typescript
// Debounce
DEVAC_DEBOUNCE_MS = 100

// Rename detection window
DEVAC_RENAME_WINDOW_MS = 100

// Queue
maxSize: 1000
dropPolicy: "oldest"

// Retry
maxRetries: 3
initialDelayMs: 100
maxDelayMs: 5000
backoffMultiplier: 2

// Circuit breaker
maxConsecutiveFailures: 5
circuitResetMs: 30000

// Memory
warnThresholdPercent: 70
pauseThresholdPercent: 85

// File guard
maxFileSizeBytes: 500KB
```

### 10.4 Known Limitations (v1.11)

1. **Languages**: TypeScript/JavaScript only (Python, Java deferred to v2)
2. **Validation**: AffectedCalculator + ScriptExecutor deferred to v2
3. **Large files**: >500KB skipped
4. **Rename detection**: Best-effort (100ms window)
5. **Cross-file edges**: May be stale until semantic completes
6. **No full reconciliation**: Only crash recovery on startup
7. **StorageManager bypassed**: Direct Neo4j transactions for incremental

---

## Summary

This documentation provides a comprehensive visual guide to understanding and implementing the DevAC v1.11 incremental graph update system. The key innovations in v1.11 are:

1. **NodeIndexCache** — Enables proper cross-file semantic resolution
2. **Version Guards** — Prevents stale semantic data overwrites
3. **File Existence Checks** — Handles race conditions gracefully
4. **Circuit Breaker + Queue Integration** — Coordinated pause/resume

Use this document alongside the spec for implementation guidance.
