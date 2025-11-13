# DevAC Validation Basics - Foundation Specification

> **Purpose**: Define the minimum viable foundation needed for intelligent validation  
> **Scope**: Core infrastructure only - no features, no UI, no polish  
> **Timeline**: 1 week to validate, 1 week to implement

---

## Core Problem

**Current State**: Services validate entire repositories on every change (30-60 seconds)

**Desired State**: Services validate only affected files (2-5 seconds)

**Blocker**: Missing dependency graph relationships in Neo4j

---

## Foundation Requirements

### 1. Graph Completeness

**Why**: Cannot calculate affected files without complete dependency graph

**What's Missing**:
1. Package nodes may not be in Neo4j
2. File → Package relationships don't exist
3. IMPORTS relationships may be incomplete
4. Test → Source relationships don't exist
5. Config → File relationships don't exist

**Validation Queries**:
```cypher
// Check 1: Are packages in graph?
MATCH (p:Package) RETURN count(p) as packageCount

// Check 2: Are files linked to packages?
MATCH (p:Package)-[:CONTAINS_FILE]->(f:File) RETURN count(f) as linkedFiles

// Check 3: How many import relationships?
MATCH (f1:File)-[:IMPORTS]->(f2:File) RETURN count(*) as importCount

// Check 4: Are test files identified?
MATCH (t:File)-[:TESTS]->(s:File) RETURN count(*) as testCount

// Check 5: Are config files tracked?
MATCH (c:ConfigFile)<-[:CONFIGURED_BY]-(f:File) RETURN count(*) as configuredFiles
```

**How to Fix**:
- Run queries above on current graph
- Identify gaps
- Enhance analyzer to write missing relationships
- Re-analyze codebase
- Validate results

---

### 2. Query Performance

**Why**: Affected calculation must complete in <500ms for acceptable UX

**What to Test**:
```cypher
// Test 1: Direct dependents (should be <50ms)
MATCH (f:File {path: $path})<-[:IMPORTS]-(dependent:File)
RETURN dependent.path
LIMIT 100

// Test 2: Transitive dependents depth 5 (should be <200ms)
MATCH path = (f:File {path: $path})<-[:IMPORTS*1..5]-(dependent:File)
RETURN DISTINCT dependent.path

// Test 3: Package files (should be <100ms)
MATCH (p:Package {name: $package})-[:CONTAINS_FILE]->(f:File)
RETURN f.path
```

**How to Validate**:
- Create test workspace with realistic structure
- Insert 1,000+ files with import relationships
- Run queries above with PROFILE
- Measure execution time
- Add indexes if needed
- Re-test until <500ms threshold met

**Critical Indexes**:
```cypher
CREATE INDEX file_path_idx IF NOT EXISTS FOR (f:File) ON (f.path);
CREATE INDEX package_name_idx IF NOT EXISTS FOR (p:Package) ON (p.name);
CREATE CONSTRAINT file_path_unique IF NOT EXISTS FOR (f:File) REQUIRE f.path IS UNIQUE;
```

---

### 3. Service File-Scoped Execution

**Why**: Services must accept file lists, not just repository paths

**Current API**:
```typescript
// TypeCheckService
async checkRepository(repositoryPath: string): Promise<void>

// LintService
async lintRepository(repositoryPath: string): Promise<void>

// TestService
async testRepository(repositoryPath: string): Promise<void>
```

**Required API**:
```typescript
// TypeCheckService - must add
async checkFiles(filePaths: string[]): Promise<ValidationResult>

// LintService - must add
async lintFiles(filePaths: string[]): Promise<ValidationResult>

// TestService - must add
async runTests(testPaths: string[]): Promise<ValidationResult>
```

**How to Implement**:

**TypeCheck**:
```typescript
async checkFiles(filePaths: string[]): Promise<ValidationResult> {
  // Build file-specific tsc command
  const command = `npx tsc --noEmit ${filePaths.join(' ')}`;
  const result = await this.runCommand(command, repoPath, repoPath);
  return {
    success: result.exitCode === 0,
    errors: this.parseErrors(result, repoPath),
    duration: result.duration,
  };
}
```

**Lint**:
```typescript
async lintFiles(filePaths: string[]): Promise<ValidationResult> {
  // Build file-specific eslint command
  const command = `npx eslint ${filePaths.join(' ')}`;
  const result = await this.runCommand(command, repoPath, repoPath);
  return {
    success: result.exitCode === 0,
    errors: this.parseErrors(result, repoPath),
    duration: result.duration,
  };
}
```

**Test**:
```typescript
async runTests(testPaths: string[]): Promise<ValidationResult> {
  // Build test-specific command
  const command = `npm test -- ${testPaths.join(' ')}`;
  const result = await this.runCommand(command, repoPath, repoPath);
  return {
    success: result.exitCode === 0,
    failures: this.parseErrors(result, repoPath),
    duration: result.duration,
  };
}
```

**Validation**:
- Create test file with known error
- Call `checkFiles([testFile])`
- Verify error is detected
- Verify execution time <5 seconds
- Verify other files not validated

---

### 4. Affected Calculation Core Algorithm

**Why**: Must reliably calculate which files need validation

**Input**: Changed file path
**Output**: List of affected file paths + scope

**Algorithm**:
```typescript
async function calculateAffected(
  changedFilePath: string
): Promise<{ files: string[]; scope: 'file' | 'package' | 'repo' }> {
  
  // Step 1: Get direct dependents
  const directDeps = await neo4j.run(`
    MATCH (changed:File {path: $path})<-[:IMPORTS]-(dependent:File)
    RETURN dependent.path as path
  `, { path: changedFilePath });
  
  const affected = new Set([changedFilePath]);
  directDeps.forEach(d => affected.add(d.path));
  
  // Step 2: Check if threshold exceeded
  if (affected.size > 50) {
    // Too many files, go to package level
    const pkg = await neo4j.run(`
      MATCH (f:File {path: $path})<-[:CONTAINS_FILE]-(p:Package)
      RETURN p.name as package
    `, { path: changedFilePath });
    
    return {
      files: [],
      scope: 'package',
      package: pkg[0]?.package,
    };
  }
  
  // Step 3: Get transitive dependents (limited depth)
  const transitiveDeps = await neo4j.run(`
    MATCH path = (changed:File {path: $path})<-[:IMPORTS*2..5]-(dependent:File)
    WHERE length(path) <= 5
    RETURN DISTINCT dependent.path as path
    LIMIT 100
  `, { path: changedFilePath });
  
  transitiveDeps.forEach(d => affected.add(d.path));
  
  // Step 4: Check threshold again
  if (affected.size > 100) {
    return { files: [], scope: 'repo' };
  }
  
  return {
    files: Array.from(affected),
    scope: 'file',
  };
}
```

**How to Validate**:
- Test with file that has 0 dependents (returns just that file)
- Test with file that has 10 dependents (returns file + 10)
- Test with file that has 100 dependents (returns package scope)
- Test with core utility file (returns repo scope)
- Verify performance <500ms for all cases

---

### 5. Change Batching

**Why**: Rapid file saves must not trigger 10 validations

**How**:
```typescript
class ChangeBatcher {
  private queue: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly WINDOW_MS = 1000; // 1 second
  
  queueChange(filePath: string): void {
    this.queue.push(filePath);
    
    if (this.timer) {
      clearTimeout(this.timer);
    }
    
    this.timer = setTimeout(() => {
      this.flush();
    }, this.WINDOW_MS);
  }
  
  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    
    const changes = [...this.queue];
    this.queue = [];
    
    // Calculate affected for all changes
    const allAffected = new Set<string>();
    
    for (const change of changes) {
      const affected = await calculateAffected(change);
      affected.files.forEach(f => allAffected.add(f));
    }
    
    // Trigger validation
    await validateFiles(Array.from(allAffected));
  }
}
```

**Validation**:
- Trigger 5 changes within 500ms
- Verify only 1 validation runs
- Verify all 5 changes are included
- Trigger changes 2 seconds apart
- Verify 2 separate validations run

---

## Foundation Validation Checklist

Before building any features, verify:

### Graph Completeness
- [ ] Package nodes exist for all workspace packages
- [ ] CONTAINS_FILE relationships link all files to packages
- [ ] IMPORTS relationships exist for all imports
- [ ] Test files have TESTS relationships to source
- [ ] Config files tracked with CONFIGURED_BY relationships

### Query Performance
- [ ] Direct dependent query <50ms
- [ ] Transitive dependent query (depth 5) <200ms
- [ ] Package file query <100ms
- [ ] Indexes created and verified effective

### Service Capabilities
- [ ] TypeCheckService.checkFiles() implemented
- [ ] LintService.lintFiles() implemented
- [ ] TestService.runTests() implemented
- [ ] All return ValidationResult with errors
- [ ] All execute in <5 seconds for single file

### Core Algorithm
- [ ] calculateAffected() returns correct files
- [ ] Scope detection works (file/package/repo)
- [ ] Performance <500ms for typical cases
- [ ] Handles edge cases (no deps, many deps)

### Batching
- [ ] Changes within 1 second batched
- [ ] Multiple changes trigger single validation
- [ ] Changes outside window trigger separate validations

---

## Implementation Order

### Phase 0: Validation (3 days)

**Goal**: Understand current state

**Tasks**:
1. Run graph completeness queries
2. Document what's missing
3. Run performance benchmarks
4. Document query times
5. Identify bottlenecks

**Output**: Gap analysis document

### Phase 1: Graph Enhancement (3 days)

**Goal**: Make graph complete

**Tasks**:
1. Add CONTAINS_FILE relationship creation to analyzer
2. Add TESTS relationship creation for test files
3. Add ConfigFile node creation
4. Add CONFIGURED_BY relationships
5. Re-analyze test workspace
6. Verify relationships exist

**Output**: Complete graph with all relationships

### Phase 2: Performance (2 days)

**Goal**: Ensure queries are fast

**Tasks**:
1. Add indexes to Neo4j
2. Run benchmarks again
3. Profile slow queries
4. Optimize if needed
5. Document final performance

**Output**: Sub-500ms query performance

### Phase 3: Service API (3 days)

**Goal**: Enable file-scoped execution

**Tasks**:
1. Add checkFiles() to TypeCheckService
2. Add lintFiles() to LintService
3. Add runTests() to TestService
4. Write tests for each
5. Verify execution time <5 seconds

**Output**: Services accept file lists

### Phase 4: Core Algorithm (3 days)

**Goal**: Calculate affected files

**Tasks**:
1. Implement calculateAffected()
2. Add scope detection logic
3. Add threshold checks
4. Write comprehensive tests
5. Benchmark performance

**Output**: Working affected calculation

### Phase 5: Batching (2 days)

**Goal**: Prevent validation thrashing

**Tasks**:
1. Implement ChangeBatcher
2. Integrate with file watcher
3. Test batching behavior
4. Verify debounce works

**Output**: Batched change handling

**Total**: 2-3 weeks for solid foundation

---

## Testing Requirements

### Graph Completeness Tests

```typescript
describe('Graph Completeness', () => {
  it('should have Package nodes', async () => {
    const result = await neo4j.run('MATCH (p:Package) RETURN count(p)');
    expect(result[0].count).toBeGreaterThan(0);
  });
  
  it('should link files to packages', async () => {
    const result = await neo4j.run(`
      MATCH (p:Package)-[:CONTAINS_FILE]->(f:File)
      RETURN count(f) as count
    `);
    expect(result[0].count).toBeGreaterThan(0);
  });
  
  it('should have import relationships', async () => {
    const result = await neo4j.run(`
      MATCH ()-[:IMPORTS]->()
      RETURN count(*) as count
    `);
    expect(result[0].count).toBeGreaterThan(0);
  });
});
```

### Performance Tests

```typescript
describe('Query Performance', () => {
  it('should find direct dependents in <50ms', async () => {
    const start = Date.now();
    await neo4j.run(`
      MATCH (f:File {path: $path})<-[:IMPORTS]-(d:File)
      RETURN d.path
    `, { path: '/test/file.ts' });
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(50);
  });
  
  it('should find transitive dependents in <200ms', async () => {
    const start = Date.now();
    await neo4j.run(`
      MATCH path = (f:File {path: $path})<-[:IMPORTS*1..5]-(d:File)
      RETURN DISTINCT d.path
    `, { path: '/test/file.ts' });
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(200);
  });
});
```

### Service API Tests

```typescript
describe('TypeCheckService', () => {
  it('should check single file', async () => {
    const result = await service.checkFiles(['/test/error.ts']);
    
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.duration).toBeLessThan(5000);
  });
  
  it('should check multiple files', async () => {
    const result = await service.checkFiles([
      '/test/file1.ts',
      '/test/file2.ts',
    ]);
    
    expect(result).toBeDefined();
    expect(result.duration).toBeLessThan(10000);
  });
});
```

### Algorithm Tests

```typescript
describe('calculateAffected', () => {
  it('should return file with no dependents', async () => {
    const result = await calculateAffected('/test/isolated.ts');
    
    expect(result.files).toEqual(['/test/isolated.ts']);
    expect(result.scope).toBe('file');
  });
  
  it('should return file + direct dependents', async () => {
    const result = await calculateAffected('/test/utils.ts');
    
    expect(result.files).toContain('/test/utils.ts');
    expect(result.files).toContain('/test/component.ts');
    expect(result.scope).toBe('file');
  });
  
  it('should escalate to package scope', async () => {
    const result = await calculateAffected('/test/core.ts');
    
    expect(result.scope).toBe('package');
    expect(result.package).toBeDefined();
  });
  
  it('should complete in <500ms', async () => {
    const start = Date.now();
    await calculateAffected('/test/utils.ts');
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(500);
  });
});
```

### Batching Tests

```typescript
describe('ChangeBatcher', () => {
  it('should batch rapid changes', async () => {
    const batcher = new ChangeBatcher();
    const validateSpy = jest.fn();
    
    // Trigger 5 changes rapidly
    batcher.queueChange('/test/file1.ts');
    batcher.queueChange('/test/file2.ts');
    batcher.queueChange('/test/file3.ts');
    batcher.queueChange('/test/file4.ts');
    batcher.queueChange('/test/file5.ts');
    
    // Wait for batch window
    await sleep(1100);
    
    // Should have called validate once
    expect(validateSpy).toHaveBeenCalledTimes(1);
    expect(validateSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        '/test/file1.ts',
        '/test/file2.ts',
        '/test/file3.ts',
        '/test/file4.ts',
        '/test/file5.ts',
      ])
    );
  });
  
  it('should not batch separated changes', async () => {
    const batcher = new ChangeBatcher();
    const validateSpy = jest.fn();
    
    batcher.queueChange('/test/file1.ts');
    await sleep(1100);
    
    batcher.queueChange('/test/file2.ts');
    await sleep(1100);
    
    // Should have called validate twice
    expect(validateSpy).toHaveBeenCalledTimes(2);
  });
});
```

---

## Success Criteria

Foundation is complete when:

1. **Graph is Complete**
   - All packages in Neo4j
   - All files linked to packages
   - All imports tracked
   - All tests linked to source
   - All configs tracked

2. **Performance is Acceptable**
   - Direct dependent query: <50ms
   - Transitive query (depth 5): <200ms
   - Package file query: <100ms
   - Affected calculation: <500ms

3. **Services Support Files**
   - TypeCheck validates specific files
   - Lint validates specific files
   - Test runs specific tests
   - All execute in <5 seconds for single file

4. **Algorithm is Reliable**
   - Returns correct affected files
   - Handles 0 dependents
   - Handles 1000+ dependents
   - Escalates scope appropriately

5. **Batching Works**
   - Multiple rapid changes trigger 1 validation
   - Separated changes trigger separate validations
   - No validation thrashing

---

## What NOT to Build

Do not build until foundation is solid:

- ❌ Validation history in Neo4j
- ❌ SHA-256 file hashing
- ❌ ValidationRun nodes
- ❌ Cache invalidation logic
- ❌ UI components
- ❌ API endpoints
- ❌ SSE streaming
- ❌ Monitoring dashboards

These are features, not foundation. Build them only after foundation is proven.

---

## Risk Mitigation

### Risk: Graph queries too slow

**Detection**: Benchmark shows >500ms
**Mitigation**: Add indexes, limit depth, escalate to package scope
**Fallback**: Skip affected calculation, validate package

### Risk: Services don't support file lists

**Detection**: tsc/eslint/jest don't accept file arguments
**Mitigation**: Use project references or workspace filtering
**Fallback**: Validate at package level

### Risk: Too many affected files

**Detection**: calculateAffected returns 100+ files
**Mitigation**: Escalate to package or repo scope
**Fallback**: Full repository validation

### Risk: Graph becomes stale

**Detection**: File system changes not reflected in graph
**Mitigation**: Compare file mtimes to graph timestamps
**Fallback**: Full re-sync of codebase

---

## Validation Commands

Run these to verify foundation:

```bash
# 1. Check graph completeness
npm run devac -- query "MATCH (p:Package) RETURN count(p)"
npm run devac -- query "MATCH ()-[:CONTAINS_FILE]->() RETURN count(*)"
npm run devac -- query "MATCH ()-[:IMPORTS]->() RETURN count(*)"

# 2. Benchmark queries
npm run devac -- benchmark affected-query

# 3. Test service APIs
npm test -- service-api.spec.ts

# 4. Test core algorithm
npm test -- affected-analyzer.spec.ts

# 5. Test batching
npm test -- change-batcher.spec.ts

# 6. Full validation
npm run devac -- validate-foundation
```

---

## Next Steps After Foundation

Once foundation is solid (all checks pass):

1. Build ValidationCoordinator to orchestrate services
2. Add simple timestamp-based caching
3. Add minimal API endpoints
4. Test end-to-end workflow
5. Measure actual performance improvement
6. Iterate based on real usage

**Do not proceed to features until foundation is validated.**

---

## Summary

**Build**:
- Complete graph with all relationships
- Fast Cypher queries (<500ms)
- File-scoped service execution
- Core affected calculation algorithm
- Change batching

**Validate**:
- Graph completeness
- Query performance
- Service execution time
- Algorithm correctness
- Batching behavior

**Defer**:
- Validation history
- Complex caching
- UI components
- Monitoring
- Advanced features

**Timeline**: 2-3 weeks to build solid foundation

**Outcome**: Ready to build intelligent validation on top of proven base
