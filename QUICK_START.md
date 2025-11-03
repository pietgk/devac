# CodeGraph C4 Diagrams - Quick Start Guide

## What's New

CodeGraph now supports C4 architecture diagrams by analyzing:
- **Package boundaries** (workspaces in monorepos)
- **Import relationships** (which files/packages depend on what)
- **React components** (component hierarchy and hooks usage)

## Quick Commands

### 1. Build
```bash
cd /Users/grop/ws/CodeGraph
npm run build
```

### 2. Analyze a Codebase
```bash
# Full workspace analysis
node dist/index.js analyze /Users/grop/ws/frontend-monorepo \
  --neo4j-url bolt://localhost:7687 \
  --neo4j-user neo4j \
  --neo4j-password test1234 \
  --reset-db \
  --update-schema

# Single package analysis
node dist/index.js analyze /path/to/package \
  --neo4j-url bolt://localhost:7687 \
  --neo4j-user neo4j \
  --neo4j-password test1234
```

### 3. Query for C4 Diagrams

#### Container Diagram (Packages and Dependencies)
```cypher
MATCH (p:Package)
OPTIONAL MATCH (p)-[d:DEPENDS_ON]->(target:Package)
RETURN 
  p.name as Package,
  p.properties.type as Type,
  collect(DISTINCT target.name) as Dependencies
ORDER BY size(Dependencies) DESC;
```

#### Component Diagram (Files within a Package)
```cypher
MATCH (p:Package {name: '@mindlercare/ui-web'})<-[:BELONGS_TO]-(f:File)
OPTIONAL MATCH (f)-[:IMPORTS]->(imp:Import)-[:RESOLVES_TO]->(target:File)
WHERE target.properties.packageName = '@mindlercare/ui-web'
RETURN 
  f.name as Component,
  collect(DISTINCT target.name) as InternalDependencies
ORDER BY size(InternalDependencies) DESC
LIMIT 20;
```

#### React Component Architecture
```cypher
MATCH (f:File)-[:CONTAINS]->(comp:Function)
WHERE comp.properties.isReactComponent = true
OPTIONAL MATCH (comp)-[:RENDERS_COMPONENT]->(rendered)
RETURN 
  comp.name as Component,
  f.properties.packageName as Package,
  collect(DISTINCT rendered.name) as RendersComponents
ORDER BY size(RendersComponents) DESC
LIMIT 20;
```

#### Cross-Package Dependencies
```cypher
MATCH (sourceFile:File)-[:BELONGS_TO]->(sourcePkg:Package)
MATCH (sourceFile)-[:IMPORTS]->(imp:Import)
MATCH (imp)-[:RESOLVES_TO]->(targetFile:File)-[:BELONGS_TO]->(targetPkg:Package)
WHERE sourcePkg <> targetPkg
RETURN 
  sourcePkg.name as From,
  targetPkg.name as To,
  count(*) as ImportCount
ORDER BY ImportCount DESC
LIMIT 20;
```

## Graph Schema

### Nodes
- **Package**: Workspace packages (frontends, shared-libraries, tools)
- **File**: Source files with `packageName` property
- **Function**: Functions/components with `isReactComponent` and `isHook` flags
- **Import**: Import statements with `importedNames` array

### Relationships
- **BELONGS_TO**: File → Package
- **RESOLVES_TO**: Import → File
- **DEPENDS_ON**: Package → Package
- **RENDERS_COMPONENT**: Function → Function
- **USES_HOOK**: Function → Function

## Validation Test

```bash
# Test package extraction
node test-package-extraction.js

# Expected output:
# Found 11 packages:
#   - mindlercare (frontend)
#   - @mindlercare/ui-web (shared-library)
#   - etc.
```

## Files Reference

- **Implementation**: See `IMPLEMENTATION_COMPLETE.md`
- **Queries**: See `test-c4-queries.cypher`
- **Core Code**: `src/analyzer/parsers/package-extractor.ts`

## Troubleshooting

### Issue: "Node already exists" error
**Solution**: Use `--reset-db` flag to clear existing data

### Issue: Package not detected
**Check**: Ensure `pnpm-workspace.yaml` or `package.json` has workspaces field

### Issue: Import not resolved
**Check**: Verify tsconfig.json has paths configured for aliases

## Next Steps

1. Run full analysis on your target codebase
2. Open Neo4j Browser: http://localhost:7474
3. Run C4 queries from `test-c4-queries.cypher`
4. Visualize package dependencies and component hierarchies

---

For detailed implementation details, see `IMPLEMENTATION_COMPLETE.md`
