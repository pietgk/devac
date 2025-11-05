# CodeGraph Future Improvements Plan

**Date**: November 3, 2025  
**Current State**: C4 diagram support working, areas for improvement identified  
**Philosophy**: Elegantly simple, high-impact changes

---

## Analysis Summary

### Current Metrics
- ✅ **Packages**: 11/11 discovered (100%)
- ⚠️ **Import Resolution**: 1,578/4,488 (35.2%)
- ⚠️ **Hook Usage**: 1 relationship (315 components × 108 hooks = potential for thousands)
- ⚠️ **Component Rendering**: 30 relationships (315 components = potential for hundreds)

### Root Causes Identified

**1. Path Aliases Not Resolved (65% of failures)**
```
Unresolved: core/constants (76 imports)
Unresolved: ui (68 imports)  
Unresolved: hooks/reduxHooks (55 imports)
```
**Why**: Each package has its own `tsconfig.json` with `baseUrl` and `paths`. Current implementation only reads workspace-root tsconfig.

**2. Hook Usage Not Tracked (99.9% missing)**
- 315 React components detected ✅
- 108 hooks detected ✅
- Only 1 USES_HOOK relationship created ❌

**Why**: `findUsedHooks()` only detects direct calls like `useEffect()`, misses:
- `const { data } = useQuery()` (destructured)
- `const query = useCustomHook()` (assigned)

**3. Cross-File Components Not Linked (90% missing)**
- 315 components detected ✅
- Only 30 RENDERS_COMPONENT relationships ❌

**Why**: `findComponentByName()` only searches same file, misses imported components.

---

## Proposed Improvements (Priority Order)

### 🎯 Priority 1: Per-Package Path Alias Resolution
**Impact**: 35% → 70%+ import resolution (solve ~1,400 imports)

**The Problem**:
```typescript
// In mindlercare package
import { COLORS } from "core/constants"; // ❌ Not resolved

// Because we're reading workspace tsconfig, not package tsconfig
// Package tsconfig has: "core/constants": ["src/core/constants"]
```

**The Elegant Solution**:
1. When resolving import from file X, find X's package
2. Read that package's tsconfig.json
3. Use package-specific `baseUrl` + `paths` for resolution

**Implementation**:
- File: `src/analyzer/parsers/import-resolver.ts`
- Add: `loadPackageTsConfig(packagePath: string)` method
- Cache: tsconfig per package (11 packages = 11 configs)
- Change: `resolvePathAlias()` to use package-specific paths

**Estimated Effort**: 2 hours  
**Lines of Code**: ~80 lines  
**Value**: High - Solves majority of resolution failures

---

### 🎯 Priority 2: Enhanced Hook Usage Detection  
**Impact**: 1 → 2,000+ USES_HOOK relationships

**The Problem**:
```typescript
// Current detection - ✅ Works
useEffect(() => {...}, []);

// Not detected - ❌ Missing
const { data, isLoading } = useQuery(...);
const dispatch = useDispatch();
```

**The Elegant Solution**:
Enhance `findUsedHooks()` in component-analyzer.ts:
1. Find all `CallExpression` with identifier starting with "use"
2. Track variable declarations that call hooks
3. Include destructuring patterns

**Implementation**:
- File: `src/analyzer/parsers/component-analyzer.ts`
- Method: `findUsedHooks()` enhancement
- Add: Detection for `VariableDeclaration` with hook call initializer

**Estimated Effort**: 1.5 hours  
**Lines of Code**: ~40 lines  
**Value**: High - Enables hook dependency analysis

---

### 🎯 Priority 3: Cross-File Component Resolution
**Impact**: 30 → 200+ RENDERS_COMPONENT relationships

**The Problem**:
```typescript
// Component.tsx
import { Button } from '@mindlercare/ui-web';

function MyComponent() {
  return <Button>Click</Button>; // ❌ Not linked to Button component
}
```

**The Elegant Solution**:
1. When component renders `<Button>`, search all Function nodes named "Button"
2. Filter by most likely match:
   - Same package (highest priority)
   - Imported package (check IMPORTS → RESOLVES_TO chain)
   - Any package (lowest priority)

**Implementation**:
- File: `src/analyzer/resolvers/component-relationship-resolver.ts`
- Enhance: `findComponentByName()` to search across files
- Use: Package context and import chain for matching

**Estimated Effort**: 2 hours  
**Lines of Code**: ~60 lines  
**Value**: Medium-High - Better component hierarchy visualization

---

### 🎯 Priority 4: Simple Test Suite
**Impact**: Prevent regressions, enable confident future changes

**The Elegant Approach**: Test only NEW code (3 test files)

**Test 1: Package Extraction** (`package-extractor.test.ts`)
```typescript
test('discovers packages from pnpm workspace', async () => {
  const extractor = new PackageExtractor('/path/to/frontend-monorepo');
  const packages = await extractor.discoverPackages();
  expect(packages).toHaveLength(11);
  expect(packages.map(p => p.name)).toContain('@mindlercare/ui-web');
});

test('maps files to correct package', () => {
  const pkg = extractor.getPackageForFile('/path/to/frontend-monorepo/packages/mindler-ui-web/src/index.tsx');
  expect(pkg?.name).toBe('@mindlercare/ui-web');
});
```

**Test 2: Import Resolution** (`import-resolver.test.ts`)
```typescript
test('resolves workspace package import', async () => {
  const resolved = await resolver.resolve(
    { moduleSpecifier: '@mindlercare/ui-web' },
    '/path/to/mindlercare/src/App.tsx'
  );
  expect(resolved?.targetPackage).toBe('@mindlercare/ui-web');
});

test('resolves relative import', async () => {
  const resolved = await resolver.resolve(
    { moduleSpecifier: './Button' },
    '/path/to/components/Form.tsx'
  );
  expect(resolved?.targetFile).toContain('Button');
});
```

**Test 3: Component Detection** (`component-analyzer.test.ts`)
```typescript
test('detects React component', () => {
  const func = createFunctionNode('MyComponent', 'return <div />;');
  const isComponent = analyzer.isReactComponent(func);
  expect(isComponent).toBe(true);
});

test('detects React hook', () => {
  const func = createFunctionNode('useCustomHook', '...');
  const isHook = analyzer.isReactHook(func);
  expect(isHook).toBe(true);
});
```

**Implementation**:
- Files: 3 test files in `src/analyzer/parsers/__tests__/`
- Framework: Use existing vitest setup
- Coverage: Focus on public API of new classes

**Estimated Effort**: 3 hours  
**Lines of Code**: ~250 lines (test code)  
**Value**: Medium - Quality assurance, regression prevention

---

### 🎯 Priority 5: Add File CONTAINS Function Relationships
**Impact**: Cleaner queries (quality of life improvement)

**The Problem**:
```cypher
// Current query - works but awkward
MATCH (comp:Function)
WHERE comp.isReactComponent = true AND comp.filePath = '/some/path'

// Desired query - cleaner
MATCH (f:File {filePath: '/some/path'})-[:CONTAINS]->(comp:Function)
WHERE comp.isReactComponent = true
```

**The Elegant Solution**:
Add CONTAINS relationship when creating Function nodes in Pass 1.

**Implementation**:
- File: `src/analyzer/parsers/function-parser.ts`
- Add: Create CONTAINS relationship after creating Function node
- Link: Function → parent File using `context.fileNode.entityId`

**Estimated Effort**: 30 minutes  
**Lines of Code**: ~15 lines  
**Value**: Low - Just cleanup, queries already work

---

## Implementation Phases

### Phase 1: High-Impact (Recommended First)
**Time**: 3.5 hours total
1. ✅ Per-package path alias resolution (2 hours) - 35% → 70% improvement
2. ✅ Enhanced hook detection (1.5 hours) - 1 → 2,000+ relationships

**Expected Outcome**: 
- Import resolution doubles
- Hook dependency tracking functional
- C4 diagrams show hook usage patterns

---

### Phase 2: Quality & Completeness
**Time**: 5 hours total
3. ✅ Cross-file component resolution (2 hours) - 30 → 200+ relationships
4. ✅ Test suite (3 hours) - Regression prevention

**Expected Outcome**:
- Rich component hierarchy across packages
- Confidence in making future changes
- Automated validation

---

### Phase 3: Polish (Optional)
**Time**: 30 minutes
5. ✅ CONTAINS relationships (30 min) - Cleaner query syntax

**Expected Outcome**:
- Slightly cleaner Cypher queries
- More conventional graph structure

---

## Non-Goals (Deliberately Excluded)

### ❌ Node_modules Resolution
**Why Not**: External dependencies (react, styled-components) don't need resolution for architecture analysis. C4 diagrams focus on internal structure.

**Current State**: 312 react imports, 219 styled-components imports unresolved.  
**Decision**: Keep unresolved. They're "external systems" in C4 terminology.

### ❌ Type Relationship Expansion
**Why Not**: Complex to implement, low value for architecture visualization.
- Interface implementations: Hard to track across files
- Type usage: Creates too much noise in graph

**Decision**: Focus on runtime architecture (components, packages, imports).

### ❌ Performance Optimization
**Why Not**: Current performance acceptable.
- 945 files analyzed in ~50 seconds
- Large queries run in <100ms

**Decision**: Optimize only if analyzing 10,000+ file codebases.

---

## Expected Outcomes After Implementation

### Metrics Improvement
| Metric | Before | After Phase 1 | After Phase 2 |
|--------|--------|---------------|---------------|
| Import Resolution | 35.2% | **~70%** | ~70% |
| USES_HOOK relationships | 1 | **~2,000** | ~2,000 |
| RENDERS_COMPONENT | 30 | 30 | **~200** |
| Test Coverage (new code) | 0% | 0% | **80%** |

### New Capabilities Enabled
1. **Hook Dependency Analysis** - See which components use which hooks
2. **Component Composition Patterns** - Visualize component hierarchies across packages
3. **Internal Import Graph** - 70% of internal imports resolved and graphed
4. **Regression Protection** - Tests prevent future breakage

---

## Elegance Principles Applied

✅ **Fix Root Causes, Not Symptoms**
- Don't manually resolve "core/constants" 
- Fix per-package tsconfig reading instead

✅ **High Impact First**
- Phase 1 gives 2× import resolution and hook tracking
- Phase 2/3 are polish and quality

✅ **Minimal Code Changes**
- Total: ~445 new lines (including tests)
- No architectural changes needed

✅ **Test What Matters**
- Test new code only (package-extractor, import-resolver, component-analyzer)
- Don't test existing parser infrastructure

✅ **No Over-Engineering**
- Don't resolve node_modules (not needed)
- Don't track type relationships (too complex, low value)
- Don't optimize performance (not needed yet)

---

## Recommendation

**Start with Phase 1** (3.5 hours):
- Biggest bang for buck
- Doubles import resolution
- Enables hook dependency analysis

**Then Phase 2 if needed** (5 hours):
- Adds robustness and completeness
- Tests provide confidence

**Skip Phase 3 unless requested**:
- Nice to have, not necessary

---

**Total Estimated Time**: 9 hours for complete implementation  
**Realistic Timeline**: 1-2 days of focused work  
**Core Value**: Achieved in first 3.5 hours (Phase 1)
