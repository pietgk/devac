# Storage Design Decisions: Hash Location & Delta Branch Storage

**Date:** 2025-12-13  
**Status:** UNDER REVIEW  
**Triggered by:** User challenges to current design

---

## Decision 1: File Content Hash Storage Location

### Context

The current design stores file content hashes in `meta.json`:

```json
{
  "fileHashes": {
    "src/auth.ts": "sha256:a1b2c3...",
    "src/utils.ts": "sha256:d4e5f6..."
  }
}
```

**Challenge:** Storing hashes in Parquet files seems more logical - single source of truth.

### Options Analyzed

#### Option A: Hashes in meta.json (Current)

```
.devac/
├── meta.json           ← Contains fileHashes
└── seed/
    └── branch=main/
        ├── nodes.parquet
        ├── edges.parquet
        └── external_refs.parquet
```

| Aspect | Assessment |
|--------|------------|
| Read speed | Fast (~5-10ms for JSON parse) |
| Sync risk | HIGH - can become out of sync with Parquet |
| Single source of truth | NO - two places for file info |
| Queryable | NO - separate from DuckDB queries |
| Atomic updates | NO - must update two files |

#### Option B: Separate file_hashes.parquet

```
.devac/seed/branch=main/
├── nodes.parquet
├── edges.parquet
├── external_refs.parquet
└── file_hashes.parquet   ← NEW: dedicated hash file
```

```sql
CREATE TABLE file_hashes (
  file_path VARCHAR NOT NULL,
  content_hash VARCHAR NOT NULL,
  file_size INTEGER,
  mtime TIMESTAMP,
  node_count INTEGER,
  PRIMARY KEY (file_path)
);
```

| Aspect | Assessment |
|--------|------------|
| Read speed | Fast (~10-20ms for small Parquet) |
| Sync risk | MEDIUM - separate file but same directory |
| Single source of truth | PARTIAL - still separate file |
| Queryable | YES - can JOIN with nodes |
| Atomic updates | NO - but in same transaction |

#### Option C: Hash as Column in nodes.parquet (Recommended)

```sql
CREATE TABLE nodes (
  entity_id VARCHAR NOT NULL,
  branch VARCHAR NOT NULL,
  scoped_name VARCHAR NOT NULL,
  file_path VARCHAR NOT NULL,
  file_content_hash VARCHAR NOT NULL,  -- Hash of source file
  -- ... rest of columns
);
```

Query for hash check:
```sql
SELECT DISTINCT file_path, file_content_hash 
FROM read_parquet('.devac/seed/branch=main/nodes.parquet')
```

| Aspect | Assessment |
|--------|------------|
| Read speed | Fast (~15-30ms with column pruning) |
| Sync risk | NONE - hash IS in the data |
| Single source of truth | YES - embedded in nodes |
| Queryable | YES - native DuckDB |
| Atomic updates | YES - hash changes when file changes |
| Storage overhead | ~8 bytes × N nodes (hash is repeated) |

### Why Column Pruning Makes Option C Fast

Parquet is columnar. When we query:
```sql
SELECT DISTINCT file_path, file_content_hash FROM nodes.parquet
```

DuckDB only reads the `file_path` and `file_content_hash` columns from disk. For a 10MB nodes.parquet with 50 columns, we might read only 200KB.

### Recommendation: Option C

**Store `file_content_hash` as a column in nodes.parquet.**

Benefits:
1. **Self-describing data** - Parquet file contains everything needed
2. **No sync issues** - Hash is always correct for the data
3. **Queryable** - Can verify hashes, find files, etc.
4. **Git-friendly** - Single file to track, no metadata drift

The storage overhead (repeated hash per node) is negligible:
- 8-byte hash × 100 nodes/file = 800 bytes per file
- With Parquet dictionary encoding, repeated values compress to near-zero

### Schema Update

```sql
CREATE TABLE nodes (
  -- Identity
  entity_id VARCHAR NOT NULL,
  branch VARCHAR NOT NULL,
  
  -- File information
  file_path VARCHAR NOT NULL,
  file_content_hash VARCHAR NOT NULL,  -- SHA-256 of file content
  
  -- Scope information
  scoped_name VARCHAR NOT NULL,
  
  -- ... rest unchanged
);
```

### Incremental Update Flow (Revised)

```
1. Read current source files, compute hashes
2. Query existing nodes: 
   SELECT DISTINCT file_path, file_content_hash FROM nodes.parquet
3. Compare: find changed/new/deleted files
4. If no changes: DONE (no write needed)
5. If changes:
   a. Parse changed files → new nodes with new hash
   b. Keep unchanged nodes (same hash)
   c. Write merged nodes.parquet
```

---

## Decision 2: Delta-Only Branch Storage

### Context

Current design stores ALL nodes for each branch:

```
branch=main/nodes.parquet       → 1000 nodes
branch=feature-x/nodes.parquet  → 1000 nodes (full copy!)
```

**Challenge:** Only store changed files in branch-specific Parquet files.

### Proposed: Delta Storage Model

```
branch=main/nodes.parquet       → 1000 nodes (base truth)
branch=feature-x/nodes.parquet  → 5 nodes (only changed/new files)
```

This mirrors Git's model where branches store deltas, not full copies.

### How It Works

#### Branch Creation
When creating/analyzing a feature branch:
1. Compute file hashes for all source files
2. Compare with base branch (main) hashes
3. Only parse and store files that differ
4. Track metadata: base branch, changed files, deleted files

#### Branch Metadata

```sql
-- In branch-specific meta or as a separate small Parquet
CREATE TABLE branch_meta (
  branch VARCHAR NOT NULL,
  base_branch VARCHAR NOT NULL,       -- "main" or "development"
  base_commit VARCHAR,                -- Git commit SHA of base
  changed_files JSON,                 -- ["src/auth.ts", "src/new.ts"]
  deleted_files JSON,                 -- ["src/removed.ts"]
  analyzed_at TIMESTAMP
);
```

Or in meta.json per branch:
```json
{
  "branch": "feature-x",
  "baseBranch": "main",
  "baseCommit": "abc123def",
  "changedFiles": ["src/auth.ts", "src/newfile.ts"],
  "deletedFiles": ["src/removed.ts"],
  "analyzedAt": "2025-12-13T10:30:00Z"
}
```

#### Querying a Branch (Unified View)

```sql
-- Get all nodes for feature-x (delta + base)
WITH feature_files AS (
  SELECT DISTINCT file_path 
  FROM read_parquet('.devac/seed/branch=feature-x/nodes.parquet')
),
deleted_files AS (
  -- From branch metadata
  SELECT unnest(['src/removed.ts']) as file_path
)
SELECT * FROM (
  -- 1. Feature branch nodes (overrides)
  SELECT *, 'feature-x' as _source_branch 
  FROM read_parquet('.devac/seed/branch=feature-x/nodes.parquet')
  
  UNION ALL
  
  -- 2. Base branch nodes (not overridden, not deleted)
  SELECT *, 'main' as _source_branch
  FROM read_parquet('.devac/seed/branch=main/nodes.parquet')
  WHERE file_path NOT IN (SELECT file_path FROM feature_files)
    AND file_path NOT IN (SELECT file_path FROM deleted_files)
);
```

#### Helper View/Function

```typescript
// Create a unified query for any branch
function getUnifiedBranchQuery(branch: string, baseBranch: string): string {
  return `
    WITH branch_files AS (
      SELECT DISTINCT file_path 
      FROM read_parquet('.devac/seed/branch=${branch}/nodes.parquet')
    )
    SELECT * FROM read_parquet('.devac/seed/branch=${branch}/nodes.parquet')
    UNION ALL
    SELECT * FROM read_parquet('.devac/seed/branch=${baseBranch}/nodes.parquet')
    WHERE file_path NOT IN (SELECT file_path FROM branch_files)
  `;
}
```

### Pros and Cons

| Aspect | Full Copy (Current) | Delta Only (Proposed) |
|--------|--------------------|-----------------------|
| Storage size | Large (N × branches) | Small (base + deltas) |
| Query simplicity | Simple (single file) | Complex (UNION + filter) |
| Branch creation | Slow (copy all) | Fast (only changed) |
| Base branch update | Independent | Need to consider stale deltas |
| Deleted files | Implicit (not in file) | Explicit tracking needed |
| Git alignment | Divergent | Aligned with Git model |

### Edge Cases

#### 1. Base Branch Updates
If `main` is updated after `feature-x` branched:
- `feature-x` delta still valid for its changed files
- Base nodes may be stale
- Solution: Track `baseCommit` and warn/rebuild if main advanced

#### 2. Deleted Files
File exists in `main`, deleted in `feature-x`:
- Must explicitly track in metadata
- Query must exclude deleted files from base

#### 3. Renamed Files
File renamed from `old.ts` to `new.ts`:
- `old.ts` appears as deleted
- `new.ts` appears as new
- Entity IDs will differ (file path in hash)
- This is correct behavior - it's a different identity

#### 4. Merge Back to Main
When feature merges to main:
- Regenerate main with merged source files
- Feature branch can be pruned

### Recommendation

**Implement delta-only storage with explicit metadata tracking.**

```
.devac/
├── meta.json                     # Package-level metadata (minimal)
└── seed/
    ├── branch=main/
    │   ├── nodes.parquet         # Full nodes for base branch
    │   ├── edges.parquet
    │   ├── external_refs.parquet
    │   └── branch_meta.json      # {"branch": "main", "baseBranch": null}
    │
    └── branch=feature-x/
        ├── nodes.parquet         # ONLY changed/new files
        ├── edges.parquet         # ONLY edges from changed files
        ├── external_refs.parquet # ONLY refs from changed files
        └── branch_meta.json      # {"baseBranch": "main", "deletedFiles": [...]}
```

### Query Abstraction

Provide a helper that abstracts the delta logic:

```typescript
// CLI/API provides unified view
const nodes = await devac.queryBranch("feature-x", `
  SELECT * FROM nodes WHERE kind = 'function'
`);

// Internally expands to:
// SELECT * FROM (unified_branch_view) WHERE kind = 'function'
```

---

## Summary of Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hash storage | Column in nodes.parquet | Single source of truth, queryable, no sync issues |
| Branch storage | Delta-only | Aligns with Git, smaller storage, faster branching |
| Deleted files | Explicit in branch_meta.json | Required for correct delta queries |
| Base tracking | baseCommit in metadata | Detect stale branches |

---

## Next Steps

1. Update `devac-spec-v2.0.md` with these decisions
2. Update schema in entity-id-lifecycle-analysis.md
3. Update branch-partitioning-research.md
4. Create query helper specifications

---

*End of Document*
