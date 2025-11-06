# Session 023: Quick Reference Guide

> For rapid navigation of C4 enhancement implementation

## Key Files and Their Status

### ✅ Fully Implemented and Integrated

| File | Purpose | Status | Lines |
|------|---------|--------|-------|
| `src/analyzer/parser-utils.ts` | Entity ID system with overload support | ✅ Production | 1-400 |
| `src/analyzer/parsers/package-extractor.ts` | Package discovery and classification | ✅ Production | 1-400 |
| `src/analyzer/parsers/import-resolver.ts` | Import resolution (workspace, relative, aliases) | ✅ Production | 1-500 |
| `src/analyzer/parsers/component-analyzer.ts` | React component/hook detection | ✅ Production | 1-250 |
| `src/analyzer/resolvers/import-relationship-resolver.ts` | RESOLVES_TO and DEPENDS_ON creation | ✅ Production | Full file |
| `src/analyzer/resolvers/component-relationship-resolver.ts` | RENDERS_COMPONENT and USES_HOOK creation | ✅ Production | Full file |
| `src/analyzer/parser.ts` | Package nodes creation | ✅ Line 443 | |
| `src/analyzer/parser.ts` | packageName property on File nodes | ✅ Lines 575, 827, 937 | |
| `src/analyzer/parser.ts` | BELONGS_TO relationship creation | ✅ Lines 453-486 | |
| `src/analyzer/relationship-resolver.ts` | Import resolution calls | ✅ Lines 98-103 | |
| `src/analyzer/relationship-resolver.ts` | Package dependency derivation | ✅ Lines 136-143 | |
| `src/analyzer/relationship-resolver.ts` | Component relationship calls | ✅ Line 107 | |

### ⚠️ Implemented But Not Integrated

| File | Purpose | What's Missing | Effort |
|------|---------|----------------|--------|
| `src/analyzer/parsers/function-parser.ts` | Function node creation | Add `isReactComponent` and `isHook` flags | 1 hour |

### ❌ Not Yet Implemented

| File | Purpose | What's Needed | Effort |
|------|---------|---------------|--------|
| `src/analyzer/parsers/interface-parser.ts` | Interface parsing | Add `extends` tracking | 30 min |
| `src/analyzer/parsers/function-parser.ts` | Function parsing | Add `returnType` tracking | 30 min |
| `src/analyzer/resolvers/type-relationship-resolver.ts` | Type relationships | Create new resolver | 1 hour |
| `src/analyzer/__tests__/c4-validation.spec.ts` | Validation tests | Create test suite | 2 hours |

## Quick Implementation Guide

### Task 1: ComponentAnalyzer Integration (1 hour)

**File**: `src/analyzer/parsers/function-parser.ts`

**Find this section** (around where function nodes are created):
```typescript
const functionNode: AstNode = {
  id: /* ... */,
  entityId: /* ... */,
  kind: "Function",
  name: /* ... */,
  // ... other fields
};
```

**Add before node creation**:
```typescript
import { ComponentAnalyzer } from './component-analyzer.js';

// At module level
const componentAnalyzer = new ComponentAnalyzer();

// In function body, before creating node
const isReactComponent = componentAnalyzer.isReactComponent(func);
const isHook = componentAnalyzer.isReactHook(func);

const functionNode: AstNode = {
  // ... existing fields ...
  isReactComponent,  // ADD THIS
  isHook,            // ADD THIS
  // ... rest of fields ...
};
```

**That's it!** The component relationship resolver already exists and will use these flags.

### Task 2: Type Relationships (2 hours)

**Step 1**: Add tracking in `interface-parser.ts`:
```typescript
const extendsClause = iface.getExtends();
const extendsTypes = extendsClause.map(e => e.getText());

interfaceNode.properties = {
  ...interfaceNode.properties,
  extends: extendsTypes  // ADD THIS
};
```

**Step 2**: Add tracking in `function-parser.ts`:
```typescript
const returnTypeNode = func.getReturnTypeNode();
const returnType = returnTypeNode?.getText() || "void";

functionNode.returnType = returnType;  // ADD THIS
```

**Step 3**: Create `src/analyzer/resolvers/type-relationship-resolver.ts`:
```typescript
import { SourceFile } from "ts-morph";
import { AstNode, ResolverContext, RelationshipInfo } from "../types.js";

export function resolveTypeRelationships(
  sourceFile: SourceFile,
  fileNode: AstNode,
  context: ResolverContext
): void {
  // Get all functions in this file from nodeIndex
  const functions = Array.from(context.nodeIndex.values()).filter(
    n => n.kind === "Function" && n.filePath === fileNode.filePath && n.returnType
  );
  
  for (const func of functions) {
    // Find type node by name
    const returnType = func.returnType as string;
    const typeNode = findTypeNodeByName(returnType, context.nodeIndex);
    
    if (typeNode) {
      const rel: RelationshipInfo = {
        id: context.generateId("returns_type", `${func.name}->${returnType}`),
        entityId: context.generateEntityId("returns_type", `${func.filePath}:${func.name}->${returnType}`),
        type: "RETURNS_TYPE",
        sourceId: func.entityId,
        targetId: typeNode.entityId,
        createdAt: context.now
      };
      context.addRelationship(rel);
    }
  }
  
  // Similar logic for EXTENDS relationships
  const interfaces = Array.from(context.nodeIndex.values()).filter(
    n => n.kind === "Interface" && n.filePath === fileNode.filePath && n.properties?.extends
  );
  
  for (const iface of interfaces) {
    const extendsTypes = iface.properties?.extends as string[];
    for (const extType of extendsTypes) {
      const parentNode = findTypeNodeByName(extType, context.nodeIndex);
      if (parentNode) {
        const rel: RelationshipInfo = {
          id: context.generateId("extends", `${iface.name}->${extType}`),
          entityId: context.generateEntityId("extends", `${iface.filePath}:${iface.name}->${extType}`),
          type: "EXTENDS",
          sourceId: iface.entityId,
          targetId: parentNode.entityId,
          createdAt: context.now
        };
        context.addRelationship(rel);
      }
    }
  }
}

function findTypeNodeByName(typeName: string, nodeIndex: Map<string, AstNode>): AstNode | undefined {
  // Simple implementation - can be enhanced
  for (const node of nodeIndex.values()) {
    if ((node.kind === "TypeAlias" || node.kind === "Interface") && node.name === typeName) {
      return node;
    }
  }
  return undefined;
}
```

**Step 4**: Call in `relationship-resolver.ts`:
```typescript
import { resolveTypeRelationships } from "./resolvers/type-relationship-resolver.js";

// In resolveRelationships(), after component resolver call:
if (sourceFile) {
  // ... existing resolvers ...
  resolveComponentRelationships(sourceFile, fileNode as any, currentContext);
  resolveTypeRelationships(sourceFile, fileNode as any, currentContext);  // ADD THIS
}
```

## Validation Queries

### 1. Check Package Nodes
```cypher
MATCH (p:Package)
RETURN p.name, p.type, p.version, p.path
ORDER BY p.name
```
**Expected**: All workspace packages

### 2. Check File-Package Mapping
```cypher
MATCH (f:File)
WHERE f.properties IS NOT NULL AND f.properties.packageName IS NOT NULL
RETURN f.properties.packageName as package, count(f) as fileCount
ORDER BY fileCount DESC
```
**Expected**: All files grouped by package

### 3. Check BELONGS_TO Relationships
```cypher
MATCH (f:File)-[r:BELONGS_TO]->(p:Package)
RETURN p.name, count(f) as fileCount
ORDER BY fileCount DESC
```
**Expected**: Matches file count from query #2

### 4. Check Package Dependencies (C4 Container Diagram)
```cypher
MATCH (p1:Package)-[d:DEPENDS_ON]->(p2:Package)
RETURN p1.name as source, p2.name as target, d.weight as importCount
ORDER BY d.weight DESC
LIMIT 20
```
**Expected**: Package dependency graph with import counts

### 5. Check Import Resolution Rate
```cypher
MATCH (i:Import)
WITH count(i) as total
MATCH ()-[:RESOLVES_TO]->()
WITH total, count(*) as resolved
RETURN total, resolved, (resolved * 100.0 / total) as percent
```
**Expected**: >90% resolution rate

### 6. Check Component Detection (After Task 1)
```cypher
MATCH (f:Function)
WHERE f.isReactComponent = true OR f.isHook = true
RETURN 
  count(CASE WHEN f.isReactComponent = true THEN 1 END) as components,
  count(CASE WHEN f.isHook = true THEN 1 END) as hooks
```
**Expected**: Non-zero counts for components and hooks

### 7. Check Component Relationships (After Task 1)
```cypher
MATCH (parent:Function)-[:RENDERS_COMPONENT]->(child:Function)
RETURN parent.name, parent.filePath, collect(child.name) as renders
LIMIT 20
```
**Expected**: Component rendering hierarchy

### 8. Check Hook Usage (After Task 1)
```cypher
MATCH (comp:Function)-[:USES_HOOK]->(hook:Function)
RETURN comp.name, collect(hook.name) as hooks
LIMIT 20
```
**Expected**: Components and their hook dependencies

## Testing Commands

```bash
# Build the project
cd /Users/grop/ws/CodeGraph
npm run build

# Run analyzer on test project
node dist/index.js analyze /path/to/test/project --update-schema

# Or use workspace sync for monorepo
node dist/index.js workspace sync -r frontend-monorepo --max-files 1000

# Run validation queries in Neo4j Browser
# Open: http://localhost:7474
# Run queries from "Validation Queries" section above
```

## Summary

**Ready to use now**:
- ✅ Package nodes
- ✅ BELONGS_TO relationships  
- ✅ DEPENDS_ON relationships
- ✅ C4 Container diagrams

**Ready after Task 1** (1 hour):
- ✅ Component detection
- ✅ RENDERS_COMPONENT relationships
- ✅ USES_HOOK relationships
- ✅ C4 Component diagrams

**Ready after Task 2** (2 hours):
- ✅ Type relationships
- ✅ Impact analysis queries

**Total remaining work**: ~5 hours for complete C4 + type analysis support
