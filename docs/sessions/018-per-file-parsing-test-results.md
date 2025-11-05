# Per-File Parsing Test Results

> Test Date: 2025-11-05
> Implementation: Option 2 - Per-File Parsing with Individual Projects
> Repository: monorepo-3.0 (1,717 TypeScript files)

## Summary

**Result**: Per-file parsing with individual Projects and timeout wrappers **DID NOT SOLVE** the hang on batch 4.

**Outcome**: 
- ✅ Batches 1-3 completed successfully (150 files parsed)
- ❌ Batch 4 hung for 11+ minutes without completion
- ❌ No timeout triggered despite 40-second per-file timeout

## Implementation Details

### Architecture Change

**Before** (Batch-level Project):
```typescript
const batchProject = new Project({ ... });
batchProject.addSourceFilesAtPaths(batch); // Add all 50 files at once
await parseTsProjectFilesBatch(batchProject, batch);
```

**After** (Per-File Projects):
```typescript
for (const filePath of batch) {
  await withTimeout(async () => {
    const fileProject = new Project({ ... });
    fileProject.addSourceFileAtPath(filePath); // One file only
    const sourceFile = fileProject.getSourceFile(filePath);
    await _parseSingleSourceFile(sourceFile, filePath);
  }, 40000); // 40-second timeout per file
}
```

### Test Configuration

- **Batch Size**: 50 files/batch (35 batches total)
- **Per-File Timeout**: 40 seconds (10s for Project creation + 30s for parsing)
- **Compiler Options**: `noCheck: true`, `noEmit: true`

## Test Results

### Successful Batches (1-3)

| Batch | Files | Time | Memory | Nodes | Relationships | Status |
|-------|-------|------|--------|-------|---------------|---------|
| 1 | 50 | 26s | 89MB → 197MB | 598 | 339 | ✅ Success |
| 2 | 50 | 50s | ~500MB | 989 | 811 | ✅ Success |
| 3 | 50 | 37s | ~500MB | 1,454 | 1,201 | ✅ Success |

**Observations**:
- All files parsed successfully (150/150)
- No timeouts triggered
- Streaming writes to Neo4j working correctly
- Memory cleared after each batch
- Avg time per file: ~0.75 seconds

### Failed Batch (4)

**Status**: ❌ **HUNG - No completion after 11+ minutes**

**Timeline**:
- Started: 10:36:26 (after batch 3)
- Checked at: 10:40:00 (4 min) - 1.2GB memory, 100% CPU
- Checked at: 10:43:00 (7 min) - 978MB memory, 100% CPU
- Checked at: 10:44:00 (8 min) - 183MB memory, 98% CPU
- Checked at: 10:47:00 (11 min) - 1.8GB memory, 94% CPU
- **Manually killed**

**No timeout triggered** - No "⏱️" warnings in logs despite 40-second per-file limit

## Critical Finding: Where the Hang Occurs

### The Timeout Doesn't Work

The per-file timeout wraps the entire operation:
```typescript
await withTimeout(
  (async () => {
    const fileProject = new Project({ ... });
    fileProject.addSourceFileAtPath(filePath); // ← HANGS HERE
    // Never reaches our timeout-protected parsing code
  })(),
  40000,
  "File processing timeout"
);
```

**Problem**: JavaScript's `setTimeout` cannot interrupt synchronous operations. ts-morph's `addSourceFileAtPath()` is likely doing synchronous AST parsing that runs for minutes on complex files, and our timeout can only fire **after** the call stack completes.

### Evidence

1. **No timeout logs**: Despite 40-second limit, no timeout warnings appeared
2. **100% CPU**: Process was actively working, not deadlocked
3. **Memory fluctuations**: 183MB → 1.8GB suggests repeated Project creations
4. **Same hang point**: Always batch 4, same as batch-level approach

## Why Per-File Parsing Failed

### Assumption vs Reality

**We Assumed**:
- Each file would be isolated in its own Project
- Timeout would kill slow file processing
- Analysis would continue past problematic files

**Reality**:
- ts-morph's `addSourceFileAtPath()` does synchronous parsing
- Timeouts cannot interrupt synchronous CPU-bound operations in Node.js
- One slow file blocks the entire batch for minutes

### The Real Bottleneck

The hang is **not** in our parsing logic (which IS timeout-protected).

The hang is in **ts-morph's internal file loading**:
```typescript
// Our code
fileProject.addSourceFileAtPath(filePath); // ← Synchronous, takes 5+ minutes
// This call doesn't return for minutes on complex files

// Never reached because addSourceFileAtPath never returns:
const sourceFile = fileProject.getSourceFile(filePath);
await _parseSingleSourceFile(sourceFile, filePath); // This HAS timeout protection
```

## Performance Comparison

| Approach | Batch 1-3 | Batch 4 | Memory Peak | Result |
|----------|-----------|---------|-------------|---------|
| **100 files/batch** | 1/2 success | Hung (3.2GB) | 3.2GB | Failed |
| **50 files/batch** | 3/4 success | Hung (2.6GB) | 2.6GB | Failed |
| **50 files + noCheck** | 3/4 success | Hung (2.4GB) | 2.4GB | Failed |
| **Per-file Projects** | 3/? success | Hung (1.8GB) | 1.8GB | **Failed** |

**Conclusion**: Batch size and architecture changes don't matter - specific files cause ts-morph to hang for minutes.

## Root Cause Analysis

### The Fundamental Issue

ts-morph (and the underlying TypeScript compiler) performs **synchronous AST parsing** when adding files to a Project. Some TypeScript files in monorepo-3.0 (likely in batch 4, files 151-200) trigger exponentially slow parsing due to:

1. **Deep Type Recursion**: Complex generic types with deep nesting
2. **Circular Type References**: Types that reference each other in complex ways
3. **Large Generated Code**: Auto-generated files with thousands of types
4. **Complex JSX/TSX**: Deeply nested React components
5. **Type Inference Hell**: Code that forces TypeScript to infer very complex types

### Why Timeouts Don't Work

Node.js `Promise.race()` and `setTimeout()` can only interrupt **between** microtasks, not **during** synchronous operations:

```typescript
// This CANNOT be interrupted:
fileProject.addSourceFileAtPath(filePath); // 5 minutes of synchronous CPU work

// The timeout Promise only fires AFTER the call stack clears:
setTimeout(() => reject("timeout"), 40000); // Never fires while sync work runs
```

**To actually interrupt**, we would need:
- Worker threads (but ts-morph can't serialize Projects)
- Child processes (huge overhead, IPC complexity)
- Native addons with true cancellation
- Rewrite ts-morph internals (not feasible)

## Implications

### What We've Learned

1. **Batch size doesn't matter** - Individual files are the problem
2. **Type checking disabled doesn't help** - AST parsing itself is slow
3. **Per-file isolation doesn't help** - Timeouts can't interrupt sync work
4. **Streaming architecture works** - 150 files successfully parsed and stored
5. **The approach is fundamentally limited** - Can't handle all TypeScript files

### Success Rate

- **Files parsed**: 150/1,709 = **8.8%**
- **Batches completed**: 3/35 = **8.6%**
- **Time to first hang**: ~3 minutes
- **Estimated time if no hangs**: 35 batches × 40s = ~23 minutes

**At current success rate, we can only analyze ~10% of monorepo-3.0.**

## Recommendations

### Short Term: Identify and Skip Problematic Files

**Approach**: Run batch 4 files individually with a subprocess and 30-second hard timeout:

```bash
# For each file in batch 4 (files 151-200):
timeout 30s node -e "
const { Project } = require('ts-morph');
const p = new Project({ skipAddingFilesFromTsConfig: true });
p.addSourceFileAtPath('$FILE');
" || echo "TIMEOUT: $FILE" >> slow-files.txt
```

This would:
- Identify which specific files hang
- Use OS-level timeout (can kill processes)
- Create a skip list for future runs

### Medium Term: Hybrid Approach with Fallback

**Parse in two modes**:

1. **Fast Mode** (current approach):
   - Try to parse with ts-morph
   - 30-second subprocess timeout
   - If timeout: mark file as "complex" and continue

2. **Fallback Mode** (regex-based):
   - For timeout files, use simple regex parsing
   - Extract imports, exports, function names
   - No type information, but at least basic structure
   - Better than nothing

### Long Term: Alternative AST Parsers

**Replace ts-morph for initial parsing**:

1. **@babel/parser**: Much faster, no type checking
   - Parses syntax only
   - 10-100x faster than TypeScript compiler
   - No type information

2. **tree-sitter**: Incremental, fault-tolerant
   - Used by GitHub, Atom, etc.
   - Handles syntax errors gracefully
   - Very fast

3. **swc**: Rust-based TypeScript parser
   - 20x faster than TypeScript
   - Can extract basic structure
   - Limited type information

**Then use ts-morph selectively**:
- Only for files that need deep type analysis
- Skip complex files that timeout
- Accept incomplete data for some files

## Next Steps

### Immediate Actions

1. **Identify Batch 4 Files**: List files 151-200 to see what's causing the hang
2. **Test Individual Files**: Run each batch 4 file separately with subprocess timeout
3. **Create Skip List**: Document which files consistently timeout
4. **Partial Analysis**: Accept that we can analyze 150 files successfully

### Decision Point

**Option A**: Accept ~10% coverage and move forward with other features
**Option B**: Invest in subprocess-based timeout wrapper (1-2 days work)
**Option C**: Switch to faster parser (Babel/SWC) for initial pass (3-5 days work)

### Recommended: Option B

Implement subprocess-based per-file parsing with true OS-level timeout:

```typescript
async function parseFileInSubprocess(filePath: string, timeout: number) {
  const child = fork('parse-worker.js', [filePath]);
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL'); // Hard kill
      reject(new Error(`Timeout: ${filePath}`));
    }, timeout);
    
    child.on('message', (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}
```

**Benefits**:
- True timeout enforcement (OS-level)
- Complete isolation
- Can kill hung processes
- Allows analysis to continue

**Costs**:
- Slower due to process spawning
- More complex error handling
- Higher memory usage overall

## Conclusion

Per-file parsing with individual Projects **solved the memory accumulation problem** but **did not solve the parsing timeout problem**. 

The fundamental issue is that ts-morph (TypeScript compiler) performs synchronous parsing that cannot be interrupted by JavaScript timeouts. 

To achieve 100% file coverage of monorepo-3.0, we need either:
1. OS-level process timeouts (subprocesses)
2. A faster parser (Babel/SWC) for initial pass
3. Accept incomplete coverage and skip problematic files

**Current Status**: Streaming architecture validated, but limited to ~10% of repository due to timeout issues.
