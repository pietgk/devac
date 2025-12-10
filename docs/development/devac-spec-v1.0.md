# DevAC Spec v1.0: Incremental Graph Updates

> **Version**: 1.0  
> **Date**: 2025-12-10  
> **Status**: Active

---

## Goal

Transform CodeGraph from **batch processing** (analyze entire repo, 30-60s) to **incremental updates** (react to file changes in <200ms) for all 8 supported languages.

**Why**: Reduce validation time from 30-60s (full repo) to 2-5s (affected files only).

**How**: Connect FileWatcher → Language Router → Parsers → Neo4j.

---

## Working Components

| Component | Location | Speed | Status |
|-----------|----------|-------|--------|
| StructuralParser | `src/analyzer/structural-parser.ts` | ~20ms | ✅ Working |
| SemanticResolver | `src/analyzer/semantic-resolver.ts` | 2-5s/batch | ✅ Working |
| FileWatcher | `src/devac/services/codegraph/file-watcher.ts` | - | ✅ Working |
| StorageManager | `src/analyzer/storage-manager.ts` | <50ms | ✅ Working |
| Neo4jClient | `src/database/neo4j-client.ts` | - | ✅ Working |
| Java parser | `src/analyzer/parsers/java-parser.ts` | <80ms | ✅ Working |
| Go parser | `src/analyzer/parsers/go-parser.ts` | <50ms | ✅ Working |
| C/C++ parser | `src/analyzer/parsers/c-cpp-parser.ts` | <80ms | ✅ Working |
| C# parser | `src/analyzer/parsers/csharp-parser.ts` | <70ms | ✅ Working |
| Python parser | `src/analyzer/parsers/python-parser.ts` | 200-500ms | ⚠️ Slow |

---

## Broken Components (Skip)

| Component | Errors | Decision |
|-----------|--------|----------|
| XState actors in `src/devac/actors/` | 103 | Archive, don't fix |
| validation-coordinator.actor.ts | 37 | Archive |
| validation-coordinator.service.ts | 19 | Archive |

**Rationale**: Previous specs (v1-v9) spent weeks trying to fix these. The complexity isn't worth it - create simple integration instead.

---

## Two-Phase Parsing Architecture

All languages benefit from two-phase parsing for complete code analysis. Currently, **only TypeScript/JavaScript has both phases implemented**. Other languages only have Phase 1.

### Phase 1: Structural (Immediate, <100ms)
- **Purpose**: Fast AST extraction without cross-file resolution
- **Extracts**: Classes, functions, methods, imports (as unresolved strings), exports
- **Relationships**: `CONTAINS` (File→Class), `OWNS` (Class→Method)
- **Speed**: <100ms per file (target)
- **Trigger**: On every file change (immediate)

### Phase 2: Semantic (Deferred, batched)
- **Purpose**: Cross-file relationship resolution, type information
- **Resolves**: `IMPORTS` relationships, inheritance, type dependencies
- **Speed**: Slower (seconds), processed in background batches
- **Trigger**: Queued after structural parse

```
File Change
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Phase 1: Structural (immediate, <100ms)                 │
│   StructuralParser → StorageManager → Neo4j            │
│   Creates: nodes, CONTAINS, OWNS relationships         │
│   Import strings stored but NOT resolved               │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Phase 2: Semantic (deferred, batched)                   │
│   SemanticResolver → Neo4j                             │
│   Resolves: IMPORTS relationships across files         │
│   Uses language-specific type resolution               │
└─────────────────────────────────────────────────────────┘
```

### Current Implementation Status

| Language | Phase 1 (Structural) | Phase 2 (Semantic) |
|----------|---------------------|-------------------|
| TypeScript/JavaScript | ✅ StructuralParser (Babel) | ✅ SemanticResolver (ts-morph) |
| Python | ⚠️ python-parser (slow) | ❌ Not implemented |
| Java | ✅ tree-sitter-java | ❌ Not implemented |
| Go | ✅ tree-sitter-go | ❌ Not implemented |
| C/C++ | ✅ tree-sitter-c/cpp | ❌ Not implemented |
| C# | ✅ tree-sitter-c-sharp | ❌ Not implemented |
| SQL | ⚠️ tree-sitter-sql (disabled) | ❌ Not implemented |

**Why two phases?**
- Phase 1 is fast enough for real-time feedback (<100ms)
- Phase 2 requires loading multiple files and type checking (slow but accurate)
- Users see immediate structural updates; semantic links appear shortly after

---

## Future Architecture: Language-Specific Structural Parsers

Per `multi-language-incremental-parsing-support-analysis-plan.md`, we plan to implement **Option 1: Language-Specific Structural Parsers** for best results:

```
src/analyzer/structural-parsers/
├── typescript-structural-parser.ts  (EXISTS - Babel)
├── python-structural-parser.ts      (NEW - keep-alive process)
├── java-structural-parser.ts        (NEW - optimized tree-sitter)
├── go-structural-parser.ts          (NEW - optimized tree-sitter)
├── cpp-structural-parser.ts         (NEW - optimized tree-sitter)
├── csharp-structural-parser.ts      (NEW - optimized tree-sitter)
└── sql-structural-parser.ts         (NEW - tree-sitter)
```

Each parser will:
1. Return consistent `StructuralParseResult` interface
2. Be optimized for its language's idioms
3. Support future Phase 2 semantic resolution

---

## Long-Term Vision: Full CPG + DevAC

The end goal is a complete **Code Property Graph (CPG)** for all languages, enabling a full **DEVelopment Analytics Centre** experience:

### CPG Components (Future)
| Component | Description | Status |
|-----------|-------------|--------|
| **AST** | Abstract Syntax Tree - code structure | ✅ Current focus |
| **CFG** | Control Flow Graph - execution paths | ❌ Future |
| **PDG** | Program Dependency Graph - data/control dependencies | ❌ Future |

### DevAC Capabilities (Future)
- **OTel Tracing Integration** - Link code to runtime behavior
- **Impact Analysis** - "What breaks if I change this?"
- **Security Analysis** - Vulnerability detection via graph queries
- **Performance Profiling** - Hot path identification
- **Test Coverage Mapping** - Code → Test relationships

### Incremental Foundation
This spec establishes the **incremental update foundation** that all future capabilities build on:
- Real-time graph updates enable live analysis
- Language-agnostic pipeline supports any future parser
- Two-phase architecture allows mixing fast/slow analysis

---

## Integration Layer (New)

Create a simple `IncrementalPipeline` class:

```
FileWatcher → LanguageRouter → Parser → StorageManager → Neo4j
                                  │
                                  └──→ SemanticResolver (TS/JS only, deferred)
```

**LanguageRouter** maps file extensions to parsers:
- `.ts`, `.tsx`, `.js`, `.jsx` → StructuralParser + queue for SemanticResolver
- `.py` → PythonParser
- `.java` → JavaParser
- `.go` → GoParser
- `.c`, `.cpp`, `.h` → CppParser
- `.cs` → CSharpParser

**Atomic Updates**: For file changes, delete existing nodes then insert new ones in a single transaction.

---

## Implementation Phases

### Phase 1: TypeScript/JavaScript (Foundation)
- Create `src/pipeline/language-router.ts`
- Create `src/pipeline/incremental-pipeline.ts`
- Wire FileWatcher → StructuralParser → StorageManager
- Fix 11 TypeScript errors in working components (structural-parser.ts, semantic-resolver.ts)
- **Target**: TS/JS files update graph in <100ms

### Phase 2: Tree-Sitter Languages
- Add Java, Go, C/C++, C# to LanguageRouter
- These parsers already work and are fast (<100ms)
- **Target**: All tree-sitter languages working

### Phase 3: Python Optimization
- Implement keep-alive Python process (eliminate subprocess overhead)
- **Target**: Python files update graph in <100ms

---

## Success Criteria

1. `tsc --noEmit` passes (0 errors)
2. File change triggers graph update in <200ms
3. All 8 languages supported
4. Atomic updates: old nodes deleted, new nodes inserted

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/pipeline/language-router.ts` | Route files to correct parser |
| `src/pipeline/incremental-pipeline.ts` | Orchestrate file change → graph update |

## Files to Modify

| File | Changes |
|------|---------|
| `package.json` | Add `@types/babel__traverse` |
| `src/analyzer/structural-parser.ts` | Fix 9 TypeScript errors |
| `src/analyzer/semantic-resolver.ts` | Fix 2 TypeScript errors |

---

## Key Decisions

1. **Bypass XState actors** - Create simple integration instead of fixing 103 errors
2. **Use working components directly** - No unnecessary abstraction layers
3. **Python keep-alive** - Per analysis in `multi-language-incremental-parsing-support-analysis-plan.md`
4. **Phased rollout** - TS/JS first, then other languages
