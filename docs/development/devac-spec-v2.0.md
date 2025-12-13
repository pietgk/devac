# DevAC/CodeGraph Specification v2.0: Federated Architecture

**System:** DevAC, CodeGraph  
**Version:** 2.0  
**Status:** Draft  
**Last Updated:** 2025-12-13  
**Previous Version:** v1.11 (direction change - not implemented)

---

## Executive Summary

This specification defines a fundamental architectural shift for DevAC/CodeGraph from a centralized Neo4j-based system to a **federated, file-based architecture** using **DuckDB + Parquet** as the storage layer.

### Key Decisions

| Decision | v1.x Approach | v2.0 Approach |
|----------|---------------|---------------|
| **Storage** | Neo4j graph database | DuckDB + Parquet files |
| **Data Location** | Central database | Per-package seed files + optional central hub |
| **Sync Model** | Continuous sync to DB | Generate on demand, query directly |
| **Multi-Repo** | Single workspace focus | Native federation across repos |
| **Dependency Tracking** | Project-level (manifest) | Symbol-level (code analysis) |
| **Incremental Updates** | Complex transaction logic | Replace file's Parquet partition |

### Why This Change?

The v1.11 spec introduced `NodeIndexCache` - an in-memory cache duplicating all nodes from Neo4j. This highlighted a fundamental architectural issue: **we need fast key-value lookups AND graph queries, but Neo4j optimizes for graphs at the expense of point lookups**.

Instead of adding PostgreSQL as a second database (v1.11-db-redesign proposal), we chose a more radical simplification:

1. **Source code is truth** - Everything else is derived and regenerable
2. **No data duplication** - Query source files directly via Parquet
3. **Single technology** - DuckDB + Parquet everywhere
4. **Files ARE the database** - No sync step, no import, no cache

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Architecture Overview](#2-architecture-overview)
3. [Three-Layer Federation Model](#3-three-layer-federation-model)
4. [Data Model](#4-data-model)
5. [Storage Strategy](#5-storage-strategy)
6. [Parsing Pipeline](#6-parsing-pipeline)
7. [Query Patterns](#7-query-patterns)
8. [Incremental Updates](#8-incremental-updates)
9. [Multi-Language Support](#9-multi-language-support)
10. [Validation Integration](#10-validation-integration)
11. [CLI Interface](#11-cli-interface)
12. [Performance Considerations](#12-performance-considerations)
13. [Migration Path](#13-migration-path)
14. [Open Questions & Validation](#14-open-questions--validation)
15. [Implementation Phases](#15-implementation-phases)
16. [Appendices](#16-appendices)

---

## 1. Design Principles

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  PRINCIPLE 1: SOURCE CODE IS TRUTH                                          │
│  ─────────────────────────────────────                                      │
│  Everything in CodeGraph is derived from source code.                       │
│  Seeds can always be regenerated. No "database" to corrupt.                │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PRINCIPLE 2: NO DATA DUPLICATION                                           │
│  ────────────────────────────────                                           │
│  Query Parquet files directly. Don't copy into another database.            │
│  The seed files ARE the database.                                           │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PRINCIPLE 3: SINGLE TECHNOLOGY STACK                                       │
│  ─────────────────────────────────────                                      │
│  DuckDB + Parquet everywhere. No abstraction layers.                        │
│  Same query engine for analysis and presentation.                           │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PRINCIPLE 4: PACKAGE-LOCAL BY DEFAULT                                      │
│  ────────────────────────────────────                                       │
│  Each package owns its seeds. Federation is opt-in.                         │
│  Works offline, works without central infrastructure.                       │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PRINCIPLE 5: LLM-OPTIMIZED OUTPUT                                          │
│  ────────────────────────────────                                           │
│  Query results designed for AI consumption.                                 │
│  Context-rich, self-contained, promptable.                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Architecture Overview

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DEVELOPER LAPTOP                                  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                         REPOSITORIES                                   │ │
│  │                                                                        │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │ │
│  │  │   repo-api/     │  │  repo-web/      │  │  repo-mobile/   │        │ │
│  │  │                 │  │                 │  │                 │        │ │
│  │  │  packages/      │  │  apps/          │  │  packages/      │        │ │
│  │  │  ├── auth/      │  │  ├── web/       │  │  ├── app/       │        │ │
│  │  │  │   └─.devac/  │  │  │   └─.devac/  │  │  │   └─.devac/  │        │ │
│  │  │  │      └─seed/ │  │  │      └─seed/ │  │  │      └─seed/ │        │ │
│  │  │  └── core/      │  │  └── admin/     │  │  └── ui/        │        │ │
│  │  │      └─.devac/  │  │      └─.devac/  │  │      └─.devac/  │        │ │
│  │  │         └─seed/ │  │         └─seed/ │  │         └─seed/ │        │ │
│  │  │                 │  │                 │  │                 │        │ │
│  │  │  .devac/        │  │  .devac/        │  │  .devac/        │        │ │
│  │  │  └─manifest.json│  │  └─manifest.json│  │  └─manifest.json│        │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘        │ │
│  │           │                    │                    │                  │ │
│  │           └────────────────────┼────────────────────┘                  │ │
│  │                                │                                       │ │
│  │                                ▼                                       │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │ │
│  │  │                      CENTRAL HUB (Optional)                      │  │ │
│  │  │                                                                  │  │ │
│  │  │  ~/.devac/                                                       │  │ │
│  │  │  ├── central.duckdb    ← Lightweight: only computed edges        │  │ │
│  │  │  ├── config.json       ← Registered repos                        │  │ │
│  │  │  └── cache/            ← Query result cache (optional)           │  │ │
│  │  │                                                                  │  │ │
│  │  │  Queries Parquet files directly - no data copied!               │  │ │
│  │  └─────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                          QUERY ENGINE                                  │ │
│  │                                                                        │ │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐             │ │
│  │  │   DuckDB     │    │   CLI        │    │   MCP        │             │ │
│  │  │   Engine     │◄───│   Commands   │    │   Server     │             │ │
│  │  │              │    │              │    │              │             │ │
│  │  │  read_parquet│    │  devac query │    │  AI Agent    │             │ │
│  │  │  (glob)      │    │  devac find  │    │  Integration │             │ │
│  │  └──────────────┘    └──────────────┘    └──────────────┘             │ │
│  │                                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  SOURCE CODE                    ANALYSIS                  QUERY             │
│  ───────────                    ────────                  ─────             │
│                                                                             │
│  ┌──────────┐                  ┌──────────┐             ┌──────────┐       │
│  │  .ts     │                  │  DuckDB  │             │  DuckDB  │       │
│  │  .tsx    │   ───────────►   │  (mem)   │  ────────►  │  Engine  │       │
│  │  .py     │   Parse AST      │          │  Export     │          │       │
│  │  .cs     │                  │ INSERT   │  Parquet    │ SELECT   │       │
│  │  ...     │                  │ nodes    │             │ FROM     │       │
│  └──────────┘                  └──────────┘             │ read_pq()│       │
│                                     │                    └──────────┘       │
│                                     ▼                         │             │
│                               ┌──────────────┐               │             │
│                               │   .parquet   │               │             │
│                               │   files      │◄──────────────┘             │
│                               │              │  Direct query                │
│                               │  nodes/      │  No import!                  │
│                               │  edges/      │                              │
│                               │  refs/       │                              │
│                               └──────────────┘                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Three-Layer Federation Model

### 3.1 Layer Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  LAYER 3: CENTRAL HUB                                                       │
│  ────────────────────                                                       │
│                                                                             │
│  ~/.devac/central.duckdb                                                   │
│  │                                                                          │
│  │  Stores ONLY:                                                            │
│  │  • repo_registry (which repos are known)                                 │
│  │  • cross_repo_edges (computed import→export mappings)                   │
│  │  • cached_stats (optional aggregations)                                  │
│  │                                                                          │
│  │  Does NOT store nodes/edges - queries Parquet directly!                 │
│  │                                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LAYER 2: REPOSITORY MANIFEST                                               │
│  ────────────────────────────                                               │
│                                                                             │
│  repo/.devac/manifest.json                                                 │
│  │                                                                          │
│  │  {                                                                       │
│  │    "name": "repo-api",                                                   │
│  │    "packages": [                                                         │
│  │      { "path": "packages/auth", "seedPath": "packages/auth/.devac/seed" }│
│  │      { "path": "packages/core", "seedPath": "packages/core/.devac/seed" }│
│  │    ],                                                                    │
│  │    "lastAnalyzed": "2025-01-15T10:30:00Z"                               │
│  │  }                                                                       │
│  │                                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LAYER 1: PACKAGE SEEDS (Ground Truth)                                      │
│  ──────────────────────────────────────                                     │
│                                                                             │
│  packages/auth/.devac/                                                     │
│  │                                                                          │
│  │  meta.json                     ← Package metadata only (no file hashes) │
│  │                                                                          │
│  │  seed/                         ← Simple base/branch structure           │
│  │  ├── base/                     ← Full content for base branch (main)   │
│  │  │   ├── nodes.parquet        ← All nodes for this package             │
│  │  │   ├── edges.parquet        ← All edges for this package             │
│  │  │   └── external_refs.parquet ← All refs for this package             │
│  │  │                                                                       │
│  │  └── branch/                   ← Delta for current working branch       │
│  │      ├── nodes.parquet        ← Only changed/new/deleted files         │
│  │      ├── edges.parquet        ← Edges from changed files               │
│  │      └── external_refs.parquet ← Refs from changed files               │
│  │                                                                          │
│  Per-package with delta storage = minimal duplication!          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Layer Responsibilities

| Layer | Contains | Size | Updates |
|-------|----------|------|---------|
| **Package Seeds** | nodes, edges, external_refs | 1-50MB per package | Per-file incremental |
| **Repository Manifest** | Package index, config | <1KB | On package add/remove |
| **Central Hub** | Repo registry, computed edges | ~1MB total | On cross-repo query |

### 3.3 Why Per-Package-Per-Branch Partitioning?

> **Updated 2025-12-13:** Changed from per-file to per-package-per-branch based on research. See `devac-spec-v2.0-branch-partitioning-research.md` for detailed analysis.

The original v2.0 proposal used per-source-file partitioning. All reviewers flagged this as HIGH RISK due to file count explosion (3 files × N source files). The revised approach uses **per-package-per-branch partitioning** with content-hash-based skip optimization.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  PER-FILE APPROACH (v2.0 original - REJECTED)                              │
│  ────────────────────────────────────────────                               │
│                                                                             │
│  .devac/seed/nodes/                                                        │
│  ├── src_index_ts.parquet      ← 1 file per source file                   │
│  ├── src_auth_ts.parquet       ← For 5K source files = 15K Parquet files! │
│  └── src_utils_ts.parquet                                                  │
│                                                                             │
│  PROBLEMS:                                                                  │
│  • File count explosion (15K+ files for large packages)                    │
│  • DuckDB glob metadata overhead with 10K+ files                           │
│  • OS file handle limits                                                    │
│  • Query planning overhead                                                  │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PER-PACKAGE WITH DELTA STORAGE (v2.1 approach - ADOPTED)                  │
│  ─────────────────────────────────────────────────────────                  │
│                                                                             │
│  .devac/seed/                                                              │
│  ├── base/                     ← Full content for base branch (main)       │
│  │   ├── nodes.parquet         ← ALL nodes for package                     │
│  │   ├── edges.parquet         ← ALL edges for package                     │
│  │   └── external_refs.parquet                                             │
│  └── branch/                   ← Delta for current working branch          │
│      ├── nodes.parquet         ← Only changed/new/deleted files            │
│      ├── edges.parquet         ← Edges from changed files                  │
│      └── external_refs.parquet ← Refs from changed files                   │
│                                                                             │
│  FILE COUNT: 6 files max (3 base + 3 branch)                               │
│  vs. 3 × N source files = thousands of files                              │
│                                                                             │
│  Delta storage: Only changed files stored in branch/                        │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  INCREMENTAL UPDATES (Content Hash in Parquet)                              │
│  ─────────────────────────────────────────────                              │
│                                                                             │
│  file_content_hash stored as column in nodes.parquet:                      │
│  SELECT DISTINCT file_path, file_content_hash FROM nodes.parquet           │
│                                                                             │
│  UPDATE FLOW:                                                               │
│  1. Compute current file hashes (~20ms)                                    │
│  2. Query existing hashes from Parquet                                      │
│  3. IF no changes → SKIP (total: ~20-50ms)                                 │
│  4. IF changes → Parse only changed files, regenerate package Parquet     │
│                                                                             │
│  DELTA STORAGE for branches:                                               │
│  • base/ contains full package content                                     │
│  • branch/ contains only changed/new files (delta)                         │
│  • Deleted files marked with is_deleted=true in branch/                    │
│                                                                             │
│  Single file change: ~150-300ms (parse + merge + write)                    │
│  Batch changes (10 files): ~150-300ms (same as single - batch wins!)       │
│  No changes: ~20-50ms (hash check only)                                    │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  QUERY PATTERNS                                                             │
│  ──────────────                                                             │
│                                                                             │
│  Base branch only (most common):                                           │
│  SELECT * FROM read_parquet('.devac/seed/base/nodes.parquet')              │
│  → Single file read, fast                                                  │
│                                                                             │
│  Unified branch view (base + delta, excluding deleted):                    │
│  SELECT * FROM (                                                           │
│    SELECT * FROM read_parquet('.devac/seed/branch/nodes.parquet')          │
│    WHERE is_deleted = false                                                │
│    UNION ALL                                                               │
│    SELECT * FROM read_parquet('.devac/seed/base/nodes.parquet') base       │
│    WHERE NOT EXISTS (                                                      │
│      SELECT 1 FROM read_parquet('.devac/seed/branch/nodes.parquet') br     │
│      WHERE br.file_path = base.file_path                                   │
│    )                                                                       │
│  )                                                                         │
│  → Returns unified view of current branch state                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Data Model

### 4.1 Node Schema

```sql
-- nodes.parquet (per-package: .devac/seed/base/nodes.parquet or .devac/seed/branch/nodes.parquet)

CREATE TABLE nodes (
  -- Identity (v2.1 - branch NOT in entity_id)
  entity_id VARCHAR NOT NULL,        -- Global ID: "{repo}:{package}:{kind}:{scope_hash}"
  branch VARCHAR NOT NULL,           -- Branch name (e.g., "main", "feature-auth")
  
  -- File information
  file_path VARCHAR NOT NULL,        -- Path relative to package root
  file_content_hash VARCHAR NOT NULL, -- SHA-256 of source file content
  
  -- Delta storage support
  is_deleted BOOLEAN DEFAULT FALSE,  -- True = file deleted in this branch (delta marker)
  
  -- Scope information (used for entity_id generation)
  scoped_name VARCHAR,               -- "AuthService.login", "outer.inner", "fetchUser" (NULL if is_deleted)
  
  -- Classification
  kind VARCHAR NOT NULL,             -- Function, Class, Method, Variable, etc.
  name VARCHAR,                      -- Symbol name (nullable for anonymous)
  
  -- Location (informational, NOT part of entity_id)
  start_line INTEGER NOT NULL,
  start_column INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  end_column INTEGER NOT NULL,
  
  -- Language
  language VARCHAR NOT NULL,         -- typescript, python, csharp, etc.
  
  -- Export Info
  is_exported BOOLEAN DEFAULT FALSE,
  export_name VARCHAR,               -- Name if exported (may differ from name)
  export_kind VARCHAR,               -- "default" | "named" | null
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  properties JSON,                   -- Flexible properties (decorators, etc.)
  
  -- Composite primary key for storage uniqueness
  PRIMARY KEY (entity_id, branch)
);

-- Example entity_id formats (NO branch in ID):
-- "repo-api:packages/auth:function:abc123"
-- "repo-web:apps/main:class:def456"
-- "repo-api:packages/auth:method:ghi789"
```

### 4.2 Edge Schema

```sql
-- edges.parquet (per-package: .devac/seed/base/edges.parquet or .devac/seed/branch/edges.parquet)

CREATE TABLE edges (
  -- Identity
  id VARCHAR NOT NULL,               -- Unique edge ID
  branch VARCHAR NOT NULL,           -- Branch name (e.g., "main", "feature-auth")
  
  -- File information (for delta storage)
  file_path VARCHAR NOT NULL,        -- Source file path (for delta tracking)
  is_deleted BOOLEAN DEFAULT FALSE,  -- True = edge deleted in this branch (delta marker)
  
  -- Endpoints (entity_ids do NOT include branch)
  source_entity_id VARCHAR NOT NULL, -- From node: "{repo}:{pkg}:{kind}:{scope_hash}"
  target_entity_id VARCHAR NOT NULL, -- To node: "{repo}:{pkg}:{kind}:{scope_hash}"
  
  -- Classification
  edge_type VARCHAR NOT NULL,        -- CONTAINS, CALLS, IMPORTS, EXTENDS, etc.
  
  -- Resolution Status
  is_resolved BOOLEAN DEFAULT FALSE, -- Has target been resolved to actual node?
  resolved_at TIMESTAMP,
  
  -- Metadata
  properties JSON,                   -- Weight, annotations, etc.
  
  -- Composite primary key
  PRIMARY KEY (id, branch)
);

-- Edge Types (hierarchical):
-- Structural: CONTAINS, OWNS, HAS_PARAMETER, HAS_PROPERTY
-- Reference: CALLS, USES, REFERENCES
-- Type: EXTENDS, IMPLEMENTS, RETURNS_TYPE, PARAMETER_TYPE
-- Module: IMPORTS, EXPORTS, RE_EXPORTS

-- Note: Edges within a branch reference entities on the same branch.
-- Cross-branch edges are rare and can use optional target_branch column if needed.
```

### 4.3 External Reference Schema

```sql
-- external_refs.parquet (per-package: .devac/seed/base/external_refs.parquet or .devac/seed/branch/external_refs.parquet)

CREATE TABLE external_refs (
  -- Identity
  id VARCHAR NOT NULL,
  branch VARCHAR NOT NULL,           -- Branch name (e.g., "main", "feature-auth")
  
  -- Delta storage support
  is_deleted BOOLEAN DEFAULT FALSE,  -- True = ref deleted in this branch (delta marker)
  
  -- Reference Origin
  source_entity_id VARCHAR NOT NULL, -- Node making the reference (no branch in ID)
  source_file_path VARCHAR NOT NULL, -- File containing the import
  source_line INTEGER,               -- Line number of import statement
  
  -- Reference Target (unresolved)
  module_specifier VARCHAR NOT NULL, -- "@shared/schema", "react", "./utils"
  imported_symbol VARCHAR NOT NULL,  -- "User", "default", "*"
  import_kind VARCHAR NOT NULL,      -- "named", "default", "namespace", "side-effect"
  
  -- Resolution (populated by semantic pass)
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_entity_id VARCHAR,        -- Resolved target entity (no branch in ID)
  resolved_file_path VARCHAR,        -- Resolved target file
  resolved_package VARCHAR,          -- Package containing target
  is_internal BOOLEAN,               -- Same package? Same repo?
  
  -- Re-export tracking
  is_reexport BOOLEAN DEFAULT FALSE, -- Is this a re-export?
  export_alias VARCHAR,              -- Alias name if re-exported (e.g., "login" for "handleLogin as login")
  
  -- Classification
  is_type_only BOOLEAN DEFAULT FALSE, -- TypeScript "import type"
  
  -- Metadata
  properties JSON,
  
  -- Composite primary key
  PRIMARY KEY (id, branch)
);
```

### 4.4 Global Entity ID Format

> **Updated 2025-12-13:** Entity ID format revised based on lifecycle analysis. See `devac-spec-v2.0-entity-id-lifecycle-analysis.md` for detailed rationale.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ENTITY ID FORMAT (v2.1)                                                    │
│  ────────────────────────                                                   │
│                                                                             │
│  {repo}:{package_path}:{kind}:{scope_hash}                                 │
│                                                                             │
│  Where: scope_hash = sha256(filePath + scopedName + kind).slice(0,8)       │
│                                                                             │
│  IMPORTANT: Branch is NOT part of entity_id!                               │
│  Branch is used as a storage partition key only.                           │
│  Same code = same entity_id regardless of branch.                          │
│                                                                             │
│  Examples:                                                                  │
│  ─────────                                                                  │
│  repo-api:packages/auth:function:a1b2c3d4                                  │
│  repo-web:apps/main:class:e5f6g7h8                                         │
│  repo-mobile:packages/ui:component:i9j0k1l2                                │
│                                                                             │
│  Scoped Name (replaces line number for stability):                         │
│  ─────────────────────────────────────────────────                         │
│  • Top-level function: "handleLogin"                                       │
│  • Class method: "AuthService.login"                                       │
│  • Nested function: "processUser.validate"                                 │
│  • Arrow in variable: "fetchUser" (variable name)                          │
│  • Callback: "users.map.$callback" or "users.map.$arg0"                   │
│  • Array element: "callbacks.$0", "callbacks.$1"                           │
│  • Reassigned: "handler$0", "handler$1" (indexed)                         │
│  • Computed property: "Foo.[key]" (syntactic form)                        │
│                                                                             │
│  Why Scoped Names (not line numbers):                                       │
│  ────────────────────────────────────                                       │
│  • Code above function changes → entity_id STABLE                          │
│  • Merge/rebase shifts lines → entity_id STABLE                           │
│  • Same code on different branches → SAME entity_id                        │
│                                                                             │
│  Storage Uniqueness:                                                        │
│  ──────────────────                                                         │
│  Composite PRIMARY KEY (entity_id, branch) ensures uniqueness              │
│  in storage while allowing same entity across branches.                    │
│                                                                             │
│  Re-exports:                                                                │
│  ───────────                                                                │
│  Original definition is canonical. Re-exports create references            │
│  pointing to the canonical entity_id.                                      │
│                                                                             │
│  Decorators:                                                                │
│  ──────────                                                                 │
│  Do NOT affect entity identity. Stored as node properties.                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.5 Scoped Name Generation Rules

```typescript
// TypeScript/JavaScript scoped name generation

function generateScopedName(node: ASTNode, context: ParserContext): string {
  // 1. Named function/class at file level
  if (isTopLevel(node) && node.name) {
    return node.name;  // "handleLogin"
  }
  
  // 2. Class member
  if (isClassMember(node)) {
    return `${getClassName(node)}.${node.name}`;  // "AuthService.login"
  }
  
  // 3. Nested function
  if (isNestedFunction(node) && node.name) {
    return `${getParentScope(node)}.${node.name}`;  // "outer.inner"
  }
  
  // 4. Arrow function assigned to variable
  if (isArrowInVariable(node)) {
    const varName = getAssignmentTarget(node);
    const reassignIndex = getReassignmentIndex(node, varName);
    return reassignIndex > 0 ? `${varName}$${reassignIndex}` : varName;
  }
  
  // 5. Callback/argument
  if (isCallbackArgument(node)) {
    const callExpr = getParentCall(node);
    const argIndex = getArgumentIndex(node);
    return `${callExpr}.$arg${argIndex}`;  // "users.map.$arg0"
  }
  
  // 6. Array element
  if (isArrayElement(node)) {
    const arrayName = getArrayName(node);
    const index = getArrayIndex(node);
    return `${arrayName}.$${index}`;  // "callbacks.$0"
  }
  
  // 7. Computed property
  if (isComputedProperty(node)) {
    const className = getClassName(node);
    const keyExpr = getComputedKeyExpression(node);
    return `${className}.[${keyExpr}]`;  // "Foo.[key]"
  }
  
  // 8. IIFE
  if (isIIFE(node)) {
    const iifeIndex = getIIFEIndex(node, context);
    return `$iife_${iifeIndex}`;
  }
  
  // Fallback: use AST node index
  return `$anon_${getASTIndex(node)}`;
}

---

## 5. Storage Strategy

### 5.1 DuckDB Usage Patterns

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  PATTERN 1: ANALYSIS (Ephemeral In-Memory)                                  │
│  ──────────────────────────────────────────                                 │
│                                                                             │
│  const db = new duckdb.Database(':memory:');                               │
│                                                                             │
│  // Parse source file → insert nodes/edges                                  │
│  db.run('INSERT INTO nodes VALUES (...)');                                 │
│                                                                             │
│  // Export to Parquet                                                       │
│  db.run(`COPY nodes TO '${seedPath}/nodes/${fileHash}.parquet'`);          │
│                                                                             │
│  // Close - no persistent state                                             │
│  db.close();                                                                │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PATTERN 2: QUERY (Direct Parquet Read)                                     │
│  ──────────────────────────────────────                                     │
│                                                                             │
│  const db = new duckdb.Database(':memory:');                               │
│                                                                             │
│  // Query across all packages in a repo                                     │
│  const result = db.all(`                                                   │
│    SELECT * FROM read_parquet([                                            │
│      '${repo}/packages/*/.devac/seed/nodes/*.parquet'                      │
│    ])                                                                       │
│    WHERE kind = 'function' AND is_exported = true                          │
│  `);                                                                        │
│                                                                             │
│  // No import needed - Parquet files queried directly!                     │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PATTERN 3: CENTRAL HUB (Persistent for Computed Data)                      │
│  ─────────────────────────────────────────────────────                      │
│                                                                             │
│  const db = new duckdb.Database('~/.devac/central.duckdb');                │
│                                                                             │
│  // Only stores:                                                            │
│  // - repo_registry (paths to known repos)                                  │
│  // - cross_repo_edges (computed import→export mappings)                   │
│                                                                             │
│  // Raw nodes/edges still come from Parquet files                          │
│  db.run(`                                                                  │
│    SELECT r.source_entity_id, r.target_entity_id                           │
│    FROM cross_repo_edges r                                                  │
│    WHERE r.source_repo = 'repo-web'                                        │
│  `);                                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 File Structure

```
~/code/
├── repo-api/                           # Repository 1
│   ├── packages/
│   │   ├── auth/
│   │   │   ├── src/
│   │   │   │   ├── index.ts
│   │   │   │   ├── auth.ts
│   │   │   │   └── utils.ts
│   │   │   │
│   │   │   └── .devac/
│   │   │       ├── meta.json           # Package metadata only (no file hashes)
│   │   │       └── seed/
│   │   │           ├── base/           # Full content for base branch (main)
│   │   │           │   ├── nodes.parquet
│   │   │           │   ├── edges.parquet
│   │   │           │   └── external_refs.parquet
│   │   │           └── branch/         # Delta for current working branch
│   │   │               ├── nodes.parquet      # Only changed/new/deleted
│   │   │               ├── edges.parquet
│   │   │               └── external_refs.parquet
│   │   │
│   │   └── core/
│   │       └── .devac/seed/...
│   │
│   └── .devac/
│       └── manifest.json               # Repository manifest
│
├── repo-web/                           # Repository 2
│   └── ... (same structure)
│
└── ~/.devac/                           # User global (Central Hub)
    ├── central.duckdb                  # ~1MB - only computed data
    ├── config.json                     # User preferences
    └── repos.json                      # Registered repositories
```

### 5.3 Meta.json Format

> **Updated 2025-12-13:** File content hashes are now stored as a column in nodes.parquet (`file_content_hash`), not in meta.json. This provides a single source of truth and eliminates sync issues.

```json
{
  "schemaVersion": "2.1",
  "packagePath": "packages/auth",
  "baseBranch": "main",
  "currentBranch": "feature-auth",
  "baseAnalyzedAt": "2025-12-13T10:30:00Z",
  "branchAnalyzedAt": "2025-12-13T11:00:00Z",
  "stats": {
    "base": {
      "nodeCount": 150,
      "edgeCount": 200,
      "refCount": 75,
      "fileCount": 12
    },
    "branch": {
      "changedFiles": 2,
      "newFiles": 1,
      "deletedFiles": 0
    }
  }
}
```

**Key points:**
- **No fileHashes** - Content hashes are in `nodes.parquet` (`file_content_hash` column)
- **No branch_meta.json** - Deleted files tracked via `is_deleted` column in Parquet
- **Simplified metadata** - Only package-level stats and timestamps

### 5.4 Size Estimates

| Component | Typical Size | Notes |
|-----------|--------------|-------|
| Nodes Parquet (per file) | 1-50KB | Depends on file complexity |
| Edges Parquet (per file) | 0.5-20KB | Depends on relationships |
| External Refs (per file) | 0.1-10KB | Depends on imports |
| Package total | 1-50MB | ~1000 files |
| Repository total | 10-200MB | Multiple packages |
| Central Hub | ~1MB | Only computed edges |

**Compression:** Parquet with ZSTD compression provides ~10x reduction over JSON.

---

## 6. Parsing Pipeline

### 6.1 Two-Pass Architecture (Preserved from v1.x)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  PASS 1: STRUCTURAL (Per-File, Parallel)                                    │
│  ────────────────────────────────────────                                   │
│                                                                             │
│  Source File ─────► Language Parser ─────► DuckDB (mem) ─────► Parquet     │
│                                                                             │
│  • Fast: <50ms per file (TypeScript)                                        │
│  • Independent: No cross-file knowledge needed                              │
│  • Parallel: Can process multiple files simultaneously                      │
│  • Output: nodes/, edges/ (within-file), external_refs/ (unresolved)       │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PASS 2: SEMANTIC (Cross-File, Batched)                                     │
│  ──────────────────────────────────────                                     │
│                                                                             │
│  external_refs/ ─────► Resolution ─────► Update Parquet                    │
│                           │                                                 │
│                           ▼                                                 │
│                    Query other packages'                                    │
│                    exported symbols                                         │
│                                                                             │
│  • Deferred: Run after structural pass                                      │
│  • Batched: Process multiple files together                                 │
│  • Cross-file: Resolves imports to actual target nodes                     │
│  • Output: Updated external_refs/ with resolution info                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Structural Parser Interface

```typescript
// src/analyzer/structural-parser.ts

export interface StructuralParseResult {
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

export interface StructuralParser {
  parse(filePath: string): Promise<StructuralParseResult>;
  
  // Language detection
  supportsFile(filePath: string): boolean;
  getLanguage(filePath: string): string;
}
```

### 6.3 Language-Specific Parsers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  PARSER REGISTRY                                                            │
│  ───────────────                                                            │
│                                                                             │
│  ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐     │
│  │   TypeScript    │      │     Python      │      │      C#         │     │
│  │   JavaScript    │      │                 │      │                 │     │
│  │   TSX/JSX       │      │                 │      │                 │     │
│  ├─────────────────┤      ├─────────────────┤      ├─────────────────┤     │
│  │  ts-morph       │      │  Python AST     │      │  tree-sitter    │     │
│  │  (Babel fast)   │      │  subprocess     │      │  c-sharp        │     │
│  ├─────────────────┤      ├─────────────────┤      ├─────────────────┤     │
│  │  PRIORITY 1     │      │  PRIORITY 1     │      │  PRIORITY 2     │     │
│  │  Full support   │      │  Full support   │      │  Next phase     │     │
│  └─────────────────┘      └─────────────────┘      └─────────────────┘     │
│                                                                             │
│  ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐     │
│  │      Java       │      │       Go        │      │     C/C++       │     │
│  ├─────────────────┤      ├─────────────────┤      ├─────────────────┤     │
│  │  tree-sitter    │      │  tree-sitter    │      │  tree-sitter    │     │
│  │  java           │      │  go             │      │  c/cpp          │     │
│  ├─────────────────┤      ├─────────────────┤      ├─────────────────┤     │
│  │  PRIORITY 3     │      │  PRIORITY 3     │      │  PRIORITY 3     │     │
│  │  Future         │      │  Future         │      │  Future         │     │
│  └─────────────────┘      └─────────────────┘      └─────────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.4 Seed Writer

```typescript
// src/seed/seed-writer.ts

export interface SeedWriter {
  /**
   * Write parse results to Parquet files.
   * Uses DuckDB in-memory for buffering, exports to Parquet.
   */
  writeFile(
    seedPath: string,
    result: StructuralParseResult
  ): Promise<void>;
  
  /**
   * Delete seeds for a file (on file deletion).
   */
  deleteFile(seedPath: string, sourceFileHash: string): Promise<void>;
  
  /**
   * Update seeds for a file (delete + write).
   */
  updateFile(
    seedPath: string,
    result: StructuralParseResult
  ): Promise<void>;
}
```

---

## 7. Query Patterns

### 7.1 Package-Local Queries

```sql
-- Find all exported functions in a package (base branch)
SELECT name, file_path, start_line
FROM read_parquet('packages/auth/.devac/seed/base/nodes.parquet')
WHERE kind = 'function' AND is_exported = true
ORDER BY name;

-- Find all imports from a specific module (base branch)
SELECT source_file_path, imported_symbol, source_line
FROM read_parquet('packages/auth/.devac/seed/base/external_refs.parquet')
WHERE module_specifier LIKE '%react%'
ORDER BY source_file_path;

-- Unified view: current branch (base + delta, excluding deleted)
SELECT name, file_path, start_line
FROM (
  -- Branch delta (not deleted)
  SELECT * FROM read_parquet('packages/auth/.devac/seed/branch/nodes.parquet')
  WHERE is_deleted = false
  UNION ALL
  -- Base nodes not overridden in branch
  SELECT * FROM read_parquet('packages/auth/.devac/seed/base/nodes.parquet') base
  WHERE NOT EXISTS (
    SELECT 1 FROM read_parquet('packages/auth/.devac/seed/branch/nodes.parquet') br
    WHERE br.file_path = base.file_path
  )
)
WHERE kind = 'function' AND is_exported = true
ORDER BY name;
```

### 7.2 Repository-Wide Queries

```sql
-- Find all React components across all packages (base branches)
SELECT entity_id, name, file_path
FROM read_parquet('packages/*/.devac/seed/base/nodes.parquet')
WHERE kind = 'component'
ORDER BY name;

-- Cross-package import analysis (base branches)
SELECT 
  refs.source_file_path,
  refs.module_specifier,
  refs.imported_symbol,
  nodes.file_path as target_file
FROM read_parquet('packages/*/.devac/seed/base/external_refs.parquet') refs
LEFT JOIN read_parquet('packages/*/.devac/seed/base/nodes.parquet') nodes
  ON refs.resolved_entity_id = nodes.entity_id
WHERE refs.is_internal = true
ORDER BY refs.source_file_path;
```

### 7.3 Cross-Repository Queries (Federated)

```sql
-- Query across multiple repos (from central hub, base branches)
SELECT 
  entity_id,
  name,
  file_path,
  split_part(entity_id, ':', 1) as repo
FROM read_parquet([
  '/path/to/repo-api/packages/*/.devac/seed/base/nodes.parquet',
  '/path/to/repo-web/apps/*/.devac/seed/base/nodes.parquet',
  '/path/to/repo-mobile/packages/*/.devac/seed/base/nodes.parquet'
])
WHERE kind = 'function' AND name = 'handleLogin';

-- Find all consumers of a shared type (base branches)
SELECT 
  refs.source_file_path,
  refs.source_entity_id
FROM read_parquet([
  '*/packages/*/.devac/seed/base/external_refs.parquet'
]) refs
WHERE refs.module_specifier = '@shared/schema'
  AND refs.imported_symbol = 'User';
```

### 7.4 Graph Traversal (Recursive CTEs)

```sql
-- Call graph from entry point (up to 5 hops, base branches)
WITH RECURSIVE call_chain AS (
  -- Base: starting function
  SELECT 
    entity_id, 
    name, 
    file_path, 
    1 as depth,
    ARRAY[entity_id] as path
  FROM read_parquet('packages/*/.devac/seed/base/nodes.parquet')
  WHERE name = 'handleLogin'
  
  UNION ALL
  
  -- Recursive: follow CALLS edges
  SELECT 
    n.entity_id, 
    n.name, 
    n.file_path, 
    c.depth + 1,
    list_append(c.path, n.entity_id)
  FROM call_chain c
  JOIN read_parquet('packages/*/.devac/seed/base/edges.parquet') e 
    ON e.source_entity_id = c.entity_id
  JOIN read_parquet('packages/*/.devac/seed/base/nodes.parquet') n 
    ON e.target_entity_id = n.entity_id
  WHERE e.edge_type = 'CALLS'
    AND c.depth < 5
    AND NOT list_contains(c.path, n.entity_id)  -- Prevent cycles
)
SELECT * FROM call_chain ORDER BY depth, name;
```

### 7.5 LLM-Optimized Output

```typescript
// src/query/llm-formatter.ts

export interface LLMQueryResult {
  summary: string;           // Human-readable summary
  context: string;           // Markdown-formatted context
  entities: EntityInfo[];    // Structured entity list
  relationships: RelInfo[];  // Relevant relationships
  fileSnippets: Snippet[];   // Code excerpts
}

export function formatForLLM(
  query: string,
  results: QueryResult[]
): LLMQueryResult {
  // Generate LLM-friendly output with:
  // - Natural language summary
  // - Markdown code blocks
  // - File paths with line numbers
  // - Relationship context
}
```

---

## 8. Incremental Updates

> **Updated 2025-12-13:** Changed from per-file partition updates to content-hash-based skip with package-level regeneration.

### 8.1 Update Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  INCREMENTAL ANALYSIS WITH CONTENT HASHING                                 │
│  ──────────────────────────────────────────                                 │
│                                                                             │
│  Step 1: Compute current file hashes (~20ms)                               │
│  ───────────────────────────────────────────                                │
│  For each source file in package:                                          │
│    currentHash = sha256(fileContent)                                       │
│                                                                             │
│  Step 2: Compare with stored hashes (from Parquet)                         │
│  ─────────────────────────────────────────────────                          │
│  Query: SELECT DISTINCT file_path, file_content_hash FROM base/nodes.parquet│
│  changedFiles = files where currentHash != storedHash                      │
│  newFiles = files not in storedHashes                                      │
│  deletedFiles = storedHashes keys not in current files                     │
│                                                                             │
│  Step 3: Selective parsing                                                  │
│  ────────────────────────                                                   │
│  IF no changes detected:                                                    │
│    SKIP - no regeneration needed                                           │
│    Time: ~20-50ms total                                                    │
│  ELSE:                                                                      │
│    Parse ONLY changed/new files (~30-50ms per file)                        │
│    Keep unchanged nodes in memory or re-read                               │
│    Merge all nodes into package Parquet                                    │
│                                                                             │
│  Step 4: Write package Parquet files                                        │
│  ───────────────────────────────────                                        │
│  FOR BASE BRANCH: DuckDB (memory) → base/nodes.parquet (full)              │
│  FOR FEATURE BRANCH: DuckDB (memory) → branch/nodes.parquet (delta only)   │
│    - Include is_deleted=true markers for deleted files                     │
│  Time: ~50-100ms (depends on package size)                                 │
│                                                                             │
│  Step 5: Update meta.json (stats only)                                      │
│  ─────────────────────────────────────                                      │
│  Update node/edge counts and timestamps (no file hashes - they're in Parquet)                                     │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  TIMING SUMMARY                                                             │
│  ──────────────                                                             │
│                                                                             │
│  No changes:         ~20-50ms (hash check only)                            │
│  1 file changed:     ~150-300ms (parse 1, merge, write)                    │
│  10 files changed:   ~300-500ms (parse 10, merge, write)                   │
│  Full regeneration:  ~5-10s (parse all, write)                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 File Watcher Integration

```typescript
// src/watcher/file-watcher.ts

export interface FileWatcher {
  /**
   * Start watching a package for changes.
   */
  watch(packagePath: string): void;
  
  /**
   * Handle file change event.
   */
  onFileChange(event: FileChangeEvent): Promise<void>;
  
  /**
   * Stop watching.
   */
  stop(): void;
}

export interface FileChangeEvent {
  type: "add" | "change" | "unlink";
  filePath: string;
  timestamp: number;
}

// Implementation uses chokidar with debouncing
```

### 8.3 Rename Detection

```typescript
// src/watcher/rename-detector.ts

export interface RenameDetector {
  /**
   * Detect rename by correlating unlink + add events.
   * Uses configurable time window (default: 100ms).
   */
  detectRename(event: FileChangeEvent): RenameInfo | null;
}

export interface RenameInfo {
  type: "rename";
  oldPath: string;
  newPath: string;
}

// On rename: delete old partitions, create new partitions
// No need to update entity IDs - they're content-based
```

### 8.4 Delete Handling

```typescript
// On file deletion:
async function handleFileDelete(
  seedPath: string,
  deletedFile: string
): Promise<void> {
  const fileHash = hashFilePath(deletedFile);
  
  // Remove all partitions for this file
  await fs.unlink(`${seedPath}/nodes/${fileHash}.parquet`);
  await fs.unlink(`${seedPath}/edges/${fileHash}.parquet`);
  await fs.unlink(`${seedPath}/external_refs/${fileHash}.parquet`);
  
  // That's it! No graph cleanup needed.
  // Dangling references will resolve to null in queries.
}
```

---

## 9. Multi-Language Support

### 9.1 Language Priority

| Priority | Language | Parser | Status |
|----------|----------|--------|--------|
| **P1** | TypeScript/JavaScript | ts-morph + Babel | Port from v1.x |
| **P1** | Python | Python AST subprocess | Port from v1.x |
| **P2** | C# | tree-sitter-c-sharp | Next phase |
| **P3** | Java | tree-sitter-java | Future |
| **P3** | Go | tree-sitter-go | Future |
| **P3** | C/C++ | tree-sitter-c/cpp | Future |

### 9.2 Parser Interface Contract

All language parsers must produce the same output format:

```typescript
export interface LanguageParser {
  readonly language: string;
  readonly extensions: string[];
  
  parse(filePath: string): Promise<StructuralParseResult>;
  
  // Optional: language-specific resolution
  resolveImport?(
    importSpec: string,
    fromFile: string
  ): Promise<string | null>;
}
```

### 9.3 TypeScript/JavaScript Parser

```typescript
// src/parsers/typescript-parser.ts

// Fast path: Babel for structural parsing
// Full path: ts-morph for semantic resolution

export class TypeScriptParser implements LanguageParser {
  readonly language = "typescript";
  readonly extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  
  async parse(filePath: string): Promise<StructuralParseResult> {
    // Use Babel for fast structural parsing
    const ast = await babel.parseAsync(filePath);
    
    // Extract nodes, edges, external refs
    return {
      filePath,
      sourceFileHash: hashFilePath(filePath),
      nodes: extractNodes(ast),
      edges: extractEdges(ast),
      externalRefs: extractImports(ast),
      metadata: { ... }
    };
  }
  
  async resolveImport(
    importSpec: string,
    fromFile: string
  ): Promise<string | null> {
    // Use ts-morph for resolution (semantic pass)
    const project = await getTsMorphProject();
    return project.resolveModuleSpecifier(importSpec, fromFile);
  }
}
```

### 9.4 Python Parser

```typescript
// src/parsers/python-parser.ts

export class PythonParser implements LanguageParser {
  readonly language = "python";
  readonly extensions = [".py"];
  
  async parse(filePath: string): Promise<StructuralParseResult> {
    // Spawn Python subprocess to parse AST
    const result = await this.runPythonParser(filePath);
    
    return {
      filePath,
      sourceFileHash: hashFilePath(filePath),
      nodes: result.nodes,
      edges: result.edges,
      externalRefs: result.imports,
      metadata: { ... }
    };
  }
  
  private async runPythonParser(filePath: string): Promise<PythonParseResult> {
    // Use existing python_parser.py with JSON output
    const output = await exec(
      `python3 ${__dirname}/python_parser.py ${filePath}`,
      { timeout: 30000 }
    );
    return JSON.parse(output.stdout);
  }
}
```

---

## 10. Validation Integration

### 10.1 Affected Detection via CodeGraph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  SYMBOL-LEVEL AFFECTED DETECTION                                            │
│  ───────────────────────────────                                            │
│                                                                             │
│  Changed: shared-schema/src/types.ts (modified User type)                  │
│                                                                             │
│  Step 1: Identify changed exports                                           │
│  ─────────────────────────────────                                          │
│  Query new vs old nodes for the file                                        │
│  → Changed: [User], Unchanged: [Post, Comment]                             │
│                                                                             │
│  Step 2: Find importers of changed symbols                                  │
│  ────────────────────────────────────────                                   │
│  SELECT source_file_path                                                    │
│  FROM read_parquet('**/external_refs/*.parquet')                           │
│  WHERE module_specifier = '@shared/schema'                                 │
│    AND imported_symbol = 'User'                                            │
│                                                                             │
│  → Results:                                                                 │
│    frontend-web/src/components/UserCard.tsx                                │
│    frontend-web/src/pages/Profile.tsx                                      │
│    mobile-app/src/screens/ProfileScreen.tsx                                │
│    backend-api/src/controllers/UserController.ts                           │
│                                                                             │
│  Step 3: Run validators on ONLY affected files                             │
│  ─────────────────────────────────────────────                              │
│  typecheck frontend-web/src/components/UserCard.tsx                        │
│  typecheck frontend-web/src/pages/Profile.tsx                              │
│  ...                                                                        │
│                                                                             │
│  RESULT: Precise validation scope, not entire project                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Validation Modes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  QUICK MODE (on file save, <5s)                                            │
│  ──────────────────────────────                                             │
│                                                                             │
│  Scope: Changed files + direct importers (1 hop)                           │
│                                                                             │
│  Validators:                                                                │
│  • typecheck (tsc --noEmit on affected files)                              │
│  • lint (eslint on changed files only)                                     │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  FULL MODE (on commit/push, may take minutes)                              │
│  ────────────────────────────────────────────                               │
│                                                                             │
│  Scope: All transitively affected files (recursive)                        │
│                                                                             │
│  Validators:                                                                │
│  • typecheck (all affected)                                                │
│  • lint (all affected)                                                     │
│  • test (tests covering affected code)                                     │
│  • audit (if dependencies changed)                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 10.3 Issue Enrichment

```typescript
// src/validation/issue-enricher.ts

export interface EnrichedIssue {
  // Original issue
  file: string;
  line: number;
  message: string;
  severity: "error" | "warning";
  source: string;  // tsc, eslint, etc.
  
  // Enrichment from CodeGraph
  affectedSymbol?: string;
  callers?: string[];
  dependents?: string[];
  
  // LLM-ready prompt
  promptMarkdown: string;
}

export async function enrichIssue(
  issue: ValidationIssue,
  db: DuckDB
): Promise<EnrichedIssue> {
  // Query CodeGraph for context
  const node = await findNodeAtLocation(db, issue.file, issue.line);
  const callers = await findCallers(db, node?.entity_id);
  const dependents = await findDependents(db, issue.file);
  
  return {
    ...issue,
    affectedSymbol: node?.name,
    callers,
    dependents,
    promptMarkdown: generatePrompt(issue, node, callers, dependents)
  };
}
```

---

## 11. CLI Interface

### 11.1 Package Commands

```bash
# ─────────────────────────────────────────────────────────────────────────────
# PACKAGE ANALYSIS
# ─────────────────────────────────────────────────────────────────────────────

# Analyze current package → generate seed files
devac analyze

# Analyze specific package
devac analyze --package packages/auth

# Analyze all packages in repository
devac analyze --all

# Analyze only if source changed (check hash)
devac analyze --if-changed

# Force full reanalysis
devac analyze --force

# ─────────────────────────────────────────────────────────────────────────────
# WATCH MODE
# ─────────────────────────────────────────────────────────────────────────────

# Watch for changes and update seeds incrementally
devac watch

# Watch with validation
devac watch --validate

# Watch specific package
devac watch --package packages/auth
```

### 11.2 Query Commands

```bash
# ─────────────────────────────────────────────────────────────────────────────
# QUERIES
# ─────────────────────────────────────────────────────────────────────────────

# Run SQL query against seeds
devac query "SELECT * FROM read_parquet('**/.devac/seed/nodes/*.parquet') LIMIT 10"

# Find symbol by name
devac find handleLogin

# Find symbol with filters
devac find --kind function --exported handleLogin

# Show dependencies of a file
devac deps src/auth.ts

# Show reverse dependencies (who imports this?)
devac rdeps src/types.ts

# Show call graph from entry point
devac calls handleLogin --depth 3

# Export query results
devac query "..." --format json > results.json
devac query "..." --format csv > results.csv
```

### 11.3 Hub Commands

```bash
# ─────────────────────────────────────────────────────────────────────────────
# CENTRAL HUB (Multi-Repo)
# ─────────────────────────────────────────────────────────────────────────────

# Register current repository with hub
devac hub register

# Register another repository
devac hub register ~/code/other-repo

# List registered repositories
devac hub list

# Unregister repository
devac hub unregister repo-name

# Rebuild cross-repo edge cache
devac hub rebuild

# Query across all registered repos
devac hub query "SELECT * FROM ..."

# Show hub statistics
devac hub stats
```

### 11.4 Validation Commands

```bash
# ─────────────────────────────────────────────────────────────────────────────
# VALIDATION
# ─────────────────────────────────────────────────────────────────────────────

# Run quick validation (changed + direct importers)
devac validate --quick

# Run full validation (all transitively affected)
devac validate --full

# Show affected files without running validation
devac affected

# Show issues with CodeGraph enrichment
devac issues

# Show issues for specific file
devac issues --file src/auth.ts
```

---

## 12. Performance Considerations

### 12.1 Target Performance

> **Updated 2025-12-13:** Revised targets based on per-package-per-branch storage approach.

| Operation | Target | Notes |
|-----------|--------|-------|
| Hash check (no changes) | <50ms | File content hash comparison |
| Structural parse (TS) | <50ms | Per file, Babel-based |
| Structural parse (Python) | <200ms | Per file, subprocess |
| Package Parquet write | <100ms | All nodes/edges for package |
| **Single file change** | **<300ms** | Hash + parse + merge + write |
| **Batch changes (10 files)** | **<500ms** | Same as single (batch optimized) |
| Package query | <100ms | Single branch, hive partition pruning |
| Repo query (10 packages) | <200ms | Multiple package globs |
| Cross-repo query (3 repos) | <600ms | Federated globs |
| Cross-branch query | <150ms | Hive partitioning across branches |

### 12.2 Parquet Optimization

```typescript
// Parquet write options for optimal performance

const parquetOptions = {
  compression: "zstd",        // Best compression/speed ratio
  rowGroupSize: 10000,        // Smaller for per-file partitions
  statistics: true,           // Enable predicate pushdown
  dictionary: true,           // String dictionary encoding
};
```

### 12.3 Query Optimization

```sql
-- Use predicate pushdown (DuckDB automatically optimizes)
SELECT * FROM read_parquet('**/*.parquet')
WHERE kind = 'function'  -- Pushed down to Parquet reader
  AND is_exported = true;

-- Column projection (only read needed columns)
SELECT name, file_path, start_line
FROM read_parquet('**/*.parquet')
WHERE kind = 'function';

-- Partition pruning via source_file filter
SELECT * FROM read_parquet('**/nodes/*.parquet')
WHERE source_file = 'src/auth.ts';  -- Only reads matching partition
```

### 12.4 Caching Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  CACHING LEVELS                                                             │
│  ──────────────                                                             │
│                                                                             │
│  Level 1: DuckDB Connection Pool                                           │
│  ────────────────────────────────                                           │
│  • Reuse DuckDB connections                                                 │
│  • Warm Parquet file handles                                               │
│  • ~100ms → ~10ms for subsequent queries                                   │
│                                                                             │
│  Level 2: Query Result Cache (Optional)                                     │
│  ──────────────────────────────────────                                     │
│  • Cache expensive cross-repo queries                                       │
│  • Invalidate on seed file changes                                          │
│  • Store in central.duckdb as materialized views                           │
│                                                                             │
│  Level 3: File System Cache (OS-level)                                      │
│  ─────────────────────────────────────                                      │
│  • Parquet files cached by OS                                               │
│  • Hot files stay in memory                                                 │
│  • No application-level management needed                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 13. Migration Path

### 13.1 From v1.x (Neo4j-based)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  MIGRATION PHASES                                                           │
│  ────────────────                                                           │
│                                                                             │
│  Phase 1: Parallel Implementation                                           │
│  ─────────────────────────────────                                          │
│  • Implement v2.0 seed generation alongside existing code                  │
│  • No breaking changes to existing functionality                           │
│  • Validate output matches Neo4j data                                      │
│                                                                             │
│  Phase 2: Query Migration                                                   │
│  ────────────────────────                                                   │
│  • Implement DuckDB query engine                                           │
│  • Create compatibility layer for existing queries                         │
│  • Benchmark against Neo4j                                                 │
│                                                                             │
│  Phase 3: Deprecation                                                       │
│  ────────────────────                                                       │
│  • Switch default to v2.0                                                  │
│  • Mark Neo4j integration as deprecated                                    │
│  • Remove after validation period                                          │
│                                                                             │
│  NOTE: Since v1.11 was not implemented, migration is simpler.              │
│  We can start fresh with v2.0 architecture.                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 13.2 What to Keep from v1.x

| Component | Action | Notes |
|-----------|--------|-------|
| **Language Parsers** | **Keep** | Port TypeScript, Python parsers |
| **Entity ID Format** | **Adapt** | Add repo/package prefix |
| **Relationship Types** | **Keep** | Same edge types |
| **Test Fixtures** | **Keep** | Reuse for validation |
| Neo4j Client | Remove | Replaced by DuckDB |
| NodeIndexCache | Remove | No longer needed |
| StorageManager | Replace | New SeedWriter |
| XState Actors | Simplify | Simpler state machine |

---

## 14. Open Questions & Validation

### 14.1 Parquet File Count Performance

**Question:** Does DuckDB perform well with current chosen per repo per package base and branch?

**Hypothesis:** Yes, DuckDB handles file globs efficiently with parallel reading.

**Validation Approach:**

create the appropriate test

**Fallback:** we need to determine a better alternative (update spec after research).

### 14.2 Recursive CTE Depth

**Question:** How deep can recursive CTEs go efficiently in DuckDB?

**Hypothesis:** Efficient up to ~6 hops, degrades exponentially beyond.

**Validation Approach:**

```typescript
// tests/cte-depth-test.ts

describe("Recursive CTE Depth", () => {
  for (const depth of [2, 4, 6, 8, 10]) {
    test(`Call graph traversal to depth ${depth}`, async () => {
      // Generate graph with known structure
      // Run recursive CTE with varying depth
      // Measure time
    });
  }
});
```

**Mitigation:** Pre-compute transitive closure for common queries if needed.

### 14.3 Python Subprocess Overhead

**Question:** Can we reduce Python parser latency from ~200-500ms?

**Options:**
1. Keep subprocess (current, ~200-500ms)
2. Long-running Python process with RPC (~50-100ms)
3. WASM Python parser (~100-200ms)
4. tree-sitter-python for structural, Python for semantic (~50ms structural)

**Decision:** Defer to implementation. Start with subprocess, optimize if needed.

### 14.4 Cross-Repo Edge Staleness

**Question:** How to handle stale cross-repo edges when a dependency repo changes?

**Options:**
1. **On-demand resolution:** Resolve at query time (slower queries)
2. **Background rebuild:** Periodic rebuild of cross-repo edges
3. **Event-based:** Watch all registered repos, rebuild on change
4. **Manual:** User triggers `devac hub rebuild`

**Recommendation:** Start with manual + background option. Add event-based later.

---

## 15. Implementation Phases

### 15.1 Phase Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  PHASE 1: FOUNDATION (Weeks 1-3)                                           │
│  ─────────────────────────────────                                          │
│                                                                             │
│  • DuckDB integration setup                                                 │
│  • Parquet read/write utilities                                             │
│  • Seed file structure implementation                                       │
│  • Port TypeScript parser                                                   │
│  • Basic CLI (analyze, query)                                              │
│  • Performance validation tests                                             │
│                                                                             │
│  Deliverable: Can analyze TS package → query seeds                         │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PHASE 2: INCREMENTAL (Weeks 4-5)                                          │
│  ────────────────────────────────                                           │
│                                                                             │
│  • File watcher integration                                                 │
│  • Per-file partition updates                                               │
│  • Rename/delete handling                                                   │
│  • Watch mode CLI                                                           │
│  • Validate <100ms update target                                           │
│                                                                             │
│  Deliverable: Real-time seed updates on file changes                       │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PHASE 3: PYTHON SUPPORT (Week 6)                                          │
│  ─────────────────────────────────                                          │
│                                                                             │
│  • Port Python parser                                                       │
│  • Python-specific edge types                                               │
│  • Cross-language import resolution                                         │
│  • Test with mixed TS/Python packages                                       │
│                                                                             │
│  Deliverable: Multi-language package analysis                              │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PHASE 4: FEDERATION (Weeks 7-8)                                           │
│  ───────────────────────────────                                            │
│                                                                             │
│  • Repository manifest generation                                           │
│  • Central hub implementation                                               │
│  • Cross-repo queries                                                       │
│  • Hub CLI commands                                                         │
│  • Multi-repo affected detection                                           │
│                                                                             │
│  Deliverable: Query across multiple repositories                           │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PHASE 5: VALIDATION INTEGRATION (Weeks 9-10)                              │
│  ────────────────────────────────────────────                               │
│                                                                             │
│  • Affected detection via CodeGraph                                        │
│  • Issue enrichment                                                         │
│  • Quick/full validation modes                                              │
│  • MCP server integration                                                   │
│                                                                             │
│  Deliverable: Symbol-level affected validation                             │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PHASE 6: C# SUPPORT (Weeks 11-12)                                         │
│  ─────────────────────────────────                                          │
│                                                                             │
│  • Port C# parser (tree-sitter)                                            │
│  • C#-specific edge types                                                   │
│  • .NET project file parsing                                               │
│  • Cross-language reference resolution                                      │
│                                                                             │
│  Deliverable: Three-language support (TS, Python, C#)                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 15.2 Phase 1 Detailed Tasks

| Task | Description | Estimate |
|------|-------------|----------|
| DuckDB Node.js setup | Install duckdb-async, configure | 1 day |
| Parquet writer | DuckDB in-memory → Parquet export | 2 days |
| Seed directory structure | Create/manage .devac/seed/ | 1 day |
| Port TS parser | Adapt structural-parser.ts for new format | 3 days |
| Entity ID generation | Implement content-hash IDs with repo prefix | 1 day |
| Basic CLI | analyze, query commands | 2 days |
| Performance tests | Parquet scale validation | 2 days |
| Integration tests | End-to-end analyze → query | 2 days |
| **Total Phase 1** | | **14 days** |

### 15.3 Success Criteria

| Phase | Success Criteria |
|-------|------------------|
| 1 | Can analyze TS package, query with DuckDB, <50ms per file |
| 2 | <100ms incremental update on file change |
| 3 | Python files produce same query format as TS |
| 4 | Query returns results from 3+ registered repos |
| 5 | Validation runs only on symbol-level affected files |
| 6 | C# projects analyzed with cross-language refs |

---

## 16. Appendices

### 16.1 Glossary

| Term | Definition |
|------|------------|
| **Seed** | Parquet files containing analyzed code structure |
| **Package** | Buildable/testable unit (npm package, Python module, .NET project) |
| **Repository** | Git repository containing one or more packages |
| **Hub** | Central DuckDB database tracking registered repos |
| **Entity ID** | Globally unique identifier for a code element |
| **Partition** | Individual Parquet file for a source file |
| **Federation** | Querying across multiple independent repos |

### 16.2 Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Query Engine | DuckDB | Fast analytics, native Parquet, no server |
| Storage Format | Parquet | Columnar, compressed, queryable |
| TS Parsing | ts-morph + Babel | Type-aware, fast structural pass |
| Python Parsing | Python AST | Native, accurate, mature |
| C# Parsing | tree-sitter | Fast, good C# support |
| File Watching | chokidar | Mature, cross-platform |
| CLI | Commander.js | Standard Node.js CLI framework |

### 16.3 Comparison to v1.11

| Aspect | v1.11 | v2.0 |
|--------|-------|------|
| Database | Neo4j | DuckDB + Parquet |
| Cache | NodeIndexCache (memory) | None needed |
| Sync | Complex transaction logic | File replacement |
| Update time | ~200-500ms target | ~50-100ms target |
| Multi-repo | Not designed | Native federation |
| Data location | Central DB | Per-package files |
| Crash recovery | Transaction log | Regenerate from source |

### 16.4 References

- [DuckDB Documentation](https://duckdb.org/docs/)
- [DuckDB Parquet Support](https://duckdb.org/docs/data/parquet/overview)
- [Apache Parquet Format](https://parquet.apache.org/docs/)
- [DuckDB Node.js API](https://duckdb.org/docs/api/nodejs/overview)
- [ts-morph Documentation](https://ts-morph.com/)
- [Chokidar File Watcher](https://github.com/paulmillr/chokidar)

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 2.0 | 2025-12-12 | DevAC Team | Initial federated architecture spec |
| 2.1 | 2025-12-13 | DevAC Team | Entity ID revision: scoped names instead of line numbers; branch NOT in entity_id; per-package-per-branch storage; content-hash-based incremental updates |

---

## Related Documents

- `devac-spec-v2.0-branch-partitioning-research.md` - Detailed analysis of branch-based partitioning approach
- `devac-spec-v2.0-entity-id-lifecycle-analysis.md` - Comprehensive entity ID behavior analysis across all scenarios
- `devac-spec-v2.0-review-recap.md` - Consolidated review feedback and decisions

---

*End of Specification*
