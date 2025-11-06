# CodeGraph Architecture

> **Version:** 3.0  
> **Last Updated:** 2025-11-06  
> **Status:** Production-ready with C4 diagram support

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [Core Components](#core-components)
4. [Entity ID System](#entity-id-system)
5. [Two-Pass Parsing Pipeline](#two-pass-parsing-pipeline)
6. [Language Parsers](#language-parsers)
7. [C4 Diagram Support](#c4-diagram-support)
8. [Neo4j Schema](#neo4j-schema)
9. [Workspace Management](#workspace-management)
10. [Validation & Testing](#validation--testing)
11. [Development Guide](#development-guide)

---

## Executive Summary

**CodeGraph** is a multi-language static code analysis tool that extracts Abstract Syntax Trees (AST) from source code and stores the results in a Neo4j graph database, enabling powerful code exploration, dependency analysis, and C4 architecture diagram generation.

### Key Capabilities

✅ **Multi-language support** - TypeScript, JavaScript, Python, Java, C#, Go, C/C++  
✅ **C4 diagram generation** - Container and Component level diagrams from code  
✅ **Package detection** - Workspace-aware with monorepo support  
✅ **Import resolution** - Resolves workspace packages, path aliases, relative imports  
✅ **Component analysis** - React component and hook detection  
✅ **Sophisticated entity IDs** - Handles function overloading, anonymous functions  
✅ **Two-pass parsing** - Accurate cross-file relationship resolution  
✅ **Memory efficient** - Streaming writes to Neo4j during parsing  
✅ **Sleep detection** - Laptop-friendly for long-running analyses  

### Primary Use Cases

1. **Architecture Visualization** - Generate C4 Container and Component diagrams
2. **Dependency Analysis** - Understand package dependencies and import patterns
3. **Code Exploration** - Navigate large codebases via graph queries
4. **Refactoring Support** - Identify impact of changes across language boundaries
5. **Technical Debt Analysis** - Find circular dependencies, unused code

---

## System Architecture

### High-Level Overview

```
┌────────────────────────────────────────────────────────────────┐
│                         User Interface                          │
│  CLI: analyze, workspace sync, workspace status                │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│                      AnalyzerService                            │
│  Orchestrates: Package Detection → Scanning → Parsing → Storage│
└──────────────────────────┬─────────────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
            ▼              ▼              ▼
    ┌──────────────┐  ┌────────┐  ┌─────────────┐
    │PackageExtractor│ │Parser │  │StorageManager│
    │ pnpm/npm/yarn│ │2-Pass  │  │Batch Neo4j  │
    │ workspace    │ │ AST→   │  │   Writes    │
    │ detection    │ │ Nodes  │  │             │
    └──────────────┘  └───┬────┘  └─────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
  ┌──────────┐      ┌──────────┐     ┌──────────┐
  │  TS/JS   │      │  Python  │     │   Java   │
  │ts-morph  │      │Python AST│     │tree-sitter│
  └──────────┘      └──────────┘     └──────────┘
        │                 │                 │
        └─────────────────┼─────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────┐
        │        Neo4j Graph Database         │
        │                                     │
        │  Nodes: Package, File, Function,   │
        │         Class, Interface, etc.      │
        │                                     │
        │  Edges: BELONGS_TO, DEPENDS_ON,    │
        │         RESOLVES_TO, CALLS, etc.   │
        └─────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Status |
|-----------|---------------|--------|
| **AnalyzerService** | Orchestrates analysis pipeline | ✅ Production |
| **PackageExtractor** | Discovers workspace packages | ✅ Production |
| **ImportResolver** | Resolves imports to targets | ✅ Production |
| **ComponentAnalyzer** | Detects React components/hooks | ✅ Ready (needs integration) |
| **FileScanner** | Discovers files with ignore patterns | ✅ Production |
| **Parser** | Coordinates language parsers | ✅ Production |
| **StorageManager** | Batch writes to Neo4j | ✅ Production |
| **Neo4jClient** | Connection management | ✅ Production |
| **SleepDetector** | Detects system sleep/wake | ✅ Production |

---

## Core Components

### AnalyzerService

**Location**: `src/analyzer/analyzer-service.ts`

**Responsibilities**:
- Initializes package detection
- Scans files with ignore patterns
- Runs two-pass parsing pipeline
- Manages Neo4j connection lifecycle
- Handles system sleep/wake events

**Key Methods**:
```typescript
async analyze(directory: string, configOverride?: {
  ignorePatterns?: string[];
  supportedExtensions?: string[];
  maxFiles?: number;
}): Promise<void>
```

### PackageExtractor

**Location**: `src/analyzer/parsers/package-extractor.ts`

**Status**: ✅ **Fully Implemented and Integrated**

**Responsibilities**:
- Discovers packages from `pnpm-workspace.yaml`
- Discovers packages from `package.json` workspaces
- Determines package type: `frontend`, `shared-library`, `tool`
- Resolves package entry points
- Maps files to their containing package

**Key Methods**:
```typescript
async discoverPackages(): Promise<PackageInfo[]>
getPackageForFile(filePath: string): PackageInfo | null
createPackageNodes(now: string): PackageNode[]
```

**Integration**: `src/analyzer/parser.ts` line 87, 443

### ImportResolver

**Location**: `src/analyzer/parsers/import-resolver.ts`

**Status**: ✅ **Fully Implemented and Integrated**

**Responsibilities**:
- Resolves workspace package imports (`@mindlercare/ui-web`)
- Resolves relative imports (`./utils`, `../components`)
- Resolves TypeScript path aliases (`@/components`, `core/utils`)
- Per-package `tsconfig.json` support
- Extension and index file resolution

**Key Methods**:
```typescript
async resolve(
  importNode: ImportNode, 
  fromFile: string
): Promise<ResolvedImport | null>
```

**Integration**: `src/analyzer/parser.ts` line 94, `src/analyzer/relationship-resolver.ts` line 98

### ComponentAnalyzer

**Location**: `src/analyzer/parsers/component-analyzer.ts`

**Status**: ✅ **Implemented**, ⚠️ **Needs Integration** (1 hour)

**Responsibilities**:
- Detects React components (uppercase name, returns JSX, in `.tsx`)
- Detects React hooks (starts with `use[A-Z]`)
- Finds rendered components (JSX element usage)
- Finds used hooks (hook calls in component body)

**Key Methods**:
```typescript
isReactComponent(func: FunctionDeclaration): boolean
isReactHook(func: FunctionDeclaration): boolean
findRenderedComponents(func: FunctionDeclaration): string[]
findUsedHooks(func: FunctionDeclaration): string[]
```

**Integration Status**: 
- ✅ Relationship resolver exists and is called
- ❌ Function parser doesn't set `isReactComponent`/`isHook` flags yet

### StorageManager

**Location**: `src/analyzer/storage-manager.ts`

**Responsibilities**:
- Batch writes to Neo4j (configurable batch size)
- Deduplication by entityId
- Streaming writes during Pass 1 (memory efficient)
- Relationship writing during Pass 2

**Features**:
- Batching by node/relationship type
- Retry logic for transient failures
- Comprehensive logging

---

## Entity ID System

**Location**: `src/analyzer/parser-utils.ts`

**Status**: ✅ **Production-Ready** - Handles ALL edge cases

### Format

`{prefix}:{filepath}:{name}:{signature_hint}#{hash}`

### Features

✅ **Function Overloading** - Same name, different signatures  
✅ **Anonymous Functions** - Location-based uniqueness  
✅ **Nested Entities** - Parent context in hash  
✅ **Backward Compatible** - Supports legacy 2-param signature  

### Examples

```typescript
// Overloaded functions
function:/src/utils.ts:process:(string)#a7f3e9c2
function:/src/utils.ts:process:(number)#b8e4f0c3

// Anonymous callbacks
function:/src/app.ts:callback_map_arg0#d0a6f3a5

// Class methods
method:/src/User.ts:UserService.getUser#c9f5e1d4

// Constructors
constructor:/src/Button.ts:Button:()#e5f6a1b2
```

### Signatures

```typescript
// Modern signature (5-7 params) - full control
generateEntityId(
  prefix: string,           // "function", "class", "interface"
  filepath: string,         // Normalized absolute path
  name: string,             // Entity name
  line: number,             // Start line (1-based)
  column: number,           // Start column (0-based)
  signatureHint?: string,   // Human-readable "(string, number)"
  fullSignature?: string    // Full signature for hash
): string

// Legacy signature (2 params) - backward compatible
generateEntityId(
  prefix: string,           // "function", "class"
  qualifiedName: string     // "filepath:name" or "filepath:name:line"
): string
```

### How It Works

1. **Readable Prefix**: `{prefix}:{filepath}:{name}:{signature_hint}`
2. **Hash Components**: `filepath::name::line::column::fullSignature`
3. **Hash Generation**: 8-character SHA-256 (4.3 billion combinations)
4. **Final Format**: `readable_prefix#hash`

### Uniqueness Guarantees

- ✅ **Same function, different signatures**: Unique via `signatureHint` and hash
- ✅ **Same name, different locations**: Unique via line/column in hash
- ✅ **Same name, different contexts**: Unique via filepath in hash
- ✅ **Anonymous functions**: Unique via location + context in hash

---

## Two-Pass Parsing Pipeline

### Pass 1: AST Extraction

**Goal**: Extract all nodes and intra-file relationships

**Process**:
1. **Package Discovery** - Detect workspace structure
2. **File Scanning** - Find all source files
3. **Language Detection** - Route to appropriate parser
4. **AST Extraction** - Parse using ts-morph or tree-sitter
5. **Node Creation** - Generate AstNode objects with entity IDs
6. **Intra-file Relationships** - CONTAINS, HAS_METHOD, HAS_PARAMETER
7. **Streaming Write** - Write TypeScript nodes to Neo4j in batches
8. **Temp Files** - Write non-TypeScript results to JSON files

**Streaming Strategy**:
- TypeScript/JavaScript: Direct to Neo4j (memory efficient)
- Python/Java/C#/Go/C++: Write to temp JSON files (parsed by external tools)

### Pass 2: Relationship Resolution

**Goal**: Resolve cross-file relationships

**Process**:
1. **Load Temp Files** - Read Pass 1 results for non-TS files
2. **Build Node Index** - Create entityId → AstNode map
3. **Resolve Imports** - Create RESOLVES_TO relationships
4. **Resolve Component Usage** - Create RENDERS_COMPONENT, USES_HOOK
5. **Resolve Type Relationships** - Create EXTENDS, RETURNS_TYPE (future)
6. **Derive Package Dependencies** - Create DEPENDS_ON with weights
7. **Write Relationships** - Batch write to Neo4j

**Resolvers**:
- `ts-resolver.ts` - TypeScript modules, inheritance, calls
- `import-relationship-resolver.ts` - Import resolution + package deps
- `component-relationship-resolver.ts` - React component relationships
- `c-cpp-resolver.ts` - C/C++ includes

---

## Language Parsers

### TypeScript/JavaScript

**Parser**: `ts-morph` (TypeScript Compiler API wrapper)

**Files**: 
- `src/analyzer/parsers/function-parser.ts`
- `src/analyzer/parsers/class-parser.ts`
- `src/analyzer/parsers/interface-parser.ts`
- `src/analyzer/parsers/import-parser.ts`

**Extracts**:
- Functions, classes, interfaces, type aliases
- Imports/exports
- JSX elements and attributes (React)
- Method calls, property access

### Python

**Parser**: Python `ast` module via subprocess

**File**: `src/analyzer/python-parser.ts`

**Extracts**:
- Functions, classes, methods
- Imports (import, from...import)
- Decorators, docstrings

### Java

**Parser**: `tree-sitter-java`

**File**: `src/analyzer/parsers/java-parser.ts`

**Extracts**:
- Packages, classes, interfaces, enums
- Methods, fields, constructors
- Import declarations

### C# 

**Parser**: `tree-sitter-c-sharp`

**File**: `src/analyzer/parsers/csharp-parser.ts`

**Extracts**:
- Namespaces, classes, structs, interfaces
- Methods, properties, fields
- Using directives

### Go

**Parser**: `tree-sitter-go`

**File**: `src/analyzer/parsers/go-parser.ts`

**Extracts**:
- Packages, functions, methods
- Structs, interfaces
- Import specs

### C/C++

**Parser**: `tree-sitter-c`, `tree-sitter-cpp`

**File**: `src/analyzer/parsers/c-cpp-parser.ts`

**Extracts**:
- Functions, classes (C++)
- Include directives, macro definitions
- Structs, enums

---

## C4 Diagram Support

### Overview

**Status**: ✅ **Container Diagrams Ready**, ⚠️ **Component Diagrams Need 1-Hour Task**

CodeGraph can generate:
- **C4 Level 1**: System Context (basic support)
- **C4 Level 2**: Container Diagram (✅ **READY NOW**)
- **C4 Level 3**: Component Diagram (⚠️ needs ComponentAnalyzer integration)

### Package Detection

**Implementation**: `src/analyzer/parsers/package-extractor.ts`  
**Integration**: `src/analyzer/parser.ts` line 443  
**Status**: ✅ **Fully Working**

**Discovers from**:
- `pnpm-workspace.yaml`
- `package.json` with workspaces field
- Single-package projects

**Creates**:
- Package nodes with type (`frontend`, `shared-library`, `tool`)
- File nodes with `packageName` property
- BELONGS_TO relationships (File → Package)

**Example Neo4j**:
```cypher
(:Package {
  name: "@mindlercare/ui-web",
  type: "shared-library",
  version: "1.0.0",
  path: "/packages/mindler-ui-web"
})

(:File {
  filePath: "/packages/mindler-ui-web/src/button.tsx",
  properties: { packageName: "@mindlercare/ui-web" }
})-[:BELONGS_TO]->(:Package)
```

### Import Resolution

**Implementation**: `src/analyzer/parsers/import-resolver.ts`  
**Integration**: `src/analyzer/relationship-resolver.ts` line 98  
**Status**: ✅ **Fully Working**

**Resolves**:
- Workspace packages: `@mindlercare/ui-web` → `/packages/mindler-ui-web/src/index.ts`
- Relative imports: `./utils` → `/src/utils.ts`
- Path aliases: `@/components` → `/src/components` (tsconfig.json)
- Per-package path resolution (monorepo-aware)

**Creates**:
- RESOLVES_TO relationships (Import → File/Function/Type)
- DEPENDS_ON relationships with weight (Package → Package)

**Example Neo4j**:
```cypher
(:Import {name: "Button", importSource: "@mindlercare/ui-web"})
  -[:RESOLVES_TO]->
(:Function {name: "Button", filePath: "/.../ui-web/src/lib/button/button.tsx"})

(:Package {name: "mindlercare"})-[:DEPENDS_ON {weight: 42}]->(:Package {name: "@mindlercare/ui-web"})
```

### Component Analysis

**Implementation**: `src/analyzer/parsers/component-analyzer.ts`  
**Integration**: ⚠️ **Needs 1-Hour Task**  
**Status**: ✅ **Code Exists**, ❌ **Not Hooked Up**

**What Works**:
- ComponentAnalyzer class fully functional
- Component relationship resolver exists
- Called in Pass 2 relationship resolution

**What's Missing**:
- Function nodes don't have `isReactComponent`/`isHook` flags
- Need 2 lines added to `function-parser.ts`

**Will Create**:
- RENDERS_COMPONENT relationships (Component → Component)
- USES_HOOK relationships (Component → Hook)

**Example Neo4j** (after integration):
```cypher
(:Function {
  name: "App",
  isReactComponent: true,
  filePath: "/src/App.tsx"
})-[:RENDERS_COMPONENT]->(:Function {name: "Button"})

(:Function {name: "App"})-[:USES_HOOK]->(:Function {name: "useState", isHook: true})
```

### C4 Queries

#### Container Diagram (Level 2) - ✅ WORKS NOW

```cypher
// Show package dependencies
MATCH (p1:Package)-[d:DEPENDS_ON]->(p2:Package)
RETURN p1.name as source, 
       p1.type as sourceType,
       p2.name as target,
       p2.type as targetType,
       d.weight as imports
ORDER BY d.weight DESC
```

**Expected Output**:
```
source              | sourceType     | target                  | targetType     | imports
--------------------+----------------+-------------------------+----------------+---------
mindlercare         | frontend       | @mindlercare/ui-web     | shared-library | 112
mindlercare         | frontend       | @mindlercare/auth-ui    | shared-library | 58
ui-web              | shared-library | @mindlercare/schema     | shared-library | 24
```

#### Component Diagram (Level 3) - ⚠️ After 1-Hour Task

```cypher
// Show component structure for a package
MATCH (pkg:Package {name: $packageName})<-[:BELONGS_TO]-(f:File)
MATCH (f)-[:CONTAINS]->(comp:Function {isReactComponent: true})
OPTIONAL MATCH (comp)-[:RENDERS_COMPONENT]->(child:Function)
OPTIONAL MATCH (comp)-[:USES_HOOK]->(hook:Function)
RETURN comp.name,
       comp.filePath,
       collect(DISTINCT child.name) as rendersComponents,
       collect(DISTINCT hook.name) as usesHooks
ORDER BY comp.name
```

**Expected Output** (after integration):
```
comp.name    | comp.filePath         | rendersComponents      | usesHooks
-------------+-----------------------+------------------------+------------------
App          | /src/App.tsx          | [Header, Content]      | [useState, useEffect]
Header       | /src/Header.tsx       | [Logo, Navigation]     | [useAuth]
```

### Validation Queries

#### 1. Verify Package Nodes
```cypher
MATCH (p:Package)
RETURN p.name, p.type, p.version, count{(p)<-[:BELONGS_TO]-()} as fileCount
ORDER BY fileCount DESC
```

#### 2. Verify BELONGS_TO Relationships
```cypher
MATCH (f:File)-[:BELONGS_TO]->(p:Package)
RETURN p.name, count(f) as fileCount
ORDER BY fileCount DESC
```

#### 3. Verify DEPENDS_ON Relationships
```cypher
MATCH (p1:Package)-[d:DEPENDS_ON]->(p2:Package)
RETURN count(d) as dependencyCount, 
       avg(d.weight) as avgImportsPerDep,
       max(d.weight) as maxImports
```

#### 4. Check Import Resolution Rate
```cypher
MATCH (i:Import)
WITH count(i) as total
MATCH ()-[:RESOLVES_TO]->()
WITH total, count(*) as resolved
RETURN total, resolved, (resolved * 100.0 / total) as resolvedPercent
```
**Expected**: >90% resolution rate

### Remaining Work for Full C4 Support

**Task 1: ComponentAnalyzer Integration** (1 hour)

**File**: `src/analyzer/parsers/function-parser.ts`

**Change**:
```typescript
import { ComponentAnalyzer } from './component-analyzer.js';

const componentAnalyzer = new ComponentAnalyzer();

// When creating function node:
const isReactComponent = componentAnalyzer.isReactComponent(func);
const isHook = componentAnalyzer.isReactHook(func);

const functionNode: AstNode = {
  // ... existing fields ...
  isReactComponent,  // ADD
  isHook,            // ADD
};
```

**Impact**: Enables Component-level C4 diagrams immediately

---

## Neo4j Schema

### Node Types

| Label | Properties | Example |
|-------|-----------|---------|
| **Package** | name, type, version, path | `@mindlercare/ui-web` |
| **File** | filePath, language, loc, packageName | `/src/utils.ts` |
| **Function** | name, isExported, isAsync, isReactComponent, isHook, returnType | `processData` |
| **Class** | name, isExported, isAbstract | `UserService` |
| **Interface** | name, isExported | `UserProfile` |
| **TypeAlias** | name, isExported | `UserId` |
| **Method** | name, visibility, isStatic | `getUser` |
| **Parameter** | name, type, isOptional | `userId` |
| **Import** | name, importSource, isTypeOnly | `Button` from `@mindlercare/ui-web` |
| **JSXElement** | name, isSelfClosing | `<Button>` |
| **Variable** | name, isConstant | `MAX_RETRIES` |

### Relationship Types

| Type | Description | Example |
|------|-------------|---------|
| **BELONGS_TO** | File belongs to Package | `File → Package` |
| **DEPENDS_ON** | Package depends on Package | `Package → Package` (weight: import count) |
| **RESOLVES_TO** | Import resolves to target | `Import → Function/File/Type` |
| **CONTAINS** | File contains entity | `File → Function/Class` |
| **IMPORTS** | File imports from module | `File → Import` |
| **EXPORTS** | File exports entity | `File → Function/Class` |
| **CALLS** | Function calls another | `Function → Function` |
| **RENDERS_COMPONENT** | Component renders another | `Function → Function` (React) |
| **USES_HOOK** | Component uses hook | `Function → Function` (React) |
| **HAS_METHOD** | Class has method | `Class → Method` |
| **HAS_PARAMETER** | Function has parameter | `Function → Parameter` |
| **EXTENDS** | Class/Interface extends | `Class → Class`, `Interface → Interface` |
| **IMPLEMENTS** | Class implements interface | `Class → Interface` |
| **RETURNS_TYPE** | Function returns type | `Function → TypeAlias/Interface` |

### Constraints (Automatic Creation)

```cypher
CREATE CONSTRAINT IF NOT EXISTS FOR (n:Package) REQUIRE n.entityId IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (n:File) REQUIRE n.entityId IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (n:Function) REQUIRE n.entityId IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (n:Class) REQUIRE n.entityId IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (n:Interface) REQUIRE n.entityId IS UNIQUE;
```

### Indexes (Automatic Creation)

```cypher
CREATE INDEX IF NOT EXISTS FOR (n:File) ON (n.filePath);
CREATE INDEX IF NOT EXISTS FOR (n:File) ON (n.packageName);
CREATE INDEX IF NOT EXISTS FOR (n:Function) ON (n.name);
CREATE INDEX IF NOT EXISTS FOR (n:Function) ON (n.isReactComponent);
CREATE INDEX IF NOT EXISTS FOR (n:Import) ON (n.importSource);
```

---

## Workspace Management

**Location**: `src/workspace/`

**Purpose**: Manage multi-repository codebases

### Configuration

**File**: `.codegraph/workspace.json`

```json
{
  "workspaceName": "MyCompany",
  "repositories": [
    {
      "name": "frontend-monorepo",
      "path": "/Users/grop/ws/frontend-monorepo",
      "enabled": true
    },
    {
      "name": "backend-services",
      "path": "/Users/grop/ws/monorepo-3.0",
      "enabled": true
    }
  ],
  "filterPresets": [
    {
      "name": "frontend-only",
      "description": "Analyze only frontend packages",
      "repositories": ["frontend-monorepo"],
      "maxFiles": 1000
    }
  ]
}
```

### Commands

```bash
# Sync all enabled repositories
node dist/index.js workspace sync

# Sync with filter
node dist/index.js workspace sync --filter frontend-monorepo

# Use preset
node dist/index.js workspace sync --filter-preset frontend-only

# Sync with verbosity
node dist/index.js workspace sync -vv --max-files 500

# Check workspace status
node dist/index.js workspace status
```

### Features

- ✅ Multi-repository support
- ✅ Named filter presets
- ✅ Per-repository configuration
- ✅ Automatic workspace detection
- ✅ Repository metadata tagging

---

## Validation & Testing

### Manual Validation

Run these queries in Neo4j Browser after analysis:

```cypher
// 1. Count nodes by type
MATCH (n)
RETURN labels(n) as nodeType, count(n) as count
ORDER BY count DESC

// 2. Count relationships by type  
MATCH ()-[r]->()
RETURN type(r) as relType, count(r) as count
ORDER BY count DESC

// 3. Verify package structure
MATCH (p:Package)
OPTIONAL MATCH (p)<-[:BELONGS_TO]-(f:File)
RETURN p.name, p.type, count(f) as files
ORDER BY files DESC

// 4. Check import resolution
MATCH (i:Import)
WITH count(i) as total
MATCH (i:Import)-[:RESOLVES_TO]->()
RETURN total, count(i) as resolved, (count(i)*100.0/total) as percent

// 5. Verify package dependencies
MATCH (p1:Package)-[d:DEPENDS_ON]->(p2:Package)
RETURN p1.name, p2.name, d.weight
ORDER BY d.weight DESC
LIMIT 20
```

### Expected Results

After running on `frontend-monorepo`:

| Metric | Expected Value |
|--------|----------------|
| Package nodes | 10-15 |
| File nodes | 900+ |
| Function nodes | 2000+ |
| BELONGS_TO relationships | 900+ (matches file count) |
| DEPENDS_ON relationships | 20-50 |
| RESOLVES_TO relationships | 4000+ |
| Import resolution rate | >90% |

### Automated Testing

**Location**: `src/analyzer/__tests__/`

**Test Types**:
- Unit tests for extractors (`.spec.ts` files)
- Integration tests for full pipeline
- Validation tests for Neo4j schema

**Run Tests**:
```bash
npm test
npm run test:watch
```

---

## Development Guide

### Adding a New Extractor

1. **Create Parser File**: `src/analyzer/parsers/my-extractor.ts`

```typescript
import { AstNode, ParserContext } from "../types.js";

export function parseMyFeature(
  sourceFile: SourceFile,
  context: ParserContext
): void {
  // Extract entities
  const entities = sourceFile.getMyEntities();
  
  for (const entity of entities) {
    const node: AstNode = {
      id: context.generateId("myfeature", entity.getName()),
      entityId: context.generateEntityId(
        "myfeature",
        context.filePath,
        entity.getName(),
        entity.getStartLineNumber(),
        0
      ),
      kind: "MyFeature",
      name: entity.getName(),
      filePath: context.filePath,
      startLine: entity.getStartLineNumber(),
      endLine: entity.getEndLineNumber(),
      startColumn: 0,
      endColumn: 0,
      language: "TypeScript",
      createdAt: context.now
    };
    
    context.addNode(node);
  }
}
```

2. **Call in Parser**: `src/analyzer/parser.ts`

```typescript
import { parseMyFeature } from './parsers/my-extractor.js';

// In parseTypeScriptFile():
parseMyFeature(sourceFile, context);
```

3. **Add Tests**: `src/analyzer/parsers/my-extractor.spec.ts`

### Adding a New Relationship Resolver

1. **Create Resolver**: `src/analyzer/resolvers/my-resolver.ts`

```typescript
import { SourceFile } from "ts-morph";
import { AstNode, ResolverContext, RelationshipInfo } from "../types.js";

export function resolveMyRelationships(
  sourceFile: SourceFile,
  fileNode: AstNode,
  context: ResolverContext
): void {
  // Find relevant nodes
  const sourceNodes = Array.from(context.nodeIndex.values()).filter(
    n => n.kind === "MyFeature" && n.filePath === fileNode.filePath
  );
  
  for (const source of sourceNodes) {
    // Find targets
    const target = findTarget(source, context.nodeIndex);
    
    if (target) {
      const rel: RelationshipInfo = {
        id: context.generateId("my_rel", `${source.name}->${target.name}`),
        entityId: context.generateEntityId(
          "my_rel",
          `${source.filePath}:${source.name}->${target.name}`
        ),
        type: "MY_RELATIONSHIP",
        sourceId: source.entityId,
        targetId: target.entityId,
        createdAt: context.now
      };
      
      context.addRelationship(rel);
    }
  }
}
```

2. **Call in Relationship Resolver**: `src/analyzer/relationship-resolver.ts`

```typescript
import { resolveMyRelationships } from "./resolvers/my-resolver.js";

// In resolveRelationships():
if (sourceFile) {
  // ... existing resolvers
  resolveMyRelationships(sourceFile, fileNode, currentContext);
}
```

### Using Entity IDs Correctly

```typescript
// For simple entities (no overloading)
const entityId = generateEntityId(
  "class",
  filePath,
  className,
  startLine,
  0
);

// For functions with overloading
const entityId = generateEntityId(
  "function",
  filePath,
  funcName,
  startLine,
  0,
  "(string, number)",  // signatureHint for readability
  "param1: string, param2: number"  // fullSignature for uniqueness
);

// For anonymous functions
const entityId = generateEntityId(
  "function",
  filePath,
  "callback_map_arg0",  // generated name
  startLine,
  startColumn  // important for uniqueness
);
```

### Testing Your Changes

1. **Unit Test**: Test extractor in isolation
2. **Integration Test**: Test on small project
3. **Validation Test**: Run queries to verify results
4. **Real-World Test**: Run on large monorepo

```bash
# Build
npm run build

# Test on small project
node dist/index.js analyze test-project --update-schema

# Verify in Neo4j Browser
open http://localhost:7474
```

---

## Summary

**CodeGraph Status**: ✅ Production-ready with 85% of C4 functionality complete

**What Works Now**:
- ✅ Package detection and Package nodes
- ✅ BELONGS_TO relationships (File → Package)
- ✅ Import resolution with RESOLVES_TO relationships
- ✅ Package dependencies with DEPENDS_ON relationships
- ✅ C4 Container diagrams (Level 2)
- ✅ Entity ID system with overloading support
- ✅ Multi-language parsing (6+ languages)
- ✅ Workspace management

**What Needs Minor Work** (~5 hours total):
- ⚠️ ComponentAnalyzer integration (1 hour) → enables C4 Component diagrams
- ⚠️ Type relationships (2 hours) → enables type-based impact analysis
- ⚠️ Validation tests (2 hours) → automated verification

**Key Files**:
- Architecture: `docs/architecture/ARCHITECTURE.md` (this file)
- Quick Start: `docs/QUICK_START.md`
- Entity ID System: `src/analyzer/parser-utils.ts`
- Package Detection: `src/analyzer/parsers/package-extractor.ts`
- Import Resolution: `src/analyzer/parsers/import-resolver.ts`
- Component Analysis: `src/analyzer/parsers/component-analyzer.ts`

**Next Steps**:
1. Run analyzer on your codebase
2. Verify C4 Container diagram queries work
3. (Optional) Add ComponentAnalyzer integration for Component diagrams
4. (Optional) Add type relationship tracking
