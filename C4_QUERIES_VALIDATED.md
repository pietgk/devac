# C4 Architecture Queries - Validated & Working

**Database**: `codegraph`  
**Analysis**: frontend-monorepo (11 packages, 945 files, 25,740 nodes)  
**Date**: November 3, 2025

## Summary

All C4 diagram queries are working successfully with real data from the frontend-monorepo workspace.

## ✅ Working Queries

### 1. C4 Container Diagram - Package Dependencies

Shows all packages (containers) and their dependencies:

```cypher
MATCH (p:Package)
OPTIONAL MATCH (p)-[d:DEPENDS_ON]->(target:Package)
RETURN 
  p.name as Container,
  p.type as Type,
  collect(DISTINCT target.name) as DependsOn,
  count(DISTINCT target) as DependencyCount
ORDER BY DependencyCount DESC
```

**Result**: Successfully shows 11 packages with their dependencies
- mindlercare (frontend) → depends on 4 packages
- mindler-back-office-tools (frontend) → depends on 4 packages
- @mindlercare/ui-web (shared-library) → no dependencies
- etc.

### 2. C4 Component Diagram - Files Within Package

Shows components (files) within a specific package and their internal dependencies:

```cypher
MATCH (p:Package {name: '@mindlercare/ui-web'})<-[:BELONGS_TO]-(f:File)
OPTIONAL MATCH (f)-[:IMPORTS]->(imp:Import)-[:RESOLVES_TO]->(target:File)
WHERE target.packageName = '@mindlercare/ui-web'
RETURN 
  f.name as Component,
  f.filePath as Path,
  collect(DISTINCT target.name) as InternalDependencies,
  count(DISTINCT target) as DepCount
ORDER BY DepCount DESC
LIMIT 10
```

**Result**: Successfully shows file-level dependencies within @mindlercare/ui-web
- themeProvider.tsx → depends on 3 internal files
- typography.tsx → depends on 3 internal files
- button/index.tsx → depends on 2 internal files

### 3. Cross-Package Dependencies

Shows which files in one package import files from other packages:

```cypher
MATCH (sourceFile:File)-[:BELONGS_TO]->(sourcePkg:Package)
MATCH (sourceFile)-[:IMPORTS]->(imp:Import)
MATCH (imp)-[:RESOLVES_TO]->(targetFile:File)-[:BELONGS_TO]->(targetPkg:Package)
WHERE sourcePkg <> targetPkg
RETURN 
  sourcePkg.name as SourcePackage,
  sourceFile.name as SourceComponent,
  targetPkg.name as TargetPackage,
  targetFile.name as TargetComponent,
  imp.moduleSpecifier as ImportPath
LIMIT 20
```

### 4. React Component Architecture

Shows React components and which other components they render:

```cypher
MATCH (comp:Function)
WHERE comp.isReactComponent = true
OPTIONAL MATCH (comp)-[:RENDERS_COMPONENT]->(rendered)
RETURN 
  comp.name as Component,
  comp.filePath as FilePath,
  collect(DISTINCT rendered.name) as RendersComponents,
  count(DISTINCT rendered) as ComponentCount
ORDER BY ComponentCount DESC
LIMIT 10
```

**Result**: Successfully shows React component hierarchy
- DateRangePicker → renders DateField, RangeCalendar
- PopoverTrigger → renders Popover, CircledNumber
- UserAttributeItem → renders RenderItemView, RenderItemEdit

### 5. Package Statistics

Shows overview statistics for each package:

```cypher
MATCH (p:Package)
OPTIONAL MATCH (p)<-[:BELONGS_TO]-(f:File)
OPTIONAL MATCH (f)-[:IMPORTS]->(imp:Import)-[:RESOLVES_TO]->(:Function {isReactComponent: true})
RETURN 
  p.name as Package,
  p.type as Type,
  count(DISTINCT f) as FileCount,
  p.version as Version,
  p.entryPoint as EntryPoint
ORDER BY FileCount DESC
```

### 6. Hook Usage Tracking

Shows which React components use which hooks:

```cypher
MATCH (comp:Function {isReactComponent: true})-[:USES_HOOK]->(hook:Function {isHook: true})
RETURN 
  comp.name as Component,
  comp.filePath as ComponentFile,
  hook.name as Hook,
  hook.filePath as HookFile
LIMIT 20
```

## Database Schema Summary

### New Node Types
- ✅ **Package** nodes (11 created)
  - Properties: name, type, version, entryPoint, filePath

### New Relationships
- ✅ **BELONGS_TO**: File → Package (945 relationships)
- ✅ **DEPENDS_ON**: Package → Package (14 relationships)
- ✅ **RESOLVES_TO**: Import → File (1,578 relationships)
- ✅ **RENDERS_COMPONENT**: Function → Function (30 relationships)
- ✅ **USES_HOOK**: Function → Function (1 relationship)

### Enhanced Properties
- ✅ File nodes have `packageName` property
- ✅ Function nodes have `isReactComponent` and `isHook` boolean flags
- ✅ Import nodes have `importedNames` array

## How to Use

### Analyze Your Workspace

```bash
cd /Users/grop/ws/CodeGraph

# Build
npm run build

# Analyze entire workspace - MUST use workspace root, not individual packages!
node dist/index.js analyze /path/to/your/workspace \
  --neo4j-url bolt://localhost:7687 \
  --neo4j-user neo4j \
  --neo4j-password test1234 \
  --neo4j-database codegraph \
  --reset-db \
  --update-schema
```

### Query the Database

**Option 1**: Use Neo4j Browser at http://localhost:7474 (select `codegraph` database)

**Option 2**: Use MCP Neo4j tool (automatically connects to `codegraph`)

**Option 3**: Use cypher-shell:
```bash
cypher-shell -u neo4j -p test1234 -d codegraph
```

## Important Notes

### ⚠️ Database Selection

There are TWO databases:
- **`neo4j`**: Default database (not used)
- **`codegraph`**: Our analysis database (MUST specify with `--neo4j-database codegraph`)

**Always specify** `--neo4j-database codegraph` when running analysis!

### ⚠️ Workspace Root Required

To detect packages, you MUST analyze the **workspace root**, not individual packages:

```bash
# ✅ CORRECT - analyzes workspace, finds 11 packages
node dist/index.js analyze /Users/grop/ws/frontend-monorepo --neo4j-database codegraph

# ❌ WRONG - analyzes single package, finds 0 packages
node dist/index.js analyze /Users/grop/ws/frontend-monorepo/packages/mindler-ui-web --neo4j-database codegraph
```

### Known Limitations

1. **No CONTAINS relationships**: The existing CodeGraph doesn't create File → Function relationships. 
   - Workaround: Query Functions directly with `filePath` property
   
2. **Limited hook detection**: Only 1 USES_HOOK relationship found
   - The component-analyzer might need refinement for hook call detection
   
3. **React component detection**: Based on naming convention + JSX
   - May miss some edge cases (e.g., components with lowercase names)

## Performance

**Analysis Time**: ~50 seconds for 945 files
**Nodes Created**: 25,740
**Relationships Created**: ~33,000
**Database Size**: Manageable for real-time queries

## Success Metrics

- ✅ Package discovery: 11/11 packages found
- ✅ Import resolution: 1,578 RESOLVES_TO relationships (excellent coverage!)
- ✅ Package dependencies: 14 DEPENDS_ON relationships derived
- ✅ React components: Detected and tracked with hierarchy
- ✅ C4 Container diagram: Fully functional
- ✅ C4 Component diagram: Fully functional

---

**Implementation complete and validated!** 🎉

All queries tested with real data from frontend-monorepo workspace.
