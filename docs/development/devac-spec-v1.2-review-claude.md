# DevAC Spec v1.2 Architecture Review

> **Reviewer**: Claude  
> **Date**: 2025-12-10  
> **Spec Version**: 1.2  
> **Scope**: Feasibility, Architecture, Implementation, Performance

---

## Executive Summary

The spec is **well-structured and largely sound**, but has several critical gaps that will impact implementation success. The core two-phase parsing architecture is correct, but the integration plan underestimates complexity in 3 key areas: (1) LanguageRouter doesn't exist yet and requires significant tree-sitter adapter work, (2) the relationship between existing Parser class and new StructuralParser is unclear, and (3) the per-file mutex pattern has a subtle race condition.

**Overall Assessment**: **Feasible with modifications** - 12-15 days more realistic than 10-12.

---

## 1. Feasibility Analysis

### 1.1 TypeScript Errors: ✅ Correctly Identified

**Verified**: `npx tsc --noEmit` produces exactly **103 errors** as documented.

Error distribution is accurate:
- `validation-coordinator.actor.ts`: 37 errors (wrong import paths + XState v5 typing)
- `semantic-resolver.actor.ts`: 7 errors (type mismatches)
- `script-executor.actor.ts`: 8 errors (XState v5 event typing)

**Key Finding**: The spec correctly identifies the root cause as XState v5 migration issues and missing `@types/babel__traverse`. However, fixing these will expose additional issues:

```typescript
// Example: validation-coordinator.actor.ts line 9-13
import type { FileChangeEvent } from "../types/file-watcher.js";  // ❌ Doesn't exist
import type { Neo4jClient } from "../graph/neo4j-client.js";       // ❌ Wrong path
import type { StructuralParser } from "../parsers/structural-parser.js"; // ❌ Wrong path
```

**These files need to be created or paths fixed** - not just type errors.

### 1.2 Working Components: ⚠️ Partially Correct

**Actually Working**:
- ✅ `src/analyzer/parser.ts` - Full batch processing (ts-morph based)
- ✅ `src/analyzer/structural-parser.ts` - Babel-based fast parser
- ✅ `src/analyzer/semantic-resolver.ts` - Class-based resolver
- ✅ `src/database/neo4j-client.ts` - Working Neo4j client

**Exists But Broken**:
- ⚠️ `src/devac/actors/validation-coordinator.actor.ts` - 37 TS errors
- ⚠️ `src/devac/actors/graph-updater.actor.ts` - 4 TS errors
- ⚠️ `src/devac/actors/semantic-resolver.actor.ts` - 7 TS errors

**Missing (Not Just Broken)**:
- ❌ `src/pipeline/language-router.ts` - Doesn't exist
- ❌ `src/devac/types/file-watcher.ts` - Doesn't exist
- ❌ `src/devac/graph/neo4j-client.ts` - Wrong path (exists elsewhere)
- ❌ Tree-sitter incremental adapter - Doesn't exist

### 1.3 "Broken" Components: ⚠️ Underestimated

The spec lists components as "broken" (needing TS fixes), but some require more than type fixes:

| Component | Spec Says | Reality |
|-----------|-----------|---------|
| `validation-coordinator.actor.ts` | 37 TS errors | Also needs FileWatcher, new imports |
| `semantic-resolver.actor.ts` | 7 errors | Also needs `RelationshipResolver` constructor mismatch |
| `graph-updater.actor.ts` | 4 errors | Uses `StructuralParseResult` but it differs from actor's definition |

**Critical Finding**: The `StructuralParseResult` type in `graph-updater.actor.ts` (lines 33-52) doesn't match `structural-parser.ts` (lines 26-38):

```typescript
// graph-updater.actor.ts - expects:
nodes: Array<{ entityId, kind, name, filePath, line, column }>

// structural-parser.ts - returns:
nodes: AstNode[]  // Full AstNode with more properties
```

---

## 2. Architecture Review

### 2.1 Two-Phase Parsing: ✅ Sound Design

The structural → semantic split is correct and mirrors modern IDE architecture:

```
Phase 1 (Structural): File → Babel/TreeSitter → Nodes + Relationships
                      Fast, no cross-file resolution, ~100ms
                      
Phase 2 (Semantic):   Batch → ts-morph → Cross-file relationships
                      Slower, requires type info, background
```

**Strength**: Separating parsing concerns enables:
- Fast initial indexing (<100ms)
- Background semantic resolution
- Graceful degradation when type info unavailable

### 2.2 Single Orchestrator: ✅ Correct Decision

Using `ValidationCoordinatorActor` instead of a separate `IncrementalPipeline` avoids:
- Duplicate state management
- Competing orchestration logic
- Complex inter-orchestrator communication

**Minor Issue**: The spec shows ValidationCoordinatorActor managing both file watching AND validation script execution. Consider splitting script execution to a separate concern for cleaner boundaries.

### 2.3 LanguageRouter: ⚠️ Missing Design Detail

The spec mentions LanguageRouter but provides no implementation detail:

```typescript
// Spec mentions (line 42):
├─► LanguageRouter.parse(filePath)
│       │
│       └─► StructuralParseResult
```

**Missing Details**:
1. How does it select parser? Extension-based? Content sniffing?
2. How do tree-sitter parsers map to the existing `StructuralParseResult` format?
3. What happens when no parser matches?

**Recommended Design**:
```typescript
class LanguageRouter {
  private parsers: Map<string, Parser>;  // .ts -> StructuralParser, etc.
  
  async parse(filePath: string): Promise<StructuralParseResult | ParseError> {
    const ext = path.extname(filePath);
    const parser = this.parsers.get(ext);
    
    if (!parser) {
      return { type: "ParseError", message: `No parser for ${ext}` };
    }
    
    return parser.parse(filePath);
  }
}
```

### 2.4 Component Boundaries: ⚠️ Needs Clarification

**Unclear Relationships**:

1. **Parser vs StructuralParser**: Both exist. Which is used for incremental?
   - `src/analyzer/parser.ts` - Batch processing with ts-morph
   - `src/analyzer/structural-parser.ts` - Babel-based fast parsing
   
   **Answer needed**: StructuralParser for incremental, Parser for full sync?

2. **Neo4jClient paths**: Two potential clients:
   - `src/database/neo4j-client.ts` (exists, works)
   - `src/devac/graph/neo4j-client.ts` (import path in actors, doesn't exist)
   
   **Answer**: Update actor imports to use correct path.

3. **SemanticResolver duplication**:
   - `src/analyzer/semantic-resolver.ts` - Class-based
   - `src/devac/actors/semantic-resolver.actor.ts` - XState actor
   
   **Answer**: Actor wraps the class, but constructor args don't match.

---

## 3. Implementation Phases Review

### 3.1 Phase Ordering: ⚠️ Needs Adjustment

**Current Order (Spec)**:
1. Fix TypeScript errors (Days 1-3)
2. Core integration (Days 4-6)
3. Tree-sitter languages (Days 7-8)
4. Polish & testing (Days 9-10)
5. Python (Days 11-12)

**Problem**: Phase 2 (Core Integration) depends on LanguageRouter, which depends on tree-sitter adapters from Phase 3. This creates a circular dependency.

**Recommended Order**:
1. **Days 1-3**: Fix TypeScript errors + create missing type files
2. **Days 4-5**: Create LanguageRouter skeleton + tree-sitter adapters
3. **Days 6-7**: Wire LanguageRouter into ValidationCoordinatorActor
4. **Days 8-9**: Startup reconciliation + concurrency control
5. **Days 10-11**: Integration testing + performance
6. **Day 12+**: Python + buffer

### 3.2 Missing Dependencies

**Day 4 blocks on**:
- `src/devac/types/file-watcher.ts` (create)
- `src/devac/types/package.ts` (create or fix path)
- Correct Neo4j import paths

**Day 5 blocks on**:
- `reconcileOnStartup` needs FileScanner integration
- Per-file mutex needs queue implementation

### 3.3 Day Estimates: ⚠️ Optimistic

| Phase | Spec Estimate | Realistic Estimate | Why |
|-------|--------------|-------------------|-----|
| TS Errors | 3 days | 4 days | Also need to create missing files |
| Core Integration | 3 days | 4 days | LanguageRouter is more complex |
| Tree-sitter | 2 days | 2-3 days | 6 languages, each needs testing |
| Polish | 2 days | 2 days | Reasonable |
| Python | 2 days | 1-2 days | Already works, just subprocess overhead |

**Total**: 10-12 days → **13-15 days**

---

## 4. Performance Targets Review

### 4.1 <200ms/<100ms Targets: ⚠️ Achievable with Caveats

**Analysis**:

| Language | Spec Target | Achievable? | Notes |
|----------|-------------|-------------|-------|
| TypeScript/JS | <100ms | ✅ Yes | Babel ~20ms, Neo4j ~50ms measured |
| Java | <150ms | ⚠️ Maybe | Tree-sitter ~80ms, but Neo4j varies |
| Go | <100ms | ✅ Yes | Tree-sitter very fast for Go |
| C/C++ | <150ms | ⚠️ Maybe | Header resolution adds latency |
| C# | <150ms | ⚠️ Maybe | Similar to Java |
| Python | <300ms | ❌ Unlikely | Subprocess overhead ~200ms minimum |

**Neo4j Latency Concern**:
The spec assumes Neo4j ~50ms per file, but this depends on:
- Connection pool state (cold start: 100-200ms)
- Graph size (larger graphs = slower MERGE)
- Concurrent writes

**Recommendation**: Add connection pooling warmup to startup sequence.

### 4.2 Semantic Resolution: ✅ Reasonable

The 2-10s per batch of 10 files is reasonable for background processing. Current `SemanticResolver` already achieves this.

---

## 5. Missing Pieces

### 5.1 Error Handling: ⚠️ Incomplete

**Spec Covers**:
- Syntax error handling (parseError field)
- Retry logic in actors
- Queue overflow (dropOldest)

**Spec Missing**:
1. **Neo4j connection failures**: What happens during update?
2. **Transaction rollback**: Atomic delete+create, but what if create fails mid-way?
3. **Disk I/O errors**: File deleted between scan and parse
4. **Memory exhaustion**: No memory limits on ts-morph projects

**Recommended Additions**:
```typescript
// Add to GraphUpdaterActor events
| { type: "MARK_ERROR"; filePath: string; error: string; errorType: "parse" | "neo4j" | "io" }

// Add retry with exponential backoff
const RETRY_DELAYS = [1000, 2000, 4000]; // ms
```

### 5.2 Rollback Scenarios: ❌ Not Addressed

The spec notes "No graph versioning: Rollback capability deferred" but doesn't address:

1. **Partial updates**: If 50 files update, 10 fail, graph is inconsistent
2. **Corrupted state recovery**: How to detect and recover?
3. **Full re-sync trigger**: When should the system fall back to batch mode?

**Minimum Viable Solution**:
```typescript
// Add to File node
lastSuccessfulSync: DATETIME,  // Track last known-good state
syncAttempts: INTEGER,         // Track failures

// Add re-sync trigger
if (syncAttempts > 5) {
  triggerFullResync(workspaceRoot);
}
```

### 5.3 Failure Modes: ⚠️ Partially Addressed

**Covered**:
- Parse errors → Mark file, continue
- Queue full → Drop oldest
- Actor errors → Degraded mode with auto-recovery

**Not Covered**:
1. **FileWatcher crash**: No supervision strategy
2. **Neo4j unavailable**: Actors will retry indefinitely
3. **Infinite loop detection**: Rapid file changes causing restart loops
4. **Memory leaks**: Long-running ts-morph projects

### 5.4 Observability: ❌ Deferred

The spec defers "distributed tracing" but should include basic metrics:

```typescript
// Minimum viable observability
interface IncrementalMetrics {
  filesProcessed: Counter;
  parseLatencyMs: Histogram;
  neo4jWriteLatencyMs: Histogram;
  queueDepth: Gauge;
  errorsTotal: Counter;
}
```

---

## 6. Integration Points Review

### 6.1 FileWatcher → LanguageRouter → Parser: ⚠️ Gaps

**Current State**:
```
FileWatcher (doesn't exist in devac)
    ↓
ValidationCoordinatorActor (broken, 37 errors)
    ↓
??? (LanguageRouter doesn't exist)
    ↓
StructuralParser OR Parser? (both exist, unclear which)
```

**What Needs to Happen**:
1. Create `src/devac/types/file-watcher.ts` with `FileChangeEvent`
2. Create `src/pipeline/language-router.ts` 
3. Update `ValidationCoordinatorActor` to use LanguageRouter
4. Clarify Parser vs StructuralParser usage

### 6.2 Parser → StorageManager: ✅ Well-Defined

The existing batch processing path is clear:
```
Parser.parseFiles() → Parser.collectResults() → StorageManager.saveNodesBatch()
```

The spec correctly notes streaming writes per batch.

### 6.3 GraphUpdaterActor Integration: ⚠️ Type Mismatch

**Problem**: `GraphUpdaterActor` defines its own `StructuralParseResult`:
```typescript
// graph-updater.actor.ts
type StructuralParseResult = {
  nodes: Array<{ entityId, kind, name, filePath, line, column }>;
  relationships: Array<{ source, target, type }>;
  importStrings: string[];
  exportedSymbols: Array<{ name, kind }>;
};
```

But `structural-parser.ts` returns a different structure:
```typescript
// structural-parser.ts
interface StructuralParseResult {
  nodes: AstNode[];  // Full AstNode type
  relationships: RelationshipInfo[];  // Different shape
  importStrings: string[];
  exportedSymbols: ExportedSymbol[];  // Different shape
  metadata: { ... };  // Extra field
}
```

**Fix Required**: Unify types or create adapter.

### 6.4 SemanticResolverActor → RelationshipResolver: ⚠️ Constructor Mismatch

**Actor calls** (line 269-275):
```typescript
const resolver = new RelationshipResolver(
  miniProject,         // Project
  input.importResolver, // ImportResolver
  input.packages,      // PackageInfo[]
);
```

**RelationshipResolver expects** (`relationship-resolver.ts`):
```typescript
constructor(nodes: AstNode[], relationships: RelationshipInfo[]) {}
```

**Major Mismatch**: Actor passes Project, class expects nodes array.

---

## 7. Specific Recommendations

### 7.1 Immediate Actions (Before Phase 1)

1. **Create missing type files**:
   ```bash
   touch src/devac/types/file-watcher.ts
   touch src/devac/types/package.ts
   ```

2. **Fix import paths in actors** - point to existing modules:
   ```typescript
   // Change from:
   import type { Neo4jClient } from "../graph/neo4j-client.js";
   // To:
   import type { Neo4jClient } from "../../database/neo4j-client.js";
   ```

3. **Unify StructuralParseResult types** - single source of truth in `types.ts`

### 7.2 Phase 1 Additions

Add to Day 1:
- Create `FileChangeEvent` type
- Create `PackageInfo` re-export (or fix path)

Add to Day 3:
- Verify `RelationshipResolver` constructor matches actor usage
- Add integration test for StructuralParser → GraphUpdater flow

### 7.3 Phase 2 Additions

Add to Day 4:
- Design LanguageRouter extension points
- Create tree-sitter adapter interface

Add to Day 6:
- Add basic metrics (files/sec, errors/min)
- Add health check endpoint for FileWatcher

### 7.4 Performance Monitoring

Add before Phase 4:
```typescript
// In ValidationCoordinatorActor
context: {
  metrics: {
    lastParseMs: number;
    last10ParseMs: number[]; // Rolling average
    filesPerSecond: number;
  }
}
```

---

## 8. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Type unification takes longer | High | Medium | Day 1 priority, block on this |
| LanguageRouter complexity | Medium | High | Start simple, one language first |
| Neo4j latency variance | Medium | Medium | Add connection pooling, measure |
| Memory leaks in long-running | Low | High | Add periodic GC, monitor heap |
| XState v5 migration issues | High | Low | Known patterns, docs available |

---

## 9. Conclusion

The spec provides a solid foundation but needs:

1. **Type unification** before implementation starts
2. **LanguageRouter design detail** added to spec
3. **Realistic timeline adjustment** (13-15 days)
4. **Missing file creation** as explicit Phase 0

With these additions, the incremental update architecture is sound and achievable. The two-phase parsing design is correct, and the single-orchestrator decision avoids common distributed state issues.

**Recommendation**: Approve with revisions, start with Phase 0 (create missing files, unify types).
