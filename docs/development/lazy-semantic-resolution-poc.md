# Lazy Semantic Resolution - POC Specification

> **Status**: Experimental POC  
> **Created**: 2025-11-14  
> **Purpose**: Explore "eventual consistency" approach to eliminate two-phase processing  
> **Relationship to v6**: Alternative Phase 0 experiment candidate (Experiment 5)  
> **Decision Gate**: If successful, becomes basis for v7 architecture

---

## Executive Summary

### The Core Innovation

Instead of requiring **immediate consistency** (all relationships resolved now), we propose **eventual consistency** where:

1. ✅ **Structural data is immediate** (<200ms): Files, classes, methods, ownership
2. ⏳ **Semantic data is deferred** (2-5s async): Imports, calls, inheritance  
3. 🔄 **Graph progressively improves**: Usable immediately, accurate eventually
4. 💪 **System is robust**: Queries can check completion status

### Key Insight from Analysis

The two-phase problem can be **partially solved** by recognizing that:

- **60% of data** (structural) doesn't need type information → can be truly incremental
- **40% of data** (semantic) needs type checker → must be batched or queued
- **Critical innovation**: Decouple these phases, make semantic async

### Comparison to Other Phase 0 Approaches

| Approach | Structural Speed | Semantic Speed | Complexity | Accuracy |
|----------|-----------------|----------------|------------|----------|
| **Experiment 1**: Selective Rehydration | Slow (5s) | Same time | High | 100% |
| **Experiment 2**: Neo4j Re-Resolution | Fast (0.5s) | Fast (0.5s) | Medium | ~95% |
| **Experiment 3**: Hybrid (local detect) | Fast (2s) | Conditional | High | Depends |
| **Experiment 5** (This POC): Lazy Semantic | **Very Fast (200ms)** | **Queued (2-5s)** | Medium | 100% |

**Advantage**: Best of both worlds - fastest initial response + eventual accuracy.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Data Classification](#data-classification)
3. [Component Design](#component-design)
4. [Implementation Plan](#implementation-plan)
5. [Success Metrics](#success-metrics)
6. [Risk Analysis](#risk-analysis)
7. [Integration with v6](#integration-with-v6)

---

## Architecture Overview

### High-Level Flow

```
File Change Event
      │
      ▼
┌────────────────────────────────────────┐
│ PHASE 1: Structural Parse (IMMEDIATE) │
│ ⏱️  <200ms                             │
│                                        │
│ • Parse AST (no type checking)        │
│ • Extract nodes (files, classes, etc) │
│ • Extract CONTAINS/OWNS relationships │
│ • Store import strings (unresolved)   │
│ • Write to Neo4j                      │
└───────────────┬────────────────────────┘
                │
                ▼
┌────────────────────────────────────────┐
│ Graph Status: STRUCTURALLY_COMPLETE   │
│                                        │
│ ✅ Can validate structure              │
│ ✅ Can run basic queries               │
│ ⚠️  Cannot validate dependencies yet   │
└───────────────┬────────────────────────┘
                │
                ▼ (async, non-blocking)
┌────────────────────────────────────────┐
│ Semantic Resolution Queue              │
│ • Batches pending files (10 at a time)│
│ • Priority: recent changes first       │
└───────────────┬────────────────────────┘
                │
                ▼ (2-5 seconds later)
┌────────────────────────────────────────┐
│ PHASE 2: Semantic Resolution (ASYNC)  │
│ ⏱️  2-5s (batched)                     │
│                                        │
│ • Create mini ts-morph Project        │
│ • Resolve import paths                 │
│ • Resolve call relationships           │
│ • Resolve inheritance chains           │
│ • Write to Neo4j                      │
└───────────────┬────────────────────────┘
                │
                ▼
┌────────────────────────────────────────┐
│ Graph Status: FULLY_COMPLETE           │
│                                        │
│ ✅ Can validate everything             │
│ ✅ Affected calculation accurate       │
└────────────────────────────────────────┘
```

### Key Architectural Decisions

#### Decision 1: Two-Status Model

```typescript
interface FileStatus {
  filePath: string;
  
  // Structural phase
  structuralComplete: boolean;
  structuralUpdatedAt: string;
  structuralVersion: number;
  
  // Semantic phase
  semanticComplete: boolean;
  semanticUpdatedAt: string | null;
  semanticVersion: number;
  semanticQueued: boolean;
  
  // Derived
  fullyComplete: boolean; // structural && semantic
}
```

Stored as properties on File nodes:

```cypher
CREATE (f:File {
  filePath: $path,
  structuralComplete: true,
  structuralUpdatedAt: $now,
  semanticComplete: false,
  semanticQueued: true
})
```

#### Decision 2: Relationship Status Tracking

```typescript
interface RelationshipMetadata {
  type: string; // IMPORTS, CALLS, EXTENDS
  phase: "structural" | "semantic";
  confidence: "verified" | "inferred" | "pending";
  createdAt: string;
  verifiedAt: string | null;
}
```

Example in Neo4j:

```cypher
// Structural relationship (immediate, high confidence)
CREATE (f:File)-[:CONTAINS {
  phase: 'structural',
  confidence: 'verified',
  createdAt: $now
}]->(c:Class)

// Semantic relationship (deferred, pending verification)
CREATE (f1:File)-[:IMPORTS {
  phase: 'semantic',
  confidence: 'pending',
  createdAt: $now,
  importString: '@/utils/helpers'  // Stored for later resolution
}]->(f2:File)
```

#### Decision 3: Query Patterns

All queries must handle partial completion:

```cypher
// ❌ BAD: Assumes complete graph
MATCH (f:File {filePath: $path})-[:IMPORTS]->(dep:File)
RETURN dep.filePath

// ✅ GOOD: Checks completion status
MATCH (f:File {filePath: $path})
WHERE f.semanticComplete = true
MATCH (f)-[:IMPORTS]->(dep:File)
RETURN dep.filePath

// ✅ ALTERNATIVE: Returns partial results with status
MATCH (f:File {filePath: $path})
OPTIONAL MATCH (f)-[:IMPORTS {confidence: 'verified'}]->(dep:File)
RETURN 
  f.semanticComplete as complete,
  collect(dep.filePath) as dependencies,
  CASE 
    WHEN f.semanticComplete THEN 'accurate'
    ELSE 'partial'
  END as status
```

---

## Data Classification

### Category A: Structural Data (Immediate)

**No type information needed** → Parse with simple AST walker → <200ms

| Data Type | Can Be Immediate? | Reasoning |
|-----------|-------------------|-----------|
| File nodes | ✅ Yes | File path, LOC, language |
| Class nodes | ✅ Yes | Name, location, modifiers |
| Method nodes | ✅ Yes | Name, location, parameters (as strings) |
| Function nodes | ✅ Yes | Name, location, arity |
| Variable nodes | ✅ Yes | Name, location, const/let |
| CONTAINS relationships | ✅ Yes | Syntactic parent-child |
| OWNS relationships | ✅ Yes | Class owns methods |
| Import statements (strings) | ✅ Yes | Literal text: `"@/utils"` |
| Export statements | ✅ Yes | What symbols are exported |
| Package boundaries | ✅ Yes | package.json locations |

**Implementation**: Use `@babel/parser` or `@swc/core` (no type checking):

```typescript
import { parse } from "@babel/parser";

async function parseStructural(filePath: string): Promise<StructuralData> {
  const source = await fs.readFile(filePath, "utf-8");
  
  // Fast parse (no type checking, no ts-morph)
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"]
  });
  
  const nodes: AstNode[] = [];
  const rels: RelationshipInfo[] = [];
  
  // Walk AST
  traverse(ast, {
    ClassDeclaration(path) {
      const classNode = {
        kind: "Class",
        name: path.node.id.name,
        startLine: path.node.loc.start.line,
        // ... extract location, modifiers
      };
      nodes.push(classNode);
      
      // CONTAINS relationship
      rels.push({
        type: "CONTAINS",
        source: fileEntityId,
        target: classNode.entityId,
        properties: { phase: "structural" }
      });
    },
    
    ImportDeclaration(path) {
      // Store as STRING (not resolved)
      const importString = path.node.source.value;
      // Store on file node or as property
    }
  });
  
  return { nodes, rels, imports: importStrings };
}
```

### Category B: Semantic Data (Deferred)

**Requires type information** → Need ts-morph Project → Queue for batch processing

| Data Type | Why Deferred? | Resolution Strategy |
|-----------|---------------|---------------------|
| IMPORTS relationships | Need path alias resolution | Mini Project with tsconfig |
| CALLS relationships | Need type of caller/callee | Type checker required |
| EXTENDS relationships | Need inheritance chain | Type graph traversal |
| IMPLEMENTS relationships | Need interface resolution | Type checker required |
| Type references | Need symbol resolution | Type checker required |
| Component usage | Need React/Vue types | Framework-specific resolver |

**Implementation**: Queue-based batch resolution:

```typescript
class SemanticResolutionQueue {
  private queue: string[] = [];
  private processing: boolean = false;
  
  enqueue(filePath: string) {
    if (!this.queue.includes(filePath)) {
      this.queue.push(filePath);
      logger.debug(`Queued for semantic resolution: ${filePath}`);
    }
    
    // Start processing if not already running
    if (!this.processing) {
      this.processQueue();
    }
  }
  
  private async processQueue() {
    this.processing = true;
    
    while (this.queue.length > 0) {
      // Take batch of 10 files
      const batch = this.queue.splice(0, 10);
      
      logger.info(`Resolving semantic relationships for ${batch.length} files`);
      
      try {
        await this.resolveBatch(batch);
      } catch (error) {
        logger.error(`Batch resolution failed:`, error);
        // Re-queue failed files
        this.queue.push(...batch);
      }
    }
    
    this.processing = false;
  }
  
  private async resolveBatch(filePaths: string[]) {
    // Create mini Project with these files + dependencies
    const miniProject = new Project({
      tsConfigFilePath: await findNearestTsConfig(filePaths[0]),
      skipAddingFilesFromTsConfig: true
    });
    
    // Add files
    for (const path of filePaths) {
      miniProject.addSourceFileAtPath(path);
    }
    
    // Add their dependencies (transitive)
    const deps = await findBatchDependencies(filePaths);
    for (const dep of deps) {
      miniProject.addSourceFileAtPath(dep);
    }
    
    // Resolve semantic relationships
    const resolver = new RelationshipResolver(/* ... */);
    const semanticRels = await resolver.resolveRelationships(
      miniProject,
      this.importResolver,
      this.packages
    );
    
    // Write to Neo4j
    await this.neo4jClient.runTransactionWork(async (tx) => {
      // Write relationships
      for (const rel of semanticRels) {
        await tx.run(`
          MATCH (source:Node {entityId: $sourceId})
          MATCH (target:Node {entityId: $targetId})
          MERGE (source)-[r:${rel.type}]->(target)
          SET r.phase = 'semantic',
              r.confidence = 'verified',
              r.verifiedAt = $now
        `, { sourceId: rel.source, targetId: rel.target, now: new Date().toISOString() });
      }
      
      // Mark files as semantically complete
      for (const path of filePaths) {
        await tx.run(`
          MATCH (f:File {filePath: $path})
          SET f.semanticComplete = true,
              f.semanticUpdatedAt = $now,
              f.semanticQueued = false
        `, { path, now: new Date().toISOString() });
      }
    }, "WRITE", "SemanticResolution");
    
    logger.info(`✅ Semantic resolution complete for ${filePaths.length} files`);
  }
}
```

---

## Component Design

### Component 1: StructuralParser

**File**: `src/analyzer/structural-parser.ts`

```typescript
/**
 * Structural Parser: Fast AST parsing without type checking
 * 
 * Uses @babel/parser for speed, extracts only structural data.
 * Target: <200ms for typical file.
 */

import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import type { File as BabelFile } from "@babel/types";
import { AstNode, RelationshipInfo } from "./types.js";
import { createContextLogger } from "../utils/logger.js";

const logger = createContextLogger("StructuralParser");

export interface StructuralParseResult {
  nodes: AstNode[];
  relationships: RelationshipInfo[];
  importStrings: string[]; // Unresolved import specifiers
  exportedSymbols: string[]; // What this file exports
  metadata: {
    parseTime: number;
    nodeCount: number;
    loc: number;
  };
}

export class StructuralParser {
  /**
   * Parse file structure without type checking
   */
  async parseStructural(filePath: string): Promise<StructuralParseResult> {
    const startTime = performance.now();
    
    // Read file
    const source = await fs.readFile(filePath, "utf-8");
    
    // Fast parse (no type checking)
    const ast: BabelFile = parse(source, {
      sourceType: "module",
      plugins: [
        "typescript",
        "jsx",
        "decorators-legacy",
        "classProperties"
      ],
      errorRecovery: true // Continue on parse errors
    });
    
    const result: StructuralParseResult = {
      nodes: [],
      relationships: [],
      importStrings: [],
      exportedSymbols: [],
      metadata: { parseTime: 0, nodeCount: 0, loc: 0 }
    };
    
    // Create file node
    const fileNode = this.createFileNode(filePath, source);
    result.nodes.push(fileNode);
    
    // Walk AST
    traverse(ast, {
      // Classes
      ClassDeclaration: (path) => {
        const classNode = this.createClassNode(path.node, filePath);
        result.nodes.push(classNode);
        
        result.relationships.push({
          type: "CONTAINS",
          source: fileNode.entityId,
          target: classNode.entityId,
          properties: { phase: "structural" }
        });
        
        // Methods
        for (const method of path.node.body.body) {
          if (method.type === "ClassMethod") {
            const methodNode = this.createMethodNode(method, filePath);
            result.nodes.push(methodNode);
            
            result.relationships.push({
              type: "OWNS",
              source: classNode.entityId,
              target: methodNode.entityId,
              properties: { phase: "structural" }
            });
          }
        }
      },
      
      // Functions
      FunctionDeclaration: (path) => {
        const funcNode = this.createFunctionNode(path.node, filePath);
        result.nodes.push(funcNode);
        
        result.relationships.push({
          type: "CONTAINS",
          source: fileNode.entityId,
          target: funcNode.entityId,
          properties: { phase: "structural" }
        });
      },
      
      // Imports (store as strings)
      ImportDeclaration: (path) => {
        const importString = path.node.source.value;
        result.importStrings.push(importString);
      },
      
      // Exports
      ExportNamedDeclaration: (path) => {
        if (path.node.declaration) {
          const name = this.extractExportName(path.node.declaration);
          if (name) result.exportedSymbols.push(name);
        }
      }
    });
    
    // Metadata
    result.metadata.parseTime = performance.now() - startTime;
    result.metadata.nodeCount = result.nodes.length;
    result.metadata.loc = source.split("\n").length;
    
    logger.debug(`Structural parse complete: ${filePath} (${result.metadata.parseTime.toFixed(0)}ms)`);
    
    return result;
  }
  
  private createFileNode(filePath: string, source: string): AstNode {
    return {
      id: `file:${filePath}`,
      entityId: `file:${filePath}`,
      kind: "File",
      name: path.basename(filePath),
      filePath,
      startLine: 1,
      endLine: source.split("\n").length,
      startColumn: 0,
      endColumn: 0,
      language: this.detectLanguage(filePath),
      loc: source.split("\n").length,
      createdAt: new Date().toISOString()
    };
  }
  
  // ... createClassNode, createMethodNode, etc.
}
```

### Component 2: SemanticResolver

**File**: `src/analyzer/semantic-resolver.ts`

```typescript
/**
 * Semantic Resolver: Deferred relationship resolution using ts-morph
 * 
 * Processes queued files in batches, uses mini ts-morph Projects.
 * Target: 2-5s per batch of 10 files.
 */

import { Project } from "ts-morph";
import { RelationshipResolver } from "./relationship-resolver.js";
import { Neo4jClient } from "../database/neo4j-client.js";
import { createContextLogger } from "../utils/logger.js";

const logger = createContextLogger("SemanticResolver");

export class SemanticResolver {
  private queue: string[] = [];
  private processing: boolean = false;
  private batchSize: number = 10;
  
  constructor(
    private neo4jClient: Neo4jClient,
    private importResolver: ImportResolver,
    private packages: PackageInfo[]
  ) {}
  
  /**
   * Queue a file for semantic resolution
   */
  enqueue(filePath: string, priority: "high" | "normal" = "normal") {
    if (!this.queue.includes(filePath)) {
      if (priority === "high") {
        this.queue.unshift(filePath); // Add to front
      } else {
        this.queue.push(filePath); // Add to back
      }
      
      logger.debug(`Queued for semantic resolution: ${filePath} (${this.queue.length} in queue)`);
    }
    
    // Mark as queued in Neo4j
    this.markAsQueued(filePath);
    
    // Start processing if idle
    if (!this.processing) {
      setImmediate(() => this.processQueue());
    }
  }
  
  /**
   * Process the queue in batches
   */
  private async processQueue() {
    if (this.processing) return;
    this.processing = true;
    
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.batchSize);
        
        logger.info(`Resolving semantic relationships for batch of ${batch.length} files`);
        
        try {
          await this.resolveBatch(batch);
        } catch (error) {
          logger.error(`Batch resolution failed, re-queuing:`, error);
          // Re-queue at end
          this.queue.push(...batch);
        }
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally {
      this.processing = false;
    }
  }
  
  /**
   * Resolve semantic relationships for a batch of files
   */
  private async resolveBatch(filePaths: string[]) {
    const startTime = performance.now();
    
    // 1. Find transitive dependencies
    const allNeeded = await this.findBatchDependencies(filePaths);
    logger.debug(`Batch needs ${allNeeded.length} total files (including deps)`);
    
    // 2. Create mini Project
    const miniProject = new Project({
      tsConfigFilePath: await findNearestTsConfig(filePaths[0]),
      skipAddingFilesFromTsConfig: true
    });
    
    for (const path of allNeeded) {
      miniProject.addSourceFileAtPath(path);
    }
    
    // 3. Get nodes from Neo4j (need them for RelationshipResolver)
    const nodes = await this.getNodesForFiles(filePaths);
    
    // 4. Resolve relationships
    const resolver = new RelationshipResolver(nodes, []);
    const semanticRels = await resolver.resolveRelationships(
      miniProject,
      this.importResolver,
      this.packages
    );
    
    // 5. Write to Neo4j
    await this.neo4jClient.runTransactionWork(async (tx) => {
      // Create relationships
      for (const rel of semanticRels) {
        await tx.run(`
          MATCH (source:Node {entityId: $sourceId})
          MATCH (target:Node {entityId: $targetId})
          MERGE (source)-[r:${rel.type}]->(target)
          SET r += $props,
              r.phase = 'semantic',
              r.confidence = 'verified',
              r.verifiedAt = $now
        `, {
          sourceId: rel.source,
          targetId: rel.target,
          props: rel.properties || {},
          now: new Date().toISOString()
        });
      }
      
      // Mark files as semantically complete
      for (const path of filePaths) {
        await tx.run(`
          MATCH (f:File {filePath: $path})
          SET f.semanticComplete = true,
              f.semanticUpdatedAt = $now,
              f.semanticQueued = false
        `, { path, now: new Date().toISOString() });
      }
    }, "WRITE", "SemanticResolution");
    
    const duration = performance.now() - startTime;
    logger.info(`✅ Semantic resolution complete: ${filePaths.length} files, ${semanticRels.length} rels (${duration.toFixed(0)}ms)`);
  }
  
  private async markAsQueued(filePath: string) {
    await this.neo4jClient.runTransaction(`
      MATCH (f:File {filePath: $path})
      SET f.semanticQueued = true
    `, { path }, "WRITE", "SemanticResolver");
  }
  
  // ... helper methods ...
}
```

### Component 3: Query Status Helpers

**File**: `src/devac/utils/graph-status.ts`

```typescript
/**
 * Graph Status Helpers: Check completion status of graph data
 */

import { Neo4jClient } from "../../database/neo4j-client.js";
import type { Result } from "neo4j-driver";

export interface GraphStatus {
  totalFiles: number;
  structuralComplete: number;
  semanticComplete: number;
  fullyComplete: number;
  queuedForSemantic: number;
  percentComplete: number;
}

export async function getGraphStatus(
  neo4jClient: Neo4jClient
): Promise<GraphStatus> {
  const result = await neo4jClient.runTransaction<Result>(`
    MATCH (f:File)
    RETURN 
      count(f) as total,
      sum(CASE WHEN f.structuralComplete THEN 1 ELSE 0 END) as structural,
      sum(CASE WHEN f.semanticComplete THEN 1 ELSE 0 END) as semantic,
      sum(CASE WHEN f.structuralComplete AND f.semanticComplete THEN 1 ELSE 0 END) as full,
      sum(CASE WHEN f.semanticQueued THEN 1 ELSE 0 END) as queued
  `, {}, "READ", "GraphStatus");
  
  const record = result.records[0];
  const total = record.get("total").toNumber();
  const full = record.get("full").toNumber();
  
  return {
    totalFiles: total,
    structuralComplete: record.get("structural").toNumber(),
    semanticComplete: record.get("semantic").toNumber(),
    fullyComplete: full,
    queuedForSemantic: record.get("queued").toNumber(),
    percentComplete: total > 0 ? (full / total) * 100 : 0
  };
}

export async function waitForSemanticComplete(
  neo4jClient: Neo4jClient,
  filePath: string,
  timeout: number = 10000
): Promise<boolean> {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    const result = await neo4jClient.runTransaction<Result>(`
      MATCH (f:File {filePath: $path})
      RETURN f.semanticComplete as complete
    `, { path: filePath }, "READ", "WaitForSemantic");
    
    if (result.records[0]?.get("complete") === true) {
      return true;
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return false; // Timeout
}
```

---

## Implementation Plan

### Week 1: Structural Parser

- [ ] Install `@babel/parser` and `@babel/traverse`
- [ ] Create `StructuralParser` class
- [ ] Implement `parseStructural()` method
- [ ] Add node creation helpers
- [ ] Add relationship creation for CONTAINS/OWNS
- [ ] Extract import strings (unresolved)
- [ ] Extract export symbols
- [ ] Add unit tests (parse various file types)
- [ ] Benchmark performance (<200ms target)

### Week 2: Semantic Resolver

- [ ] Create `SemanticResolver` class with queue
- [ ] Implement `enqueue()` and `processQueue()`
- [ ] Implement `resolveBatch()` with mini Project
- [ ] Add dependency discovery logic
- [ ] Integrate with existing `RelationshipResolver`
- [ ] Add Neo4j status updates
- [ ] Add unit tests (queue logic)
- [ ] Add integration tests (full flow)

### Week 3: Integration

- [ ] Create `LazyCodeGraphService` (orchestrator)
- [ ] Wire StructuralParser → SemanticResolver
- [ ] Add FileWatcher integration
- [ ] Add status tracking to File nodes
- [ ] Update affected calculator to check status
- [ ] Add query helpers for status checking
- [ ] Add monitoring/logging
- [ ] Integration tests (full cycle)

### Week 4: Validation

- [ ] Performance testing (<200ms structural, 2-5s semantic)
- [ ] Accuracy testing (vs full batch)
- [ ] Edge case testing (rapid changes, queue overflow)
- [ ] Memory profiling
- [ ] Compare to other Phase 0 experiments
- [ ] Document results
- [ ] Make Phase 0 decision

---

## Success Metrics

### Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Structural parse time | <200ms | 90th percentile |
| Semantic resolution time | 2-5s | Per batch of 10 files |
| Total update time | <5s | From file change to semantic complete |
| Memory usage | <500MB | Peak during semantic resolution |
| Queue throughput | >10 files/s | Sustained over 100 files |

### Accuracy Targets

| Metric | Target | Validation |
|--------|--------|------------|
| Node accuracy | 100% | Compare to full batch |
| Structural relationship accuracy | 100% | Compare to full batch |
| Semantic relationship accuracy | 100% | Compare to full batch |
| Export detection accuracy | >99% | Manual verification |

### Robustness Targets

| Scenario | Expected Behavior | Test |
|----------|-------------------|------|
| Rapid file changes | Queue batches efficiently | Edit 20 files quickly |
| Parse errors | Gracefully handle, continue | Invalid syntax file |
| Queue overflow | Batch intelligently, don't OOM | Queue 1000 files |
| Semantic failure | Re-queue, log error | Broken tsconfig |

---

## Risk Analysis

### Risk 1: Semantic Queue Gets Too Large

**Scenario**: User makes 100 file changes rapidly. Queue has 100 files, taking 50 seconds to process.

**Mitigation**:
```typescript
// Smart batching - group by package
class SemanticResolver {
  private smartBatch(): string[][] {
    // Group files by package
    const byPackage = groupBy(this.queue, f => findPackage(f));
    
    // Process each package as a batch
    return Object.values(byPackage);
  }
}
```

### Risk 2: Structural Parse is Still Too Slow

**Scenario**: Complex files take >500ms to parse structurally.

**Mitigation**:
- Use `@swc/core` instead of `@babel/parser` (5-10x faster)
- Limit structural extraction (skip doc comments, detailed type info)
- Consider Rust parser via WASM

### Risk 3: Accuracy Issues with Eventual Consistency

**Scenario**: User runs validation before semantic complete, gets wrong results.

**Mitigation**:
```typescript
async function validateFile(filePath: string) {
  const status = await getFileStatus(filePath);
  
  if (!status.semanticComplete) {
    // Wait for semantic or warn
    const complete = await waitForSemanticComplete(filePath, 5000);
    
    if (!complete) {
      return {
        status: "partial",
        warning: "Validation ran before semantic relationships resolved. Results may be incomplete.",
        canProceed: false
      };
    }
  }
  
  // Now safe to validate
  return runFullValidation(filePath);
}
```

---

## Integration with v6

### If This POC Succeeds

**Path to v7**:

1. Keep v6's infrastructure (Neo4jClient, FileWatcher, XState actors)
2. Replace v6's Experiment 1-3 with this lazy semantic approach
3. Update `GraphUpdaterActor` to use StructuralParser + SemanticResolver
4. Update all queries to check status
5. Add monitoring for queue health
6. Document as v7

### If This POC Fails

**Fallback**:
- Use v6's Experiment 1, 2, or 3 (whichever succeeds)
- This POC remains as "explored but not chosen"
- No v7 needed - v6 is the final spec

### Migration Path

```typescript
// v6 (current): Single-phase incremental
await graphUpdater.updateFile(filePath); // Blocks until complete

// v7 (lazy): Two-phase with status
const { structuralComplete } = await graphUpdater.updateFileStructural(filePath); // Fast
// ... time passes ...
const { semanticComplete } = await waitForSemanticComplete(filePath); // Async

// Backward compatible wrapper
async function updateFile(filePath: string): Promise<void> {
  await graphUpdater.updateFileStructural(filePath);
  await waitForSemanticComplete(filePath, 10000); // Wait up to 10s
  // Behaves like v6, but internally uses v7 architecture
}
```

---

## Appendix: Code Snippets

### A. Babel Parser Setup

```typescript
import { parse, ParserOptions } from "@babel/parser";

const parserOptions: ParserOptions = {
  sourceType: "module",
  plugins: [
    "typescript",
    "jsx",
    "decorators-legacy",
    "classProperties",
    "classPrivateProperties",
    "classPrivateMethods",
    "exportDefaultFrom",
    "exportNamespaceFrom",
    "dynamicImport",
    "nullishCoalescingOperator",
    "optionalChaining",
    "optionalCatchBinding"
  ],
  errorRecovery: true
};

const ast = parse(source, parserOptions);
```

### B. Queue Monitoring

```typescript
export class QueueMonitor {
  logStats() {
    setInterval(() => {
      const status = this.getQueueStatus();
      logger.info(`Queue: ${status.pending} pending, ${status.processing} processing, ${status.complete} complete`);
      
      if (status.pending > 50) {
        logger.warn(`Queue backlog: ${status.pending} files pending`);
      }
    }, 5000);
  }
}
```

### C. Smart Dependency Discovery

```typescript
async function findBatchDependencies(filePaths: string[]): Promise<string[]> {
  // Use Neo4j to find dependencies efficiently
  const result = await neo4jClient.runTransaction<Result>(`
    MATCH (f:File)
    WHERE f.filePath IN $paths
    MATCH (f)-[:IMPORTS*1..2]->(dep:File)
    RETURN DISTINCT dep.filePath as path
  `, { paths: filePaths }, "READ", "DependencyDiscovery");
  
  return result.records.map(r => r.get("path"));
}
```

---

## Decision Criteria

### This POC Should Become v7 If:

- ✅ Structural parse consistently <200ms
- ✅ Semantic resolution meets 2-5s target
- ✅ Accuracy matches full batch (100%)
- ✅ Queue handles 100+ files without issues
- ✅ User experience is better than v6 alternatives

### This POC Should Be Abandoned If:

- ❌ Structural parse >500ms regularly
- ❌ Semantic queue creates unacceptable lag
- ❌ Accuracy issues can't be resolved
- ❌ Complexity outweighs benefits
- ❌ v6 Experiment 1/2/3 is simpler and works

---

## Next Steps

1. **Implement Week 1**: StructuralParser
2. **Benchmark**: Confirm <200ms target
3. **Implement Week 2**: SemanticResolver
4. **Integration Test**: Full cycle
5. **Compare**: vs v6 Experiments 1-3
6. **Decide**: Phase 0 winner → v7 or stay with v6

**Timeline**: 4 weeks (includes v6 experiments for comparison)
**Risk Level**: Medium (new approach, but clear fallback to v6)
**Payoff**: Highest potential performance gain (10x structural, eventual semantic)
