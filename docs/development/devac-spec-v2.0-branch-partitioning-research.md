# Branch-Based Parquet Partitioning Research

**Date:** 2025-12-13  
**Purpose:** Analyze the branch-based partitioning approach to solve the "many small files" problem identified in v2.0 spec reviews  
**Status:** Research Complete - Recommendations Ready

---

## Executive Summary

The v2.0 spec proposed **per-source-file Parquet partitioning** for fast incremental updates. All reviewers flagged this as HIGH RISK due to file count explosion (3 files × N source files). This research analyzes an alternative: **per-package-per-branch partitioning** combined with content-hash-based skip optimization.

### Key Findings

| Finding | Impact | Recommendation |
|---------|--------|----------------|
| Per-file Parquet creates metadata overhead | HIGH | Use per-package partitioning |
| DuckDB glob with 10K+ files causes slowdowns | HIGH | Limit files, use hive-style partitioning |
| Branch as first-class concept reduces file count | HIGH | Implement branch-aware storage |
| Content hashing enables fast regeneration | HIGH | Hash files to skip unchanged |
| Git cannot merge Parquet files intelligently | MEDIUM | Use "ours" strategy + regenerate |
| Cross-branch queries cause ID collisions | HIGH | Include branch in entity_id; add logical_id |

### Recommended Architecture

```
.devac/seed/
├── branch=main/
│   └── package.parquet          # Single file per package per branch
├── branch=development/
│   └── package.parquet
└── file-hashes.json             # Content hashes for all source files
```

---

## 1. Problem Statement

### 1.1 Original v2.0 Approach (Per-File Partitioning)

```
.devac/seed/
├── nodes/
│   ├── src_index_ts.parquet     # 1 file per source file
│   ├── src_auth_ts.parquet
│   ├── src_utils_ts.parquet
│   └── ... (N files)
├── edges/
│   └── ... (N files)
└── external_refs/
    └── ... (N files)

Total files: 3N where N = number of source files
For 5K source files: 15K Parquet files
```

### 1.2 Issues Identified by Reviewers

| Issue | Source | Severity |
|-------|--------|----------|
| File count explosion (15K+ files) | All reviewers | CRITICAL |
| OS file handle limits | Gemini | HIGH |
| Windows 260 char path limits | Gemini | MEDIUM |
| DuckDB glob metadata overhead | Claude | HIGH |
| Query planning with many files | GPT | HIGH |

### 1.3 User's Proposed Solution

> "Adding branch as a concept could solve the issue... if parquet files are per package per branch we can have much less files to handle"

Key insights from user:
- Most repos are on `main` or `development` branch
- Branch alignment reflects how developers actually work
- Reduces file count significantly
- File hashing can speed up regeneration

---

## 2. DuckDB Performance with Many Files

### 2.1 Research Findings

From [DuckDB Parquet Tips](https://duckdb.org/docs/stable/data/parquet/tips) and [Performance Tuning](https://duckdb.org/docs/stable/guides/performance/how_to_tune_workloads):

**File Count Impact:**
- DuckDB performs best with **fewer, larger Parquet files** (100MB-1GB each)
- Reading thousands of small files incurs:
  - File listing overhead (especially on network/slow filesystems)
  - Metadata parsing for each file
  - Thread scheduling overhead (DuckDB parallelizes by file/row-group)
- [GitHub Issue #1529](https://github.com/duckdb/duckdb/issues/1529) documented 100x slowdowns with glob patterns on many files

**Row Group Considerations:**
- Optimal row group size: 100K-1M rows
- Per-source-file Parquet likely has <100 rows per file (under-optimized)
- DuckDB 1.3+ improves small rowgroup handling but doesn't eliminate overhead

**Best Practices from [MotherDuck DuckDB Book](https://motherduck.com/duckdb-book-summary-chapter10/):**
> "Don't over-partition (e.g., by minute or by user ID) — it creates thousands of tiny files."

### 2.2 Quantified Impact

| Scenario | File Count | Expected Query Latency |
|----------|------------|------------------------|
| 1 large file (100K nodes) | 1 | ~50ms |
| 100 medium files (1K nodes each) | 100 | ~75ms |
| 1,000 small files (100 nodes each) | 1,000 | ~150-300ms |
| 10,000 tiny files (10 nodes each) | 10,000 | ~500ms-2s |

**Conclusion:** Per-file partitioning with 5K+ source files will NOT meet <200ms query targets.

---

## 3. Branch-Based Partitioning Analysis

### 3.1 Concept Overview

Instead of partitioning by source file, partition by **package + branch**:

```
.devac/seed/
├── branch=main/
│   ├── nodes.parquet            # All nodes for this package on main
│   ├── edges.parquet            # All edges for this package on main
│   └── external_refs.parquet    # All refs for this package on main
├── branch=feature-auth/
│   ├── nodes.parquet
│   ├── edges.parquet
│   └── external_refs.parquet
└── meta.json                    # Metadata including file hashes
```

### 3.2 File Count Comparison

| Approach | Files per Package | 10 Packages | 100 Packages |
|----------|-------------------|-------------|--------------|
| Per-source-file (v2.0) | 3 × N (e.g., 3 × 500 = 1,500) | 15,000 | 150,000 |
| Per-package-per-branch (1 branch) | 3 | 30 | 300 |
| Per-package-per-branch (5 branches) | 15 | 150 | 1,500 |

**Reduction: 100x fewer files** for typical single-branch workflows.

### 3.3 Hive-Style Partitioning Benefits

Using `branch=` prefix enables [DuckDB Hive Partitioning](https://duckdb.org/docs/stable/data/partitioning/hive_partitioning):

```sql
-- Query automatically filters to branch=main partition
SELECT * FROM read_parquet('.devac/seed/branch=*/nodes.parquet', hive_partitioning=true)
WHERE branch = 'main' AND kind = 'function';
```

Benefits:
- Partition pruning (only reads relevant branch files)
- Automatic branch column extraction
- Clean separation of branch data

### 3.4 Trade-off: Update Latency

| Operation | Per-File | Per-Package-Per-Branch |
|-----------|----------|------------------------|
| Single file change | ~50ms (rewrite 1 partition) | ~200-500ms (rewrite package) |
| Batch changes (10 files) | ~500ms (rewrite 10 partitions) | ~200-500ms (rewrite package once) |
| Full package analysis | ~5-10s | ~200-500ms |

**Key Insight:** Per-package is slower for single-file changes but faster for batch changes. In practice, developers save multiple files between analyses, favoring batch-optimized approaches.

---

## 4. Content Hashing for Fast Regeneration

### 4.1 The Problem

Without per-file partitioning, how do we know which files need reprocessing?

### 4.2 Solution: File Content Hash Index

Store a content hash for each source file:

```json
// .devac/meta.json
{
  "schemaVersion": "2.1",
  "branch": "main",
  "analyzedAt": "2025-12-13T10:30:00Z",
  "fileHashes": {
    "src/index.ts": "sha256:a1b2c3d4...",
    "src/auth.ts": "sha256:e5f6g7h8...",
    "src/utils.ts": "sha256:i9j0k1l2..."
  }
}
```

### 4.3 Incremental Analysis Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  INCREMENTAL ANALYSIS WITH CONTENT HASHING                                 │
│  ──────────────────────────────────────────                                 │
│                                                                             │
│  Step 1: Compute current file hashes                                        │
│  ─────────────────────────────────────                                      │
│  For each source file in package:                                          │
│    currentHash = sha256(fileContent)                                       │
│                                                                             │
│  Step 2: Compare with stored hashes                                         │
│  ──────────────────────────────────                                         │
│  changedFiles = files where currentHash != storedHash                      │
│  newFiles = files not in storedHashes                                      │
│  deletedFiles = storedHashes keys not in current files                     │
│                                                                             │
│  Step 3: Selective parsing                                                  │
│  ────────────────────────                                                   │
│  IF no changes detected:                                                    │
│    SKIP - no regeneration needed (< 50ms total)                            │
│  ELSE:                                                                      │
│    Parse ONLY changed/new files                                            │
│    Merge with unchanged nodes (kept in memory or re-read)                  │
│    Write new package Parquet files                                         │
│                                                                             │
│  Step 4: Update hash index                                                  │
│  ────────────────────────                                                   │
│  Write updated fileHashes to meta.json                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Performance Characteristics

| Scenario | Time (Estimated) |
|----------|------------------|
| Hash check, no changes | ~20-50ms |
| Hash check, 1 file changed | ~100-200ms (parse 1, merge, write) |
| Hash check, 10 files changed | ~300-500ms (parse 10, merge, write) |
| No hashes (full regeneration) | ~5-10s (parse all) |

### 4.5 Hash Algorithm Choice

| Algorithm | Speed | Security | Recommendation |
|-----------|-------|----------|----------------|
| MD5 | Fastest | Weak | Not recommended |
| SHA-1 | Fast | Weak | Not recommended |
| SHA-256 | Fast enough | Strong | **Recommended** |
| xxHash | Fastest | Non-crypto | Good for non-security use |

**Recommendation:** SHA-256 - fast enough for file hashing, provides integrity guarantees.

### 4.6 Implementation Reference

Similar to [SonarQube's incremental analysis](https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/incremental-analysis-mechanisms):
> "Unchanged files are skipped from the analysis for files that can be processed independently by the analyzer."

And [Gradle's incremental build](https://docs.gradle.org/current/userguide/incremental_build.html):
> "If the new fingerprints are the same as the previous fingerprints, Gradle assumes that the outputs are up to date and skips the task."

---

## 5. Entity ID Format with Branch

### 5.1 Current Format (v2.0 Spec)

```
{repo}:{package_path}:{kind}:{content_hash}
```

Example: `repo-api:packages/auth:function:a1b2c3d4`

### 5.2 The Duplicate ID Problem

If branch is NOT in the entity ID, querying across branches causes collisions:

```sql
SELECT * FROM read_parquet('.devac/seed/branch=*/nodes.parquet')
WHERE entity_id = 'repo-api:packages/auth:function:a1b2c3d4'
```

**Result:** Multiple rows with the same `entity_id` - one from each branch where that entity exists. This breaks uniqueness guarantees and makes edge references ambiguous.

### 5.3 Options for Adding Branch

#### Option A: Branch as First-Class Citizen in ID (RECOMMENDED)

```
{repo}:{branch}:{package_path}:{kind}:{content_hash}
```

Example: `repo-api:main:packages/auth:function:a1b2c3d4`

**Pros:**
- Entity IDs are globally unique across ALL branches
- No ambiguity in cross-branch queries
- Edges can reference entities on specific branches explicitly
- Clear data model - every row is uniquely identifiable

**Cons:**
- Same logical code on different branches has different IDs
- Cross-branch "is this the same entity?" requires parsing the ID or using `logical_id`
- Slightly longer IDs

#### Option B: Branch as Partition Key Only (Not in ID)

```
{repo}:{package_path}:{kind}:{content_hash}  # ID unchanged
```

**Pros:**
- Same code has same ID regardless of branch
- Simpler cross-branch comparison
- Shorter IDs

**Cons:**
- **CRITICAL:** Duplicate entity IDs when querying across branches
- Edges cannot unambiguously reference a specific branch's entity
- Requires composite key (entity_id + branch) for true uniqueness

#### Option C: Hybrid - Branch Optional in ID

```
{repo}:{package_path}:{kind}:{content_hash}[:{branch}]
```

**Pros:**
- Backward compatible
- Explicit when needed

**Cons:**
- Inconsistent format
- Complex parsing
- Doesn't solve the core uniqueness problem

### 5.4 Recommendation: Option A (Branch IN Entity ID)

**Rationale:**

1. **Global Uniqueness:** Every entity ID is globally unique across all branches, repos, and packages. No ambiguity, ever.

2. **Edge Integrity:** When an edge references `target_entity_id`, it's unambiguous which branch's version is meant:
   ```
   source_entity_id: repo-api:main:packages/auth:function:a1b2c3d4
   target_entity_id: repo-api:main:packages/core:class:b2c3d4e5
   ```

3. **Query Safety:** Cross-branch queries return distinct rows that can be properly aggregated or compared:
   ```sql
   SELECT entity_id, branch, name 
   FROM read_parquet('.devac/seed/branch=*/nodes.parquet')
   WHERE logical_id = 'repo-api:packages/auth:function:a1b2c3d4'
   -- Returns one row per branch, each with unique entity_id
   ```

4. **Aligns with Branch-Partitioned Storage:** Since we're storing data per-branch anyway, having branch in the ID creates consistency between storage and identity.

### 5.5 Updated Entity ID Format

```
{repo}:{branch}:{package_path}:{kind}:{content_hash}
```

**Examples:**
```
repo-api:main:packages/auth:function:a1b2c3d4
repo-api:feature-x:packages/auth:function:a1b2c3d4
repo-api:development:packages/core:class:e5f6g7h8
```

### 5.6 Logical ID for Cross-Branch Comparison

Add a `logical_id` column to enable "same entity across branches" queries:

```sql
-- Schema includes both IDs
CREATE TABLE nodes (
  entity_id VARCHAR NOT NULL,      -- Globally unique: includes branch
  logical_id VARCHAR NOT NULL,     -- Branch-agnostic: for cross-branch comparison
  branch VARCHAR NOT NULL,         -- Explicit branch column (from hive partition)
  ...
);

-- logical_id format (excludes branch)
-- {repo}:{package_path}:{kind}:{content_hash}
```

**Usage:**
```sql
-- Find same entity across all branches
SELECT entity_id, branch, name, file_path
FROM read_parquet('.devac/seed/branch=*/nodes.parquet', hive_partitioning=true)
WHERE logical_id = 'repo-api:packages/auth:function:a1b2c3d4'
ORDER BY branch;

-- Result:
-- entity_id                                          | branch    | name        | file_path
-- repo-api:main:packages/auth:function:a1b2c3d4      | main      | handleLogin | src/auth.ts
-- repo-api:feature-x:packages/auth:function:a1b2c3d4 | feature-x | handleLogin | src/auth.ts
```

### 5.7 Implementation

```typescript
// Entity ID generation (updated for v2.1)
function generateEntityId(
  repo: string,
  branch: string,
  packagePath: string,
  kind: string,
  filePath: string,
  name: string,
  startLine: number
): string {
  const contentHash = sha256(`${filePath}:${name}:${startLine}:${kind}`).slice(0, 8);
  return `${repo}:${branch}:${packagePath}:${kind}:${contentHash}`;
}

// Logical ID generation (branch-agnostic, for cross-branch queries)
function generateLogicalId(
  repo: string,
  packagePath: string,
  kind: string,
  filePath: string,
  name: string,
  startLine: number
): string {
  const contentHash = sha256(`${filePath}:${name}:${startLine}:${kind}`).slice(0, 8);
  return `${repo}:${packagePath}:${kind}:${contentHash}`;
}

// Query current branch
const results = db.all(`
  SELECT * FROM read_parquet(
    '.devac/seed/branch=${currentBranch}/nodes.parquet'
  )
  WHERE kind = 'function'
`);

// Query across branches for same logical entity
const crossBranchResults = db.all(`
  SELECT entity_id, branch, name 
  FROM read_parquet('.devac/seed/branch=*/nodes.parquet', hive_partitioning=true)
  WHERE logical_id = '${logicalId}'
`);
```

---

## 6. Git Merge Behavior with Parquet Files

### 6.1 The Challenge

Parquet files are binary. Git cannot intelligently merge changes to binary files. From [Git Attributes Documentation](https://git-scm.com/book/en/v2/Customizing-Git-Git-Attributes):

> "Unlike text files, which can be merged intelligently by Git, binary files cannot be merged easily. This can lead to conflicts that require manual resolution."

### 6.2 Merge Scenarios

#### Scenario 1: Feature Branch → Main (Common Case)

```
main:     A --- B --- C
                       \
feature:               D --- E (has different .devac/seed/)
```

**What Happens:**
- `.devac/seed/` on `feature` differs from `main`
- Git sees binary file conflict
- Default: Git marks as conflict requiring resolution

**Solution: Regenerate After Merge**

```bash
# .gitattributes
.devac/seed/**/*.parquet binary
.devac/seed/**/*.parquet merge=ours
```

With `merge=ours`, Git automatically keeps the destination branch's version. The merge hook then regenerates:

```bash
# .git/hooks/post-merge
#!/bin/bash
if git diff --name-only HEAD@{1} HEAD | grep -q "\.ts$\|\.py$\|\.cs$"; then
  echo "Source files changed, regenerating CodeGraph seeds..."
  devac analyze --if-changed
fi
```

#### Scenario 2: Both Branches Modified Same Package

```
main:     A --- B (modified auth/index.ts)
           \
feature:   C (modified auth/utils.ts)
```

**What Happens:**
- Both branches have different `.devac/seed/branch=*/` content
- After merge, source files from both branches exist
- Regeneration produces correct combined result

**Solution: Always Regenerate**

The Parquet files are **derived data**. After any merge that touches source files, regeneration produces correct results.

### 6.3 Recommended Git Configuration

```gitattributes
# .gitattributes (in repo root)

# Mark Parquet as binary (no diff, no text conversion)
*.parquet binary

# Use "ours" strategy for seed files (keep destination, then regenerate)
.devac/seed/**/*.parquet merge=ours

# JSON metadata can be merged as text
.devac/meta.json merge=union
```

```bash
# .git/hooks/post-merge
#!/bin/bash

# Check if any source files changed
CHANGED_SOURCES=$(git diff --name-only HEAD@{1} HEAD | grep -E '\.(ts|tsx|js|jsx|py|cs)$' | wc -l)

if [ "$CHANGED_SOURCES" -gt 0 ]; then
  echo "Detected $CHANGED_SOURCES changed source files after merge"
  echo "Regenerating CodeGraph seeds..."
  
  # Regenerate with hash checking (only changed files)
  devac analyze --if-changed
fi
```

### 6.4 Why This Works

1. **Source is Truth:** Parquet seeds are 100% derived from source code
2. **Hash-Based Skip:** After merge, hash comparison identifies truly changed files
3. **Regeneration is Fast:** With content hashing, only actually-changed files are re-parsed
4. **No Data Loss:** Even if wrong version "wins" the merge, regeneration fixes it

### 6.5 Alternative: Git LFS for Seeds

For teams wanting version-controlled seed history:

```bash
# Track Parquet files in Git LFS
git lfs track "*.parquet"
```

**Pros:**
- Full history of seed files
- Faster clones (LFS pulls on demand)

**Cons:**
- Additional infrastructure (LFS server)
- May not be necessary since seeds are regenerable

**Recommendation:** Start without LFS. Seeds can be regenerated from source, so losing history is acceptable.

---

## 7. Branch Lifecycle Management

### 7.1 Branch-Aware Seed Storage

```
.devac/
├── seed/
│   ├── branch=main/
│   │   ├── nodes.parquet
│   │   ├── edges.parquet
│   │   └── external_refs.parquet
│   ├── branch=development/
│   │   └── ...
│   └── branch=feature-auth/
│       └── ...
├── meta.json                    # Current branch, file hashes
└── manifest.json                # Package index
```

### 7.2 CLI Commands for Branch Management

```bash
# Analyze current branch (auto-detects git branch)
devac analyze

# Analyze specific branch
devac analyze --branch feature-auth

# List analyzed branches
devac branches

# Remove stale branch seeds (branch deleted from git)
devac prune-branches

# Query across branches
devac query "SELECT * FROM read_parquet('.devac/seed/branch=*/nodes.parquet')"
```

### 7.3 Automatic Branch Detection

```typescript
// src/utils/git-branch.ts

import { execSync } from "child_process";

export function getCurrentBranch(): string {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
    }).trim();
    
    // Handle detached HEAD (use commit hash)
    if (branch === "HEAD") {
      return execSync("git rev-parse --short HEAD", {
        encoding: "utf-8",
      }).trim();
    }
    
    return sanitizeBranchName(branch);
  } catch {
    return "default"; // Not in git repo
  }
}

// Sanitize for filesystem compatibility
function sanitizeBranchName(branch: string): string {
  return branch
    .replace(/[/\\]/g, "-")  // Replace path separators
    .replace(/[^a-zA-Z0-9-_]/g, "_"); // Replace special chars
}
```

### 7.4 Branch Cleanup Policy

```typescript
// src/commands/prune-branches.ts

async function pruneStaleBranches(seedPath: string): Promise<void> {
  // Get all analyzed branches
  const analyzedBranches = await getAnalyzedBranches(seedPath);
  
  // Get all git branches
  const gitBranches = await getGitBranches();
  
  // Find branches to prune
  const staleBranches = analyzedBranches.filter(
    b => !gitBranches.includes(b)
  );
  
  for (const branch of staleBranches) {
    console.log(`Removing stale branch seeds: ${branch}`);
    await fs.rm(`${seedPath}/branch=${branch}`, { recursive: true });
  }
}
```

---

## 8. Updated Data Model

### 8.1 Node Schema (Updated)

```sql
-- Updated schema with branch in entity_id and logical_id for cross-branch queries
CREATE TABLE nodes (
  -- Identity (updated for v2.1)
  entity_id VARCHAR NOT NULL,      -- Globally unique: {repo}:{branch}:{pkg}:{kind}:{hash}
  logical_id VARCHAR NOT NULL,     -- Branch-agnostic: {repo}:{pkg}:{kind}:{hash}
  branch VARCHAR NOT NULL,         -- Branch name (also available via hive partition)
  
  -- Source location
  source_file VARCHAR NOT NULL,
  file_path VARCHAR NOT NULL,
  start_line INTEGER NOT NULL,
  start_column INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  end_column INTEGER NOT NULL,
  
  -- Classification
  kind VARCHAR NOT NULL,
  name VARCHAR,
  language VARCHAR NOT NULL,
  
  -- Export info
  is_exported BOOLEAN DEFAULT FALSE,
  export_name VARCHAR,
  export_kind VARCHAR,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  properties JSON
);
```

### 8.2 Edge Schema (Updated)

```sql
CREATE TABLE edges (
  -- Identity
  id VARCHAR NOT NULL,
  
  -- Endpoints (both include branch for unambiguous references)
  source_entity_id VARCHAR NOT NULL,  -- {repo}:{branch}:{pkg}:{kind}:{hash}
  target_entity_id VARCHAR NOT NULL,  -- {repo}:{branch}:{pkg}:{kind}:{hash}
  
  -- For cross-branch edge analysis
  source_logical_id VARCHAR NOT NULL, -- Branch-agnostic source
  target_logical_id VARCHAR NOT NULL, -- Branch-agnostic target
  
  -- Classification
  edge_type VARCHAR NOT NULL,
  
  -- Resolution status
  is_resolved BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  properties JSON
);
```

### 8.3 Meta Schema (New)

```json
// .devac/meta.json
{
  "schemaVersion": "2.1",
  "analyzedBranch": "main",
  "analyzedAt": "2025-12-13T10:30:00Z",
  "packagePath": "packages/auth",
  "fileHashes": {
    "src/index.ts": {
      "contentHash": "sha256:a1b2c3d4e5f6...",
      "size": 1234,
      "mtime": "2025-12-13T10:00:00Z"
    },
    "src/auth.ts": {
      "contentHash": "sha256:b2c3d4e5f6g7...",
      "size": 5678,
      "mtime": "2025-12-13T09:30:00Z"
    }
  },
  "nodeCount": 150,
  "edgeCount": 200,
  "refCount": 75
}
```

### 8.4 Storage Layout (Updated)

```
packages/auth/
├── src/
│   ├── index.ts
│   └── auth.ts
└── .devac/
    ├── meta.json                       # Package metadata + file hashes
    └── seed/
        ├── branch=main/
        │   ├── nodes.parquet          # All nodes for this package
        │   ├── edges.parquet          # All edges for this package
        │   └── external_refs.parquet  # All external refs
        └── branch=feature-x/
            ├── nodes.parquet
            ├── edges.parquet
            └── external_refs.parquet
```

---

## 9. Performance Projections

### 9.1 File Count Comparison

| Scenario | Per-File (v2.0) | Per-Package-Branch (v2.1) |
|----------|-----------------|---------------------------|
| 1 package, 500 files, 1 branch | 1,500 files | 3 files |
| 10 packages, 500 files each, 1 branch | 15,000 files | 30 files |
| 10 packages, 500 files each, 3 branches | 45,000 files | 90 files |
| 100 packages, 100 files each, 2 branches | 60,000 files | 600 files |

### 9.2 Query Performance Projection

| Query Type | Per-File (v2.0) | Per-Package-Branch (v2.1) |
|------------|-----------------|---------------------------|
| Single package query | ~200-500ms | ~50-100ms |
| All packages in repo | ~1-3s | ~100-200ms |
| Cross-repo (3 repos) | ~3-10s | ~300-600ms |

### 9.3 Update Performance Projection

| Update Type | Per-File (v2.0) | Per-Package-Branch (v2.1) |
|-------------|-----------------|---------------------------|
| Single file change | ~50-100ms | ~150-300ms |
| 10 files in same package | ~500-1000ms | ~150-300ms |
| Full package re-analyze | ~5-15s | ~200-500ms |
| Hash check (no changes) | N/A | ~20-50ms |

**Trade-off Analysis:**
- Per-file: Faster for single-file updates, but much slower queries
- Per-package-branch: Slightly slower single-file updates, much faster queries
- With content hashing: Skip unchanged files entirely (~20-50ms check)

**Recommendation:** Per-package-branch is better for real-world usage where queries dominate.

---

## 10. Implementation Recommendations

### 10.1 Spec Updates Required

1. **Update Storage Strategy Section (5)**
   - Replace per-file partitioning with per-package-per-branch
   - Add hive-style partitioning explanation
   - Document branch detection and sanitization

2. **Add Content Hashing Section**
   - File hash storage in meta.json
   - Incremental analysis algorithm
   - Hash comparison flow

3. **Update Incremental Updates Section (8)**
   - Replace file-level partition updates with hash-based skip
   - Document package-level regeneration flow
   - Update latency targets

4. **Add Git Integration Section**
   - .gitattributes configuration
   - post-merge hook for regeneration
   - Branch cleanup commands

5. **Update Entity ID Section (4.4)**
   - Add branch as second component: `{repo}:{branch}:{pkg}:{kind}:{hash}`
   - Add `logical_id` column for cross-branch queries
   - Update schema to include both `entity_id` and `logical_id`
   - Add examples showing cross-branch entity comparison

6. **Update Performance Targets (12)**
   - Revise to realistic targets based on per-package approach
   - Add "hash check only" latency target

### 10.2 New Performance Targets

| Operation | Old Target | New Target |
|-----------|------------|------------|
| Hash check (no changes) | N/A | <50ms |
| Single file change | <100ms | <300ms |
| Package query | <100ms | <100ms |
| Repo query | <500ms | <200ms |
| Cross-repo query | <2s | <600ms |

### 10.3 Implementation Priority

1. **Phase 1:** Per-package-per-branch storage + content hashing
2. **Phase 2:** Branch detection + hive partitioning
3. **Phase 3:** Git hooks + branch lifecycle
4. **Phase 4:** Cross-branch queries

---

## 11. Conclusion

### 11.1 Summary of Recommendations

| Aspect | v2.0 (Original) | v2.1 (Recommended) |
|--------|-----------------|---------------------|
| **Partitioning** | Per-source-file | Per-package-per-branch |
| **File Count** | 3N per package | 3 per branch per package |
| **Entity ID** | {repo}:{pkg}:{kind}:{hash} | {repo}:{branch}:{pkg}:{kind}:{hash} |
| **Logical ID** | N/A | {repo}:{pkg}:{kind}:{hash} (for cross-branch) |
| **Branch Handling** | Not addressed | Hive-style partition + in entity ID |
| **Incremental Updates** | Replace partition file | Content hash skip + regenerate |
| **Git Merge** | Not addressed | merge=ours + post-merge hook |
| **Update Target** | <100ms | <300ms (with <50ms skip) |

### 11.2 Risk Mitigation

| Original Risk | Mitigation |
|---------------|------------|
| 15K+ Parquet files | Reduced to ~30-100 files typical |
| OS file handle limits | No longer a concern |
| Query planning overhead | Hive partitioning enables pruning |
| Slow incremental updates | Content hash enables skip |
| Git merge conflicts | Regeneration after merge |
| Cross-branch ID collisions | Branch included in entity_id; logical_id for comparison |

### 11.3 Next Steps

1. Update devac-spec-v2.0.md with branch-based partitioning
2. Add content hashing specification
3. Update performance targets
4. Add git integration section
5. Create implementation tasks for Phase 1

---

## References

### DuckDB Documentation
- [Parquet Tips](https://duckdb.org/docs/stable/data/parquet/tips)
- [Hive Partitioning](https://duckdb.org/docs/stable/data/partitioning/hive_partitioning)
- [Performance Tuning](https://duckdb.org/docs/stable/guides/performance/how_to_tune_workloads)
- [File Formats Guide](https://duckdb.org/docs/stable/guides/performance/file_formats)

### Git Documentation
- [Git Attributes](https://git-scm.com/book/en/v2/Customizing-Git-Git-Attributes)
- [Merge Strategies](https://git-scm.com/docs/merge-strategies)

### Industry References
- [Delta Lake: Pros/Cons of Hive Partitioning](https://delta.io/blog/pros-cons-hive-style-partionioning/)
- [Airbnb: Spark Partitioning Strategies](https://medium.com/airbnb-engineering/on-spark-hive-and-small-files-an-in-depth-look-at-spark-partitioning-strategies-a9a364f908)
- [SonarQube: Incremental Analysis](https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/incremental-analysis-mechanisms)
- [Gradle: Incremental Build](https://docs.gradle.org/current/userguide/incremental_build.html)

### Content Addressable Storage
- [CAS Overview](https://lab.abilian.com/Tech/Databases%20%26%20Persistence/Content%20Addressable%20Storage%20%28CAS%29/)
- [CodeHash Tool](https://github.com/NAIST-SE/CodeHash)

---

*End of Research Document*
