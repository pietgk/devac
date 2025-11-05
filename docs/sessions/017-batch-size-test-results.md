# Batch Size Testing Results - monorepo-3.0

> Test Date: 2025-11-05
> Repository: monorepo-3.0 (1,717 TypeScript files)
> Goal: Validate streaming architecture with reduced batch sizes

## Test Configuration

### Batch Size Changes
- **Previous**: 100 files/batch → 18 total batches
- **New**: 50 files/batch → 35 total batches
- **Code Changed**: `src/analyzer/parser.ts` line 207

### Test Environment
- **Repository**: monorepo-3.0 (35 packages, 1,717 TS/JS files)
- **Neo4j**: Neo4j Desktop (database: neo4j)
- **Node.js**: Default version
- **Memory**: No --max-old-space-size flag

## Test Results

### Batch Size: 100 files (Baseline Test)

**Test Run**: 2025-11-05 09:41

**Results**:
- ✅ Batch 1: SUCCESS (100 files, 1,587 nodes, 1,150 rels)
  - Parse time: ~12 seconds
  - Memory during parsing: 229/262MB
  - Memory after write: cleared
- ❌ Batch 2: **HUNG/STUCK**
  - Process stuck at 3.2GB memory
  - No completion after 3+ hours
  - Killed manually

**Conclusion**: 100-file batches still experience memory issues on complex batches.

---

### Batch Size: 50 files (Optimized Test)

**Test Run**: 2025-11-05 10:06

**Detailed Results**:

#### Batch 1: ✅ SUCCESS
- **Files**: 50
- **Parse Time**: ~6 seconds (10:06:10 → 10:06:15)
- **Memory**: 74/168MB during parsing
- **Output**: 598 nodes, 339 relationships
- **Write Time**: ~1 second
- **Status**: Completed successfully, memory cleared

#### Batch 2: ✅ SUCCESS
- **Files**: 50
- **Parse Time**: ~7 seconds (10:06:16 → 10:06:22)
- **Memory**: ~2.6GB peak (likely includes previous batch remnants)
- **Output**: 989 nodes, 811 relationships
- **Write Time**: ~1 second
- **Status**: Completed successfully, memory cleared

#### Batch 3: ✅ SUCCESS
- **Files**: 50
- **Parse Time**: ~4 seconds (10:06:23 → 10:06:26)
- **Memory**: ~2.3GB during parsing
- **Output**: 1,454 nodes, 1,201 relationships
- **Write Time**: ~1 second
- **Status**: Completed successfully, memory cleared

#### Batch 4: ❌ HUNG
- **Files**: 50 (batch started at 10:06:28)
- **Parse Time**: >7 minutes with NO completion
- **Memory**: Started at ~2.3GB, dropped to 491MB (suspicious)
- **Output**: None logged
- **Status**: **HUNG - manually killed**
- **CPU**: 100% throughout (indicating active work, not deadlock)

**Total Progress Before Hang**:
- ✅ 3 batches completed = 150 files parsed
- ❌ 1 batch hung = 50 files stuck
- **Success Rate**: 150/200 files = 75%
- **Remaining**: 1,559 files not processed

## Analysis

### What Worked

1. **Streaming Writes**: All 3 completed batches successfully wrote to Neo4j incrementally
2. **Memory Clearing**: After each batch write, `tsResults.clear()` freed memory
3. **Lower Peak Memory**: 2.3-2.6GB vs 3.2GB with 100-file batches (~28% reduction)
4. **Faster Batches**: 4-7 seconds per batch vs 12+ seconds

### What Failed

1. **Batch 4 Parsing Hung**: Process stuck parsing batch 4 for 7+ minutes
2. **No Error Logged**: Process showed 100% CPU but no progress or error messages
3. **Memory Drop Suspicious**: Memory dropped to 491MB without logging completion
4. **Not Scalable**: If every 4th batch hangs, we can't complete the full analysis

### Root Cause Hypothesis

The issue is NOT batch size - it's **specific file complexity**.

**Evidence**:
- Batches 1-3 completed quickly (4-7 seconds each)
- Batch 4 hung for 7+ minutes
- 100% CPU usage = not deadlocked, actually working hard
- Memory drop to 491MB = possible GC thrashing or specific file parsing issue

**Likely Culprits in Batch 4** (files 151-200):
- Database query files with complex Kysely types
- Files with deep generic type nesting
- Large test files with extensive mock types
- Generated code or barrel exports

### ts-morph Parsing Pathology

From ts-morph documentation and observed behavior:

1. **Parser Slowdown**: "The file text is updated. The new text is parsed and a new AST is created using the compiler API. The previously wrapped nodes are backfilled with new compiler nodes. This process becomes sluggish with large files."

2. **Type Checking Overhead**: Each file's types are fully resolved, including:
   - Deep import chains
   - Generic type instantiation
   - Symbol table construction
   - Module resolution

3. **Per-File Timeout**: We have a 30-second per-file timeout, but batch 4 took 7+ minutes
   - This suggests either:
     - Multiple files each taking 10-20 seconds
     - OR one file exceeding timeout but not triggering error handler

## Comparison: 100 vs 50 File Batches

| Metric | 100 Files | 50 Files | Change |
|--------|-----------|----------|--------|
| **Peak Memory** | 3.2GB | 2.6GB | -18.75% ✅ |
| **Batch Success Rate** | 1/2 (50%) | 3/4 (75%) | +25% ✅ |
| **Parse Time (avg)** | 12s | 5.7s | -52.5% ✅ |
| **Completed Files** | 100 | 150 | +50 ✅ |
| **Hang Behavior** | Batch 2 hung | Batch 4 hung | Similar ❌ |

**Key Insight**: Smaller batches help but don't eliminate the fundamental issue of complex file parsing.

## Implications for Architecture

### Current Streaming Architecture (Phase 1)
- ✅ **Works**: Incremental writes to Neo4j proven successful
- ✅ **Memory Management**: Clearing after write works correctly
- ❌ **Not Sufficient**: Doesn't solve ts-morph parsing bottleneck

### The Real Problem: ts-morph Project Parsing

**Batch size is NOT the issue**. The issue is:
1. Creating ts-morph `Project` with 50-100 files
2. Calling `project.addSourceFilesAtPaths(batch)`
3. ts-morph loads and type-checks ALL files in the Project
4. Some files take 20+ seconds to parse
5. No way to skip or limit type checking depth

**Why Memory Drops to 491MB**:
- ts-morph might be in a GC thrashing loop
- OR one specific file triggers exponential type expansion
- OR the process is stuck in type checking resolution with no progress

## Recommended Next Steps

### Option 1: Reduce Batch Size to 20 Files (Quick Test)

**Rationale**: If batch 4 contains 2-3 problematic files, reducing to 20 files/batch might isolate them.

**Expected Outcome**:
- More frequent progress updates
- Easier to identify which specific files cause hangs
- Lower peak memory (~1GB)

**Risk**: May not solve the problem if individual files are the issue.

---

### Option 2: Add Per-File Parsing with Timeout (Recommended)

**Change Architecture**:
Instead of:
```typescript
batchProject.addSourceFilesAtPaths(batch); // Add all 50 files
await parseTsProjectFilesBatch(batchProject, batchTargetPaths); // Parse all
```

Do:
```typescript
for (const filePath of batch) {
  const fileProject = new Project({ skipAddingFilesFromTsConfig: true });
  fileProject.addSourceFileAtPath(filePath); // ONE file at a time
  
  try {
    await parseWithTimeout(fileProject, filePath, 30000); // 30s timeout
  } catch (timeout) {
    logger.warn(`File parsing timeout: ${filePath}`);
    // Continue to next file
  }
  
  // Write this single file's results to Neo4j
  await writeCurrentBatchToStorage();
}
```

**Benefits**:
- Isolates problematic files
- Per-file timeout actually works
- No entire batch lost due to one file
- Maximum streaming granularity

**Drawbacks**:
- 1,717 Project instantiations (very high overhead)
- Might be slower overall
- No cross-file type context during parsing

---

### Option 3: Skip Type Checking (Fastest, But Lossy)

**Use ts-morph without full type resolution**:
```typescript
const project = new Project({
  compilerOptions: {
    skipLibCheck: true,
    skipDefaultLibCheck: true,
    types: [], // Don't load any type definitions
  },
});
```

**Benefits**:
- Much faster parsing (10-100x)
- No type checking overhead
- Just AST extraction

**Drawbacks**:
- Lose cross-file type relationships
- Can't resolve import sources accurately
- Misses type-based connections

---

### Option 4: Hybrid Approach (Best Balance)

1. **Pass 1A - Quick Parse** (No type checking):
   - Extract basic AST structure
   - Get imports/exports
   - Identify symbols
   - Write to Neo4j immediately

2. **Pass 1B - Type Resolution** (Selective, post-write):
   - For files that need it, re-parse with types
   - Use per-file timeout
   - Add type relationships to Neo4j

3. **Pass 2 - Cross-File Resolution** (Current approach):
   - Load full Project once
   - Resolve imports
   - Add CALLS relationships

**This gives us**:
- Fast initial parsing (all files succeed)
- Optional deep analysis (can fail gracefully)
- Complete data even with some failures

## Immediate Action Items

1. **Investigate Batch 4 Files**: Manually check which files are in batch 4 (files 151-200)
2. **Add Debug Logging**: Log each file as it starts/completes parsing
3. **Test Single File**: Parse batch 4 files one-by-one to find the culprit
4. **Consider Skip Type Checking**: Test parsing speed without full type resolution

## Success Criteria for Next Test

- [ ] All 35 batches complete without hanging
- [ ] Peak memory stays under 2GB
- [ ] Total analysis time < 15 minutes
- [ ] Clear identification of problematic files
- [ ] Graceful handling of slow/complex files

## Conclusion

**Reducing batch size from 100 to 50 files:**
- ✅ Improved success rate (75% vs 50%)
- ✅ Reduced peak memory (2.6GB vs 3.2GB)
- ✅ Faster per-batch parsing (5.7s vs 12s)
- ❌ Did NOT eliminate hanging behavior

**The fundamental issue is ts-morph's type checking overhead on complex files, NOT batch size.**

Next step: Implement **per-file parsing with individual timeouts** to identify and skip problematic files while allowing the analysis to continue.
