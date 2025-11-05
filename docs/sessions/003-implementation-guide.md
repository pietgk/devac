# CodeGraph C4 Enhancement Implementation Guide

## Overview
This document describes the enhancements made to CodeGraph to enable C4 diagram generation through package boundaries, import resolution, and React component detection.

## Created Files

### 1. Package Detection
**File:** `src/analyzer/parsers/package-extractor.ts`
- **Purpose:** Discovers packages in pnpm/npm workspaces
- **Key Methods:**
  - `discoverPackages()` - Finds all packages in workspace
  - `getPackageForFile(filePath)` - Maps files to their containing package
  - `createPackageNodes()` - Creates Package nodes for Neo4j
- **Supports:** pnpm-workspace.yaml, npm workspaces, standalone projects

### 2. Import Resolution
**File:** `src/analyzer/parsers/import-resolver.ts`
- **Purpose:** Resolves import statements to actual files
- **Key Methods:**
  - `resolve(importNode, fromFile)` - Resolves an import to its target
  - Handles workspace packages (@mindlercare/*)
  - Handles relative imports (./utils)
  - Handles TypeScript path aliases (@/components)
- **Returns:** Resolved file path and resolution type

### 3. React Component Analysis
**File:** `src/analyzer/parsers/component-analyzer.ts`
- **Purpose:** Identifies React components and hooks
- **Key Methods:**
  - `isReactComponent(func)` - Detects if function is a React component
  - `isReactHook(func)` - Detects if function is a React hook
  - `findRenderedComponents(func)` - Finds components rendered by a component
  - `findUsedHooks(func)` - Finds hooks used by a component

### 4. Pass 2 Resolvers

**File:** `src/analyzer/resolvers/import-relationship-resolver.ts`
- Creates `RESOLVES_TO` relationships from Import nodes to target files/functions
- Creates `DEPENDS_ON` relationships between packages
- Derives package dependencies from resolved imports

**File:** `src/analyzer/resolvers/component-relationship-resolver.ts`
- Creates `RENDERS_COMPONENT` relationships
- Creates `USES_HOOK` relationships
- Tracks component hierarchy

## Modified Files

### 1. Enhanced Function Parser
**File:** `src/analyzer/parsers/function-parser.ts`
- **Added:** Component analyzer integration
- **Added:** `properties.isReactComponent` flag
- **Added:** `properties.isHook` flag

### 2. Enhanced Import Parser
**File:** `src/analyzer/parsers/import-parser.ts`
- **Added:** `properties.importedNames` array for resolution
- Stores all imported names for easier resolution in Pass 2

## Integration Steps

### Step 1: Update Parser Constructor
In `src/analyzer/parser.ts`, modify the constructor to accept workspace root and initialize package detection:

```typescript
constructor(workspaceRoot?: string) {
  this.workspaceRoot = workspaceRoot ? path.resolve(workspaceRoot) : process.cwd();
  
  // ... existing initialization ...
  
  this.packageExtractor = null;
  this.importResolver = null;
  this.packages = [];
}

async initializePackages(): Promise<void> {
  this.packageExtractor = new PackageExtractor(this.workspaceRoot);
  this.packages = await this.packageExtractor.discoverPackages();
  
  const tsConfig = this.tsProject.getCompilerOptions();
  const paths = tsConfig.paths as Record<string, string[]> | undefined;
  this.importResolver = new ImportResolver(this.packages, this.workspaceRoot, paths);
}
```

### Step 2: Enhance collectResults()
In `src/analyzer/parser.ts`, add package nodes to the collected results:

```typescript
async collectResults(): Promise<{ allNodes: AstNode[]; allRelationships: RelationshipInfo[] }> {
  // ... existing collection logic ...
  
  // Add Package nodes
  if (this.packageExtractor) {
    const now = new Date().toISOString();
    const packageNodes = this.packageExtractor.createPackageNodes(now);
    
    for (const pkgNode of packageNodes) {
      nodeMap.set(pkgNode.entityId, pkgNode);
    }
    
    logger.info(`Added ${packageNodes.length} Package nodes`);
  }
  
  // ... rest of method ...
}
```

### Step 3: Tag Files with Package Names
In the TypeScript file parsing section of `parser.ts`, tag each File node with its package:

```typescript
private parseTypescriptFile(sourceFile: SourceFile, fileNode: FileNode, ...): void {
  // Add package information to file node
  if (this.packageExtractor) {
    const pkg = this.packageExtractor.getPackageForFile(fileNode.filePath);
    if (pkg) {
      fileNode.properties = {
        ...fileNode.properties,
        packageName: pkg.name
      };
    }
  }
  
  // ... rest of parsing ...
}
```

### Step 4: Add BELONGS_TO Relationships
In `collectResults()`, create relationships between files and packages:

```typescript
// Create BELONGS_TO relationships
const belongsToRels: RelationshipInfo[] = [];
for (const node of allNodes) {
  if (node.kind === 'File' && node.properties?.packageName) {
    const pkgNode = allNodes.find(
      n => n.kind === 'Package' && n.name === node.properties.packageName
    );
    
    if (pkgNode) {
      const relEntityId = generateEntityId('belongs_to', `${node.entityId}:${pkgNode.entityId}`);
      belongsToRels.push({
        id: `belongs_to_${node.id}_${pkgNode.id}`,
        entityId: relEntityId,
        type: 'BELONGS_TO',
        sourceId: node.entityId,
        targetId: pkgNode.entityId,
        createdAt: now
      });
    }
  }
}

relationshipMap.forEach(rel => allRelationships.push(rel));
belongsToRels.forEach(rel => allRelationships.push(rel));
```

### Step 5: Integrate Resolvers into RelationshipResolver
In `src/analyzer/relationship-resolver.ts`:

```typescript
import { resolveImportRelationships, derivePackageDependencies } from './resolvers/import-relationship-resolver.js';
import { resolveComponentRelationships } from './resolvers/component-relationship-resolver.js';

async resolveRelationships(project: Project, importResolver: ImportResolver | null): Promise<RelationshipInfo[]> {
  // ... existing setup ...
  
  for (const fileNode of fileNodes) {
    if (fileNode.language === 'TypeScript' || fileNode.language === 'JavaScript') {
      sourceFile = project.getSourceFile(fileNode.filePath);
      if (sourceFile) {
        // Existing resolvers
        resolveTsModules(sourceFile, fileNode, currentContext);
        resolveTsInheritance(sourceFile, fileNode, currentContext);
        resolveTsCrossFileInteractions(sourceFile, fileNode, currentContext);
        
        // NEW: Import resolution
        if (importResolver) {
          await resolveImportRelationships(sourceFile, fileNode, currentContext, importResolver);
        }
        
        // NEW: Component relationships
        resolveComponentRelationships(sourceFile, fileNode, currentContext);
      }
    }
  }
  
  // NEW: Derive package dependencies
  if (importResolver) {
    const pkgDeps = derivePackageDependencies(
      Array.from(this.nodeIndex.values()),
      this.relationships,
      packages,
      currentContext
    );
    this.relationships.push(...pkgDeps);
  }
  
  return this.relationships;
}
```

### Step 6: Update AnalyzerService
In `src/analyzer/analyzer-service.ts`:

```typescript
async analyze(directory: string): Promise<void> {
  // ... existing setup ...
  
  // NEW: Initialize packages
  await this.parser.initializePackages();
  
  // ... existing parsing ...
  
  // Pass import resolver to relationship resolver
  const resolver = new RelationshipResolver(pass1Nodes, pass1Relationships);
  const pass2Relationships = await resolver.resolveRelationships(
    tsProject,
    this.parser.getImportResolver()
  );
  
  // ... rest of method ...
}
```

## Neo4j Schema Updates

### New Node Types
- `Package` - Represents a workspace package

### New Properties on File Nodes
- `packageName` - Name of the containing package

### New Properties on Function Nodes
- `properties.isReactComponent` - Boolean flag
- `properties.isHook` - Boolean flag

### New Relationship Types
- `BELONGS_TO` - File → Package
- `RESOLVES_TO` - Import → File/Function/Type
- `DEPENDS_ON` - Package → Package (with weight property)
- `RENDERS_COMPONENT` - Component → Component
- `USES_HOOK` - Component → Hook

## C4 Diagram Queries

### System Context (Level 1)
```cypher
MATCH (internal:Package)
WHERE internal.name STARTS WITH '@mindlercare'
MATCH (external)-[:DEPENDS_ON]->(internal)
WHERE NOT external.name STARTS WITH '@mindlercare'
RETURN internal.name, collect(DISTINCT external.name) as externalDeps
```

### Container Diagram (Level 2)
```cypher
MATCH (p1:Package)-[d:DEPENDS_ON]->(p2:Package)
WHERE (p1.name STARTS WITH '@mindlercare' OR p1.properties.type = 'frontend')
  AND (p2.name STARTS WITH '@mindlercare' OR p2.properties.type = 'frontend')
RETURN p1.name, p1.properties.type, p2.name, p2.properties.type, d.weight
ORDER BY d.weight DESC
```

### Component Diagram (Level 3)
```cypher
MATCH (pkg:Package {name: $packageName})
MATCH (pkg)<-[:BELONGS_TO]-(f:File)
MATCH (f)<-[:BELONGS_TO]-(comp:Function)
WHERE comp.properties.isReactComponent = true
  AND comp.isExported = true
OPTIONAL MATCH (comp)-[:RENDERS_COMPONENT]->(child:Function)
RETURN comp.name, comp.filePath, collect(child.name) as renders
```

## Testing

### Unit Tests
Create `src/analyzer/parsers/__tests__/package-extractor.spec.ts`:
```typescript
describe('PackageExtractor', () => {
  it('discovers pnpm workspace packages', async () => {
    const extractor = new PackageExtractor('/path/to/frontend-monorepo');
    const packages = await extractor.discoverPackages();
    expect(packages.length).toBeGreaterThan(0);
    expect(packages).toContainEqual(
      expect.objectContaining({ name: '@mindlercare/ui-web' })
    );
  });
});
```

### Integration Test
Run against test project:
```bash
cd /Users/grop/ws/CodeGraph
npm run build
node dist/index.js analyze /Users/grop/ws/frontend-monorepo --reset-db
```

### Validation Queries
```cypher
// Check packages
MATCH (p:Package) RETURN p.name, p.properties.type, count{(p)<-[:BELONGS_TO]-()} as fileCount

// Check import resolution
MATCH (:Import)-[:RESOLVES_TO]->(target) RETURN labels(target), count(*) ORDER BY count(*) DESC

// Check components
MATCH (f:Function) WHERE f.properties.isReactComponent = true RETURN count(f)

// Check package dependencies
MATCH (p1:Package)-[d:DEPENDS_ON]->(p2:Package) RETURN p1.name, p2.name, d.weight ORDER BY d.weight DESC LIMIT 10
```

## Success Criteria

✅ Package nodes created for all workspace packages
✅ File nodes tagged with packageName
✅ BELONGS_TO relationships created
✅ Import resolution >90% successful
✅ React components identified
✅ DEPENDS_ON relationships show package dependencies
✅ Can generate C4 Container diagram from Neo4j
✅ Can generate C4 Component diagram for any package

## Next Steps

1. Complete Parser class integration
2. Test on small test project first
3. Run on frontend-monorepo
4. Validate with C4 queries
5. Add visualization tooling (optional)
