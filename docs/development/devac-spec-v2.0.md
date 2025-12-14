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

> **Updated 2025-12-13:** Ultra-minimal format approved. All other data is derivable from Parquet files or filesystem.

```json
{
  "schemaVersion": "2.1"
}
```

**Design principle:** Single source of truth - all data lives in Parquet files.

| Removed Field | Alternative |
|---------------|-------------|
| packagePath | Derive from `.devac` folder's parent directory |
| baseBranch | Implicit in `base/` directory structure |
| currentBranch | Query git: `git rev-parse --abbrev-ref HEAD` |
| analyzedAt | Use file mtime of Parquet files |
| stats.* | Query Parquet: `SELECT COUNT(*) FROM nodes.parquet` |
| fileHashes | Stored in `file_content_hash` column in nodes.parquet |

**Benefits:**
- **Zero sync risk** - Nothing can become stale
- **Minimum maintenance** - One field, written once
- **DuckDB is fast** - Stats queries are ~10-50ms

**Querying stats from Parquet:**
```sql
-- Get node/edge/ref counts
SELECT 
  (SELECT COUNT(*) FROM read_parquet('base/nodes.parquet')) as nodeCount,
  (SELECT COUNT(*) FROM read_parquet('base/edges.parquet')) as edgeCount,
  (SELECT COUNT(*) FROM read_parquet('base/external_refs.parquet')) as refCount;

-- Get file count
SELECT COUNT(DISTINCT file_path) FROM read_parquet('base/nodes.parquet');
```

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

### 5.5 Schema Evolution

Managing Parquet schema changes across versions requires careful planning to avoid breaking existing seeds.

#### Version Tracking

The `meta.json` file tracks the seed schema version:

```json
{
  "schemaVersion": "2.1"
}
```

Version format: `MAJOR.MINOR`
- **MAJOR:** Breaking changes requiring full regeneration
- **MINOR:** Additive changes, backward compatible

#### Compatibility Policy

| Change Type | Example | Compatibility | Action Required |
|-------------|---------|---------------|-----------------|
| Add nullable column | Add `documentation` to nodes | Minor bump | None - old seeds work |
| Add required column | Add `package_id` NOT NULL | Major bump | Regenerate all seeds |
| Remove column | Remove deprecated field | Major bump | Regenerate all seeds |
| Rename column | `file_path` → `source_path` | Major bump | Regenerate all seeds |
| Change type | `line` INT → STRING | Major bump | Regenerate all seeds |

#### Adding Columns

New columns MUST be nullable to maintain backward compatibility:

```sql
-- DuckDB handles missing columns gracefully
-- Old seeds without 'documentation' column return NULL
SELECT entity_id, name, documentation
FROM read_parquet('nodes.parquet');
-- documentation = NULL for old seeds
```

#### Migration Strategy

**On schema version mismatch:**

```typescript
async function checkSchemaVersion(seedPath: string): Promise<void> {
  const meta = await readMeta(seedPath);
  const currentVersion = "2.1";
  
  if (meta.schemaVersion !== currentVersion) {
    const [seedMajor] = meta.schemaVersion.split(".");
    const [currentMajor] = currentVersion.split(".");
    
    if (seedMajor !== currentMajor) {
      // Major version mismatch - must regenerate
      console.warn(
        `Schema version mismatch: seed=${meta.schemaVersion}, ` +
        `current=${currentVersion}. Run 'devac analyze --force' to regenerate.`
      );
      throw new SchemaVersionError(meta.schemaVersion, currentVersion);
    }
    
    // Minor version difference - compatible, just log
    console.debug(`Schema minor version difference, continuing...`);
  }
}
```

#### Design Principles

1. **Regenerate over migrate:** Seeds can always be regenerated from source code. Complex migration scripts are unnecessary.

2. **Warn, don't fail silently:** On version mismatch, warn the user and suggest `--force` regeneration.

3. **Additive by default:** New features should add nullable columns rather than modify existing ones.

4. **Document changes:** Schema changes must be documented in the spec's Document History section.

### 5.6 DuckDB Session Lifecycle

DuckDB connection management differs between CLI mode (ephemeral) and watch mode (persistent). Proper lifecycle management ensures performance and reliability.

#### Connection Strategies

| Mode | Strategy | Rationale |
|------|----------|-----------|
| **CLI (analyze, query)** | Single ephemeral connection | Simple, no resource leak risk |
| **Watch mode** | Pooled connections, kept warm | Avoid 100-200ms cold-start per file |
| **MCP server** | Long-lived pool, connection reuse | Handle concurrent queries efficiently |

#### Connection Pool Interface

```typescript
interface DuckDBPool {
  /**
   * Get a connection from the pool.
   * Creates new connection if pool is empty.
   */
  acquire(): Promise<DuckDBConnection>;
  
  /**
   * Return connection to pool for reuse.
   */
  release(conn: DuckDBConnection): void;
  
  /**
   * Close all connections and clean up.
   */
  shutdown(): Promise<void>;
  
  /**
   * Get pool statistics for monitoring.
   */
  stats(): PoolStats;
}

interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
}

// Pool configuration
interface PoolConfig {
  maxConnections: number;      // Default: 4
  minConnections: number;      // Default: 1 (keep 1 warm)
  idleTimeoutMs: number;       // Default: 60000 (1 minute)
  acquireTimeoutMs: number;    // Default: 30000 (30 seconds)
}
```

#### Memory Management

```typescript
// DuckDB memory configuration
const duckdbConfig = {
  // Memory limit per connection (prevent OOM)
  memory_limit: process.env.DEVAC_DUCKDB_MEMORY || "512MB",
  
  // Temp directory for spilling (large operations)
  temp_directory: path.join(os.tmpdir(), "devac-duckdb"),
  
  // Thread count for parallel operations
  threads: Math.max(1, os.cpus().length - 1),
};
```

**Memory limits by operation:**

| Operation | Typical Usage | Max Recommended |
|-----------|---------------|-----------------|
| Single file analysis | 50-100MB | 256MB |
| Package analysis | 100-300MB | 512MB |
| Repo-wide query | 200-500MB | 1GB |
| Cross-repo query | 300-800MB | 2GB |

#### Error Recovery

DuckDB can enter an unrecoverable "fatal mode" on certain errors. The system must handle this gracefully.

```typescript
async function executeWithRecovery<T>(
  pool: DuckDBPool,
  operation: (conn: DuckDBConnection) => Promise<T>
): Promise<T> {
  const conn = await pool.acquire();
  
  try {
    return await operation(conn);
  } catch (error) {
    if (isFatalError(error)) {
      // Connection is unusable - do NOT return to pool
      console.warn("DuckDB fatal error, creating new connection", error);
      await conn.close().catch(() => {}); // Best-effort close
      
      // Get fresh connection and retry once
      const freshConn = await pool.acquire();
      try {
        return await operation(freshConn);
      } finally {
        pool.release(freshConn);
      }
    }
    throw error;
  } finally {
    // Only release if not fatal
    if (!isFatalError(error)) {
      pool.release(conn);
    }
  }
}

function isFatalError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("FATAL") ||
           error.message.includes("database has been invalidated");
  }
  return false;
}
```

**Fatal error scenarios:**
- fsync failure during Parquet write
- Out of memory during large operation
- Corrupted database file
- Connection lost during transaction

**Recovery strategy:**
1. Log the fatal error with full context
2. Close the corrupted connection (don't repool)
3. Create fresh connection
4. Retry operation once
5. If retry fails, bubble up error to caller

#### Session Warmth

Keep connections warm in watch mode to avoid cold-start latency:

```typescript
class WarmConnectionManager {
  private pool: DuckDBPool;
  private warmupInterval: NodeJS.Timeout | null = null;
  
  async startWarmup(): Promise<void> {
    // Initial warmup - acquire and release to establish connection
    const conn = await this.pool.acquire();
    await conn.run("SELECT 1"); // Ensure connection is live
    this.pool.release(conn);
    
    // Periodic warmup to keep connection alive
    this.warmupInterval = setInterval(async () => {
      const conn = await this.pool.acquire();
      await conn.run("SELECT 1");
      this.pool.release(conn);
    }, 30000); // Every 30 seconds
  }
  
  stopWarmup(): void {
    if (this.warmupInterval) {
      clearInterval(this.warmupInterval);
      this.warmupInterval = null;
    }
  }
}
```

#### Environment Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DEVAC_DUCKDB_MEMORY` | `512MB` | Memory limit per connection |
| `DEVAC_DUCKDB_THREADS` | `CPU count - 1` | Parallel threads |
| `DEVAC_DUCKDB_POOL_SIZE` | `4` | Max pool connections |
| `DEVAC_DUCKDB_TEMP_DIR` | System temp | Spill directory |

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

### 6.2.1 Language Router

The Language Router maps file extensions to appropriate parsers and provides the list of supported extensions for file watching.

```typescript
// src/analyzer/language-router.ts

export interface LanguageRouter {
  /**
   * Get the parser for a given file path.
   * Returns null if file type is not supported.
   */
  getParser(filePath: string): LanguageParser | null;
  
  /**
   * Get all supported file extensions for file watcher configuration.
   */
  getSupportedExtensions(): string[];
  
  /**
   * Register a parser for specific extensions.
   */
  registerParser(parser: LanguageParser): void;
}

// Default implementation
export function createLanguageRouter(
  parsers: LanguageParser[]
): LanguageRouter {
  const extensionMap = new Map<string, LanguageParser>();
  
  for (const parser of parsers) {
    for (const ext of parser.extensions) {
      extensionMap.set(ext, parser);
    }
  }
  
  return {
    getParser(filePath: string) {
      const ext = path.extname(filePath).toLowerCase();
      return extensionMap.get(ext) ?? null;
    },
    
    getSupportedExtensions() {
      return Array.from(extensionMap.keys());
    },
    
    registerParser(parser: LanguageParser) {
      for (const ext of parser.extensions) {
        extensionMap.set(ext, parser);
      }
    }
  };
}

// Usage with file watcher
const router = createLanguageRouter([
  new TypeScriptParser(),
  new PythonParser(),
]);

const watcher = chokidar.watch(packagePath, {
  ignored: /node_modules/,
  // Only watch supported file types
  // Uses glob patterns from router.getSupportedExtensions()
});
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
   * 
   * MUST use atomic write pattern:
   * 1. Write to temp file (.tmp suffix)
   * 2. Atomic rename to final path
   * 3. Clean up temp file on failure
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

/**
 * Atomic write implementation pattern.
 * Prevents corruption from interrupted writes.
 * 
 * WHY THIS PATTERN:
 * - Parquet files cannot be appended to (metadata is at end of file)
 * - DuckDB's COPY TO writes directly to target path (not atomic)
 * - DuckDB enters "fatal mode" if writes fail mid-stream
 * - fs.rename() is atomic on POSIX systems (wraps rename(2) syscall)
 * 
 * DURABILITY NOTE:
 * - After rename, we fsync the directory to ensure the rename is durable
 * - Without fsync, on power failure the old file may reappear
 * - This follows POSIX guidelines for crash-safe file replacement
 * 
 * REFERENCES:
 * - Node.js fs module (POSIX rename): https://nodejs.org/api/fs.html
 * - npm write-file-atomic (industry standard): https://github.com/npm/write-file-atomic
 * - DuckDB fatal mode on write failure: https://github.com/duckdb/duckdb/issues/12335
 * - DuckDB parquet append limitation: https://github.com/duckdb/duckdb/discussions/7547
 * - fsync directory requirement: https://github.com/npm/write-file-atomic/issues/64
 * 
 * ALTERNATIVES CONSIDERED:
 * - Delta Lake: Overkill for single-file writes, adds complexity
 * - Apache Iceberg: Designed for multi-TB distributed datasets
 * - DuckDB ATTACH: Creates database files, not portable Parquet
 * 
 * For DevAC's use case (small per-file Parquet partitions, single writer
 * per package), temp + rename + fsync is the correct and simplest choice.
 */
async function writeParquetAtomic(
  db: Database,
  finalPath: string,
  tableName: string
): Promise<void> {
  const tempPath = `${finalPath}.tmp`;
  const dir = path.dirname(finalPath);
  
  try {
    // Step 1: Write to temp file
    // DuckDB COPY TO is not atomic - writes directly to path
    await db.run(`COPY ${tableName} TO '${tempPath}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
    
    // Step 2: Atomic rename (POSIX rename(2) is atomic within same filesystem)
    // If this succeeds, the file atomically appears at finalPath
    // If interrupted, tempPath may remain but finalPath is untouched
    await fs.rename(tempPath, finalPath);
    
    // Step 3: Fsync directory for durability
    // Ensures rename is persisted to disk even on power failure
    // Without this, filesystem journal replay might restore old state
    const dirHandle = await fs.open(dir, "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch (error) {
    // Clean up temp file on any failure
    // Use catch(() => {}) since temp file may not exist if COPY failed early
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}
```

### 6.5 Semantic Resolution (Phase 4)

The semantic resolution pass resolves external references to their target entities. This happens after the structural pass and requires cross-package/cross-repo knowledge.

#### Resolution Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  SEMANTIC RESOLUTION PIPELINE                                               │
│  ────────────────────────────                                               │
│                                                                             │
│  1. Read external_refs.parquet (unresolved imports)                        │
│     │                                                                       │
│     ▼                                                                       │
│  2. For each unresolved ref:                                                │
│     ├── Query local package nodes (same package exports)                   │
│     ├── Query sibling packages (monorepo cross-package)                    │
│     └── Query central hub (cross-repo dependencies)                        │
│     │                                                                       │
│     ▼                                                                       │
│  3. Update external_refs with resolution results                           │
│     ├── is_resolved = true/false                                           │
│     └── target_entity_id = matched entity (if found)                       │
│     │                                                                       │
│     ▼                                                                       │
│  4. Write updated external_refs.parquet                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Resolution Algorithm

```typescript
interface SemanticResolver {
  /**
   * Resolve all external references in a package.
   * Called after structural pass completes.
   */
  resolvePackage(packagePath: string): Promise<ResolutionResult>;
}

interface ResolutionResult {
  total: number;
  resolved: number;
  unresolved: number;
  errors: ResolutionError[];
}

async function resolveExternalRefs(
  packagePath: string,
  hub: CentralHub | null
): Promise<ResolutionResult> {
  const seedPath = path.join(packagePath, ".devac/seed/base");
  const refs = await readExternalRefs(seedPath);
  
  let resolved = 0;
  let unresolved = 0;
  const errors: ResolutionError[] = [];
  
  for (const ref of refs) {
    if (ref.is_resolved) {
      resolved++;
      continue;
    }
    
    try {
      // Step 1: Try local package
      const localMatch = await findExportInPackage(
        seedPath,
        ref.module_specifier,
        ref.imported_symbol
      );
      
      if (localMatch) {
        ref.is_resolved = true;
        ref.target_entity_id = localMatch.entity_id;
        resolved++;
        continue;
      }
      
      // Step 2: Try sibling packages (if monorepo)
      const siblingMatch = await findExportInSiblings(
        packagePath,
        ref.module_specifier,
        ref.imported_symbol
      );
      
      if (siblingMatch) {
        ref.is_resolved = true;
        ref.target_entity_id = siblingMatch.entity_id;
        resolved++;
        continue;
      }
      
      // Step 3: Try central hub (cross-repo)
      if (hub) {
        const hubMatch = await hub.findExport(
          ref.module_specifier,
          ref.imported_symbol
        );
        
        if (hubMatch) {
          ref.is_resolved = true;
          ref.target_entity_id = hubMatch.entity_id;
          resolved++;
          continue;
        }
      }
      
      // Not found anywhere
      unresolved++;
      
    } catch (error) {
      errors.push({
        ref,
        error: error instanceof Error ? error.message : String(error)
      });
      unresolved++;
    }
  }
  
  // Write updated refs back
  await writeExternalRefs(seedPath, refs);
  
  return { total: refs.length, resolved, unresolved, errors };
}
```

#### Cross-Package Resolution

For monorepo cross-package imports (e.g., `@myorg/shared`):

```typescript
async function findExportInSiblings(
  packagePath: string,
  moduleSpecifier: string,
  importedSymbol: string
): Promise<NodeMatch | null> {
  // Parse module specifier to find target package
  const targetPackage = resolvePackagePath(packagePath, moduleSpecifier);
  
  if (!targetPackage) {
    return null; // External dependency, not in monorepo
  }
  
  const targetSeedPath = path.join(targetPackage, ".devac/seed/base");
  
  // Query target package's exports
  const result = await db.all(`
    SELECT entity_id, name, file_path
    FROM read_parquet('${targetSeedPath}/nodes.parquet')
    WHERE name = ?
      AND is_exported = true
  `, [importedSymbol]);
  
  return result[0] || null;
}
```

#### Error Handling

| Scenario | Behavior | Logged |
|----------|----------|--------|
| Import not found | `is_resolved = false`, continue | Debug |
| Package not in hub | Skip hub lookup, try alternatives | Debug |
| Circular dependency | Detect via visited set, skip | Warning |
| Parse error in target | Keep unresolved, log error | Error |
| Hub unavailable | Skip cross-repo, resolve local only | Warning |

#### Batch Resolution Strategy

For performance, resolve in batches grouped by target package:

```typescript
async function resolveBatch(refs: ExternalRef[]): Promise<void> {
  // Group refs by module specifier
  const byModule = groupBy(refs, r => r.module_specifier);
  
  // Resolve each module's refs together (single query per module)
  for (const [moduleSpec, moduleRefs] of Object.entries(byModule)) {
    const symbols = moduleRefs.map(r => r.imported_symbol);
    const matches = await findExportsInModule(moduleSpec, symbols);
    
    for (const ref of moduleRefs) {
      const match = matches.get(ref.imported_symbol);
      if (match) {
        ref.is_resolved = true;
        ref.target_entity_id = match.entity_id;
      }
    }
  }
}
```

#### Phase Dependency

Semantic resolution is implemented in **Phase 4 (Federation)** because:
- Requires cross-package queries (Phase 2 prerequisite)
- Requires central hub for cross-repo (Phase 4 core)
- Python support should be complete (Phase 3)

Phase 1-3 operate with `is_resolved = false` for all external refs. This is acceptable because:
- Structural information (nodes, edges) is complete
- Queries work without resolution
- Validation can still detect type errors via TypeScript

### 6.6 Analysis Orchestrator

The AnalysisOrchestrator coordinates the analysis pipeline, connecting FileWatcher events to the parsing and writing subsystems. It provides the central control flow for both CLI mode and watch mode.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ANALYSIS ORCHESTRATOR - Control Flow                                       │
│  ────────────────────────────────────                                       │
│                                                                             │
│  CLI Mode (devac analyze):                                                  │
│  ┌──────────────┐                                                           │
│  │   CLI        │                                                           │
│  │   invoke     │                                                           │
│  └──────┬───────┘                                                           │
│         ▼                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │   File       │ → │   Language   │ → │   Parser     │                   │
│  │   Scanner    │    │   Router     │    │   (batched)  │                   │
│  └──────────────┘    └──────────────┘    └──────┬───────┘                   │
│                                                  ▼                          │
│                                           ┌──────────────┐                   │
│                                           │   Seed       │                   │
│                                           │   Writer     │                   │
│                                           └──────────────┘                   │
│                                                                             │
│  Watch Mode (devac watch):                                                  │
│  ┌──────────────┐                                                           │
│  │   File       │ (chokidar events)                                         │
│  │   Watcher    │─────┐                                                     │
│  └──────────────┘     │                                                     │
│                       ▼                                                     │
│              ┌──────────────────┐                                           │
│              │   Debounce       │ (100ms settle)                            │
│              │   Buffer         │                                           │
│              └────────┬─────────┘                                           │
│                       ▼                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │   Batch      │ → │   Language   │ → │   Parser     │                   │
│  │   Collector  │    │   Router     │    │   (parallel) │                   │
│  └──────────────┘    └──────────────┘    └──────┬───────┘                   │
│                                                  ▼                          │
│                                           ┌──────────────┐                   │
│                                           │   Seed       │                   │
│                                           │   Writer     │                   │
│                                           └──────┬───────┘                   │
│                                                  │                          │
│                                    (5s settle)   ▼                          │
│                                           ┌──────────────┐                   │
│                                           │   Semantic   │ (background)     │
│                                           │   Resolver   │                   │
│                                           └──────────────┘                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Orchestrator Interface

```typescript
// src/analyzer/analysis-orchestrator.ts

export interface AnalysisOrchestrator {
  /**
   * Analyze a single file (CLI or watch mode).
   * Routes to appropriate parser, writes seeds atomically.
   */
  analyzeFile(event: FileChangeEvent): Promise<AnalysisResult>;
  
  /**
   * Analyze all supported files in a package (CLI mode).
   * Scans directory, batches by language, writes seeds.
   */
  analyzePackage(packagePath: string): Promise<PackageResult>;
  
  /**
   * Analyze a batch of file changes (watch mode).
   * Groups by package, processes in parallel where safe.
   */
  analyzeBatch(events: FileChangeEvent[]): Promise<BatchResult>;
  
  /**
   * Trigger semantic resolution pass (Phase 4).
   * Called after structural analysis settles.
   */
  resolveSemantics(packagePath: string): Promise<ResolutionResult>;
  
  /**
   * Get current analysis status and progress.
   */
  getStatus(): OrchestratorStatus;
}

export interface FileChangeEvent {
  type: "add" | "change" | "unlink";
  filePath: string;
  packagePath: string;
  timestamp: number;
}

export interface AnalysisResult {
  filePath: string;
  success: boolean;
  nodeCount: number;
  edgeCount: number;
  refCount: number;
  parseTimeMs: number;
  writeTimeMs: number;
  error?: string;
}

export interface PackageResult {
  packagePath: string;
  filesAnalyzed: number;
  filesSkipped: number;
  filesFailed: number;
  totalNodes: number;
  totalEdges: number;
  totalRefs: number;
  totalTimeMs: number;
  errors: Array<{ filePath: string; error: string }>;
}

export interface BatchResult {
  events: FileChangeEvent[];
  results: AnalysisResult[];
  totalTimeMs: number;
}

export interface OrchestratorStatus {
  mode: "idle" | "analyzing" | "resolving";
  currentFile?: string;
  progress?: {
    completed: number;
    total: number;
    percentage: number;
  };
  lastError?: string;
}
```

#### CLI Mode Implementation

```typescript
export function createCLIOrchestrator(
  router: LanguageRouter,
  writer: SeedWriter,
  pool: DuckDBPool
): AnalysisOrchestrator {
  return {
    async analyzePackage(packagePath: string): Promise<PackageResult> {
      const startTime = Date.now();
      const errors: Array<{ filePath: string; error: string }> = [];
      
      // 1. Scan for supported files
      const files = await scanSupportedFiles(packagePath, router);
      
      // 2. Cleanup orphans before analysis (Section 8.5)
      await cleanupOrphans(getSeedPath(packagePath));
      
      // 3. Process files in batches (limit concurrency for memory)
      const BATCH_SIZE = 50;
      let totalNodes = 0, totalEdges = 0, totalRefs = 0;
      let filesAnalyzed = 0, filesFailed = 0;
      
      for (const batch of chunk(files, BATCH_SIZE)) {
        const results = await Promise.all(
          batch.map(file => this.analyzeFile({
            type: "add",
            filePath: file,
            packagePath,
            timestamp: Date.now()
          }))
        );
        
        for (const result of results) {
          if (result.success) {
            filesAnalyzed++;
            totalNodes += result.nodeCount;
            totalEdges += result.edgeCount;
            totalRefs += result.refCount;
          } else {
            filesFailed++;
            errors.push({ filePath: result.filePath, error: result.error! });
          }
        }
      }
      
      return {
        packagePath,
        filesAnalyzed,
        filesSkipped: files.length - filesAnalyzed - filesFailed,
        filesFailed,
        totalNodes,
        totalEdges,
        totalRefs,
        totalTimeMs: Date.now() - startTime,
        errors
      };
    },
    
    async analyzeFile(event: FileChangeEvent): Promise<AnalysisResult> {
      const startTime = Date.now();
      
      // Get appropriate parser
      const parser = router.getParser(event.filePath);
      if (!parser) {
        return {
          filePath: event.filePath,
          success: false,
          nodeCount: 0, edgeCount: 0, refCount: 0,
          parseTimeMs: 0, writeTimeMs: 0,
          error: "No parser for file type"
        };
      }
      
      try {
        // Parse file
        const parseStart = Date.now();
        const parseResult = await parser.parse(event.filePath);
        const parseTimeMs = Date.now() - parseStart;
        
        // Write seeds (atomic)
        const writeStart = Date.now();
        if (event.type === "unlink") {
          await writer.deleteFile(
            getSeedPath(event.packagePath),
            parseResult.sourceFileHash
          );
        } else {
          await writer.updateFile(
            getSeedPath(event.packagePath),
            parseResult
          );
        }
        const writeTimeMs = Date.now() - writeStart;
        
        return {
          filePath: event.filePath,
          success: true,
          nodeCount: parseResult.nodes.length,
          edgeCount: parseResult.edges.length,
          refCount: parseResult.externalRefs.length,
          parseTimeMs,
          writeTimeMs
        };
      } catch (error) {
        return {
          filePath: event.filePath,
          success: false,
          nodeCount: 0, edgeCount: 0, refCount: 0,
          parseTimeMs: Date.now() - startTime, writeTimeMs: 0,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },
    
    // ... other methods
  };
}
```

#### Watch Mode Implementation

```typescript
export function createWatchOrchestrator(
  router: LanguageRouter,
  writer: SeedWriter,
  pool: DuckDBPool,
  options: WatchOptions = {}
): AnalysisOrchestrator & WatchController {
  const {
    debounceMs = 100,           // Batch collection window
    semanticSettleMs = 5000,   // Wait before semantic resolution
    maxConcurrency = 4          // Parallel parse limit
  } = options;
  
  // Event buffer for debouncing
  let pendingEvents: FileChangeEvent[] = [];
  let debounceTimer: NodeJS.Timeout | null = null;
  let semanticTimer: NodeJS.Timeout | null = null;
  let dirtyPackages = new Set<string>();
  
  const processBatch = async () => {
    if (pendingEvents.length === 0) return;
    
    const events = pendingEvents;
    pendingEvents = [];
    
    // Group by package for efficient processing
    const byPackage = groupBy(events, e => e.packagePath);
    
    for (const [packagePath, packageEvents] of Object.entries(byPackage)) {
      // Process with concurrency limit
      const results = await pMap(
        packageEvents,
        event => orchestrator.analyzeFile(event),
        { concurrency: maxConcurrency }
      );
      
      // Track packages needing semantic resolution
      const hasChanges = results.some(r => r.success);
      if (hasChanges) {
        dirtyPackages.add(packagePath);
        scheduleSemanticResolution();
      }
      
      // Report progress
      emitProgress(results);
    }
  };
  
  const scheduleSemanticResolution = () => {
    // Cancel existing timer
    if (semanticTimer) {
      clearTimeout(semanticTimer);
    }
    
    // Schedule after settle period (5s of no activity)
    semanticTimer = setTimeout(async () => {
      const packages = Array.from(dirtyPackages);
      dirtyPackages.clear();
      
      for (const pkg of packages) {
        await orchestrator.resolveSemantics(pkg);
      }
    }, semanticSettleMs);
  };
  
  const orchestrator: AnalysisOrchestrator & WatchController = {
    // ... analyzeFile, analyzeBatch from CLI implementation
    
    start(packagePath: string): void {
      const watcher = chokidar.watch(packagePath, {
        ignored: [/node_modules/, /\.devac/, /\.git/],
        persistent: true,
        ignoreInitial: true
      });
      
      const handleEvent = (type: "add" | "change" | "unlink") => 
        (filePath: string) => {
          if (!router.getParser(filePath)) return; // Skip unsupported
          
          pendingEvents.push({
            type,
            filePath,
            packagePath,
            timestamp: Date.now()
          });
          
          // Debounce: process after 100ms of no activity
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(processBatch, debounceMs);
        };
      
      watcher
        .on("add", handleEvent("add"))
        .on("change", handleEvent("change"))
        .on("unlink", handleEvent("unlink"));
    },
    
    stop(): void {
      // Cleanup timers and watcher
      if (debounceTimer) clearTimeout(debounceTimer);
      if (semanticTimer) clearTimeout(semanticTimer);
      // ... close watcher
    }
  };
  
  return orchestrator;
}
```

#### Error Aggregation and Reporting

```typescript
export interface ProgressReporter {
  onFileStart(filePath: string): void;
  onFileComplete(result: AnalysisResult): void;
  onBatchComplete(results: BatchResult): void;
  onError(error: OrchestratorError): void;
  onSemanticStart(packagePath: string): void;
  onSemanticComplete(result: ResolutionResult): void;
}

export interface OrchestratorError {
  phase: "parse" | "write" | "resolve";
  filePath?: string;
  packagePath?: string;
  error: Error;
  recoverable: boolean;
}

// Error aggregation for batch reporting
export function aggregateErrors(
  results: AnalysisResult[]
): AggregatedErrorReport {
  const errors = results.filter(r => !r.success);
  
  // Group by error type for summary
  const byType = groupBy(errors, r => classifyError(r.error!));
  
  return {
    totalErrors: errors.length,
    byType: Object.fromEntries(
      Object.entries(byType).map(([type, errs]) => [
        type,
        { count: errs.length, examples: errs.slice(0, 3) }
      ])
    ),
    recommendations: generateRecommendations(byType)
  };
}

function classifyError(error: string): string {
  if (error.includes("syntax")) return "parse_error";
  if (error.includes("permission")) return "permission_error";
  if (error.includes("ENOENT")) return "file_not_found";
  if (error.includes("DuckDB")) return "database_error";
  return "unknown";
}
```

#### Semantic Resolution Trigger Strategy

Semantic resolution (Pass 2) is triggered after structural analysis settles:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  SEMANTIC RESOLUTION TRIGGER - Watch Mode                                   │
│  ────────────────────────────────────────                                   │
│                                                                             │
│  Time ──────────────────────────────────────────────────────────▶           │
│                                                                             │
│  File changes:  ○──○───○─────○──○                                           │
│                                                                             │
│  Debounce:         └──┴───┴─────┴──┴─▶ [100ms] ▶ Structural Parse          │
│                                                                             │
│  Semantic timer:                              ├─────[5s settle]─────▶       │
│                                                                             │
│  New change:                                        ○                       │
│                                                                             │
│  Timer reset:                                       ├─────[5s]─────▶       │
│                                                                             │
│  Semantic run:                                                    ▶ Run!   │
│                                                                             │
│  CLI Mode: Run semantic resolution immediately after structural pass       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Why 5-second settle time for watch mode:**
- Cross-package resolution is expensive (queries multiple packages)
- Rapid file saves shouldn't trigger redundant resolution passes
- IDE save-on-keystroke patterns would otherwise cause thrashing
- User typically saves multiple files when making cross-cutting changes

**CLI mode behavior:**
- `devac analyze`: Run semantic resolution immediately after structural pass
- `devac analyze --structural-only`: Skip semantic resolution entirely
- `devac analyze --force`: Force re-resolution even if seeds exist

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

### 8.5 Error Handling

The system must handle errors gracefully without corrupting seed data or leaving partial state.

#### Error Categories

| Error Type | Behavior | Recovery |
|------------|----------|----------|
| **Parse error** | Continue with partial results, log warning | Re-parse on next file change |
| **Write failure** | Atomic write prevents corruption | Retry or regenerate from source |
| **Read failure** | Return error to caller | Delete corrupt file, regenerate |
| **Corruption detected** | Fail operation | Delete and regenerate from source |
| **Disk space** | Check before write, fail gracefully | Warn user, abort operation |

#### Parse Error Handling

```typescript
// Parse errors should not stop analysis of other files
interface ParseResult {
  success: boolean;
  nodes: Node[];
  edges: Edge[];
  refs: ExternalRef[];
  errors: ParseError[];  // Collect errors, don't throw
}

interface ParseError {
  file: string;
  line?: number;
  column?: number;
  message: string;
  severity: "error" | "warning";
}

// Partial results are valid - a file with syntax errors
// may still have parseable content above the error
```

#### Write Failure Recovery

All Parquet writes use atomic write pattern (see Section 6.4 SeedWriter). If atomic rename fails:
1. Temp file is left in place (`.tmp` suffix)
2. On next analysis, detect orphan temp files and clean up
3. Original Parquet file remains intact

#### Corruption Recovery

```bash
# If seed files become corrupted:
devac clean --package <path>   # Remove seed directory
devac analyze <path>           # Regenerate from source

# Source code is always the truth - seeds are 100% regenerable
```

#### File Locking

To prevent corruption from concurrent access:

```typescript
// Lock pattern for seed writes
async function withSeedLock<T>(
  seedPath: string,
  operation: () => Promise<T>
): Promise<T> {
  const lockFile = path.join(seedPath, ".devac.lock");
  await acquireLock(lockFile, { timeout: 30000 });
  try {
    return await operation();
  } finally {
    await releaseLock(lockFile);
  }
}
```

**Lock behavior:**
- Acquired before any write operation
- Released after write completes (success or failure)
- Timeout after 30s to prevent deadlocks
- Stale locks (process crash) detected via PID in lock file

**Lock acquisition implementation:**

```typescript
interface LockOptions {
  timeout: number;        // Max wait time in ms (default: 30000)
  retryDelay: number;     // Initial retry delay in ms (default: 50)
  maxRetryDelay: number;  // Max retry delay in ms (default: 1000)
}

async function acquireLock(
  lockFile: string,
  options: Partial<LockOptions> = {}
): Promise<void> {
  const { timeout = 30000, retryDelay = 50, maxRetryDelay = 1000 } = options;
  const startTime = Date.now();
  let currentDelay = retryDelay;
  
  while (Date.now() - startTime < timeout) {
    try {
      // Atomic create-exclusive: fails if file exists
      const fd = await fs.open(lockFile, "wx");
      
      // Write lock metadata
      const lockData = JSON.stringify({
        pid: process.pid,
        timestamp: new Date().toISOString(),
        hostname: os.hostname()
      });
      await fd.write(lockData);
      await fd.close();
      
      return; // Lock acquired successfully
    } catch (error: any) {
      if (error.code === "EEXIST") {
        // Lock file exists - check if stale
        if (await isLockStale(lockFile)) {
          // Stale lock - remove and retry immediately
          try {
            await fs.unlink(lockFile);
            continue; // Retry without delay
          } catch {
            // Another process may have removed it - continue
          }
        }
        
        // Fresh lock held by another process - wait with backoff
        await sleep(currentDelay);
        currentDelay = Math.min(currentDelay * 2, maxRetryDelay);
      } else {
        throw error; // Unexpected error
      }
    }
  }
  
  throw new Error(`Lock acquisition timeout after ${timeout}ms: ${lockFile}`);
}

async function releaseLock(lockFile: string): Promise<void> {
  try {
    await fs.unlink(lockFile);
  } catch (error: any) {
    if (error.code !== "ENOENT") {
      // Log but don't throw - lock may have been force-released
      console.warn(`Failed to release lock ${lockFile}:`, error);
    }
  }
}
```

**Why this approach:**
- `fs.open(..., "wx")` is atomic create-exclusive (fails if file exists)
- Exponential backoff (50ms → 100ms → 200ms → ... → 1000ms) reduces contention
- Stale lock detection allows recovery from crashed processes
- 30s timeout prevents indefinite blocking
- Lock file contains PID for stale detection and hostname for debugging

**Platform notes:**
- **macOS/Linux**: Works reliably with `fs.rename` for atomic writes
- **Windows**: May require additional retry logic for `fs.rename` (see known limitations)

#### Startup Cleanup

On startup, DevAC must clean orphan artifacts from previous interrupted operations. This ensures a clean state before any analysis begins.

**Orphan artifacts to clean:**

| Artifact | Pattern | Age Threshold | Action |
|----------|---------|---------------|--------|
| Temp Parquet files | `*.parquet.tmp` | >1 hour | Delete |
| Orphan temp files | `*.tmp` (no matching final) | >1 hour | Delete |
| Stale lock files | `.devac.lock` | PID not running | Delete |

**Cleanup implementation:**

```typescript
interface CleanupResult {
  tempFilesRemoved: number;
  staleLockFilesRemoved: number;
  errors: string[];
}

async function cleanupOrphans(seedPath: string): Promise<CleanupResult> {
  const result: CleanupResult = {
    tempFilesRemoved: 0,
    staleLockFilesRemoved: 0,
    errors: []
  };
  
  // 1. Find all .tmp files
  const tmpFiles = await glob(path.join(seedPath, "**/*.tmp"));
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  
  for (const tmpFile of tmpFiles) {
    try {
      const stat = await fs.stat(tmpFile);
      if (stat.mtimeMs < oneHourAgo) {
        await fs.unlink(tmpFile);
        result.tempFilesRemoved++;
      }
    } catch (error) {
      result.errors.push(`Failed to clean ${tmpFile}: ${error}`);
    }
  }
  
  // 2. Check lock files for stale PIDs
  const lockFiles = await glob(path.join(seedPath, "**/.devac.lock"));
  
  for (const lockFile of lockFiles) {
    if (await isLockStale(lockFile)) {
      await fs.unlink(lockFile);
      result.staleLockFilesRemoved++;
    }
  }
  
  return result;
}

async function isLockStale(lockFile: string): Promise<boolean> {
  try {
    const content = await fs.readFile(lockFile, "utf-8");
    const { pid, timestamp } = JSON.parse(content);
    
    // Check if PID is still running
    try {
      process.kill(pid, 0); // Signal 0 = check if process exists
      return false; // Process still running, lock is valid
    } catch {
      return true; // Process not running, lock is stale
    }
  } catch {
    // Can't read lock file - treat as stale
    return true;
  }
}
```

**Lock file format:**

```json
{
  "pid": 12345,
  "timestamp": "2025-12-14T10:30:00Z",
  "hostname": "developer-laptop"
}
```

**When cleanup runs:**
- On `devac analyze` start (before any processing)
- On `devac watch` start (before watching begins)
- On `devac verify` (as part of integrity checks)

**Logging:**
- Log cleaned files at DEBUG level
- Log cleanup summary at INFO level if any files were cleaned
- Log errors at WARN level (non-fatal, continue operation)

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

# ─────────────────────────────────────────────────────────────────────────────
# MAINTENANCE
# ─────────────────────────────────────────────────────────────────────────────

# Verify seed integrity
devac verify
devac verify --package packages/auth

# Verification checks:
# - All Parquet files readable
# - Edge references point to existing nodes
# - Source files have corresponding seed data
# - No orphan temp files (.tmp)

# Clean seed files (forces regeneration)
devac clean
devac clean --package packages/auth

# Clean removes:
# - All .devac/seed/ directories
# - Lock files and temp files
# - Does NOT remove source code
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

### 11.5 Common Workflows & Recovery

This section documents recommended workflows for common scenarios.

#### Design Principle

Seeds are **always derived from source code** (source-of-truth principle). There is no bidirectional sync - if seeds are out of date, they are simply regenerated from source. This makes recovery simple and predictable.

#### Scenario: Daily Development

```bash
# Option 1: Watch mode (recommended for active development)
devac watch

# Option 2: On-demand after saving files
devac analyze --if-changed
```

#### Scenario: Detecting Drift (Seeds Out of Sync)

If you suspect seeds are out of sync with source code:

```bash
# Step 1: Verify seed integrity (read-only, no regeneration)
devac verify

# If verify passes: seeds are structurally valid
# If verify fails: shows what's wrong (missing files, broken refs, etc.)
```

#### Scenario: Recovering from Drift

```bash
# Option 1: Smart recovery (fast, only regenerates changed files)
# Uses content hashing to detect what actually changed
devac analyze --if-changed
# Time: 20-50ms if nothing changed, 150-500ms if files changed

# Option 2: Full regeneration (guaranteed clean state)
# Use when: schema version changed, suspected corruption, or --if-changed didn't fix it
devac analyze --force
# Time: 5-10s for typical package
```

#### Scenario: File Watcher Missed Events

If the IDE was closed and file watcher wasn't running:

```bash
# Hash-based detection catches ALL changes, even if watcher missed them
devac analyze --if-changed

# This compares SHA-256 hashes of all source files against stored hashes
# Only regenerates files that actually changed
```

#### Scenario: Schema Version Mismatch

When upgrading DevAC and the schema version changes:

```bash
# DevAC will warn about version mismatch
# Force regeneration to update to new schema
devac analyze --force
```

#### Scenario: CI/CD Pipeline

```bash
# Ensure seeds exist and are valid before running queries
devac verify || devac analyze --force

# Or simply regenerate if changed (idempotent)
devac analyze --if-changed --all
```

#### Why No `devac sync` Command?

The spec intentionally does NOT include a `sync` or `reconcile` command because:

1. **`devac analyze --if-changed`** already provides smart sync via content hashing
2. **`devac verify`** provides read-only drift detection without regeneration
3. **`devac analyze --force`** handles forced regeneration
4. A separate `sync` command would duplicate existing functionality and create semantic confusion

The command structure follows Unix philosophy: each command does one thing well.

| Command | Purpose | Regenerates? |
|---------|---------|--------------|
| `devac analyze` | Regenerate seeds from source | Yes |
| `devac analyze --if-changed` | Smart regeneration (hash-based) | Conditional |
| `devac analyze --force` | Force full reanalysis | Yes |
| `devac verify` | Check seed integrity | No |
| `devac watch` | Continuous incremental updates | Incremental |
| `devac clean` | Delete all seeds | No |

### 11.6 MCP Server Integration

The MCP (Model Context Protocol) server exposes CodeGraph functionality to AI assistants.

#### MCP Tools

```typescript
// MCP tool definitions for AI assistants

const mcpTools = [
  {
    name: "find_symbol",
    description: "Find a symbol by name in the codebase",
    input: {
      name: { type: "string", description: "Symbol name to find" },
      kind: { type: "string", optional: true, description: "Symbol kind filter (function, class, etc.)" },
      exported: { type: "boolean", optional: true, description: "Filter to exported symbols only" }
    }
  },
  {
    name: "get_dependencies",
    description: "Get all dependencies of a symbol",
    input: {
      symbol: { type: "string", description: "Symbol name or entity ID" },
      depth: { type: "number", optional: true, default: 1, description: "Depth of dependency traversal" }
    }
  },
  {
    name: "get_dependents",
    description: "Get all symbols that depend on a given symbol",
    input: {
      symbol: { type: "string", description: "Symbol name or entity ID" },
      depth: { type: "number", optional: true, default: 1, description: "Depth of dependent traversal" }
    }
  },
  {
    name: "get_call_graph",
    description: "Get the call graph for a function",
    input: {
      function: { type: "string", description: "Function name or entity ID" },
      direction: { type: "string", enum: ["callers", "callees", "both"], default: "both" },
      depth: { type: "number", optional: true, default: 3, description: "Max depth (capped at 5)" }
    }
  },
  {
    name: "get_file_symbols",
    description: "Get all symbols defined in a file",
    input: {
      file: { type: "string", description: "File path" }
    }
  },
  {
    name: "query_sql",
    description: "Run a raw SQL query against the CodeGraph",
    input: {
      sql: { type: "string", description: "DuckDB SQL query" }
    }
  }
];
```

#### Query API

MCP tools use the same query engine as CLI commands:

```typescript
// MCP handler implementation pattern
async function handleMcpTool(
  tool: string,
  input: Record<string, unknown>
): Promise<McpResult> {
  switch (tool) {
    case "find_symbol":
      return await findSymbol(input.name, input.kind, input.exported);
    
    case "get_dependencies":
      return await getDependencies(input.symbol, input.depth ?? 1);
    
    case "get_call_graph":
      // Cap depth to prevent expensive queries
      const depth = Math.min(input.depth ?? 3, 5);
      return await getCallGraph(input.function, input.direction, depth);
    
    case "query_sql":
      // Validate query is read-only
      if (!isReadOnlyQuery(input.sql)) {
        throw new Error("Only SELECT queries allowed");
      }
      return await runQuery(input.sql);
    
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}
```

#### Cross-Repo Queries

For queries spanning multiple repositories, MCP uses the central hub:

```typescript
// Cross-repo query flow
async function findSymbolAcrossRepos(name: string): Promise<Symbol[]> {
  // 1. Query central hub for registered repos
  const repos = await hub.getRegisteredRepos();
  
  // 2. Query each repo's seeds (parallel)
  const results = await Promise.all(
    repos.map(repo => queryRepoSeeds(repo, name))
  );
  
  // 3. Merge and deduplicate results
  return mergeResults(results);
}
```

---

## 12. Performance Considerations

### 12.1 Target Performance

> **Updated 2025-12-14:** Revised targets based on consolidated review feedback. These are **guidelines, not hard limits**. Real-world testing during Phase 1 will validate and refine these targets.

#### Performance Philosophy

Performance targets serve as design guidelines during development. We accept that:
1. Targets may need adjustment based on real-world testing
2. Cold paths (first run, no cache) will be slower than warm paths
3. Python parsing latency (200-500ms) is acceptable for now; optimize later if needed
4. Base-branch edits may be slower than feature-branch edits (trade-off accepted)

#### Base Branch vs Feature Branch Performance

Due to the per-package Parquet partitioning strategy, **editing files directly on main/base branch has different performance characteristics** than editing on feature branches:

| Branch Type | Storage Strategy | Single File Change | Why |
|-------------|-----------------|-------------------|-----|
| **Feature branch** | Delta storage (`branch/` directory) | 150-300ms (p50) | Only writes changed file's data to branch delta |
| **Base branch** | Full package (`base/` directory) | 300-500ms (p50) | Rewrites entire package Parquet (write amplification) |

**Why this trade-off exists:**
- Per-package Parquet files minimize metadata overhead vs per-file partitioning
- Parquet files cannot be incrementally updated (metadata is at end of file)
- Feature branches use delta storage (small, fast writes)
- Base branch must maintain complete package state (larger writes)

**When does base branch get updated?**
- In watch mode: When current git branch is `main`, `master`, or configured base branch
- Detection: `git rev-parse --abbrev-ref HEAD` determines current branch
- Updates go to `base/` directory, triggering full package rewrite

**Why this is acceptable:**
1. **Most development uses feature branches** - small PRs with delta storage
2. **Base branch edits are infrequent** - typically only on merge
3. **300-500ms is still responsive** - well within acceptable user experience
4. **Large refactors on main are rare** - and performance penalty is acceptable when they occur

**Future optimization (Phase 4+):**
If base-branch performance becomes problematic for specific workflows:
- Consider "working set" optimization for frequently-edited files
- Explore background async base updates
- Evaluate chunked Parquet writing strategies

**Recommendation:** Use feature branches for development. Direct main-branch editing works but may feel slightly slower on large packages.

#### Target Performance Table

| Operation | Target (p50) | Target (p95) | Notes |
|-----------|--------------|--------------|-------|
| Hash check (no changes) | <50ms | <100ms | File content hash comparison |
| Structural parse (TS) | <50ms | <200ms | Per file, Babel-based. Large files with complex types take longer. |
| Structural parse (Python) | <200ms | <500ms | Per file, subprocess. Without warm worker, expect 250-500ms. |
| Package Parquet write | <100ms | <200ms | Size-dependent. Large packages take longer. |
| **Single file change (warm)** | **<300ms** | **<500ms** | Hash + parse + merge + write. Warm DuckDB connection. |
| **Single file change (cold)** | **<500ms** | **<800ms** | Includes DuckDB connection startup. |
| **Batch changes (10 files)** | **<500ms** | **<800ms** | Requires parallelization. Sequential would exceed. |
| Package query | <100ms | <200ms | Single branch, partition pruning |
| Repo query (10 packages) | <200ms | <400ms | Multiple package globs |
| Cross-repo query (3 repos) | <600ms | <1000ms | Federated globs, cold cache may exceed |
| Cross-branch query | <150ms | <300ms | Hive partitioning across branches |

#### Cold vs Warm Path Distinction

| Path Type | Description | Expected Overhead |
|-----------|-------------|-------------------|
| **Cold** | First analysis, DuckDB connection startup, no cached metadata | +100-200ms |
| **Warm** | DuckDB connection alive, Parquet metadata cached | Baseline |
| **Hot** | Watch mode, everything in memory | -50ms from warm |

#### Latency Budget Breakdown (Single File Change)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SINGLE FILE CHANGE LATENCY BUDGET (Warm Path)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Read file + compute hash       :  5-10ms                                  │
│  Compare with stored hash       :  5-10ms                                  │
│  Parse with ts-morph/Babel      : 50-200ms (file size dependent)          │
│  Load existing Parquet          : 20-50ms                                  │
│  Merge nodes/edges              : 10-20ms                                  │
│  Write new Parquet (ZSTD)       : 30-100ms                                 │
│  fsync directory                : 10-30ms                                  │
│  ─────────────────────────────────────────────────────────────────────────  │
│  TOTAL (p50)                    : ~150-300ms                               │
│  TOTAL (p95)                    : ~300-500ms                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Validation Strategy

Performance targets will be validated during Phase 1:
1. **Week 1:** Benchmark DuckDB write performance with ZSTD compression
2. **Week 2:** Measure ts-morph parsing across file size distribution
3. **Week 3:** End-to-end latency testing with realistic package sizes
4. **Adjust targets** if real-world data differs significantly from estimates

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

#### Recursive CTE Performance

Recursive CTEs for call graph traversal can be expensive at depth > 3.

**Performance characteristics:**
- Depth 1-2: Fast (~50ms)
- Depth 3-4: Moderate (~200-500ms)
- Depth 5+: Expensive (~1-5s), may scan all edges multiple times

**Mitigation strategies:**

1. **Cap depth by default:** Limit to depth=3, require explicit flag for deeper
2. **Warn on deep queries:** Log warning for depth > 3
3. **Pre-compute in Phase 4:** Consider materialized call graph edges

```sql
-- Optimized recursive CTE with depth limit
WITH RECURSIVE call_graph AS (
  -- Base case
  SELECT entity_id, name, 0 as depth
  FROM nodes WHERE name = 'handleLogin'
  
  UNION ALL
  
  -- Recursive case with depth limit
  SELECT n.entity_id, n.name, cg.depth + 1
  FROM call_graph cg
  JOIN edges e ON e.source_entity_id = cg.entity_id
  JOIN nodes n ON n.entity_id = e.target_entity_id
  WHERE e.edge_type = 'CALLS'
    AND cg.depth < 3  -- Hard limit
)
SELECT * FROM call_graph;
```

**Future optimization (Phase 4):**
Pre-compute transitive call relationships in a separate table to avoid recursive queries at runtime.

### 12.4 Caching Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  CACHING LEVELS                                                             │
│  ──────────────                                                             │
│                                                                             │
│  Level 1: DuckDB Connection Pool (Warm Start)                              │
│  ─────────────────────────────────────────────                              │
│  • Keep DuckDB connection warm in watch mode                                │
│  • Reuse connections across queries                                         │
│  • Pre-load Parquet file handles on startup                                │
│  • Cold start: ~100ms, Warm: ~10ms                                         │
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

### 12.5 Observability

Structured logging enables debugging and performance monitoring.

#### Log Events

```typescript
// Structured log format for analysis operations
interface AnalysisLogEvent {
  event: "parse_file" | "write_seed" | "query" | "watch_event";
  timestamp: string;
  durationMs: number;
  
  // Context
  file?: string;
  package?: string;
  
  // Metrics
  nodeCount?: number;
  edgeCount?: number;
  refCount?: number;
  
  // Status
  success: boolean;
  error?: string;
}

// Example log output (JSON lines format)
// {"event":"parse_file","timestamp":"2025-01-15T10:30:00Z","durationMs":45,"file":"src/auth.ts","nodeCount":23,"edgeCount":15,"refCount":8,"success":true}
// {"event":"write_seed","timestamp":"2025-01-15T10:30:00Z","durationMs":12,"package":"packages/auth","success":true}
```

#### Logging Levels

| Level | Use Case |
|-------|----------|
| **error** | Parse failures, write failures, corruption |
| **warn** | Partial parse results, slow operations (>1s) |
| **info** | Analysis start/complete, watch events |
| **debug** | Per-file timing, query plans, cache hits |

#### Performance Metrics

```typescript
// Key metrics to track
interface PerformanceMetrics {
  // Parse performance
  parseTimeMs: number;
  filesPerSecond: number;
  
  // Write performance
  writeTimeMs: number;
  bytesWritten: number;
  
  // Query performance
  queryTimeMs: number;
  rowsScanned: number;
  
  // Watch mode
  eventLatencyMs: number;  // Time from file change to seed update
}

// CLI flag for verbose timing
// devac analyze --timing
// Output:
//   Parse:  2.3s (450 files, 195 files/sec)
//   Write:  0.8s (12.4 MB)
//   Total:  3.1s
```

#### Debug Mode

```bash
# Enable debug logging
DEBUG=devac:* devac analyze

# Debug specific components
DEBUG=devac:parser devac analyze
DEBUG=devac:writer devac analyze
DEBUG=devac:query devac query "..."
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

### 14.0 Known Limitations (Phase 1)

The following limitations are **accepted for Phase 1** and may be addressed in later phases:

| Limitation | Impact | Mitigation | Future Phase |
|------------|--------|------------|--------------|
| **Windows file locking** | `fs.rename` may fail with EBUSY/EPERM if readers hold locks | Use macOS/Linux for Phase 1; WSL works on Windows | Phase 4+ |
| **Base branch write amplification** | 300-500ms per file change on main branch | Use feature branches for development | Phase 4+ optimization |
| **Python parser latency** | 200-500ms subprocess overhead | Accept for now; optimize later if needed | Phase 3+ |
| **Recursive CTE depth >6** | Performance degrades exponentially | Cap depth at 6 for interactive queries | Phase 4+ |

#### Windows Platform Support

Windows support is **out of scope for Phase 1**. The atomic write pattern (`temp file → fs.rename → fsync`) works reliably on macOS and Linux but has known issues on Windows:

- **EBUSY/EPERM errors**: Windows file system doesn't allow renaming files that are open by other processes (e.g., DuckDB readers)
- **Proposed solution**: Retry with exponential backoff (50ms → 100ms → 200ms → 1000ms, up to 30s)
- **Alternative**: Use `write-file-atomic` npm package which handles Windows quirks

**For Windows users during Phase 1:**
- Use WSL (Windows Subsystem for Linux) - works identically to Linux
- Or wait for Phase 4+ when Windows retry logic is implemented

#### Interface Alignment Note

The spec defines `StructuralParseResult` with `nodes: ParsedNode[]`, `edges: ParsedEdge[]`, `externalRefs: ParsedExternalRef[]`. Existing code may have different interface names (`AstNode`, `RelationshipInfo`). During Phase 1 implementation:

- **Spec is authoritative** - code interfaces should align with spec
- `externalRefs` tracking is required for Phase 4 semantic resolution
- Interface alignment is an implementation task, not a spec change

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

#### Phase Dependencies

```
                                ┌──────────────────┐
                                │  PHASE 1:        │
                                │  Foundation      │
                                │  (TS Parser,     │
                                │   SeedWriter,    │
                                │   DuckDB setup)  │
                                └────────┬─────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
                    ▼                    ▼                    │
           ┌────────────────┐   ┌────────────────┐           │
           │  PHASE 2:      │   │  PHASE 3:      │           │
           │  Incremental   │   │  Python        │           │
           │  Updates       │   │  Support       │           │
           │  (File watch,  │   │  (Can run in   │           │
           │   partitions)  │   │   parallel     │           │
           └───────┬────────┘   │   with Phase 2)│           │
                   │            └───────┬────────┘           │
                   │                    │                    │
                   └────────────────────┼────────────────────┘
                                        │
                                        ▼
                              ┌──────────────────┐
                              │  PHASE 4:        │
                              │  Federation      │
                              │  (Cross-repo,    │
                              │   central hub)   │
                              └────────┬─────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │  PHASE 5:        │
                              │  Validation      │
                              │  Integration     │
                              │  (MCP, affected  │
                              │   detection)     │
                              └────────┬─────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │  PHASE 6:        │
                              │  C# Support      │
                              │  (Optional,      │
                              │   can defer)     │
                              └──────────────────┘
```

**Dependency Notes:**

| Phase | Depends On | Can Parallelize With |
|-------|------------|---------------------|
| Phase 1 | - | - |
| Phase 2 | Phase 1 (SeedWriter, partition structure) | Phase 3 |
| Phase 3 | Phase 1 (LanguageRouter interface) | Phase 2 |
| Phase 4 | Phase 1, 2, 3 (all parsers, incremental updates) | - |
| Phase 5 | Phase 4 (federation for cross-repo queries) | - |
| Phase 6 | Phase 1 (parser interface) | Can defer indefinitely |

**Critical Path:** Phase 1 → Phase 2 → Phase 4 → Phase 5

**Parallel Opportunity:** Phase 2 and Phase 3 can be developed concurrently after Phase 1 completes. This reduces total timeline by ~1 week if resources available.

#### Phase Timeline

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
| Atomic write infrastructure | Temp file + rename pattern, lock files | 1 day |
| Seed directory structure | Create/manage .devac/seed/ | 1 day |
| Port TS parser | Adapt structural-parser.ts for new format | 3 days |
| LanguageRouter implementation | Extension mapping, parser registry | 1 day |
| Entity ID generation | Implement content-hash IDs with repo prefix | 1 day |
| Error handling framework | ParseResult errors, recovery patterns | 1 day |
| Basic CLI | analyze, query, verify, clean commands | 2 days |
| Structured logging | Debug/verbose modes for troubleshooting | 1 day |
| Performance tests | Parquet scale validation | 2 days |
| Integration tests | End-to-end analyze → query | 2 days |
| **Total Phase 1** | | **18 days** |

**Timeline Note:** Original estimate was 14 days. Added 4 days to account for:
- Atomic write infrastructure and file locking (1 day)
- LanguageRouter for future extensibility (1 day)
- Error handling framework (1 day)
- Structured logging for observability (1 day)

### 15.3 Success Criteria

| Phase | Success Criteria |
|-------|------------------|
| 1 | Can analyze TS package, query with DuckDB, <50ms per file |
| 2 | <100ms incremental update on file change |
| 3 | Python files produce same query format as TS |
| 4 | Query returns results from 3+ registered repos |
| 5 | Validation runs only on symbol-level affected files |
| 6 | C# projects analyzed with cross-language refs |

### 15.4 Test Strategy

A comprehensive test strategy ensures reliability across all phases.

#### Unit Tests

| Component | Test Focus |
|-----------|------------|
| **Entity ID Generation** | Deterministic output, collision resistance, scoped name handling |
| **Scoped Name Generation** | Nested functions, arrow functions, class methods, anonymous functions |
| **Language Router** | Extension mapping, unsupported file handling |
| **SeedWriter** | Atomic write pattern, error recovery |
| **Hash Computation** | Consistency, performance |

```typescript
// Example unit test structure
describe("generateEntityId", () => {
  it("produces stable ID for same content", () => {
    const id1 = generateEntityId("repo", "pkg", "function", "file.ts", "foo");
    const id2 = generateEntityId("repo", "pkg", "function", "file.ts", "foo");
    expect(id1).toBe(id2);
  });
  
  it("produces different ID for different scoped names", () => {
    const id1 = generateEntityId("repo", "pkg", "function", "file.ts", "foo");
    const id2 = generateEntityId("repo", "pkg", "function", "file.ts", "bar");
    expect(id1).not.toBe(id2);
  });
});
```

#### Integration Tests

| Scenario | Validation |
|----------|------------|
| **Parse → Write → Query** | Full cycle produces queryable Parquet files |
| **Incremental Update** | File change triggers correct delta update |
| **Branch Switching** | base/branch directories update correctly |
| **Error Recovery** | Corrupt file detection and regeneration |

```typescript
// Example integration test
describe("full analysis cycle", () => {
  it("produces queryable seed files", async () => {
    await devac.analyze("./test-package");
    
    const result = await devac.query(`
      SELECT COUNT(*) as count FROM read_parquet('./test-package/.devac/seed/base/nodes.parquet')
    `);
    
    expect(result[0].count).toBeGreaterThan(0);
  });
});
```

#### Performance Tests

| Scenario | Target | Validation |
|----------|--------|------------|
| **1K files** | <10s full analysis | Baseline performance |
| **10K files** | <60s full analysis | Scale verification |
| **50K files** | <5min full analysis | Enterprise scale |
| **Incremental (1 file)** | <300ms | Watch mode responsiveness |
| **Hash check (no changes)** | <50ms | Skip optimization |

```typescript
// Example performance test
describe("performance", () => {
  it("analyzes 1K files in under 10 seconds", async () => {
    const start = Date.now();
    await devac.analyze("./large-test-package");
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(10000);
  });
});
```

#### E2E Tests

| Scenario | Validation |
|----------|------------|
| **CLI Commands** | `devac analyze`, `devac query`, `devac watch`, `devac verify`, `devac clean` |
| **Watch Mode** | File changes trigger updates, output is correct |
| **MCP Integration** | Tools return expected results |
| **Cross-Repo Queries** | Central hub aggregates correctly |

#### Test Data Strategy

- **Fixture packages:** Small, deterministic test packages with known structure
- **Generated packages:** Scripted generation of large packages for scale testing
- **Real-world samples:** Anonymized extracts from production codebases (optional)

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
