# CodeGraph Workspace Demo Guide

## What is CodeGraph?

CodeGraph is a code analysis tool that creates a **knowledge graph** of your entire codebase in Neo4j. It analyzes code structure, dependencies, and relationships across multiple repositories, enabling powerful queries about your architecture.

**Key Features:**
- Multi-repository workspace analysis
- Cross-repository dependency tracking
- Path alias resolution (monorepo support)
- Import/export relationship mapping
- Architecture validation queries
- Dead code detection
- Circular dependency detection

## Quick Start

### Prerequisites
- Neo4j Desktop running (database: `neo4j`)
- Node.js installed
- CodeGraph built (`npm run build`)

### Run Complete Workspace Sync

```bash
cd /Users/grop/ws/CodeGraph
node dist/index.js workspace sync --clean
```

**What this does:**
1. Cleans Neo4j database (batch deletion)
2. Applies fresh schema (constraints + indexes)
3. Syncs all configured repositories:
   - CodeGraph (library)
   - app (React Native mobile app)
   - contentful-monorepo (CMS configuration)
   - frontend-monorepo (web frontends)
   - mindler (legacy monorepo)
   - monorepo-3.0 (backend services - 35 packages)
   - npm-private-packages (shared libraries)
   - public-website-3 (marketing website)

**Duration:** 2-3 hours for complete workspace

### Configuration

Workspace configuration is stored in `.codegraph/workspace.json`:
```json
{
  "workspaceRoot": "/Users/grop/ws",
  "repositories": [
    { "name": "monorepo-3.0", "path": "monorepo-3.0", "enabled": true },
    ...
  ]
}
```

## Validation Queries

Open Neo4j Browser: `http://localhost:7474`

### 1. Overall Statistics

```cypher
// Total nodes by type
MATCH (n) 
RETURN labels(n)[0] as nodeType, count(*) as count 
ORDER BY count DESC
LIMIT 20
```

**Expected Results:**
- File nodes: ~10,000-15,000
- Function nodes: ~50,000+
- Import nodes: ~30,000+
- Various language-specific nodes (C++, Java, Python, etc.)

```cypher
// Total files and packages
MATCH (f:File) 
RETURN count(DISTINCT f.filePath) as totalFiles,
       count(DISTINCT f.packageName) as totalPackages
```

**Expected:**
- Total Files: ~10,000-15,000
- Total Packages: ~100-150

```cypher
// Relationship types
MATCH ()-[r]->() 
RETURN type(r) as relType, count(*) as count 
ORDER BY count DESC
LIMIT 20
```

**Expected top relationships:**
- IMPORTS: ~100,000+
- CONTAINS: ~80,000+
- HAS_PARAMETER: ~50,000+
- RESOLVES_TO: ~40,000+

### 2. Repository Coverage

```cypher
// Files by repository
MATCH (f:File)
WITH split(f.filePath, '/')[4] as repo
RETURN repo, count(*) as fileCount
ORDER BY fileCount DESC
```

**Expected:**
- app: ~6,000-8,000 files (includes native libraries)
- monorepo-3.0: ~1,700 files
- frontend-monorepo: ~2,000-3,000 files
- public-website-3: ~500-1,000 files
- npm-private-packages: ~200-500 files

### 3. Code Quality Validation (monorepo-3.0)

```cypher
// Path alias resolution (@shared, @dal, @core, @lib)
MATCH (f:File)-[:CONTAINS]->(imp:Import)
WHERE f.filePath CONTAINS 'monorepo-3.0'
  AND (imp.source CONTAINS '@shared' 
    OR imp.source CONTAINS '@dal'
    OR imp.source CONTAINS '@core'
    OR imp.source CONTAINS '@lib')
OPTIONAL MATCH (imp)-[:RESOLVES_TO]->(target:File)
RETURN f.filePath, imp.source, target.filePath
LIMIT 20
```

**What to look for:**
- ✅ imp.source shows the alias (e.g., `@shared/utils`)
- ✅ target.filePath shows actual resolved file path
- ❌ If target.filePath is null, path resolution failed

```cypher
// Cross-package dependencies within monorepo-3.0
MATCH (f1:File)-[:IMPORTS]->(imp:Import)-[:RESOLVES_TO]->(f2:File)
WHERE f1.filePath CONTAINS 'monorepo-3.0'
  AND f2.filePath CONTAINS 'monorepo-3.0'
  AND f1.packageName <> f2.packageName
  AND f1.packageName IS NOT NULL
  AND f2.packageName IS NOT NULL
RETURN f1.packageName as from, 
       f2.packageName as to, 
       count(*) as dependencies
ORDER BY dependencies DESC
LIMIT 20
```

**Insights:**
- Shows which services depend on which
- Identifies highly-coupled services
- Can reveal architectural boundaries

### 4. Cross-Repository Dependencies

```cypher
// Dependencies between different repositories
MATCH (f1:File)-[:IMPORTS]->(imp:Import)-[:RESOLVES_TO]->(f2:File)
WITH split(f1.filePath, '/')[4] as repo1,
     split(f2.filePath, '/')[4] as repo2
WHERE repo1 <> repo2
RETURN repo1, repo2, count(*) as crossRepoDeps
ORDER BY crossRepoDeps DESC
LIMIT 20
```

**Expected:**
- app → npm-private-packages (shared UI components, utilities)
- frontend-monorepo → npm-private-packages (shared libraries)
- monorepo-3.0 → npm-private-packages (shared schemas, clients)

```cypher
// Most imported files across entire workspace
MATCH (f:File)<-[:RESOLVES_TO]-(imp:Import)<-[:CONTAINS]-(source:File)
RETURN f.filePath, count(DISTINCT source) as importedBy
ORDER BY importedBy DESC
LIMIT 10
```

**Insights:**
- Reveals "central" modules used everywhere
- Candidates for extra care during refactoring
- Potential performance bottlenecks

```cypher
// Shared package usage (npm-private-packages)
MATCH (f:File)<-[:RESOLVES_TO]-(imp:Import)<-[:CONTAINS]-(source:File)
WHERE f.filePath CONTAINS 'npm-private-packages'
WITH split(split(f.filePath, 'npm-private-packages/')[1], '/')[1] as packageName, 
     source
RETURN packageName, count(DISTINCT source) as usedByFiles
ORDER BY usedByFiles DESC
LIMIT 20
```

**Shows:**
- Which shared packages are most heavily used
- Helps prioritize testing and documentation
- Identifies critical dependencies

### 5. Architecture Insights

```cypher
// Service boundaries (monorepo-3.0)
MATCH (f:File)
WHERE f.filePath CONTAINS 'monorepo-3.0/services/'
WITH split(split(f.filePath, 'services/')[1], '/')[0] as service
RETURN service, count(*) as files
ORDER BY files DESC
```

**Shows:**
- Size of each microservice
- Can identify services that might need splitting
- Helps understand service complexity

```cypher
// Frontend app structure
MATCH (f:File)
WHERE f.filePath CONTAINS 'frontend-monorepo/frontends/'
WITH split(split(f.filePath, 'frontends/')[1], '/')[0] as frontend
RETURN frontend, count(*) as files
ORDER BY files DESC
```

```cypher
// React Native app structure
MATCH (f:File)
WHERE f.filePath CONTAINS '/app/src/'
WITH split(split(f.filePath, '/app/src/')[1], '/')[0] as module
RETURN module, count(*) as files
ORDER BY files DESC
LIMIT 20
```

### 6. Code Quality Analysis

```cypher
// Dead code candidates (files with no imports)
MATCH (f:File)
WHERE NOT exists((f)<-[:RESOLVES_TO]-())
  AND f.filePath CONTAINS '/src/'
  AND NOT f.filePath CONTAINS 'test'
  AND NOT f.filePath CONTAINS 'stories'
RETURN f.filePath
LIMIT 20
```

**Insights:**
- Files that nothing imports
- Potential candidates for removal
- Validate before deleting (may be entry points)

```cypher
// Circular dependencies (package level)
MATCH path = (p1:Package)-[:DEPENDS_ON*2..5]->(p1)
RETURN [n in nodes(path) | n.name] as circularPath,
       length(path) as pathLength
ORDER BY pathLength
LIMIT 10
```

**Shows:**
- Circular dependencies between packages
- Architectural issues to address
- Can prevent clean separation

```cypher
// Files with most imports (complexity indicator)
MATCH (f:File)-[:CONTAINS]->(imp:Import)
RETURN f.filePath, count(imp) as importCount
ORDER BY importCount DESC
LIMIT 20
```

**Insights:**
- Files doing too much (high coupling)
- Candidates for refactoring
- Understand module complexity

## Use Cases

### 1. Impact Analysis
**Question:** "What breaks if I change this file?"

```cypher
MATCH (target:File {filePath: '/Users/grop/ws/npm-private-packages/packages/schema/src/index.ts'})
MATCH (source:File)-[:IMPORTS]->()-[:RESOLVES_TO]->(target)
RETURN source.filePath, 
       split(source.filePath, '/')[4] as repository
ORDER BY repository
```

### 2. Dependency Audit
**Question:** "Which repositories depend on package X?"

```cypher
MATCH (f:File)<-[:RESOLVES_TO]-()-[:CONTAINS]-(source:File)
WHERE f.filePath CONTAINS 'npm-private-packages/packages/auth-ui'
WITH split(source.filePath, '/')[4] as repo
RETURN DISTINCT repo, count(*) as usageCount
ORDER BY usageCount DESC
```

### 3. Architecture Validation
**Question:** "Do frontend apps import backend code?"

```cypher
MATCH (f1:File)-[:IMPORTS]->()-[:RESOLVES_TO]->(f2:File)
WHERE f1.filePath CONTAINS 'frontend-monorepo'
  AND f2.filePath CONTAINS 'monorepo-3.0/services'
RETURN f1.filePath, f2.filePath
LIMIT 10
```

**Expected:** No results (architectural boundary enforced)

### 4. Migration Planning
**Question:** "What uses React Redux directly (should use custom hooks)?"

```cypher
MATCH (f:File)-[:CONTAINS]->(imp:Import)
WHERE imp.source = 'react-redux'
RETURN f.filePath
```

### 5. Shared Code Analysis
**Question:** "Which @mindlercare packages are most critical?"

```cypher
MATCH (f:File)<-[:RESOLVES_TO]-()-[:CONTAINS]-(source:File)
WHERE f.filePath CONTAINS 'npm-private-packages'
WITH f.filePath, count(DISTINCT source) as importCount
WHERE importCount > 50
RETURN f.filePath, importCount
ORDER BY importCount DESC
```

## Expected Demo Flow (15 minutes)

### Introduction (2 min)
- What is CodeGraph
- Why knowledge graphs for code
- What repositories we're analyzing

### Live Demo (10 min)
1. Show workspace.json configuration (1 min)
2. Run workspace sync command (show it starting) (1 min)
3. Open Neo4j Browser (1 min)
4. Run statistics queries (2 min)
   - Show total counts
   - Show files by repository
5. Show path alias resolution (2 min)
   - Run monorepo-3.0 path alias query
   - Explain accuracy vs old approach
6. Show cross-repo dependencies (2 min)
   - Show npm-private-packages usage
   - Identify most imported files
7. Show one use case (1 min)
   - Impact analysis OR dead code detection

### Q&A (3 min)
- Answer team questions
- Show additional queries based on interest

## Technical Details

### Performance
- Full workspace sync: 2-3 hours
- Single repo (monorepo-3.0): ~30 minutes
- Memory usage: ~500-800MB peak
- No hanging issues (timeout protection)

### Accuracy Features
- **Per-package tsconfig**: Uses correct TypeScript configuration for each service
- **Path alias resolution**: `@shared/*`, `@dal/*`, `@core/*` resolve to actual files
- **Cross-file type information**: Full type checking context
- **Multi-language support**: TypeScript, JavaScript, Python, Java, C++, C#, Go

### Architecture
- **Streaming writes**: Data written to Neo4j in batches (no memory accumulation)
- **Batch processing**: 50 files per batch with individual timeout protection
- **Adaptive sizing**: Batch size adjusts based on repository size
- **Clean slate**: `--clean` flag ensures fresh start with batch deletion

## Next Steps

After the demo, your team can:

1. **Explore architecture** - Run custom queries about your codebase
2. **Validate boundaries** - Check if architectural rules are followed
3. **Plan refactoring** - Identify circular dependencies and high coupling
4. **Track dependencies** - Know what breaks when you change something
5. **Find dead code** - Identify unused files and functions

## Resources

- **Quick Validation Guide**: `docs/QUICK_VALIDATION.md`
- **Session Documentation**: `docs/sessions/021-full-workspace-demo.md`
- **CLI Help**: `node dist/index.js --help`
- **Workspace Config**: `.codegraph/workspace.json`

---

**Last Updated:** November 5, 2025  
**Test Workspace:** 8 repositories, ~10,000-15,000 files  
**Status:** Production-ready with per-package tsconfig accuracy
