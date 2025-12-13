# Storage Design Decisions: Hash Location & Delta Branch Storage

**Date:** 2025-12-13  
**Status:** APPROVED  
**Triggered by:** User challenges to current design

> **User Confirmation (2025-12-13):**
> - "deletedFiles using option B is a good idea" (deletion markers in Parquet)
> - "multi-branch and or parallel analysis are not needed" (base/branch structure sufficient)
> - Future multi-branch comparison can be handled at hub level

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

### APPROVED: Delta Storage Model with is_deleted Column

```
base/nodes.parquet       → 1000 nodes (base truth for main branch)
branch/nodes.parquet     → 5 nodes (only changed/new/deleted files)
```

This mirrors Git's model where branches store deltas, not full copies.

### How It Works

#### Directory Structure (Simplified)

```
.devac/seed/
├── base/                 # Full content for base branch (main/development)
│   ├── nodes.parquet    # All nodes, branch column = 'main'
│   ├── edges.parquet
│   └── external_refs.parquet
└── branch/               # Delta for current working branch
    ├── nodes.parquet    # Only changed/new/deleted, branch column = 'feature-x'
    ├── edges.parquet
    └── external_refs.parquet
```

**Key simplifications:**
- No hive-style `branch=main/` directories - just `base/` and `branch/`
- No `branch_meta.json` - deleted files tracked via `is_deleted` column
- Branch name stored in `branch` column of each Parquet file
- Current branch name retrieved from Git

#### Deleted Files: is_deleted Column (Option B - APPROVED)

Instead of tracking deleted files in separate metadata, we use an `is_deleted` column:

```sql
CREATE TABLE nodes (
  entity_id VARCHAR NOT NULL,
  branch VARCHAR NOT NULL,
  file_path VARCHAR NOT NULL,
  file_content_hash VARCHAR NOT NULL,
  is_deleted BOOLEAN DEFAULT FALSE,  -- True = file deleted in this branch
  scoped_name VARCHAR,               -- NULL if is_deleted=true
  -- ... rest of columns
);
```

For a deleted file, we insert a marker row:
```sql
INSERT INTO nodes (entity_id, branch, file_path, file_content_hash, is_deleted, kind, ...)
VALUES ('repo:pkg:file:hash', 'feature-x', 'src/removed.ts', 'deleted', TRUE, 'file', ...);
```

#### Querying a Branch (Unified View)

```sql
-- Get all nodes for current branch (base + delta, excluding deleted)
SELECT * FROM (
  -- 1. Branch delta nodes (not deleted)
  SELECT * FROM read_parquet('.devac/seed/branch/nodes.parquet')
  WHERE is_deleted = false
  
  UNION ALL
  
  -- 2. Base branch nodes (not overridden in branch)
  SELECT * FROM read_parquet('.devac/seed/base/nodes.parquet') base
  WHERE NOT EXISTS (
    SELECT 1 FROM read_parquet('.devac/seed/branch/nodes.parquet') br
    WHERE br.file_path = base.file_path
  )
);
```

#### Helper View/Function

```typescript
// Create a unified query for current branch
function getUnifiedBranchQuery(): string {
  return `
    SELECT * FROM (
      SELECT * FROM read_parquet('.devac/seed/branch/nodes.parquet')
      WHERE is_deleted = false
      UNION ALL
      SELECT * FROM read_parquet('.devac/seed/base/nodes.parquet') base
      WHERE NOT EXISTS (
        SELECT 1 FROM read_parquet('.devac/seed/branch/nodes.parquet') br
        WHERE br.file_path = base.file_path
      )
    )
  `;
}
```

### Pros and Cons (APPROVED approach)

| Aspect | Full Copy | Delta with is_deleted (APPROVED) |
|--------|-----------|----------------------------------|
| Storage size | Large (N × branches) | Small (base + delta) |
| Query simplicity | Simple (single file) | Moderate (UNION + filter) |
| Branch creation | Slow (copy all) | Fast (only changed) |
| Deleted files | Implicit | `is_deleted` column in Parquet |
| Separate metadata | N/A | **NO branch_meta.json needed** |
| Git alignment | Divergent | Aligned with Git model |
| Multi-branch | Multiple directories | Single base + single branch |

### Edge Cases

#### 1. Base Branch Updates
If `main` is updated after `feature-x` branched:
- `feature-x` delta still valid for its changed files
- Base nodes may be stale
- Solution: Warn user if base has changed since branch analysis

#### 2. Deleted Files (APPROVED: is_deleted column)
File exists in `main`, deleted in `feature-x`:
- Insert marker row with `is_deleted=true` in branch/nodes.parquet
- Query excludes deleted via `WHERE is_deleted = false`
- **No separate metadata file needed**

#### 3. Renamed Files
File renamed from `old.ts` to `new.ts`:
- `old.ts` gets `is_deleted=true` marker in branch/
- `new.ts` appears as new file in branch/
- Entity IDs will differ (file path in hash)
- This is correct behavior - it's a different identity

#### 4. Merge Back to Main
When feature merges to main:
- Regenerate base/ with merged source files
- Delete branch/ directory (or leave for reference)

### APPROVED: Final Directory Structure

```
.devac/
├── meta.json              # Minimal: { "schemaVersion": "2.1" } only
└── seed/
    ├── base/              # Full content for base branch (main/development)
    │   ├── nodes.parquet  # All nodes, branch='main'
    │   ├── edges.parquet
    │   └── external_refs.parquet
    │
    └── branch/            # Delta for current working branch
        ├── nodes.parquet  # Only changed/new + is_deleted markers
        ├── edges.parquet  # Only edges from changed files
        └── external_refs.parquet
```

**Key decisions:**
- **Ultra-minimal meta.json** - Only `{ "schemaVersion": "2.1" }`, all other data in Parquet or filesystem
- **No hive-style directories** - Simple `base/` and `branch/` names
- **No branch_meta.json** - Deleted files tracked via `is_deleted` column
- **File content hashes in Parquet** - `file_content_hash` column in nodes
- **Branch name in column** - Each row has `branch` column with actual branch name
- **Stats from Parquet** - Query `SELECT COUNT(*) FROM nodes.parquet` instead of caching in meta.json

### Query Abstraction

Provide a helper that abstracts the delta logic:

```typescript
// CLI/API provides unified view
const nodes = await devac.query(`
  SELECT * FROM nodes WHERE kind = 'function'
`);

// Internally expands to unified branch view with is_deleted filtering
```

---

## Summary of APPROVED Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **meta.json** | Minimal: `{ "schemaVersion": "2.1" }` only | Zero sync risk, single source of truth |
| Hash storage | Column in nodes.parquet (`file_content_hash`) | Single source of truth, queryable, no sync issues |
| Branch storage | Delta-only with `base/` and `branch/` directories | Simple, Git-aligned, minimal storage |
| Deleted files | `is_deleted` column in Parquet (Option B) | No separate metadata, queryable, self-contained |
| Directory naming | `base/` and `branch/` (not hive-style) | Simple, intuitive, branch name from Git |
| Multi-branch | Single base + single branch | Sufficient for current needs; hub handles multi-branch if needed later |
| Stats/timestamps | Query Parquet or use file mtime | No stale data, DuckDB fast enough (~10-50ms) |

---

## Completed

- [x] Update `devac-spec-v2.0.md` with these decisions
- [ ] Update branch-partitioning-research.md with simplified structure

---

*End of Document - APPROVED 2025-12-13*
