# Federated CodeGraph Architecture

**System:** DevAC, CodeGraph, Vision-View-Effects  
**Version:** 3.0  
**Status:** Draft  
**Last Updated:** 2025-01-XX

---

## Overview

This specification describes a federated architecture for storing and querying code analysis data across multiple repositories and packages. The design optimizes for a single developer working on a laptop with multiple codebases.

> **Note on Examples:** This document uses abstract "nodes" and "relationships" as illustrative examples. These are intentionally generic and should not be interpreted as final schema definitions. Concrete data structures will be defined in separate, dedicated specifications.

---

## Core Concept

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   SOURCE CODE          SEED FILES           CENTRAL DATABASE                │
│   (truth)              (portable)           (queryable)                     │
│                                                                             │
│   ┌─────────┐          ┌─────────┐          ┌─────────────────┐            │
│   │ .ts     │  analyze │  .csv   │   sync   │                 │            │
│   │ .tsx    │ ───────▶ │  files  │ ───────▶ │  PostgreSQL     │            │
│   │ .py     │          │         │          │                 │            │
│   │ ...     │          └─────────┘          └─────────────────┘            │
│   └─────────┘          in repo              on laptop                       │
│                                                                             │
│   Can always           Git-friendly         Full SQL queries                │
│   regenerate           Human-readable       Cross-repo JOINs                │
│                        Small files          Single instance                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Insight:** Source code is the source of truth. Everything else is derived and can be regenerated. This removes durability concerns and enables aggressive caching strategies.

---

## Architecture Layers

### Three-Layer Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  LAYER 3: CENTRAL (Query Layer)                                             │
│  └── Single embedded-postgres instance on developer's laptop                │
│      └── All data merged, all queries run here                              │
│                                                                             │
│                              ▲                                              │
│                              │ sync (COPY FROM)                             │
│                              │                                              │
│  LAYER 2: REPOSITORY (Organization Layer)                                   │
│  └── Manifest files describing what packages exist                          │
│      └── No database, just JSON metadata                                    │
│                                                                             │
│                              ▲                                              │
│                              │ references                                   │
│                              │                                              │
│  LAYER 1: PACKAGE (Analysis Layer)                                          │
│  └── Seed files (CSV) produced by language-specific analyzers               │
│      └── No database, just portable data files                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### What Lives Where

| Layer | Location | Contains | Format |
|-------|----------|----------|--------|
| Package | `{repo}/{package}/.devac/seed/` | Analysis results | CSV files |
| Repository | `{repo}/.devac/` | Package index | JSON files |
| Central | `~/.devac/pgdata/` | All merged data | PostgreSQL |

---

## Data Flow

### Analysis Flow (Code → Seeds)

```mermaid
flowchart LR
    subgraph Package ["Package (e.g., packages/app)"]
        SC[Source Code<br/>.ts, .tsx, .py]
        AN[Analyzer<br/>ts-morph, AST]
        SD[Seed Files<br/>.csv]
        
        SC --> AN --> SD
    end
    
    subgraph Context ["Analyzer Context"]
        TC[tsconfig.json]
        PJ[package.json]
        
        TC -.-> AN
        PJ -.-> AN
    end
```

Each analyzer operates within its package's context (e.g., ts-morph uses the local tsconfig.json), producing seed files that describe the code structure.

### Sync Flow (Seeds → Central)

```mermaid
flowchart TB
    subgraph Repos ["Repositories"]
        subgraph R1 ["repo-mobile"]
            P1[packages/app/seed/]
            P2[packages/ui/seed/]
        end
        
        subgraph R2 ["repo-web"]
            P3[apps/web/seed/]
        end
    end
    
    subgraph Central ["Central Hub (~/.devac)"]
        PG[(PostgreSQL)]
    end
    
    P1 -->|COPY FROM| PG
    P2 -->|COPY FROM| PG
    P3 -->|COPY FROM| PG
    
    PG -->|Resolve| CE[Cross-package edges]
    PG -->|Resolve| RE[Cross-repo edges]
```

The central hub imports all seed files and resolves relationships that span package and repository boundaries.

---

## Sequence Diagrams

### Package Analysis Sequence

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant CLI as DevAC CLI
    participant Ana as Analyzer
    participant FS as File System
    
    Dev->>CLI: devac analyze
    CLI->>FS: Read source files
    CLI->>Ana: Initialize with package context
    
    loop Each source file
        Ana->>Ana: Parse AST
        Ana->>Ana: Extract nodes
        Ana->>Ana: Extract relationships
        Ana->>Ana: Track external references
    end
    
    Ana->>FS: Write seed/nodes.csv
    Ana->>FS: Write seed/relationships.csv
    Ana->>FS: Write seed/external_refs.csv
    Ana->>FS: Write meta.json
    
    CLI->>Dev: Analysis complete ✓
```

### Central Sync Sequence

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Hub as Central Hub
    participant PG as PostgreSQL
    participant FS as File System
    
    Dev->>Hub: devac hub sync
    Hub->>FS: Read repo manifests
    Hub->>FS: Find all package seeds
    
    loop Each package
        Hub->>FS: Check source_hash
        alt Hash changed
            Hub->>PG: DELETE FROM nodes WHERE package_id = X
            Hub->>FS: Read seed CSV files
            Hub->>PG: COPY FROM nodes.csv
            Hub->>PG: COPY FROM relationships.csv
        else Hash unchanged
            Hub->>Hub: Skip (already synced)
        end
    end
    
    Hub->>PG: Resolve cross-package edges
    Hub->>PG: Resolve cross-repo edges
    Hub->>Dev: Sync complete ✓
```

### Query Sequence

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant UI as DevAC UI
    participant Hub as Central Hub
    participant PG as PostgreSQL
    
    Dev->>UI: "Show dependencies of LoginScreen"
    UI->>Hub: Query request
    Hub->>PG: SELECT with JOINs across packages
    PG->>Hub: Result set
    Hub->>UI: Structured response
    UI->>Dev: Visualization
```

---

## State Diagrams

### Package State

```mermaid
stateDiagram-v2
    [*] --> Unanalyzed: New package
    
    Unanalyzed --> Analyzing: devac analyze
    Analyzing --> Analyzed: Success
    Analyzing --> Error: Failure
    
    Analyzed --> Stale: Source code changes
    Stale --> Analyzing: devac analyze
    
    Analyzed --> Synced: devac hub sync
    Synced --> Stale: Source code changes
    Stale --> Synced: Re-analyze + sync
    
    Error --> Analyzing: Retry
    
    note right of Analyzed
        Seeds exist and match
        current source code
    end note
    
    note right of Synced
        Central DB contains
        this package's data
    end note
```

### Central Hub State

```mermaid
stateDiagram-v2
    [*] --> Stopped: Initial
    
    Stopped --> Starting: devac hub start
    Starting --> Running: PostgreSQL ready
    Starting --> Error: Startup failed
    
    Running --> Syncing: devac hub sync
    Syncing --> Running: Sync complete
    Syncing --> Running: Sync failed (partial)
    
    Running --> Watching: devac hub watch
    Watching --> Syncing: File change detected
    Watching --> Running: Stop watching
    
    Running --> Stopped: devac hub stop
    
    Error --> Stopped: Cleanup
```

---

## Database Architecture

### Single Instance, Multiple Databases

```mermaid
flowchart TB
    subgraph Instance ["embedded-postgres (single instance, port 5433)"]
        subgraph Central ["devac_central"]
            N1[(nodes)]
            R1[(relationships)]
            CP[(cross_package_edges)]
            CR[(cross_repo_edges)]
        end
        
        subgraph Workspace ["devac_workspace"]
            T1[(temp tables)]
            M1[(materialized views)]
        end
        
        subgraph Test ["devac_test"]
            N2[(nodes)]
            R2[(relationships)]
        end
    end
    
    Q[Queries] --> Central
    A[Analysis Jobs] --> Workspace
    TS[Test Suite] --> Test
```

### Why This Structure?

| Database | Purpose | Lifecycle |
|----------|---------|-----------|
| `devac_central` | All production queries | Persistent, synced from seeds |
| `devac_workspace` | Heavy analysis, temp results | Can be cleared anytime |
| `devac_test` | Automated tests | Reset between test runs |

**Key Benefits:**
- Single postgres process (~100MB RAM)
- Native JOINs across all data (no federation complexity)
- Test isolation without instance overhead
- Simple mental model

---

## File Structure

### Package Level

```
packages/app/
├── src/                          # Source code (the truth)
│   └── ...
├── package.json
├── tsconfig.json
└── .devac/
    ├── meta.json                 # Analysis metadata
    └── seed/
        ├── nodes.csv             # Extracted code elements
        ├── relationships.csv     # Connections between elements
        └── external_refs.csv     # References to outside packages
```

### Repository Level

```
repo-mobile/
├── packages/
│   ├── app/.devac/seed/...
│   ├── ui/.devac/seed/...
│   └── hooks/.devac/seed/...
└── .devac/
    ├── manifest.json             # Repo metadata
    └── packages.json             # Index of all packages
```

### Central Level

```
~/.devac/
├── config.json                   # Global configuration
├── registry.json                 # Registered repositories
├── pgdata/                       # PostgreSQL data directory
│   └── ...
└── snapshots/                    # Point-in-time backups
    └── ...
```

---

## Sync Strategies

### Full Sync

```mermaid
flowchart LR
    A[All Packages] -->|COPY all seeds| B[(Central DB)]
    B -->|Rebuild| C[All edges resolved]
```

**When:** Initial setup, after major changes, recovery from corruption.

### Incremental Sync

```mermaid
flowchart LR
    A[Changed Packages] -->|Check hash| B{Hash match?}
    B -->|No| C[COPY changed seeds]
    B -->|Yes| D[Skip]
    C --> E[Re-resolve affected edges]
```

**When:** Normal development workflow. Only packages with changed `source_hash` are re-imported.

### Watch Mode

```mermaid
flowchart LR
    A[File Watcher] -->|Detects change| B[packages.json]
    B -->|Triggers| C[Incremental Sync]
    C -->|Updates| D[(Central DB)]
```

**When:** Active development. Central stays in sync automatically.

---

## Cross-Boundary Edge Resolution

### The Problem

Packages analyze in isolation but reference each other:

```
┌─────────────────┐         ┌─────────────────┐
│  packages/app   │         │  packages/ui    │
│                 │         │                 │
│  import {       │────?────│  export const   │
│    Button       │         │    Button = ... │
│  } from '../ui' │         │                 │
└─────────────────┘         └─────────────────┘

During analysis, packages/app doesn't know
Button's node ID in packages/ui
```

### The Solution

```mermaid
flowchart TB
    subgraph Analysis ["Analysis Phase (per package)"]
        A1[packages/app analyzer]
        A2[packages/ui analyzer]
        
        A1 -->|Records| ER[external_ref:<br/>target='../ui'<br/>symbol='Button']
        A2 -->|Records| EX[export:<br/>name='Button'<br/>node_id='xyz']
    end
    
    subgraph Resolution ["Resolution Phase (central)"]
        ER --> M{Match}
        EX --> M
        M -->|Creates| CE[cross_package_edge:<br/>app:import → ui:Button]
    end
```

The central database has all the information needed to resolve these references after all packages are imported.

---

## Developer Experience

### Typical Workflow

```mermaid
flowchart TB
    subgraph Morning ["Start of Day"]
        A[Open laptop] --> B[devac hub start]
        B --> C[Hub auto-syncs registered repos]
    end
    
    subgraph Development ["During Development"]
        D[Write code] --> E[devac analyze]
        E --> F[Seeds updated]
        F --> G[Hub detects change]
        G --> H[Auto-sync to central]
        H --> I[Query/visualize]
        I --> D
    end
    
    subgraph Evening ["End of Day"]
        J[devac hub stop]
    end
    
    Morning --> Development --> Evening
```

### CLI Commands

```bash
# Package operations
devac analyze                    # Analyze current package
devac analyze --all              # Analyze all packages in repo

# Hub operations  
devac hub start                  # Start PostgreSQL
devac hub stop                   # Stop PostgreSQL
devac hub sync                   # Sync all registered repos
devac hub watch                  # Watch and auto-sync

# Repository operations
devac hub register .             # Register current repo
devac hub register ~/code/other  # Register another repo

# Query operations
devac query "SELECT ..."         # Run SQL query
```

---

## Resource Usage

### Memory Footprint

```
┌─────────────────────────────────────────────────────┐
│  embedded-postgres instance                         │
│                                                     │
│  Baseline:           ~100 MB                        │
│  With typical data:  ~150-300 MB                    │
│  Maximum expected:   ~500 MB                        │
│                                                     │
│  Compare to alternatives:                           │
│  - Instance per repo (4 repos): ~400 MB baseline    │
│  - Instance per package (20 pkgs): ~2 GB baseline   │
└─────────────────────────────────────────────────────┘
```

### Startup Time

```
First start (initialization):  10-30 seconds
Subsequent starts:             2-5 seconds
Database creation:             < 1 second
Sync (incremental):            1-5 seconds typical
Sync (full, large repo):       10-30 seconds
```

---

## Testing Strategy

### Same Engine for Tests and Production

```mermaid
flowchart LR
    subgraph Engine ["embedded-postgres"]
        A[(devac_central)]
        B[(devac_test)]
    end
    
    C[Production Code] --> A
    D[Test Suite] --> B
    
    E[Same SQL] --> A
    E --> B
```

**Benefit:** No "works in tests, fails in production" surprises.

### Test Isolation

```mermaid
sequenceDiagram
    participant T1 as Test Suite 1
    participant T2 as Test Suite 2
    participant PG as PostgreSQL
    
    Note over PG: Shared instance
    
    T1->>PG: CREATE DATABASE test_abc123
    T2->>PG: CREATE DATABASE test_def456
    
    par Parallel execution
        T1->>PG: Run tests in test_abc123
        T2->>PG: Run tests in test_def456
    end
    
    T1->>PG: DROP DATABASE test_abc123
    T2->>PG: DROP DATABASE test_def456
```

Each test suite gets its own database within the shared instance. Database creation is instant, providing isolation without instance startup overhead.

---

## Comparison: Why Not Alternatives?

### Why Not PGlite?

| Aspect | PGlite | embedded-postgres |
|--------|--------|-------------------|
| Size limit | ~50-200 MB practical | No practical limit |
| Performance | WASM overhead | Native speed |
| Extensions | Limited | Full PostgreSQL |
| Tooling | Custom only | psql, pg_dump, etc. |

**Decision:** embedded-postgres for production, with PGlite remaining an option for future browser-based features.

### Why Not Database per Package?

```
50 packages × ~5MB overhead = 250MB wasted
+ Cross-package queries require Foreign Data Wrappers
+ Connection pool per database
+ Complex lifecycle management

vs.

1 database with package_id column
+ Native JOINs
+ Single connection pool
+ Simple operations
```

### Why Not Instance per Repo?

```
4 repos × 100MB = 400MB baseline (just sitting idle)
+ 4 ports to manage
+ 4 processes to start/stop
+ Cross-repo queries need FDW

vs.

1 instance with repo_id column
+ Single 100MB baseline
+ 1 port
+ 1 process
+ Native JOINs
```

---

## Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ARCHITECTURE SUMMARY                                                       │
│                                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────────────────┐   │
│  │   Package   │     │ Repository  │     │          Central            │   │
│  │             │     │             │     │                             │   │
│  │  Analyzers  │────▶│  Manifests  │────▶│  embedded-postgres          │   │
│  │  → Seeds    │     │  (JSON)     │     │  ├── devac_central          │   │
│  │  (CSV)      │     │             │     │  ├── devac_workspace        │   │
│  │             │     │             │     │  └── devac_test             │   │
│  └─────────────┘     └─────────────┘     └─────────────────────────────┘   │
│                                                                             │
│  • 1 postgres instance (~100MB RAM)                                         │
│  • 3 databases (central, workspace, test)                                   │
│  • Seeds as portable CSV files                                              │
│  • Full SQL with native JOINs                                               │
│  • Same engine for dev and test                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix: Abstract Data Model

> **Note:** The following is an abstract illustration of the data model. It uses generic "nodes" and "relationships" terminology to convey the concept without prescribing specific schema details. Concrete schemas will be defined in dedicated specifications.

### Conceptual Entities

```
┌─────────────────┐         ┌─────────────────┐
│      Node       │         │  Relationship   │
├─────────────────┤         ├─────────────────┤
│ id              │────────▶│ source_id       │
│ package_id      │◀────────│ target_id       │
│ type            │         │ type            │
│ name            │         │ metadata        │
│ location        │         └─────────────────┘
│ metadata        │
└─────────────────┘
         │
         │ references
         ▼
┌─────────────────┐
│  External Ref   │
├─────────────────┤
│ from_node_id    │
│ target_package  │
│ target_symbol   │
│ resolved_to     │ ← Populated during sync
└─────────────────┘
```

### Example Node Types (Illustrative)

- Function definitions
- Class definitions
- Component definitions
- Type definitions
- Import statements
- Export statements

### Example Relationship Types (Illustrative)

- Calls (function → function)
- Imports (file → symbol)
- Extends (class → class)
- Implements (class → interface)
- Renders (component → component)

These abstractions allow the architecture to support various analysis use cases (code structure, Vision-View-Effects, dependencies) without coupling to specific implementations.

---

## References

- [embedded-postgres npm package](https://www.npmjs.com/package/embedded-postgres)
- [PostgreSQL COPY documentation](https://www.postgresql.org/docs/current/sql-copy.html)
- [Mermaid diagram syntax](https://mermaid.js.org/syntax/flowchart.html)
