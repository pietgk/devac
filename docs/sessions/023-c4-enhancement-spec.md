# CodeGraph C4 Enhancement Specification

> Session: 023  
> Date: 2025-11-06  
> Status: Implementation Ready

## Executive Summary

Enhance CodeGraph to generate C4-ready graphs with package boundaries, resolved imports, and React component identification. The implementation leverages the existing hybrid entity ID system that already handles function overloading, anonymous functions, and nested entities.

---

## Critical Context: Entity ID System

### Existing Implementation ✅

CodeGraph already has a sophisticated entity ID system in `src/analyzer/parser-utils.ts`:

**Format:** `{prefix}:{filepath}:{name}:{signature_hint}#{hash}`

**Examples:**
- `function:/src/utils.ts:process:(string)#a7f3e9c2` - overloaded function with string param
- `function:/src/utils.ts:process:(number)#b8e4f0c3` - same function with number param
- `method:/src/User.ts:UserService.getUser#c9f5e1d4` - class method
- `function:/src/app.ts:callback_map_arg0#d0a6f3a5` - anonymous callback

**Key Features:**
1. **Overloading Support**: `signatureHint` parameter provides human-readable signature
2. **Uniqueness**: 8-character SHA-256 hash ensures no collisions
3. **Anonymous Functions**: Hash includes location (line, column) for uniqueness
4. **Backward Compatible**: Supports legacy 2-parameter signature

### Function Signatures

```typescript
// Legacy (2 params)
generateEntityId(prefix: string, qualifiedName: string): string

// Modern (5-7 params)
generateEntityId(
  prefix: string,
  filepath: string,
  name: string,
  line: number,
  column: number,
  signatureHint?: string,    // e.g., "(string, number)"
  fullSignature?: string     // Full signature for hash
): string
```

**This system is production-ready and should NOT be modified.** All new extractors must use it correctly.

---

## Enhancement Goals

1. **Package Boundaries** - Create Package nodes, tag all files with packageName
2. **Import Resolution** - Resolve Import nodes to actual source (File/Function/Type)
3. **Component Identification** - Flag React components, hooks, and their relationships
4. **Type Relationships** - Connect functions to types they use/return

---

## 1. Package Boundary Extractor

### Location
`src/analyzer/parsers/package-extractor.ts` (NEW)

### Purpose
Detect workspace packages and create Package nodes.

### Implementation

#### Phase 1: Discover Packages

Parse `pnpm-workspace.yaml` or `package.json` workspaces:

```typescript
interface PackageInfo {
  name: string;              // "@mindlercare/ui-web" or "mindlercare"
  type: PackageType;         // "frontend" | "shared-library" | "tool"
  path: string;              // "/packages/mindler-ui-web"
  version: string;           // from package.json
  entryPoint: string;        // main/exports field
}

type PackageType = "frontend" | "shared-library" | "tool";

class PackageExtractor {
  async discoverPackages(rootDir: string): Promise<PackageInfo[]> {
    // 1. Try pnpm-workspace.yaml first
    const workspaceFile = path.join(rootDir, "pnpm-workspace.yaml");
    if (fs.existsSync(workspaceFile)) {
      return this.parseWorkspaceYaml(workspaceFile);
    }
    
    // 2. Try package.json workspaces
    const pkgJson = path.join(rootDir, "package.json");
    if (fs.existsSync(pkgJson)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf-8"));
      if (pkg.workspaces) {
        return this.parseWorkspaceGlobs(pkg.workspaces, rootDir);
      }
    }
    
    // 3. Fallback: single package
    return [this.createRootPackage(rootDir)];
  }
}
```

#### Phase 2: Create Package Nodes

```typescript
function createPackageNode(pkg: PackageInfo, now: string): AstNode {
  return {
    id: generateInstanceId(counter, "package", pkg.name),
    entityId: generateSimpleEntityId("package", pkg.path, pkg.name, 1, 0),
    kind: "Package",
    name: pkg.name,
    type: pkg.type,
    filePath: pkg.path,
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
    language: "config",
    properties: {
      version: pkg.version,
      entryPoint: pkg.entryPoint,
      packageType: pkg.type
    },
    createdAt: now
  };
}
```

#### Phase 3: Tag Files with Package

Modify `src/analyzer/parsers/file-parser.ts` (or wherever File nodes are created):

```typescript
function createFileNode(
  filePath: string,
  packages: PackageInfo[],  // NEW
  // ... other params
): FileNode {
  const pkg = getPackageForFile(filePath, packages);
  
  return {
    // ... existing fields
    properties: {
      ...existingProperties,
      packageName: pkg?.name || null,  // NEW
    }
  };
}

function getPackageForFile(filePath: string, packages: PackageInfo[]): PackageInfo | null {
  // Match longest path first (handles nested packages)
  const sorted = packages.sort((a, b) => b.path.length - a.path.length);
  return sorted.find(pkg => filePath.startsWith(pkg.path)) || null;
}
```

Create `BELONGS_TO` relationship:

```typescript
// In relationship-resolver.ts or new package-relationship-resolver.ts
function createBelongsToRelationships(
  files: AstNode[],
  packages: PackageInfo[]
): RelationshipInfo[] {
  const relationships: RelationshipInfo[] = [];
  
  for (const file of files.filter(n => n.kind === "File")) {
    const packageName = file.properties?.packageName;
    if (!packageName) continue;
    
    const packageNode = findPackageNode(packageName);
    if (!packageNode) continue;
    
    relationships.push({
      id: generateInstanceId(counter, "belongs_to", `${file.entityId}->${packageNode.entityId}`),
      entityId: generateSimpleEntityId(
        "belongs_to",
        file.filePath,
        `${file.name}->${packageName}`,
        1,
        0
      ),
      type: "BELONGS_TO",
      sourceId: file.entityId,
      targetId: packageNode.entityId,
      createdAt: now
    });
  }
  
  return relationships;
}
```

### Tests

```typescript
describe("PackageExtractor", () => {
  it("discovers packages from pnpm-workspace.yaml", async () => {
    const extractor = new PackageExtractor("/path/to/monorepo");
    const packages = await extractor.discoverPackages();
    
    expect(packages).toContainEqual({
      name: "@mindlercare/ui-web",
      type: "shared-library",
      path: expect.stringContaining("/packages/mindler-ui-web")
    });
  });
  
  it("tags files with correct package", () => {
    const file = "/packages/mindler-ui-web/src/button.tsx";
    const pkg = getPackageForFile(file, packages);
    
    expect(pkg.name).toBe("@mindlercare/ui-web");
  });
  
  it("creates Package nodes with correct entity IDs", () => {
    const node = createPackageNode(packageInfo, now);
    
    expect(node.entityId).toMatch(/^package:.*#[0-9a-f]{8}$/);
    expect(node.kind).toBe("Package");
  });
});
```

---

## 2. Import Resolution

### Location
Enhance `src/analyzer/parsers/import-parser.ts` (existing)  
Create `src/analyzer/resolvers/import-resolver.ts` (NEW)

### Purpose
Resolve Import nodes to their actual source (File/Function/Type).

### Implementation

#### Phase 1: Enhance Import Node Creation

Modify import parser to capture full metadata:

```typescript
function createImportNode(
  importDecl: ImportDeclaration,
  filePath: string,
  // ... other params
): AstNode {
  const importSource = importDecl.getModuleSpecifierValue();
  const namedImports = importDecl.getNamedImports();
  const defaultImport = importDecl.getDefaultImport();
  
  return {
    // ... existing fields
    properties: {
      importSource,                                    // NEW: "@mindlercare/ui-web" or "./utils"
      isTypeOnly: importDecl.isTypeOnly(),            // NEW
      isDefault: !!defaultImport,                     // NEW
      namedImports: namedImports.map(n => n.getName()), // NEW
      // ... existing properties
    }
  };
}
```

#### Phase 2: Import Resolver

```typescript
class ImportResolver {
  constructor(
    private packages: PackageInfo[],
    private nodeIndex: Map<string, AstNode>
  ) {}
  
  resolve(importNode: AstNode, fromFile: string): ResolvedTarget | null {
    const importSource = importNode.properties?.importSource;
    if (!importSource) return null;
    
    if (this.isWorkspacePackage(importSource)) {
      return this.resolveWorkspacePackage(importNode, importSource);
    } else if (importSource.startsWith(".")) {
      return this.resolveRelative(importNode, importSource, fromFile);
    }
    
    // External package - no resolution
    return null;
  }
  
  private resolveWorkspacePackage(
    importNode: AstNode,
    packageName: string
  ): ResolvedTarget | null {
    // 1. Find package
    const pkg = this.packages.find(p => p.name === packageName);
    if (!pkg) return null;
    
    // 2. Get entry point
    const entryFile = path.join(pkg.path, pkg.entryPoint);
    
    // 3. If named import, find export in entry file
    const namedImports = importNode.properties?.namedImports || [];
    if (namedImports.length > 0) {
      return this.findNamedExport(entryFile, namedImports[0]);
    }
    
    // 4. Default import - resolve to file
    const fileNode = this.findFileNode(entryFile);
    return fileNode ? { type: "File", entityId: fileNode.entityId } : null;
  }
  
  private resolveRelative(
    importNode: AstNode,
    importPath: string,
    fromFile: string
  ): ResolvedTarget | null {
    // Use existing resolveImportPath() utility
    const resolvedPath = resolveImportPath(fromFile, importPath);
    
    // Find named export if specified
    const namedImports = importNode.properties?.namedImports || [];
    if (namedImports.length > 0) {
      return this.findNamedExport(resolvedPath, namedImports[0]);
    }
    
    // Resolve to file
    const fileNode = this.findFileNode(resolvedPath);
    return fileNode ? { type: "File", entityId: fileNode.entityId } : null;
  }
  
  private findNamedExport(
    filePath: string,
    exportName: string
  ): ResolvedTarget | null {
    // Search nodeIndex for entities in filePath with matching name and isExported=true
    for (const node of this.nodeIndex.values()) {
      if (
        node.filePath === filePath &&
        node.name === exportName &&
        node.isExported
      ) {
        return { type: node.kind, entityId: node.entityId };
      }
    }
    return null;
  }
}

interface ResolvedTarget {
  type: string;     // "File", "Function", "Class", "TypeAlias", etc.
  entityId: string; // Entity ID of target node
}
```

#### Phase 3: Create RESOLVES_TO Relationships

```typescript
function createImportResolutionRelationships(
  imports: AstNode[],
  resolver: ImportResolver
): RelationshipInfo[] {
  const relationships: RelationshipInfo[] = [];
  
  for (const importNode of imports.filter(n => n.kind === "Import")) {
    const resolved = resolver.resolve(importNode, importNode.filePath);
    if (!resolved) continue;
    
    relationships.push({
      id: generateInstanceId(counter, "resolves_to", `${importNode.entityId}->${resolved.entityId}`),
      entityId: generateSimpleEntityId(
        "resolves_to",
        importNode.filePath,
        `${importNode.name}->${resolved.entityId}`,
        importNode.startLine,
        importNode.startColumn
      ),
      type: "RESOLVES_TO",
      sourceId: importNode.entityId,
      targetId: resolved.entityId,
      properties: {
        resolvedType: resolved.type
      },
      createdAt: now
    });
  }
  
  return relationships;
}
```

#### Phase 4: Package Dependencies

```typescript
function derivePackageDependencies(
  relationships: RelationshipInfo[],
  nodeIndex: Map<string, AstNode>
): RelationshipInfo[] {
  const packageDeps = new Map<string, Map<string, number>>(); // pkg1 -> pkg2 -> count
  
  // Aggregate imports across package boundaries
  for (const rel of relationships.filter(r => r.type === "RESOLVES_TO")) {
    const sourceNode = nodeIndex.get(rel.sourceId);
    const targetNode = nodeIndex.get(rel.targetId);
    if (!sourceNode || !targetNode) continue;
    
    const sourcePkg = sourceNode.properties?.packageName;
    const targetPkg = targetNode.properties?.packageName;
    if (!sourcePkg || !targetPkg || sourcePkg === targetPkg) continue;
    
    if (!packageDeps.has(sourcePkg)) {
      packageDeps.set(sourcePkg, new Map());
    }
    const targets = packageDeps.get(sourcePkg)!;
    targets.set(targetPkg, (targets.get(targetPkg) || 0) + 1);
  }
  
  // Create DEPENDS_ON relationships
  const depRelationships: RelationshipInfo[] = [];
  for (const [sourcePkg, targets] of packageDeps) {
    for (const [targetPkg, weight] of targets) {
      const sourceNode = findPackageNode(sourcePkg);
      const targetNode = findPackageNode(targetPkg);
      if (!sourceNode || !targetNode) continue;
      
      depRelationships.push({
        id: generateInstanceId(counter, "depends_on", `${sourcePkg}->${targetPkg}`),
        entityId: generateSimpleEntityId(
          "depends_on",
          sourcePkg,
          `${sourcePkg}->${targetPkg}`,
          1,
          0
        ),
        type: "DEPENDS_ON",
        sourceId: sourceNode.entityId,
        targetId: targetNode.entityId,
        weight,
        properties: { importCount: weight },
        createdAt: now
      });
    }
  }
  
  return depRelationships;
}
```

### Tests

```typescript
describe("ImportResolver", () => {
  it("resolves workspace package imports", () => {
    const importNode = createMockImport("@mindlercare/ui-web", ["Button"]);
    const resolved = resolver.resolve(importNode, "/frontends/app/App.tsx");
    
    expect(resolved).toEqual({
      type: "Function",
      entityId: expect.stringMatching(/^function:.*Button.*#[0-9a-f]{8}$/)
    });
  });
  
  it("resolves relative imports", () => {
    const importNode = createMockImport("./utils", ["helper"]);
    const resolved = resolver.resolve(importNode, "/src/app.tsx");
    
    expect(resolved.entityId).toContain("/src/utils.ts");
  });
  
  it("creates RESOLVES_TO relationships", async () => {
    const rels = createImportResolutionRelationships(imports, resolver);
    
    expect(rels).toContainEqual(
      expect.objectContaining({
        type: "RESOLVES_TO",
        sourceId: expect.any(String),
        targetId: expect.any(String)
      })
    );
  });
  
  it("derives package dependencies", () => {
    const depRels = derivePackageDependencies(relationships, nodeIndex);
    
    const mindlercareToUiWeb = depRels.find(
      r => r.sourceId.includes("mindlercare") && r.targetId.includes("ui-web")
    );
    
    expect(mindlercareToUiWeb).toBeDefined();
    expect(mindlercareToUiWeb.weight).toBeGreaterThan(0);
  });
});
```

---

## 3. React Component Analyzer

### Location
Enhance `src/analyzer/parsers/function-parser.ts` (existing)  
Create `src/analyzer/resolvers/component-resolver.ts` (NEW)

### Purpose
Identify React components, hooks, and their relationships.

### Implementation

#### Phase 1: Detect Components

When creating Function nodes, analyze for React patterns:

```typescript
function createFunctionNode(
  func: FunctionDeclaration | ArrowFunction,
  // ... other params
): AstNode {
  const name = func.getName?.() || generateAnonymousName(func);
  const isReactComponent = detectReactComponent(func);
  const isHook = detectReactHook(func);
  
  return {
    // ... existing fields
    isReactComponent,  // NEW
    isHook,            // NEW
    properties: {
      // ... existing properties
      componentType: isReactComponent ? detectComponentType(func) : undefined, // "FC" | "class" | "function"
    }
  };
}

function detectReactComponent(func: FunctionDeclaration | ArrowFunction): boolean {
  // 1. Check return type
  const returnType = func.getReturnType().getText();
  if (returnType.includes("JSX.Element") || returnType.includes("ReactElement")) {
    return true;
  }
  
  // 2. Check if returns JSX
  const returnStatements = func.getDescendantsOfKind(SyntaxKind.ReturnStatement);
  for (const ret of returnStatements) {
    const expr = ret.getExpression();
    if (expr && (
      expr.getKind() === SyntaxKind.JsxElement ||
      expr.getKind() === SyntaxKind.JsxSelfClosingElement ||
      expr.getKind() === SyntaxKind.JsxFragment
    )) {
      return true;
    }
  }
  
  // 3. Check name starts with uppercase (convention)
  const name = func.getName?.() || "";
  return /^[A-Z]/.test(name) && func.getSourceFile().getBaseName().match(/\.tsx$/);
}

function detectReactHook(func: FunctionDeclaration | ArrowFunction): boolean {
  const name = func.getName?.() || "";
  return /^use[A-Z]/.test(name);
}
```

#### Phase 2: Component Hierarchy

Track which components render other components:

```typescript
class ComponentAnalyzer {
  analyzeComponentRelationships(component: FunctionDeclaration): RelationshipInfo[] {
    const relationships: RelationshipInfo[] = [];
    
    // Find all JSX elements in component body
    const jsxElements = component.getDescendantsOfKind(SyntaxKind.JsxElement)
      .concat(component.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement));
    
    for (const jsx of jsxElements) {
      const tagName = jsx.getTagNameNode().getText();
      
      // Only track custom components (start with uppercase)
      if (!/^[A-Z]/.test(tagName)) continue;
      
      // Find the component definition
      const childComponent = this.findComponent(tagName, component.getSourceFile());
      if (!childComponent) continue;
      
      relationships.push({
        id: generateInstanceId(counter, "renders_component", `${component.name}->${tagName}`),
        entityId: generateSimpleEntityId(
          "renders_component",
          component.filePath,
          `${component.name}->${tagName}`,
          jsx.getStartLineNumber(),
          0
        ),
        type: "RENDERS_COMPONENT",
        sourceId: component.entityId,
        targetId: childComponent.entityId,
        createdAt: now
      });
    }
    
    return relationships;
  }
  
  private findComponent(name: string, sourceFile: SourceFile): AstNode | null {
    // Search in nodeIndex for component with matching name
    // Priority: same file > imported > global
    return nodeIndex.get(`function:${sourceFile.getFilePath()}:${name}`) || null;
  }
}
```

#### Phase 3: Hook Usage

```typescript
class HookAnalyzer {
  analyzeHookUsage(component: FunctionDeclaration): RelationshipInfo[] {
    const relationships: RelationshipInfo[] = [];
    
    // Find all function calls in component
    const calls = component.getDescendantsOfKind(SyntaxKind.CallExpression);
    
    for (const call of calls) {
      const funcName = call.getExpression().getText();
      
      // Check if it's a hook call (starts with 'use')
      if (!/^use[A-Z]/.test(funcName)) continue;
      
      // Find hook definition
      const hookDef = this.findHook(funcName, component.getSourceFile());
      if (!hookDef) continue;
      
      relationships.push({
        id: generateInstanceId(counter, "uses_hook", `${component.name}->${funcName}`),
        entityId: generateSimpleEntityId(
          "uses_hook",
          component.filePath,
          `${component.name}->${funcName}`,
          call.getStartLineNumber(),
          0
        ),
        type: "USES_HOOK",
        sourceId: component.entityId,
        targetId: hookDef.entityId,
        createdAt: now
      });
    }
    
    return relationships;
  }
}
```

### Tests

```typescript
describe("ComponentAnalyzer", () => {
  it("detects React components", () => {
    const code = `
      export const Button: FC<Props> = () => <button>Click</button>;
    `;
    const func = parseFunction(code);
    
    expect(detectReactComponent(func)).toBe(true);
  });
  
  it("detects React hooks", () => {
    const code = `
      export const useAuth = () => { return { user: null }; };
    `;
    const func = parseFunction(code);
    
    expect(detectReactHook(func)).toBe(true);
  });
  
  it("tracks component rendering", () => {
    const component = parseFunctionFromFile("App.tsx");
    const rels = analyzer.analyzeComponentRelationships(component);
    
    expect(rels).toContainEqual(
      expect.objectContaining({
        type: "RENDERS_COMPONENT",
        sourceId: expect.stringContaining("App"),
        targetId: expect.stringContaining("Button")
      })
    );
  });
});
```

---

## 4. Type Relationship Tracker

### Location
Enhance `src/analyzer/parsers/type-alias-parser.ts` (existing)  
Enhance `src/analyzer/parsers/interface-parser.ts` (existing)  
Create `src/analyzer/resolvers/type-resolver.ts` (NEW)

### Implementation

#### Phase 1: Function Return Types

```typescript
function createFunctionNode(func: FunctionDeclaration): AstNode {
  const returnTypeNode = func.getReturnTypeNode();
  const returnType = returnTypeNode?.getText() || "void";
  
  return {
    // ... existing fields
    returnType,  // NEW
    properties: {
      // ... existing properties
      returnTypeEntityId: this.resolveTypeEntityId(returnType, func), // NEW
    }
  };
}

function resolveTypeEntityId(typeName: string, context: Node): string | null {
  // Find type definition in same file or imports
  const sourceFile = context.getSourceFile();
  
  // Search for type alias or interface
  const typeDecl = sourceFile.getTypeAlias(typeName) || sourceFile.getInterface(typeName);
  if (typeDecl) {
    return generateSimpleEntityId(
      typeDecl.isKind(SyntaxKind.TypeAliasDeclaration) ? "typealias" : "interface",
      sourceFile.getFilePath(),
      typeName,
      typeDecl.getStartLineNumber(),
      0
    );
  }
  
  return null;
}
```

Create RETURNS_TYPE relationships:

```typescript
function createReturnTypeRelationships(functions: AstNode[]): RelationshipInfo[] {
  const relationships: RelationshipInfo[] = [];
  
  for (const func of functions.filter(n => n.kind === "Function")) {
    const returnTypeEntityId = func.properties?.returnTypeEntityId;
    if (!returnTypeEntityId) continue;
    
    relationships.push({
      id: generateInstanceId(counter, "returns_type", `${func.entityId}->${returnTypeEntityId}`),
      entityId: generateSimpleEntityId(
        "returns_type",
        func.filePath,
        `${func.name}->return`,
        func.startLine,
        0
      ),
      type: "RETURNS_TYPE",
      sourceId: func.entityId,
      targetId: returnTypeEntityId,
      createdAt: now
    });
  }
  
  return relationships;
}
```

#### Phase 2: Type Inheritance

```typescript
function createInterfaceNode(iface: InterfaceDeclaration): AstNode {
  const extendsClause = iface.getExtends();
  const extendsTypes = extendsClause.map(e => e.getText());
  
  return {
    // ... existing fields
    properties: {
      // ... existing properties
      extends: extendsTypes,  // NEW
      extendsEntityIds: extendsTypes.map(t => 
        resolveTypeEntityId(t, iface)
      ).filter(Boolean),  // NEW
    }
  };
}
```

Create EXTENDS relationships:

```typescript
function createExtendsRelationships(interfaces: AstNode[]): RelationshipInfo[] {
  const relationships: RelationshipInfo[] = [];
  
  for (const iface of interfaces.filter(n => n.kind === "Interface")) {
    const extendsEntityIds = iface.properties?.extendsEntityIds || [];
    
    for (const targetId of extendsEntityIds) {
      relationships.push({
        id: generateInstanceId(counter, "extends", `${iface.entityId}->${targetId}`),
        entityId: generateSimpleEntityId(
          "extends",
          iface.filePath,
          `${iface.name}->extends`,
          iface.startLine,
          0
        ),
        type: "EXTENDS",
        sourceId: iface.entityId,
        targetId,
        createdAt: now
      });
    }
  }
  
  return relationships;
}
```

### Tests

```typescript
describe("TypeRelationshipTracker", () => {
  it("tracks function return types", () => {
    const code = `
      type User = { name: string };
      function getUser(): User { return { name: "John" }; }
    `;
    const nodes = parseCode(code);
    const rels = createReturnTypeRelationships(nodes);
    
    expect(rels).toContainEqual(
      expect.objectContaining({
        type: "RETURNS_TYPE",
        sourceId: expect.stringContaining("getUser"),
        targetId: expect.stringContaining("User")
      })
    );
  });
  
  it("tracks interface inheritance", () => {
    const code = `
      interface Base { id: number; }
      interface Extended extends Base { name: string; }
    `;
    const nodes = parseCode(code);
    const rels = createExtendsRelationships(nodes);
    
    expect(rels).toContainEqual(
      expect.objectContaining({
        type: "EXTENDS",
        sourceId: expect.stringContaining("Extended"),
        targetId: expect.stringContaining("Base")
      })
    );
  });
});
```

---

## Integration Plan

### Phase 1: Infrastructure (Day 1)
1. Create `PackageExtractor` class
2. Modify file node creation to include `packageName`
3. Create `BELONGS_TO` relationships
4. Write tests

### Phase 2: Import Resolution (Day 2)
1. Enhance `ImportParser` to capture metadata
2. Create `ImportResolver` class
3. Create `RESOLVES_TO` relationships
4. Derive `DEPENDS_ON` relationships
5. Write tests

### Phase 3: Component Analysis (Day 3)
1. Add component detection to function parser
2. Create `ComponentAnalyzer` class
3. Create `RENDERS_COMPONENT` relationships
4. Create `USES_HOOK` relationships
5. Write tests

### Phase 4: Type Tracking (Day 4)
1. Enhance type parsers with inheritance tracking
2. Create `TypeResolver` class
3. Create `RETURNS_TYPE` and `EXTENDS` relationships
4. Write tests

### Phase 5: Integration (Day 5)
1. Update `analyzer-service.ts` to orchestrate all extractors
2. Run full integration tests on real monorepo
3. Validate C4 diagram generation queries
4. Document usage

---

## Success Criteria

✅ Package nodes created for all packages  
✅ Every File has `packageName` and `BELONGS_TO` relationship  
✅ >90% of Import nodes have `RESOLVES_TO` relationship  
✅ Package `DEPENDS_ON` relationships derived  
✅ React components flagged with `isReactComponent: true`  
✅ Hooks flagged with `isHook: true`  
✅ `RENDERS_COMPONENT` and `USES_HOOK` relationships created  
✅ `RETURNS_TYPE` and `EXTENDS` relationships created  
✅ All entity IDs follow hybrid format with proper hashing  
✅ Can generate C4 Container diagram from Neo4j  
✅ Can generate C4 Component diagram for any package  
✅ All extractors have >80% test coverage

---

## C4 Diagram Queries

After implementation, these queries will work:

### Container Diagram (Level 2)
```cypher
MATCH (p1:Package)-[d:DEPENDS_ON]->(p2:Package)
RETURN p1.name as source, p2.name as target, d.weight as imports
ORDER BY d.weight DESC
```

### Component Diagram (Level 3)
```cypher
MATCH (pkg:Package {name: $packageName})<-[:BELONGS_TO]-(f:File)
MATCH (f)<-[:CONTAINS]-(comp:Function {isReactComponent: true})
OPTIONAL MATCH (comp)-[:RENDERS_COMPONENT]->(child:Function)
RETURN comp.name, comp.filePath, collect(child.name) as renders
```

### Hook Usage
```cypher
MATCH (comp:Function {isReactComponent: true})-[:USES_HOOK]->(hook:Function)
RETURN comp.name, collect(hook.name) as hooks
```

---

## Estimated Effort

- **Day 1**: PackageExtractor (6 hours)
- **Day 2**: ImportResolver (8 hours)
- **Day 3**: ComponentAnalyzer (6 hours)
- **Day 4**: TypeResolver (6 hours)
- **Day 5**: Integration & Testing (8 hours)

**Total**: ~34 hours focused implementation

---

## Notes

1. **Entity ID System**: DO NOT MODIFY. Use existing `generateEntityId()` correctly.
2. **Backward Compatibility**: Support both 2-param and 5-7 param signatures.
3. **Testing**: Write tests FIRST for each component (TDD approach).
4. **Documentation**: Update ARCHITECTURE.md after completion.
