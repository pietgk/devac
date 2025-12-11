# Federated CodeGraph Architecture Specification

**System:** DevAC, CodeGraph, Vision-View-Effects  
**Version:** 1.0  
**Status:** Draft  
**Last Updated:** 2025-01-XX

---

## Executive Summary

This specification defines a federated database architecture for CodeGraph where each package maintains its own PGlite database, aggregated at repository and organization levels. This approach aligns with existing tooling constraints (ts-morph, language-specific analyzers), enables git-based versioning, and eliminates the complexity of maintaining a single global graph database across multiple repositories and packages.

### Core Insight

The unit of code analysis (package/build directory) should match the unit of data storage. This creates natural boundaries that:

- Match how tools like ts-morph operate (single tsconfig context)
- Enable language-specific analysis strategies per package
- Allow git versioning of derived data
- Scale horizontally without central bottlenecks
- Simplify debugging and incremental updates

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  Organization Level (Mindler)                                                           │
│                                                                                         │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │  Central DevAC Hub (~/.devac/)                                                     │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  central.db (PGlite)                                                        │  │ │
│  │  │  - Aggregated nodes from all repos (via COPY FROM blob)                     │  │ │
│  │  │  - Cross-repo edges                                                         │  │ │
│  │  │  - Unified query interface                                                  │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────────┘  │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  registry.json                                                              │  │ │
│  │  │  - Known repos and their locations                                          │  │ │
│  │  │  - Last sync timestamps                                                     │  │ │
│  │  │  - Package → repo mappings                                                  │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                           ▲                                             │
│                                           │ COPY FROM blob                              │
│               ┌───────────────────────────┼───────────────────────────┐                │
│               │                           │                           │                │
│               ▼                           ▼                           ▼                │
│  ┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐  │
│  │  repo-mobile/           │ │  repo-web/              │ │  repo-backend/          │  │
│  │  ├── .devac/            │ │  ├── .devac/            │ │  ├── .devac/            │  │
│  │  │   ├── repo.db        │ │  │   ├── repo.db        │ │  │   ├── repo.db        │  │
│  │  │   └── manifest.json  │ │  │   └── manifest.json  │ │  │   └── manifest.json  │  │
│  │  │                      │ │  │                      │ │  │                      │  │
│  │  ├── packages/          │ │  ├── apps/              │ │  ├── services/          │  │
│  │  │   ├── app/           │ │  │   ├── web/           │ │  │   ├── auth/          │  │
│  │  │   │   └── .devac/    │ │  │   │   └── .devac/    │ │  │   │   └── .devac/    │  │
│  │  │   │       └── pkg.db │ │  │   │       └── pkg.db │ │  │   │       └── pkg.db │  │
│  │  │   │                  │ │  │   │                  │ │  │   │                  │  │
│  │  │   ├── ui/            │ │  │   └── admin/         │ │  │   ├── api/           │  │
│  │  │   │   └── .devac/    │ │  │       └── .devac/    │ │  │   │   └── .devac/    │  │
│  │  │   │       └── pkg.db │ │  │           └── pkg.db │ │  │   │       └── pkg.db │  │
│  │  │   │                  │ │  │                      │ │  │   │                  │  │
│  │  │   └── hooks/         │ │  └── packages/          │ │  │   └── jobs/          │  │
│  │  │       └── .devac/    │ │      └── shared-ui/     │ │  │       └── .devac/    │  │
│  │  │           └── pkg.db │ │          └── .devac/    │ │  │           └── pkg.db │  │
│  │  │                      │ │              └── pkg.db │ │  │                      │  │
│  │  └── package.json       │ │                         │ │  └── package.json       │  │
│  └─────────────────────────┘ └─────────────────────────┘ └─────────────────────────┘  │
│           │                           │                           │                    │
│           └───────────────────────────┼───────────────────────────┘                    │
│                                       │                                                │
│                              COPY FROM blob (per package)                              │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Three-Level Hierarchy

| Level | Location | Contains | Updated By | Consumed By |
|-------|----------|----------|------------|-------------|
| **Package** | `{package}/.devac/pkg.db` | Nodes, edges within package | Package analyzer (ts-morph, etc.) | Repo aggregator, local queries |
| **Repository** | `{repo}/.devac/repo.db` | All package data + cross-package edges | Repo aggregator | Central hub, repo-level queries |
| **Central** | `~/.devac/central.db` | All repo data + cross-repo edges | Central sync | DevAC UI, global queries |

---

## Design Principles

### 1. Locality of Analysis

Each package database is populated by analyzers that operate in that package's context:

```
TypeScript package → ts-morph with local tsconfig.json → pkg.db
Python package    → ast module with local setup.py    → pkg.db
Terraform module  → HCL parser with local .tf files   → pkg.db
```

The analyzer has full access to the package's type system, dependencies, and configuration without needing global context.

### 2. Globally Unique Entity IDs

All entities use deterministic, globally unique IDs that encode their location:

```
{repo}:{package}:{entity_type}:{local_id}

Examples:
  repo-mobile:packages/app:function:useAuth_42
  repo-mobile:packages/app:component:LoginScreen_17
  repo-backend:services/auth:endpoint:POST_/login_3
```

This enables:
- Conflict-free merging at aggregation layers
- Traceable references back to source
- Stable IDs across regeneration (if same source)

### 3. Immutable Package Databases

Package databases are treated as build artifacts:
- Written only by the package analyzer
- Read-only from all other contexts
- Regenerated on source changes (not incrementally updated)
- Can be cached, versioned, or deleted freely

### 4. Aggregation via COPY

Higher levels aggregate lower levels using PostgreSQL's efficient COPY mechanism:

```sql
-- At repo level, aggregate from packages
COPY nodes FROM '/path/to/package/.devac/nodes.blob' WITH (FORMAT binary);

-- At central level, aggregate from repos
COPY nodes FROM '/path/to/repo/.devac/nodes.blob' WITH (FORMAT binary);
```

### 5. Git-Friendly Structure

Package databases live alongside source code and can be:
- Added to `.gitignore` (regenerated locally)
- Committed (shared pre-built graphs)
- Generated in CI (artifact caching)

---

## Package-Level Architecture

### Database Schema

```sql
-- {package}/.devac/pkg.db

-- Package metadata
CREATE TABLE package_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Populated with:
-- { "key": "package_id", "value": "repo-mobile:packages/app" }
-- { "key": "language", "value": "typescript" }
-- { "key": "analyzed_at", "value": "2025-01-15T10:30:00Z" }
-- { "key": "source_hash", "value": "abc123..." }
-- { "key": "analyzer_version", "value": "1.2.0" }

-- Code structure nodes
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,                    -- Globally unique: {repo}:{pkg}:{type}:{local}
  local_id TEXT NOT NULL,                 -- Package-local identifier
  node_type TEXT NOT NULL,                -- function, class, component, effect, etc.
  name TEXT,                              -- Human-readable name
  file_path TEXT NOT NULL,                -- Relative to package root
  start_line INTEGER,
  end_line INTEGER,
  start_column INTEGER,
  end_column INTEGER,
  metadata JSONB DEFAULT '{}',            -- Type info, modifiers, annotations, etc.
  content_hash TEXT,                      -- Hash of source for change detection
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_nodes_type ON nodes(node_type);
CREATE INDEX idx_nodes_file ON nodes(file_path);
CREATE INDEX idx_nodes_name ON nodes(name);
CREATE INDEX idx_nodes_metadata ON nodes USING GIN(metadata);

-- Relationships within the package
CREATE TABLE edges (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,                -- calls, imports, extends, implements, etc.
  metadata JSONB DEFAULT '{}',
  
  UNIQUE(source_id, target_id, edge_type)
);

CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);
CREATE INDEX idx_edges_type ON edges(edge_type);

-- External references (imports from outside this package)
CREATE TABLE external_refs (
  id TEXT PRIMARY KEY,
  local_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL,                 -- 'import', 'type_reference', 'api_call', etc.
  target_package TEXT,                    -- '@mindler/shared-hooks', 'react', etc.
  target_symbol TEXT,                     -- 'useAuth', 'useState', etc.
  target_path TEXT,                       -- Import path as written
  is_internal BOOLEAN DEFAULT false,      -- true if target is another internal package
  resolved_target_id TEXT,                -- Filled in by aggregator if resolvable
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_external_refs_node ON external_refs(local_node_id);
CREATE INDEX idx_external_refs_package ON external_refs(target_package);
CREATE INDEX idx_external_refs_internal ON external_refs(is_internal) WHERE is_internal = true;

-- Exports from this package
CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  exported_name TEXT NOT NULL,            -- Name as exported (may differ from internal name)
  export_type TEXT NOT NULL,              -- 'named', 'default', 're-export'
  is_type_only BOOLEAN DEFAULT false,     -- TypeScript type-only export
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_exports_name ON exports(exported_name);
CREATE INDEX idx_exports_node ON exports(node_id);

-- Vision-View-Effects: State definitions
CREATE TABLE states (
  id TEXT PRIMARY KEY,
  node_id TEXT REFERENCES nodes(id),      -- Link to defining node if applicable
  state_name TEXT NOT NULL,
  state_type TEXT,                        -- TypeScript type as string
  initial_value JSONB,
  metadata JSONB DEFAULT '{}'
);

-- Vision-View-Effects: Effect definitions
CREATE TABLE effects (
  id TEXT PRIMARY KEY,
  node_id TEXT REFERENCES nodes(id),
  effect_name TEXT NOT NULL,
  trigger_type TEXT,                      -- 'user_action', 'state_change', 'lifecycle', etc.
  is_async BOOLEAN DEFAULT false,
  state_reads TEXT[],                     -- State IDs this effect reads
  state_writes TEXT[],                    -- State IDs this effect writes
  external_calls TEXT[],                  -- External ref IDs for API calls, etc.
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_effects_trigger ON effects(trigger_type);

-- Vision-View-Effects: View definitions
CREATE TABLE views (
  id TEXT PRIMARY KEY,
  node_id TEXT REFERENCES nodes(id),
  view_name TEXT NOT NULL,
  view_type TEXT,                         -- 'component', 'page', 'layout', etc.
  state_subscriptions TEXT[],             -- State IDs this view renders
  effect_triggers TEXT[],                 -- Effect IDs this view can trigger
  child_views TEXT[],                     -- Nested view IDs
  metadata JSONB DEFAULT '{}'
);
```

### Analyzer Interface

Each language/framework has an analyzer that implements a common interface:

```typescript
// packages/devac-analyzers/src/types.ts

interface PackageAnalyzer {
  /** Unique identifier for this analyzer */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** File patterns this analyzer handles */
  filePatterns: string[];
  
  /** Check if this analyzer can handle a package */
  canAnalyze(packagePath: string): Promise<boolean>;
  
  /** Analyze the package and populate the database */
  analyze(context: AnalysisContext): Promise<AnalysisResult>;
}

interface AnalysisContext {
  /** Absolute path to package root */
  packagePath: string;
  
  /** Package identifier (e.g., 'repo-mobile:packages/app') */
  packageId: string;
  
  /** PGlite database instance (empty, schema applied) */
  db: PGlite;
  
  /** Previous analysis metadata (for incremental optimization) */
  previousMeta?: PackageMeta;
  
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  
  /** Progress callback */
  onProgress?: (progress: AnalysisProgress) => void;
}

interface AnalysisResult {
  /** Number of nodes created */
  nodeCount: number;
  
  /** Number of edges created */
  edgeCount: number;
  
  /** Number of external references found */
  externalRefCount: number;
  
  /** Errors encountered (non-fatal) */
  warnings: AnalysisWarning[];
  
  /** Hash of analyzed content (for cache invalidation) */
  contentHash: string;
}
```

### TypeScript Analyzer Implementation

```typescript
// packages/devac-analyzers/src/typescript/analyzer.ts

import { Project, SourceFile, Node, SyntaxKind } from 'ts-morph';
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'crypto';

export class TypeScriptAnalyzer implements PackageAnalyzer {
  id = 'typescript';
  name = 'TypeScript/JavaScript Analyzer';
  filePatterns = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'];

  async canAnalyze(packagePath: string): Promise<boolean> {
    const hasTsConfig = await fileExists(join(packagePath, 'tsconfig.json'));
    const hasPackageJson = await fileExists(join(packagePath, 'package.json'));
    return hasTsConfig || hasPackageJson;
  }

  async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    const { packagePath, packageId, db, onProgress } = context;
    
    // Initialize ts-morph with the package's tsconfig
    // This gives us full type information within the package context
    const project = new Project({
      tsConfigFilePath: join(packagePath, 'tsconfig.json'),
      skipAddingFilesFromTsConfig: false,
    });

    const sourceFiles = project.getSourceFiles();
    const result: AnalysisResult = {
      nodeCount: 0,
      edgeCount: 0,
      externalRefCount: 0,
      warnings: [],
      contentHash: '',
    };

    const contentParts: string[] = [];

    for (let i = 0; i < sourceFiles.length; i++) {
      const sourceFile = sourceFiles[i];
      const relativePath = relative(packagePath, sourceFile.getFilePath());
      
      onProgress?.({
        phase: 'analyzing',
        current: i + 1,
        total: sourceFiles.length,
        currentFile: relativePath,
      });

      contentParts.push(sourceFile.getFullText());

      // Extract nodes
      await this.extractFunctions(db, packageId, sourceFile, relativePath);
      await this.extractClasses(db, packageId, sourceFile, relativePath);
      await this.extractComponents(db, packageId, sourceFile, relativePath);
      await this.extractImports(db, packageId, sourceFile, relativePath);
      await this.extractExports(db, packageId, sourceFile, relativePath);
      
      // Extract Vision-View-Effects patterns
      await this.extractEffects(db, packageId, sourceFile, relativePath);
      await this.extractStateDefinitions(db, packageId, sourceFile, relativePath);
    }

    // Build intra-package edges (calls, references, etc.)
    onProgress?.({ phase: 'building-edges', current: 0, total: 1 });
    await this.buildEdges(db, project, packageId);

    // Calculate content hash
    result.contentHash = createHash('sha256')
      .update(contentParts.join('\n'))
      .digest('hex');

    // Get counts
    const [{ count: nodeCount }] = (await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM nodes'
    )).rows;
    const [{ count: edgeCount }] = (await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM edges'
    )).rows;
    const [{ count: externalRefCount }] = (await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM external_refs'
    )).rows;

    result.nodeCount = nodeCount;
    result.edgeCount = edgeCount;
    result.externalRefCount = externalRefCount;

    // Store metadata
    await db.query(`
      INSERT INTO package_meta (key, value) VALUES
        ('package_id', $1),
        ('language', '"typescript"'),
        ('analyzed_at', $2),
        ('source_hash', $3),
        ('analyzer_version', '"1.0.0"')
    `, [
      JSON.stringify(packageId),
      JSON.stringify(new Date().toISOString()),
      JSON.stringify(result.contentHash),
    ]);

    return result;
  }

  private async extractFunctions(
    db: PGlite,
    packageId: string,
    sourceFile: SourceFile,
    relativePath: string
  ): Promise<void> {
    const functions = sourceFile.getFunctions();
    
    for (const fn of functions) {
      const name = fn.getName() || 'anonymous';
      const localId = `fn_${name}_${fn.getStartLineNumber()}`;
      const globalId = `${packageId}:function:${localId}`;
      
      await db.query(`
        INSERT INTO nodes (id, local_id, node_type, name, file_path, start_line, end_line, metadata)
        VALUES ($1, $2, 'function', $3, $4, $5, $6, $7)
      `, [
        globalId,
        localId,
        name,
        relativePath,
        fn.getStartLineNumber(),
        fn.getEndLineNumber(),
        JSON.stringify({
          isAsync: fn.isAsync(),
          isExported: fn.isExported(),
          isGenerator: fn.isGenerator(),
          parameters: fn.getParameters().map(p => ({
            name: p.getName(),
            type: p.getType().getText(),
          })),
          returnType: fn.getReturnType().getText(),
        }),
      ]);
    }
  }

  private async extractComponents(
    db: PGlite,
    packageId: string,
    sourceFile: SourceFile,
    relativePath: string
  ): Promise<void> {
    // Find React components (functions returning JSX or using hooks)
    const functions = [
      ...sourceFile.getFunctions(),
      ...sourceFile.getVariableDeclarations()
        .filter(v => v.getInitializer()?.getKind() === SyntaxKind.ArrowFunction)
    ];

    for (const fn of functions) {
      if (!this.isReactComponent(fn)) continue;
      
      const name = fn.getName() || 'AnonymousComponent';
      const localId = `component_${name}_${fn.getStartLineNumber()}`;
      const globalId = `${packageId}:component:${localId}`;
      
      // Extract hooks usage for Vision-View-Effects
      const hooks = this.extractHooksUsage(fn);
      const effects = this.extractEffectCalls(fn);
      
      await db.query(`
        INSERT INTO nodes (id, local_id, node_type, name, file_path, start_line, end_line, metadata)
        VALUES ($1, $2, 'component', $3, $4, $5, $6, $7)
      `, [
        globalId,
        localId,
        name,
        relativePath,
        fn.getStartLineNumber(),
        fn.getEndLineNumber(),
        JSON.stringify({
          hooks,
          effects,
          isExported: this.isExported(fn),
          props: this.extractProps(fn),
        }),
      ]);

      // Create view record for Vision-View-Effects
      await db.query(`
        INSERT INTO views (id, node_id, view_name, view_type, state_subscriptions, effect_triggers, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        `${globalId}:view`,
        globalId,
        name,
        'component',
        hooks.filter(h => h.type === 'state').map(h => h.stateId),
        effects.map(e => e.effectId),
        JSON.stringify({ hooks, effects }),
      ]);
    }
  }

  private async extractImports(
    db: PGlite,
    packageId: string,
    sourceFile: SourceFile,
    relativePath: string
  ): Promise<void> {
    const imports = sourceFile.getImportDeclarations();
    
    for (const imp of imports) {
      const moduleSpecifier = imp.getModuleSpecifierValue();
      const isInternal = this.isInternalImport(moduleSpecifier);
      
      for (const named of imp.getNamedImports()) {
        const localId = `import_${named.getName()}_${imp.getStartLineNumber()}`;
        const globalId = `${packageId}:import:${localId}`;
        
        // Create node for the import
        await db.query(`
          INSERT INTO nodes (id, local_id, node_type, name, file_path, start_line, end_line, metadata)
          VALUES ($1, $2, 'import', $3, $4, $5, $6, $7)
        `, [
          globalId,
          localId,
          named.getName(),
          relativePath,
          imp.getStartLineNumber(),
          imp.getEndLineNumber(),
          JSON.stringify({
            alias: named.getAliasNode()?.getText(),
            isTypeOnly: named.isTypeOnly() || imp.isTypeOnly(),
            moduleSpecifier,
          }),
        ]);

        // Create external reference
        await db.query(`
          INSERT INTO external_refs (id, local_node_id, ref_type, target_package, target_symbol, target_path, is_internal, metadata)
          VALUES ($1, $2, 'import', $3, $4, $5, $6, $7)
        `, [
          `${globalId}:ref`,
          globalId,
          this.resolvePackageName(moduleSpecifier),
          named.getName(),
          moduleSpecifier,
          isInternal,
          JSON.stringify({}),
        ]);
      }

      // Handle default import
      const defaultImport = imp.getDefaultImport();
      if (defaultImport) {
        const localId = `import_default_${defaultImport.getText()}_${imp.getStartLineNumber()}`;
        const globalId = `${packageId}:import:${localId}`;
        
        await db.query(`
          INSERT INTO nodes (id, local_id, node_type, name, file_path, start_line, end_line, metadata)
          VALUES ($1, $2, 'import', $3, $4, $5, $6, $7)
        `, [
          globalId,
          localId,
          defaultImport.getText(),
          relativePath,
          imp.getStartLineNumber(),
          imp.getEndLineNumber(),
          JSON.stringify({
            isDefault: true,
            moduleSpecifier,
          }),
        ]);

        await db.query(`
          INSERT INTO external_refs (id, local_node_id, ref_type, target_package, target_symbol, target_path, is_internal, metadata)
          VALUES ($1, $2, 'import', $3, 'default', $4, $5, $6)
        `, [
          `${globalId}:ref`,
          globalId,
          this.resolvePackageName(moduleSpecifier),
          moduleSpecifier,
          isInternal,
          JSON.stringify({}),
        ]);
      }
    }
  }

  private async extractExports(
    db: PGlite,
    packageId: string,
    sourceFile: SourceFile,
    relativePath: string
  ): Promise<void> {
    // Named exports
    for (const exp of sourceFile.getExportedDeclarations()) {
      const [exportName, declarations] = exp;
      
      for (const decl of declarations) {
        const nodeType = this.getNodeType(decl);
        const localId = `${nodeType}_${exportName}_${decl.getStartLineNumber()}`;
        const nodeGlobalId = `${packageId}:${nodeType}:${localId}`;
        
        await db.query(`
          INSERT INTO exports (id, node_id, exported_name, export_type, is_type_only, metadata)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO NOTHING
        `, [
          `${nodeGlobalId}:export`,
          nodeGlobalId,
          exportName,
          this.getExportType(decl),
          this.isTypeOnlyExport(decl),
          JSON.stringify({}),
        ]);
      }
    }
  }

  private async buildEdges(
    db: PGlite,
    project: Project,
    packageId: string
  ): Promise<void> {
    // Use ts-morph's findReferences to build call graph
    const allNodes = (await db.query<{ id: string; metadata: any }>(
      `SELECT id, metadata FROM nodes WHERE node_type IN ('function', 'component', 'class')`
    )).rows;

    for (const node of allNodes) {
      // Find all references to this node within the package
      // Build 'calls', 'instantiates', 'references' edges
      // (Implementation depends on ts-morph reference finding)
    }
  }

  // ... additional helper methods
}
```

---

## Repository-Level Architecture

### Database Schema

```sql
-- {repo}/.devac/repo.db

-- Repository metadata
CREATE TABLE repo_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Aggregated nodes from all packages (populated via COPY FROM)
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,               -- Source package
  local_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  name TEXT,
  file_path TEXT NOT NULL,                -- Relative to repo root
  start_line INTEGER,
  end_line INTEGER,
  start_column INTEGER,
  end_column INTEGER,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_nodes_package ON nodes(package_id);
CREATE INDEX idx_nodes_type ON nodes(node_type);
CREATE INDEX idx_nodes_file ON nodes(file_path);
CREATE INDEX idx_nodes_name ON nodes(name);
CREATE INDEX idx_nodes_metadata ON nodes USING GIN(metadata);

-- Aggregated edges from all packages
CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_edges_package ON edges(package_id);
CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);

-- Cross-package edges (resolved from external_refs)
CREATE TABLE cross_package_edges (
  id TEXT PRIMARY KEY,
  source_package_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_package_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_cross_pkg_source ON cross_package_edges(source_package_id, source_node_id);
CREATE INDEX idx_cross_pkg_target ON cross_package_edges(target_package_id, target_node_id);

-- Aggregated exports (for cross-package resolution)
CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  exported_name TEXT NOT NULL,
  export_type TEXT NOT NULL,
  is_type_only BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_exports_package ON exports(package_id);
CREATE INDEX idx_exports_name ON exports(exported_name);

-- External references (unresolved, pointing outside repo)
CREATE TABLE external_refs (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  local_node_id TEXT NOT NULL,
  ref_type TEXT NOT NULL,
  target_package TEXT,
  target_symbol TEXT,
  is_internal BOOLEAN DEFAULT false,
  resolved_target_id TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_ext_refs_package ON external_refs(target_package);

-- Package registry
CREATE TABLE packages (
  id TEXT PRIMARY KEY,                    -- e.g., 'repo-mobile:packages/app'
  name TEXT NOT NULL,                     -- e.g., '@mindler/mobile-app'
  path TEXT NOT NULL,                     -- Relative path in repo
  language TEXT,
  node_count INTEGER DEFAULT 0,
  edge_count INTEGER DEFAULT 0,
  last_analyzed TIMESTAMPTZ,
  content_hash TEXT
);

-- Aggregated Vision-View-Effects tables
CREATE TABLE states (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  node_id TEXT,
  state_name TEXT NOT NULL,
  state_type TEXT,
  initial_value JSONB,
  metadata JSONB DEFAULT '{}'
);

CREATE TABLE effects (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  node_id TEXT,
  effect_name TEXT NOT NULL,
  trigger_type TEXT,
  is_async BOOLEAN DEFAULT false,
  state_reads TEXT[],
  state_writes TEXT[],
  external_calls TEXT[],
  metadata JSONB DEFAULT '{}'
);

CREATE TABLE views (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  node_id TEXT,
  view_name TEXT NOT NULL,
  view_type TEXT,
  state_subscriptions TEXT[],
  effect_triggers TEXT[],
  child_views TEXT[],
  metadata JSONB DEFAULT '{}'
);
```

### Aggregation Process

```typescript
// packages/devac-aggregator/src/repo-aggregator.ts

import { PGlite } from '@electric-sql/pglite';
import { glob } from 'glob';
import { join, relative } from 'path';

export class RepoAggregator {
  private repoPath: string;
  private repoId: string;
  private repoDb: PGlite;

  constructor(repoPath: string, repoId: string) {
    this.repoPath = repoPath;
    this.repoId = repoId;
  }

  async initialize(): Promise<void> {
    const dbPath = join(this.repoPath, '.devac', 'repo.db');
    this.repoDb = await PGlite.create({ dataDir: dbPath });
    await this.applySchema();
  }

  async aggregate(): Promise<AggregationResult> {
    // Find all package databases
    const packageDbs = await glob('**/.devac/pkg.db', {
      cwd: this.repoPath,
      ignore: ['node_modules/**', '.devac/**'],
    });

    console.log(`Found ${packageDbs.length} packages to aggregate`);

    // Clear existing aggregated data
    await this.repoDb.exec(`
      TRUNCATE nodes, edges, exports, external_refs, packages, 
               cross_package_edges, states, effects, views CASCADE
    `);

    // Process each package
    for (const pkgDbPath of packageDbs) {
      const packagePath = join(this.repoPath, pkgDbPath.replace('/.devac/pkg.db', ''));
      const packageId = `${this.repoId}:${relative(this.repoPath, packagePath)}`;
      
      await this.aggregatePackage(packageId, join(this.repoPath, pkgDbPath));
    }

    // Resolve cross-package edges
    await this.resolveCrossPackageEdges();

    // Update metadata
    await this.updateMetadata();

    return this.getAggregationResult();
  }

  private async aggregatePackage(packageId: string, pkgDbPath: string): Promise<void> {
    const pkgDb = await PGlite.create({ dataDir: pkgDbPath });

    try {
      // Export nodes to blob
      const nodesBlob = await pkgDb.query(`
        COPY (
          SELECT 
            id,
            $1 as package_id,
            local_id,
            node_type,
            name,
            file_path,
            start_line,
            end_line,
            start_column,
            end_column,
            metadata
          FROM nodes
        ) TO STDOUT WITH (FORMAT binary)
      `, [packageId]);

      // Import into repo database
      await this.repoDb.query(`
        COPY nodes (id, package_id, local_id, node_type, name, file_path, 
                    start_line, end_line, start_column, end_column, metadata)
        FROM STDIN WITH (FORMAT binary)
      `, [], { stdin: nodesBlob });

      // Similarly for edges, exports, external_refs, states, effects, views...
      await this.copyTable(pkgDb, 'edges', packageId);
      await this.copyTable(pkgDb, 'exports', packageId);
      await this.copyTable(pkgDb, 'external_refs', packageId);
      await this.copyTable(pkgDb, 'states', packageId);
      await this.copyTable(pkgDb, 'effects', packageId);
      await this.copyTable(pkgDb, 'views', packageId);

      // Register package
      const meta = await this.getPackageMeta(pkgDb);
      await this.repoDb.query(`
        INSERT INTO packages (id, name, path, language, node_count, edge_count, last_analyzed, content_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        packageId,
        meta.name,
        meta.path,
        meta.language,
        meta.nodeCount,
        meta.edgeCount,
        meta.analyzedAt,
        meta.contentHash,
      ]);

    } finally {
      await pkgDb.close();
    }
  }

  private async resolveCrossPackageEdges(): Promise<void> {
    // Build export lookup: package:symbol → node_id
    const exports = await this.repoDb.query<{
      package_id: string;
      node_id: string;
      exported_name: string;
    }>(`SELECT package_id, node_id, exported_name FROM exports`);

    const exportLookup = new Map<string, string>();
    for (const exp of exports.rows) {
      // Map by package name + symbol
      const packageName = await this.getPackageName(exp.package_id);
      exportLookup.set(`${packageName}:${exp.exported_name}`, exp.node_id);
      exportLookup.set(`${packageName}:default`, exp.node_id); // for default exports
    }

    // Resolve internal external_refs
    const internalRefs = await this.repoDb.query<{
      id: string;
      package_id: string;
      local_node_id: string;
      target_package: string;
      target_symbol: string;
    }>(`
      SELECT id, package_id, local_node_id, target_package, target_symbol 
      FROM external_refs 
      WHERE is_internal = true AND resolved_target_id IS NULL
    `);

    for (const ref of internalRefs.rows) {
      const lookupKey = `${ref.target_package}:${ref.target_symbol}`;
      const targetNodeId = exportLookup.get(lookupKey);

      if (targetNodeId) {
        // Update the external_ref with resolved target
        await this.repoDb.query(`
          UPDATE external_refs SET resolved_target_id = $1 WHERE id = $2
        `, [targetNodeId, ref.id]);

        // Create cross-package edge
        const targetPackageId = await this.getPackageIdByName(ref.target_package);
        await this.repoDb.query(`
          INSERT INTO cross_package_edges 
            (id, source_package_id, source_node_id, target_package_id, target_node_id, edge_type, metadata)
          VALUES ($1, $2, $3, $4, $5, 'imports', '{}')
        `, [
          `${ref.id}:edge`,
          ref.package_id,
          ref.local_node_id,
          targetPackageId,
          targetNodeId,
        ]);
      }
    }
  }

  // ... helper methods
}
```

### Manifest File

```json
// {repo}/.devac/manifest.json
{
  "version": "1.0.0",
  "repoId": "repo-mobile",
  "lastAggregated": "2025-01-15T10:30:00Z",
  "packages": [
    {
      "id": "repo-mobile:packages/app",
      "name": "@mindler/mobile-app",
      "path": "packages/app",
      "language": "typescript",
      "nodeCount": 1247,
      "edgeCount": 3891,
      "contentHash": "abc123...",
      "lastAnalyzed": "2025-01-15T10:28:00Z"
    },
    {
      "id": "repo-mobile:packages/ui",
      "name": "@mindler/mobile-ui",
      "path": "packages/ui",
      "language": "typescript",
      "nodeCount": 892,
      "edgeCount": 2134,
      "contentHash": "def456...",
      "lastAnalyzed": "2025-01-15T10:29:00Z"
    }
  ],
  "crossPackageEdges": 347,
  "unresolvedExternalRefs": 89
}
```

---

## Central Hub Architecture

### Database Schema

```sql
-- ~/.devac/central.db

-- Central metadata
CREATE TABLE central_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Repository registry
CREATE TABLE repositories (
  id TEXT PRIMARY KEY,                    -- e.g., 'repo-mobile'
  name TEXT NOT NULL,                     -- Human-readable name
  path TEXT NOT NULL,                     -- Absolute path on filesystem
  remote_url TEXT,                        -- Git remote URL
  last_synced TIMESTAMPTZ,
  node_count INTEGER DEFAULT 0,
  edge_count INTEGER DEFAULT 0,
  package_count INTEGER DEFAULT 0
);

-- Aggregated nodes from all repositories
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  local_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  name TEXT,
  file_path TEXT NOT NULL,                -- Full path: repo/package/file
  start_line INTEGER,
  end_line INTEGER,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_nodes_repo ON nodes(repo_id);
CREATE INDEX idx_nodes_package ON nodes(package_id);
CREATE INDEX idx_nodes_type ON nodes(node_type);
CREATE INDEX idx_nodes_name ON nodes(name);
CREATE INDEX idx_nodes_metadata ON nodes USING GIN(metadata);

-- Aggregated edges (intra-package + cross-package)
CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  is_cross_package BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_edges_repo ON edges(repo_id);
CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);
CREATE INDEX idx_edges_cross ON edges(is_cross_package) WHERE is_cross_package = true;

-- Cross-repository edges
CREATE TABLE cross_repo_edges (
  id TEXT PRIMARY KEY,
  source_repo_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_repo_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  confidence FLOAT DEFAULT 1.0,           -- For inferred edges
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_cross_repo_source ON cross_repo_edges(source_repo_id, source_node_id);
CREATE INDEX idx_cross_repo_target ON cross_repo_edges(target_repo_id, target_node_id);

-- Unified exports across all repos
CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  exported_name TEXT NOT NULL,
  npm_package_name TEXT,                  -- e.g., '@mindler/shared-hooks'
  export_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_exports_npm ON exports(npm_package_name);
CREATE INDEX idx_exports_name ON exports(exported_name);

-- Unresolved external references (pointing to external packages)
CREATE TABLE unresolved_refs (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  target_package TEXT NOT NULL,           -- npm package name
  target_symbol TEXT,
  ref_count INTEGER DEFAULT 1,            -- How many times referenced
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_unresolved_package ON unresolved_refs(target_package);

-- Vision-View-Effects: Cross-repo state flow
CREATE TABLE state_flow (
  id TEXT PRIMARY KEY,
  source_view_id TEXT NOT NULL,
  target_effect_id TEXT NOT NULL,
  state_id TEXT NOT NULL,
  flow_type TEXT NOT NULL,                -- 'read', 'write', 'subscribe'
  crosses_repo BOOLEAN DEFAULT false,
  crosses_package BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'
);
```

### Sync Process

```typescript
// packages/devac-hub/src/central-sync.ts

import { PGlite } from '@electric-sql/pglite';
import { watch } from 'chokidar';

export class CentralHub {
  private centralDb: PGlite;
  private registeredRepos: Map<string, RepoRegistration> = new Map();
  private watcher?: FSWatcher;

  async initialize(): Promise<void> {
    const dbPath = join(homedir(), '.devac', 'central.db');
    this.centralDb = await PGlite.create({ dataDir: dbPath });
    await this.applySchema();
    await this.loadRegistry();
  }

  async registerRepository(repoPath: string, repoId?: string): Promise<void> {
    const id = repoId || basename(repoPath);
    const manifestPath = join(repoPath, '.devac', 'manifest.json');
    
    if (!await fileExists(manifestPath)) {
      throw new Error(`No manifest found at ${manifestPath}. Run 'devac analyze' first.`);
    }

    this.registeredRepos.set(id, {
      id,
      path: repoPath,
      dbPath: join(repoPath, '.devac', 'repo.db'),
      manifestPath,
    });

    await this.centralDb.query(`
      INSERT INTO repositories (id, name, path, last_synced)
      VALUES ($1, $2, $3, NULL)
      ON CONFLICT (id) DO UPDATE SET path = $3
    `, [id, id, repoPath]);

    // Initial sync
    await this.syncRepository(id);
  }

  async syncRepository(repoId: string): Promise<SyncResult> {
    const repo = this.registeredRepos.get(repoId);
    if (!repo) throw new Error(`Unknown repository: ${repoId}`);

    console.log(`Syncing repository: ${repoId}`);

    const repoDb = await PGlite.create({ dataDir: repo.dbPath });

    try {
      // Clear existing data for this repo
      await this.centralDb.exec(`
        DELETE FROM nodes WHERE repo_id = '${repoId}';
        DELETE FROM edges WHERE repo_id = '${repoId}';
        DELETE FROM exports WHERE repo_id = '${repoId}';
        DELETE FROM cross_repo_edges WHERE source_repo_id = '${repoId}' OR target_repo_id = '${repoId}';
      `);

      // Use COPY TO/FROM for efficient bulk transfer
      await this.bulkCopyNodes(repoDb, repoId);
      await this.bulkCopyEdges(repoDb, repoId);
      await this.bulkCopyExports(repoDb, repoId);

      // Resolve cross-repo edges
      await this.resolveCrossRepoEdges(repoId);

      // Update repository metadata
      const stats = await this.getRepoStats(repoId);
      await this.centralDb.query(`
        UPDATE repositories 
        SET last_synced = NOW(),
            node_count = $1,
            edge_count = $2,
            package_count = $3
        WHERE id = $4
      `, [stats.nodeCount, stats.edgeCount, stats.packageCount, repoId]);

      return stats;

    } finally {
      await repoDb.close();
    }
  }

  private async bulkCopyNodes(repoDb: PGlite, repoId: string): Promise<void> {
    // Export from repo.db
    const blob = await repoDb.query(`
      COPY (
        SELECT 
          id,
          '${repoId}' as repo_id,
          package_id,
          local_id,
          node_type,
          name,
          file_path,
          start_line,
          end_line,
          metadata
        FROM nodes
      ) TO STDOUT WITH (FORMAT binary)
    `);

    // Import into central.db
    await this.centralDb.query(`
      COPY nodes (id, repo_id, package_id, local_id, node_type, name, 
                  file_path, start_line, end_line, metadata)
      FROM STDIN WITH (FORMAT binary)
    `, [], { stdin: blob });
  }

  private async resolveCrossRepoEdges(repoId: string): Promise<void> {
    // Get unresolved internal references from this repo
    const unresolvedRefs = await this.centralDb.query<{
      id: string;
      package_id: string;
      node_id: string;
      target_package: string;
      target_symbol: string;
    }>(`
      SELECT ur.* FROM unresolved_refs ur
      WHERE ur.repo_id = $1
        AND ur.target_package LIKE '@mindler/%'
    `, [repoId]);

    // Build export index across all repos
    const exports = await this.centralDb.query<{
      repo_id: string;
      node_id: string;
      npm_package_name: string;
      exported_name: string;
    }>(`
      SELECT repo_id, node_id, npm_package_name, exported_name
      FROM exports
      WHERE npm_package_name IS NOT NULL
    `);

    const exportIndex = new Map<string, { repoId: string; nodeId: string }>();
    for (const exp of exports.rows) {
      exportIndex.set(`${exp.npm_package_name}:${exp.exported_name}`, {
        repoId: exp.repo_id,
        nodeId: exp.node_id,
      });
    }

    // Create cross-repo edges
    for (const ref of unresolvedRefs.rows) {
      const key = `${ref.target_package}:${ref.target_symbol}`;
      const target = exportIndex.get(key);

      if (target && target.repoId !== repoId) {
        await this.centralDb.query(`
          INSERT INTO cross_repo_edges 
            (id, source_repo_id, source_node_id, target_repo_id, target_node_id, edge_type)
          VALUES ($1, $2, $3, $4, $5, 'imports')
          ON CONFLICT (id) DO NOTHING
        `, [
          `cross:${ref.id}`,
          repoId,
          ref.node_id,
          target.repoId,
          target.nodeId,
        ]);
      }
    }
  }

  async startWatching(): Promise<void> {
    const repoPaths = Array.from(this.registeredRepos.values())
      .map(r => join(r.path, '.devac', 'repo.db'));

    this.watcher = watch(repoPaths, {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('change', async (changedPath) => {
      const repo = Array.from(this.registeredRepos.values())
        .find(r => changedPath.startsWith(r.path));
      
      if (repo) {
        console.log(`Detected change in ${repo.id}, syncing...`);
        await this.syncRepository(repo.id);
      }
    });
  }

  // Query interface
  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.centralDb.query<T>(sql, params);
    return result.rows;
  }
}
```

---

## Query Interface

### Unified Query API

```typescript
// packages/devac-query/src/query-engine.ts

export class CodeGraphQuery {
  constructor(
    private hub: CentralHub,
    private options?: QueryOptions
  ) {}

  /**
   * Find all nodes matching criteria
   */
  async findNodes(criteria: NodeCriteria): Promise<CodeNode[]> {
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (criteria.type) {
      conditions.push(`node_type = $${paramIndex++}`);
      params.push(criteria.type);
    }
    if (criteria.name) {
      conditions.push(`name ILIKE $${paramIndex++}`);
      params.push(`%${criteria.name}%`);
    }
    if (criteria.repo) {
      conditions.push(`repo_id = $${paramIndex++}`);
      params.push(criteria.repo);
    }
    if (criteria.package) {
      conditions.push(`package_id = $${paramIndex++}`);
      params.push(criteria.package);
    }

    return this.hub.query<CodeNode>(`
      SELECT * FROM nodes WHERE ${conditions.join(' AND ')}
      ORDER BY repo_id, package_id, file_path
      LIMIT $${paramIndex}
    `, [...params, criteria.limit || 100]);
  }

  /**
   * Traverse the graph from a starting node
   */
  async traverse(startNodeId: string, options: TraversalOptions): Promise<TraversalResult> {
    const { direction = 'outbound', maxDepth = 5, edgeTypes } = options;

    const edgeFilter = edgeTypes 
      ? `AND edge_type = ANY($3)` 
      : '';

    const result = await this.hub.query<TraversalRow>(`
      WITH RECURSIVE traversal AS (
        -- Base case: starting node
        SELECT 
          n.id,
          n.repo_id,
          n.package_id,
          n.node_type,
          n.name,
          n.metadata,
          0 as depth,
          ARRAY[n.id] as path
        FROM nodes n
        WHERE n.id = $1

        UNION ALL

        -- Recursive case: follow edges
        SELECT 
          n.id,
          n.repo_id,
          n.package_id,
          n.node_type,
          n.name,
          n.metadata,
          t.depth + 1,
          t.path || n.id
        FROM nodes n
        JOIN (
          -- Combine intra-repo edges and cross-repo edges
          SELECT source_id, target_id, edge_type FROM edges
          UNION ALL
          SELECT source_node_id, target_node_id, edge_type FROM cross_repo_edges
        ) e ON ${direction === 'outbound' ? 'e.source_id = t.id AND e.target_id = n.id' : 'e.target_id = t.id AND e.source_id = n.id'}
        JOIN traversal t ON true
        WHERE t.depth < $2
          AND NOT n.id = ANY(t.path)  -- Prevent cycles
          ${edgeFilter}
      )
      SELECT DISTINCT ON (id) * FROM traversal ORDER BY id, depth
    `, edgeTypes ? [startNodeId, maxDepth, edgeTypes] : [startNodeId, maxDepth]);

    return this.buildTraversalResult(result);
  }

  /**
   * Find all effects triggered by a view (Vision-View-Effects)
   */
  async findEffectsFromView(viewNodeId: string): Promise<EffectChain[]> {
    return this.hub.query<EffectChain>(`
      WITH RECURSIVE effect_chain AS (
        -- Direct effects from the view
        SELECT 
          e.id,
          e.effect_name,
          e.trigger_type,
          e.is_async,
          e.state_reads,
          e.state_writes,
          v.id as triggered_by,
          1 as depth,
          ARRAY[e.id] as chain_path
        FROM views v
        JOIN effects e ON e.id = ANY(v.effect_triggers)
        WHERE v.node_id = $1

        UNION ALL

        -- Effects triggered by state changes
        SELECT 
          e2.id,
          e2.effect_name,
          e2.trigger_type,
          e2.is_async,
          e2.state_reads,
          e2.state_writes,
          ec.id as triggered_by,
          ec.depth + 1,
          ec.chain_path || e2.id
        FROM effect_chain ec
        JOIN effects e2 ON e2.state_reads && ec.state_writes  -- Array overlap
        WHERE NOT e2.id = ANY(ec.chain_path)
          AND ec.depth < 10
      )
      SELECT * FROM effect_chain ORDER BY depth, effect_name
    `, [viewNodeId]);
  }

  /**
   * Analyze cross-boundary dependencies
   */
  async analyzeDependencies(options: DependencyAnalysisOptions): Promise<DependencyReport> {
    const { scope = 'all', groupBy = 'package' } = options;

    // Cross-package dependencies
    const crossPackage = await this.hub.query<DependencyEdge>(`
      SELECT 
        source_package_id as source,
        target_package_id as target,
        COUNT(*) as edge_count,
        array_agg(DISTINCT edge_type) as edge_types
      FROM cross_package_edges
      GROUP BY source_package_id, target_package_id
      ORDER BY edge_count DESC
    `);

    // Cross-repo dependencies
    const crossRepo = await this.hub.query<DependencyEdge>(`
      SELECT 
        source_repo_id as source,
        target_repo_id as target,
        COUNT(*) as edge_count,
        array_agg(DISTINCT edge_type) as edge_types
      FROM cross_repo_edges
      GROUP BY source_repo_id, target_repo_id
      ORDER BY edge_count DESC
    `);

    // External dependencies
    const external = await this.hub.query<ExternalDependency>(`
      SELECT 
        target_package,
        COUNT(*) as usage_count,
        COUNT(DISTINCT repo_id) as repo_count,
        COUNT(DISTINCT package_id) as package_count
      FROM unresolved_refs
      WHERE target_package NOT LIKE '@mindler/%'
      GROUP BY target_package
      ORDER BY usage_count DESC
      LIMIT 50
    `);

    return {
      crossPackage,
      crossRepo,
      external,
      summary: {
        totalCrossPackageEdges: crossPackage.reduce((sum, e) => sum + e.edge_count, 0),
        totalCrossRepoEdges: crossRepo.reduce((sum, e) => sum + e.edge_count, 0),
        externalPackagesUsed: external.length,
      },
    };
  }
}
```

---

## Git Integration

### .gitignore Strategy

```gitignore
# Option A: Exclude all generated databases (regenerate locally)
**/.devac/

# Option B: Exclude large databases, keep manifests
**/.devac/*.db
!**/.devac/manifest.json

# Option C: Include package databases for faster onboarding
# (no .devac exclusions)
```

### Pre-commit Hook

```bash
#!/bin/bash
# .husky/pre-commit

# Ensure all modified packages are analyzed before commit
MODIFIED_PACKAGES=$(git diff --cached --name-only | xargs -I {} dirname {} | sort -u | while read dir; do
  if [ -f "$dir/package.json" ] || [ -f "$dir/tsconfig.json" ]; then
    echo "$dir"
  fi
done)

for pkg in $MODIFIED_PACKAGES; do
  echo "Analyzing $pkg..."
  devac analyze --package "$pkg"
done

# Regenerate repo database
devac aggregate
```

### CI Pipeline

```yaml
# .github/workflows/codegraph.yml

name: CodeGraph Analysis

on:
  push:
    branches: [main]
  pull_request:

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - run: npm ci
      
      # Restore cached package databases
      - uses: actions/cache@v4
        with:
          path: |
            **/.devac/pkg.db
          key: codegraph-${{ hashFiles('**/package.json', '**/tsconfig.json') }}
          restore-keys: |
            codegraph-
      
      # Analyze only changed packages
      - name: Analyze changed packages
        run: |
          CHANGED=$(git diff --name-only ${{ github.event.before }} ${{ github.sha }} | xargs -I {} dirname {} | sort -u)
          for pkg in $CHANGED; do
            if [ -f "$pkg/package.json" ]; then
              devac analyze --package "$pkg" --if-changed
            fi
          done
      
      # Aggregate to repo level
      - name: Aggregate repository
        run: devac aggregate
      
      # Upload as artifact
      - uses: actions/upload-artifact@v4
        with:
          name: codegraph-db
          path: .devac/repo.db

  diff:
    needs: analyze
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Download current analysis
      - uses: actions/download-artifact@v4
        with:
          name: codegraph-db
          path: .devac/
      
      # Download base branch analysis
      - name: Get base branch graph
        run: |
          # Fetch from main branch artifact or regenerate
          devac fetch-baseline --branch ${{ github.base_ref }}
      
      # Generate diff report
      - name: Generate architecture diff
        run: |
          devac diff --base .devac/baseline.db --head .devac/repo.db --output diff-report.md
      
      # Comment on PR
      - uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('diff-report.md', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: report
            });
```

---

## CLI Interface

```bash
# Package-level analysis
devac analyze --package packages/app
devac analyze --package packages/app --force  # Ignore cache
devac analyze --all                           # All packages in repo

# Repository-level aggregation
devac aggregate                               # Aggregate all packages
devac aggregate --watch                       # Watch for changes

# Central hub management
devac hub init                                # Initialize ~/.devac/
devac hub register .                          # Register current repo
devac hub register ~/code/repo-mobile         # Register other repo
devac hub sync                                # Sync all registered repos
devac hub sync --repo repo-mobile             # Sync specific repo

# Queries
devac query "SELECT * FROM nodes WHERE node_type = 'component'"
devac query --file queries/orphaned-effects.sql

# Visualization
devac visualize --scope repo                  # Open web UI for current repo
devac visualize --scope central               # Open web UI for all repos

# Diff
devac diff --from HEAD~1 --to HEAD            # Architecture changes in last commit
devac diff --from v1.0.0 --to v2.0.0          # Changes between releases

# Export
devac export --format json --output graph.json
devac export --format dot --output graph.dot  # For Graphviz
devac export --format d2 --output graph.d2    # For D2 diagrams
```

---

## Testing Strategy

### Unit Tests (PGlite per test)

```typescript
// Each test gets its own in-memory PGlite
describe('TypeScript Analyzer', () => {
  it('extracts React components', async () => {
    const db = await PGlite.create();
    await applyPackageSchema(db);
    
    const analyzer = new TypeScriptAnalyzer();
    await analyzer.analyze({
      packagePath: './fixtures/sample-react-app',
      packageId: 'test:sample',
      db,
    });
    
    const components = await db.query(`
      SELECT * FROM nodes WHERE node_type = 'component'
    `);
    
    expect(components.rows).toHaveLength(5);
  });
});
```

### Integration Tests (Full aggregation)

```typescript
describe('Repository Aggregation', () => {
  it('resolves cross-package imports', async () => {
    // Setup: Create package databases
    await analyzePackage('./fixtures/pkg-a');
    await analyzePackage('./fixtures/pkg-b');
    
    // Aggregate
    const aggregator = new RepoAggregator('./fixtures', 'test-repo');
    await aggregator.aggregate();
    
    // Verify cross-package edges
    const edges = await aggregator.query(`
      SELECT * FROM cross_package_edges
    `);
    
    expect(edges).toContainEqual(
      expect.objectContaining({
        source_package_id: 'test-repo:pkg-a',
        target_package_id: 'test-repo:pkg-b',
        edge_type: 'imports',
      })
    );
  });
});
```

---

## Performance Considerations

### COPY TO/FROM Efficiency

PGlite's COPY operation is significantly faster than row-by-row inserts:

| Operation | 10K rows | 100K rows | 1M rows |
|-----------|----------|-----------|---------|
| INSERT (batch) | 2.3s | 24s | 4m+ |
| COPY binary | 0.1s | 0.8s | 7s |

### Memory Management

```typescript
// Process large repos in chunks
async function aggregateLargeRepo(repoPath: string): Promise<void> {
  const packages = await findPackages(repoPath);
  
  // Process 10 packages at a time to limit memory
  for (const chunk of chunks(packages, 10)) {
    await Promise.all(chunk.map(pkg => analyzePackage(pkg)));
  }
  
  // Aggregate with streaming
  const aggregator = new RepoAggregator(repoPath);
  await aggregator.aggregateStreaming();  // Doesn't load all data at once
}
```

### Incremental Updates

```typescript
// Only re-analyze packages with changed content
async function smartAnalyze(packagePath: string): Promise<boolean> {
  const currentHash = await computeContentHash(packagePath);
  const previousHash = await getPreviousHash(packagePath);
  
  if (currentHash === previousHash) {
    console.log(`${packagePath}: No changes, skipping`);
    return false;
  }
  
  await analyzePackage(packagePath);
  return true;
}
```

---

## Migration Path

### Phase 1: Single Repo Proof of Concept

1. Implement TypeScript analyzer
2. Create package-level PGlite databases for one repo
3. Build repo aggregator with COPY mechanism
4. Validate query performance

### Phase 2: Multi-Repo Federation

1. Build central hub with registry
2. Implement cross-repo edge resolution
3. Add file watching for auto-sync
4. Create unified query interface

### Phase 3: DevAC Integration

1. Connect Vision-View-Effects analysis
2. Build visualization layer
3. Add architecture diff tooling
4. Integrate with CI/CD

### Phase 4: Extended Analyzers

1. Add Python analyzer
2. Add Terraform/CloudFormation analyzer
3. Add API schema analyzer (OpenAPI, GraphQL)
4. Add database schema analyzer

---

## Open Questions

- [ ] Should package databases be compressed (e.g., sqlite compression extension)?
- [ ] How to handle monorepos with 100+ packages? Lazy loading?
- [ ] Should we support PostgreSQL as an alternative backend for larger deployments?
- [ ] How to handle analysis of generated code (GraphQL types, etc.)?
- [ ] Should the central hub support multiple developers (shared team instance)?

---

## References

- [PGlite Documentation](https://electric-sql.com/docs/integrations/drivers/pglite)
- [ts-morph API Reference](https://ts-morph.com/)
- [PostgreSQL COPY Documentation](https://www.postgresql.org/docs/current/sql-copy.html)
- [Federated Database Systems](https://en.wikipedia.org/wiki/Federated_database_system)
