# Federated CodeGraph Architecture

**System:** DevAC, CodeGraph, Vision-View-Effects  
**Version:** 4.0  
**Status:** Draft  
**Last Updated:** 2025-01-XX

---

## Overview

This specification describes a federated architecture for storing and querying code analysis data across multiple repositories and packages. The design uses **DuckDB + Parquet** throughout for simplicity, performance, and scalability.

> **Note on Examples:** This document uses abstract "nodes" and "relationships" as illustrative examples. These are intentionally generic and should not be interpreted as final schema definitions.

---

## Design Principles

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  1. SOURCE CODE IS TRUTH                                                    │
│     Everything else is derived and can be regenerated                       │
│                                                                             │
│  2. NO DATA DUPLICATION                                                     │
│     Query source files directly, don't copy into another database           │
│                                                                             │
│  3. SINGLE TECHNOLOGY STACK                                                 │
│     DuckDB + Parquet everywhere - no abstraction layers needed              │
│                                                                             │
│  4. FILES ARE THE DATABASE                                                  │
│     Parquet files are queryable - no "sync" or "import" step                │
│                                                                             │
│  5. SCALES TO CPG + TRACING                                                 │
│     Architecture handles full Code Property Graphs and OTel data            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Concept

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   SOURCE CODE              PARQUET SEEDS              DUCKDB CENTRAL        │
│   (truth)                  (queryable files)          (query engine)        │
│                                                                             │
│   ┌─────────┐              ┌─────────────┐            ┌─────────────┐       │
│   │ .ts     │   analyze    │ nodes.pq    │   direct   │             │       │
│   │ .tsx    │ ──────────▶  │ edges.pq    │ ─────────▶ │  DuckDB     │       │
│   │ .py     │              │ refs.pq     │   query    │             │       │
│   │ ...     │              └─────────────┘            └─────────────┘       │
│   └─────────┘              in repo                    on laptop             │
│                                                                             │
│   Can always               Columnar, compressed       Queries Parquet       │
│   regenerate               Git-friendly (small)       directly - no import  │
│                            Native types               ~100ms startup        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Insight:** DuckDB can query Parquet files directly with `read_parquet()`. The seed files ARE the database - no import or sync step required for most operations.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                           DEVELOPER LAPTOP                                  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │  repo-mobile/                     repo-web/                         │   │
│  │  ├── packages/                    └── apps/web/.devac/seed/         │   │
│  │  │   ├── app/.devac/seed/             ├── nodes.parquet             │   │
│  │  │   │   ├── nodes.parquet            ├── edges.parquet             │   │
│  │  │   │   ├── edges.parquet            └── external_refs.parquet     │   │
│  │  │   │   └── external_refs.parquet                                  │   │
│  │  │   │                                        │                     │   │
│  │  │   └── ui/.devac/seed/                      │                     │   │
│  │  │       └── *.parquet ───────────────────────┼──────────┐          │   │
│  │  │                                            │          │          │   │
│  │  └── .devac/manifest.json                     │          │          │   │
│  │                                               │          │          │   │
│  └───────────────────────────────────────────────┼──────────┼──────────┘   │
│                                                  │          │              │
│                                                  ▼          ▼              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │  ~/.devac/                                                          │   │
│  │  ├── central.duckdb    ◄─── DuckDB queries Parquet files directly   │   │
│  │  │   │                      No data copied here!                    │   │
│  │  │   │                                                              │   │
│  │  │   ├── repo_registry (table)      ◄── Which repos are registered │   │
│  │  │   ├── cross_repo_edges (table)   ◄── Computed relationships     │   │
│  │  │   └── cached_stats (table)       ◄── Optional aggregations      │   │
│  │  │                                                                  │   │
│  │  └── config.json                                                    │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Why DuckDB + Parquet?

### Technology Comparison

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Traditional Approach (PostgreSQL):                                         │
│                                                                             │
│    Parquet Seeds ──► COPY INTO ──► PostgreSQL ──► Query                    │
│                      (import)      (storage)                                │
│                                                                             │
│    • Must import all data (duplication)                                     │
│    • Sync step required after each analysis                                 │
│    • Server process to manage (~100MB RAM, 2-5s startup)                   │
│    • Data exists in two places                                              │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  DuckDB Approach:                                                           │
│                                                                             │
│    Parquet Seeds ─────────────────► DuckDB ──► Query                       │
│                     (direct query)  (engine)                                │
│                                                                             │
│    • Query files directly (no duplication)                                  │
│    • No sync step - files ARE the database                                  │
│    • In-process (~50MB RAM, ~100ms startup)                                │
│    • Single source of truth                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### DuckDB Advantages for DevAC

| Aspect | Benefit |
|--------|---------|
| **Native types** | BOOLEAN, JSON, VARCHAR[] - no conversion needed |
| **Parquet native** | `read_parquet()` queries files directly |
| **Columnar** | Fast analytical queries (traversals, aggregations) |
| **Compression** | Parquet + ZSTD = 10-20x smaller than JSON |
| **No server** | Single file, in-process, instant startup |
| **PostgreSQL syntax** | Familiar SQL, easy migration if ever needed |

---

## Data Flow

### Analysis Flow (Code → Parquet Seeds)

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant CLI as DevAC CLI
    participant Duck as DuckDB (in-memory)
    participant FS as File System

    Dev->>CLI: devac analyze
    CLI->>Duck: Create in-memory database
    
    loop Each source file
        CLI->>CLI: Parse AST
        CLI->>Duck: INSERT nodes, edges
    end
    
    Duck->>FS: COPY TO nodes.parquet
    Duck->>FS: COPY TO edges.parquet
    Duck->>FS: COPY TO external_refs.parquet
    
    CLI->>Dev: Analysis complete ✓
```

### Query Flow (Direct Parquet Access)

```mermaid
sequenceDiagram
    participant UI as DevAC UI
    participant Hub as Central Hub
    participant Duck as DuckDB
    participant PQ as Parquet Files

    UI->>Hub: "Find all components"
    Hub->>Duck: SELECT * FROM read_parquet([globs])
    Duck->>PQ: Read only needed columns
    PQ->>Duck: Columnar data
    Duck->>Hub: Results
    Hub->>UI: Components list
    
    Note over Duck,PQ: No import step!<br/>Files queried directly
```

---

## Three-Layer Architecture

### Layer 1: Package Seeds (Parquet Files)

Each package produces Parquet files during analysis:

```
packages/app/.devac/
├── meta.json                    # Analysis metadata
└── seed/
    ├── nodes.parquet            # Code elements (functions, classes, etc.)
    ├── edges.parquet            # Relationships within package
    └── external_refs.parquet    # References to other packages
```

**Why Parquet at package level:**
- Columnar compression (10-20x smaller than JSON)
- DuckDB can query directly
- Fast to write during analysis
- Git-friendly (small binary files)

### Layer 2: Repository Manifest (JSON)

Each repository has a manifest listing its packages:

```
repo-mobile/.devac/
├── manifest.json                # Repo metadata
└── packages.json                # Index of packages and their seeds
```

```json
{
  "packages": [
    {
      "id": "repo-mobile:packages/app",
      "path": "packages/app",
      "seedPath": "packages/app/.devac/seed",
      "sourceHash": "sha256:abc123...",
      "analyzedAt": "2025-01-15T10:30:00Z"
    }
  ]
}
```

### Layer 3: Central Hub (DuckDB)

The central hub is a lightweight DuckDB database that:
1. Knows where all repos/packages are (registry)
2. Stores computed cross-repo relationships
3. Queries Parquet files directly for everything else

```
~/.devac/
├── central.duckdb              # Small! Only computed data
└── config.json                 # Global settings
```

**What's stored in central.duckdb:**

| Table | Purpose | Size |
|-------|---------|------|
| `repo_registry` | Registered repositories | Tiny |
| `cross_repo_edges` | Computed cross-repo relationships | Small |
| `cached_stats` | Optional aggregation cache | Small |

**What's NOT stored:**
- Nodes (queried from Parquet)
- Edges (queried from Parquet)
- External refs (queried from Parquet)

---

## Query Patterns

### Direct Parquet Queries

Most queries hit Parquet files directly:

```sql
-- Find all components across all packages
SELECT * FROM read_parquet([
  '/path/repo-mobile/packages/*/.devac/seed/nodes.parquet',
  '/path/repo-web/apps/*/.devac/seed/nodes.parquet'
])
WHERE type = 'component';

-- Cross-package dependency analysis
SELECT 
  source.name as from_node,
  source.file_path as from_file,
  refs.target_package,
  refs.target_symbol
FROM read_parquet('**/nodes.parquet') source
JOIN read_parquet('**/external_refs.parquet') refs 
  ON source.id = refs.node_id
WHERE source.type = 'function';
```

### Recursive Traversals (CPG)

```sql
-- Trace call graph from entry point
WITH RECURSIVE call_chain AS (
  -- Base: starting function
  SELECT id, name, file_path, 1 as depth, [id] as path
  FROM read_parquet('**/nodes.parquet')
  WHERE name = 'handleLogin'
  
  UNION ALL
  
  -- Recursive: follow calls
  SELECT n.id, n.name, n.file_path, c.depth + 1, list_append(c.path, n.id)
  FROM call_chain c
  JOIN read_parquet('**/edges.parquet') e ON e.source_id = c.id
  JOIN read_parquet('**/nodes.parquet') n ON e.target_id = n.id
  WHERE e.type = 'calls'
    AND c.depth < 10
    AND NOT list_contains(c.path, n.id)
)
SELECT * FROM call_chain ORDER BY depth;
```

### Cross-Repo Edge Resolution

This is computed and stored (only computed data that requires storage):

```sql
-- Resolve cross-repo imports (run periodically)
INSERT INTO cross_repo_edges
SELECT 
  refs.id,
  refs.node_id as source_node_id,
  split_part(refs.node_id, ':', 1) as source_repo,
  exports.node_id as target_node_id,
  split_part(exports.node_id, ':', 1) as target_repo,
  'imports' as edge_type
FROM read_parquet('**/external_refs.parquet') refs
JOIN read_parquet('**/exports.parquet') exports
  ON refs.target_symbol = exports.exported_name
  AND refs.target_package = exports.package_name
WHERE refs.is_internal = false;  -- Cross-repo only
```

---

## State Diagrams

### Package Analysis State

```mermaid
stateDiagram-v2
    [*] --> Unanalyzed: New package

    Unanalyzed --> Analyzing: devac analyze
    Analyzing --> Ready: Seeds written
    Analyzing --> Error: Analysis failed

    Ready --> Stale: Source code changes
    Stale --> Analyzing: devac analyze

    Error --> Analyzing: Retry

    note right of Ready
        Parquet seeds exist
        Immediately queryable
        No sync needed
    end note
```

### Central Hub State

```mermaid
stateDiagram-v2
    [*] --> Closed: Initial

    Closed --> Open: devac hub start
    Open --> Querying: Any query
    Querying --> Open: Results returned

    Open --> Rebuilding: devac hub rebuild
    Rebuilding --> Open: Cross-repo edges computed

    Open --> Closed: devac hub stop

    note right of Open
        DuckDB opened
        ~100ms startup
        Queries Parquet directly
    end note
```

---

## File Structure

### Complete Layout

```
~/code/
├── repo-mobile/                          # Repository 1
│   ├── packages/
│   │   ├── app/
│   │   │   ├── src/                      # Source code
│   │   │   └── .devac/
│   │   │       ├── meta.json             # Package metadata
│   │   │       └── seed/
│   │   │           ├── nodes.parquet     # ~1-10MB typical
│   │   │           ├── edges.parquet
│   │   │           └── external_refs.parquet
│   │   │
│   │   └── ui/
│   │       └── .devac/seed/*.parquet
│   │
│   └── .devac/
│       ├── manifest.json                 # Repo metadata
│       └── packages.json                 # Package index
│
├── repo-web/                             # Repository 2
│   └── ... (same structure)
│
└── ~/.devac/                             # Central hub
    ├── central.duckdb                    # ~1MB (only computed data)
    └── config.json
```

### Size Expectations

| Component | Typical Size | Notes |
|-----------|--------------|-------|
| Package seeds (basic) | 1-10 MB | nodes + edges + refs |
| Package seeds (full CPG) | 50-200 MB | + AST + CFG + PDG |
| Central hub | ~1 MB | Only registry + computed edges |
| Total (10 packages) | 10-100 MB | Basic analysis |
| Total (10 packages, CPG) | 500 MB - 2 GB | Full CPG |

---

## Seed Generation (Analysis)

### DuckDB In-Memory → Parquet Export

```mermaid
flowchart LR
    subgraph Analysis ["Analysis Phase"]
        SC[Source Code] --> Parser
        Parser --> Duck[DuckDB<br/>in-memory]
    end
    
    subgraph Export ["Export Phase"]
        Duck -->|COPY TO| PQ1[nodes.parquet]
        Duck -->|COPY TO| PQ2[edges.parquet]
        Duck -->|COPY TO| PQ3[external_refs.parquet]
    end
```

**Why DuckDB during analysis:**
- Native types (boolean, json, arrays) - no conversion
- Fast bulk inserts via Appender
- SQL queries during analysis if needed
- One-line export to Parquet

### Type Mapping

| Concept | DuckDB Type | Notes |
|---------|-------------|-------|
| Identifiers | VARCHAR | Global IDs |
| Names | VARCHAR | Nullable |
| Booleans | BOOLEAN | Native, not 0/1 |
| Counts | INTEGER | Line numbers, etc. |
| Metadata | JSON | Native JSON type |
| Tags/Lists | VARCHAR[] | Native arrays |
| Timestamps | TIMESTAMP | ISO 8601 |

---

## Central Hub Operations

### Registration

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Hub as Central Hub
    participant FS as File System

    Dev->>Hub: devac hub register /path/to/repo
    Hub->>FS: Scan for .devac/manifest.json
    Hub->>FS: Index all package seeds
    Hub->>Hub: INSERT INTO repo_registry
    Hub->>Dev: Registered ✓
```

### Query Execution

```mermaid
flowchart TB
    subgraph Query ["Query: Find all React components"]
        Q[User Query]
    end
    
    subgraph Hub ["Central Hub"]
        Duck[DuckDB Engine]
        Reg[(repo_registry)]
    end
    
    subgraph Files ["Parquet Seeds"]
        P1[repo-mobile/.../nodes.parquet]
        P2[repo-web/.../nodes.parquet]
    end
    
    Q --> Duck
    Duck --> Reg
    Reg -->|glob patterns| Duck
    Duck -->|read_parquet| P1
    Duck -->|read_parquet| P2
    P1 --> Duck
    P2 --> Duck
    Duck -->|Results| Q
```

### Cross-Repo Edge Rebuild

Only operation that writes to central database:

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Hub as Central Hub
    participant PQ as Parquet Files

    Dev->>Hub: devac hub rebuild
    Hub->>PQ: Read all external_refs.parquet
    Hub->>PQ: Read all exports.parquet
    Hub->>Hub: Match refs → exports
    Hub->>Hub: INSERT INTO cross_repo_edges
    Hub->>Dev: Rebuilt N edges ✓
```

---

## CLI Commands

```bash
# ─────────────────────────────────────────────────────────────────────────────
# Package Analysis
# ─────────────────────────────────────────────────────────────────────────────

devac analyze                    # Analyze current package → Parquet seeds
devac analyze --all              # Analyze all packages in repo
devac analyze --if-changed       # Skip if source unchanged

# ─────────────────────────────────────────────────────────────────────────────
# Central Hub
# ─────────────────────────────────────────────────────────────────────────────

devac hub register .             # Register current repo
devac hub register ~/other-repo  # Register another repo
devac hub list                   # List registered repos
devac hub unregister <repo-id>   # Remove repo

devac hub rebuild                # Rebuild cross-repo edges
devac hub stats                  # Show global statistics

# ─────────────────────────────────────────────────────────────────────────────
# Queries
# ─────────────────────────────────────────────────────────────────────────────

devac query "SELECT * FROM ..."  # Run SQL query
devac find <symbol>              # Find symbol across all repos
devac deps <node-id>             # Show dependencies
devac rdeps <node-id>            # Show reverse dependencies

# ─────────────────────────────────────────────────────────────────────────────
# Development
# ─────────────────────────────────────────────────────────────────────────────

devac watch                      # Watch for changes, auto-analyze
devac viz                        # Open visualization UI
```

---

## Performance Characteristics

### Startup Time

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Operation                          Time                                    │
│  ───────────────────────────────────────────────────────────────────────── │
│  Open central.duckdb                ~100ms                                  │
│  First Parquet query (cold)         ~200-500ms (file open + parse)          │
│  Subsequent queries (warm)          ~10-50ms                                │
│  Full cross-repo rebuild            ~1-5s (depends on size)                 │
│                                                                             │
│  Compare to PostgreSQL:                                                     │
│  Start embedded-postgres            2-5 seconds                             │
│  Import all seeds                   10-30 seconds                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Query Performance

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Query Type                         Performance                             │
│  ───────────────────────────────────────────────────────────────────────── │
│  Single node lookup by ID           ~10ms                                   │
│  Filter by type (1M nodes)          ~100ms (columnar scan)                  │
│  Aggregation (count by type)        ~50ms (columnar)                        │
│  Recursive CTE (10 levels)          ~200-500ms                              │
│  Cross-package JOIN                 ~100-300ms                              │
│                                                                             │
│  DuckDB excels at analytical queries - exactly what CPG analysis needs     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Memory Usage

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Component                          Memory                                  │
│  ───────────────────────────────────────────────────────────────────────── │
│  DuckDB baseline                    ~50 MB                                  │
│  Per-query buffer                   ~10-50 MB (released after)              │
│  Large analytical query             ~100-500 MB (temporary)                 │
│                                                                             │
│  Total typical usage                ~100-200 MB                             │
│                                                                             │
│  Compare to PostgreSQL:             ~100-300 MB baseline                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Future Extensions

### Full CPG (AST + CFG + PDG)

Same architecture, more Parquet files:

```
.devac/seed/
├── nodes.parquet           # Basic code elements
├── edges.parquet           # Basic relationships
├── external_refs.parquet   # Cross-package refs
├── ast.parquet             # Full AST nodes (larger)
├── cfg.parquet             # Control flow edges
└── pdg.parquet             # Data dependency edges
```

### OTel Tracing

Append-only Parquet files, partitioned by time:

```
~/.devac/traces/
├── 2025-01-15/
│   ├── spans_00.parquet
│   ├── spans_01.parquet
│   └── spans_02.parquet
├── 2025-01-16/
│   └── spans_00.parquet
└── ...
```

Query with time range predicate pushdown:

```sql
SELECT * FROM read_parquet('~/.devac/traces/2025-01-*/*.parquet')
WHERE timestamp > '2025-01-15 10:00:00'
  AND service_name = 'api-gateway';
```

### Semantic Search (If Needed)

If you need vector similarity search, add a dedicated vector store:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  DuckDB (current)          +        Vector Store (future, if needed)       │
│  ─────────────────               ─────────────────────────────────────     │
│  • Code structure                   • Embeddings                            │
│  • Relationships                    • Semantic search                       │
│  • CPG analysis                     • "Find similar code"                   │
│                                                                             │
│  Options: Qdrant, LanceDB, pgvector (if you add PostgreSQL)                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Graph Traversal Considerations

### The Reality: DuckDB is Not a Graph Database

DuckDB uses recursive CTEs for graph traversals. Like PostgreSQL, performance degrades with depth due to exponential join expansion.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Graph Traversal Performance (approximate, depends on data)                 │
│                                                                             │
│  Hops    Typical Results    DuckDB Time    Neo4j Time                       │
│  ─────────────────────────────────────────────────────────────────────────  │
│  1-2     ~25               <10ms          <1ms                              │
│  3-4     ~100-500          ~20-50ms       <5ms                              │
│  5-6     ~1K-5K            ~100-300ms     <10ms                             │
│  7-10    ~10K-50K          ~500ms-5s      <50ms                             │
│  10+     ~100K+            ~10s+          <100ms                            │
│                                                                             │
│  DuckDB: O(n^depth) - joins at each level                                   │
│  Neo4j:  O(depth) - pointer chasing (index-free adjacency)                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Practical Impact for DevAC

Most useful code analysis queries are shallow:

| Query Type | Typical Depth | DuckDB Performance |
|------------|---------------|-------------------|
| Direct dependencies | 1-2 | ✅ Trivial |
| Immediate call graph | 2-3 | ✅ Fast |
| Effect chain (VVE) | 3-5 | ✅ Fine |
| Data flow analysis | 5-7 | ⚠️ Manageable |
| Full transitive closure | unlimited | ❌ Pre-compute |

### Mitigation Strategies

**1. Depth Limits (Default Approach)**

```sql
WITH RECURSIVE call_chain AS (
  SELECT id, name, 1 as depth, [id] as path
  FROM read_parquet('**/nodes.parquet')
  WHERE id = $start_node
  
  UNION ALL
  
  SELECT n.id, n.name, c.depth + 1, list_append(c.path, n.id)
  FROM call_chain c
  JOIN read_parquet('**/edges.parquet') e ON e.source_id = c.id
  JOIN read_parquet('**/nodes.parquet') n ON e.target_id = n.id
  WHERE c.depth < 5  -- Hard limit prevents explosion
    AND NOT list_contains(c.path, n.id)  -- Cycle prevention
)
SELECT * FROM call_chain;
```

**2. Pre-Computed Transitive Closure (For "All Reachable" Queries)**

```sql
-- Store in central.duckdb, rebuild periodically
CREATE TABLE reachability AS
WITH RECURSIVE tc AS (
  SELECT source_id, target_id, 1 as min_hops
  FROM read_parquet('**/edges.parquet')
  WHERE type = 'calls'
  
  UNION
  
  SELECT tc.source_id, e.target_id, tc.min_hops + 1
  FROM tc
  JOIN read_parquet('**/edges.parquet') e ON tc.target_id = e.source_id
  WHERE tc.min_hops < 10
)
SELECT source_id, target_id, MIN(min_hops) as min_hops
FROM tc GROUP BY source_id, target_id;

-- Now queries are O(1)
SELECT * FROM reachability WHERE source_id = $node;
```

**3. Bidirectional Search (For Path Finding)**

Search 5 hops from start AND 5 hops backward from end, find intersection:

```sql
WITH forward AS (
  -- 5 hops from start
  ...
),
backward AS (
  -- 5 hops backward from end
  ...
)
SELECT f.id as meeting_point
FROM forward f
JOIN backward b ON f.id = b.id;
```

### Future: Dedicated Graph Index

If deep traversals become critical, consider adding a graph-optimized store:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  DuckDB (primary)                    Graph Index (auxiliary)                │
│  ─────────────────                   ────────────────────────               │
│  • All data storage                  • Edge list only                       │
│  • Most queries                      • Deep traversals                      │
│  • Aggregations                      • Reachability queries                 │
│  • Joins                             • Path finding                         │
│                                                                             │
│  Options:                                                                   │
│  • In-memory adjacency list                                                 │
│  • Kùzu (embedded graph DB, DuckDB-like)                                   │
│  • Pre-computed reachability table                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Recommendation:** Start with depth limits. Add pre-computed reachability if needed. Only add a dedicated graph index if you have specific deep traversal use cases that are slow.

---

## Future: Lakehouse Formats for Tracing

### Understanding the Storage Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  LAKEHOUSE FORMATS (Table Formats)                                          │
│  ─────────────────────────────────                                          │
│  Iceberg, Delta Lake, DuckLake                                              │
│  • ACID transactions                                                        │
│  • Schema evolution                                                         │
│  • Time travel (query old versions)                                         │
│  • Compaction (merge small files)                                           │
│  • Expiration (delete old data)                                             │
│                                                                             │
│           │                                                                 │
│           │ Built on top of                                                 │
│           ▼                                                                 │
│                                                                             │
│  FILE FORMATS                                                               │
│  ────────────                                                               │
│  Parquet, ORC, Avro                                                         │
│  • Columnar storage                                                         │
│  • Compression                                                              │
│  • Schema embedded in file                                                  │
│  • NO transactions, NO versioning                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

Lakehouse formats add metadata and transaction logs on top of Parquet files. They solve problems for continuously updated data with multiple writers.

### Why CodeGraph Seeds Don't Need Lakehouse

| Feature | Lakehouse Provides | CodeGraph Needs? |
|---------|-------------------|------------------|
| ACID transactions | Multiple writers safely | ❌ Single writer per package |
| Time travel | Query old versions | ❌ Git provides this |
| Schema evolution | Track schema changes | ❌ Regenerate from source |
| Change data feed | What changed | ❌ Full regeneration |
| Compaction | Merge small files | ❌ One file per table |

**Key insight:** Seeds are regenerated from source code, not incrementally updated. Plain Parquet is sufficient and simpler.

### When Lakehouse Makes Sense: OTel Tracing

If DevAC evolves to include continuous tracing data:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  PLAIN PARQUET (problematic for traces)                                     │
│                                                                             │
│  traces/                                                                    │
│  ├── 2025-01-15/                                                            │
│  │   ├── spans_00.parquet    (10 MB)                                        │
│  │   ├── spans_01.parquet    (10 MB)                                        │
│  │   ├── spans_02.parquet    (10 MB)                                        │
│  │   └── ... (hundreds of small files)                                      │
│  └── 2025-01-16/                                                            │
│      └── ...                                                                │
│                                                                             │
│  Problems:                                                                  │
│  • Many small files (one per batch of spans)                                │
│  • Must track files manually                                                │
│  • Delete old data = delete files manually                                  │
│  • No compaction                                                            │
│  • Concurrent appends can corrupt                                           │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  DUCKLAKE (solves these problems)                                           │
│                                                                             │
│  traces.ducklake                                                            │
│  ├── ducklake.db              ← Transaction log                            │
│  └── data/                                                                  │
│      └── *.parquet            ← Managed Parquet files                      │
│                                                                             │
│  Benefits:                                                                  │
│  • Automatic compaction (merge small files)                                 │
│  • Expiration: DELETE WHERE timestamp < '7 days ago'                        │
│  • Concurrent appends safe                                                  │
│  • Time travel for debugging                                                │
│  • Native DuckDB integration                                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Future Architecture with Tracing

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  CURRENT (CodeGraph only)                                                   │
│                                                                             │
│    Source Code ──► DuckDB ──► Parquet Seeds ◄── DuckDB Central             │
│                    (analyze)  (plain files)     (query)                     │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  FUTURE (CodeGraph + Tracing)                                               │
│                                                                             │
│    Source Code ──► DuckDB ──► Parquet Seeds ◄──┐                           │
│                    (analyze)  (plain)          │                            │
│                                                │                            │
│    OTel Agent ──► DuckLake ──► Parquet ◄───────┼── DuckDB Central          │
│                   (managed)   (compacted)      │   (unified query)          │
│                                                │                            │
│    ┌──────────────────────────────────────────┘                            │
│    │                                                                        │
│    │  Unified queries across code and runtime:                              │
│    │                                                                        │
│    │  SELECT                                                                │
│    │    n.name as function_name,                                            │
│    │    AVG(s.duration_ms) as avg_latency                                   │
│    │  FROM read_parquet('**/nodes.parquet') n                               │
│    │  JOIN traces.spans s ON s.function_id = n.id                           │
│    │  GROUP BY n.name                                                       │
│    │                                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### DuckLake Example (Future Reference)

```sql
-- Create a DuckLake database for traces
ATTACH 'ducklake:~/.devac/traces.ducklake' AS traces;

-- Create spans table
CREATE TABLE traces.spans (
  trace_id VARCHAR,
  span_id VARCHAR,
  parent_span_id VARCHAR,
  service_name VARCHAR,
  operation_name VARCHAR,
  timestamp TIMESTAMP,
  duration_ms DOUBLE,
  function_id VARCHAR,  -- Links to code graph
  attributes JSON
);

-- Continuous append from OTel collector
INSERT INTO traces.spans VALUES (...);

-- Automatic compaction (merge small files)
CALL traces.compact('spans');

-- Expiration (delete data older than 7 days)
DELETE FROM traces.spans WHERE timestamp < NOW() - INTERVAL '7 days';

-- Time travel (debug what happened yesterday)
SELECT * FROM traces.spans VERSION AS OF 123;

-- Query across code graph and traces
SELECT 
  n.name,
  n.file_path,
  COUNT(*) as invocations,
  AVG(s.duration_ms) as avg_latency,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.duration_ms) as p95
FROM read_parquet('**/nodes.parquet') n
JOIN traces.spans s ON s.function_id = n.id
WHERE s.timestamp > NOW() - INTERVAL '1 hour'
GROUP BY n.name, n.file_path
ORDER BY p95 DESC;
```

### Decision Matrix: When to Use What

| Data Type | Update Pattern | Format | Rationale |
|-----------|---------------|--------|-----------|
| Code graph seeds | Regenerate on change | Plain Parquet | Simple, git versioned |
| Cross-repo edges | Computed periodically | DuckDB table | Small, queryable |
| OTel spans | Continuous append | DuckLake | Compaction, expiration |
| OTel metrics | Continuous append | DuckLake | Time-series, rollups |
| Embeddings | Regenerate with code | Plain Parquet | Batch updated |

### Migration Path to DuckLake

When tracing is added, existing plain Parquet data can be imported:

```sql
-- Create DuckLake table
ATTACH 'ducklake:traces.ducklake' AS traces;
CREATE TABLE traces.spans (...);

-- Import existing Parquet files
INSERT INTO traces.spans 
SELECT * FROM read_parquet('old_traces/**/*.parquet');

-- Now managed by DuckLake
-- Old files can be deleted after verification
```

---

## Migration Path (If Ever Needed)

DuckDB can export directly to PostgreSQL:

```sql
-- Attach PostgreSQL
ATTACH 'postgresql://user:pass@localhost/devac' AS pg (TYPE postgres);

-- Copy all data
CREATE TABLE pg.nodes AS SELECT * FROM read_parquet('**/nodes.parquet');
CREATE TABLE pg.edges AS SELECT * FROM read_parquet('**/edges.parquet');

-- Or for ongoing sync
INSERT INTO pg.nodes 
SELECT * FROM read_parquet('**/nodes.parquet')
ON CONFLICT (id) DO UPDATE SET ...;
```

**You probably won't need this**, but the escape hatch exists.

---

## Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ARCHITECTURE SUMMARY                                                       │
│                                                                             │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐        │
│  │    Analyzers     │   │  Parquet Seeds   │   │   Central Hub    │        │
│  │                  │   │                  │   │                  │        │
│  │  DuckDB          │──▶│  nodes.parquet   │◀──│  DuckDB          │        │
│  │  (in-memory)     │   │  edges.parquet   │   │  (queries        │        │
│  │                  │   │  refs.parquet    │   │   directly)      │        │
│  └──────────────────┘   └──────────────────┘   └──────────────────┘        │
│                                                                             │
│  CURRENT (CodeGraph):                                                       │
│  • Single technology: DuckDB + Parquet everywhere                           │
│  • No data duplication: files ARE the database                              │
│  • No sync step: query Parquet directly                                     │
│  • Native types: boolean, json, arrays                                      │
│  • ~100ms startup, ~100MB memory                                            │
│                                                                             │
│  FUTURE (Tracing):                                                          │
│  • Add DuckLake for continuous OTel data                                    │
│  • Automatic compaction and expiration                                      │
│  • Unified queries across code and runtime                                  │
│                                                                             │
│  ESCAPE HATCHES:                                                            │
│  • PostgreSQL if needed (pgvector, AGE, multi-user)                         │
│  • Iceberg/Delta for enterprise data lake integration                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix: Abstract Data Model

> **Note:** The following illustrates the conceptual data model. Concrete schemas will be defined in dedicated specifications.

### Conceptual Entities

```
┌─────────────────┐         ┌─────────────────┐
│      Node       │         │  Relationship   │
├─────────────────┤         ├─────────────────┤
│ id (VARCHAR)    │◀────────│ source_id       │
│ package_id      │         │ target_id       │
│ type            │────────▶│ type            │
│ name            │         │ metadata (JSON) │
│ file_path       │         └─────────────────┘
│ start_line      │
│ is_exported     │ ← BOOLEAN (native)
│ tags            │ ← VARCHAR[] (native)
│ metadata        │ ← JSON (native)
└─────────────────┘
         │
         │ references
         ▼
┌─────────────────┐
│  External Ref   │
├─────────────────┤
│ id              │
│ node_id         │
│ target_package  │
│ target_symbol   │
│ is_internal     │ ← BOOLEAN (native)
└─────────────────┘
```

### Global ID Format

```
{repo}:{package_path}:{entity_type}:{content_hash}

Examples:
  repo-mobile:packages/app:function:a1b2c3d4
  repo-mobile:packages/ui:component:e5f6g7h8
  repo-web:apps/main:hook:i9j0k1l2
```

---

## References

- [DuckDB Documentation](https://duckdb.org/docs/)
- [DuckDB Parquet Support](https://duckdb.org/docs/data/parquet/overview)
- [Apache Parquet Format](https://parquet.apache.org/docs/)
- [DuckDB Node.js API](https://duckdb.org/docs/api/nodejs/overview)