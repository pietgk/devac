# CodeGraph-Centric Validation: Deep Analysis

## The Challenge

We have been designing for a **monorepo** but reality is **multi-repo**:

```
Reality: Multiple independent repositories
──────────────────────────────────────────

~/code/
├── backend-api/           # C# .NET, separate repo
│   ├── .git/
│   └── src/
│       └── Controllers/
│           └── UserController.cs  → imports shared-schema types
│
├── shared-schema/         # TypeScript, separate repo
│   ├── .git/
│   └── src/
│       └── types.ts       → exports User, Post types
│
├── frontend-web/          # Next.js, separate repo
│   ├── .git/
│   └── src/
│       └── components/
│           └── UserCard.tsx  → imports shared-schema types
│
└── mobile-app/            # Expo, separate repo
    ├── .git/
    └── src/
        └── screens/
            └── Profile.tsx  → imports shared-schema types
```

**Developer workflow:**
1. Edit `shared-schema/src/types.ts` (change User type)
2. Edit `backend-api/src/Controllers/UserController.cs` (update API)
3. Edit `frontend-web/src/components/UserCard.tsx` (update UI)
4. Need validation across ALL three repos

---

## The Question: Can CodeGraph Be The Source?

Instead of:
- Parsing package.json, *.csproj, pyproject.toml for dependencies
- Building a manifest-derived dependency graph
- Running project-level cascade

Use:
- CodeGraph's `external_refs` (tracks all imports from other modules)
- Symbol-level precision (not project-level)
- Already exists, already language-agnostic

---

## What CodeGraph Already Tracks

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  CODEGRAPH STRUCTURE (per repo)                                            │
│                                                                             │
│  nodes.parquet:                                                             │
│  │ id       │ type     │ name    │ file           │ line │ exports │       │
│  │ node_001 │ function │ getUser │ src/api.ts     │ 10   │ true    │       │
│  │ node_002 │ type     │ User    │ src/types.ts   │ 5    │ true    │       │
│                                                                             │
│  edges.parquet:                                                             │
│  │ source   │ target   │ type      │                                       │
│  │ node_001 │ node_002 │ uses_type │  (getUser uses User type)             │
│                                                                             │
│  external_refs.parquet:                                                     │
│  │ source_file      │ module           │ symbol │ resolved │               │
│  │ src/UserCard.tsx │ @shared/schema   │ User   │ true     │               │
│  │ src/UserCard.tsx │ react            │ FC     │ true     │               │
│                                                                             │
│  The external_refs IS the dependency information!                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key insight:** `external_refs` already contains:
- What this repo imports from other repos/packages
- At symbol-level granularity (not just "depends on package X")

---

## CodeGraph vs Manifest Dependencies

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  MANIFEST APPROACH                 CODEGRAPH APPROACH                       │
│  (what specs assumed)              (what we're exploring)                   │
│                                                                             │
│  package.json:                     external_refs.parquet:                   │
│  {                                                                          │
│    "dependencies": {               │ file        │ module  │ symbol │      │
│      "@shared/schema": "1.0.0",    │ UserCard.tsx│ @shared │ User   │      │
│      "react": "^18.0.0"            │ UserCard.tsx│ react   │ FC     │      │
│    }                               │ Profile.tsx │ @shared │ User   │      │
│  }                                 │ api.ts      │ @shared │ Post   │      │
│                                                                             │
│  Granularity: PROJECT              Granularity: FILE + SYMBOL               │
│  "frontend depends on shared"      "UserCard imports User from shared"      │
│                                                                             │
│  Cascade: All of frontend          Cascade: Only files importing User       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Manifest says:** "frontend-web depends on @shared/schema"
**CodeGraph says:** "UserCard.tsx imports User, Profile.tsx imports User"

If you change `Post` type but `UserCard.tsx` only uses `User`:
- Manifest: Validate all of frontend-web ❌
- CodeGraph: Skip UserCard.tsx, only validate files using Post ✓

---

## Affected Detection Using CodeGraph

### Scenario: Change shared-schema/src/types.ts

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  STEP 1: Identify what changed                                              │
│                                                                             │
│  Changed file: shared-schema/src/types.ts                                   │
│  Changed exports: User (modified), Post (unchanged)                         │
│                                                                             │
│  STEP 2: Update shared-schema CodeGraph (incremental)                       │
│                                                                             │
│  Only reparse types.ts, update nodes for User                               │
│                                                                             │
│  STEP 3: Query external_refs across ALL repos                               │
│                                                                             │
│  SELECT source_file, repo                                                   │
│  FROM all_repos_external_refs                                               │
│  WHERE module = '@shared/schema'                                            │
│    AND symbol = 'User'                                                      │
│                                                                             │
│  Results:                                                                   │
│  │ repo         │ source_file              │                                │
│  │ frontend-web │ src/components/UserCard.tsx │                             │
│  │ frontend-web │ src/pages/Profile.tsx       │                             │
│  │ mobile-app   │ src/screens/Profile.tsx     │                             │
│  │ backend-api  │ src/Controllers/UserCtrl.cs │                             │
│                                                                             │
│  STEP 4: Run validators on ONLY these files                                 │
│                                                                             │
│  typecheck frontend-web/src/components/UserCard.tsx                         │
│  typecheck frontend-web/src/pages/Profile.tsx                               │
│  typecheck mobile-app/src/screens/Profile.tsx                               │
│  dotnet build backend-api (for UserController.cs)                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

This is **much more precise** than project-level cascade!

---

## Multi-Repo Federation

### How do repos discover each other?

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  OPTION A: Sibling Directory Scanning                                       │
│  ─────────────────────────────────────                                      │
│                                                                             │
│  ~/code/                                                                    │
│  ├── backend-api/.devac/codegraph/                                         │
│  ├── shared-schema/.devac/codegraph/                                       │
│  ├── frontend-web/.devac/codegraph/                                        │
│  └── mobile-app/.devac/codegraph/                                          │
│                                                                             │
│  DevAC in any repo can scan siblings for their CodeGraphs.                  │
│  No central service needed.                                                 │
│                                                                             │
│  Config: ~/.devac/config.yaml                                              │
│  repos:                                                                     │
│    - ~/code/backend-api                                                     │
│    - ~/code/shared-schema                                                   │
│    - ~/code/frontend-web                                                    │
│    - ~/code/mobile-app                                                      │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  OPTION B: Export Registry                                                  │
│  ────────────────────────                                                   │
│                                                                             │
│  Each repo publishes its exports to a shared location:                      │
│                                                                             │
│  ~/.devac/registry/                                                        │
│  ├── @shared_schema.parquet   # What shared-schema exports                 │
│  ├── @backend_api.parquet     # What backend-api exports                   │
│  └── @frontend_web.parquet    # What frontend-web exports                  │
│                                                                             │
│  When shared-schema rebuilds, it updates registry.                          │
│  Other repos query registry to find importers.                              │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  OPTION C: Federated Query (Recommended)                                    │
│  ─────────────────────────────────────────                                  │
│                                                                             │
│  Each repo maintains its own CodeGraph.                                     │
│  DevAC federates queries across configured repos.                           │
│                                                                             │
│  Query: "Who imports User from @shared/schema?"                             │
│                                                                             │
│  1. List configured repos from ~/.devac/repos.yaml                         │
│  2. For each repo, query its external_refs.parquet                         │
│  3. Aggregate results                                                       │
│                                                                             │
│  SELECT r.name, er.source_file                                              │
│  FROM repos r                                                               │
│  JOIN read_parquet(r.path || '/.devac/codegraph/external_refs.parquet') er │
│  WHERE er.module = '@shared/schema' AND er.symbol = 'User'                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Recommendation:** Option C (Federated Query)
- No central service
- Each repo is independent
- Queries span repos when needed
- Simple config file lists known repos

---

## Incremental CodeGraph Updates

**This is critical.** Full rebuild on every change is too slow.

### Current State (Need to Verify)

Questions:
1. Does CodeGraph currently rebuild entirely on each change?
2. Or can it update just the changed files?
3. How are nodes/edges stored - as single file or partitioned?

### Required: File-Level Partitioning

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  PARTITIONED STORAGE FOR INCREMENTAL UPDATES                                │
│                                                                             │
│  Instead of:                       Use:                                     │
│  ─────────────                     ────                                     │
│                                                                             │
│  .devac/codegraph/                 .devac/codegraph/                        │
│  ├── nodes.parquet (all)           ├── nodes/                               │
│  ├── edges.parquet (all)           │   ├── src_types_ts.parquet            │
│  └── external_refs.parquet         │   ├── src_utils_ts.parquet            │
│                                    │   └── src_api_ts.parquet              │
│  Update = rebuild all              ├── edges/                               │
│                                    │   ├── src_types_ts.parquet            │
│                                    │   └── ...                              │
│                                    └── external_refs/                       │
│                                        ├── src_types_ts.parquet            │
│                                        └── ...                              │
│                                                                             │
│                                    Update = replace single file's parquet  │
│                                                                             │
│  QUERY STILL WORKS:                                                         │
│                                                                             │
│  SELECT * FROM read_parquet('.devac/codegraph/nodes/*.parquet')            │
│  -- DuckDB glob reads all partitions as one table                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Update Flow

```
File changed: src/types.ts

1. Delete old partition:
   rm .devac/codegraph/nodes/src_types_ts.parquet
   rm .devac/codegraph/edges/src_types_ts.parquet
   rm .devac/codegraph/external_refs/src_types_ts.parquet

2. Parse src/types.ts → extract nodes, edges, external_refs

3. Write new partitions:
   write .devac/codegraph/nodes/src_types_ts.parquet
   write .devac/codegraph/edges/src_types_ts.parquet
   write .devac/codegraph/external_refs/src_types_ts.parquet

4. Done! Other files' partitions unchanged.

Time: ~50-100ms for single file (parse + write)
```

---

## Manifest Dependencies AS CodeGraph Data

Piet's insight: Manifest dependencies can be IN the CodeGraph too.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  UNIFIED DEPENDENCY MODEL                                                   │
│                                                                             │
│  external_refs.parquet:                                                     │
│  │ source_file     │ module         │ symbol │ ref_type    │               │
│  │ src/UserCard.tsx│ @shared/schema │ User   │ code_import │ ← from code   │
│  │ src/api.ts      │ @shared/schema │ Post   │ code_import │               │
│  │ package.json    │ @shared/schema │ *      │ manifest    │ ← from manifest│
│  │ package.json    │ react          │ *      │ manifest    │               │
│                                                                             │
│  Two types of references:                                                   │
│  1. code_import  - Actual import statements in code                        │
│  2. manifest     - Declared in package.json/csproj/pyproject.toml          │
│                                                                             │
│  WHY BOTH?                                                                  │
│                                                                             │
│  code_import: Precise, tells you exactly what's used                       │
│  manifest:    Declared, might include unused deps, build deps              │
│                                                                             │
│  For validation cascade: Use code_import (precise)                         │
│  For security audit: Use manifest (declared deps)                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Pros and Cons Analysis

### PROS of CodeGraph-Centric Approach

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  1. SYMBOL-LEVEL PRECISION                                                  │
│                                                                             │
│  Manifest: "ui depends on shared" → validate ALL of ui                     │
│  CodeGraph: "UserCard imports User" → validate only UserCard               │
│                                                                             │
│  HUGE reduction in validation scope                                         │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  2. ALREADY EXISTS                                                          │
│                                                                             │
│  We've built CodeGraph infrastructure                                       │
│  nodes, edges, external_refs already tracked                                │
│  Don't need to build parallel dependency system                             │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  3. LANGUAGE-AGNOSTIC BY DESIGN                                             │
│                                                                             │
│  CodeGraph handles TS, Python, C# with same structure                       │
│  external_refs works for any language's imports                             │
│  No special handling per manifest format                                    │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  4. MULTI-REPO NATIVE                                                       │
│                                                                             │
│  Each repo has its own CodeGraph (independent)                              │
│  external_refs naturally track cross-repo deps                              │
│  No "workspace" concept needed                                              │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  5. UNIFIED MODEL                                                           │
│                                                                             │
│  Dependencies AND code intelligence in one system                           │
│  Callers, callees, effects, AND import relationships                       │
│  Query any aspect with same tooling                                         │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  6. ENRICHMENT IS FREE                                                      │
│                                                                             │
│  CodeGraph already knows about callers, callees, effects                   │
│  Issue enrichment doesn't need separate queries                             │
│  "Who calls this function?" is already in edges                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### CONS of CodeGraph-Centric Approach

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  1. CODEGRAPH MUST BE UP-TO-DATE                                           │
│                                                                             │
│  Stale CodeGraph = wrong affected detection                                │
│  If external_refs is outdated, might miss cascade                          │
│                                                                             │
│  MITIGATION: Incremental updates on file save                              │
│  File change → CodeGraph update → then query                               │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  2. INCREMENTAL UPDATES MUST BE FAST                                        │
│                                                                             │
│  Current implementation might do full rebuild?                              │
│  Need partitioned storage for O(1) file updates                            │
│                                                                             │
│  MITIGATION: Partition by file, update only changed partitions             │
│  VERIFY: Current CodeGraph implementation                                   │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  3. BOOTSTRAP PROBLEM                                                       │
│                                                                             │
│  First run: No CodeGraph exists yet                                        │
│  Must build CodeGraph before validation can work                           │
│                                                                             │
│  MITIGATION: Fall back to manifest-based for first run                     │
│  Or: Initial CodeGraph build is one-time cost                              │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  4. EXTERNAL REFS ACCURACY                                                  │
│                                                                             │
│  Must correctly track ALL imports                                          │
│  Dynamic imports, require(), re-exports are tricky                         │
│                                                                             │
│  MITIGATION: Already solved in TypeScript parser?                          │
│  VERIFY: Coverage of import patterns                                       │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  5. CROSS-REPO QUERY PERFORMANCE                                            │
│                                                                             │
│  Querying external_refs across many repos could be slow                    │
│  Each repo = one parquet read                                              │
│                                                                             │
│  MITIGATION: Cache federation results                                       │
│  Or: Build index of "who exports what"                                     │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  6. DOESN'T CATCH MANIFEST-ONLY DEPS                                        │
│                                                                             │
│  If package.json has dep but code doesn't import it:                       │
│  - Build tool deps (@types/*, eslint plugins)                              │
│  - Peer deps that are used transitively                                    │
│                                                                             │
│  MITIGATION: Include manifest deps in external_refs with type=manifest     │
│  These are used for audit, not cascade                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Verification Needed: Current CodeGraph Implementation

Before committing to this approach, we need to verify:

### 1. Storage Structure
```
QUESTION: How are nodes/edges/external_refs stored?
- Single file per table? (nodes.parquet)
- Partitioned by file? (nodes/src_types_ts.parquet)
- Partitioned by some other key?

NEEDED: File-level partitioning for fast incremental updates
```

### 2. Update Mechanism
```
QUESTION: How does CodeGraph update on file change?
- Full rebuild of all tables?
- Incremental update of changed file only?
- Something else?

NEEDED: O(1) update for single file change
```

### 3. External Refs Coverage
```
QUESTION: What import patterns are tracked?
- import { X } from 'module'     ✓?
- import X from 'module'         ✓?
- import * as X from 'module'    ✓?
- require('module')              ✓?
- dynamic import()               ✓?
- re-exports                     ✓?

NEEDED: Comprehensive tracking for accurate cascade
```

### 4. Cross-Language Support
```
QUESTION: Do all language parsers produce external_refs?
- TypeScript: ✓ (assumed)
- Python:     ?
- C#:         ?

NEEDED: Consistent external_refs for all languages
```

---

## Simplified Architecture

If CodeGraph is the source of truth:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  CODEGRAPH-CENTRIC VALIDATION ARCHITECTURE                                 │
│                                                                             │
│                                                                             │
│  EACH REPO (independent):                                                   │
│                                                                             │
│  repo/                                                                      │
│  ├── .devac/                                                               │
│  │   ├── codegraph/                 # THE source of truth                  │
│  │   │   ├── nodes/                 # Partitioned by file                  │
│  │   │   │   └── {file_hash}.parquet                                       │
│  │   │   ├── edges/                                                        │
│  │   │   │   └── {file_hash}.parquet                                       │
│  │   │   └── external_refs/                                                │
│  │   │       └── {file_hash}.parquet                                       │
│  │   │                                                                      │
│  │   ├── validation/                                                       │
│  │   │   └── issues/                                                       │
│  │   │       └── {validator}.parquet                                       │
│  │   │                                                                      │
│  │   └── config.yaml                # Repo-specific config                 │
│  │                                                                          │
│  └── src/                                                                  │
│                                                                             │
│                                                                             │
│  USER GLOBAL CONFIG:                                                        │
│                                                                             │
│  ~/.devac/                                                                 │
│  └── repos.yaml                     # List of known repos                  │
│      repos:                                                                 │
│        - path: ~/code/backend-api                                          │
│          name: backend-api                                                  │
│          module: @backend/api                                              │
│        - path: ~/code/shared-schema                                        │
│          name: shared-schema                                               │
│          module: @shared/schema                                            │
│        - path: ~/code/frontend-web                                         │
│          ...                                                                │
│                                                                             │
│                                                                             │
│  VALIDATION FLOW:                                                           │
│                                                                             │
│  1. File saved: shared-schema/src/types.ts                                 │
│        │                                                                    │
│        ▼                                                                    │
│  2. Update CodeGraph (incremental, <100ms)                                 │
│     - Reparse types.ts                                                      │
│     - Replace nodes/edges/external_refs partitions for types.ts            │
│        │                                                                    │
│        ▼                                                                    │
│  3. Detect changed exports                                                  │
│     - Compare new exports vs previous                                       │
│     - Changed: [User], Unchanged: [Post]                                   │
│        │                                                                    │
│        ▼                                                                    │
│  4. Query: Who imports changed symbols?                                     │
│     - Federated query across repos in ~/.devac/repos.yaml                  │
│     - Results: [{repo: frontend-web, file: UserCard.tsx}, ...]            │
│        │                                                                    │
│        ▼                                                                    │
│  5. Run validators                                                          │
│     QUICK (immediate):                                                      │
│     - typecheck changed file (types.ts)                                    │
│     - typecheck direct importers (UserCard.tsx, etc.)                      │
│                                                                             │
│     FULL (deferred to commit/push):                                        │
│     - typecheck all transitively affected                                  │
│     - lint                                                                  │
│     - test (affected tests)                                                │
│        │                                                                    │
│        ▼                                                                    │
│  6. Report issues                                                           │
│     - Store in validation/issues/                                           │
│     - Surface via MCP                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick vs Full Validation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  QUICK (on file save, <5s)                                                 │
│  ─────────────────────────                                                  │
│                                                                             │
│  Scope: Changed files + direct importers                                   │
│                                                                             │
│  Validators:                                                                │
│  • typecheck (incremental, only affected files)                            │
│  • lint (only changed files)                                               │
│                                                                             │
│  Why direct importers only:                                                │
│  • Catches most errors from API changes                                    │
│  • Fast enough for real-time feedback                                      │
│  • Transitive effects are rarer                                            │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  FULL (on commit/push/PR, may take minutes)                                │
│  ──────────────────────────────────────────                                 │
│                                                                             │
│  Scope: All transitively affected files                                    │
│                                                                             │
│  Validators:                                                                │
│  • typecheck (all affected)                                                │
│  • lint (all affected)                                                     │
│  • test (tests that cover affected code)                                   │
│  • audit (if deps changed)                                                 │
│                                                                             │
│  Why transitive:                                                            │
│  • A change in types.ts affects UserCard.tsx                               │
│  • UserCard.tsx change could affect pages importing it                     │
│  • Full cascade ensures nothing is missed                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Transitive Cascade via CodeGraph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  TRANSITIVE AFFECTED DETECTION                                              │
│                                                                             │
│  Changed: shared-schema/src/types.ts::User                                 │
│                                                                             │
│  Level 0 (changed):                                                         │
│  └── shared-schema/src/types.ts                                            │
│                                                                             │
│  Level 1 (direct importers):                                                │
│  Query: SELECT file FROM external_refs WHERE module='@shared/schema'       │
│         AND symbol='User'                                                   │
│  Results:                                                                   │
│  ├── frontend-web/src/components/UserCard.tsx                              │
│  ├── frontend-web/src/pages/Profile.tsx                                    │
│  └── mobile-app/src/screens/Profile.tsx                                    │
│                                                                             │
│  Level 2 (importers of level 1):                                           │
│  Query: SELECT file FROM edges WHERE target IN (level 1 files)             │
│         AND type='imports'                                                  │
│  Results:                                                                   │
│  ├── frontend-web/src/pages/Dashboard.tsx (imports UserCard)               │
│  └── frontend-web/src/App.tsx (imports Profile)                            │
│                                                                             │
│  Level 3... (continue until no new files)                                  │
│                                                                             │
│  QUICK validates: Level 0 + Level 1                                        │
│  FULL validates:  Level 0 + Level 1 + Level 2 + ...                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Comparison: Manifest vs CodeGraph

```
┌───────────────────────┬─────────────────────────┬─────────────────────────┐
│ Aspect                │ Manifest-Based          │ CodeGraph-Based         │
├───────────────────────┼─────────────────────────┼─────────────────────────┤
│ Granularity           │ Project-level           │ File/symbol-level       │
├───────────────────────┼─────────────────────────┼─────────────────────────┤
│ Precision             │ Over-validates          │ Precise                 │
├───────────────────────┼─────────────────────────┼─────────────────────────┤
│ Data source           │ package.json, csproj    │ Actual code (parsed)    │
├───────────────────────┼─────────────────────────┼─────────────────────────┤
│ Update speed          │ Fast (read manifest)    │ Must be incremental     │
├───────────────────────┼─────────────────────────┼─────────────────────────┤
│ Staleness risk        │ Low (manifest stable)   │ Higher (code changes)   │
├───────────────────────┼─────────────────────────┼─────────────────────────┤
│ Multi-language        │ Different per language  │ Same structure          │
├───────────────────────┼─────────────────────────┼─────────────────────────┤
│ Multi-repo            │ Need central config     │ Federated query         │
├───────────────────────┼─────────────────────────┼─────────────────────────┤
│ Already built         │ No                      │ Yes (CodeGraph exists)  │
├───────────────────────┼─────────────────────────┼─────────────────────────┤
│ Enrichment            │ Separate system         │ Same system             │
├───────────────────────┼─────────────────────────┼─────────────────────────┤
│ Complexity            │ Simpler logic           │ Incremental updates     │
└───────────────────────┴─────────────────────────┴─────────────────────────┘
```

---

## Recommendation

**Use CodeGraph as the source of truth for dependencies.**

### Why:
1. More precise (symbol-level, not project-level)
2. Already exists (don't build parallel system)
3. Language-agnostic (same structure for all)
4. Multi-repo native (no workspace concept needed)
5. Unified model (dependencies + code intelligence)

### Required Work:
1. **Verify/implement** incremental CodeGraph updates (file-level partitioning)
2. **Add** manifest dependencies to external_refs (for completeness)
3. **Build** federated query across repos
4. **Implement** transitive cascade algorithm

### Critical Path:
```
1. Verify CodeGraph update mechanism        [MUST CHECK]
2. Implement file-level partitioning        [IF NEEDED]
3. Federated query across repos             [NEW]
4. Quick vs Full validation modes           [NEW]
```

---

## Next Steps

1. **Audit current CodeGraph implementation**
   - How are nodes/edges/external_refs stored?
   - How does update work today?
   - What import patterns are tracked?

2. **Design incremental update mechanism**
   - File-level partitioning
   - Update flow on file save

3. **Design federated query**
   - ~/.devac/repos.yaml config
   - Cross-repo external_refs query

4. **Update spec v2.2**
   - Multi-repo (not monorepo)
   - CodeGraph-centric dependencies
   - Quick vs Full validation
