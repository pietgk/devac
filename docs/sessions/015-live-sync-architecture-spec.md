# Live Code Graph Sync Architecture - Implementation Specification

> **Status**: Planning Phase  
> **Created**: 2025-11-04  
> **Priority**: High  
> **Complexity**: Advanced

## Executive Summary

Transform CodeGraph from a batch analyzer into a **live code intelligence system** that maintains a real-time synchronized graph database of your codebase. This enables instant code insights, IDE integrations, and eliminates the current 60-90 minute sync bottleneck for large repositories.

## Current State & Problem

### Current Architecture (Batch Mode)
```
Parse ALL files → Accumulate in Memory (4GB+) → Write at END → Neo4j
```

**Issues:**
- **Memory Explosion**: monorepo-3.0 (1,717 files) requires 8GB heap, crashes with default 4GB
- **Long Wait Times**: 60-90 minutes for full sync
- **No Incremental Updates**: Must re-parse entire codebase for any change
- **Blocking Operation**: Cannot query graph during analysis

### Analysis Results from Testing Session (2025-11-04)

**Test Run Statistics:**
- **Repository**: monorepo-3.0
- **Files**: 1,717 TypeScript files (after .d.ts filtering from 180K total)
- **Memory with 4GB heap**: Crashed at batch 6-7 (~600 files processed)
- **Memory with 8GB heap**: Running 70+ minutes, stable at 740MB, still in Pass 1
- **Root Cause**: `tsResults` Map accumulates all parsed AST data until final write

**Key Insight**: Data is self-contained per file in Pass 1, but architecture forces accumulation.

---

## Vision: Live Sync Architecture

### Three Operating Modes

#### Mode 1: Initial Full Sync (Streaming Batches)
```
For each batch of 100 files:
  Parse batch → Write to Neo4j → Clear memory
  
Memory: Constant ~200MB (vs 4GB+ current)
Time: Same or faster (no GC pressure)
```

#### Mode 2: Watch Mode (File-Level Incremental)
```
File changes → Parse single file → Update Neo4j → Clear memory

Memory: Constant ~10MB per change
Latency: <500ms from file save to graph update
```

#### Mode 3: Dev Server (Hybrid)
```
1. Initial sync with Mode 1 (per-batch streaming)
2. Start file watcher (chokidar)
3. Switch to Mode 2 (incremental updates)
4. Maintain live sync indefinitely

Usage: `codegraph dev --watch --config .codegraph/workspace.json`
```

---

## Architectural Deep Dive

### The Two-Pass Architecture (Why It Exists)

CodeGraph uses a 2-pass analysis strategy:

**Pass 1: Symbol Extraction** (File-Isolated)
- Parse each file independently with ts-morph/tree-sitter
- Extract nodes: Functions, Classes, Variables, Interfaces, etc.
- Record imports/exports
- **Cannot resolve cross-file references yet** (don't know what `import {foo} from './bar'` points to)
- **Key Property**: Files are independent - can process in any order

**Pass 2: Relationship Resolution** (Cross-File)
- Load all files into ts-morph Project
- Resolve imports to their targets
- Create relationships: CALLS, EXTENDS, IMPLEMENTS, MUTATES_STATE
- **Requires**: Complete symbol table from Pass 1

**Current Flow:**
```
Pass 1: Parse All → Accumulate (4GB) 
          ↓
Pass 2: Load All → Resolve Rels → Accumulate
          ↓
Write: Nodes + Relationships → Neo4j (once at end)
```

**Problem**: Both passes accumulate in memory, Pass 2 needs all files loaded simultaneously.

### Key Architectural Insight: Per-File Independence in Pass 1

Pass 1 has **zero dependencies between files**. Each file can be:
- Parsed independently
- Written to Neo4j immediately
- Removed from memory

This enables streaming writes without architectural changes to the parsing logic.

### Storage Layer Analysis

**Current Implementation** (`src/analyzer/storage-manager.ts`):

```typescript
class StorageManager {
  // Already supports batch writes!
  async saveNodesBatch(nodes: AstNode[]): Promise<void>
  async saveRelationshipsBatch(type: string, rels: RelationshipInfo[]): Promise<void>
}
```

**Uses MERGE (idempotent)**:
```cypher
MERGE (n:Node { entityId: nodeData.entityId })
SET n = nodeData.properties
```

**Key Properties:**
- ✅ Already idempotent (MERGE, not CREATE)
- ✅ Already batches writes (100 nodes/rels per transaction)
- ✅ Supports incremental updates
- ❌ No file-level delete operation
- ❌ No atomic file replacement

---

## Implementation Plan

### Phase 1: Per-Batch Streaming Foundation
**Goal**: Eliminate Pass 1 memory accumulation  
**Timeline**: 1 week  
**Complexity**: Low

#### Files to Modify

**1. `src/analyzer/parser.ts`** (Lines 223-283)

Current batch loop:
```typescript
for (let i = 0; i < batches.length; i++) {
  const batchProject = new Project({...});
  batchProject.addSourceFilesAtPaths(batch);
  await this._parseTsProjectFilesBatch(batchProject, batchTargetPaths);
  
  // Results accumulate in this.tsResults Map ❌
  
  if (global.gc) global.gc();
}
```

New streaming version:
```typescript
for (let i = 0; i < batches.length; i++) {
  const batchProject = new Project({...});
  batchProject.addSourceFilesAtPaths(batch);
  await this._parseTsProjectFilesBatch(batchProject, batchTargetPaths);
  
  // ✅ NEW: Write batch to Neo4j immediately
  const batchNodes = Array.from(this.tsResults.values())
    .flatMap(result => result.nodes);
  const batchRels = Array.from(this.tsResults.values())
    .flatMap(result => result.relationships);
  
  await this.storageManager.saveNodesBatch(batchNodes);
  
  // Group relationships by type (required by current API)
  const relsByType = groupBy(batchRels, r => r.type);
  for (const [type, rels] of Object.entries(relsByType)) {
    await this.storageManager.saveRelationshipsBatch(type, rels);
  }
  
  // ✅ NEW: Clear memory immediately
  this.tsResults.clear();
  
  if (global.gc) global.gc();
}
```

**2. `src/analyzer/parser.ts` - `collectResults()` method**

Current: Aggregates all results at end
```typescript
async collectResults(): Promise<{ nodes: AstNode[]; relationships: RelationshipInfo[] }> {
  // Combines all this.tsResults entries
  return { nodes: allNodes, relationships: allRels };
}
```

New: Already written, just return metadata
```typescript
async collectResults(): Promise<{ nodes: AstNode[]; relationships: RelationshipInfo[] }> {
  // Results already written during batch processing
  // Return empty arrays or fetch from Neo4j if needed for Pass 2
  logger.info("Pass 1 results already written to Neo4j during batch processing");
  return { nodes: [], relationships: [] };
}
```

**3. `src/analyzer/analyzer-service.ts`** (Lines 95-140)

Current: Calls `collectResults()` then writes
```typescript
const { nodes: pass1Nodes, relationships: pass1Relationships } = 
  await this.parser.collectResults();

await this.storageManager.saveNodesBatch(pass1Nodes);
```

New: Results already written, proceed to Pass 2
```typescript
// Pass 1 results already written during streaming batch processing
logger.info("Pass 1 nodes already in Neo4j, proceeding to Pass 2...");

// For Pass 2, we still need the nodes in memory (or fetch from Neo4j)
// Option A: Keep minimal metadata during batch streaming
// Option B: Fetch nodes from Neo4j for Pass 2
const pass1Nodes = await this.fetchNodesFromNeo4j(this.repositoryMetadata.repository);
```

#### Testing

```bash
# Test with monorepo-3.0
cd /Users/grop/ws/CodeGraph
npm run build

# Should complete without OOM, even with default 4GB heap
node --expose-gc dist/index.js workspace sync --repos monorepo-3.0

# Verify nodes in Neo4j after first batch (not at end)
# Check memory stays under 500MB throughout
```

**Success Criteria:**
- ✅ Analysis completes with 4GB heap (not 8GB)
- ✅ Memory stays under 500MB throughout
- ✅ Nodes appear in Neo4j incrementally (not just at end)

---

### Phase 2: File-Level Operations
**Goal**: Enable atomic per-file updates  
**Timeline**: 1 week  
**Complexity**: Medium

#### New StorageManager Methods

**File**: `src/analyzer/storage-manager.ts`

```typescript
/**
 * Deletes all nodes and relationships for a specific file.
 * Used when a file is deleted or before updating it.
 * 
 * @param filePath - Absolute path to the file
 */
async deleteFileGraph(filePath: string): Promise<void> {
  const cypher = `
    MATCH (n:Node {filePath: $filePath})
    DETACH DELETE n
  `;
  
  await this.neo4jClient.runTransaction(
    cypher,
    { filePath },
    'WRITE',
    'StorageManager-DeleteFile'
  );
  
  logger.debug(`Deleted graph for file: ${filePath}`);
}

/**
 * Atomically replaces all nodes and relationships for a file.
 * Deletes old data and inserts new data in a single transaction.
 * 
 * @param filePath - Absolute path to the file
 * @param nodes - New nodes for this file
 * @param relationships - New relationships originating from this file
 */
async replaceFileGraph(
  filePath: string,
  nodes: AstNode[],
  relationships: RelationshipInfo[]
): Promise<void> {
  if (nodes.length === 0) {
    logger.warn(`No nodes provided for file: ${filePath}`);
    return;
  }

  // Prepare data
  const preparedNodes = nodes.map(n => ({
    entityId: n.entityId,
    kind: n.kind,
    properties: this.prepareNodeProperties(n)
  }));

  const preparedRels = relationships.map(r => 
    this.prepareRelationshipProperties(r)
  );

  // Single transaction: delete old + insert new
  const cypher = `
    // 1. Delete existing nodes for this file
    MATCH (n:Node {filePath: $filePath})
    DETACH DELETE n
    
    // 2. Create new nodes
    WITH $nodes AS nodeBatch
    UNWIND nodeBatch AS nodeData
    MERGE (n:Node {entityId: nodeData.entityId})
    SET n = nodeData.properties
    ${this.generateNodeLabelCypher().setLabelClauses}
    
    // 3. Create new relationships
    WITH $relationships AS relBatch
    UNWIND relBatch AS relData
    MATCH (source:Node {entityId: relData.sourceId})
    MATCH (target:Node {entityId: relData.targetId})
    MERGE (source)-[r:\`${relData.type}\` {entityId: relData.entityId}]->(target)
    ON CREATE SET r = relData.properties
    ON MATCH SET r += relData.properties
  `;

  await this.neo4jClient.runTransaction(
    cypher,
    {
      filePath,
      nodes: preparedNodes,
      relationships: preparedRels
    },
    'WRITE',
    'StorageManager-ReplaceFile'
  );

  logger.info(`Replaced graph for file: ${filePath} (${nodes.length} nodes, ${relationships.length} rels)`);
}

/**
 * Updates only the relationships for a file (used in Pass 2 incremental updates).
 * Keeps nodes intact, only replaces relationships.
 */
async updateFileRelationships(
  filePath: string,
  relationships: RelationshipInfo[]
): Promise<void> {
  // Delete old relationships from this file
  const deleteCypher = `
    MATCH (source:Node {filePath: $filePath})-[r]->()
    DELETE r
  `;
  
  await this.neo4jClient.runTransaction(
    deleteCypher,
    { filePath },
    'WRITE',
    'StorageManager-DeleteFileRels'
  );

  // Insert new relationships
  const preparedRels = relationships.map(r => 
    this.prepareRelationshipProperties(r)
  );

  // Group by type for batch insertion
  const relsByType = this.groupByType(preparedRels);
  
  for (const [type, rels] of Object.entries(relsByType)) {
    await this.saveRelationshipsBatch(type, rels);
  }

  logger.info(`Updated relationships for file: ${filePath} (${relationships.length} rels)`);
}

private groupByType(rels: any[]): Record<string, any[]> {
  return rels.reduce((acc, rel) => {
    if (!acc[rel.type]) acc[rel.type] = [];
    acc[rel.type].push(rel);
    return acc;
  }, {});
}
```

#### Integration with Parser

**File**: `src/analyzer/parser.ts`

New method for single-file parsing:
```typescript
/**
 * Parse a single file and return results without storing in tsResults.
 * Used by watch mode for incremental updates.
 */
async parseSingleFile(fileInfo: FileInfo): Promise<SingleFileParseResult | null> {
  const extension = fileInfo.extension.toLowerCase();
  
  if (['.ts', '.tsx', '.js', '.jsx'].includes(extension)) {
    // Create minimal Project for just this file
    const project = new Project({
      tsConfigFilePath: "tsconfig.json",
      skipAddingFilesFromTsConfig: true,
    });
    
    project.addSourceFileAtPath(fileInfo.path);
    
    const targetFiles = new Set([path.resolve(fileInfo.path).replace(/\\/g, "/")]);
    await this._parseTsProjectFilesBatch(project, targetFiles);
    
    const result = this.tsResults.get(fileInfo.path);
    this.tsResults.clear(); // Clean up immediately
    
    return result || null;
  } else if (extension === '.py') {
    // Python file
    await this.pythonParser.parseFile(fileInfo);
    // ... similar pattern
  }
  
  return null;
}
```

#### Testing

```typescript
// Unit test for file replacement
describe('StorageManager.replaceFileGraph', () => {
  it('should atomically replace file nodes and relationships', async () => {
    // Insert initial data
    const file1Nodes = [createNode('file1', 'func1'), createNode('file1', 'func2')];
    await storage.replaceFileGraph('file1.ts', file1Nodes, []);
    
    // Verify inserted
    const count1 = await neo4j.countNodes({filePath: 'file1.ts'});
    expect(count1).toBe(2);
    
    // Replace with different data
    const file1UpdatedNodes = [createNode('file1', 'func1'), createNode('file1', 'func3')];
    await storage.replaceFileGraph('file1.ts', file1UpdatedNodes, []);
    
    // Verify replaced (not duplicated)
    const count2 = await neo4j.countNodes({filePath: 'file1.ts'});
    expect(count2).toBe(2);
    
    // Verify func2 gone, func3 added
    const func2Exists = await neo4j.nodeExists({name: 'func2'});
    const func3Exists = await neo4j.nodeExists({name: 'func3'});
    expect(func2Exists).toBe(false);
    expect(func3Exists).toBe(true);
  });
});
```

---

### Phase 3: Dev Server + File Watcher
**Goal**: Implement live sync with watch mode  
**Timeline**: 1-2 weeks  
**Complexity**: High

#### New Command Structure

**File**: `src/commands/dev.ts`

```typescript
import chokidar from 'chokidar';
import { Parser } from '../analyzer/parser.js';
import { StorageManager } from '../analyzer/storage-manager.js';
import { Neo4jClient } from '../database/neo4j-client.js';
import { FileScanner } from '../scanner/file-scanner.js';
import { createContextLogger } from '../utils/logger.js';

const logger = createContextLogger('DevServer');

interface DevServerConfig {
  workspacePath: string;
  repositoryName: string;
  ignorePatterns: string[];
  neo4jUri: string;
  neo4jUser: string;
  neo4jPassword: string;
}

export class DevServer {
  private watcher: chokidar.FSWatcher | null = null;
  private parser: Parser;
  private storage: StorageManager;
  private neo4j: Neo4jClient;
  private changeQueue: ChangeQueue;
  private isInitialSyncComplete = false;

  constructor(private config: DevServerConfig) {
    this.neo4j = new Neo4jClient(
      config.neo4jUri,
      config.neo4jUser,
      config.neo4jPassword
    );
    this.storage = new StorageManager(this.neo4j);
    this.parser = new Parser(config.workspacePath);
    this.changeQueue = new ChangeQueue(this.processFileChange.bind(this));
  }

  /**
   * Start the dev server:
   * 1. Initial full sync
   * 2. Start file watcher
   * 3. Handle changes indefinitely
   */
  async start(): Promise<void> {
    logger.info('🚀 Starting CodeGraph dev server...');

    try {
      // 1. Connect to Neo4j
      await this.neo4j.connect();
      logger.info('✅ Connected to Neo4j');

      // 2. Initialize parser packages
      await this.parser.initializePackages();
      logger.info(`✅ Initialized ${this.parser.getPackages().length} packages`);

      // 3. Initial full sync
      await this.initialSync();
      this.isInitialSyncComplete = true;

      // 4. Start file watcher
      await this.startWatcher();

      // 5. Keep alive
      logger.info('✅ Dev server running - watching for changes...');
      this.setupGracefulShutdown();

    } catch (error) {
      logger.error('Failed to start dev server:', error);
      await this.shutdown();
      throw error;
    }
  }

  /**
   * Perform initial full sync using per-batch streaming
   */
  private async initialSync(): Promise<void> {
    logger.info('📦 Starting initial full sync...');
    
    const scanner = new FileScanner(
      this.config.workspacePath,
      ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.cpp', '.c', '.cs'],
      this.config.ignorePatterns
    );

    const files = await scanner.scanDirectory();
    logger.info(`Found ${files.length} files to process`);

    // Use existing streaming batch logic from Phase 1
    await this.parser.parseFiles(files);

    // Pass 2: Relationship resolution
    logger.info('🔗 Resolving relationships (Pass 2)...');
    const processedFiles = this.parser.getProcessedTsFiles();
    await this.parser.repopulateProjectForPass2(processedFiles);
    
    const resolver = new RelationshipResolver([], []); // Nodes already in DB
    const pass2Rels = await resolver.resolveRelationships(
      this.parser.getTsProject(),
      this.parser.getImportResolver(),
      this.parser.getPackages()
    );

    // Write Pass 2 relationships
    const relsByType = this.groupRelationshipsByType(pass2Rels);
    for (const [type, rels] of Object.entries(relsByType)) {
      await this.storage.saveRelationshipsBatch(type, rels);
    }

    logger.info('✅ Initial sync complete');
  }

  /**
   * Start chokidar file watcher
   */
  private async startWatcher(): Promise<void> {
    this.watcher = chokidar.watch(this.config.workspacePath, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        ...this.config.ignorePatterns.map(p => `**/${p}/**`)
      ],
      persistent: true,
      ignoreInitial: true, // We just did initial sync
      awaitWriteFinish: {
        stabilityThreshold: 300, // Wait 300ms after last change
        pollInterval: 100
      }
    });

    this.watcher
      .on('add', (path) => {
        logger.debug(`File added: ${path}`);
        this.changeQueue.enqueue({ type: 'add', path });
      })
      .on('change', (path) => {
        logger.debug(`File changed: ${path}`);
        this.changeQueue.enqueue({ type: 'change', path });
      })
      .on('unlink', (path) => {
        logger.debug(`File deleted: ${path}`);
        this.changeQueue.enqueue({ type: 'delete', path });
      })
      .on('error', (error) => {
        logger.error('Watcher error:', error);
      });

    logger.info('👀 File watcher started');
  }

  /**
   * Process a single file change
   */
  private async processFileChange(change: FileChange): Promise<void> {
    const { type, path: filePath } = change;

    try {
      if (type === 'delete') {
        await this.handleFileDeleted(filePath);
      } else {
        await this.handleFileChanged(filePath);
      }
    } catch (error) {
      logger.error(`Failed to process ${type} for ${filePath}:`, error);
    }
  }

  /**
   * Handle file deletion
   */
  private async handleFileDeleted(filePath: string): Promise<void> {
    logger.info(`🗑️  Deleting: ${filePath}`);
    await this.storage.deleteFileGraph(filePath);
    logger.info(`✅ Deleted: ${filePath}`);
  }

  /**
   * Handle file addition or modification
   */
  private async handleFileChanged(filePath: string): Promise<void> {
    logger.info(`🔄 Syncing: ${filePath}`);

    // Parse single file
    const fileInfo = {
      path: filePath,
      name: path.basename(filePath),
      extension: path.extname(filePath)
    };

    const result = await this.parser.parseSingleFile(fileInfo);
    
    if (!result) {
      logger.warn(`No result for file: ${filePath}`);
      return;
    }

    // Replace in Neo4j atomically
    await this.storage.replaceFileGraph(
      filePath,
      result.nodes,
      result.relationships
    );

    logger.info(`✅ Synced: ${filePath} (${result.nodes.length} nodes)`);

    // TODO: Update dependent files (Phase 4)
  }

  /**
   * Graceful shutdown
   */
  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      logger.info('Shutting down dev server...');
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  async shutdown(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      logger.info('File watcher stopped');
    }

    if (this.neo4j) {
      await this.neo4j.close();
      logger.info('Neo4j connection closed');
    }
  }

  private groupRelationshipsByType(rels: RelationshipInfo[]): Record<string, RelationshipInfo[]> {
    return rels.reduce((acc, rel) => {
      if (!acc[rel.type]) acc[rel.type] = [];
      acc[rel.type].push(rel);
      return acc;
    }, {} as Record<string, RelationshipInfo[]>);
  }
}

/**
 * Debounced change queue to batch rapid file changes
 */
class ChangeQueue {
  private queue = new Map<string, FileChange>();
  private timer: NodeJS.Timeout | null = null;
  private readonly debounceMs = 300;

  constructor(private processor: (change: FileChange) => Promise<void>) {}

  enqueue(change: FileChange): void {
    // Add to queue (overwrites previous change for same file)
    this.queue.set(change.path, change);

    // Reset debounce timer
    if (this.timer) clearTimeout(this.timer);
    
    this.timer = setTimeout(() => {
      this.processBatch();
    }, this.debounceMs);
  }

  private async processBatch(): Promise<void> {
    const changes = Array.from(this.queue.values());
    this.queue.clear();

    logger.info(`Processing ${changes.length} file changes...`);

    // Process sequentially to avoid race conditions
    for (const change of changes) {
      await this.processor(change);
    }

    logger.info(`✅ Processed ${changes.length} changes`);
  }
}

interface FileChange {
  type: 'add' | 'change' | 'delete';
  path: string;
}
```

#### CLI Integration

**File**: `src/cli.ts`

```typescript
import { Command } from 'commander';
import { DevServer } from './commands/dev.js';

const program = new Command();

program
  .name('codegraph')
  .description('Live code graph database')
  .version('1.0.0');

// Existing sync command
program
  .command('sync')
  .description('One-time sync of codebase')
  // ... existing sync logic

// NEW: Dev server command
program
  .command('dev')
  .description('Start dev server with live file watching')
  .option('-w, --watch', 'Enable file watching (default: true)')
  .option('-c, --config <path>', 'Path to workspace config', '.codegraph/workspace.json')
  .option('--repo <name>', 'Specific repository to watch')
  .action(async (options) => {
    const config = loadWorkspaceConfig(options.config);
    const repo = options.repo 
      ? config.repositories.find(r => r.name === options.repo)
      : config.repositories[0];

    if (!repo) {
      logger.error('No repository found');
      process.exit(1);
    }

    const devServer = new DevServer({
      workspacePath: repo.path,
      repositoryName: repo.name,
      ignorePatterns: config.ignorePatterns,
      neo4jUri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      neo4jUser: process.env.NEO4J_USER || 'neo4j',
      neo4jPassword: process.env.NEO4J_PASSWORD || 'password'
    });

    await devServer.start();
  });

program.parse();
```

#### Usage Examples

```bash
# Start dev server for monorepo-3.0
codegraph dev --config .codegraph/workspace.json --repo monorepo-3.0

# Server starts:
# 1. Full sync (per-batch streaming) - 20-30 minutes
# 2. File watcher active
# 3. Edit any .ts file → synced to Neo4j in <500ms
```

---

### Phase 4: Smart Relationship Updates (Cross-File Dependencies)
**Goal**: Minimize Pass 2 re-processing on file changes  
**Timeline**: 1 week  
**Complexity**: High

#### Problem Statement

When `fileA.ts` imports from `fileB.ts`:
```typescript
// fileA.ts
import { helperFn } from './fileB';

export function main() {
  helperFn(); // CALLS relationship to fileB
}
```

If `fileB.ts` changes (rename `helperFn` → `helper`), the relationship from `fileA` becomes stale.

**Current naive approach**: Re-run full Pass 2 (reload all 1,717 files)
**Smart approach**: Only update files that import the changed file

#### Dependency Tracker Implementation

**File**: `src/analyzer/dependency-tracker.ts`

```typescript
import { createContextLogger } from '../utils/logger.js';

const logger = createContextLogger('DependencyTracker');

/**
 * Tracks import dependencies between files to enable incremental Pass 2 updates.
 * 
 * Structure:
 * - reverseDeps: Map<filePath, Set<filePath>> = "who imports this file?"
 * - forwardDeps: Map<filePath, Set<filePath>> = "what does this file import?"
 */
export class DependencyTracker {
  // Reverse dependencies: file → files that import it
  private reverseDeps = new Map<string, Set<string>>();
  
  // Forward dependencies: file → files it imports
  private forwardDeps = new Map<string, Set<string>>();

  /**
   * Build dependency graph from import relationships
   */
  buildFromImportRelationships(relationships: RelationshipInfo[]): void {
    logger.info('Building dependency graph from import relationships...');
    
    const importRels = relationships.filter(r => r.type === 'IMPORTS');
    
    for (const rel of importRels) {
      const importerFile = rel.sourceFilePath; // File doing the import
      const importedFile = rel.targetFilePath; // File being imported

      // Add forward dependency
      if (!this.forwardDeps.has(importerFile)) {
        this.forwardDeps.set(importerFile, new Set());
      }
      this.forwardDeps.get(importerFile)!.add(importedFile);

      // Add reverse dependency
      if (!this.reverseDeps.has(importedFile)) {
        this.reverseDeps.set(importedFile, new Set());
      }
      this.reverseDeps.get(importedFile)!.add(importerFile);
    }

    logger.info(`Dependency graph built: ${this.reverseDeps.size} files with importers`);
  }

  /**
   * Get files that import the specified file (reverse dependencies)
   */
  getImporters(filePath: string): string[] {
    return Array.from(this.reverseDeps.get(filePath) || []);
  }

  /**
   * Get files that the specified file imports (forward dependencies)
   */
  getImports(filePath: string): string[] {
    return Array.from(this.forwardDeps.get(filePath) || []);
  }

  /**
   * Get transitive dependencies up to a certain depth
   */
  getTransitiveImporters(filePath: string, maxDepth = 2): Set<string> {
    const result = new Set<string>();
    const queue: Array<{file: string; depth: number}> = [{file: filePath, depth: 0}];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const {file, depth} = queue.shift()!;
      
      if (visited.has(file) || depth > maxDepth) continue;
      visited.add(file);

      const importers = this.getImporters(file);
      for (const importer of importers) {
        result.add(importer);
        queue.push({file: importer, depth: depth + 1});
      }
    }

    return result;
  }

  /**
   * Update dependencies when a file changes
   */
  updateFile(filePath: string, imports: string[]): void {
    // Remove old forward deps
    const oldImports = this.forwardDeps.get(filePath) || new Set();
    for (const oldImport of oldImports) {
      this.reverseDeps.get(oldImport)?.delete(filePath);
    }

    // Add new forward deps
    this.forwardDeps.set(filePath, new Set(imports));
    for (const newImport of imports) {
      if (!this.reverseDeps.has(newImport)) {
        this.reverseDeps.set(newImport, new Set());
      }
      this.reverseDeps.get(newImport)!.add(filePath);
    }
  }

  /**
   * Remove file from dependency graph
   */
  removeFile(filePath: string): void {
    // Remove forward deps
    const imports = this.forwardDeps.get(filePath) || new Set();
    for (const imported of imports) {
      this.reverseDeps.get(imported)?.delete(filePath);
    }
    this.forwardDeps.delete(filePath);

    // Remove reverse deps
    const importers = this.reverseDeps.get(filePath) || new Set();
    for (const importer of importers) {
      this.forwardDeps.get(importer)?.delete(filePath);
    }
    this.reverseDeps.delete(filePath);
  }
}
```

#### Integration with DevServer

**File**: `src/commands/dev.ts` (updated)

```typescript
export class DevServer {
  private dependencyTracker: DependencyTracker;

  async start(): Promise<void> {
    // ... existing initialization

    // Build dependency graph after initial sync
    logger.info('🔗 Building dependency graph...');
    const importRels = await this.fetchImportRelationships();
    this.dependencyTracker.buildFromImportRelationships(importRels);
    logger.info('✅ Dependency graph ready');

    await this.startWatcher();
  }

  /**
   * Handle file change with smart relationship updates
   */
  private async handleFileChanged(filePath: string): Promise<void> {
    logger.info(`🔄 Syncing: ${filePath}`);

    // 1. Parse and update the changed file
    const result = await this.parser.parseSingleFile(fileInfo);
    await this.storage.replaceFileGraph(filePath, result.nodes, result.relationships);

    // 2. Extract imports from this file
    const imports = result.relationships
      .filter(r => r.type === 'IMPORTS')
      .map(r => r.targetFilePath);

    // Update dependency graph
    this.dependencyTracker.updateFile(filePath, imports);

    // 3. Find files affected by this change
    const affectedFiles = this.dependencyTracker.getImporters(filePath);
    
    if (affectedFiles.length > 0) {
      logger.info(`🔗 Updating ${affectedFiles.length} dependent files...`);
      
      for (const affectedFile of affectedFiles) {
        await this.updateFileRelationships(affectedFile);
      }
    }

    logger.info(`✅ Synced: ${filePath} (+${affectedFiles.length} dependents)`);
  }

  /**
   * Update only relationships for a file (Pass 2 for single file)
   */
  private async updateFileRelationships(filePath: string): Promise<void> {
    // Load just this file into ts-morph
    const project = new Project({
      tsConfigFilePath: "tsconfig.json",
      skipAddingFilesFromTsConfig: true
    });
    
    project.addSourceFileAtPath(filePath);
    
    // Fetch nodes from Neo4j (we don't have them in memory)
    const nodes = await this.fetchNodesFromNeo4j(filePath);
    
    // Resolve relationships for this file only
    const resolver = new RelationshipResolver(nodes, []);
    const relationships = await resolver.resolveRelationshipsForFile(
      project.getSourceFile(filePath)!,
      this.parser.getImportResolver(),
      this.parser.getPackages()
    );

    // Update relationships in Neo4j
    await this.storage.updateFileRelationships(filePath, relationships);
    
    logger.debug(`Updated relationships for: ${filePath}`);
  }

  /**
   * Fetch import relationships from Neo4j
   */
  private async fetchImportRelationships(): Promise<RelationshipInfo[]> {
    const query = `
      MATCH (source:Node)-[r:IMPORTS]->(target:Node)
      WHERE source.repository = $repo
      RETURN 
        source.filePath as sourceFilePath,
        target.filePath as targetFilePath,
        r.entityId as entityId,
        r.type as type
    `;

    const result = await this.neo4j.executeQuery(query, {
      repo: this.config.repositoryName
    });

    return result.records.map(record => ({
      sourceFilePath: record.get('sourceFilePath'),
      targetFilePath: record.get('targetFilePath'),
      entityId: record.get('entityId'),
      type: record.get('type'),
      // ... other fields
    }));
  }
}
```

#### Performance Optimization: Cascade Limiting

For large dependency graphs, limit cascade depth:

```typescript
private async handleFileChanged(filePath: string): Promise<void> {
  // ... parse and update file

  // Get importers up to 2 levels deep
  const affectedFiles = this.dependencyTracker.getTransitiveImporters(filePath, 2);
  
  if (affectedFiles.size > 100) {
    logger.warn(`File has ${affectedFiles.size} transitive dependents - limiting to direct importers`);
    affectedFiles = new Set(this.dependencyTracker.getImporters(filePath));
  }

  // Batch update affected files
  await this.batchUpdateRelationships(Array.from(affectedFiles));
}
```

---

## Production-Ready Features

### 1. Health Monitoring

**File**: `src/commands/dev.ts`

```typescript
interface DevServerHealth {
  status: 'initializing' | 'syncing' | 'watching' | 'error';
  uptime: number;
  stats: {
    filesProcessed: number;
    lastChangeAt: string | null;
    queueSize: number;
    errorCount: number;
  };
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
}

export class DevServer {
  private stats = {
    filesProcessed: 0,
    lastChangeAt: null as string | null,
    errorCount: 0,
  };

  getHealth(): DevServerHealth {
    const mem = process.memoryUsage();
    
    return {
      status: this.isInitialSyncComplete ? 'watching' : 'syncing',
      uptime: process.uptime(),
      stats: {
        filesProcessed: this.stats.filesProcessed,
        lastChangeAt: this.stats.lastChangeAt,
        queueSize: this.changeQueue.size(),
        errorCount: this.stats.errorCount,
      },
      memory: {
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        rss: Math.round(mem.rss / 1024 / 1024),
      }
    };
  }

  async startHealthEndpoint(port = 3001): Promise<void> {
    const express = require('express');
    const app = express();

    app.get('/health', (req, res) => {
      res.json(this.getHealth());
    });

    app.listen(port, () => {
      logger.info(`Health endpoint: http://localhost:${port}/health`);
    });
  }
}
```

### 2. Persistent State (Resume Capability)

**File**: `src/commands/dev-state.ts`

```typescript
interface DevServerState {
  lastFullSync: string;
  processedFiles: number;
  totalFiles: number;
  checksum: string; // Hash of workspace.json config
}

export class DevStateManager {
  private statePath: string;

  constructor(workspacePath: string) {
    this.statePath = path.join(workspacePath, '.codegraph', '.dev-state.json');
  }

  async loadState(): Promise<DevServerState | null> {
    try {
      const data = await fs.readFile(this.statePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async saveState(state: DevServerState): Promise<void> {
    await fs.writeFile(this.statePath, JSON.stringify(state, null, 2));
  }

  async needsFullSync(configChecksum: string): Promise<boolean> {
    const state = await this.loadState();
    
    if (!state) return true;
    
    // Config changed?
    if (state.checksum !== configChecksum) return true;
    
    // Last sync > 7 days ago?
    const lastSync = new Date(state.lastFullSync);
    const daysSince = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60 * 24);
    
    return daysSince > 7;
  }
}
```

### 3. Error Recovery

```typescript
export class DevServer {
  private async processFileChange(change: FileChange): Promise<void> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        if (change.type === 'delete') {
          await this.handleFileDeleted(change.path);
        } else {
          await this.handleFileChanged(change.path);
        }
        
        this.stats.filesProcessed++;
        return; // Success
        
      } catch (error) {
        attempt++;
        this.stats.errorCount++;
        
        logger.error(`Attempt ${attempt}/${maxRetries} failed for ${change.path}:`, error);
        
        if (attempt >= maxRetries) {
          logger.error(`Giving up on ${change.path} after ${maxRetries} attempts`);
          // Could add to dead-letter queue for manual review
          return;
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }
}
```

---

## Testing Strategy

### Unit Tests

```typescript
// storage-manager.test.ts
describe('StorageManager', () => {
  describe('replaceFileGraph', () => {
    it('should delete old nodes and create new ones atomically');
    it('should handle empty nodes array');
    it('should rollback on error');
  });
});

// dependency-tracker.test.ts
describe('DependencyTracker', () => {
  it('should build reverse dependencies from import relationships');
  it('should return direct importers');
  it('should calculate transitive importers with depth limit');
  it('should update dependencies when file changes');
});

// dev-server.test.ts (integration)
describe('DevServer', () => {
  it('should complete initial sync and start watcher');
  it('should handle file addition');
  it('should handle file modification');
  it('should handle file deletion');
  it('should update dependent files on change');
});
```

### Manual Testing Scenarios

**Scenario 1: Large Monorepo Initial Sync**
```bash
# Use monorepo-3.0 (1,717 files)
codegraph dev --repo monorepo-3.0

# Verify:
# - Completes without OOM (with 4GB heap)
# - Memory stays under 500MB
# - Nodes appear incrementally in Neo4j
# - File watcher starts after sync
```

**Scenario 2: Rapid File Changes**
```bash
# Start dev server
codegraph dev --repo test-project

# In another terminal, rapid edits:
for i in {1..50}; do
  echo "// Change $i" >> src/test.ts
  sleep 0.1
done

# Verify:
# - Changes are debounced (not 50 separate syncs)
# - Memory doesn't grow
# - Final state is correct in Neo4j
```

**Scenario 3: Cascading Dependency Update**
```typescript
// Setup: fileA → fileB → fileC (import chain)

// Edit fileC (rename exported function)
// Verify:
// - fileC updated immediately
// - fileB relationship updated (direct importer)
// - fileA relationship updated (transitive importer)
// - All within <2 seconds
```

---

## Performance Benchmarks & Success Criteria

### Memory Benchmarks

| Repository Size | Current (Batch) | Phase 1 (Streaming) | Phase 3 (Watch Mode) |
|----------------|-----------------|---------------------|----------------------|
| 100 files | 500MB | 200MB | 10MB |
| 1,000 files | 2GB | 200MB | 10MB |
| 10,000 files | OOM (20GB+) | 500MB | 10MB |
| 100,000 files | Impossible | 1GB | 10MB |

**Success Criteria:**
- ✅ Phase 1: monorepo-3.0 completes with 4GB heap (not 8GB)
- ✅ Phase 3: Memory stays under 100MB in watch mode

### Latency Benchmarks

| Operation | Target | Acceptable | Unacceptable |
|-----------|--------|------------|--------------|
| Initial full sync (1K files) | <10 min | <20 min | >30 min |
| Single file update | <100ms | <500ms | >1s |
| Dependent file cascade (10 files) | <500ms | <2s | >5s |
| File deletion | <50ms | <200ms | >500ms |

**Success Criteria:**
- ✅ File changes reflected in Neo4j within 500ms
- ✅ Dev server runs for 24+ hours without restart

### Scalability Targets

- ✅ Support 100,000+ file repositories
- ✅ Handle 100+ file changes per minute
- ✅ Maintain constant memory regardless of repository size

---

## Migration Path

### For Existing Users

**Step 1**: Upgrade to Phase 1 (streaming batches)
```bash
git pull origin main
npm install
npm run build

# Existing sync command now uses streaming
codegraph sync --repo monorepo-3.0
```

**Step 2**: Try dev mode (Phase 3)
```bash
# One-time initial sync, then live watch
codegraph dev --repo monorepo-3.0
```

**Step 3**: Update queries to use live graph
```cypher
// Graph is always up-to-date, no need to re-sync
MATCH (n:Function {repository: "monorepo-3.0"})
WHERE n.name CONTAINS "auth"
RETURN n
```

---

## Risks & Mitigations

### Risk 1: Neo4j Transaction Overhead
**Impact**: Too many small transactions slow down sync  
**Mitigation**: Batch file changes (debounce 300ms), transaction pooling

### Risk 2: Chokidar Memory Usage (100K+ files)
**Impact**: File watcher consumes significant memory  
**Mitigation**: Aggressive ignore patterns, consider polling mode for huge repos

### Risk 3: Dependency Cascade Explosion
**Impact**: Popular file changes trigger 1000s of updates  
**Mitigation**: Depth limiting (max 2 levels), batch processing, cascade throttling

### Risk 4: Race Conditions (Concurrent Changes)
**Impact**: Parallel file updates create inconsistent state  
**Mitigation**: Sequential processing via queue, file-level locks

### Risk 5: Pass 2 Performance Degradation
**Impact**: Re-loading files for relationship updates is slow  
**Mitigation**: Cache ts-morph SourceFiles, lazy loading, smart invalidation

---

## Future Enhancements

### 1. Incremental Pass 2 (Advanced)
Instead of re-loading entire file for relationship updates:
- Store minimal AST metadata in Neo4j
- Resolve relationships from metadata, not full parse
- Only re-parse if function signature changed

### 2. Multi-Repository Support
```bash
# Watch all repos in workspace.json simultaneously
codegraph dev --watch-all
```

### 3. IDE Integration
```typescript
// VSCode extension: real-time code insights
const graph = await codegraph.query({
  findReferences: 'functionName',
  repository: 'current'
});
```

### 4. Git Integration
```bash
# Auto-sync on git hooks
codegraph dev --git-hooks

# Only sync files changed in last commit
codegraph sync --git-diff HEAD~1
```

### 5. Distributed Mode
```typescript
// Multiple dev servers, shared Neo4j
codegraph dev --distributed --node-id=1
```

---

## Appendix A: Key Files Reference

### Source Files to Create/Modify

**Phase 1**:
- `src/analyzer/parser.ts` (modify: batch loop ~100 lines)
- `src/analyzer/analyzer-service.ts` (modify: collectResults flow ~50 lines)

**Phase 2**:
- `src/analyzer/storage-manager.ts` (add: 3 new methods ~200 lines)

**Phase 3**:
- `src/commands/dev.ts` (create: ~500 lines)
- `src/cli.ts` (modify: add dev command ~30 lines)

**Phase 4**:
- `src/analyzer/dependency-tracker.ts` (create: ~200 lines)
- `src/commands/dev.ts` (modify: integrate tracker ~100 lines)

**Production**:
- `src/commands/dev-state.ts` (create: ~100 lines)
- `src/commands/dev.ts` (modify: health endpoint ~50 lines)

### Configuration Files

**package.json** - Add dependencies:
```json
{
  "dependencies": {
    "chokidar": "^3.5.3",
    "express": "^4.18.2"
  }
}
```

**tsconfig.json** - No changes needed

**.codegraph/workspace.json** - No changes needed

---

## Appendix B: Architecture Diagrams

### Current Architecture (Batch Mode)
```
┌─────────────────────────────────────────────────┐
│          Scan & Parse All Files                  │
│                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │ Batch 1  │───▶│ Batch 2  │───▶│ Batch 18 │  │
│  │ 100 files│    │ 100 files│    │  9 files │  │
│  └──────────┘    └──────────┘    └──────────┘  │
│         │              │                │        │
│         └──────────────┴────────────────┘        │
│                        │                         │
│                        ▼                         │
│            ┌────────────────────┐                │
│            │  this.tsResults    │                │
│            │  (4GB+ in memory)  │                │
│            └────────────────────┘                │
│                        │                         │
│                        ▼                         │
│            ┌────────────────────┐                │
│            │   Pass 2 Resolve   │                │
│            │  (Load all files)  │                │
│            └────────────────────┘                │
│                        │                         │
│                        ▼                         │
│            ┌────────────────────┐                │
│            │  Write to Neo4j    │                │
│            │   (Once at end)    │                │
│            └────────────────────┘                │
└─────────────────────────────────────────────────┘
```

### New Architecture (Streaming + Watch)
```
┌─────────────────────────────────────────────────────┐
│                  Initial Sync                        │
│                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│  │ Batch 1  │    │ Batch 2  │    │ Batch 18 │      │
│  │ Parse    │    │ Parse    │    │ Parse    │      │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘      │
│       │               │               │             │
│       ▼               ▼               ▼             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐        │
│  │Write Neo│    │Write Neo│    │Write Neo│        │
│  └────┬────┘    └────┬────┘    └────┬────┘        │
│       │               │               │             │
│       ▼               ▼               ▼             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐        │
│  │Clear Mem│    │Clear Mem│    │Clear Mem│        │
│  └─────────┘    └─────────┘    └─────────┘        │
│                                                      │
│  Memory: ~200MB constant                            │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│                  Watch Mode                          │
│                                                      │
│  ┌──────────────────────────────────────┐           │
│  │       Chokidar File Watcher          │           │
│  │  (Monitors filesystem for changes)   │           │
│  └────────────┬─────────────────────────┘           │
│               │ File changed                         │
│               ▼                                      │
│  ┌──────────────────────────────────────┐           │
│  │      Debounce Queue (300ms)          │           │
│  └────────────┬─────────────────────────┘           │
│               │                                      │
│               ▼                                      │
│  ┌──────────────────────────────────────┐           │
│  │    Parse Single File (~10MB)         │           │
│  └────────────┬─────────────────────────┘           │
│               │                                      │
│               ▼                                      │
│  ┌──────────────────────────────────────┐           │
│  │  Replace in Neo4j (Atomic)           │           │
│  │  - Delete old nodes/rels             │           │
│  │  - Insert new nodes/rels             │           │
│  │  - Single transaction                │           │
│  └────────────┬─────────────────────────┘           │
│               │                                      │
│               ▼                                      │
│  ┌──────────────────────────────────────┐           │
│  │  Update Dependent Files              │           │
│  │  (via Dependency Tracker)            │           │
│  └────────────┬─────────────────────────┘           │
│               │                                      │
│               ▼                                      │
│  ┌──────────────────────────────────────┐           │
│  │    Clear Memory                       │           │
│  └──────────────────────────────────────┘           │
│                                                      │
│  Memory: ~10MB constant                             │
│  Latency: <500ms                                    │
└─────────────────────────────────────────────────────┘
```

---

## Appendix C: Comparison with Existing Tools

### CodeGraph vs Language Servers (LSP)

| Feature | LSP (TypeScript) | CodeGraph Live Sync |
|---------|------------------|---------------------|
| Scope | Single file/project | Cross-repository |
| Storage | In-memory | Persistent (Neo4j) |
| Query | Limited API | Full Cypher queries |
| Cross-language | No | Yes (TS, Python, Java, Go, C++) |
| Offline | No | Yes (query anytime) |
| IDE integration | Built-in | Requires plugin |

**Use case**: CodeGraph complements LSP, provides project-wide insights LSP can't

### CodeGraph vs Code Search (e.g., Sourcegraph)

| Feature | Sourcegraph | CodeGraph Live Sync |
|---------|-------------|---------------------|
| Search | Text-based | Semantic (AST-based) |
| Relationships | Limited | Full call graph |
| Real-time | No | Yes (<500ms) |
| Offline | No | Yes |
| Self-hosted | Enterprise only | Open source |
| Cost | $$$$ | Free |

**Use case**: CodeGraph is more powerful for architectural analysis

---

## Getting Started (TL;DR)

```bash
# 1. Clone and build
cd /Users/grop/ws/CodeGraph
npm install
npm run build

# 2. Run Phase 1 (streaming batch sync)
node --expose-gc dist/index.js workspace sync --repos monorepo-3.0

# After Phase 3 implemented:
# 3. Start dev server (live sync)
node dist/index.js dev --watch --repo monorepo-3.0

# 4. Edit any .ts file → auto-synced to Neo4j within 500ms

# 5. Query the live graph
# (in Neo4j Browser or via MCP)
MATCH (n:Function {repository: "monorepo-3.0"})
WHERE n.name CONTAINS "auth"
RETURN n
```

---

**END OF SPECIFICATION**

This spec provides complete context to start implementation in a fresh session. All architectural decisions, code examples, and implementation phases are documented.
