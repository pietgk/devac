# Plan: Multi-Language Incremental Parsing Support Analysis

## Objective
Analyze what's needed to extend incremental single-file change handling from TypeScript/JavaScript to all 8 supported languages in CodeGraph.

---

## Executive Summary

### Current State
- **TypeScript/JavaScript**: POC uses Babel-based StructuralParser achieving ~20ms/file (10x faster than target)
- **Other languages**: Use tree-sitter or subprocess parsers with no incremental support, taking 50-500ms/file

### Key Finding
**Tree-sitter parsers are already fast enough (<50ms) for most languages.** The main bottleneck is Python's subprocess overhead (~100-300ms startup cost).

### Recommendation
**Phased approach**:
1. Phase 1: Fix TypeScript POC integration (v9 spec - current priority)
2. Phase 2: Add Python incremental support (eliminate subprocess overhead)
3. Phase 3: Enable tree-sitter languages (already fast, minimal changes needed)

---

## Detailed Analysis by Language

### 1. TypeScript/JavaScript (DONE - POC EXISTS)

| Aspect | Current | Incremental Target | Gap |
|--------|---------|-------------------|-----|
| Parser | Babel (StructuralParser) | Same | None |
| Speed | ~20ms/file | <50ms | ✅ Achieved |
| Semantic | Deferred (ts-morph batch) | Same | None |

**Status**: ✅ POC complete, needs integration (v9 spec)

---

### 2. Python

| Aspect | Current | Incremental Target | Gap |
|--------|---------|-------------------|-----|
| Parser | Subprocess → Python AST | tree-sitter-python OR keep-alive process | Major |
| Speed | 100-300ms startup + 200-500ms parse | <50ms | **Critical** |
| Semantic | None | None needed | None |

**Options Analysis**:

#### Option A: Switch to tree-sitter-python (npm)
| Pros | Cons |
|------|------|
| Eliminates subprocess overhead completely | Different AST structure than Python's native AST |
| Consistent with Java/Go/C++ approach | May miss Python-specific constructs |
| ~30-50ms parse time achievable | Requires rewriting visitor code |
| In-process, no IPC serialization | Less battle-tested than Python's AST |

**Effort**: 6-8 hours
**Risk**: Medium (AST differences could miss edge cases)

#### Option B: Keep-Alive Python Process
| Pros | Cons |
|------|------|
| Keeps Python's native AST (proven correct) | Process lifecycle management complexity |
| Minimal code changes to parser logic | IPC protocol needed (stdin/stdout JSON) |
| ~50-150ms achievable (eliminates startup) | Process crashes need handling |
| Maintains existing node extraction | Memory growth over time possible |

**Effort**: 4-6 hours
**Risk**: Medium (process management complexity)

#### Option C: py-tree-sitter (Python bindings)
| Pros | Cons |
|------|------|
| Best of both worlds (tree-sitter speed + Python ecosystem) | Requires Python runtime anyway |
| Official tree-sitter Python bindings | Adds dependency complexity |
| ~30-50ms achievable | Still needs Python process |

**Effort**: 8-10 hours
**Risk**: High (complex dependency chain)

**Recommendation**: **Option B (Keep-Alive Process)** - Lowest risk, preserves proven AST parsing

---

### 3. Java

| Aspect | Current | Incremental Target | Gap |
|--------|---------|-------------------|-----|
| Parser | tree-sitter-java | Same (optimized) | Minor |
| Speed | ~50-80ms/file | <50ms | Small |
| Semantic | None | None needed | None |

**Options Analysis**:

#### Option A: Use Existing tree-sitter-java (Recommended)
| Pros | Cons |
|------|------|
| Already implemented and working | Slightly above 50ms target |
| Proven correct for Java syntax | No type resolution |
| In-process, no overhead | May need visitor optimization |
| ~50-80ms is acceptable | |

**Effort**: 2-3 hours (add incremental wiring)
**Risk**: Low

#### Option B: Optimize tree-sitter-java Visitor
| Pros | Cons |
|------|------|
| Could achieve <50ms | Requires code analysis |
| Skip function body traversal | May lose some useful data |
| Match StructuralParser pattern | Testing overhead |

**Effort**: 4-6 hours
**Risk**: Low

**Recommendation**: **Option A first**, then Option B if performance insufficient

---

### 4. Go

| Aspect | Current | Incremental Target | Gap |
|--------|---------|-------------------|-----|
| Parser | tree-sitter-go | Same | None |
| Speed | ~30-50ms/file | <50ms | ✅ Achieved |
| Semantic | None | None needed | None |

**Status**: ✅ Already fast enough - just needs incremental wiring

**Effort**: 2-3 hours (add incremental wiring)
**Risk**: Low

---

### 5. C/C++

| Aspect | Current | Incremental Target | Gap |
|--------|---------|-------------------|-----|
| Parser | tree-sitter-c/cpp | Same | Minor |
| Speed | ~40-80ms/file | <50ms | Small |
| Semantic | None | None needed | None |

**Options Analysis**:

#### Option A: Use Existing tree-sitter (Recommended)
| Pros | Cons |
|------|------|
| Already working | Header files not included |
| ~40-80ms acceptable | No macro expansion |
| In-process | Complex files may exceed 50ms |

**Effort**: 2-3 hours (add incremental wiring)
**Risk**: Low

#### Option B: Add libclang for Semantic Phase
| Pros | Cons |
|------|------|
| Complete semantic analysis | Very slow (200-500ms/file) |
| Type resolution, inheritance | Requires Clang binary |
| Production-grade C++ parsing | Complex integration |

**Effort**: 15-20 hours
**Risk**: High

**Recommendation**: **Option A** - Use tree-sitter for structural, consider libclang only if semantic analysis needed later

---

### 6. C#

| Aspect | Current | Incremental Target | Gap |
|--------|---------|-------------------|-----|
| Parser | tree-sitter-c-sharp | Same | Minor |
| Speed | ~40-70ms/file | <50ms | Small |
| Semantic | None | None needed | None |

**Status**: Close to target - needs incremental wiring + minor optimization

**Effort**: 2-3 hours (add incremental wiring)
**Risk**: Low

---

### 7. SQL

| Aspect | Current | Incremental Target | Gap |
|--------|---------|-------------------|-----|
| Parser | tree-sitter-sql (DISABLED) | Same | Re-enable |
| Speed | ~20-40ms/file | <50ms | ✅ Achieved |
| Semantic | None | None needed | None |

**Status**: Fast but disabled - needs investigation and re-enabling

**Effort**: 3-4 hours (investigate issues, re-enable)
**Risk**: Medium (unknown why disabled)

---

## Architecture Options

### Option 1: Language-Specific Structural Parsers (Most Work, Best Results)

Create a `StructuralParser` equivalent for each language:

```
src/analyzer/structural-parsers/
├── typescript-structural-parser.ts  (EXISTS - Babel)
├── python-structural-parser.ts      (NEW - tree-sitter or keep-alive)
├── java-structural-parser.ts        (NEW - optimized tree-sitter)
├── go-structural-parser.ts          (NEW - optimized tree-sitter)
├── cpp-structural-parser.ts         (NEW - optimized tree-sitter)
├── csharp-structural-parser.ts      (NEW - optimized tree-sitter)
└── sql-structural-parser.ts         (NEW - tree-sitter)
```

| Pros | Cons |
|------|------|
| Consistent interface across languages | Significant implementation effort |
| Each language optimized independently | Code duplication |
| Clear Phase 1/Phase 2 separation | Maintenance burden |
| Best performance possible | Testing complexity |

**Total Effort**: 30-40 hours
**Risk**: Medium

### Option 2: Unified Tree-Sitter Wrapper (Less Work, Good Results)

Create a single wrapper that handles all tree-sitter languages:

```typescript
// src/analyzer/structural-parsers/tree-sitter-structural-parser.ts
class TreeSitterStructuralParser {
  constructor(language: "java" | "go" | "cpp" | "csharp" | "python" | "sql") {
    this.parser = new TreeSitter();
    this.parser.setLanguage(GRAMMARS[language]);
  }

  async parseStructural(filePath: string): Promise<StructuralParseResult> {
    // Unified parsing logic
    // Language-specific visitors as strategies
  }
}
```

| Pros | Cons |
|------|------|
| Single implementation for 6 languages | Less optimization per language |
| Consistent interface | May miss language-specific optimizations |
| Easier maintenance | Strategy pattern adds complexity |
| Faster to implement | TypeScript/Python still need separate handling |

**Total Effort**: 15-20 hours
**Risk**: Low

### Option 3: Minimal Changes - Add Incremental Wiring Only (Least Work)

Don't create new parsers - just wire existing parsers to file watcher:

```typescript
// In IncrementalAnalyzer
async handleFileChange(event: FileChangeEvent): Promise<void> {
  const ext = path.extname(event.path);

  switch (ext) {
    case ".ts": case ".tsx": case ".js": case ".jsx":
      await this.structuralParser.parseStructural(event.path);
      break;
    case ".py":
      await this.pythonParser.parseFile({ path: event.path, extension: ext });
      break;
    case ".java":
      await this.javaParser.parseFile({ path: event.path, extension: ext });
      break;
    // ... etc
  }
}
```

| Pros | Cons |
|------|------|
| Minimal code changes | Python still slow (subprocess) |
| Reuses proven parsers | No Phase 1/Phase 2 optimization |
| Fastest to implement | Performance varies by language |
| Low risk | Not truly "structural-only" parsing |

**Total Effort**: 8-12 hours
**Risk**: Low

---

## Recommended Approach (Based on User Input)

**User Requirements**:
- Performance target: <100ms acceptable (not strict <50ms for all)
- Python: Use keep-alive process to eliminate subprocess overhead
- Timeline: Complete v9 first, then add multi-language support

---

### Phase 1: TypeScript/JavaScript POC Integration (v9 Spec) - CURRENT PRIORITY
- Fix 103 type errors in POC
- Integrate POC into production
- Ensure multi-language fallback works
- **Timeline**: 4-5 weeks (per v9 spec)
- **Deliverable**: TypeScript/JavaScript has fast incremental parsing

### Phase 2: Multi-Language Incremental Support (After v9)
**Timeline**: 2-3 weeks after v9 complete

#### Week 1: Wire Tree-Sitter Languages
- Add incremental routing for Java, Go, C++, C#, SQL
- Use existing tree-sitter parsers (already <100ms)
- Create `MultiLanguageIncrementalRouter` class
- **Effort**: 8-10 hours

#### Week 2: Python Keep-Alive Process
- Modify `python-parser.ts` to use persistent process
- Implement stdin/stdout JSON protocol
- Add process lifecycle management (startup, crash recovery)
- Target: <100ms per file (down from 200-500ms)
- **Effort**: 4-6 hours

#### Week 3: Testing & Hardening
- Integration tests for all languages
- Performance benchmarks
- Error handling for parser failures
- **Effort**: 6-8 hours

### Phase 3: Optimization (Optional, If Needed)
- Create unified structural parser wrapper
- Language-specific optimizations
- Consider tree-sitter-python if keep-alive insufficient
- **Timeline**: Only if Phase 2 performance inadequate

---

## Performance Summary

| Language | Current Speed | Incremental Target | Achievable? | Effort |
|----------|--------------|-------------------|-------------|--------|
| TypeScript | 20ms (Babel) | <50ms | ✅ YES | Done (POC) |
| JavaScript | 20ms (Babel) | <50ms | ✅ YES | Done (POC) |
| Python | 200-500ms | <100ms* | ⚠️ WITH WORK | 4-6 hours |
| Java | 50-80ms | <80ms | ✅ YES | 2-3 hours |
| Go | 30-50ms | <50ms | ✅ YES | 2-3 hours |
| C/C++ | 40-80ms | <80ms | ✅ YES | 2-3 hours |
| C# | 40-70ms | <70ms | ✅ YES | 2-3 hours |
| SQL | 20-40ms | <50ms | ✅ YES | 3-4 hours |

*Python <50ms requires keep-alive process or tree-sitter switch

---

## Decision Points for User

1. **Do we need <50ms for ALL languages, or is <100ms acceptable for some?**
   - If <100ms is acceptable: Option 3 (minimal changes) works
   - If <50ms required: Need Python optimization (Phase 3)

2. **Is Python incremental support critical?**
   - If yes: Prioritize keep-alive process (4-6 hours extra)
   - If no: Python can use batch processing, TS/JS gets incremental

3. **Do we want Phase 1/Phase 2 separation for all languages?**
   - If yes: Need Option 2 (unified wrapper) - more work but cleaner
   - If no: Option 3 works fine

4. **Timeline priority?**
   - Fast (2-3 weeks): Option 3 → all languages have incremental, Python slower
   - Thorough (5-6 weeks): Option 2 → optimized per language

---

## Files to Modify (Option 3 - Minimal Changes)

### New Files
- `src/devac/integration/multi-language-incremental.ts` - Language router

### Modified Files
- `src/devac/integration/incremental-analyzer.ts` - Add language routing
- `src/devac/services/codegraph/codegraph-service.ts` - Enable for all languages

### Unchanged (Reused)
- `src/analyzer/parsers/python-parser.ts`
- `src/analyzer/parsers/java-parser.ts`
- `src/analyzer/parsers/go-parser.ts`
- `src/analyzer/parsers/c-cpp-parser.ts`
- `src/analyzer/parsers/csharp-parser.ts`
- `src/analyzer/parsers/sql-parser.ts`

---

## Conclusion

**The path to multi-language incremental support is straightforward:**

1. Tree-sitter languages (Java, Go, C++, C#, SQL) are **already fast enough** - just need wiring
2. Python needs optimization but has **clear solutions** (keep-alive process)
3. TypeScript/JavaScript POC already **proves the architecture works**

**Recommended next step**: Complete v9 spec (TypeScript POC integration), then add minimal multi-language wiring (Option 3) as a quick follow-up.
