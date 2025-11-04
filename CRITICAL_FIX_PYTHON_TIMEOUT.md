# Critical Fix: Python Parser Timeout

**Date**: 2025-11-04  
**Issue**: Analysis hanging on monorepo-3.0 due to Python subprocess without timeout  
**Priority**: CRITICAL - Blocking entire analysis pipeline

## Problem Discovered

After implementing the initial fixes for `.d.ts` filtering and TS timeout protection, testing revealed **a second hanging issue**:

### Symptoms
- Analysis starts successfully
- Scans 1,717 files correctly  
- Logs "Starting Python parsing" for 8 Python files
- **Then hangs indefinitely** - no further progress for 13+ minutes
- Process shows 100% CPU but produces no output
- Never reaches TypeScript batch processing

### Root Cause

**The Python parser spawns child processes without any timeout protection.**

**Location**: `src/analyzer/python-parser.ts` - `runPythonScript()` method

```typescript
// BEFORE - NO TIMEOUT
const childProcess = spawn(this.pythonExecutable, [scriptPath, filePath], { cwd: process.cwd() });

// If Python subprocess hangs, entire analysis hangs forever
childProcess.on("close", (code) => {
  // This never fires if Python hangs
  resolve(stdoutData);
});
```

### Why It Hung

1. The analysis creates promises for all file parsers (Python, TS, etc.)
2. Python subprocess is spawned for 8 `.py` files
3. One or more Python subprocesses hang (likely due to complex/malformed Python code)
4. The subprocess never completes → promise never resolves
5. At the end of `parseFiles()`, there's `await Promise.all(parsePromises)`
6. This waits forever for the hanging Python promise

## Solution Implemented

### Add 30-Second Timeout to Python Subprocess

**File**: `src/analyzer/python-parser.ts`

```typescript
private runPythonScript(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(this.pythonExecutable, [scriptPath, filePath], ...);
    
    let stdoutData = "";
    let stderrData = "";
    let timedOut = false;

    // ✅ NEW: Add timeout protection (30 seconds per Python file)
    const PYTHON_TIMEOUT_MS = 30000;
    const timeout = setTimeout(() => {
      timedOut = true;
      childProcess.kill('SIGTERM');
      logger.warn(`[PythonAstParser] ⏱️  Timeout (${PYTHON_TIMEOUT_MS}ms) killing Python process for: ${filePath}`);
      reject(new ParserError(`Python parsing timeout after ${PYTHON_TIMEOUT_MS}ms for ${filePath}`));
    }, PYTHON_TIMEOUT_MS);

    childProcess.on("error", (err) => {
      clearTimeout(timeout);  // ✅ Clean up timeout
      reject(err);
    });

    childProcess.on("close", (code) => {
      clearTimeout(timeout);  // ✅ Clean up timeout
      
      if (timedOut) {
        return; // Already rejected via timeout
      }
      
      if (code === 0) {
        resolve(stdoutData);
      } else {
        reject(new ParserError(`Python script failed with code ${code}`));
      }
    });
  });
}
```

### Key Changes

1. **Timeout Setup**: 30-second timer starts when subprocess spawns
2. **Forced Kill**: If timeout fires, send SIGTERM to kill the subprocess
3. **Promise Rejection**: Immediately reject promise with timeout error
4. **Cleanup**: Clear timeout in both success and error paths
5. **Guard Flag**: `timedOut` flag prevents double-rejection

## Impact

### Before Fix
- ❌ Python parsing could hang indefinitely
- ❌ Entire analysis blocked waiting for Python
- ❌ No visibility into which Python file caused the issue
- ❌ Had to manually kill process (no graceful handling)

### After Fix
- ✅ Python files timeout after 30 seconds
- ✅ Analysis continues with other files
- ✅ Clear warning log shows which file timed out
- ✅ Error is caught and logged gracefully
- ✅ Overall analysis can still complete

## Testing

### Commands to Test
```bash
cd /Users/grop/ws/CodeGraph
npm run build
node dist/index.js workspace sync --config .codegraph/workspace.json --repos monorepo-3.0
```

### Expected Behavior
1. Analysis starts and scans files (✅)
2. Python files are parsed (✅ or timeout with warning)
3. TypeScript batches process with progress logs (✅)
4. Analysis completes successfully (✅)

### Warning Log Example
```
[PythonAstParser] ⏱️  Timeout (30000ms) killing Python process for: /path/to/file.py
[Parser] error: Parsing failed for /path/to/file.py: Python parsing timeout after 30000ms
```

## Related Fixes

This complements the earlier TS timeout fix:

1. **TS File Timeout** (already implemented)
   - Location: `src/analyzer/parser.ts` - `_parseTsProjectFiles()`
   - Timeout: 30 seconds per TS file
   - Wraps individual parser calls with `withTimeout()`

2. **Python File Timeout** (this fix)
   - Location: `src/analyzer/python-parser.ts` - `runPythonScript()`
   - Timeout: 30 seconds per Python file  
   - Kills subprocess + rejects promise

3. **Other Parsers** (to review)
   - C/C++ parser - uses tree-sitter (likely doesn't hang)
   - Java parser - uses tree-sitter (likely doesn't hang)
   - Go parser - uses tree-sitter (likely doesn't hang)
   - SQL parser - currently disabled

## Why Tree-Sitter Parsers Don't Need Timeouts

Tree-sitter parsers (Java, C++, Go) are:
- **Synchronous** - parse immediately, no subprocess
- **Error-resilient** - designed to handle malformed code
- **Fast** - typically parse in milliseconds
- **No I/O blocking** - pure in-memory parsing

Python parser is different because:
- **Spawns subprocess** - can hang on process spawn/communication
- **Uses external Python interpreter** - depends on system Python
- **Can block on I/O** - if Python file does weird imports/execution

## Prevention Strategy

**All external subprocess operations should have timeouts:**

1. ✅ Python parser - 30s timeout (this fix)
2. ✅ TypeScript individual file parsing - 30s timeout
3. ✅ TypeScript batch processing - implicit (fails individual files, not whole batch)
4. Consider: Adding timeout to C/C++/Java/Go if they start causing issues

## Files Changed

- `src/analyzer/python-parser.ts` - Added timeout to `runPythonScript()`

## Next Steps

1. ✅ Build completed successfully
2. ⏳ Test full workspace sync on monorepo-3.0
3. ⏳ Verify Python files either parse or timeout gracefully
4. ⏳ Confirm TS batches process successfully
5. ⏳ Check final Neo4j node count

## Success Criteria

- Analysis completes within reasonable time (~10-15 minutes for 1,717 files)
- Python timeout warnings appear for problematic files (if any)
- TypeScript batches show progress every 5 batches
- Final "Analysis complete" message
- Nodes successfully written to Neo4j

---

**This was the critical missing piece** - without Python timeout protection, any hanging Python file would block the entire analysis indefinitely.
