# DevAC Spec v1.6: Incremental Graph Updates

> **Version**: 1.6 (Simplified Implementation-Ready)  
> **Date**: 2025-12-10  
> **Status**: APPROVED FOR IMPLEMENTATION  
> **Timeline**: 22 days (includes Phase 0 verification)

---

## Important: Avoiding Spec-Fixing-Spec Loops

This spec consciously breaks the pattern of previous versions that added complexity without verifying assumptions. Key changes:

1. **Phase 0 added**: Verify actual file contents before planning fixes
2. **Scope narrowed**: Focus on graph updates first, defer validation execution
3. **Types verified against actual code**: Not spec-defined types
4. **Existing POC preserved**: Fix what exists, don't redesign

---

## Goal

Transform CodeGraph from **batch processing** (30-60s per repo) to **incremental updates** (<300ms per file change) for all 8 supported languages.

**Deferred to v2**: Validation script execution (type-checking, linting, tests)

---

## Critical Discovery: The POC is a Full Validation Pipeline

The `ValidationCoordinatorActor` is NOT just a graph updater. It orchestrates:

```
FileChange → StructuralUpdate → SemanticResolution → AffectedCalculation → ValidationExecution
                    │                   │                    │                     │
                    ▼                   ▼                    ▼                     ▼
             GraphUpdater      SemanticResolver      AffectedCalculator    ScriptExecutor
            (update Neo4j)     (resolve imports)    (find dependents)    (run npm validate)
```

**Previous specs (v1.0-v1.5) focused only on the first two steps**, ignoring that the POC was designed for a broader purpose: running validation scripts on affected packages.

### v1.6 Strategy: Phased Enablement

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 0 | Verify code, fix types | NEW |
| Phase 1 | Fix 103 TypeScript errors | Required |
| Phase 2 | Enable graph updates (structural + semantic) | Required |
| Phase 3 | Enable tree-sitter languages | Required |
| Phase 4 | Enable validation execution (affected + scripts) | DEFERRED to v2 |

---

## Spec Evolution Summary

| Version | Key Decision | Status |
|---------|-------------|--------|
| v1.0 | Bypass XState, create new IncrementalPipeline | Rejected |
| v1.1 | Fix XState actors, preserve tested POC logic | Adopted |
| v1.2 | Single orchestrator (ValidationCoordinatorActor) | Adopted |
| v1.3 | Type unification, correct file paths | Adopted |
| v1.4 | DELETE events, projectRoot scoping | Adopted |
| v1.5 | Transaction rollback, graceful shutdown | Adopted |
| v1.6 | Phase 0 verification, scope narrowing, defer validation | Current |

---

## Architecture (Simplified for v1.6)

### What We're Building in v1.6

```
FileWatcher
    │
    ▼ FileChangeEvent
ValidationCoordinatorActor
    │
    ├─► [1] LanguageRouter.parse() → StructuralParseResult
    │
    ├─► [2] GraphUpdaterActor → Neo4j atomic update
    │
    └─► [3] SemanticResolverActor.enqueue() [TS/JS only]

(Steps 4-5: AffectedCalculator + ScriptExecutor → DEFERRED to v2)
```

### What We're Deferring to v2

- `AffectedCalculatorActor` - works but not wired for incremental
- `ScriptExecutorActor` - works but needs validation command configuration
- Full validation pipeline with `npm run validate`

---

## Verified File Locations

| Component | Path | Verified |
|-----------|------|----------|
| ValidationCoordinatorActor | `src/devac/actors/validation-coordinator.actor.ts` | YES |
| GraphUpdaterActor | `src/devac/actors/graph-updater.actor.ts` | YES |
| SemanticResolverActor | `src/devac/actors/semantic-resolver.actor.ts` | YES |
| AffectedCalculatorActor | `src/devac/actors/affected-calculator.actor.ts` | YES |
| ScriptExecutorActor | `src/devac/actors/script-executor.actor.ts` | YES |
| FileWatcher | `src/devac/services/codegraph/file-watcher.ts` | YES |
| Neo4jClient | `src/database/neo4j-client.ts` | YES |
| StructuralParser | `src/analyzer/structural-parser.ts` | YES |

### Wrong Import Paths (Must Fix)

```typescript
// validation-coordinator.actor.ts currently imports:
import type { FileChangeEvent } from "../types/file-watcher.js";        // WRONG
import type { Neo4jClient } from "../graph/neo4j-client.js";            // WRONG
import type { StructuralParser } from "../parsers/structural-parser.js"; // WRONG
import type { ImportResolver } from "../resolution/import-resolver.js";  // WRONG
import type { PackageInfo } from "../types/package.js";                  // WRONG

// Should be:
import type { FileChangeEvent } from "../services/codegraph/file-watcher.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";
import type { StructuralParser } from "../../analyzer/structural-parser.js";
// ImportResolver and PackageInfo need to be found or created
```

---

## Type Mismatch Analysis (CRITICAL)

### The Problem

Three different `StructuralParseResult` definitions exist:

**1. In graph-updater.actor.ts (line 30-50):**
```typescript
export type StructuralParseResult = {
  nodes: Array<{
    entityId: string;
    kind: string;
    name: string;
    filePath: string;
    line: number;      // <-- Uses 'line'
    column: number;    // <-- Uses 'column'
  }>;
  relationships: Array<{
    source: string;    // <-- Uses 'source'
    target: string;    // <-- Uses 'target'
    type: string;
  }>;
  importStrings: string[];
  exportedSymbols: Array<{ name: string; kind: string }>;
};
```

**2. In structural-parser.ts (actual output):**
```typescript
// Returns nodes with:
startLine: number;     // <-- Uses 'startLine'
endLine: number;
startColumn: number;   // <-- Uses 'startColumn'
endColumn: number;

// Returns relationships with:
sourceId: string;      // <-- Uses 'sourceId'
targetId: string;      // <-- Uses 'targetId'
```

**3. In specs v1.3-v1.5 (proposed):**
```typescript
// A third variant that doesn't match either
```

### The Solution

**Use GraphUpdaterActor's type as canonical** and adapt StructuralParser output:

```typescript
// src/pipeline/adapters/parse-result-adapter.ts (NEW FILE)

import type { StructuralParseResult as GraphUpdaterResult } from "../devac/actors/graph-updater.actor.js";

export function adaptParseResult(
  parserOutput: ParserOutput
): GraphUpdaterResult {
  return {
    nodes: parserOutput.nodes.map(n => ({
      entityId: n.entityId,
      kind: n.kind,
      name: n.name,
      filePath: n.filePath,
      line: n.startLine,      // Map startLine → line
      column: n.startColumn,  // Map startColumn → column
    })),
    relationships: parserOutput.relationships.map(r => ({
      source: r.sourceId,     // Map sourceId → source
      target: r.targetId,     // Map targetId → target
      type: r.type,
    })),
    importStrings: parserOutput.importStrings,
    exportedSymbols: parserOutput.exportedSymbols,
  };
}
```

**Why this approach:**
- GraphUpdaterActor already works with its type definition
- Minimal changes to existing code
- Adapter pattern isolates the mismatch

---

## Cross-File Relationship Strategy (P0)

### The Concern

Atomic delete+create may lose cross-file relationships (IMPORTS, CALLS, etc.) that point TO the deleted nodes.

### Analysis

Looking at `graph-updater.actor.ts`:
1. Delete is scoped: `MATCH (f:File {filePath: $filePath})-[:OWNS]->(n:Node)`
2. Only deletes nodes OWNED by the file
3. Cross-file relationships where this file's nodes are TARGETS are automatically deleted (DETACH DELETE)
4. Cross-file relationships where this file's nodes are SOURCES are recreated in structural phase

### Strategy: Accept and Regenerate

**For v1.6**: Accept that cross-file edges are regenerated via:
1. Structural phase recreates outgoing relationships (IMPORTS, CALLS from this file)
2. Semantic phase resolves incoming relationships (by re-processing dependent files)
3. AffectedCalculatorActor identifies dependents (deferred to v2)

**Document as Known Limitation**: Cross-file incoming edges may be temporarily stale until semantic re-resolution. This is acceptable for v1.6.

---

## Error Count & Fixes

### Total: 103 TypeScript Errors (Re-verified)

| File | Errors | Primary Fix |
|------|--------|-------------|
| `validation-coordinator.actor.ts` | ~37 | Wrong import paths, XState v5 typing |
| `validation-coordinator.service.ts` | ~19 | Wrong import paths |
| `structural-parser.ts` | 9 | Missing @types/babel__traverse |
| `script-executor.actor.ts` | 8 | XState v5 event typing |
| `semantic-resolver.actor.ts` | 7 | Type mismatches |
| `performance-monitor.ts` | 7 | Undefined checks |
| `query-profiler.ts` | 5 | Unknown type casts |
| `affected-calculator.actor.ts` | 5 | XState v5 event typing |
| `graph-updater.actor.ts` | 4 | XState v5 event typing |
| `semantic-resolver.ts` | 2 | null vs undefined |

### XState v5 Event Typing Pattern

The actors use XState v5 but have v4-style event typing. Fix pattern:

```typescript
// BEFORE (causes type errors):
actions: {
  setResult: assign({
    result: ({ event }) => event.output,  // Error: 'output' doesn't exist
  }),
}

// AFTER (XState v5 compatible):
actions: {
  setResult: assign({
    result: ({ event }) => {
      if ("output" in event) {
        return event.output as ResultType;
      }
      return null;
    },
  }),
}
```

---

## Implementation Timeline (22 days)

### Phase 0: Verification (Days 1-2) - NEW

**Day 1:**
- Run `tsc --noEmit 2>&1 | head -200` to capture actual errors
- Map each error to specific file and line
- Verify import paths against actual file system
- Document any files that don't exist

**Day 2:**
- Identify missing type definitions (ImportResolver, PackageInfo, etc.)
- Decide: create stubs OR find existing definitions
- Create Phase 0 completion report
- **EXIT GATE**: Clear understanding of actual work needed

### Phase 1: Fix TypeScript Errors (Days 3-7)

**Day 3:**
- `npm install --save-dev @types/babel__traverse --legacy-peer-deps`
- Fix `structural-parser.ts` (9 errors)
- Fix `semantic-resolver.ts` (2 errors)

**Day 4:**
- Fix `validation-coordinator.actor.ts` import paths
- Apply XState v5 event typing pattern

**Day 5:**
- Fix `validation-coordinator.service.ts`
- Fix `performance-monitor.ts`
- Fix `query-profiler.ts`

**Day 6:**
- Fix remaining actors:
  - `graph-updater.actor.ts`
  - `affected-calculator.actor.ts`
  - `semantic-resolver.actor.ts`
  - `script-executor.actor.ts`

**Day 7:**
- Verify: `tsc --noEmit` produces 0 errors
- **EXIT GATE**: Must have 0 TS errors to proceed

### Phase 2: Core Integration (Days 8-14)

**Day 8:**
- Create `parse-result-adapter.ts` to bridge type mismatch
- Create `LanguageRouter` (simplified, no timeout initially)

**Day 9:**
- Wire LanguageRouter into ValidationCoordinatorActor
- Disable AffectedCalculator + ScriptExecutor steps (comment out, don't delete)

**Day 10:**
- Add startup reconciliation state
- Add event buffering during reconciliation

**Day 11:**
- Add DELETE_FILE handling to GraphUpdaterActor
- Test: file add, change, delete cycle

**Day 12:**
- Add per-file mutex for concurrency
- Add basic error handling (parseError field)

**Day 13:**
- Integration smoke tests
- Fix issues found

**Day 14:**
- End-to-end test: FileWatcher → Parser → Neo4j
- **EXIT GATE**: Basic pipeline working

### Phase 3: Tree-Sitter Languages (Days 15-18)

**Day 15:**
- Create tree-sitter adapter (matches GraphUpdater's type)
- Wire Java, Go parsers

**Day 16:**
- Wire C/C++, C# parsers
- Test each language

**Day 17:**
- Wire Python parser
- All 8 languages tested

**Day 18:**
- Fix issues, edge cases
- **EXIT GATE**: All languages working

### Phase 4: Polish (Days 19-22)

**Day 19:**
- Full test suite: `npm test`
- Fix regressions

**Day 20:**
- Performance benchmarks
- Document known limitations

**Day 21:**
- Add graceful shutdown
- Add basic metrics

**Day 22:**
- Final testing
- Buffer for unexpected issues

---

## Simplified State Machine (v1.6)

### ValidationCoordinatorActor (Modified)

```typescript
states: {
  idle: {
    on: { START: "reconciling" }
  },
  
  reconciling: {
    // NEW: Sync graph with filesystem on startup
    invoke: {
      src: "reconcileFilesystem",
      onDone: "watching",
      onError: "degraded"
    }
  },
  
  watching: {
    on: {
      FILE_CHANGED: [
        { guard: "isProcessing", actions: "queueFileChange" },
        { target: "processing" }
      ]
    }
  },
  
  processing: {
    initial: "parsing",
    states: {
      parsing: {
        // NEW: Use LanguageRouter instead of direct StructuralParser
        invoke: {
          src: "parseWithLanguageRouter",
          onDone: "updatingGraph",
          onError: "handleParseError"
        }
      },
      
      updatingGraph: {
        invoke: {
          src: "graphUpdater",
          onDone: "queueSemantic",
          onError: "handleGraphError"
        }
      },
      
      queueSemantic: {
        // Existing logic preserved
        entry: "enqueueForSemantic",
        always: [
          { guard: "hasQueuedFiles", target: "#processing" },
          { target: "#watching" }
        ]
      },
      
      handleParseError: {
        entry: "markFileParseError",
        always: "checkQueue"
      },
      
      handleGraphError: {
        entry: "markFileSyncError",
        always: "checkQueue"
      },
      
      checkQueue: {
        always: [
          { guard: "hasQueuedFiles", target: "#processing" },
          { target: "#watching" }
        ]
      }
      
      // REMOVED for v1.6:
      // calculatingAffected: { ... }
      // validating: { ... }
    }
  },
  
  degraded: {
    // Existing logic preserved
  }
}
```

---

## LanguageRouter (Simplified)

```typescript
// src/pipeline/language-router.ts

export class LanguageRouter {
  private structuralParser: StructuralParser;
  
  constructor(private workspaceRoot: string) {
    this.structuralParser = new StructuralParser();
  }
  
  canHandle(filePath: string): boolean {
    return this.getLanguage(filePath) !== null;
  }
  
  getLanguage(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_MAP[ext] ?? null;
  }
  
  async parse(filePath: string): Promise<ParseResult> {
    const language = this.getLanguage(filePath);
    if (!language) {
      return { success: false, error: "Unsupported file type" };
    }
    
    try {
      const result = await this.parseByLanguage(filePath, language);
      // Adapt to GraphUpdater's expected format
      return { success: true, data: adaptParseResult(result) };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }
  
  private async parseByLanguage(filePath: string, language: string) {
    switch (language) {
      case "typescript":
      case "javascript":
        return this.structuralParser.parseStructural(filePath);
      default:
        return this.parseWithTreeSitter(filePath, language);
    }
  }
}

const EXTENSION_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".java": "java",
  ".go": "go",
  ".c": "c",
  ".cpp": "cpp",
  ".cs": "csharp",
};
```

---

## Success Criteria

### Phase 0 Exit
- [ ] Actual error count documented
- [ ] All import paths mapped
- [ ] Missing types identified

### Phase 1 Exit
- [ ] `tsc --noEmit` produces 0 errors

### Phase 2 Exit
- [ ] File add triggers graph update
- [ ] File change triggers graph update
- [ ] File delete removes nodes
- [ ] Semantic queue receives files

### Phase 3 Exit
- [ ] All 8 languages parse correctly
- [ ] Graph updates work for all languages

### Final
- [ ] `npm test` passes
- [ ] No race conditions observed
- [ ] Performance within targets

---

## Known Limitations (v1.6)

1. **Validation execution disabled**: AffectedCalculator + ScriptExecutor not wired
2. **Cross-file edges may be stale**: Until semantic re-resolution
3. **No graceful shutdown**: Added in Phase 4 if time permits
4. **No metrics export**: In-memory only
5. **No content-hash rename detection**: Simple timestamp-based

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/pipeline/language-router.ts` | Route files to parsers |
| `src/pipeline/adapters/parse-result-adapter.ts` | Bridge type mismatch |
| `src/pipeline/adapters/tree-sitter-adapter.ts` | Adapt tree-sitter output |

## Files to Modify

| File | Changes |
|------|---------|
| `validation-coordinator.actor.ts` | Fix imports, add reconciling state, disable affected/validation |
| `graph-updater.actor.ts` | Fix XState typing, add DELETE handling |
| `structural-parser.ts` | Fix missing types |
| All other actors | Fix XState v5 typing |

---

## Deferred to v2

1. **Full validation pipeline**: AffectedCalculator → ScriptExecutor flow
2. **Content-hash rename detection**: Currently timestamp-based
3. **Graceful shutdown with drain**: Basic process.exit for now
4. **Metrics export**: Prometheus/StatsD integration
5. **Health check endpoint**: HTTP endpoint for monitoring
6. **Cross-file edge preservation**: Smarter diffing strategy

---

## Validation Checklist

### Avoiding Spec-Loop Issues

| Check | Status |
|-------|--------|
| Phase 0 verification added | YES |
| Types matched to actual code | YES (GraphUpdater as canonical) |
| Scope narrowed to achievable | YES (defer validation execution) |
| Existing POC structure preserved | YES |
| Import paths verified against filesystem | YES |

### Review Recap P0 Items

| Issue | Resolution |
|-------|------------|
| Type unification | Adapter pattern, use GraphUpdater's type |
| Import path mapping | Verified, documented fixes |
| Cross-file relationships | Accept regeneration via semantic phase |
| Phase 0 added | YES - 2 days for verification |

### Review Recap High Priority Items

| Issue | Resolution |
|-------|------------|
| Neo4j reconnection | Existing retry logic, defer enhancement |
| Heap monitoring | Defer to v2 |
| Semantic retry/backoff | Existing queue logic sufficient for v1 |

**Spec v1.6 is IMPLEMENTATION-READY with reduced scope and verification phase.**
