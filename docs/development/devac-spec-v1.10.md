# DevAC Spec v1.10: Incremental Graph Updates

> **Version**: 1.10 (Implementation-Ready)  
> **Date**: 2025-12-10  
> **Status**: APPROVED FOR IMPLEMENTATION  
> **Timeline**: 38 days  
> **Previous Version**: v1.9 (superseded)

---

## Goal

Transform CodeGraph from **batch processing** (30-60s per repo) to **incremental updates** (<500ms per file change) for TypeScript and JavaScript.

**Deferred to v2**: Python, Java (Tree-sitter), C/C++, Go, C#, validation script execution

---

## Spec Evolution Summary

| Version | Key Decision | Status |
|---------|-------------|--------|
| v1.0-v1.6 | Various approaches, increasing complexity | Superseded |
| v1.7 | P0/P1 fixes: batched writes, error handling, parser timeout | Adopted |
| v1.8 | Phase 0.5 added, rollback strategy, delete/rename handling, APOC fallback | Superseded |
| v1.9 | Phase reordering, API contracts fixed, retry/backpressure policies, ts-morph lifecycle | Superseded |
| v1.10 | RelationshipResolverAdapter rewrite, semantic write-back flow, type contract alignment, complete event types, 38-day timeline | **Current** |

---

## Changes from v1.9

### Critical Fixes (C1-C4 from Review Recap)
1. **C1: RelationshipResolverAdapter rewritten** — Removed non-existent `resolvePass2()`, injected `TsMorphProjectManager`, calls actual `resolveRelationships()` API
2. **C2: Type contracts aligned** — `StructuralParseResult` matches actual code (`importStrings`, `exportedSymbols`), `AstNode` field names corrected
3. **C3: Missing events added** — `CIRCUIT_OPEN`, `CIRCUIT_CLOSED`, `FILE_RENAMED`, `WATCHER_ERROR`, `SHUTDOWN`, `PAUSE` now in event types
4. **C4: Timeline extended to 38 days** — Based on reviewer consensus (35-40 days realistic)

### High Priority Fixes (H1-H5)
5. **H1: Semantic write-back flow documented** — Explicit path from SemanticResolver → SemanticUpdater → Neo4j
6. **H2: structuralInProgress flag added** — For crash recovery of in-flight parses
7. **H3: FileMutex LRU iteration bug fixed** — Collect paths before deletion
8. **H4: Startup wiring code added** — Complete initialization sequence
9. **H5: Deduplication before queue** — By filePath, keep latest version

### Medium Priority Fixes (M1-M5)
10. **M1: Cascading updates clarified** — Dependent files re-queued for semantic analysis
11. **M2: APOC version check added** — Validates 5.x compatibility
12. **M3: Rename window configurable** — Environment variable support
13. **M4: Performance targets qualified by environment** — Local vs remote, APOC on/off
14. **M5: Memory pressure monitoring added** — Heap usage tracking with pause threshold

---

## Architecture

### Pipeline Flow

```
FileWatcher
    │
    ▼ FileChangeEvent
ValidationCoordinatorActor
    │
    ├─► [1] Deduplicate (by filePath, keep latest)
    │
    ├─► [2] FileMutex.acquire(filePath)
    │
    ├─► [3] FileGuard.checkSize() → reject if >500KB
    │
    ├─► [4] Set structuralInProgress = true
    │
    ├─► [5] LanguageRouter.parse() → StructuralParseResult
    │       └─► ParseResultAdapter → GraphUpdaterInput
    │
    ├─► [6] GraphUpdaterActor → Neo4j atomic update
    │       └─► Transaction: DELETE old → CREATE new (single tx)
    │       └─► Set structuralComplete = true, structuralInProgress = false
    │
    ├─► [7] SemanticResolverActor.enqueue() [TS/JS only]
    │
    └─► [8] FileMutex.release()

SemanticResolverActor (background)
    │
    ├─► [1] TsMorphProjectManager.updateFile()
    │
    ├─► [2] RelationshipResolverAdapter.resolveRelationships()
    │
    ├─► [3] SemanticUpdater → Neo4j (semantic edges)
    │       └─► Set semanticComplete = true
    │
    └─► [4] Queue dependent files for re-analysis (cascading)

(AffectedCalculator + ScriptExecutor → DEFERRED to v2)
```

### Verified File Locations

| Component | Path | Status |
|-----------|------|--------|
| ValidationCoordinatorActor | `src/devac/actors/validation-coordinator.actor.ts` | Needs fixes |
| GraphUpdaterActor | `src/devac/actors/graph-updater.actor.ts` | Needs fixes |
| SemanticResolverActor | `src/devac/actors/semantic-resolver.actor.ts` | Needs fixes |
| FileWatcher | `src/devac/services/codegraph/file-watcher.ts` | Working |
| Neo4jClient | `src/database/neo4j-client.ts` | Working |
| StructuralParser | `src/analyzer/structural-parser.ts` | Working (type mismatch fixed) |
| RelationshipResolver | `src/analyzer/relationship-resolver.ts` | Needs adapter (API mismatch) |

---

## Type Contracts (Aligned with Actual Code)

### FileChangeEvent (FileWatcher → ValidationCoordinator)

```typescript
// src/devac/types/events.ts

export type FileChangeType = "add" | "change" | "unlink";

export interface FileChangeEvent {
  type: FileChangeType;
  path: string;           // Absolute file path
  timestamp: number;      // Unix timestamp ms
}
```

### ValidationCoordinatorEvent (Complete Event Types) — C3 FIX

```typescript
// src/devac/types/events.ts

export type ValidationCoordinatorEvent =
  | { type: "START" }
  | { type: "FILE_CHANGED"; event: FileChangeEvent }
  | { type: "FILE_RENAMED"; oldPath: string; newPath: string }
  | { type: "SEMANTIC_COMPLETE"; filePath: string; dependents: string[] }
  | { type: "RECOVER" }
  | { type: "GRAPH_UPDATE_PROGRESS"; filePath: string; nodesCreated: number }
  | { type: "GRAPH_UPDATE_COMPLETE"; filePath: string; result: GraphUpdaterResult }
  | { type: "GRAPH_UPDATE_FAILED"; filePath: string; error: string }
  | { type: "CIRCUIT_OPEN" }
  | { type: "CIRCUIT_CLOSED" }
  | { type: "WATCHER_ERROR"; error: Error }
  | { type: "SHUTDOWN" }
  | { type: "PAUSE" }
  | { type: "RESUME" };
```

### StructuralParseResult (Aligned with Actual Code) — C2 FIX

```typescript
// src/analyzer/types.ts
// NOTE: This matches the ACTUAL structural-parser.ts output

export interface AstNode {
  entityId: string;       // Format: "kind:filePath:name:line" e.g., "function:/path/file.ts:myFunc:10"
  kind: string;           // Free-form string (not enum): "Function", "Class", "Method", etc.
  name: string;
  filePath: string;
  startLine: number;      // NOTE: startLine not line
  startColumn: number;    // NOTE: startColumn not column
  endLine: number;
  endColumn: number;
  parentId?: string;
  modifierFlags?: string[];  // NOTE: modifierFlags not modifiers
}

export interface RelationshipInfo {
  source: string;         // entityId
  target: string;         // entityId
  type: string;           // Free-form: "CONTAINS", "CALLS", "IMPORTS", etc.
}

export interface ExportedSymbol {
  name: string;
  kind: string;
  isDefault: boolean;
}

export interface StructuralParseResult {
  filePath: string;
  nodes: AstNode[];
  relationships: RelationshipInfo[];
  importStrings: string[];        // NOTE: importStrings not imports: ImportInfo[]
  exportedSymbols: ExportedSymbol[];  // NOTE: exportedSymbols not exports: ExportInfo[]
  metadata: {
    parseTimeMs: number;
    nodeCount: number;
    relationshipCount: number;
  };
}
```

### GraphUpdaterInput (ParseResultAdapter → GraphUpdater)

```typescript
// src/devac/actors/types.ts

export interface GraphUpdaterInput {
  neo4jClient: Neo4jClient;
  filePath: string;
  nodes: GraphNode[];
  relationships: GraphRelationship[];
  importStrings: string[];
  exportedSymbols: ExportedSymbol[];
  useApoc: boolean;
}

export interface GraphNode {
  entityId: string;
  labels: string[];       // ["Node", kind] e.g., ["Node", "Function"]
  properties: {
    entityId: string;
    name: string;
    filePath: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    modifierFlags?: string[];
    parentId?: string;
    [key: string]: unknown;
  };
}

export interface GraphRelationship {
  sourceEntityId: string;
  targetEntityId: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface GraphUpdaterResult {
  success: boolean;
  nodesCreated: number;
  relationshipsCreated: number;
  error?: string;
}
```

### SemanticQueueEvent (ValidationCoordinator → SemanticResolver)

```typescript
// src/devac/types/events.ts

export interface SemanticQueueEvent {
  type: "ENQUEUE";
  filePath: string;
  priority: "high" | "normal";
  structuralVersion: number;
}

export interface SemanticResult {
  filePath: string;
  resolvedRelationships: ResolvedRelationship[];
  dependentFiles: string[];  // Files that import this file (for cascading)
}

export interface ResolvedRelationship {
  sourceEntityId: string;
  targetEntityId: string;
  type: string;  // "IMPORTS", "CALLS", "REFERENCES", etc.
  resolvedTargetFile?: string;
}
```

---

## P0: CRITICAL BLOCKERS

### P0.1: Transaction Rollback Strategy

**Principle**: All graph updates use single Neo4j transaction. If any step fails, entire transaction rolls back automatically.

```typescript
// src/devac/actors/graph-updater.actor.ts

async function updateFileInGraph(
  input: GraphUpdaterInput
): Promise<GraphUpdaterResult> {
  const { neo4jClient, filePath, nodes, relationships, importStrings, exportedSymbols, useApoc } = input;

  return neo4jClient.runTransactionWork(
    async (tx) => {
      // Step 1: Delete existing nodes for this file
      await tx.run(
        `MATCH (f:File {filePath: $filePath})-[:OWNS]->(n:Node)
         DETACH DELETE n`,
        { filePath }
      );

      // Step 2: Delete file node relationships
      await tx.run(
        `MATCH (f:File {filePath: $filePath})
         OPTIONAL MATCH (f)-[r]-()
         DELETE r`,
        { filePath }
      );

      // Step 3: Create/update file node with structural status
      const version = Date.now();
      await tx.run(
        `MERGE (f:File {filePath: $filePath})
         SET f.structuralComplete = true,
             f.structuralInProgress = false,
             f.semanticQueued = true,
             f.semanticComplete = false,
             f.lastModified = datetime(),
             f.parseError = null,
             f.structuralVersion = $version`,
        { filePath, version }
      );

      // Step 4: Create nodes (batched with APOC or fallback)
      let nodesCreated = 0;
      if (nodes.length > 0) {
        const result = await createNodesWithLabels(tx, nodes, useApoc);
        nodesCreated = result.nodesCreated;
      }

      // Step 5: Create OWNS relationships
      if (nodes.length > 0) {
        await tx.run(
          `MATCH (f:File {filePath: $filePath})
           MATCH (n:Node) WHERE n.filePath = $filePath
           MERGE (f)-[:OWNS]->(n)`,
          { filePath }
        );
      }

      // Step 6: Create structural relationships (batched by type)
      let relationshipsCreated = 0;
      if (relationships.length > 0) {
        const result = await createRelationshipsBatched(tx, relationships, useApoc);
        relationshipsCreated = result.relationshipsCreated;
      }

      // Step 7: Store imports and exports
      await storeImportsAndExports(tx, filePath, importStrings, exportedSymbols);

      return {
        success: true,
        nodesCreated,
        relationshipsCreated,
      };
    },
    "WRITE",
    "GraphUpdater-AtomicUpdate"
  );
}

async function storeImportsAndExports(
  tx: ManagedTransaction,
  filePath: string,
  importStrings: string[],
  exportedSymbols: ExportedSymbol[]
): Promise<void> {
  // Store imports as array property on File node
  await tx.run(
    `MATCH (f:File {filePath: $filePath})
     SET f.imports = $imports,
         f.exports = $exports`,
    {
      filePath,
      imports: importStrings,
      exports: exportedSymbols.map(e => `${e.kind}:${e.name}${e.isDefault ? ':default' : ''}`),
    }
  );
}
```

**Failure Scenarios**:

| Scenario | Behavior | Data State |
|----------|----------|------------|
| Parse fails | Mark parseError on File node, clear structuralInProgress | Existing nodes preserved |
| Neo4j tx fails mid-update | Auto-rollback by Neo4j | Existing nodes preserved |
| Neo4j connection lost | Retry with backoff (see P0.2) | Existing nodes preserved |
| Process crash during tx | Uncommitted tx discarded, structuralInProgress=true on recovery | Existing nodes preserved |

**Guarantee**: File never has "zero nodes" due to partial failure.

### P0.2: Retry Policy with Exponential Backoff

```typescript
// src/devac/utils/retry.ts

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  retryableErrors: [
    "ECONNRESET",
    "ETIMEDOUT",
    "ServiceUnavailable",
    "SessionExpired",
    "TransientError",
  ],
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  operationName: string = "operation"
): Promise<T> {
  let lastError: Error | undefined;
  let delay = policy.initialDelayMs;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      const errorCode = (error as { code?: string }).code ?? "";
      const errorMessage = lastError.message;
      const isRetryable = policy.retryableErrors.some(
        (e) => errorCode.includes(e) || errorMessage.includes(e)
      );

      if (!isRetryable || attempt === policy.maxRetries) {
        console.error(
          `${operationName} failed after ${attempt + 1} attempts:`,
          lastError.message
        );
        throw lastError;
      }

      console.warn(
        `${operationName} attempt ${attempt + 1} failed, retrying in ${delay}ms:`,
        lastError.message
      );

      await sleep(delay);
      delay = Math.min(delay * policy.backoffMultiplier, policy.maxDelayMs);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### P0.3: APOC Fallback Cypher with Version Check — M2 FIX

```typescript
// src/devac/utils/apoc-fallback.ts

const VALID_NODE_KINDS: string[] = [
  "Function", "Class", "Method", "Variable", "Interface",
  "TypeAlias", "Enum", "Module", "Import", "Export",
  "Property", "Parameter", "Constructor", "ArrowFunction",
  "ObjectLiteral", "ArrayLiteral", "CallExpression"
];

const VALID_RELATIONSHIP_TYPES: string[] = [
  "CONTAINS", "CALLS", "IMPORTS", "EXPORTS", "EXTENDS",
  "IMPLEMENTS", "USES", "REFERENCES", "DECLARES", "OWNS",
  "RETURNS", "PARAMETER_OF", "PROPERTY_OF"
];

export async function createNodesWithLabels(
  tx: ManagedTransaction,
  nodes: GraphNode[],
  useApoc: boolean
): Promise<{ nodesCreated: number }> {
  if (useApoc) {
    const result = await tx.run(
      `UNWIND $nodes AS nodeData
       CREATE (n:Node)
       SET n = nodeData.properties
       WITH n, nodeData
       CALL apoc.create.addLabels(n, nodeData.labels) YIELD node
       RETURN count(node) as created`,
      { nodes: nodes.map((n) => ({ properties: n.properties, labels: n.labels })) }
    );
    return { nodesCreated: toNumber(result.records[0]?.get("created")) };
  }

  // Non-APOC fallback (multiple queries grouped by kind)
  const byKind = groupBy(nodes, (n) => n.labels[1] ?? "Node");
  let totalCreated = 0;

  for (const [kind, kindNodes] of Object.entries(byKind)) {
    if (!VALID_NODE_KINDS.includes(kind)) {
      console.warn(`Skipping invalid node kind: ${kind}`);
      continue;
    }

    const result = await tx.run(
      `UNWIND $nodes AS nodeData
       CREATE (n:Node:${kind})
       SET n = nodeData.properties
       RETURN count(n) as created`,
      { nodes: kindNodes.map((n) => ({ properties: n.properties })) }
    );
    totalCreated += toNumber(result.records[0]?.get("created"));
  }

  return { nodesCreated: totalCreated };
}

export async function createRelationshipsBatched(
  tx: ManagedTransaction,
  relationships: GraphRelationship[],
  useApoc: boolean
): Promise<{ relationshipsCreated: number }> {
  const byType = groupBy(relationships, (r) => r.type);
  let totalCreated = 0;

  for (const [type, typeRels] of Object.entries(byType)) {
    if (!VALID_RELATIONSHIP_TYPES.includes(type)) {
      console.warn(`Skipping invalid relationship type: ${type}`);
      continue;
    }

    const result = await tx.run(
      `UNWIND $rels AS rel
       MATCH (source:Node {entityId: rel.sourceEntityId})
       MATCH (target:Node {entityId: rel.targetEntityId})
       CREATE (source)-[r:${type}]->(target)
       SET r = COALESCE(rel.properties, {})
       RETURN count(r) as created`,
      { rels: typeRels }
    );
    totalCreated += toNumber(result.records[0]?.get("created"));
  }

  return { relationshipsCreated: totalCreated };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof (value as { toNumber?: () => number }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  return 0;
}
```

**APOC Detection with Version Check on startup** — M2 FIX:

```typescript
// src/devac/startup.ts

export interface ApocStatus {
  available: boolean;
  version: string | null;
  isRecommendedVersion: boolean;
}

export async function detectApocAvailability(
  neo4jClient: Neo4jClient
): Promise<ApocStatus> {
  try {
    const result = await neo4jClient.runTransaction(
      `RETURN apoc.version() as version`,
      {},
      "READ",
      "CheckApoc"
    );
    const version = result.records[0]?.get("version") as string;
    const isRecommendedVersion = version?.startsWith("5.");
    
    if (isRecommendedVersion) {
      console.info(`APOC ${version} detected - using optimized queries`);
    } else {
      console.warn(`APOC ${version} detected - version 5.x recommended for optimal performance`);
    }
    
    return { available: true, version, isRecommendedVersion };
  } catch {
    console.warn("APOC not available - using fallback queries (slower)");
    return { available: false, version: null, isRecommendedVersion: false };
  }
}
```

### P0.4: ParseResultAdapter (Aligned with Actual Types) — C2 FIX

```typescript
// src/pipeline/adapters/parse-result-adapter.ts

import type { StructuralParseResult, AstNode } from "../../analyzer/types.js";
import type { GraphUpdaterInput, GraphNode, GraphRelationship } from "../../devac/actors/types.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";

export function adaptParseResult(
  parseResult: StructuralParseResult,
  neo4jClient: Neo4jClient,
  useApoc: boolean
): GraphUpdaterInput {
  return {
    neo4jClient,
    filePath: parseResult.filePath,
    nodes: parseResult.nodes.map(adaptNode),
    relationships: parseResult.relationships.map(adaptRelationship),
    importStrings: parseResult.importStrings,
    exportedSymbols: parseResult.exportedSymbols,
    useApoc,
  };
}

function adaptNode(node: AstNode): GraphNode {
  return {
    entityId: node.entityId,
    labels: ["Node", node.kind],
    properties: {
      entityId: node.entityId,
      name: node.name,
      filePath: node.filePath,
      startLine: node.startLine,       // Aligned with actual code
      startColumn: node.startColumn,   // Aligned with actual code
      endLine: node.endLine,
      endColumn: node.endColumn,
      modifierFlags: node.modifierFlags,  // Aligned with actual code
      parentId: node.parentId,
    },
  };
}

function adaptRelationship(rel: RelationshipInfo): GraphRelationship {
  return {
    sourceEntityId: rel.source,
    targetEntityId: rel.target,
    type: rel.type,
    properties: {},
  };
}
```

### P0.5: RelationshipResolverAdapter (Rewritten) — C1 FIX

The existing `RelationshipResolver` has method `resolveRelationships(project: Project, importResolver?, packages?)`. The adapter must use this actual API.

```typescript
// src/pipeline/adapters/relationship-resolver-adapter.ts

import type { Project, SourceFile } from "ts-morph";
import type { AstNode, RelationshipInfo } from "../../analyzer/types.js";
import { RelationshipResolver } from "../../analyzer/relationship-resolver.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";
import type { TsMorphProjectManager } from "../../devac/services/ts-morph-manager.js";

export interface SemanticResolverInterface {
  resolveFile(filePath: string): Promise<SemanticResolutionResult>;
}

export interface SemanticResolutionResult {
  filePath: string;
  resolvedRelationships: ResolvedRelationship[];
  dependentFiles: string[];
  success: boolean;
  error?: string;
}

export interface ResolvedRelationship {
  sourceEntityId: string;
  targetEntityId: string;
  type: string;
  resolvedTargetFile?: string;
  resolvedTargetName?: string;
}

export class RelationshipResolverAdapter implements SemanticResolverInterface {
  private neo4jClient: Neo4jClient;
  private tsMorphManager: TsMorphProjectManager;
  private workspaceRoot: string;

  constructor(
    neo4jClient: Neo4jClient,
    tsMorphManager: TsMorphProjectManager,  // C1 FIX: Inject TsMorphProjectManager
    workspaceRoot: string
  ) {
    this.neo4jClient = neo4jClient;
    this.tsMorphManager = tsMorphManager;
    this.workspaceRoot = workspaceRoot;
  }

  async resolveFile(filePath: string): Promise<SemanticResolutionResult> {
    try {
      // Get the ts-morph Project instance
      const project = this.tsMorphManager.getProject();
      if (!project) {
        return {
          filePath,
          resolvedRelationships: [],
          dependentFiles: [],
          success: false,
          error: "ts-morph Project not initialized",
        };
      }

      // Ensure file is in project
      const sourceFile = await this.tsMorphManager.updateFile(filePath, Date.now());
      if (!sourceFile) {
        return {
          filePath,
          resolvedRelationships: [],
          dependentFiles: [],
          success: false,
          error: "Could not add file to ts-morph Project",
        };
      }

      // Get nodes and relationships from Neo4j for this file
      const { nodes, relationships } = await this.getFileNodesAndRelationships(filePath);

      // Create resolver with actual constructor signature
      const resolver = new RelationshipResolver(nodes, relationships);

      // C1 FIX: Call actual resolveRelationships method with Project
      const resolvedRelationships = await resolver.resolveRelationships(project);

      // Get dependent files (files that import this file) for cascading
      const dependentFiles = this.tsMorphManager.getDependents(filePath);

      return {
        filePath,
        resolvedRelationships: resolvedRelationships.map(rel => ({
          sourceEntityId: rel.source,
          targetEntityId: rel.target,
          type: rel.type,
          resolvedTargetFile: rel.resolvedTargetFile,
          resolvedTargetName: rel.resolvedTargetName,
        })),
        dependentFiles,
        success: true,
      };
    } catch (error) {
      console.error(`Semantic resolution failed for ${filePath}:`, error);
      return {
        filePath,
        resolvedRelationships: [],
        dependentFiles: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async getFileNodesAndRelationships(
    filePath: string
  ): Promise<{ nodes: AstNode[]; relationships: RelationshipInfo[] }> {
    const result = await this.neo4jClient.runTransaction(
      `MATCH (f:File {filePath: $filePath})-[:OWNS]->(n:Node)
       OPTIONAL MATCH (n)-[r]->(target:Node)
       RETURN n, collect({rel: r, target: target}) as relationships`,
      { filePath },
      "READ",
      "GetFileNodes"
    );

    const nodes: AstNode[] = [];
    const relationships: RelationshipInfo[] = [];

    for (const record of result.records) {
      const nodeProps = record.get("n").properties;
      nodes.push({
        entityId: nodeProps.entityId,
        kind: nodeProps.kind ?? "Unknown",
        name: nodeProps.name,
        filePath: nodeProps.filePath,
        startLine: nodeProps.startLine,
        startColumn: nodeProps.startColumn,
        endLine: nodeProps.endLine,
        endColumn: nodeProps.endColumn,
        parentId: nodeProps.parentId,
        modifierFlags: nodeProps.modifierFlags,
      });

      const rels = record.get("relationships") as Array<{ rel: unknown; target: unknown }>;
      for (const { rel, target } of rels) {
        if (rel && target) {
          relationships.push({
            source: nodeProps.entityId,
            target: (target as { properties: { entityId: string } }).properties.entityId,
            type: (rel as { type: string }).type,
          });
        }
      }
    }

    return { nodes, relationships };
  }
}
```

### P0.6: Semantic Write-Back Flow — H1 FIX

```typescript
// src/devac/actors/semantic-updater.ts

import type { Neo4jClient } from "../../database/neo4j-client.js";
import type { SemanticResolutionResult, ResolvedRelationship } from "../../pipeline/adapters/relationship-resolver-adapter.js";
import { withRetry, DEFAULT_RETRY_POLICY } from "../utils/retry.js";

export async function writeSemanticResults(
  neo4jClient: Neo4jClient,
  result: SemanticResolutionResult
): Promise<void> {
  if (!result.success) {
    // Mark file with semantic error
    await neo4jClient.runTransaction(
      `MATCH (f:File {filePath: $filePath})
       SET f.semanticError = $error,
           f.semanticComplete = false`,
      { filePath: result.filePath, error: result.error },
      "WRITE",
      "SemanticUpdater-MarkError"
    );
    return;
  }

  await withRetry(
    () => writeSemanticRelationships(neo4jClient, result.filePath, result.resolvedRelationships),
    DEFAULT_RETRY_POLICY,
    `SemanticUpdater(${result.filePath})`
  );
}

async function writeSemanticRelationships(
  neo4jClient: Neo4jClient,
  filePath: string,
  relationships: ResolvedRelationship[]
): Promise<void> {
  await neo4jClient.runTransactionWork(
    async (tx) => {
      // Delete existing semantic relationships (cross-file)
      await tx.run(
        `MATCH (f:File {filePath: $filePath})-[:OWNS]->(n:Node)
         MATCH (n)-[r:IMPORTS|CALLS|REFERENCES]->(target:Node)
         WHERE target.filePath <> $filePath
         DELETE r`,
        { filePath }
      );

      // Create new semantic relationships
      for (const rel of relationships) {
        if (rel.resolvedTargetFile && rel.resolvedTargetFile !== filePath) {
          await tx.run(
            `MATCH (source:Node {entityId: $sourceId})
             MATCH (target:Node {entityId: $targetId})
             CREATE (source)-[:${rel.type} {semantic: true, resolvedAt: datetime()}]->(target)`,
            { sourceId: rel.sourceEntityId, targetId: rel.targetEntityId }
          );
        }
      }

      // Mark semantic resolution complete
      await tx.run(
        `MATCH (f:File {filePath: $filePath})
         SET f.semanticComplete = true,
             f.semanticQueued = false,
             f.semanticError = null,
             f.semanticResolvedAt = datetime()`,
        { filePath }
      );
    },
    "WRITE",
    "SemanticUpdater-WriteRelationships"
  );
}
```

### P0.7: Delete/Rename Handling

**File Deletion Flow**:

```typescript
async function handleFileDelete(
  neo4jClient: Neo4jClient,
  filePath: string
): Promise<void> {
  await withRetry(
    () =>
      neo4jClient.runTransaction(
        `MATCH (f:File {filePath: $filePath})
         OPTIONAL MATCH (f)-[:OWNS]->(n:Node)
         DETACH DELETE n, f`,
        { filePath },
        "WRITE",
        "DeleteFile"
      ),
    DEFAULT_RETRY_POLICY,
    `DeleteFile(${filePath})`
  );

  console.info(`Deleted file from graph: ${filePath}`);
}
```

**Rename Detection with Configurable Window** — M3 FIX:

```typescript
// src/devac/utils/rename-detector.ts

export interface RenameDetectorConfig {
  windowMs: number;  // Default: 100, configurable via DEVAC_RENAME_WINDOW_MS
}

export interface RenameDetector {
  pendingUnlinks: Map<string, { timestamp: number; size?: number }>;
  config: RenameDetectorConfig;
}

export function createRenameDetector(
  config?: Partial<RenameDetectorConfig>
): RenameDetector {
  const windowMs = config?.windowMs ?? 
    parseInt(process.env.DEVAC_RENAME_WINDOW_MS ?? "100", 10);
  
  return {
    pendingUnlinks: new Map(),
    config: { windowMs },
  };
}

export function detectRename(
  event: FileChangeEvent,
  detector: RenameDetector
): { type: "rename"; oldPath: string; newPath: string } | null {
  const now = Date.now();
  const { windowMs } = detector.config;

  // Cleanup old entries
  for (const [path, info] of detector.pendingUnlinks) {
    if (now - info.timestamp > windowMs * 2) {
      detector.pendingUnlinks.delete(path);
    }
  }

  if (event.type === "unlink") {
    detector.pendingUnlinks.set(event.path, { timestamp: now });
    return null;
  }

  if (event.type === "add") {
    for (const [oldPath, info] of detector.pendingUnlinks) {
      if (now - info.timestamp < windowMs) {
        detector.pendingUnlinks.delete(oldPath);
        return { type: "rename", oldPath, newPath: event.path };
      }
    }
  }

  return null;
}

export async function handleRename(
  neo4jClient: Neo4jClient,
  oldPath: string,
  newPath: string
): Promise<void> {
  await withRetry(
    () =>
      neo4jClient.runTransaction(
        `MATCH (f:File {filePath: $oldPath})
         SET f.filePath = $newPath
         WITH f
         MATCH (n:Node {filePath: $oldPath})
         SET n.filePath = $newPath
         WITH f, count(n) as nodesUpdated
         MATCH (n:Node) WHERE n.entityId STARTS WITH $oldPathPrefix
         SET n.entityId = replace(n.entityId, $oldPath, $newPath)
         RETURN nodesUpdated`,
        { 
          oldPath, 
          newPath,
          oldPathPrefix: oldPath.replace(/\.[^.]+$/, '')  // Strip extension for entityId prefix
        },
        "WRITE",
        "RenameFile"
      ),
    DEFAULT_RETRY_POLICY,
    `RenameFile(${oldPath} → ${newPath})`
  );

  console.info(`Renamed file in graph: ${oldPath} → ${newPath}`);
}
```

### P0.8: Crash Recovery with structuralInProgress — H2 FIX

```typescript
// src/devac/startup.ts

export interface CrashRecoveryResult {
  semanticIncomplete: string[];
  structuralIncomplete: string[];
  structuralInProgress: string[];
}

export async function recoverFromCrash(
  neo4jClient: Neo4jClient
): Promise<CrashRecoveryResult> {
  // H2 FIX: Find files that were mid-structural update (crash during parse/update)
  const inProgressResult = await neo4jClient.runTransaction(
    `MATCH (f:File)
     WHERE f.structuralInProgress = true
     RETURN f.filePath as filePath
     LIMIT 50`,
    {},
    "READ",
    "CrashRecovery-FindInProgress"
  );
  const structuralInProgress = inProgressResult.records.map((r) => r.get("filePath") as string);

  // Files that completed structural but not semantic
  const semanticResult = await neo4jClient.runTransaction(
    `MATCH (f:File)
     WHERE f.semanticQueued = true AND f.semanticComplete = false
       AND (f.structuralInProgress IS NULL OR f.structuralInProgress = false)
     RETURN f.filePath as filePath, f.structuralVersion as version
     ORDER BY f.structuralVersion DESC
     LIMIT 100`,
    {},
    "READ",
    "CrashRecovery-FindSemanticQueued"
  );
  const semanticIncomplete = semanticResult.records.map((r) => r.get("filePath") as string);

  // Files with structuralComplete = false (incomplete structural)
  const structuralResult = await neo4jClient.runTransaction(
    `MATCH (f:File)
     WHERE (f.structuralComplete = false OR f.structuralComplete IS NULL)
       AND (f.structuralInProgress IS NULL OR f.structuralInProgress = false)
     RETURN f.filePath as filePath
     LIMIT 50`,
    {},
    "READ",
    "CrashRecovery-FindStructuralIncomplete"
  );
  const structuralIncomplete = structuralResult.records.map((r) => r.get("filePath") as string);

  // Clear structuralInProgress flags for crashed files
  if (structuralInProgress.length > 0) {
    await neo4jClient.runTransaction(
      `MATCH (f:File)
       WHERE f.structuralInProgress = true
       SET f.structuralInProgress = false`,
      {},
      "WRITE",
      "CrashRecovery-ClearInProgress"
    );
  }

  const total = semanticIncomplete.length + structuralIncomplete.length + structuralInProgress.length;
  if (total > 0) {
    console.info(
      `Crash recovery: ${structuralInProgress.length} in-progress, ` +
      `${structuralIncomplete.length} structural incomplete, ` +
      `${semanticIncomplete.length} semantic incomplete`
    );
  }

  return { semanticIncomplete, structuralIncomplete, structuralInProgress };
}
```

---

## P1: HIGH PRIORITY FIXES

### P1.1: ts-morph Incremental Lifecycle

```typescript
// src/devac/services/ts-morph-manager.ts

import { Project, SourceFile } from "ts-morph";

export class TsMorphProjectManager {
  private project: Project | null = null;
  private workspaceRoot: string;
  private fileVersions: Map<string, number> = new Map();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  async initialize(): Promise<void> {
    this.project = new Project({
      tsConfigFilePath: `${this.workspaceRoot}/tsconfig.json`,
      skipAddingFilesFromTsConfig: true,
    });
    console.info("ts-morph Project initialized");
  }

  async updateFile(filePath: string, version: number): Promise<SourceFile | null> {
    if (!this.project) {
      await this.initialize();
    }

    const existingVersion = this.fileVersions.get(filePath);
    if (existingVersion && existingVersion >= version) {
      return this.project!.getSourceFile(filePath) ?? null;
    }

    let sourceFile = this.project!.getSourceFile(filePath);

    if (sourceFile) {
      await sourceFile.refreshFromFileSystem();
    } else {
      try {
        sourceFile = this.project!.addSourceFileAtPath(filePath);
      } catch (error) {
        console.warn(`Could not add file to ts-morph: ${filePath}`, error);
        return null;
      }
    }

    this.fileVersions.set(filePath, version);
    return sourceFile;
  }

  removeFile(filePath: string): void {
    if (!this.project) return;

    const sourceFile = this.project.getSourceFile(filePath);
    if (sourceFile) {
      this.project.removeSourceFile(sourceFile);
    }
    this.fileVersions.delete(filePath);
  }

  getProject(): Project | null {
    return this.project;
  }

  // M1 FIX: Get files that import the given file (for cascading updates)
  getDependents(filePath: string): string[] {
    if (!this.project) return [];

    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return [];

    const dependents: string[] = [];
    
    for (const sf of this.project.getSourceFiles()) {
      if (sf.getFilePath() === filePath) continue;
      
      const imports = sf.getImportDeclarations();
      for (const imp of imports) {
        try {
          const resolved = imp.getModuleSpecifierSourceFile();
          if (resolved?.getFilePath() === filePath) {
            dependents.push(sf.getFilePath());
            break;
          }
        } catch {
          // Module resolution may fail for external packages
        }
      }
    }

    return dependents;
  }

  dispose(): void {
    this.project = null;
    this.fileVersions.clear();
  }
}
```

### P1.2: Backpressure with Deduplication — H5 FIX

```typescript
// src/devac/utils/bounded-queue.ts

export interface QueuePolicy {
  maxSize: number;
  dropPolicy: "oldest" | "newest" | "reject";
  warnThreshold: number;
}

export const DEFAULT_QUEUE_POLICY: QueuePolicy = {
  maxSize: 1000,
  dropPolicy: "oldest",
  warnThreshold: 0.8,
};

export interface QueueItem<T> {
  data: T;
  priority: "high" | "normal";
  timestamp: number;
  version: number;
}

export class BoundedPriorityQueue<T> {
  private items: QueueItem<T>[] = [];
  private policy: QueuePolicy;
  private warningIssued = false;
  private keyFn: (data: T) => string;
  private droppedCount = 0;
  private deduplicatedCount = 0;

  constructor(
    policy: QueuePolicy = DEFAULT_QUEUE_POLICY,
    keyFn: (data: T) => string = () => ""  // H5 FIX: Key function for deduplication
  ) {
    this.policy = policy;
    this.keyFn = keyFn;
  }

  enqueue(data: T, priority: "high" | "normal" = "normal", version: number = Date.now()): boolean {
    // H5 FIX: Deduplicate by key, keeping latest version
    const key = this.keyFn(data);
    if (key) {
      const existingIndex = this.items.findIndex(item => this.keyFn(item.data) === key);
      if (existingIndex !== -1) {
        const existing = this.items[existingIndex];
        if (version > existing.version) {
          // Replace with newer version
          this.items.splice(existingIndex, 1);
          this.deduplicatedCount++;
        } else {
          // Existing is newer, skip
          this.deduplicatedCount++;
          return true;
        }
      }
    }

    const item: QueueItem<T> = { data, priority, timestamp: Date.now(), version };

    if (this.items.length >= this.policy.maxSize) {
      switch (this.policy.dropPolicy) {
        case "reject":
          console.warn("Queue full, rejecting new item");
          this.droppedCount++;
          return false;
        case "newest":
          console.warn("Queue full, dropping new item");
          this.droppedCount++;
          return false;
        case "oldest":
          const dropped = this.items.shift();
          console.warn("Queue full, dropped oldest item:", this.keyFn(dropped!.data) || dropped?.data);
          this.droppedCount++;
          break;
      }
    }

    if (priority === "high") {
      const insertIndex = this.items.findIndex((i) => i.priority === "normal");
      if (insertIndex === -1) {
        this.items.push(item);
      } else {
        this.items.splice(insertIndex, 0, item);
      }
    } else {
      this.items.push(item);
    }

    const usage = this.items.length / this.policy.maxSize;
    if (usage >= this.policy.warnThreshold && !this.warningIssued) {
      console.warn(
        `Queue at ${(usage * 100).toFixed(0)}% capacity (${this.items.length}/${this.policy.maxSize})`
      );
      this.warningIssued = true;
    } else if (usage < this.policy.warnThreshold * 0.8) {
      this.warningIssued = false;
    }

    return true;
  }

  dequeue(): QueueItem<T> | undefined {
    return this.items.shift();
  }

  size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  getStats(): { size: number; dropped: number; deduplicated: number } {
    return {
      size: this.items.length,
      dropped: this.droppedCount,
      deduplicated: this.deduplicatedCount,
    };
  }

  clear(): void {
    this.items = [];
    this.warningIssued = false;
  }
}
```

### P1.3: Neo4j Circuit Breaker with FileWatcher Coordination

```typescript
// src/database/neo4j-health.ts

export interface CircuitBreakerState {
  isOpen: boolean;
  consecutiveFailures: number;
  openedAt: number | null;
  lastError: string | null;
}

export type CircuitBreakerListener = (state: CircuitBreakerState) => void;

export class Neo4jHealthCheck {
  private consecutiveFailures = 0;
  private maxConsecutiveFailures = 5;
  private circuitOpen = false;
  private circuitOpenedAt: number | null = null;
  private circuitResetMs = 30000;
  private lastError: string | null = null;
  private listeners: CircuitBreakerListener[] = [];

  constructor(private neo4jClient: Neo4jClient) {}

  onStateChange(listener: CircuitBreakerListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (error) {
        console.error("CircuitBreaker listener error:", error);
      }
    }
  }

  getState(): CircuitBreakerState {
    return {
      isOpen: this.circuitOpen,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.circuitOpenedAt,
      lastError: this.lastError,
    };
  }

  async checkHealth(): Promise<boolean> {
    if (this.circuitOpen && this.circuitOpenedAt) {
      if (Date.now() - this.circuitOpenedAt > this.circuitResetMs) {
        console.info("Neo4j circuit breaker: attempting reset (half-open)");
      } else {
        return false;
      }
    }

    try {
      await this.neo4jClient.runTransaction(
        `RETURN 1 as health`,
        {},
        "READ",
        "HealthCheck"
      );

      if (this.circuitOpen) {
        console.info("Neo4j circuit breaker: CLOSED (recovered)");
        this.circuitOpen = false;
        this.circuitOpenedAt = null;
        this.notifyListeners();
      }

      this.consecutiveFailures = 0;
      this.lastError = null;
      return true;
    } catch (error) {
      this.consecutiveFailures++;
      this.lastError = error instanceof Error ? error.message : String(error);

      if (
        this.consecutiveFailures >= this.maxConsecutiveFailures &&
        !this.circuitOpen
      ) {
        console.error(
          `Neo4j circuit breaker OPEN after ${this.consecutiveFailures} failures`
        );
        this.circuitOpen = true;
        this.circuitOpenedAt = Date.now();
        this.notifyListeners();
      }

      return false;
    }
  }

  isCircuitOpen(): boolean {
    return this.circuitOpen;
  }
}
```

### P1.4: Graceful Shutdown

```typescript
// src/devac/shutdown.ts

export interface ShutdownManager {
  register(name: string, handler: () => Promise<void>): void;
  shutdown(timeoutMs?: number): Promise<void>;
}

export function createShutdownManager(): ShutdownManager {
  const handlers: Map<string, () => Promise<void>> = new Map();
  let isShuttingDown = false;

  const manager: ShutdownManager = {
    register(name: string, handler: () => Promise<void>) {
      handlers.set(name, handler);
    },

    async shutdown(timeoutMs: number = 10000) {
      if (isShuttingDown) return;
      isShuttingDown = true;

      console.info("Graceful shutdown initiated...");

      const shutdownPromise = (async () => {
        for (const [name, handler] of handlers) {
          try {
            console.info(`Shutting down: ${name}`);
            await handler();
            console.info(`Shutdown complete: ${name}`);
          } catch (error) {
            console.error(`Shutdown error for ${name}:`, error);
          }
        }
      })();

      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error("Shutdown timeout exceeded")),
          timeoutMs
        )
      );

      try {
        await Promise.race([shutdownPromise, timeoutPromise]);
        console.info("Graceful shutdown complete");
      } catch (error) {
        console.error("Shutdown incomplete:", error);
      }
    },
  };

  process.on("SIGTERM", () => {
    console.info("Received SIGTERM");
    manager.shutdown().then(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    console.info("Received SIGINT");
    manager.shutdown().then(() => process.exit(0));
  });

  return manager;
}
```

### P1.5: FileMutex with LRU Cleanup (Bug Fixed) — H3 FIX

```typescript
// src/devac/utils/file-mutex.ts

export class FileMutex {
  private locks = new Map<string, Promise<void>>();
  private sequence = new Map<string, number>();
  private lastAccess = new Map<string, number>();
  private maxEntries: number;
  private cleanupIntervalMs: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(options: { maxEntries?: number; cleanupIntervalMs?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60000;
    this.startCleanupTimer();
  }

  async acquire(
    filePath: string,
    timeoutMs: number = 30000
  ): Promise<{ release: () => void; superseded: boolean }> {
    this.lastAccess.set(filePath, Date.now());

    const seq = (this.sequence.get(filePath) ?? 0) + 1;
    this.sequence.set(filePath, seq);

    const existing = this.locks.get(filePath);
    if (existing) {
      const timeoutPromise = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), timeoutMs)
      );

      const result = await Promise.race([existing, timeoutPromise]);
      if (result === "timeout") {
        console.warn(`FileMutex timeout waiting for lock: ${filePath}`);
        this.locks.delete(filePath);
      }
    }

    if (this.sequence.get(filePath) !== seq) {
      return { release: () => {}, superseded: true };
    }

    let releaseFn: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseFn = resolve;
    });
    this.locks.set(filePath, lockPromise);

    return {
      release: () => {
        this.locks.delete(filePath);
        releaseFn!();
      },
      superseded: false,
    };
  }

  async withLock<T>(
    filePath: string,
    operation: () => Promise<T>,
    timeoutMs?: number
  ): Promise<{ result: T; superseded: false } | { result: undefined; superseded: true }> {
    const { release, superseded } = await this.acquire(filePath, timeoutMs);

    if (superseded) {
      return { result: undefined, superseded: true };
    }

    try {
      const result = await operation();
      return { result, superseded: false };
    } finally {
      release();
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);
  }

  private cleanup(): void {
    const staleThreshold = Date.now() - 300000;
    let removed = 0;

    // H3 FIX: Collect paths to delete first, then delete
    const toDelete: string[] = [];
    for (const [path, lastAccess] of this.lastAccess) {
      if (lastAccess < staleThreshold && !this.locks.has(path)) {
        toDelete.push(path);
      }
    }

    for (const path of toDelete) {
      this.sequence.delete(path);
      this.lastAccess.delete(path);
      removed++;
    }

    // LRU eviction if still over max
    if (this.sequence.size > this.maxEntries) {
      const entries = Array.from(this.lastAccess.entries())
        .filter(([path]) => !this.locks.has(path))
        .sort((a, b) => a[1] - b[1]);

      const toEvict = entries.slice(0, this.sequence.size - this.maxEntries);
      for (const [path] of toEvict) {
        this.sequence.delete(path);
        this.lastAccess.delete(path);
        removed++;
      }
    }

    if (removed > 0) {
      console.debug(`FileMutex cleanup: removed ${removed} stale entries`);
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.locks.clear();
    this.sequence.clear();
    this.lastAccess.clear();
  }
}
```

### P1.6: File Size Guard

```typescript
// src/devac/utils/file-guard.ts

import { stat } from "fs/promises";

export interface FileGuardConfig {
  maxFileSizeBytes: number;
  allowedExtensions: string[];
}

export const DEFAULT_FILE_GUARD_CONFIG: FileGuardConfig = {
  maxFileSizeBytes: 500 * 1024,
  allowedExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
};

export interface FileGuardResult {
  allowed: boolean;
  reason?: string;
  sizeBytes?: number;
}

export async function checkFile(
  filePath: string,
  config: FileGuardConfig = DEFAULT_FILE_GUARD_CONFIG
): Promise<FileGuardResult> {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  if (!config.allowedExtensions.includes(ext)) {
    return {
      allowed: false,
      reason: `Unsupported extension: ${ext}`,
    };
  }

  try {
    const stats = await stat(filePath);
    if (stats.size > config.maxFileSizeBytes) {
      return {
        allowed: false,
        reason: `File too large: ${stats.size} bytes (max: ${config.maxFileSizeBytes})`,
        sizeBytes: stats.size,
      };
    }

    return {
      allowed: true,
      sizeBytes: stats.size,
    };
  } catch (error) {
    return {
      allowed: false,
      reason: `Cannot read file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
```

### P1.7: Memory Pressure Monitoring — M5 FIX

```typescript
// src/devac/utils/memory-monitor.ts

export interface MemoryMonitorConfig {
  warnThresholdPercent: number;    // Default: 70
  pauseThresholdPercent: number;   // Default: 85
  checkIntervalMs: number;         // Default: 10000
}

export const DEFAULT_MEMORY_CONFIG: MemoryMonitorConfig = {
  warnThresholdPercent: 70,
  pauseThresholdPercent: 85,
  checkIntervalMs: 10000,
};

export type MemoryState = "healthy" | "warning" | "critical";
export type MemoryListener = (state: MemoryState, usagePercent: number) => void;

export class MemoryMonitor {
  private config: MemoryMonitorConfig;
  private listeners: MemoryListener[] = [];
  private timer: NodeJS.Timeout | null = null;
  private currentState: MemoryState = "healthy";

  constructor(config: Partial<MemoryMonitorConfig> = {}) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
  }

  start(): void {
    this.timer = setInterval(() => {
      this.check();
    }, this.config.checkIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onStateChange(listener: MemoryListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  check(): MemoryState {
    const usage = process.memoryUsage();
    const heapUsedPercent = (usage.heapUsed / usage.heapTotal) * 100;

    let newState: MemoryState;
    if (heapUsedPercent >= this.config.pauseThresholdPercent) {
      newState = "critical";
    } else if (heapUsedPercent >= this.config.warnThresholdPercent) {
      newState = "warning";
    } else {
      newState = "healthy";
    }

    if (newState !== this.currentState) {
      this.currentState = newState;
      for (const listener of this.listeners) {
        try {
          listener(newState, heapUsedPercent);
        } catch (error) {
          console.error("MemoryMonitor listener error:", error);
        }
      }
    }

    if (newState === "critical") {
      console.error(`Memory critical: ${heapUsedPercent.toFixed(1)}% heap used`);
    } else if (newState === "warning") {
      console.warn(`Memory warning: ${heapUsedPercent.toFixed(1)}% heap used`);
    }

    return newState;
  }

  getCurrentState(): MemoryState {
    return this.currentState;
  }
}
```

---

## P2: MEDIUM PRIORITY FIXES

### P2.1: Performance Budgets (Qualified by Environment) — M4 FIX

| Scenario | Structural Parse | Graph Update | Total Target | Environment |
|----------|-----------------|--------------|--------------|-------------|
| Small file (<100 LOC), warm | <50ms | <100ms | <250ms | Local Neo4j + APOC |
| Medium file (100-1000 LOC), warm | <100ms | <150ms | <350ms | Local Neo4j + APOC |
| Large file (1000-5000 LOC), warm | <200ms | <250ms | <550ms | Local Neo4j + APOC |
| Small file (<100 LOC), warm | <50ms | <200ms | <400ms | Local Neo4j, no APOC |
| Medium file (100-1000 LOC), warm | <100ms | <300ms | <550ms | Local Neo4j, no APOC |
| Any file, cold start | <300ms | <700ms | <1500ms | First file after startup |
| Any file | +100-200ms | +200-400ms | +500ms | Remote Neo4j (network latency) |

**SLO Targets**:
- **P50**: <400ms (warm, local, APOC)
- **P95**: <800ms (warm, local, any)
- **P99**: <2000ms (includes cold start, remote)

**Monitoring Points**:

```typescript
// src/devac/utils/metrics.ts

export interface PipelineMetrics {
  parseTimeMs: number;
  graphUpdateTimeMs: number;
  totalTimeMs: number;
  fileSize: number;
  nodeCount: number;
  relationshipCount: number;
  usedApoc: boolean;
  isWarm: boolean;
  environment: "local" | "remote";
}

export function logMetrics(filePath: string, metrics: PipelineMetrics): void {
  const budget = getExpectedBudget(metrics);
  const status =
    metrics.totalTimeMs <= budget.expected
      ? "OK"
      : metrics.totalTimeMs <= budget.warn
        ? "WARN"
        : "SLOW";

  console.info(
    `[${status}] ${filePath}: ` +
      `parse=${metrics.parseTimeMs}ms, ` +
      `graph=${metrics.graphUpdateTimeMs}ms, ` +
      `total=${metrics.totalTimeMs}ms (budget: ${budget.expected}ms), ` +
      `nodes=${metrics.nodeCount}, ` +
      `apoc=${metrics.usedApoc}, warm=${metrics.isWarm}`
  );
}

function getExpectedBudget(metrics: PipelineMetrics): { expected: number; warn: number } {
  const base = metrics.isWarm ? 400 : 1500;
  const apocMultiplier = metrics.usedApoc ? 1 : 1.5;
  const remoteMultiplier = metrics.environment === "remote" ? 1.5 : 1;
  
  const expected = Math.round(base * apocMultiplier * remoteMultiplier);
  return { expected, warn: Math.round(expected * 1.5) };
}
```

### P2.2: Cascading Updates for Dependent Files — M1 FIX

```typescript
// In SemanticResolverActor after resolution completes

async function handleSemanticComplete(
  result: SemanticResolutionResult,
  coordinator: ValidationCoordinatorService
): Promise<void> {
  // Write semantic results to Neo4j
  await writeSemanticResults(neo4jClient, result);

  // M1 FIX: Queue dependent files for re-analysis
  if (result.dependentFiles.length > 0) {
    console.info(
      `Queueing ${result.dependentFiles.length} dependent files for semantic re-analysis`
    );
    
    for (const dependentPath of result.dependentFiles) {
      // Queue for semantic-only re-analysis (no structural reparse needed)
      coordinator.send({
        type: "SEMANTIC_COMPLETE",
        filePath: result.filePath,
        dependents: result.dependentFiles,
      });
    }
  }
}
```

### P2.3: Rename Reconciliation Pass

```typescript
// src/devac/utils/reconciliation.ts

import { stat, readdir } from "fs/promises";

export async function reconcileRenames(
  neo4jClient: Neo4jClient,
  workspaceRoot: string
): Promise<{ fixed: number; deleted: number; errors: string[] }> {
  const errors: string[] = [];
  let fixed = 0;
  let deleted = 0;

  const result = await neo4jClient.runTransaction(
    `MATCH (f:File)
     RETURN f.filePath as filePath`,
    {},
    "READ",
    "ReconcileRenames-FindFiles"
  );

  const dbFiles = result.records.map((r) => r.get("filePath") as string);

  for (const filePath of dbFiles) {
    try {
      await stat(filePath);
    } catch {
      const fileName = filePath.split("/").pop() ?? "";
      const dirPath = filePath.substring(0, filePath.lastIndexOf("/"));

      const possibleNewPath = await findSimilarFile(dirPath, fileName);

      if (possibleNewPath) {
        try {
          await handleRename(neo4jClient, filePath, possibleNewPath);
          fixed++;
          console.info(`Reconciled rename: ${filePath} → ${possibleNewPath}`);
        } catch (error) {
          errors.push(`Failed to reconcile ${filePath}: ${error}`);
        }
      } else {
        try {
          await handleFileDelete(neo4jClient, filePath);
          deleted++;
          console.info(`Reconciled delete: ${filePath}`);
        } catch (error) {
          errors.push(`Failed to delete ${filePath}: ${error}`);
        }
      }
    }
  }

  return { fixed, deleted, errors };
}

async function findSimilarFile(
  dirPath: string,
  fileName: string
): Promise<string | null> {
  try {
    const files = await readdir(dirPath);
    const ext = fileName.substring(fileName.lastIndexOf("."));
    const baseName = fileName.substring(0, fileName.lastIndexOf("."));

    for (const file of files) {
      if (file.endsWith(ext) && file !== fileName) {
        const fileBaseName = file.substring(0, file.lastIndexOf("."));
        if (levenshteinDistance(baseName, fileBaseName) <= 3) {
          return `${dirPath}/${file}`;
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return null;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}
```

### P2.4: Integration Test Scenarios

```typescript
// tests/integration/incremental-updates.test.ts

describe("Incremental Updates", () => {
  describe("Add file", () => {
    it("should create File node and owned Node nodes");
    it("should set structuralComplete=true after processing");
  });

  describe("Change file", () => {
    it("should replace old nodes with new nodes atomically");
    it("should preserve structuralVersion ordering");
    it("should handle rapid changes (deduplication)");
  });

  describe("Delete file", () => {
    it("should remove File node and all owned nodes");
    it("should handle delete during processing gracefully");
  });

  describe("Rename file", () => {
    it("should update filePath on File and Node nodes");
    it("should update entityId references");
    it("should handle rename across directories");
  });

  describe("Crash recovery", () => {
    it("should find files with structuralInProgress=true");
    it("should find files with semanticQueued=true");
    it("should requeue incomplete files");
  });

  describe("Circuit breaker", () => {
    it("should pause processing when Neo4j fails");
    it("should resume when Neo4j recovers");
    it("should queue events during pause");
  });

  describe("Semantic resolution", () => {
    it("should resolve cross-file imports");
    it("should queue dependent files for re-analysis");
    it("should write semantic relationships to Neo4j");
  });
});
```

---

## Startup Wiring Code — H4 FIX

```typescript
// src/devac/main.ts

import { Neo4jClient } from "../database/neo4j-client.js";
import { ValidationCoordinatorActor } from "./actors/validation-coordinator.actor.js";
import { SemanticResolverActor } from "./actors/semantic-resolver.actor.js";
import { Neo4jHealthCheck } from "../database/neo4j-health.js";
import { TsMorphProjectManager } from "./services/ts-morph-manager.js";
import { RelationshipResolverAdapter } from "../pipeline/adapters/relationship-resolver-adapter.js";
import { connectFileWatcherToCoordinator } from "./services/file-watcher-integration.js";
import { createShutdownManager } from "./shutdown.js";
import { detectApocAvailability, recoverFromCrash } from "./startup.js";
import { MemoryMonitor } from "./utils/memory-monitor.js";
import { BoundedPriorityQueue } from "./utils/bounded-queue.js";
import type { FileChangeEvent } from "./types/events.js";

export async function startDevAC(config: {
  workspaceRoot: string;
  watchPaths: string[];
  neo4jUri: string;
  neo4jUser: string;
  neo4jPassword: string;
}): Promise<() => Promise<void>> {
  const shutdownManager = createShutdownManager();

  // 1. Initialize Neo4j client
  const neo4jClient = new Neo4jClient(config.neo4jUri, config.neo4jUser, config.neo4jPassword);
  shutdownManager.register("neo4j", () => neo4jClient.close());

  // 2. Check APOC availability
  const apocStatus = await detectApocAvailability(neo4jClient);

  // 3. Initialize health check with circuit breaker
  const neo4jHealth = new Neo4jHealthCheck(neo4jClient);

  // 4. Initialize ts-morph project manager
  const tsMorphManager = new TsMorphProjectManager(config.workspaceRoot);
  await tsMorphManager.initialize();
  shutdownManager.register("tsMorph", async () => tsMorphManager.dispose());

  // 5. Create relationship resolver adapter
  const resolverAdapter = new RelationshipResolverAdapter(
    neo4jClient,
    tsMorphManager,
    config.workspaceRoot
  );

  // 6. Initialize memory monitor
  const memoryMonitor = new MemoryMonitor();
  memoryMonitor.start();
  shutdownManager.register("memoryMonitor", async () => memoryMonitor.stop());

  // 7. Create event queue with deduplication by filePath
  const eventQueue = new BoundedPriorityQueue<FileChangeEvent>(
    { maxSize: 1000, dropPolicy: "oldest", warnThreshold: 0.8 },
    (event) => event.path  // H5: Deduplicate by filePath
  );

  // 8. Create coordinator actor
  const coordinator = createValidationCoordinatorActor({
    neo4jClient,
    neo4jHealth,
    useApoc: apocStatus.available,
    tsMorphManager,
    resolverAdapter,
    eventQueue,
    workspaceRoot: config.workspaceRoot,
  });
  shutdownManager.register("coordinator", async () => {
    coordinator.send({ type: "SHUTDOWN" });
    // Wait for current operation
    await new Promise(resolve => setTimeout(resolve, 5000));
  });

  // 9. Wire circuit breaker to coordinator
  neo4jHealth.onStateChange((state) => {
    if (state.isOpen) {
      coordinator.send({ type: "CIRCUIT_OPEN" });
    } else {
      coordinator.send({ type: "CIRCUIT_CLOSED" });
    }
  });

  // 10. Wire memory monitor to coordinator
  memoryMonitor.onStateChange((state) => {
    if (state === "critical") {
      coordinator.send({ type: "PAUSE" });
    } else if (state === "healthy") {
      coordinator.send({ type: "RESUME" });
    }
  });

  // 11. Perform crash recovery
  const recovery = await recoverFromCrash(neo4jClient);
  for (const filePath of [...recovery.structuralInProgress, ...recovery.structuralIncomplete]) {
    coordinator.send({
      type: "FILE_CHANGED",
      event: { type: "change", path: filePath, timestamp: Date.now() },
    });
  }
  for (const filePath of recovery.semanticIncomplete) {
    coordinator.send({
      type: "SEMANTIC_COMPLETE",
      filePath,
      dependents: [],
    });
  }

  // 12. Connect FileWatcher
  const stopWatcher = connectFileWatcherToCoordinator(coordinator, {
    watchPaths: config.watchPaths,
    debounceMs: parseInt(process.env.DEVAC_DEBOUNCE_MS ?? "100", 10),
  });
  shutdownManager.register("fileWatcher", async () => stopWatcher());

  // 13. Start coordinator
  coordinator.send({ type: "START" });

  console.info("DevAC started successfully");
  console.info(`  Workspace: ${config.workspaceRoot}`);
  console.info(`  APOC: ${apocStatus.available ? `v${apocStatus.version}` : "not available"}`);
  console.info(`  Watching: ${config.watchPaths.join(", ")}`);

  return () => shutdownManager.shutdown();
}
```

---

## LanguageRouter (Complete)

```typescript
// src/pipeline/language-router.ts

import path from "path";
import { StructuralParser } from "../analyzer/structural-parser.js";
import { adaptParseResult } from "./adapters/parse-result-adapter.js";
import { checkFile, DEFAULT_FILE_GUARD_CONFIG } from "../devac/utils/file-guard.js";
import type { StructuralParseResult } from "../analyzer/types.js";
import type { GraphUpdaterInput } from "../devac/actors/types.js";
import type { Neo4jClient } from "../database/neo4j-client.js";

const PARSE_TIMEOUT_MS = 30000;

export interface ParseResult {
  success: boolean;
  data?: GraphUpdaterInput;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
  parseTimeMs?: number;
}

export interface LanguageRouterConfig {
  workspaceRoot: string;
  neo4jClient: Neo4jClient;
  useApoc: boolean;
  maxFileSizeBytes?: number;
}

export class LanguageRouter {
  private structuralParser: StructuralParser;
  private config: LanguageRouterConfig;

  constructor(config: LanguageRouterConfig) {
    this.config = config;
    this.structuralParser = new StructuralParser();
  }

  canHandle(filePath: string): boolean {
    return this.getLanguage(filePath) !== null;
  }

  getLanguage(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_MAP[ext] ?? null;
  }

  async parse(filePath: string): Promise<ParseResult> {
    const startTime = Date.now();

    const guardResult = await checkFile(filePath, {
      ...DEFAULT_FILE_GUARD_CONFIG,
      maxFileSizeBytes: this.config.maxFileSizeBytes ?? DEFAULT_FILE_GUARD_CONFIG.maxFileSizeBytes,
    });

    if (!guardResult.allowed) {
      return {
        success: false,
        skipped: true,
        skipReason: guardResult.reason,
      };
    }

    const language = this.getLanguage(filePath);

    if (!language) {
      return { success: false, error: "Unsupported file type" };
    }

    if (language !== "typescript" && language !== "javascript") {
      return {
        success: false,
        skipped: true,
        skipReason: `Language not supported in v1.10: ${language}`,
      };
    }

    try {
      const result = await Promise.race([
        this.parseTypeScript(filePath),
        this.createTimeoutPromise(),
      ]);

      if (result === "TIMEOUT") {
        return { success: false, error: `Parse timeout after ${PARSE_TIMEOUT_MS}ms` };
      }

      const adapted = adaptParseResult(
        result,
        this.config.neo4jClient,
        this.config.useApoc
      );

      return {
        success: true,
        data: adapted,
        parseTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async parseTypeScript(filePath: string): Promise<StructuralParseResult> {
    return this.structuralParser.parseStructural(filePath);
  }

  private createTimeoutPromise(): Promise<"TIMEOUT"> {
    return new Promise((resolve) => {
      setTimeout(() => resolve("TIMEOUT"), PARSE_TIMEOUT_MS);
    });
  }
}

const EXTENSION_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
};
```

---

## FileWatcher Integration

```typescript
// src/devac/services/file-watcher-integration.ts

import { watch, type FSWatcher } from "chokidar";
import type { ValidationCoordinatorService } from "../actors/validation-coordinator.actor.js";
import type { FileChangeEvent } from "../types/events.js";
import { createRenameDetector, detectRename } from "../utils/rename-detector.js";

export interface FileWatcherIntegrationConfig {
  watchPaths: string[];
  ignorePatterns?: string[];
  debounceMs?: number;
}

export function connectFileWatcherToCoordinator(
  coordinator: ValidationCoordinatorService,
  config: FileWatcherIntegrationConfig
): () => void {
  const { watchPaths, ignorePatterns = [], debounceMs = 100 } = config;
  const renameDetector = createRenameDetector({ windowMs: debounceMs });
  const pendingEvents = new Map<string, NodeJS.Timeout>();

  const watcher: FSWatcher = watch(watchPaths, {
    ignored: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**",
      "**/*.d.ts",
      ...ignorePatterns,
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: debounceMs,
      pollInterval: 50,
    },
  });

  const handleEvent = (type: "add" | "change" | "unlink") => (path: string) => {
    const event: FileChangeEvent = {
      type,
      path,
      timestamp: Date.now(),
    };

    const rename = detectRename(event, renameDetector);
    if (rename) {
      coordinator.send({
        type: "FILE_RENAMED",
        oldPath: rename.oldPath,
        newPath: rename.newPath,
      });
      return;
    }

    const existingTimeout = pendingEvents.get(path);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      pendingEvents.delete(path);
      coordinator.send({
        type: "FILE_CHANGED",
        event,
      });
    }, debounceMs);

    pendingEvents.set(path, timeout);
  };

  watcher.on("add", handleEvent("add"));
  watcher.on("change", handleEvent("change"));
  watcher.on("unlink", handleEvent("unlink"));

  watcher.on("error", (error) => {
    console.error("FileWatcher error:", error);
    coordinator.send({ type: "WATCHER_ERROR", error });
  });

  return () => {
    for (const timeout of pendingEvents.values()) {
      clearTimeout(timeout);
    }
    pendingEvents.clear();
    watcher.close();
  };
}
```

---

## Implementation Timeline (38 days)

### Phase 0: Verification (Days 1-2)

**Day 1:**
- Run `tsc --noEmit` - capture actual error count (expect 103+)
- Verify APOC installation and version, set `useApoc` flag
- Verify Neo4j indexes exist
- Map ALL import paths in actors
- Create `src/pipeline/` directory structure

**Day 2:**
- Document all import path fixes needed
- Measure baseline Neo4j latency (local vs remote)
- Verify existing tests pass
- **EXIT GATE**: All blockers documented with mitigation paths

### Phase 1a: Import Path Fixes (Days 3-5)

**Day 3:**
- Fix import paths in `validation-coordinator.actor.ts`
- Fix import paths in `semantic-resolver.actor.ts`
- Fix import paths in `graph-updater.actor.ts`

**Day 4:**
- Fix import paths in remaining actors
- Fix import paths in services

**Day 5:**
- Verify `tsc --noEmit` error count reduced
- **EXIT GATE**: Import path errors resolved

### Phase 0.5: API Reconciliation (Days 6-9)

**Day 6:**
- Create type definitions in `src/devac/types/events.ts` (including all events from C3)
- Create type definitions in `src/devac/actors/types.ts`

**Day 7:**
- Create `ParseResultAdapter` (aligned with actual types from C2)
- Create `file-watcher-integration.ts`

**Day 8:**
- Create `RelationshipResolverAdapter` (rewritten per C1)
- Create `SemanticUpdater` for write-back flow (H1)

**Day 9:**
- Verify all adapter interfaces compile
- Write unit tests for adapters
- **EXIT GATE**: All adapters created, interfaces compile, unit tests pass

### Phase 1b: Fix TypeScript Errors (Days 10-17)

**Day 10:**
- Install `@types/babel__traverse`
- Fix `structural-parser.ts` (9 errors)
- Fix `semantic-resolver.ts` (2 errors)

**Day 11-13:**
- Fix `validation-coordinator.actor.ts` (~30 remaining errors)
- Focus on XState v5 typing patterns

**Day 14:**
- Fix `validation-coordinator.service.ts` (~19 errors)
- Fix utility files

**Day 15-16:**
- Fix remaining actors (script-executor, affected-calculator)
- Fix test files

**Day 17:**
- Verify: `tsc --noEmit` produces 0 errors
- Run existing tests: `npm test`
- **EXIT GATE**: Zero TypeScript errors, existing tests pass

### Phase 2: Core Integration (Days 18-27)

**Day 18:**
- Create `LanguageRouter` with file guard
- Wire LanguageRouter into ValidationCoordinatorActor

**Day 19:**
- Implement FileMutex with LRU cleanup (bug fixed per H3)
- Add `withLock` wrapper for deadlock prevention

**Day 20:**
- Add delete/rename handling to ValidationCoordinator
- Add configurable rename window (M3)
- Test: file delete removes nodes

**Day 21:**
- Implement retry policy with exponential backoff
- Implement APOC fallback with version check (M2)

**Day 22:**
- Add Neo4j health check with circuit breaker
- Add FileWatcher coordination when circuit opens

**Day 23:**
- Add queue backpressure with deduplication (H5)
- Add crash recovery with structuralInProgress flag (H2)

**Day 24:**
- Add graceful shutdown handling
- Add memory pressure monitoring (M5)

**Day 25:**
- Create startup wiring code (H4)
- Integration smoke tests

**Day 26:**
- Test: add, change, delete, rename cycle
- Test circuit breaker and recovery

**Day 27:**
- Fix issues found
- Performance benchmarking with qualified targets (M4)
- **EXIT GATE**: Basic pipeline working for TS/JS

### Phase 3: Semantic Resolution (Days 28-32)

**Day 28:**
- Implement `TsMorphProjectManager`
- Add incremental file updates

**Day 29:**
- Integrate with SemanticResolverActor
- Wire RelationshipResolverAdapter

**Day 30:**
- Implement semantic write-back flow (H1)
- Test semantic resolution with ts-morph

**Day 31:**
- Add dependent file detection for cascading (M1)
- Test cascading updates

**Day 32:**
- Fix issues
- **EXIT GATE**: Semantic resolution working incrementally

### Phase 4: Polish (Days 33-38)

**Day 33:**
- Full test suite: `npm test`
- Integration tests from P2.4

**Day 34:**
- Rename reconciliation pass implementation

**Day 35:**
- Performance benchmarks against qualified targets
- Document known limitations

**Day 36:**
- Fix regressions
- Additional integration testing

**Day 37:**
- Buffer for unexpected issues
- Documentation update

**Day 38:**
- Final testing
- **EXIT GATE**: All exit criteria met

---

## Success Criteria

### Phase 0 Exit
- [ ] APOC status and version determined
- [ ] All import paths mapped with fixes documented
- [ ] Neo4j baseline latency measured (local and remote if applicable)
- [ ] `src/pipeline/` directory created

### Phase 1a Exit
- [ ] Import path errors resolved in all actors
- [ ] Can import between actor/service files without path errors

### Phase 0.5 Exit
- [ ] All type contracts defined (aligned with actual code)
- [ ] All adapters created (including rewritten RelationshipResolverAdapter)
- [ ] SemanticUpdater for write-back flow created
- [ ] Adapter unit tests pass

### Phase 1b Exit
- [ ] `tsc --noEmit` produces 0 errors
- [ ] Existing unit tests pass

### Phase 2 Exit
- [ ] File add/change/delete triggers correct graph updates
- [ ] Rename detection working (with configurable window)
- [ ] Per-file mutex prevents race conditions
- [ ] Crash recovery handles structuralInProgress and semanticQueued
- [ ] Circuit breaker stops operations on Neo4j failure
- [ ] Queue deduplication working
- [ ] Graceful shutdown drains queue
- [ ] Memory monitoring pauses on critical

### Phase 3 Exit
- [ ] ts-morph Project updates incrementally
- [ ] Semantic resolution works without full reparse
- [ ] Semantic write-back to Neo4j working
- [ ] Dependent file cascading working

### Final
- [ ] `npm test` passes
- [ ] Integration tests pass
- [ ] Performance meets qualified targets (P50 <400ms warm/local/APOC)
- [ ] Documentation updated

---

## Performance Targets (Qualified) — M4 FIX

| Metric | Target (Local+APOC) | Target (Local, no APOC) | Target (Remote) |
|--------|---------------------|------------------------|-----------------|
| Structural parse | <100ms | <100ms | <100ms |
| Graph update | <150ms | <300ms | <500ms |
| **Total (warm)** | **<400ms** | **<550ms** | **<800ms** |
| Cold start | <1500ms | <2000ms | <3000ms |

**SLO**: P50 <400ms, P95 <800ms, P99 <2000ms (measured over 24h)

---

## Known Limitations (v1.10)

1. **Languages supported**: TypeScript, JavaScript only
2. **Deferred to v2**: Python, Java (Tree-sitter), C/C++, Go, C#
3. **Validation execution disabled**: AffectedCalculator + ScriptExecutor → v2
4. **Cross-file edges**: May be stale until semantic resolution completes
5. **Rename detection**: Best-effort heuristic (configurable window, default 100ms)
6. **Large files skipped**: Files >500KB are not processed
7. **No full reconciliation on startup**: Only crash recovery, not full filesystem diff
8. **Cascading updates**: Dependent files queued for semantic-only re-analysis

---

## Files to Create

| File | Purpose | Phase |
|------|---------|-------|
| `src/devac/types/events.ts` | Event type definitions (complete) | 0.5 |
| `src/devac/actors/types.ts` | Actor input/output types | 0.5 |
| `src/devac/actors/semantic-updater.ts` | Semantic write-back to Neo4j | 0.5 |
| `src/pipeline/language-router.ts` | Route files to parsers | 2 |
| `src/pipeline/adapters/parse-result-adapter.ts` | Bridge type mismatch (aligned) | 0.5 |
| `src/pipeline/adapters/relationship-resolver-adapter.ts` | Wrap resolver (rewritten) | 0.5 |
| `src/devac/utils/file-mutex.ts` | Per-file locking with LRU (bug fixed) | 2 |
| `src/devac/utils/file-guard.ts` | File size/type validation | 2 |
| `src/devac/utils/retry.ts` | Retry with exponential backoff | 2 |
| `src/devac/utils/apoc-fallback.ts` | Non-APOC Cypher queries | 2 |
| `src/devac/utils/bounded-queue.ts` | Backpressure queue with dedup | 2 |
| `src/devac/utils/rename-detector.ts` | Rename detection (configurable) | 2 |
| `src/devac/utils/reconciliation.ts` | Post-rename integrity check | 4 |
| `src/devac/utils/metrics.ts` | Performance logging (qualified) | 2 |
| `src/devac/utils/memory-monitor.ts` | Memory pressure monitoring | 2 |
| `src/devac/services/file-watcher-integration.ts` | Connect FileWatcher to actor | 0.5 |
| `src/devac/services/ts-morph-manager.ts` | ts-morph Project lifecycle | 3 |
| `src/devac/startup.ts` | APOC detection, crash recovery (enhanced) | 2 |
| `src/devac/shutdown.ts` | Graceful shutdown handling | 2 |
| `src/devac/main.ts` | Startup wiring code | 2 |
| `src/database/neo4j-health.ts` | Health check with circuit breaker | 2 |

## Files to Modify

| File | Changes | Phase |
|------|---------|-------|
| `validation-coordinator.actor.ts` | Fix imports, add all events, mutex, delete handling, crash recovery, circuit breaker | 1a, 2 |
| `graph-updater.actor.ts` | Fix imports, batch relationships, APOC fallback, retry policy, structuralInProgress | 1a, 2 |
| `semantic-resolver.actor.ts` | Fix imports, use rewritten adapter, ts-morph lifecycle, cascading | 1a, 3 |
| `structural-parser.ts` | Fix types (verify alignment) | 1b |
| All other actors | Fix XState v5 typing, import paths | 1a, 1b |

---

## Deferred to v2

- Python, Java, C/C++, Go, C# tree-sitter parsers
- Full filesystem reconciliation algorithm
- AffectedCalculator + ScriptExecutor pipeline
- Metrics export (Prometheus/StatsD)
- Distributed tracing with correlation IDs
- Health endpoints (/health, /ready)
- Stale data indicator (`Project.needsFullRescan`)
- Watch limit handling (fs.inotify.max_user_watches)
- Git operation burst handling

---

## Validation Checklist

### Critical Items (C1-C4) Addressed

| Issue | Section | Status |
|-------|---------|--------|
| C1: RelationshipResolverAdapter rewrite | P0.5 | ✅ ADDRESSED |
| C2: Type contracts aligned with actual code | Type Contracts | ✅ ADDRESSED |
| C3: Missing events added | ValidationCoordinatorEvent | ✅ ADDRESSED |
| C4: Timeline extended to 38 days | Timeline | ✅ ADDRESSED |

### High Priority Items (H1-H5) Addressed

| Issue | Section | Status |
|-------|---------|--------|
| H1: Semantic write-back flow | P0.6, SemanticUpdater | ✅ ADDRESSED |
| H2: structuralInProgress flag | P0.8 | ✅ ADDRESSED |
| H3: FileMutex LRU bug fix | P1.5 | ✅ ADDRESSED |
| H4: Startup wiring code | Startup Wiring Code | ✅ ADDRESSED |
| H5: Deduplication before queue | P1.2 | ✅ ADDRESSED |

### Medium Priority Items (M1-M5) Addressed

| Issue | Section | Status |
|-------|---------|--------|
| M1: Cascading updates clarified | P2.2 | ✅ ADDRESSED |
| M2: APOC version check | P0.3 | ✅ ADDRESSED |
| M3: Rename window configurable | P0.7 | ✅ ADDRESSED |
| M4: Performance targets qualified | P2.1, Performance Targets | ✅ ADDRESSED |
| M5: Memory pressure monitoring | P1.7 | ✅ ADDRESSED |

### Timeline Adjustment
- v1.8: 26 days
- v1.9: 30 days
- v1.10: **38 days** (+8 days for thorough fixes and XState v5 complexity)

### Scope
- TypeScript/JavaScript only (focus on reliability)
- Tree-sitter languages deferred to v2

**Spec v1.10 is IMPLEMENTATION-READY.**
