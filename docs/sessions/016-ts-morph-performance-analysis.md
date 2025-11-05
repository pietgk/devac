# ts-morph Performance Analysis for CodeGraph

> Analysis Date: 2025-11-05
> Context: Determining optimal batch size for streaming architecture

## Current Implementation

### Batch Processing Architecture

**Current Code** (parser.ts:265-295):
```typescript
// Create a fresh Project instance for this batch
const batchProject = new Project({
  tsConfigFilePath: "tsconfig.json",
  skipAddingFilesFromTsConfig: true,
});

// Add only this batch's files to the fresh project
batchProject.addSourceFilesAtPaths(batch);

// Parse the batch
await this._parseTsProjectFilesBatch(batchProject, batchTargetPaths);

// Stream write to Neo4j
if (this.storageManager) {
  await this.writeCurrentBatchToStorage();
}

// Clear batch project
batchProject.getSourceFiles().forEach((sf) => batchProject.removeSourceFile(sf));
if (global.gc) global.gc();
```

**Current Batch Size**: 100 files per batch

## ts-morph Architecture & Overhead

### Project Instantiation Costs

#### Per-Instance Overhead
1. **TypeScript Compiler Program**: Each `new Project()` creates a new TypeScript compiler program
2. **Type Checker**: New type checker instance for each Project
3. **Module Resolution Host**: Custom resolution logic initialized per Project
4. **File System**: Virtual or physical file system wrapper
5. **Library Files**: Default loads lib.d.ts files from memory (fake `/node_modules/typescript/lib`)

#### Memory Characteristics
- **In-Memory AST**: All source files kept as parsed AST nodes in memory
- **Symbol Tables**: Type information cached for type checking
- **Node Tracking**: ts-morph wraps compiler nodes and tracks them until `.forget()` called
- **No Sharing**: Each Project instance is isolated - no shared state between instances

### Performance Data Points

From ts-morph documentation and GitHub issues:

1. **Test Performance**: Creating new Project on every test "does a lot of useless work" (~80ms → ~30ms using single instance)
2. **Node Forgetting**: Main optimization technique for reducing memory during manipulation
3. **Program Reset**: "The program is reset between manipulations" - expensive operation
4. **Structure Operations**: 10-100x performance improvement using structures vs node manipulation

## Trade-offs: Multiple Project Instances vs Larger Batches

### Option A: Current Approach (100 files, New Project per Batch)

**Pros**:
- ✅ Memory isolation between batches
- ✅ Automatic cleanup when Project goes out of scope
- ✅ No cross-batch memory accumulation
- ✅ Simpler mental model

**Cons**:
- ❌ **High instantiation overhead**: Each Project creates full compiler program
- ❌ **Redundant type checking**: Same type definitions loaded 18 times (for 1,717 files)
- ❌ **No type information sharing**: Each batch re-resolves imports, types, symbols
- ❌ **Slower for large batches**: Creating Project with 100 files takes ~318ms in our test

**Memory Profile**:
- Batch 1: 229MB during parsing → writes to Neo4j → clears
- Batch 2: STUCK at 3.2GB during parsing (not yet clearing)

### Option B: Smaller Batches (20-50 files, New Project per Batch)

**Pros**:
- ✅ Lower peak memory per batch
- ✅ Faster Project instantiation (fewer files to add)
- ✅ More frequent memory clearing (streaming writes every 20-50 files)
- ✅ Better progress visibility

**Cons**:
- ❌ **More Project instantiations**: 34-85 instances vs 18 instances
- ❌ **More overhead total**: Compiler program created 34-85 times
- ❌ **Slower overall**: More setup/teardown cycles

**Estimated Memory Profile**:
- Batch peak: ~500MB-1GB per batch (smaller batches = lower peaks)
- More batches but each completes faster

### Option C: Single Project, All Files (1 file = 1 batch)

**Pros**:
- ✅ One-time instantiation cost
- ✅ Shared type information across all files
- ✅ Faster per-file processing (no setup overhead)

**Cons**:
- ❌ **Memory accumulation**: All files kept in memory until explicitly cleared
- ❌ **Defeats streaming purpose**: Would need to parse all files before first write
- ❌ **Highest peak memory**: 4GB+ for monorepo-3.0
- ❌ **No isolation**: One file error could affect batch

### Option D: File-by-File Processing (1 file per Project)

**Pros**:
- ✅ Lowest peak memory per operation
- ✅ Maximum isolation
- ✅ Streaming writes after every single file

**Cons**:
- ❌ **Extreme overhead**: 1,717 Project instantiations
- ❌ **Slowest overall**: Massive redundant work
- ❌ **No type context**: Each file parsed in isolation (might miss cross-file relationships)

## Observed Behavior: Why Batch 2 Got Stuck

### The Problem

Batch 1 completed successfully (1,587 nodes, 1,150 rels, 229MB memory).
Batch 2 process stuck with **3.2GB memory usage** during parsing phase.

### Root Cause Analysis

The issue is NOT the Project instantiation itself, but rather:

1. **Complex TypeScript Parsing**: Batch 2 likely contains files with:
   - Deep import chains
   - Large type definitions
   - Complex generic types
   - Heavy decorator usage (NestJS, etc.)

2. **No Incremental Progress**: The batch is "all or nothing" - parsing all 100 files before writing
   - If file #23 is complex and takes 5+ minutes, we see no progress
   - Memory grows as files accumulate in `tsResults` Map

3. **AST Node Accumulation**: Each file's AST is fully parsed and held in memory:
   - Average file might be 10-50KB source → 500KB-2MB AST
   - 100 files × 1-2MB AST = 100-200MB just for AST
   - Plus symbol tables, type information, etc.

## Recommended Approach

### Strategy: Adaptive Batch Sizing

Instead of a fixed batch size, use **complexity-based batching**:

```typescript
const SMALL_BATCH = 20;   // For files with lots of imports/exports
const MEDIUM_BATCH = 50;  // For typical files
const LARGE_BATCH = 100;  // For simple utility files

// Analyze file complexity:
// - Line count
// - Import count
// - Export count
// - Class/interface count

// Group files by complexity, batch accordingly
```

### Immediate Action: Reduce Batch Size to 50

**Rationale**:
1. Cuts peak memory in half (~1.5GB vs 3.2GB)
2. Only doubles Project instantiations (36 vs 18)
3. More frequent progress updates
4. Still benefits from batch efficiency
5. **2x overhead is acceptable trade-off for 2x memory reduction**

### Code Change Required

**File**: `src/analyzer/parser.ts` (line ~185)

```typescript
// Current:
const BATCH_SIZE = 100;

// Change to:
const BATCH_SIZE = 50;

// Or adaptive:
const BATCH_SIZE = tsFilesToAdd.length < 500 ? 50 : 
                    tsFilesToAdd.length < 5000 ? 75 : 100;
```

## Expected Results with Batch Size = 50

### monorepo-3.0 (1,717 files)

- **Batches**: 35 batches (vs 18 currently)
- **Peak Memory**: ~1-1.5GB per batch (vs 3.2GB observed)
- **Progress Updates**: Every 50 files (better visibility)
- **Total Time**: Slightly longer due to more Project instantiations
  - Current estimate: 18 batches × 15 seconds = 4.5 minutes
  - New estimate: 35 batches × 12 seconds = 7 minutes
  - **Trade-off**: +2.5 minutes for 50% memory reduction → ACCEPTABLE

### Memory Profile Prediction

```
Batch 1:  50 files → ~700MB → write → clear
Batch 2:  50 files → ~800MB → write → clear
Batch 3:  50 files → ~750MB → write → clear
...
Batch 35: 17 files → ~300MB → write → clear
```

**No batch should exceed 1.5GB** with 50-file batches.

## Long-Term Optimization: Phase 2

For Phase 2 (File-by-File Processing), consider:

### Hybrid Approach: Shared Symbol Table

```typescript
// Create ONE Project for the entire repository
const masterProject = new Project({
  tsConfigFilePath: "tsconfig.json",
  skipAddingFilesFromTsConfig: false,  // Load all files for type context
});

// Parse files one-by-one, but with access to full type information
for (const sourceFile of masterProject.getSourceFiles()) {
  await parseFile(sourceFile);  // Extract AST
  await writeToNeo4j();         // Stream write
  sourceFile.forget();          // Forget node to free memory
}
```

**Benefits**:
- One-time Project setup
- Shared type information (proper cross-file analysis)
- Per-file memory clearing via `.forget()`
- Best of both worlds

**Complexity**: Higher - requires careful node forgetting and memory management.

## Conclusion

### Immediate Recommendation

**Change batch size from 100 to 50 files.**

This is the **best balance** between:
- ✅ Acceptable memory usage (<1.5GB per batch)
- ✅ Reasonable overhead (35 Project instantiations vs 18)
- ✅ Better progress visibility (more frequent updates)
- ✅ Proven architecture (just tuning existing code)

### Success Criteria

After implementing batch size = 50:
1. All 35 batches complete without OOM
2. Peak memory stays under 2GB
3. Total analysis time < 10 minutes
4. All 1,717 files parsed successfully

If successful, this validates the streaming architecture and we can proceed with confidence.

### Future Optimization

Once stable at batch size = 50, explore:
1. Adaptive batching based on file complexity
2. Shared Project with per-file `.forget()`
3. Parallel batch processing (2-3 batches at once)
