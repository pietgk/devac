// C4 Diagram Test Queries
// These queries should work once the enhanced CodeGraph has analyzed a codebase

// ============================================
// C4 Level 1: System Context (Not applicable - single system)
// ============================================

// ============================================
// C4 Level 2: Container Diagram
// Query: Show all packages (containers) and their dependencies
// ============================================

MATCH (p:Package)
OPTIONAL MATCH (p)-[d:DEPENDS_ON]->(target:Package)
RETURN
  p.name as Container,
  p.properties.type as Type,
  collect(DISTINCT target.name) as DependsOn,
  count(DISTINCT target) as DependencyCount
ORDER BY DependencyCount DESC;

// ============================================
// C4 Level 3: Component Diagram
// Query: Show components (files) within a package and their relationships
// ============================================

// Example: Show components in @mindlercare/ui-web package
MATCH (p:Package {name: '@mindlercare/ui-web'})<-[:BELONGS_TO]-(f:File)
OPTIONAL MATCH (f)-[r:IMPORTS]->(other:File)
WHERE other.properties.packageName = '@mindlercare/ui-web'
RETURN
  f.name as Component,
  f.filePath as Path,
  collect(DISTINCT other.name) as InternalDependencies,
  count(DISTINCT other) as DepCount
ORDER BY DepCount DESC
LIMIT 20;

// ============================================
// Cross-Package Component Dependencies
// Query: Show which components in one package depend on components in another
// ============================================

MATCH (sourceFile:File)-[:BELONGS_TO]->(sourcePkg:Package)
MATCH (sourceFile)-[:IMPORTS]->(imp:Import)
MATCH (imp)-[:RESOLVES_TO]->(targetFile:File)-[:BELONGS_TO]->(targetPkg:Package)
WHERE sourcePkg <> targetPkg
RETURN
  sourcePkg.name as SourcePackage,
  sourceFile.name as SourceComponent,
  targetPkg.name as TargetPackage,
  targetFile.name as TargetComponent,
  imp.properties.moduleSpecifier as ImportPath
LIMIT 50;

// ============================================
// React Component Architecture
// Query: Show React components and which components they render
// ============================================

MATCH (f:File)-[:CONTAINS]->(comp:Function)
WHERE comp.properties.isReactComponent = true
OPTIONAL MATCH (comp)-[:RENDERS_COMPONENT]->(rendered)
RETURN
  comp.name as Component,
  f.properties.packageName as Package,
  collect(DISTINCT rendered.name) as RendersComponents,
  count(DISTINCT rendered) as ComponentCount
ORDER BY ComponentCount DESC
LIMIT 20;

// ============================================
// Package Statistics for C4 Container Diagram
// ============================================

MATCH (p:Package)
OPTIONAL MATCH (p)<-[:BELONGS_TO]-(f:File)
OPTIONAL MATCH (f)-[:CONTAINS]->(func:Function)
WHERE func.properties.isReactComponent = true
RETURN
  p.name as Package,
  p.properties.type as Type,
  count(DISTINCT f) as FileCount,
  count(DISTINCT func) as ComponentCount
ORDER BY FileCount DESC;
