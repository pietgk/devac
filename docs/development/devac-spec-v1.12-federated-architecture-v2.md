# Federated CodeGraph Architecture Specification

**System:** DevAC, CodeGraph, Vision-View-Effects  
**Version:** 2.0  
**Status:** Draft  
**Last Updated:** 2025-01-XX

---

## Executive Summary

This specification defines a federated database architecture for CodeGraph using **embedded-postgres** as the core database engine. Each package produces portable seed files (COPY format), repositories maintain manifests referencing their packages' seeds, and a central embedded-postgres instance merges all data for querying and analysis.

### Key Changes from v1.0

| Aspect | v1.0 (PGlite) | v2.0 (embedded-postgres) |
|--------|---------------|--------------------------|
| Package storage | PGlite database file | COPY seed files + optional snapshots |
| Repo storage | PGlite aggregating packages | Manifest + references to package seeds |
| Central storage | PGlite with aggregated data | embedded-postgres with merged data |
| Size limits | ~50-200MB practical limit | No practical limits |
| Performance | WASM overhead | Native PostgreSQL speed |
| Testing | PGlite in-memory | embedded-postgres (same as production) |

### Why embedded-postgres?

1. **No size limitations** - Production PostgreSQL handles TB-scale databases
2. **Native performance** - No WASM interpretation overhead
3. **Full extension support** - AGE, pgvector, etc. available if needed
4. **Test-production parity** - Same engine for tests and runtime
5. **Mature tooling** - Standard PostgreSQL tools work (psql, pg_dump, etc.)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  Organization Level (Mindler)                                                           │
│                                                                                         │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │  Central DevAC Hub (~/.devac/)                                                     │ │
│  │                                                                                    │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  embedded-postgres instance                                                 │  │ │
│  │  │  - All nodes, edges, effects merged from all repos                          │  │ │
│  │  │  - Cross-package and cross-repo edges resolved                              │  │ │
│  │  │  - Full query capability                                                    │  │ │
│  │  │  - Data directory: ~/.devac/pgdata/                                         │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                                    │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  registry.json                                                              │  │ │
│  │  │  - Known repos and their locations                                          │  │ │
│  │  │  - Last sync timestamps per package                                         │  │ │
│  │  │  - Package → repo mappings                                                  │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                           ▲                                             │
│                                           │ COPY FROM seeds                             │
│               ┌───────────────────────────┼───────────────────────────┐                │
│               │                           │                           │                │
│  ┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐  │
│  │  repo-mobile/           │ │  repo-web/              │ │  repo-backend/          │  │
│  │  ├── .devac/            │ │  ├── .devac/            │ │  ├── .devac/            │  │
│  │  │   ├── manifest.json  │ │  │   ├── manifest.json  │ │  │   ├── manifest.json  │  │
│  │  │   └── packages.json  │ │  │   └── packages.json  │ │  │   └── packages.json  │  │
│  │  │                      │ │  │                      │ │  │                      │  │
│  │  ├── packages/          │ │  ├── apps/              │ │  ├── services/          │  │
│  │  │   ├── app/           │ │  │   ├── web/           │ │  │   ├── auth/          │  │
│  │  │   │   └── .devac/    │ │  │   │   └── .devac/    │ │  │   │   └── .devac/    │  │
│  │  │   │       ├── seed/  │ │  │   │       ├── seed/  │ │  │   │       ├── seed/  │  │
│  │  │   │       │   ├── nodes.csv      │   │   ├── nodes.csv      │   ├── nodes.csv│  │
│  │  │   │       │   ├── edges.csv      │   │   ├── edges.csv      │   ├── edges.csv│  │
│  │  │   │       │   └── ...            │   │   └── ...            │   └── ...      │  │
│  │  │   │       └── meta.json          │   └── meta.json          └── meta.json    │  │
│  │  │   │                  │ │  │                      │ │  │                      │  │
│  │  │   ├── ui/            │ │  │   └── admin/         │ │  │   ├── api/           │  │
│  │  │   │   └── .devac/    │ │  │       └── .devac/    │ │  │   │   └── .devac/    │  │
│  │  │   │       └── seed/  │ │  │           └── seed/  │ │  │   │       └── seed/  │  │
│  │  ...                    │ │  ...                    │ │  ...                    │  │
│  └─────────────────────────┘ └─────────────────────────┘ └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Source Code     │     │  Package Seeds   │     │  Central DB      │
│  (TypeScript,    │────▶│  (CSV/binary     │────▶│  (embedded-      │
│   Python, etc.)  │     │   COPY files)    │     │   postgres)      │
└──────────────────┘     └──────────────────┘     └──────────────────┘
        │                        │                        │
   ts-morph, AST            Portable,               Queryable,
   parsers analyze          git-friendly,           full SQL,
   in package context       small files             all data merged
```

---

## Design Principles

### 1. Seeds as the Unit of Exchange

Package analysis produces **seed files** - portable CSV or binary COPY format files that can be:
- Committed to git (optional)
- Cached in CI
- Imported into any PostgreSQL instance
- Validated independently

### 2. Central Database as the Query Engine

All complex queries run against the central embedded-postgres instance. Package seeds are "dumb" data exports - the intelligence lives in the central database's schema, indexes, and query capabilities.

### 3. Globally Unique Entity IDs

All entities use deterministic, globally unique IDs:

```
{repo}:{package}:{entity_type}:{content_hash}

Examples:
  repo-mobile:packages/app:function:a1b2c3d4
  repo-mobile:packages/app:component:e5f6g7h8
  repo-backend:services/auth:endpoint:i9j0k1l2
```

The content hash portion ensures:
- Same source → same ID (deterministic)
- ID changes when source changes (cache invalidation)
- No collisions across packages

### 4. Test-Production Parity

embedded-postgres is used everywhere:
- Unit tests (fresh instance per test or test suite)
- Integration tests (same configuration as production)
- Local development (central hub)
- CI pipelines (artifact generation)

---

## Package-Level Architecture

### Directory Structure

```
packages/app/
├── src/
│   └── ... (source code)
├── package.json
├── tsconfig.json
└── .devac/
    ├── meta.json              # Package metadata and analysis info
    └── seed/
        ├── nodes.csv          # COPY format: all nodes
        ├── edges.csv          # COPY format: intra-package edges  
        ├── exports.csv        # COPY format: exported symbols
        ├── external_refs.csv  # COPY format: imports from outside
        ├── views.csv          # COPY format: Vision-View-Effects views
        ├── effects.csv        # COPY format: Vision-View-Effects effects
        └── states.csv         # COPY format: Vision-View-Effects states
```

### Metadata File

```json
// packages/app/.devac/meta.json
{
  "schemaVersion": "2.0.0",
  "packageId": "repo-mobile:packages/app",
  "packageName": "@mindler/mobile-app",
  "language": "typescript",
  "analyzedAt": "2025-01-15T10:30:00Z",
  "analyzerVersion": "1.2.0",
  "sourceHash": "sha256:abc123...",
  "stats": {
    "nodeCount": 1247,
    "edgeCount": 3891,
    "exportCount": 89,
    "externalRefCount": 234
  },
  "files": {
    "nodes": { "path": "seed/nodes.csv", "format": "csv", "rows": 1247 },
    "edges": { "path": "seed/edges.csv", "format": "csv", "rows": 3891 },
    "exports": { "path": "seed/exports.csv", "format": "csv", "rows": 89 },
    "external_refs": { "path": "seed/external_refs.csv", "format": "csv", "rows": 234 },
    "views": { "path": "seed/views.csv", "format": "csv", "rows": 45 },
    "effects": { "path": "seed/effects.csv", "format": "csv", "rows": 67 },
    "states": { "path": "seed/states.csv", "format": "csv", "rows": 23 }
  }
}
```

### Seed File Format

Using PostgreSQL COPY CSV format for portability and human readability:

```csv
# seed/nodes.csv
id,local_id,node_type,name,file_path,start_line,end_line,start_col,end_col,content_hash,metadata
repo-mobile:packages/app:function:a1b2c3d4,useAuth_42,function,useAuth,src/hooks/useAuth.ts,15,45,1,2,sha256:def456,"{""isAsync"":true,""isExported"":true}"
repo-mobile:packages/app:component:e5f6g7h8,LoginScreen_17,component,LoginScreen,src/screens/Login.tsx,1,120,1,2,sha256:ghi789,"{""hooks"":[""useState"",""useAuth""]}"
```

```csv
# seed/edges.csv
id,source_id,target_id,edge_type,metadata
repo-mobile:packages/app:edge:x1y2z3,repo-mobile:packages/app:component:e5f6g7h8,repo-mobile:packages/app:function:a1b2c3d4,calls,"{""callCount"":3}"
```

```csv
# seed/external_refs.csv
id,local_node_id,ref_type,target_package,target_symbol,target_path,is_internal,metadata
repo-mobile:packages/app:ref:m1n2o3,repo-mobile:packages/app:import:p4q5r6,import,@mindler/shared-hooks,useUser,@mindler/shared-hooks,true,"{}"
repo-mobile:packages/app:ref:s7t8u9,repo-mobile:packages/app:import:v0w1x2,import,react,useState,react,false,"{}"
```

### Analyzer Interface

```typescript
// packages/devac-analyzers/src/types.ts

export interface PackageAnalyzer {
  id: string;
  name: string;
  filePatterns: string[];
  
  canAnalyze(packagePath: string): Promise<boolean>;
  analyze(context: AnalysisContext): Promise<AnalysisResult>;
}

export interface AnalysisContext {
  packagePath: string;
  packageId: string;
  repoId: string;
  outputDir: string;           // Where to write seed files
  previousMeta?: PackageMeta;  // For incremental optimization
  signal?: AbortSignal;
  onProgress?: (progress: AnalysisProgress) => void;
}

export interface AnalysisResult {
  meta: PackageMeta;
  seedFiles: SeedFile[];
}

export interface SeedFile {
  table: string;
  path: string;
  format: 'csv' | 'binary';
  rowCount: number;
}
```

### TypeScript Analyzer Implementation

```typescript
// packages/devac-analyzers/src/typescript/analyzer.ts

import { Project, SourceFile } from 'ts-morph';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { stringify } from 'csv-stringify';

export class TypeScriptAnalyzer implements PackageAnalyzer {
  id = 'typescript';
  name = 'TypeScript/JavaScript Analyzer';
  filePatterns = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'];

  async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    const { packagePath, packageId, outputDir, onProgress } = context;
    
    // Initialize ts-morph with the package's tsconfig
    const project = new Project({
      tsConfigFilePath: join(packagePath, 'tsconfig.json'),
      skipAddingFilesFromTsConfig: false,
    });

    const sourceFiles = project.getSourceFiles();
    
    // Create seed directory
    const seedDir = join(outputDir, 'seed');
    await ensureDir(seedDir);

    // Open CSV writers for each table
    const writers = await this.createSeedWriters(seedDir);
    
    const stats = {
      nodeCount: 0,
      edgeCount: 0,
      exportCount: 0,
      externalRefCount: 0,
      viewCount: 0,
      effectCount: 0,
      stateCount: 0,
    };

    // Process each source file
    for (let i = 0; i < sourceFiles.length; i++) {
      const sourceFile = sourceFiles[i];
      const relativePath = relative(packagePath, sourceFile.getFilePath());
      
      onProgress?.({
        phase: 'analyzing',
        current: i + 1,
        total: sourceFiles.length,
        currentFile: relativePath,
      });

      // Extract and write nodes
      const nodes = await this.extractNodes(packageId, sourceFile, relativePath);
      for (const node of nodes) {
        await writers.nodes.write(node);
        stats.nodeCount++;
      }

      // Extract and write exports
      const exports = await this.extractExports(packageId, sourceFile, relativePath);
      for (const exp of exports) {
        await writers.exports.write(exp);
        stats.exportCount++;
      }

      // Extract and write external refs
      const refs = await this.extractExternalRefs(packageId, sourceFile, relativePath);
      for (const ref of refs) {
        await writers.externalRefs.write(ref);
        stats.externalRefCount++;
      }

      // Extract Vision-View-Effects patterns
      const vve = await this.extractVisionViewEffects(packageId, sourceFile, relativePath);
      for (const view of vve.views) {
        await writers.views.write(view);
        stats.viewCount++;
      }
      for (const effect of vve.effects) {
        await writers.effects.write(effect);
        stats.effectCount++;
      }
      for (const state of vve.states) {
        await writers.states.write(state);
        stats.stateCount++;
      }
    }

    // Build intra-package edges
    onProgress?.({ phase: 'building-edges', current: 0, total: 1 });
    const edges = await this.buildEdges(project, packageId);
    for (const edge of edges) {
      await writers.edges.write(edge);
      stats.edgeCount++;
    }

    // Close all writers
    await this.closeSeedWriters(writers);

    // Calculate source hash
    const sourceHash = await this.computeSourceHash(sourceFiles);

    // Build metadata
    const meta: PackageMeta = {
      schemaVersion: '2.0.0',
      packageId,
      packageName: await this.getPackageName(packagePath),
      language: 'typescript',
      analyzedAt: new Date().toISOString(),
      analyzerVersion: '1.0.0',
      sourceHash,
      stats: {
        nodeCount: stats.nodeCount,
        edgeCount: stats.edgeCount,
        exportCount: stats.exportCount,
        externalRefCount: stats.externalRefCount,
      },
      files: {
        nodes: { path: 'seed/nodes.csv', format: 'csv', rows: stats.nodeCount },
        edges: { path: 'seed/edges.csv', format: 'csv', rows: stats.edgeCount },
        exports: { path: 'seed/exports.csv', format: 'csv', rows: stats.exportCount },
        external_refs: { path: 'seed/external_refs.csv', format: 'csv', rows: stats.externalRefCount },
        views: { path: 'seed/views.csv', format: 'csv', rows: stats.viewCount },
        effects: { path: 'seed/effects.csv', format: 'csv', rows: stats.effectCount },
        states: { path: 'seed/states.csv', format: 'csv', rows: stats.stateCount },
      },
    };

    // Write metadata
    await writeJson(join(outputDir, 'meta.json'), meta);

    return {
      meta,
      seedFiles: Object.entries(meta.files).map(([table, info]) => ({
        table,
        path: join(outputDir, info.path),
        format: info.format as 'csv',
        rowCount: info.rows,
      })),
    };
  }

  private async createSeedWriters(seedDir: string): Promise<SeedWriters> {
    return {
      nodes: await createCsvWriter(join(seedDir, 'nodes.csv'), [
        'id', 'local_id', 'node_type', 'name', 'file_path', 
        'start_line', 'end_line', 'start_col', 'end_col', 'content_hash', 'metadata'
      ]),
      edges: await createCsvWriter(join(seedDir, 'edges.csv'), [
        'id', 'source_id', 'target_id', 'edge_type', 'metadata'
      ]),
      exports: await createCsvWriter(join(seedDir, 'exports.csv'), [
        'id', 'node_id', 'exported_name', 'export_type', 'is_type_only', 'metadata'
      ]),
      externalRefs: await createCsvWriter(join(seedDir, 'external_refs.csv'), [
        'id', 'local_node_id', 'ref_type', 'target_package', 'target_symbol', 
        'target_path', 'is_internal', 'metadata'
      ]),
      views: await createCsvWriter(join(seedDir, 'views.csv'), [
        'id', 'node_id', 'view_name', 'view_type', 'state_subscriptions', 
        'effect_triggers', 'child_views', 'metadata'
      ]),
      effects: await createCsvWriter(join(seedDir, 'effects.csv'), [
        'id', 'node_id', 'effect_name', 'trigger_type', 'is_async',
        'state_reads', 'state_writes', 'external_calls', 'metadata'
      ]),
      states: await createCsvWriter(join(seedDir, 'states.csv'), [
        'id', 'node_id', 'state_name', 'state_type', 'initial_value', 'metadata'
      ]),
    };
  }

  private async extractNodes(
    packageId: string,
    sourceFile: SourceFile,
    relativePath: string
  ): Promise<NodeRecord[]> {
    const nodes: NodeRecord[] = [];
    
    // Extract functions
    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName() || 'anonymous';
      const contentHash = this.hashContent(fn.getFullText());
      const localId = `fn_${name}_${fn.getStartLineNumber()}`;
      
      nodes.push({
        id: `${packageId}:function:${contentHash.slice(0, 8)}`,
        local_id: localId,
        node_type: 'function',
        name,
        file_path: relativePath,
        start_line: fn.getStartLineNumber(),
        end_line: fn.getEndLineNumber(),
        start_col: fn.getStart() - sourceFile.getLineStarts()[fn.getStartLineNumber() - 1],
        end_col: 0,
        content_hash: contentHash,
        metadata: JSON.stringify({
          isAsync: fn.isAsync(),
          isExported: fn.isExported(),
          isGenerator: fn.isGenerator(),
          parameters: fn.getParameters().map(p => ({
            name: p.getName(),
            type: p.getType().getText(),
          })),
          returnType: fn.getReturnType().getText(),
        }),
      });
    }

    // Extract classes
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName() || 'AnonymousClass';
      const contentHash = this.hashContent(cls.getFullText());
      
      nodes.push({
        id: `${packageId}:class:${contentHash.slice(0, 8)}`,
        local_id: `class_${name}_${cls.getStartLineNumber()}`,
        node_type: 'class',
        name,
        file_path: relativePath,
        start_line: cls.getStartLineNumber(),
        end_line: cls.getEndLineNumber(),
        start_col: 0,
        end_col: 0,
        content_hash: contentHash,
        metadata: JSON.stringify({
          isExported: cls.isExported(),
          isAbstract: cls.isAbstract(),
          extends: cls.getExtends()?.getText(),
          implements: cls.getImplements().map(i => i.getText()),
        }),
      });
    }

    // Extract React components (arrow functions returning JSX)
    for (const varDecl of sourceFile.getVariableDeclarations()) {
      if (this.isReactComponent(varDecl)) {
        const name = varDecl.getName();
        const contentHash = this.hashContent(varDecl.getFullText());
        
        nodes.push({
          id: `${packageId}:component:${contentHash.slice(0, 8)}`,
          local_id: `component_${name}_${varDecl.getStartLineNumber()}`,
          node_type: 'component',
          name,
          file_path: relativePath,
          start_line: varDecl.getStartLineNumber(),
          end_line: varDecl.getEndLineNumber(),
          start_col: 0,
          end_col: 0,
          content_hash: contentHash,
          metadata: JSON.stringify({
            isExported: this.isExported(varDecl),
            hooks: this.extractHooksUsage(varDecl),
            props: this.extractProps(varDecl),
          }),
        });
      }
    }

    return nodes;
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  // ... additional extraction methods
}
```

---

## Repository-Level Architecture

### Directory Structure

```
repo-mobile/
├── packages/
│   ├── app/.devac/seed/...
│   ├── ui/.devac/seed/...
│   └── hooks/.devac/seed/...
├── package.json
└── .devac/
    ├── manifest.json          # Repository metadata
    └── packages.json          # Index of all packages and their seeds
```

### Manifest File

```json
// repo-mobile/.devac/manifest.json
{
  "schemaVersion": "2.0.0",
  "repoId": "repo-mobile",
  "repoName": "Mindler Mobile App",
  "lastUpdated": "2025-01-15T10:30:00Z",
  "gitRemote": "git@github.com:mindler/repo-mobile.git",
  "gitBranch": "main",
  "gitCommit": "abc123def456"
}
```

### Packages Index

```json
// repo-mobile/.devac/packages.json
{
  "schemaVersion": "2.0.0",
  "packages": [
    {
      "id": "repo-mobile:packages/app",
      "name": "@mindler/mobile-app",
      "path": "packages/app",
      "devacPath": "packages/app/.devac",
      "language": "typescript",
      "analyzedAt": "2025-01-15T10:28:00Z",
      "sourceHash": "sha256:abc123...",
      "stats": {
        "nodeCount": 1247,
        "edgeCount": 3891,
        "exportCount": 89,
        "externalRefCount": 234
      }
    },
    {
      "id": "repo-mobile:packages/ui",
      "name": "@mindler/mobile-ui", 
      "path": "packages/ui",
      "devacPath": "packages/ui/.devac",
      "language": "typescript",
      "analyzedAt": "2025-01-15T10:29:00Z",
      "sourceHash": "sha256:def456...",
      "stats": {
        "nodeCount": 892,
        "edgeCount": 2134,
        "exportCount": 156,
        "externalRefCount": 89
      }
    }
  ],
  "summary": {
    "totalPackages": 2,
    "totalNodes": 2139,
    "totalEdges": 6025,
    "totalExports": 245,
    "totalExternalRefs": 323
  }
}
```

### Repository Scanner

```typescript
// packages/devac-core/src/repo-scanner.ts

import { glob } from 'glob';
import { join, relative } from 'path';

export class RepoScanner {
  constructor(private repoPath: string, private repoId: string) {}

  async scan(): Promise<RepoManifest> {
    // Find all packages with .devac directories
    const devacDirs = await glob('**/.devac/meta.json', {
      cwd: this.repoPath,
      ignore: ['node_modules/**', '.devac/**'],
    });

    const packages: PackageInfo[] = [];

    for (const metaPath of devacDirs) {
      const packageDevacDir = join(this.repoPath, metaPath.replace('/meta.json', ''));
      const packagePath = packageDevacDir.replace('/.devac', '');
      const relativePkgPath = relative(this.repoPath, packagePath);

      const meta = await readJson<PackageMeta>(join(this.repoPath, metaPath));

      packages.push({
        id: meta.packageId,
        name: meta.packageName,
        path: relativePkgPath,
        devacPath: relative(this.repoPath, packageDevacDir),
        language: meta.language,
        analyzedAt: meta.analyzedAt,
        sourceHash: meta.sourceHash,
        stats: meta.stats,
      });
    }

    // Calculate summary
    const summary = {
      totalPackages: packages.length,
      totalNodes: packages.reduce((sum, p) => sum + p.stats.nodeCount, 0),
      totalEdges: packages.reduce((sum, p) => sum + p.stats.edgeCount, 0),
      totalExports: packages.reduce((sum, p) => sum + p.stats.exportCount, 0),
      totalExternalRefs: packages.reduce((sum, p) => sum + p.stats.externalRefCount, 0),
    };

    // Write packages index
    const packagesIndex = { schemaVersion: '2.0.0', packages, summary };
    await writeJson(join(this.repoPath, '.devac', 'packages.json'), packagesIndex);

    // Write manifest
    const manifest: RepoManifest = {
      schemaVersion: '2.0.0',
      repoId: this.repoId,
      repoName: await this.getRepoName(),
      lastUpdated: new Date().toISOString(),
      gitRemote: await this.getGitRemote(),
      gitBranch: await this.getGitBranch(),
      gitCommit: await this.getGitCommit(),
    };
    await writeJson(join(this.repoPath, '.devac', 'manifest.json'), manifest);

    return manifest;
  }

  private async getRepoName(): Promise<string> {
    try {
      const pkg = await readJson<{ name: string }>(join(this.repoPath, 'package.json'));
      return pkg.name || this.repoId;
    } catch {
      return this.repoId;
    }
  }

  private async getGitRemote(): Promise<string | undefined> {
    try {
      const { stdout } = await exec('git remote get-url origin', { cwd: this.repoPath });
      return stdout.trim();
    } catch {
      return undefined;
    }
  }

  private async getGitBranch(): Promise<string | undefined> {
    try {
      const { stdout } = await exec('git branch --show-current', { cwd: this.repoPath });
      return stdout.trim();
    } catch {
      return undefined;
    }
  }

  private async getGitCommit(): Promise<string | undefined> {
    try {
      const { stdout } = await exec('git rev-parse HEAD', { cwd: this.repoPath });
      return stdout.trim();
    } catch {
      return undefined;
    }
  }
}
```

---

## Central Hub Architecture

### Directory Structure

```
~/.devac/
├── config.json                # Global configuration
├── registry.json              # Registered repositories
├── pgdata/                    # embedded-postgres data directory
│   └── ... (PostgreSQL data files)
└── snapshots/                 # Optional: point-in-time snapshots
    ├── 2025-01-15_pre-refactor.sql
    └── 2025-01-10_release-v2.sql
```

### Database Schema

```sql
-- Central embedded-postgres schema

-- Schema version tracking
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- Repository registry
CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  git_remote TEXT,
  git_branch TEXT,
  git_commit TEXT,
  last_synced TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_repos_name ON repositories(name);

-- Package registry  
CREATE TABLE packages (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  language TEXT,
  source_hash TEXT,
  analyzed_at TIMESTAMPTZ,
  node_count INTEGER DEFAULT 0,
  edge_count INTEGER DEFAULT 0,
  export_count INTEGER DEFAULT 0,
  last_synced TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_packages_repo ON packages(repo_id);
CREATE INDEX idx_packages_name ON packages(name);

-- Code nodes (merged from all packages)
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  local_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  name TEXT,
  file_path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  start_col INTEGER,
  end_col INTEGER,
  content_hash TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_nodes_package ON nodes(package_id);
CREATE INDEX idx_nodes_type ON nodes(node_type);
CREATE INDEX idx_nodes_name ON nodes(name);
CREATE INDEX idx_nodes_file ON nodes(file_path);
CREATE INDEX idx_nodes_content_hash ON nodes(content_hash);
CREATE INDEX idx_nodes_metadata ON nodes USING GIN(metadata);

-- Intra-package edges (merged from all packages)
CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_edges_package ON edges(package_id);
CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);
CREATE INDEX idx_edges_type ON edges(edge_type);

-- Exports (merged from all packages)
CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  exported_name TEXT NOT NULL,
  export_type TEXT NOT NULL,
  is_type_only BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_exports_package ON exports(package_id);
CREATE INDEX idx_exports_name ON exports(exported_name);
CREATE INDEX idx_exports_node ON exports(node_id);

-- External references (merged from all packages)
CREATE TABLE external_refs (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  local_node_id TEXT NOT NULL,
  ref_type TEXT NOT NULL,
  target_package TEXT,
  target_symbol TEXT,
  target_path TEXT,
  is_internal BOOLEAN DEFAULT false,
  resolved_target_id TEXT,              -- Populated during edge resolution
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_ext_refs_package ON external_refs(package_id);
CREATE INDEX idx_ext_refs_target_pkg ON external_refs(target_package);
CREATE INDEX idx_ext_refs_internal ON external_refs(is_internal) WHERE is_internal = true;
CREATE INDEX idx_ext_refs_resolved ON external_refs(resolved_target_id) WHERE resolved_target_id IS NOT NULL;

-- Cross-package edges (computed during sync)
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

-- Cross-repo edges (computed during sync)
CREATE TABLE cross_repo_edges (
  id TEXT PRIMARY KEY,
  source_repo_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_repo_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_cross_repo_source ON cross_repo_edges(source_repo_id, source_node_id);
CREATE INDEX idx_cross_repo_target ON cross_repo_edges(target_repo_id, target_node_id);

-- ============================================
-- Vision-View-Effects Tables
-- ============================================

CREATE TABLE states (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  node_id TEXT,
  state_name TEXT NOT NULL,
  state_type TEXT,
  initial_value JSONB,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_states_package ON states(package_id);
CREATE INDEX idx_states_name ON states(state_name);

CREATE TABLE effects (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  node_id TEXT,
  effect_name TEXT NOT NULL,
  trigger_type TEXT,
  is_async BOOLEAN DEFAULT false,
  state_reads TEXT[],
  state_writes TEXT[],
  external_calls TEXT[],
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_effects_package ON effects(package_id);
CREATE INDEX idx_effects_trigger ON effects(trigger_type);
CREATE INDEX idx_effects_state_reads ON effects USING GIN(state_reads);
CREATE INDEX idx_effects_state_writes ON effects USING GIN(state_writes);

CREATE TABLE views (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  node_id TEXT,
  view_name TEXT NOT NULL,
  view_type TEXT,
  state_subscriptions TEXT[],
  effect_triggers TEXT[],
  child_views TEXT[],
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_views_package ON views(package_id);
CREATE INDEX idx_views_type ON views(view_type);

-- ============================================
-- Sync tracking
-- ============================================

CREATE TABLE sync_log (
  id SERIAL PRIMARY KEY,
  repo_id TEXT,
  package_id TEXT,
  action TEXT NOT NULL,           -- 'import', 'resolve_edges', 'full_sync'
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  rows_affected INTEGER,
  error TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_sync_log_repo ON sync_log(repo_id);
CREATE INDEX idx_sync_log_package ON sync_log(package_id);
CREATE INDEX idx_sync_log_started ON sync_log(started_at DESC);
```

### Central Hub Implementation

```typescript
// packages/devac-hub/src/central-hub.ts

import { EmbeddedPostgres } from 'embedded-postgres';
import { Client, Pool } from 'pg';
import { join } from 'path';
import { homedir } from 'os';
import { watch } from 'chokidar';

export class CentralHub {
  private postgres: EmbeddedPostgres;
  private pool: Pool;
  private dataDir: string;
  private registeredRepos: Map<string, RepoRegistration> = new Map();
  private watcher?: FSWatcher;

  constructor(options?: CentralHubOptions) {
    this.dataDir = options?.dataDir ?? join(homedir(), '.devac');
  }

  async start(): Promise<void> {
    console.log('Starting embedded-postgres...');
    
    this.postgres = new EmbeddedPostgres({
      databaseDir: join(this.dataDir, 'pgdata'),
      user: 'devac',
      password: 'devac',
      port: 5433,  // Non-standard port to avoid conflicts
      persistent: true,
    });

    await this.postgres.initialise();
    await this.postgres.start();

    // Create connection pool
    this.pool = new Pool({
      host: 'localhost',
      port: 5433,
      user: 'devac',
      password: 'devac',
      database: 'devac',
      max: 10,
    });

    // Ensure database exists
    await this.ensureDatabase();
    
    // Apply schema migrations
    await this.applyMigrations();

    // Load registry
    await this.loadRegistry();

    console.log('Central hub started');
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
    }
    await this.pool.end();
    await this.postgres.stop();
    console.log('Central hub stopped');
  }

  private async ensureDatabase(): Promise<void> {
    const client = new Client({
      host: 'localhost',
      port: 5433,
      user: 'devac',
      password: 'devac',
      database: 'postgres',
    });
    
    await client.connect();
    
    const result = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = 'devac'`
    );
    
    if (result.rows.length === 0) {
      await client.query('CREATE DATABASE devac');
    }
    
    await client.end();
  }

  // ============================================
  // Repository Management
  // ============================================

  async registerRepository(repoPath: string, repoId?: string): Promise<void> {
    const id = repoId ?? await this.inferRepoId(repoPath);
    
    // Validate repo has .devac structure
    const manifestPath = join(repoPath, '.devac', 'manifest.json');
    if (!await fileExists(manifestPath)) {
      throw new Error(`No manifest found at ${manifestPath}. Run 'devac scan' in the repo first.`);
    }

    const manifest = await readJson<RepoManifest>(manifestPath);

    // Register in database
    await this.pool.query(`
      INSERT INTO repositories (id, name, path, git_remote, git_branch, git_commit)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        path = EXCLUDED.path,
        git_remote = EXCLUDED.git_remote,
        git_branch = EXCLUDED.git_branch,
        git_commit = EXCLUDED.git_commit
    `, [id, manifest.repoName, repoPath, manifest.gitRemote, manifest.gitBranch, manifest.gitCommit]);

    // Store in memory
    this.registeredRepos.set(id, {
      id,
      path: repoPath,
      manifest,
    });

    // Save registry
    await this.saveRegistry();

    // Initial sync
    await this.syncRepository(id);
  }

  // ============================================
  // Sync Operations
  // ============================================

  async syncRepository(repoId: string): Promise<SyncResult> {
    const repo = this.registeredRepos.get(repoId);
    if (!repo) throw new Error(`Unknown repository: ${repoId}`);

    console.log(`Syncing repository: ${repoId}`);
    const startTime = Date.now();

    // Load packages index
    const packagesIndex = await readJson<PackagesIndex>(
      join(repo.path, '.devac', 'packages.json')
    );

    const result: SyncResult = {
      repoId,
      packagesProcessed: 0,
      nodesImported: 0,
      edgesImported: 0,
      crossPackageEdgesCreated: 0,
      duration: 0,
    };

    // Start transaction
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Log sync start
      const { rows: [logEntry] } = await client.query(`
        INSERT INTO sync_log (repo_id, action, started_at)
        VALUES ($1, 'full_sync', NOW())
        RETURNING id
      `, [repoId]);

      // Process each package
      for (const pkg of packagesIndex.packages) {
        const pkgResult = await this.syncPackage(client, repo.path, pkg);
        result.nodesImported += pkgResult.nodesImported;
        result.edgesImported += pkgResult.edgesImported;
        result.packagesProcessed++;
      }

      // Resolve cross-package edges within this repo
      result.crossPackageEdgesCreated = await this.resolveCrossPackageEdges(client, repoId);

      // Update repository last_synced
      await client.query(`
        UPDATE repositories SET last_synced = NOW() WHERE id = $1
      `, [repoId]);

      // Log sync completion
      await client.query(`
        UPDATE sync_log SET 
          completed_at = NOW(),
          rows_affected = $1,
          metadata = $2
        WHERE id = $3
      `, [result.nodesImported + result.edgesImported, JSON.stringify(result), logEntry.id]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    result.duration = Date.now() - startTime;
    console.log(`Sync complete: ${result.packagesProcessed} packages, ${result.nodesImported} nodes, ${result.edgesImported} edges in ${result.duration}ms`);

    return result;
  }

  private async syncPackage(
    client: PoolClient,
    repoPath: string,
    pkg: PackageInfo
  ): Promise<PackageSyncResult> {
    const seedDir = join(repoPath, pkg.devacPath, 'seed');
    
    // Check if package needs sync
    const { rows: [existing] } = await client.query(
      `SELECT source_hash FROM packages WHERE id = $1`,
      [pkg.id]
    );

    if (existing?.source_hash === pkg.sourceHash) {
      console.log(`  Skipping ${pkg.name} (unchanged)`);
      return { nodesImported: 0, edgesImported: 0 };
    }

    console.log(`  Syncing ${pkg.name}...`);

    // Upsert package record
    await client.query(`
      INSERT INTO packages (id, repo_id, name, path, language, source_hash, analyzed_at, 
                           node_count, edge_count, export_count, last_synced)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        path = EXCLUDED.path,
        language = EXCLUDED.language,
        source_hash = EXCLUDED.source_hash,
        analyzed_at = EXCLUDED.analyzed_at,
        node_count = EXCLUDED.node_count,
        edge_count = EXCLUDED.edge_count,
        export_count = EXCLUDED.export_count,
        last_synced = NOW()
    `, [
      pkg.id,
      pkg.id.split(':')[0],  // Extract repo_id
      pkg.name,
      pkg.path,
      pkg.language,
      pkg.sourceHash,
      pkg.analyzedAt,
      pkg.stats.nodeCount,
      pkg.stats.edgeCount,
      pkg.stats.exportCount,
    ]);

    // Delete existing data for this package
    await client.query(`DELETE FROM nodes WHERE package_id = $1`, [pkg.id]);
    await client.query(`DELETE FROM edges WHERE package_id = $1`, [pkg.id]);
    await client.query(`DELETE FROM exports WHERE package_id = $1`, [pkg.id]);
    await client.query(`DELETE FROM external_refs WHERE package_id = $1`, [pkg.id]);
    await client.query(`DELETE FROM views WHERE package_id = $1`, [pkg.id]);
    await client.query(`DELETE FROM effects WHERE package_id = $1`, [pkg.id]);
    await client.query(`DELETE FROM states WHERE package_id = $1`, [pkg.id]);

    // Import using COPY
    let nodesImported = 0;
    let edgesImported = 0;

    // Import nodes
    const nodesPath = join(seedDir, 'nodes.csv');
    if (await fileExists(nodesPath)) {
      nodesImported = await this.copyFromCsv(client, nodesPath, 'nodes', pkg.id, [
        'id', 'local_id', 'node_type', 'name', 'file_path',
        'start_line', 'end_line', 'start_col', 'end_col', 'content_hash', 'metadata'
      ]);
    }

    // Import edges
    const edgesPath = join(seedDir, 'edges.csv');
    if (await fileExists(edgesPath)) {
      edgesImported = await this.copyFromCsv(client, edgesPath, 'edges', pkg.id, [
        'id', 'source_id', 'target_id', 'edge_type', 'metadata'
      ]);
    }

    // Import exports
    const exportsPath = join(seedDir, 'exports.csv');
    if (await fileExists(exportsPath)) {
      await this.copyFromCsv(client, exportsPath, 'exports', pkg.id, [
        'id', 'node_id', 'exported_name', 'export_type', 'is_type_only', 'metadata'
      ]);
    }

    // Import external_refs
    const refsPath = join(seedDir, 'external_refs.csv');
    if (await fileExists(refsPath)) {
      await this.copyFromCsv(client, refsPath, 'external_refs', pkg.id, [
        'id', 'local_node_id', 'ref_type', 'target_package', 'target_symbol',
        'target_path', 'is_internal', 'metadata'
      ]);
    }

    // Import Vision-View-Effects tables
    const viewsPath = join(seedDir, 'views.csv');
    if (await fileExists(viewsPath)) {
      await this.copyFromCsv(client, viewsPath, 'views', pkg.id, [
        'id', 'node_id', 'view_name', 'view_type', 'state_subscriptions',
        'effect_triggers', 'child_views', 'metadata'
      ]);
    }

    const effectsPath = join(seedDir, 'effects.csv');
    if (await fileExists(effectsPath)) {
      await this.copyFromCsv(client, effectsPath, 'effects', pkg.id, [
        'id', 'node_id', 'effect_name', 'trigger_type', 'is_async',
        'state_reads', 'state_writes', 'external_calls', 'metadata'
      ]);
    }

    const statesPath = join(seedDir, 'states.csv');
    if (await fileExists(statesPath)) {
      await this.copyFromCsv(client, statesPath, 'states', pkg.id, [
        'id', 'node_id', 'state_name', 'state_type', 'initial_value', 'metadata'
      ]);
    }

    return { nodesImported, edgesImported };
  }

  private async copyFromCsv(
    client: PoolClient,
    csvPath: string,
    table: string,
    packageId: string,
    columns: string[]
  ): Promise<number> {
    const csvContent = await readFile(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n');
    
    // Skip header row
    const dataLines = lines.slice(1);
    if (dataLines.length === 0) return 0;

    // For tables that need package_id added
    const tablesWithPackageId = ['nodes', 'edges', 'exports', 'external_refs', 'views', 'effects', 'states'];
    const needsPackageId = tablesWithPackageId.includes(table);

    if (needsPackageId && !columns.includes('package_id')) {
      columns = ['package_id', ...columns];
    }

    // Use COPY with data stream
    const copyQuery = `COPY ${table} (${columns.join(', ')}) FROM STDIN WITH (FORMAT csv, HEADER false)`;
    
    // Prepend package_id to each line if needed
    let data: string;
    if (needsPackageId) {
      data = dataLines.map(line => `${packageId},${line}`).join('\n');
    } else {
      data = dataLines.join('\n');
    }

    await client.query(copyQuery);
    // Note: In real implementation, use pg-copy-streams or similar for efficient streaming
    // This is simplified for illustration

    // Alternative: Use batch INSERT for smaller datasets
    const parsed = await parseCsv(csvPath);
    for (const row of parsed) {
      const values = needsPackageId ? [packageId, ...Object.values(row)] : Object.values(row);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const cols = needsPackageId ? ['package_id', ...Object.keys(row)] : Object.keys(row);
      
      await client.query(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        values
      );
    }

    return dataLines.length;
  }

  // ============================================
  // Edge Resolution
  // ============================================

  private async resolveCrossPackageEdges(client: PoolClient, repoId: string): Promise<number> {
    // Clear existing cross-package edges for this repo's packages
    await client.query(`
      DELETE FROM cross_package_edges 
      WHERE source_package_id IN (SELECT id FROM packages WHERE repo_id = $1)
    `, [repoId]);

    // Build export lookup for packages in this repo
    const { rows: exports } = await client.query<{
      package_id: string;
      package_name: string;
      node_id: string;
      exported_name: string;
    }>(`
      SELECT e.package_id, p.name as package_name, e.node_id, e.exported_name
      FROM exports e
      JOIN packages p ON e.package_id = p.id
      WHERE p.repo_id = $1
    `, [repoId]);

    // Index by package_name:symbol
    const exportIndex = new Map<string, { packageId: string; nodeId: string }>();
    for (const exp of exports) {
      exportIndex.set(`${exp.package_name}:${exp.exported_name}`, {
        packageId: exp.package_id,
        nodeId: exp.node_id,
      });
      // Also index default export
      if (exp.exported_name === 'default') {
        exportIndex.set(`${exp.package_name}:default`, {
          packageId: exp.package_id,
          nodeId: exp.node_id,
        });
      }
    }

    // Find internal external refs and resolve them
    const { rows: refs } = await client.query<{
      id: string;
      package_id: string;
      local_node_id: string;
      target_package: string;
      target_symbol: string;
    }>(`
      SELECT er.id, er.package_id, er.local_node_id, er.target_package, er.target_symbol
      FROM external_refs er
      JOIN packages p ON er.package_id = p.id
      WHERE p.repo_id = $1 AND er.is_internal = true
    `, [repoId]);

    let edgesCreated = 0;

    for (const ref of refs) {
      const key = `${ref.target_package}:${ref.target_symbol}`;
      const target = exportIndex.get(key);

      if (target && target.packageId !== ref.package_id) {
        // Create cross-package edge
        await client.query(`
          INSERT INTO cross_package_edges 
            (id, source_package_id, source_node_id, target_package_id, target_node_id, edge_type)
          VALUES ($1, $2, $3, $4, $5, 'imports')
          ON CONFLICT (id) DO NOTHING
        `, [
          `cross:${ref.id}`,
          ref.package_id,
          ref.local_node_id,
          target.packageId,
          target.nodeId,
        ]);

        // Update external_ref with resolved target
        await client.query(`
          UPDATE external_refs SET resolved_target_id = $1 WHERE id = $2
        `, [target.nodeId, ref.id]);

        edgesCreated++;
      }
    }

    return edgesCreated;
  }

  async resolveCrossRepoEdges(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Clear existing cross-repo edges
      await client.query('DELETE FROM cross_repo_edges');

      // Build export lookup across all repos
      const { rows: exports } = await client.query<{
        repo_id: string;
        package_id: string;
        package_name: string;
        node_id: string;
        exported_name: string;
      }>(`
        SELECT p.repo_id, e.package_id, p.name as package_name, e.node_id, e.exported_name
        FROM exports e
        JOIN packages p ON e.package_id = p.id
      `);

      const exportIndex = new Map<string, { repoId: string; packageId: string; nodeId: string }>();
      for (const exp of exports) {
        exportIndex.set(`${exp.package_name}:${exp.exported_name}`, {
          repoId: exp.repo_id,
          packageId: exp.package_id,
          nodeId: exp.node_id,
        });
      }

      // Find external refs that point to @mindler/* packages
      const { rows: refs } = await client.query<{
        id: string;
        repo_id: string;
        package_id: string;
        local_node_id: string;
        target_package: string;
        target_symbol: string;
      }>(`
        SELECT er.id, p.repo_id, er.package_id, er.local_node_id, er.target_package, er.target_symbol
        FROM external_refs er
        JOIN packages p ON er.package_id = p.id
        WHERE er.target_package LIKE '@mindler/%'
          AND er.resolved_target_id IS NULL
      `);

      let edgesCreated = 0;

      for (const ref of refs) {
        const key = `${ref.target_package}:${ref.target_symbol}`;
        const target = exportIndex.get(key);

        if (target && target.repoId !== ref.repo_id) {
          // Create cross-repo edge
          await client.query(`
            INSERT INTO cross_repo_edges 
              (id, source_repo_id, source_node_id, target_repo_id, target_node_id, edge_type)
            VALUES ($1, $2, $3, $4, $5, 'imports')
            ON CONFLICT (id) DO NOTHING
          `, [
            `xrepo:${ref.id}`,
            ref.repo_id,
            ref.local_node_id,
            target.repoId,
            target.nodeId,
          ]);

          // Update external_ref with resolved target
          await client.query(`
            UPDATE external_refs SET resolved_target_id = $1 WHERE id = $2
          `, [target.nodeId, ref.id]);

          edgesCreated++;
        }
      }

      await client.query('COMMIT');
      return edgesCreated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ============================================
  // Query Interface
  // ============================================

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  // ============================================
  // Snapshots
  // ============================================

  async createSnapshot(name: string): Promise<string> {
    const snapshotPath = join(this.dataDir, 'snapshots', `${name}.sql`);
    await ensureDir(join(this.dataDir, 'snapshots'));

    // Use pg_dump
    await exec(`pg_dump -h localhost -p 5433 -U devac -d devac -f "${snapshotPath}"`);
    
    console.log(`Snapshot created: ${snapshotPath}`);
    return snapshotPath;
  }

  async restoreSnapshot(name: string): Promise<void> {
    const snapshotPath = join(this.dataDir, 'snapshots', `${name}.sql`);
    
    if (!await fileExists(snapshotPath)) {
      throw new Error(`Snapshot not found: ${name}`);
    }

    // Drop and recreate database
    const client = new Client({
      host: 'localhost',
      port: 5433,
      user: 'devac',
      password: 'devac',
      database: 'postgres',
    });
    
    await client.connect();
    await client.query('DROP DATABASE IF EXISTS devac');
    await client.query('CREATE DATABASE devac');
    await client.end();

    // Restore from snapshot
    await exec(`psql -h localhost -p 5433 -U devac -d devac -f "${snapshotPath}"`);
    
    console.log(`Snapshot restored: ${name}`);
  }

  // ============================================
  // File Watching
  // ============================================

  async startWatching(): Promise<void> {
    const watchPaths = Array.from(this.registeredRepos.values())
      .map(r => join(r.path, '.devac', 'packages.json'));

    this.watcher = watch(watchPaths, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
    });

    this.watcher.on('change', async (changedPath) => {
      const repo = Array.from(this.registeredRepos.values())
        .find(r => changedPath.startsWith(r.path));
      
      if (repo) {
        console.log(`Detected changes in ${repo.id}, syncing...`);
        try {
          await this.syncRepository(repo.id);
          await this.resolveCrossRepoEdges();
        } catch (error) {
          console.error(`Sync failed for ${repo.id}:`, error);
        }
      }
    });

    console.log(`Watching ${watchPaths.length} repositories for changes`);
  }
}
```

---

## Testing Strategy

### Using embedded-postgres for All Tests

```typescript
// packages/devac-test-utils/src/database.ts

import { EmbeddedPostgres } from 'embedded-postgres';
import { Client, Pool } from 'pg';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

let sharedPostgres: EmbeddedPostgres | null = null;
let startupPromise: Promise<void> | null = null;

/**
 * Get or start a shared embedded-postgres instance.
 * Reused across all tests in a test run for faster execution.
 */
async function getSharedPostgres(): Promise<EmbeddedPostgres> {
  if (sharedPostgres) return sharedPostgres;

  if (!startupPromise) {
    startupPromise = (async () => {
      console.log('Starting shared embedded-postgres for tests...');
      
      sharedPostgres = new EmbeddedPostgres({
        databaseDir: join(tmpdir(), `devac-test-${process.pid}`),
        user: 'test',
        password: 'test',
        port: 5434 + (process.pid % 1000),  // Unique port per process
        persistent: false,
      });

      await sharedPostgres.initialise();
      await sharedPostgres.start();
      
      console.log('Shared embedded-postgres started');
    })();
  }

  await startupPromise;
  return sharedPostgres!;
}

/**
 * Create a fresh test database with the CodeGraph schema.
 * Each test suite gets its own database for isolation.
 */
export async function createTestDatabase(name?: string): Promise<TestDatabase> {
  const postgres = await getSharedPostgres();
  const dbName = name ?? `test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const port = postgres.getPort();

  // Create database using postgres connection
  const adminClient = new Client({
    host: 'localhost',
    port,
    user: 'test',
    password: 'test',
    database: 'postgres',
  });
  
  await adminClient.connect();
  await adminClient.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await adminClient.query(`CREATE DATABASE ${dbName}`);
  await adminClient.end();

  // Connect to new database and apply schema
  const pool = new Pool({
    host: 'localhost',
    port,
    user: 'test',
    password: 'test',
    database: dbName,
    max: 5,
  });

  // Apply schema
  const schema = await readFile(join(__dirname, '../../schemas/central.sql'), 'utf-8');
  await pool.query(schema);

  return {
    pool,
    dbName,
    connectionString: `postgresql://test:test@localhost:${port}/${dbName}`,
    
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },
    
    async exec(sql: string): Promise<void> {
      await pool.query(sql);
    },
    
    async close(): Promise<void> {
      await pool.end();
      // Optionally drop database
      const client = new Client({
        host: 'localhost',
        port,
        user: 'test',
        password: 'test',
        database: 'postgres',
      });
      await client.connect();
      await client.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await client.end();
    },
  };
}

export interface TestDatabase {
  pool: Pool;
  dbName: string;
  connectionString: string;
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
  exec: (sql: string) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Cleanup hook for test framework
 */
export async function cleanupTestPostgres(): Promise<void> {
  if (sharedPostgres) {
    console.log('Stopping shared embedded-postgres...');
    await sharedPostgres.stop();
    sharedPostgres = null;
    startupPromise = null;
  }
}
```

### Test Setup for Vitest

```typescript
// vitest.setup.ts

import { beforeAll, afterAll } from 'vitest';
import { cleanupTestPostgres } from '@devac/test-utils';

// Cleanup after all tests complete
afterAll(async () => {
  await cleanupTestPostgres();
});
```

```typescript
// vitest.config.ts

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30000,  // Allow time for DB operations
    hookTimeout: 60000,  // Allow time for postgres startup
    pool: 'forks',       // Isolate test files
    poolOptions: {
      forks: {
        singleFork: true,  // Share postgres across tests in a file
      },
    },
  },
});
```

### Example Test File

```typescript
// packages/devac-analyzers/src/__tests__/typescript-analyzer.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, TestDatabase } from '@devac/test-utils';
import { TypeScriptAnalyzer } from '../typescript/analyzer';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TypeScriptAnalyzer', () => {
  let db: TestDatabase;
  let analyzer: TypeScriptAnalyzer;
  let outputDir: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    analyzer = new TypeScriptAnalyzer();
    outputDir = join(tmpdir(), `devac-test-${Date.now()}`);
  });

  afterEach(async () => {
    await db.close();
  });

  it('extracts functions from TypeScript file', async () => {
    const result = await analyzer.analyze({
      packagePath: join(__dirname, '../../fixtures/sample-package'),
      packageId: 'test-repo:sample-package',
      repoId: 'test-repo',
      outputDir,
    });

    expect(result.meta.stats.nodeCount).toBeGreaterThan(0);

    // Import seeds into test database
    await importSeeds(db, outputDir);

    // Query functions
    const functions = await db.query<{ name: string; node_type: string }>(`
      SELECT name, node_type FROM nodes WHERE node_type = 'function'
    `);

    expect(functions.length).toBeGreaterThan(0);
    expect(functions.some(f => f.name === 'useAuth')).toBe(true);
  });

  it('extracts React components', async () => {
    await analyzer.analyze({
      packagePath: join(__dirname, '../../fixtures/sample-react-app'),
      packageId: 'test-repo:sample-react-app',
      repoId: 'test-repo',
      outputDir,
    });

    await importSeeds(db, outputDir);

    const components = await db.query<{ name: string }>(`
      SELECT name FROM nodes WHERE node_type = 'component'
    `);

    expect(components.some(c => c.name === 'LoginScreen')).toBe(true);
    expect(components.some(c => c.name === 'Button')).toBe(true);
  });

  it('creates correct edges for function calls', async () => {
    await analyzer.analyze({
      packagePath: join(__dirname, '../../fixtures/sample-package'),
      packageId: 'test-repo:sample-package',
      repoId: 'test-repo',
      outputDir,
    });

    await importSeeds(db, outputDir);

    const callEdges = await db.query<{ source_id: string; target_id: string }>(`
      SELECT source_id, target_id FROM edges WHERE edge_type = 'calls'
    `);

    expect(callEdges.length).toBeGreaterThan(0);
  });

  it('tracks external references', async () => {
    await analyzer.analyze({
      packagePath: join(__dirname, '../../fixtures/sample-react-app'),
      packageId: 'test-repo:sample-react-app',
      repoId: 'test-repo',
      outputDir,
    });

    await importSeeds(db, outputDir);

    const reactRefs = await db.query<{ target_package: string; target_symbol: string }>(`
      SELECT target_package, target_symbol FROM external_refs
      WHERE target_package = 'react'
    `);

    expect(reactRefs.some(r => r.target_symbol === 'useState')).toBe(true);
  });
});

async function importSeeds(db: TestDatabase, outputDir: string): Promise<void> {
  const meta = await readJson<PackageMeta>(join(outputDir, 'meta.json'));
  
  for (const [table, info] of Object.entries(meta.files)) {
    const csvPath = join(outputDir, info.path);
    if (await fileExists(csvPath)) {
      await importCsvToTable(db, csvPath, table, meta.packageId);
    }
  }
}
```

### Integration Test Example

```typescript
// packages/devac-hub/src/__tests__/sync.integration.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CentralHub } from '../central-hub';
import { TypeScriptAnalyzer } from '@devac/analyzers';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Central Hub Sync', () => {
  let hub: CentralHub;
  let testDir: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `devac-integration-${Date.now()}`);
    
    hub = new CentralHub({ dataDir: testDir });
    await hub.start();
  }, 60000);  // Allow time for postgres startup

  afterAll(async () => {
    await hub.stop();
  });

  it('syncs a repository and resolves cross-package edges', async () => {
    // Setup: Analyze test repository
    const repoPath = join(__dirname, '../../fixtures/test-monorepo');
    
    // Analyze each package
    const analyzer = new TypeScriptAnalyzer();
    for (const pkg of ['packages/core', 'packages/ui', 'packages/app']) {
      await analyzer.analyze({
        packagePath: join(repoPath, pkg),
        packageId: `test-repo:${pkg}`,
        repoId: 'test-repo',
        outputDir: join(repoPath, pkg, '.devac'),
      });
    }

    // Scan repo to create manifest
    const scanner = new RepoScanner(repoPath, 'test-repo');
    await scanner.scan();

    // Register and sync
    await hub.registerRepository(repoPath, 'test-repo');

    // Verify nodes were imported
    const nodes = await hub.query<{ node_type: string; count: number }>(`
      SELECT node_type, COUNT(*) as count FROM nodes GROUP BY node_type
    `);
    expect(nodes.length).toBeGreaterThan(0);

    // Verify cross-package edges were created
    const crossPkgEdges = await hub.query<{ count: number }>(`
      SELECT COUNT(*) as count FROM cross_package_edges
    `);
    expect(crossPkgEdges[0].count).toBeGreaterThan(0);
  });

  it('incrementally syncs only changed packages', async () => {
    // First sync
    const result1 = await hub.syncRepository('test-repo');
    
    // Modify nothing, sync again
    const result2 = await hub.syncRepository('test-repo');
    
    // Should skip unchanged packages (nodesImported should be 0 or much less)
    // The exact behavior depends on source_hash comparison
    expect(result2.duration).toBeLessThan(result1.duration);
  });
});
```

---

## CLI Interface

```bash
# Package analysis
devac analyze                              # Analyze current package
devac analyze --package packages/app       # Analyze specific package
devac analyze --all                        # Analyze all packages in repo
devac analyze --if-changed                 # Only if source changed

# Repository scanning
devac scan                                 # Scan repo, create manifest

# Central hub management
devac hub start                            # Start embedded-postgres
devac hub stop                             # Stop embedded-postgres
devac hub status                           # Show hub status

devac hub register .                       # Register current repo
devac hub register ~/code/repo-mobile      # Register other repo
devac hub unregister repo-mobile           # Remove repo

devac hub sync                             # Sync all repos
devac hub sync --repo repo-mobile          # Sync specific repo
devac hub watch                            # Watch and auto-sync

# Snapshots
devac hub snapshot create pre-refactor     # Create named snapshot
devac hub snapshot list                    # List snapshots
devac hub snapshot restore pre-refactor    # Restore snapshot

# Queries
devac query "SELECT * FROM nodes LIMIT 10"
devac query --file queries/orphaned-effects.sql

# Visualization
devac viz                                  # Open web UI
devac viz --repo repo-mobile               # Filter to specific repo
```

---

## Performance Considerations

### embedded-postgres Startup Time

First start (initialization): ~10-30 seconds
Subsequent starts: ~2-5 seconds

For tests, we mitigate this by:
1. Sharing one postgres instance across all tests in a process
2. Creating separate databases (instant) rather than separate instances
3. Using `persistent: false` for automatic cleanup

### COPY Performance

| Rows | INSERT batch | COPY CSV | COPY binary |
|------|-------------|----------|-------------|
| 1K   | 0.2s        | 0.05s    | 0.03s       |
| 10K  | 2s          | 0.3s     | 0.1s        |
| 100K | 20s         | 2s       | 0.8s        |
| 1M   | 200s+       | 15s      | 6s          |

Recommendation: Use CSV for portability and human readability. Switch to binary only if sync times become problematic with very large codebases.

### Index Strategy

```sql
-- Essential indexes (created by default)
CREATE INDEX idx_nodes_package ON nodes(package_id);
CREATE INDEX idx_nodes_type ON nodes(node_type);
CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);

-- Optional indexes (add if query patterns require)
CREATE INDEX idx_nodes_name_trgm ON nodes USING GIN(name gin_trgm_ops);  -- Fuzzy search
CREATE INDEX idx_nodes_file_path ON nodes(file_path text_pattern_ops);   -- Path prefix search
```

---

## Migration Path

### Phase 1: Core Infrastructure (Week 1-2)

1. Set up embedded-postgres wrapper with start/stop/lifecycle
2. Implement schema migrations
3. Create test utilities with shared postgres
4. Validate startup times and connection pooling

### Phase 2: Analyzers (Week 2-3)

1. Implement TypeScript analyzer with CSV seed output
2. Create seed file format and validation
3. Test analyzer with real Mindler packages
4. Optimize seed file size if needed

### Phase 3: Central Hub (Week 3-4)

1. Implement hub registration and sync
2. Build COPY-based import from seeds
3. Implement cross-package edge resolution
4. Add file watching for auto-sync

### Phase 4: Cross-Repo (Week 4-5)

1. Implement cross-repo edge resolution
2. Test with multiple Mindler repos
3. Build snapshot/restore functionality
4. Add CLI commands

### Phase 5: Integration (Week 5-6)

1. Integrate with DevAC UI
2. Add Vision-View-Effects queries
3. Performance testing at scale
4. Documentation and team onboarding

---

## Open Questions

- [ ] Should we compress seed files (gzip) for git storage?
- [ ] What's the optimal CSV vs binary COPY threshold?
- [ ] Should we support incremental seed updates (patches) vs full regeneration?
- [ ] How to handle schema migrations for seed files when format changes?
- [ ] Should embedded-postgres run as a daemon or on-demand?

---

## Appendix: Package Size Optimization

If seed files become too large, consider:

### 1. Selective Metadata

```typescript
// Only include essential metadata
const essentialMetadata = {
  isExported: node.isExported,
  isAsync: node.isAsync,
  // Omit: full type signatures, JSDoc, etc.
};
```

### 2. Normalized References

```csv
# Instead of full IDs everywhere, use local refs + package prefix once
# nodes.csv
local_id,node_type,name,...
fn_useAuth_42,function,useAuth,...

# edges.csv (local refs within package)
source_local_id,target_local_id,edge_type
fn_main_1,fn_useAuth_42,calls
```

### 3. Separate Detail Files

```
.devac/
├── seed/
│   ├── nodes.csv          # Core: id, type, name, location
│   ├── nodes-metadata.csv # Optional: full metadata
│   ├── edges.csv
│   └── ...
└── meta.json
```

Central hub imports core files always, metadata files on demand.

---

## References

- [embedded-postgres npm](https://www.npmjs.com/package/embedded-postgres)
- [PostgreSQL COPY Documentation](https://www.postgresql.org/docs/current/sql-copy.html)
- [ts-morph Documentation](https://ts-morph.com/)
- [Vitest Documentation](https://vitest.dev/)
