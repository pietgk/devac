# Quick Validation Reference

> Fast reference for validating CodeGraph database accuracy
> 
> For comprehensive demo guide, see: [DEMO_GUIDE.md](./DEMO_GUIDE.md)

## Quick Health Check

```bash
# Check workspace sync status
node dist/index.js workspace status

# View sync statistics
node dist/index.js workspace status --verbose
```

## Essential Validation Queries

### 1. Repository Coverage (30 seconds)

```cypher
// Count files per repository
MATCH (r:Repository)-[:CONTAINS]->(f:File)
RETURN r.name, count(f) as fileCount
ORDER BY fileCount DESC
```

**Expected**: All 8 repositories with non-zero file counts

---

### 2. Path Alias Resolution (1 minute)

```cypher
// Verify @shared, @dal, @core, @lib aliases resolve
MATCH (f:File)-[:CONTAINS]->(imp:Import)
WHERE f.filePath CONTAINS 'monorepo-3.0'
  AND (imp.source CONTAINS '@shared' 
    OR imp.source CONTAINS '@dal'
    OR imp.source CONTAINS '@core'
    OR imp.source CONTAINS '@lib')
OPTIONAL MATCH (imp)-[:RESOLVES_TO]->(target:File)
RETURN imp.source, count(*) as uses, 
       count(target) as resolved,
       round(100.0 * count(target) / count(*)) as resolutionRate
ORDER BY uses DESC
LIMIT 10
```

**Expected**: >90% resolution rate for all path aliases

---

### 3. Cross-Repository Dependencies (1 minute)

```cypher
// Find dependencies between repositories
MATCH (source:File)-[:CONTAINS]->(imp:Import)-[:RESOLVES_TO]->(target:File)
MATCH (sourceRepo:Repository)-[:CONTAINS]->(source)
MATCH (targetRepo:Repository)-[:CONTAINS]->(target)
WHERE sourceRepo.name <> targetRepo.name
RETURN sourceRepo.name as from, 
       targetRepo.name as to, 
       count(*) as dependencies
ORDER BY dependencies DESC
```

**Expected**: Dependencies between frontend→backend, app→npm-private-packages, etc.

---

### 4. Component Architecture (2 minutes)

```cypher
// React components with complexity metrics
MATCH (f:File)-[:CONTAINS]->(c:Class)
WHERE f.filePath =~ '.*\\.(tsx|jsx)$'
OPTIONAL MATCH (c)-[:HAS_METHOD]->(m:Method)
WITH c, f, count(m) as methodCount
RETURN f.filePath, c.name, methodCount,
       CASE 
         WHEN methodCount > 10 THEN 'Complex'
         WHEN methodCount > 5 THEN 'Moderate'
         ELSE 'Simple'
       END as complexity
ORDER BY methodCount DESC
LIMIT 20
```

**Expected**: React components with lifecycle methods and hooks counted

---

### 5. Import Statistics (30 seconds)

```cypher
// Import resolution statistics by repository
MATCH (r:Repository)-[:CONTAINS]->(f:File)-[:CONTAINS]->(imp:Import)
OPTIONAL MATCH (imp)-[:RESOLVES_TO]->(target:File)
RETURN r.name,
       count(imp) as totalImports,
       count(target) as resolvedImports,
       round(100.0 * count(target) / count(imp)) as resolutionRate
ORDER BY totalImports DESC
```

**Expected**: 
- monorepo-3.0: >70% resolution (many external deps)
- app: >60% resolution (React Native externals)
- frontend-monorepo: >75% resolution
- public-website-3: >75% resolution

---

## Quick Smoke Tests

### Test 1: Specific File Lookup (10 seconds)

```cypher
// Find a known file and its imports
MATCH (f:File)
WHERE f.filePath CONTAINS 'mindlerapi/src/app.ts'
OPTIONAL MATCH (f)-[:CONTAINS]->(imp:Import)
RETURN f.filePath, collect(imp.source)[0..10] as sampleImports
```

**Expected**: File found with imports to express, @core/*, @shared/*

---

### Test 2: TypeScript Class Detection (10 seconds)

```cypher
// Count TypeScript classes
MATCH (f:File)-[:CONTAINS]->(c:Class)
WHERE f.filePath =~ '.*\\.tsx?$'
RETURN count(c) as totalClasses
```

**Expected**: >100 classes across all repos

---

### Test 3: Function Export Detection (10 seconds)

```cypher
// Find exported functions
MATCH (f:File)-[:CONTAINS]->(func:Function)
WHERE func.exported = true
RETURN count(func) as exportedFunctions
```

**Expected**: >500 exported functions

---

## Validation Checklist

Use this checklist after workspace sync completes:

- [ ] **Repository Coverage**: All 8 repos show file counts
- [ ] **Path Alias Resolution**: >90% resolution rate for @shared, @dal, @core, @lib
- [ ] **Cross-Repo Dependencies**: Dependencies visible between repos
- [ ] **Component Detection**: React components with methods detected
- [ ] **Import Statistics**: Resolution rates match expected ranges
- [ ] **Smoke Test 1**: Known file found with imports
- [ ] **Smoke Test 2**: TypeScript classes >100
- [ ] **Smoke Test 3**: Exported functions >500

## Performance Expectations

Based on workspace configuration (8 repositories):

| Repository | Expected Files | Expected Duration |
|------------|----------------|-------------------|
| CodeGraph | ~50 | 1-2 min |
| app | ~800 | 15-20 min |
| contentful-monorepo | ~30 | 1 min |
| frontend-monorepo | ~500 | 10-15 min |
| mindler | ~300 | 5-10 min |
| monorepo-3.0 | ~1000 | 30-45 min |
| npm-private-packages | ~200 | 5-10 min |
| public-website-3 | ~300 | 5-10 min |

**Total Expected**: ~3,180 files, 90-120 minutes

## Common Issues

### Low Resolution Rate (<50%)

**Possible Causes**:
- Missing tsconfig.json in package
- Incorrect path mappings in tsconfig.json
- External dependencies not installed

**Fix**: Check configurator logs for path alias detection

### Missing Files

**Possible Causes**:
- Files in .gitignore patterns
- Files in default ignore patterns (node_modules, dist, build)
- File extensions not in defaults.extensions list

**Fix**: Check workspace.json defaults.ignorePatterns

### Sync Hangs

**Possible Causes**:
- Large .d.ts files (>10MB)
- Deeply nested AST parsing
- Memory pressure

**Fix**: Check logs for timeout messages, verify .d.ts filtering active

## Advanced Validation

For deep validation, see [DEMO_GUIDE.md](./DEMO_GUIDE.md) sections:
- Architecture Layer Analysis
- Circular Dependency Detection  
- Dead Code Detection
- API Surface Mapping

## Neo4j Browser Access

```bash
# Access Neo4j Browser
open http://localhost:7474

# Connect with:
# URL: bolt://localhost:7687
# Username: neo4j
# Password: (from .env NEO4J_PASSWORD)
```

## Useful Commands

```bash
# Full workspace sync with clean
node dist/index.js workspace sync --clean

# Check sync status
node dist/index.js workspace status

# Analyze single repo for testing
node dist/index.js analyze /Users/grop/ws/CodeGraph --clean

# View logs
tail -f logs/codegraph.log
```

---

**Last Updated**: 2025-11-05  
**Sync Duration**: ~2-3 hours for full workspace (8 repos)  
**Database**: Neo4j 5.x on bolt://localhost:7687
