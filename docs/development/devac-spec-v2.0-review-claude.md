# DevAC/CodeGraph v2.0 Specification Review

**Reviewer:** Claude (AI Assistant)  
**Date:** 2025-12-12  
**Document Reviewed:** devac-spec-v2.0.md  
**Review Type:** Architecture & Feasibility Analysis

---

## Executive Summary

The v2.0 spec represents a **well-reasoned architectural pivot** from Neo4j to DuckDB + Parquet. The core insight—that source code is truth and everything else is derived—is sound. However, several implementation details require attention before this design can be executed successfully.

**Overall Assessment:** ✅ Recommended for implementation with modifications

| Category | Rating | Summary |
|----------|--------|---------|
| **Feasibility** | 🟡 Mostly Sound | Some optimistic assumptions need validation |
| **Architecture** | 🟢 Strong | Clean separation, good principles |
| **Implementation Phases** | 🟡 Needs Work | Missing dependencies, underestimated complexity |
| **Performance Targets** | 🔴 Aggressive | <100ms incremental update may not be achievable |
| **Error Handling** | 🔴 Missing | Not addressed in spec |
| **Integration Points** | 🟡 Partial | Some gaps in component interfaces |

---

## 1. Feasibility Analysis

### 1.1 Working Components Correctly Identified ✅

The spec correctly identifies components to **keep** from v1.x:

| Component | Assessment |
|-----------|------------|
| **TypeScript Parser (ts-morph)** | ✅ Correct - exists in `src/analyzer/parser.ts` |
| **Python Parser (subprocess)** | ✅ Correct - exists in `src/analyzer/python-parser.ts` |
| **Babel Structural Parser** | ✅ Correct - exists in `src/analyzer/structural-parser.ts` |
| **Relationship Types** | ✅ Correct - defined in `src/analyzer/types.ts` |
| **Entity ID Format** | ✅ Correct - needs repo/package prefix added |
| **Test Fixtures** | ✅ Correct - exists in `test-fixtures/` |

### 1.2 Components to Remove/Replace ✅

| Component | Assessment |
|-----------|------------|
| **Neo4j Client** | ✅ Correct to remove - `src/database/neo4j-client.ts` |
| **StorageManager** | ✅ Correct to replace - tightly coupled to Neo4j |
| **NodeIndexCache** | ⚠️ Note: Not implemented in current codebase (v1.11 was never built) |

### 1.3 Feasibility Concerns

#### 🔴 Critical: Per-File Parquet Partitioning May Not Scale

The spec proposes one Parquet file per source file. This is a bold design choice that needs validation:

```
Typical monorepo: 5,000 files
Expected Parquet files: 5,000 × 3 (nodes, edges, refs) = 15,000 files
```

**Risk:** DuckDB's `read_parquet('*.parquet')` with 15,000 files may have significant overhead for:
- File handle management
- Metadata reading (row group info, statistics)
- Query planning

**Recommendation:** Run the validation tests in Section 14.1 **before** committing to this design. Have a fallback to per-package single files with row-level filtering by `source_file`.

#### 🟡 Medium: Babel Parser Limitation

The spec proposes Babel for structural parsing, but the existing `structural-parser.ts` already uses Babel. The issue is:

```typescript
// Current structural-parser.ts line 269-274
ImportDeclaration: (path) => {
  const importString = path.node.source.value;
  result.importStrings.push(importString);
  // Only captures import STRING, not what symbols are imported
}
```

This doesn't capture the full import structure needed for `external_refs` schema:
- `imported_symbol` (what was imported)
- `import_kind` (named, default, namespace, side-effect)
- `is_type_only` (TypeScript `import type`)

**Recommendation:** Extend `structural-parser.ts` to capture full import metadata:

```typescript
interface ParsedExternalRef {
  moduleSpecifier: string;
  importedSymbol: string;  // "User", "*", "default"
  importKind: "named" | "default" | "namespace" | "side-effect";
  isTypeOnly: boolean;
  localName?: string;  // if aliased: import { User as U }
}
```

#### 🟡 Medium: Python Subprocess Latency

The spec acknowledges 200-500ms Python parsing latency but defers optimization. This is problematic for the <100ms incremental update target:

```
File change detected → Parse (500ms) → Write Parquet (20ms)
Total: 520ms ≠ <100ms target
```

**Recommendation:** For Phase 3 (Python Support), plan for a long-running Python process:

```typescript
// Maintain persistent Python process
const pythonProcess = spawn('python3', ['-u', 'python_parser_server.py']);

// Send file paths, receive JSON
async function parsePython(filePath: string): Promise<ParseResult> {
  pythonProcess.stdin.write(filePath + '\n');
  return await readJSONFromStdout();
}
```

This could reduce Python parsing to ~50-100ms per file.

---

## 2. Architecture Assessment

### 2.1 Two-Phase Parsing Design ✅ Sound

The two-pass architecture is **correct** and aligns with the existing codebase:

```
Pass 1 (Structural): Fast, per-file, parallel
  └── Extracts: nodes, intra-file edges, unresolved external_refs

Pass 2 (Semantic): Cross-file, batched
  └── Resolves: external_refs → actual target entity IDs
```

**Existing Implementation Status:**
- Pass 1: Implemented in `structural-parser.ts` (Babel-based)
- Pass 2: Partially implemented in `relationship-resolver.ts` (needs adaptation)

### 2.2 Component Boundaries ✅ Clear

The spec defines clear component boundaries:

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI (Commander.js)                       │
├─────────────────────────────────────────────────────────────────┤
│  FileWatcher  │  LanguageRouter  │  QueryEngine  │  HubManager  │
├───────────────┼─────────────────-┼──────────────-┼──────────────┤
│           StructuralParser(s)    │  SeedWriter   │  SeedReader  │
├──────────────────────────────────┴───────────────┴──────────────┤
│                        DuckDB + Parquet                         │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Missing Component: LanguageRouter

The spec mentions parsers for different languages but doesn't define how files are routed:

```typescript
// MISSING: src/analyzer/language-router.ts

export interface LanguageRouter {
  getParser(filePath: string): LanguageParser | null;
  getSupportedExtensions(): string[];
}

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
    getParser: (filePath) => extensionMap.get(path.extname(filePath)) ?? null,
    getSupportedExtensions: () => [...extensionMap.keys()],
  };
}
```

**Recommendation:** Add LanguageRouter to Phase 1 scope.

### 2.4 Data Model Concern: Entity ID Stability

The spec proposes content-hash based entity IDs:

```
{repo}:{package_path}:{kind}:{content_hash}
content_hash = hash(file_path + name + start_line + kind)
```

**Problem:** `start_line` changes when lines are added above the symbol. This breaks entity IDs for unchanged code.

**Example:**
```typescript
// Before:
// Line 10: function foo() {}  → entityId: "...:function:hash(line10)"

// After adding a comment at line 1:
// Line 11: function foo() {}  → entityId: "...:function:hash(line11)"  // DIFFERENT!
```

**Recommendation:** Use position-independent hashing:

```typescript
function generateEntityId(
  repo: string,
  packagePath: string, 
  kind: string,
  filePath: string,
  name: string,
  parentName?: string,  // For methods: class name
  signatureHint?: string  // For overloads
): string {
  // Position-independent: based on qualified name only
  const qualifiedName = parentName 
    ? `${filePath}:${parentName}.${name}` 
    : `${filePath}:${name}`;
  
  return `${repo}:${packagePath}:${kind}:${hash(qualifiedName + (signatureHint || ''))}`;
}
```

---

## 3. Implementation Phases Analysis

### 3.1 Phase Dependencies Not Fully Captured

The spec lists phases but doesn't explicitly show dependencies:

```
Phase 1 (Foundation) 
  ↓
Phase 2 (Incremental) ← Depends on Phase 1 SeedWriter
  ↓
Phase 3 (Python) ← Can run parallel to Phase 2
  ↓  
Phase 4 (Federation) ← Depends on Phases 1-3
  ↓
Phase 5 (Validation) ← Depends on Phase 4 for cross-repo
  ↓
Phase 6 (C#) ← Can run parallel to Phase 5
```

### 3.2 Phase 1 Underestimated

Phase 1 tasks with realistic estimates:

| Task | Spec Estimate | Realistic Estimate | Reason |
|------|---------------|-------------------|--------|
| DuckDB setup | 1 day | 1 day | Accurate |
| Parquet writer | 2 days | 3-4 days | DuckDB Node.js API quirks, ZSTD compression tuning |
| Seed directory | 1 day | 2 days | Error handling, atomic writes, cleanup |
| Port TS parser | 3 days | 5-7 days | Need to add full import/export capture |
| Entity ID | 1 day | 2 days | Need to handle edge cases (overloads, anonymous, nested) |
| CLI | 2 days | 2 days | Accurate |
| Performance tests | 2 days | 3 days | Need scale tests for many-file scenarios |
| Integration tests | 2 days | 3 days | Need to mock/stub DuckDB appropriately |
| **Total** | **14 days** | **21-24 days** | **~50% underestimate** |

### 3.3 Missing Phase: Migration/Compatibility

If any existing Neo4j data needs to be preserved or compared, add:

**Phase 0.5: Compatibility Layer (1 week)**
- Export existing Neo4j data to Parquet for comparison
- Create validation script to compare Neo4j vs DuckDB query results
- Document data differences and migration notes

### 3.4 Phase 2 Critical Path Risk

Phase 2 (Incremental Updates) is the **most critical** for developer experience. If <100ms isn't achievable, the whole architecture value proposition weakens.

**Recommendation:** Create a spike/POC before Phase 1 ends:

```bash
# Validation spike (2-3 days)
1. Create 1,000 small Parquet files (10 rows each)
2. Measure: read_parquet('*.parquet') query time
3. Measure: delete + write single file time
4. If >200ms total, re-evaluate partitioning strategy
```

---

## 4. Performance Targets Analysis

### 4.1 Target Breakdown

| Operation | Target | Achievable? | Notes |
|-----------|--------|-------------|-------|
| TS structural parse | <50ms | ✅ Yes | Babel is fast, 10-30ms typical |
| Python parse | <200ms | 🟡 Maybe | Subprocess overhead, consider persistent process |
| Seed write | <20ms | 🟡 Maybe | Depends on file count, Parquet row count |
| **Total incremental** | **<100ms** | 🔴 Unlikely | Sum of parts exceeds target |
| Package query (1K files) | <100ms | ✅ Yes | DuckDB excels here |
| Repo query (10K files) | <500ms | ✅ Yes | With proper column projection |
| Cross-repo (50K files) | <2s | 🟡 Maybe | Depends on query complexity |

### 4.2 Realistic Incremental Update Timeline

```
1. File change detected              0ms
2. Debounce wait                    50ms (prevent rapid fire)
3. Read file                         5ms
4. Babel parse                      30ms
5. Generate nodes/edges/refs        10ms
6. Delete old Parquet files          5ms (3 files × ~1-2ms each)
7. Open DuckDB in-memory            15ms (if not cached)
8. Insert to DuckDB                 10ms
9. Export 3 Parquet files           30ms (3 × 10ms)
─────────────────────────────────────────
TOTAL                              155ms
```

**Recommendation:** Revise target to **<200ms** for incremental updates, or:
- Keep DuckDB connection pool warm (eliminate #7)
- Batch multiple file changes together (amortize #2)
- Use faster Parquet write options (snappy instead of ZSTD for writes, ZSTD for reads)

### 4.3 Recursive CTE Performance

The spec includes recursive CTEs for call graphs (Section 7.4). These are computationally expensive:

```sql
-- This query joins across ALL parquet files 3 times per recursion level
WITH RECURSIVE call_chain AS (
  SELECT ... FROM read_parquet('**/*.parquet')  -- Scan 1
  UNION ALL
  SELECT ... FROM call_chain c
  JOIN read_parquet('**/*.parquet') e ON ...    -- Scan 2
  JOIN read_parquet('**/*.parquet') n ON ...    -- Scan 3
)
```

For depth=5 with 10K files: potentially 15 full scans.

**Recommendation:** Pre-compute call graph edges in a separate Parquet file during Pass 2:

```sql
-- call_graph.parquet: pre-joined data
caller_entity_id, callee_entity_id, depth_from_root
```

---

## 5. Missing Pieces

### 5.1 Error Handling ❌ Not Addressed

The spec has no error handling strategy. Critical scenarios:

| Scenario | Handling Needed |
|----------|-----------------|
| Parse error in source file | Partial result? Skip file? Mark as error? |
| Parquet write fails mid-batch | Rollback? Orphaned partitions? |
| DuckDB connection failure | Retry? Fallback? |
| Corrupt Parquet file | Regenerate from source? Alert user? |
| Out of disk space | Fail gracefully, don't corrupt existing data |

**Recommendation:** Add Section 8.5 "Error Handling":

```typescript
// Error handling strategy
interface AnalysisError {
  type: 'parse' | 'write' | 'read' | 'corrupt';
  filePath: string;
  message: string;
  recoverable: boolean;
}

// For parse errors: emit partial result + error node
// For write errors: atomic write (write to temp, rename)
// For corrupt files: delete and regenerate on next analysis
```

### 5.2 Rollback Scenarios ❌ Not Addressed

What happens when:

1. **Analysis interrupted mid-way?**
   - Partial Parquet files exist
   - Some files analyzed, others not
   - Solution: Use `meta.json` to track last successful full analysis

2. **User wants to undo analysis?**
   - Currently: Delete `.devac/seed/` directory
   - Better: `devac clean` command

3. **Parquet schema changes between versions?**
   - Old Parquet files incompatible
   - Solution: Version in `meta.json`, auto-regenerate on mismatch

### 5.3 Failure Modes ❌ Not Addressed

| Failure Mode | Impact | Mitigation |
|--------------|--------|------------|
| **Neo4j data loss** | N/A (DuckDB file-based) | ✅ Addressed by design |
| **Parquet corruption** | Loss of analysis for affected files | Regenerate from source |
| **Stale cross-repo edges** | Incorrect query results | Timestamp validation, auto-rebuild |
| **File watcher misses events** | Stale Parquet data | Periodic full sync option |
| **Concurrent writes** | Data corruption | Lock files per package |

**Recommendation:** Add file locking:

```typescript
// src/seed/seed-lock.ts
export async function withSeedLock<T>(
  seedPath: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockFile = path.join(seedPath, '.lock');
  await acquireLock(lockFile);
  try {
    return await fn();
  } finally {
    await releaseLock(lockFile);
  }
}
```

### 5.4 Observability ❌ Not Addressed

No logging, metrics, or debugging strategy:

- How to debug slow queries?
- How to identify which files are slow to parse?
- How to monitor incremental update health?

**Recommendation:** Add structured logging:

```typescript
// Every operation should log timing
logger.info('parse_file', {
  file: filePath,
  durationMs: 45,
  nodeCount: 23,
  edgeCount: 15,
  refCount: 8,
});

logger.info('write_parquet', {
  seedPath,
  files: 3,
  totalBytes: 15234,
  durationMs: 28,
});
```

---

## 6. Integration Points Analysis

### 6.1 FileWatcher → LanguageRouter → Parser ✅ Well-Defined

The spec describes this flow clearly in Section 8.1-8.2:

```
FileChangeEvent
  ↓
FileWatcher.onFileChange()
  ↓
LanguageRouter.getParser(filePath)  // [MISSING: need to add]
  ↓
Parser.parse(filePath)
  ↓
SeedWriter.updateFile(seedPath, result)
```

### 6.2 Parser → StorageManager ⚠️ Needs Interface Update

The spec defines `SeedWriter` but doesn't show how it differs from existing `StorageManager`:

**Current (Neo4j):**
```typescript
class StorageManager {
  async saveNodesBatch(nodes: AstNode[]): Promise<void>;
  async saveRelationshipsBatch(type: string, rels: RelationshipInfo[]): Promise<void>;
}
```

**New (DuckDB):**
```typescript
interface SeedWriter {
  writeFile(seedPath: string, result: StructuralParseResult): Promise<void>;
  deleteFile(seedPath: string, sourceFileHash: string): Promise<void>;
  updateFile(seedPath: string, result: StructuralParseResult): Promise<void>;
}
```

**Gap:** The `StructuralParseResult` interface in spec differs from current:

```typescript
// Spec Section 6.2
interface StructuralParseResult {
  filePath: string;
  sourceFileHash: string;           // NEW - not in current
  nodes: ParsedNode[];              // Different from AstNode?
  edges: ParsedEdge[];              // Different from RelationshipInfo?
  externalRefs: ParsedExternalRef[]; // NEW
  metadata: {...};
}

// Current structural-parser.ts line 26-39
interface StructuralParseResult {
  filePath: string;
  nodes: AstNode[];
  relationships: RelationshipInfo[];
  importStrings: string[];           // Different from externalRefs
  exportedSymbols: ExportedSymbol[];
  metadata: {...};
}
```

**Recommendation:** Unify these interfaces. The spec's `externalRefs` is more complete than current `importStrings`.

### 6.3 Query Engine → Parquet Files ✅ Well-Defined

DuckDB's `read_parquet()` is the integration point. The spec correctly shows:

```sql
SELECT * FROM read_parquet('packages/*/.devac/seed/nodes/*.parquet')
WHERE kind = 'function'
```

### 6.4 MCP Server Integration ⚠️ Underspecified

The spec mentions MCP integration (Section 15.1 Phase 5) but doesn't detail:

- How MCP server discovers seed files
- Query API for MCP (same as CLI? Different?)
- How to handle cross-repo queries from MCP

**Current MCP (mcp/src/index.ts):** Uses Neo4j queries. Needs complete rewrite for DuckDB.

**Recommendation:** Add Section 11.5 "MCP Server Commands":

```typescript
// MCP tools to expose
const tools = [
  { name: 'find_symbol', input: { name: string, kind?: string } },
  { name: 'get_dependencies', input: { file: string } },
  { name: 'get_dependents', input: { file: string } },
  { name: 'get_call_graph', input: { symbol: string, depth: number } },
  { name: 'query_sql', input: { sql: string } },  // Power user
];
```

---

## 7. Additional Recommendations

### 7.1 Add Schema Versioning

```typescript
// .devac/seed/meta.json
{
  "version": "2.0.0",
  "schemaVersion": 1,  // Increment when Parquet schema changes
  "analyzedAt": "2025-01-15T10:30:00Z",
  "fileCount": 245,
  "nodeCount": 8934,
  "edgeCount": 12456,
  "refCount": 3421
}
```

### 7.2 Add Integrity Checks

```typescript
// devac verify command
async function verifySeedIntegrity(seedPath: string): Promise<VerifyResult> {
  // 1. Check all source files have corresponding Parquet files
  // 2. Check Parquet files are readable
  // 3. Check entity IDs are consistent
  // 4. Check edge source/target IDs reference existing nodes
}
```

### 7.3 Consider Warm Start Optimization

```typescript
// On devac watch start:
// 1. Pre-load DuckDB with all Parquet files
// 2. Keep connection warm
// 3. Use incremental updates (delete+insert) instead of file replacement

const db = new DuckDB(':memory:');
await db.run("CREATE TABLE nodes AS SELECT * FROM read_parquet('**/*.parquet')");

// On file change:
await db.run("DELETE FROM nodes WHERE source_file = ?", [filePath]);
await db.run("INSERT INTO nodes VALUES ...");

// Periodic: flush to Parquet
await db.run("COPY nodes TO 'nodes.parquet'");
```

### 7.4 Test Strategy

The spec doesn't define testing approach for v2.0:

```
Unit Tests:
- LanguageRouter.getParser()
- Entity ID generation edge cases
- SeedWriter atomic writes

Integration Tests:
- Full parse → write → query cycle
- Incremental update correctness
- Cross-package query resolution

Performance Tests:
- 1K, 10K, 50K file scenarios
- Parquet file count scaling
- Recursive CTE depth limits

E2E Tests:
- Watch mode file changes
- CLI command matrix
- MCP tool responses
```

---

## 8. Summary of Action Items

### Before Phase 1 Starts

1. **[CRITICAL]** Run Parquet scale validation spike (2-3 days)
2. **[HIGH]** Update `StructuralParseResult` interface to capture full import metadata
3. **[HIGH]** Design position-independent entity ID strategy
4. **[MEDIUM]** Add LanguageRouter to Phase 1 scope
5. **[MEDIUM]** Create error handling section in spec

### During Phase 1

6. **[HIGH]** Implement atomic Parquet writes (temp file + rename)
7. **[HIGH]** Add seed integrity verification
8. **[MEDIUM]** Add schema versioning in meta.json
9. **[LOW]** Add structured logging with timing metrics

### Before Phase 2 Starts

10. **[CRITICAL]** Validate <200ms target is achievable (adjust if needed)
11. **[HIGH]** Implement file locking for concurrent access

### Before Phase 4 Starts

12. **[HIGH]** Define MCP server interface for DuckDB
13. **[MEDIUM]** Plan cross-repo edge staleness strategy

---

## Appendix: Code Snippets for Key Gaps

### A. Enhanced Import Capture (for structural-parser.ts)

```typescript
ImportDeclaration: (nodePath) => {
  const node = nodePath.node;
  const moduleSpecifier = node.source.value;
  
  for (const specifier of node.specifiers) {
    let externalRef: ParsedExternalRef;
    
    if (t.isImportDefaultSpecifier(specifier)) {
      externalRef = {
        moduleSpecifier,
        importedSymbol: 'default',
        importKind: 'default',
        isTypeOnly: node.importKind === 'type',
        localName: specifier.local.name,
      };
    } else if (t.isImportNamespaceSpecifier(specifier)) {
      externalRef = {
        moduleSpecifier,
        importedSymbol: '*',
        importKind: 'namespace',
        isTypeOnly: node.importKind === 'type',
        localName: specifier.local.name,
      };
    } else if (t.isImportSpecifier(specifier)) {
      const importedName = t.isIdentifier(specifier.imported)
        ? specifier.imported.name
        : specifier.imported.value;
      externalRef = {
        moduleSpecifier,
        importedSymbol: importedName,
        importKind: 'named',
        isTypeOnly: node.importKind === 'type' || specifier.importKind === 'type',
        localName: specifier.local.name !== importedName ? specifier.local.name : undefined,
      };
    }
    
    result.externalRefs.push(externalRef);
  }
  
  // Handle side-effect imports: import './polyfills'
  if (node.specifiers.length === 0) {
    result.externalRefs.push({
      moduleSpecifier,
      importedSymbol: '',
      importKind: 'side-effect',
      isTypeOnly: false,
    });
  }
}
```

### B. Atomic Parquet Write

```typescript
async function writeParquetAtomic(
  targetPath: string,
  data: any[]
): Promise<void> {
  const tempPath = `${targetPath}.tmp.${Date.now()}`;
  
  try {
    const db = new DuckDB(':memory:');
    await db.run(`CREATE TABLE data AS SELECT * FROM ?`, [data]);
    await db.run(`COPY data TO '${tempPath}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
    await db.close();
    
    // Atomic rename
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    // Cleanup temp file on failure
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}
```

### C. File Lock Implementation

```typescript
import { open, FileHandle } from 'fs/promises';

async function acquireLock(lockPath: string, timeoutMs = 5000): Promise<FileHandle> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      // Exclusive create - fails if file exists
      const handle = await open(lockPath, 'wx');
      return handle;
    } catch (error) {
      if (error.code === 'EEXIST') {
        // Lock held by another process, wait
        await new Promise(r => setTimeout(r, 50));
      } else {
        throw error;
      }
    }
  }
  
  throw new Error(`Failed to acquire lock: ${lockPath} after ${timeoutMs}ms`);
}

async function releaseLock(handle: FileHandle, lockPath: string): Promise<void> {
  await handle.close();
  await fs.unlink(lockPath);
}
```

---

*End of Review*
