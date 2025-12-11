# DevAC Spec v1.11: Incremental Graph Updates

> **Version**: 1.11 (Implementation-Ready)  
> **Date**: 2025-12-11  
> **Status**: APPROVED FOR IMPLEMENTATION  
> **Timeline**: 48 days  
> **Previous Version**: v1.10 (superseded)

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
| v1.10 | RelationshipResolverAdapter rewrite, semantic write-back flow, type contract alignment, complete event types, 38-day timeline | Superseded |
| v1.11 | Node index cache for semantic resolution, ExportedSymbol type fix, version guards, file existence checks, schema verification, 48-day timeline | **Current** |

---

## Changes from v1.10

### Critical Fixes (From Review Recap)
1. **RelationshipResolverAdapter design fix** — Now maintains in-memory node index cache for cross-file resolution instead of single-file nodes
2. **ExportedSymbol type corrected** — Matches actual `structural-parser.ts` output with `kind: "default" | "named"`, `nodeKind`, `entityId`
3. **File existence check added** — Race condition protection before parsing
4. **Version guard in semantic write-back** — Prevents stale semantic overwrites with `structuralVersion` check

### High Priority Fixes
5. **Schema verification in Phase 0** — Verifies Neo4j indexes/constraints before implementation
6. **StorageManager relationship documented** — Explicitly bypassed for incremental updates
7. **State machine diagram added** — ValidationCoordinator transitions visualized
8. **Integration tests moved earlier** — Now at end of Phase 2, not Phase 4
9. **Phase 1b timeline extended** — 12 days for XState v5 complexity
10. **Parse error handling flow specified** — Clear status updates on parse failure
11. **ts-morph warm-up phase added** — Pre-initialization during startup

### Additional Fixes
12. **Circuit breaker ↔ FileWatcher queue interaction specified** — Queue paused when circuit opens
13. **Semantic write-back cross-file edge deletion fixed** — Tighter targeting to prevent over-deletion
14. **Timeline extended to 48 days** — Based on reviewer consensus (45-50 realistic)

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
    ├─► [3] FileGuard.checkExists() → handle delete if missing  ← NEW
    │
    ├─► [4] FileGuard.checkSize() → reject if >500KB
    │
    ├─► [5] Set structuralInProgress = true
    │
    ├─► [6] LanguageRouter.parse() → StructuralParseResult
    │       └─► ParseResultAdapter → GraphUpdaterInput
    │       └─► On parse error: mark parseError, clear flags, emit metrics  ← NEW
    │
    ├─► [7] GraphUpdaterActor → Neo4j atomic update
    │       └─► Transaction: DELETE old → CREATE new (single tx)
    │       └─► Set structuralComplete = true, structuralInProgress = false
    │       └─► Update NodeIndexCache with new nodes  ← NEW
    │
    ├─► [8] SemanticResolverActor.enqueue() [TS/JS only]
    │
    └─► [9] FileMutex.release()

SemanticResolverActor (background)
    │
    ├─► [1] TsMorphProjectManager.updateFile()
    │
    ├─► [2] RelationshipResolverAdapter.resolveRelationships()
    │       └─► Uses NodeIndexCache for cross-file resolution  ← NEW
    │
    ├─► [3] SemanticUpdater → Neo4j (semantic edges)
    │       └─► Version guard: skip if structuralVersion changed  ← NEW
    │       └─► Set semanticComplete = true
    │
    └─► [4] Queue dependent files for re-analysis (cascading)

(AffectedCalculator + ScriptExecutor → DEFERRED to v2)
```

### ValidationCoordinator State Machine Diagram — HIGH PRIORITY FIX

```
                                    ┌──────────────────────────────────────┐
                                    │                                      │
     ┌───────────────────┐          │   ┌─────────────────────────────┐   │
     │                   │          │   │                             │   │
     │      IDLE         │──START──►│   │         RUNNING             │   │
     │                   │          │   │                             │   │
     └───────────────────┘          │   │  ┌─────────┐  ┌──────────┐  │   │
              ▲                     │   │  │PROCESS  │  │SEMANTIC  │  │   │
              │                     │   │  │FILE     │◄►│QUEUE     │  │   │
              │                     │   │  └─────────┘  └──────────┘  │   │
              │                     │   │       │             │       │   │
              │                     │   └───────┼─────────────┼───────┘   │
              │                     │           │             │           │
         SHUTDOWN                   │           ▼             ▼           │
              │                     │   ┌─────────────────────────────┐   │
              │                     │   │        ERROR STATES         │   │
              │                     │   │  ┌──────┐    ┌──────────┐   │   │
              │                     │   │  │PARSE │    │GRAPH     │   │   │
              │                     │   │  │ERROR │    │ERROR     │   │   │
              │                     │   │  └──────┘    └──────────┘   │   │
              │                     │   └─────────────────────────────┘   │
              │                     │                                      │
              │                     └──────────────────────────────────────┘
              │
              │                     ┌──────────────────────────────────────┐
              │                     │         SUSPENDED STATES             │
              │                     │                                      │
              │        CIRCUIT_OPEN │   ┌─────────────────────────────┐   │
              │◄────────────────────│   │     CIRCUIT_OPEN            │   │
              │                     │   │  (Queue paused, events      │   │
              │                     │   │   still accepted)           │   │◄─CIRCUIT_OPEN
              │        CIRCUIT_CLOSE│   └─────────────────────────────┘   │
              │────────────────────►│                                      │
              │                     │   ┌─────────────────────────────┐   │
              │                     │   │     MEMORY_CRITICAL         │   │◄─PAUSE
              │        RESUME       │   │  (Processing paused)        │   │
              │◄────────────────────│   └─────────────────────────────┘   │
              │                     │                                      │
              │                     └──────────────────────────────────────┘

Event Transitions:
─────────────────
FILE_CHANGED     → Enqueue to processing queue (if RUNNING)
FILE_RENAMED     → Handle rename atomically
FILE_DELETED     → Handle deletion, clear from caches
CIRCUIT_OPEN     → Pause queue processing, continue accepting events
CIRCUIT_CLOSED   → Resume queue processing
PAUSE            → Memory critical, stop all processing
RESUME           → Memory recovered, resume processing
WATCHER_ERROR    → Log, attempt recovery
SHUTDOWN         → Graceful drain and exit
```

### Verified File Locations

| Component | Path | Status |
|-----------|------|--------|
| ValidationCoordinatorActor | `src/devac/actors/validation-coordinator.actor.ts` | Needs fixes |
| GraphUpdaterActor | `src/devac/actors/graph-updater.actor.ts` | Needs fixes |
| SemanticResolverActor | `src/devac/actors/semantic-resolver.actor.ts` | Needs fixes |
| FileWatcher | `src/devac/services/codegraph/file-watcher.ts` | Working |
| Neo4jClient | `src/database/neo4j-client.ts` | Working |
| StructuralParser | `src/analyzer/structural-parser.ts` | Working (type alignment verified) |
| RelationshipResolver | `src/analyzer/relationship-resolver.ts` | Needs adapter with node cache |
| StorageManager | `src/devac/services/codegraph/storage-manager.ts` | **BYPASSED** (see note below) |

**StorageManager Note**: The existing `StorageManager` is **bypassed** for incremental updates. All writes go directly through `GraphUpdaterActor` using raw Neo4j transactions. This is intentional — the StorageManager's batching logic is designed for full-repo processing and would add unnecessary complexity for single-file updates. StorageManager remains available for full-rescan operations.

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

### ValidationCoordinatorEvent (Complete Event Types)

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
  | { type: "PARSE_ERROR"; filePath: string; error: string }  // NEW
  | { type: "CIRCUIT_OPEN" }
  | { type: "CIRCUIT_CLOSED" }
  | { type: "WATCHER_ERROR"; error: Error }
  | { type: "SHUTDOWN" }
  | { type: "PAUSE" }
  | { type: "RESUME" };
```

### StructuralParseResult (Aligned with Actual Code)

```typescript
// src/analyzer/types.ts
// NOTE: This matches the ACTUAL structural-parser.ts output

export interface AstNode {
  id: string;             // REQUIRED — unique identifier
  entityId: string;       // Format: "kind:filePath:name:line" e.g., "function:/path/file.ts:myFunc:10"
  kind: string;           // Free-form string (not enum): "Function", "Class", "Method", etc.
  name: string;
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  language: string;       // REQUIRED — "typescript" | "javascript"
  createdAt: string;      // REQUIRED — ISO timestamp
  parentId?: string;
  modifierFlags?: string[];
}

export interface RelationshipInfo {
  source: string;         // entityId
  target: string;         // entityId
  type: string;           // Free-form: "CONTAINS", "CALLS", "IMPORTS", etc.
}

// CRITICAL FIX: ExportedSymbol matches ACTUAL structural-parser.ts
export interface ExportedSymbol {
  name: string;
  kind: "default" | "named";  // NOT free-form string
  nodeKind: string;           // The AST node kind (Function, Class, etc.)
  entityId?: string;          // Reference to the exported node
}

export interface StructuralParseResult {
  filePath: string;
  nodes: AstNode[];
  relationships: RelationshipInfo[];
  importStrings: string[];
  exportedSymbols: ExportedSymbol[];
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
  structuralVersion: number;  // NEW: For version tracking
}

export interface GraphNode {
  entityId: string;
  labels: string[];       // ["Node", kind] e.g., ["Node", "Function"]
  properties: {
    id: string;           // NEW: Required field
    entityId: string;
    name: string;
    filePath: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    language: string;     // NEW: Required field
    createdAt: string;    // NEW: Required field
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
  structuralVersion: number;  // NEW: Return version for semantic queue
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
  structuralVersion: number;  // NEW: For version guard
}

export interface SemanticResult {
  filePath: string;
  resolvedRelationships: ResolvedRelationship[];
  dependentFiles: string[];
  structuralVersion: number;  // NEW: Version that was resolved
}

export interface ResolvedRelationship {
  sourceEntityId: string;
  targetEntityId: string;
  type: string;
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
  const { neo4jClient, filePath, nodes, relationships, importStrings, exportedSymbols, useApoc, structuralVersion } = input;

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
      await tx.run(
        `MERGE (f:File {filePath: $filePath})
         SET f.structuralComplete = true,
             f.structuralInProgress = false,
             f.semanticQueued = true,
             f.semanticComplete = false,
             f.lastModified = datetime(),
             f.parseError = null,
             f.structuralVersion = $structuralVersion`,
        { filePath, structuralVersion }
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
        structuralVersion,
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
  // ExportedSymbol now correctly typed with kind: "default" | "named"
  await tx.run(
    `MATCH (f:File {filePath: $filePath})
     SET f.imports = $imports,
         f.exports = $exports`,
    {
      filePath,
      imports: importStrings,
      exports: exportedSymbols.map(e => `${e.nodeKind}:${e.name}:${e.kind}${e.entityId ? ':' + e.entityId : ''}`),
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
| File deleted during parse | Check existence first, handle as delete | Clean deletion |

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

### P0.3: APOC Fallback Cypher with Version Check

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

**APOC Detection with Version Check on startup**:

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
    console.warn("APOC not available - using fallback queries (slower, +50-150ms per file)");
    return { available: false, version: null, isRecommendedVersion: false };
  }
}
```

### P0.4: ParseResultAdapter (Aligned with Actual Types)

```typescript
// src/pipeline/adapters/parse-result-adapter.ts

import type { StructuralParseResult, AstNode, ExportedSymbol } from "../../analyzer/types.js";
import type { GraphUpdaterInput, GraphNode, GraphRelationship } from "../../devac/actors/types.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";

export function adaptParseResult(
  parseResult: StructuralParseResult,
  neo4jClient: Neo4jClient,
  useApoc: boolean,
  structuralVersion: number
): GraphUpdaterInput {
  return {
    neo4jClient,
    filePath: parseResult.filePath,
    nodes: parseResult.nodes.map(adaptNode),
    relationships: parseResult.relationships.map(adaptRelationship),
    importStrings: parseResult.importStrings,
    exportedSymbols: parseResult.exportedSymbols,  // Now correctly typed
    useApoc,
    structuralVersion,
  };
}

function adaptNode(node: AstNode): GraphNode {
  return {
    entityId: node.entityId,
    labels: ["Node", node.kind],
    properties: {
      id: node.id,                    // Required field
      entityId: node.entityId,
      name: node.name,
      filePath: node.filePath,
      startLine: node.startLine,
      startColumn: node.startColumn,
      endLine: node.endLine,
      endColumn: node.endColumn,
      language: node.language,        // Required field
      createdAt: node.createdAt,      // Required field
      modifierFlags: node.modifierFlags,
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

### P0.5: NodeIndexCache for Cross-File Resolution — CRITICAL FIX

**Problem**: v1.10's `RelationshipResolverAdapter` passed single-file nodes to `RelationshipResolver`, but it needs ALL nodes for cross-file resolution.

**Solution**: Maintain in-memory node index cache, updated after each structural parse.

```typescript
// src/devac/services/node-index-cache.ts

import type { AstNode } from "../../analyzer/types.js";

export interface NodeIndexEntry {
  entityId: string;
  name: string;
  kind: string;
  filePath: string;
  exportedAs?: string;  // "default" | "named" | undefined
}

export class NodeIndexCache {
  private nodesByEntityId: Map<string, NodeIndexEntry> = new Map();
  private nodesByFile: Map<string, Set<string>> = new Map();
  private exportsByFile: Map<string, Map<string, string>> = new Map();  // file → (exportName → entityId)

  /**
   * Update cache with nodes from a parsed file.
   * Called after successful structural parse.
   */
  updateFile(filePath: string, nodes: AstNode[], exportedSymbols: ExportedSymbol[]): void {
    // Remove old entries for this file
    this.removeFile(filePath);

    // Add new entries
    const fileNodeIds = new Set<string>();
    for (const node of nodes) {
      const entry: NodeIndexEntry = {
        entityId: node.entityId,
        name: node.name,
        kind: node.kind,
        filePath: node.filePath,
      };
      this.nodesByEntityId.set(node.entityId, entry);
      fileNodeIds.add(node.entityId);
    }
    this.nodesByFile.set(filePath, fileNodeIds);

    // Index exports for import resolution
    const fileExports = new Map<string, string>();
    for (const exp of exportedSymbols) {
      if (exp.entityId) {
        const exportKey = exp.kind === "default" ? "default" : exp.name;
        fileExports.set(exportKey, exp.entityId);
        
        // Mark the node as exported
        const entry = this.nodesByEntityId.get(exp.entityId);
        if (entry) {
          entry.exportedAs = exp.kind;
        }
      }
    }
    this.exportsByFile.set(filePath, fileExports);
  }

  /**
   * Remove all entries for a file (on delete or before update).
   */
  removeFile(filePath: string): void {
    const nodeIds = this.nodesByFile.get(filePath);
    if (nodeIds) {
      for (const entityId of nodeIds) {
        this.nodesByEntityId.delete(entityId);
      }
      this.nodesByFile.delete(filePath);
    }
    this.exportsByFile.delete(filePath);
  }

  /**
   * Get a node by entityId (for relationship resolution).
   */
  getNode(entityId: string): NodeIndexEntry | undefined {
    return this.nodesByEntityId.get(entityId);
  }

  /**
   * Get all nodes (for RelationshipResolver constructor).
   */
  getAllNodes(): NodeIndexEntry[] {
    return Array.from(this.nodesByEntityId.values());
  }

  /**
   * Resolve an import to a target entityId.
   * @param sourceFile - The file containing the import
   * @param importPath - The resolved absolute path of the imported file
   * @param importName - The imported symbol name ("default" for default imports)
   */
  resolveImport(importPath: string, importName: string): string | undefined {
    const fileExports = this.exportsByFile.get(importPath);
    if (!fileExports) return undefined;
    return fileExports.get(importName);
  }

  /**
   * Get all exported symbols from a file.
   */
  getFileExports(filePath: string): Map<string, string> | undefined {
    return this.exportsByFile.get(filePath);
  }

  /**
   * Get statistics for monitoring.
   */
  getStats(): { totalNodes: number; totalFiles: number } {
    return {
      totalNodes: this.nodesByEntityId.size,
      totalFiles: this.nodesByFile.size,
    };
  }

  /**
   * Clear entire cache (for reset/shutdown).
   */
  clear(): void {
    this.nodesByEntityId.clear();
    this.nodesByFile.clear();
    this.exportsByFile.clear();
  }
}
```

### P0.6: RelationshipResolverAdapter (Rewritten with NodeIndexCache)

```typescript
// src/pipeline/adapters/relationship-resolver-adapter.ts

import type { Project, SourceFile } from "ts-morph";
import type { AstNode, RelationshipInfo } from "../../analyzer/types.js";
import { RelationshipResolver } from "../../analyzer/relationship-resolver.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";
import type { TsMorphProjectManager } from "../../devac/services/ts-morph-manager.js";
import type { NodeIndexCache } from "../../devac/services/node-index-cache.js";

export interface SemanticResolverInterface {
  resolveFile(filePath: string, structuralVersion: number): Promise<SemanticResolutionResult>;
}

export interface SemanticResolutionResult {
  filePath: string;
  resolvedRelationships: ResolvedRelationship[];
  dependentFiles: string[];
  structuralVersion: number;
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
  private nodeIndexCache: NodeIndexCache;  // CRITICAL FIX: Use cache instead of Neo4j reads
  private workspaceRoot: string;

  constructor(
    neo4jClient: Neo4jClient,
    tsMorphManager: TsMorphProjectManager,
    nodeIndexCache: NodeIndexCache,  // CRITICAL FIX: Inject NodeIndexCache
    workspaceRoot: string
  ) {
    this.neo4jClient = neo4jClient;
    this.tsMorphManager = tsMorphManager;
    this.nodeIndexCache = nodeIndexCache;
    this.workspaceRoot = workspaceRoot;
  }

  async resolveFile(filePath: string, structuralVersion: number): Promise<SemanticResolutionResult> {
    try {
      // Get the ts-morph Project instance
      const project = this.tsMorphManager.getProject();
      if (!project) {
        return {
          filePath,
          resolvedRelationships: [],
          dependentFiles: [],
          structuralVersion,
          success: false,
          error: "ts-morph Project not initialized",
        };
      }

      // Ensure file is in project
      const sourceFile = await this.tsMorphManager.updateFile(filePath, structuralVersion);
      if (!sourceFile) {
        return {
          filePath,
          resolvedRelationships: [],
          dependentFiles: [],
          structuralVersion,
          success: false,
          error: "Could not add file to ts-morph Project",
        };
      }

      // CRITICAL FIX: Get ALL nodes from cache, not just single-file from Neo4j
      const allNodes = this.nodeIndexCache.getAllNodes().map(entry => ({
        entityId: entry.entityId,
        kind: entry.kind,
        name: entry.name,
        filePath: entry.filePath,
        startLine: 0,  // Not needed for resolution
        startColumn: 0,
        endLine: 0,
        endColumn: 0,
        language: "typescript",
        createdAt: new Date().toISOString(),
        id: entry.entityId,
      } as AstNode));

      // Get relationships for this file only from Neo4j
      const fileRelationships = await this.getFileRelationships(filePath);

      // Create resolver with FULL node index
      const resolver = new RelationshipResolver(allNodes, fileRelationships);

      // Call actual resolveRelationships method with Project
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
        structuralVersion,
        success: true,
      };
    } catch (error) {
      console.error(`Semantic resolution failed for ${filePath}:`, error);
      return {
        filePath,
        resolvedRelationships: [],
        dependentFiles: [],
        structuralVersion,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async getFileRelationships(
    filePath: string
  ): Promise<RelationshipInfo[]> {
    const result = await this.neo4jClient.runTransaction(
      `MATCH (f:File {filePath: $filePath})-[:OWNS]->(n:Node)
       MATCH (n)-[r]->(target:Node)
       WHERE type(r) IN ['IMPORTS', 'CALLS', 'REFERENCES', 'USES']
       RETURN n.entityId as source, target.entityId as target, type(r) as type`,
      { filePath },
      "READ",
      "GetFileRelationships"
    );

    return result.records.map(record => ({
      source: record.get("source") as string,
      target: record.get("target") as string,
      type: record.get("type") as string,
    }));
  }
}
```

### P0.7: Semantic Write-Back Flow with Version Guard — CRITICAL FIX

```typescript
// src/devac/actors/semantic-updater.ts

import type { Neo4jClient } from "../../database/neo4j-client.js";
import type { SemanticResolutionResult, ResolvedRelationship } from "../../pipeline/adapters/relationship-resolver-adapter.js";
import { withRetry, DEFAULT_RETRY_POLICY } from "../utils/retry.js";

export interface SemanticWriteResult {
  success: boolean;
  skippedDueToVersion: boolean;
  error?: string;
}

export async function writeSemanticResults(
  neo4jClient: Neo4jClient,
  result: SemanticResolutionResult
): Promise<SemanticWriteResult> {
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
    return { success: false, skippedDueToVersion: false, error: result.error };
  }

  return withRetry(
    () => writeSemanticRelationships(neo4jClient, result.filePath, result.resolvedRelationships, result.structuralVersion),
    DEFAULT_RETRY_POLICY,
    `SemanticUpdater(${result.filePath})`
  );
}

async function writeSemanticRelationships(
  neo4jClient: Neo4jClient,
  filePath: string,
  relationships: ResolvedRelationship[],
  expectedStructuralVersion: number
): Promise<SemanticWriteResult> {
  return neo4jClient.runTransactionWork(
    async (tx) => {
      // CRITICAL FIX: Version guard — skip if structural version has changed
      const versionCheck = await tx.run(
        `MATCH (f:File {filePath: $filePath})
         RETURN f.structuralVersion as version`,
        { filePath }
      );
      
      const currentVersion = versionCheck.records[0]?.get("version") as number;
      if (currentVersion !== expectedStructuralVersion) {
        console.info(
          `Skipping semantic write for ${filePath}: ` +
          `structural version changed (expected ${expectedStructuralVersion}, current ${currentVersion})`
        );
        return { success: true, skippedDueToVersion: true };
      }

      // Delete existing semantic relationships (cross-file only)
      // CRITICAL FIX: More precise targeting to prevent over-deletion
      await tx.run(
        `MATCH (f:File {filePath: $filePath})-[:OWNS]->(n:Node)
         MATCH (n)-[r]->(target:Node)
         WHERE r.semantic = true AND target.filePath <> $filePath
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

      // Mark semantic resolution complete with version check
      const updateResult = await tx.run(
        `MATCH (f:File {filePath: $filePath})
         WHERE f.structuralVersion = $expectedVersion
         SET f.semanticComplete = true,
             f.semanticQueued = false,
             f.semanticError = null,
             f.semanticResolvedAt = datetime(),
             f.semanticVersion = $expectedVersion
         RETURN f`,
        { filePath, expectedVersion: expectedStructuralVersion }
      );

      if (updateResult.records.length === 0) {
        // Version changed during our transaction
        return { success: true, skippedDueToVersion: true };
      }

      return { success: true, skippedDueToVersion: false };
    },
    "WRITE",
    "SemanticUpdater-WriteRelationships"
  );
}
```

### P0.8: File Existence Check — CRITICAL FIX

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
  exists: boolean;      // NEW: Explicit existence check
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
      exists: true,  // Assume exists if checking extension
      reason: `Unsupported extension: ${ext}`,
    };
  }

  try {
    const stats = await stat(filePath);
    
    if (stats.size > config.maxFileSizeBytes) {
      return {
        allowed: false,
        exists: true,
        reason: `File too large: ${stats.size} bytes (max: ${config.maxFileSizeBytes})`,
        sizeBytes: stats.size,
      };
    }

    return {
      allowed: true,
      exists: true,
      sizeBytes: stats.size,
    };
  } catch (error) {
    // CRITICAL FIX: Distinguish between "file doesn't exist" and other errors
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        allowed: false,
        exists: false,
        reason: "File does not exist",
      };
    }
    
    return {
      allowed: false,
      exists: true,  // Assume exists but can't read
      reason: `Cannot read file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
```

### P0.9: Delete/Rename Handling

**File Deletion Flow**:

```typescript
async function handleFileDelete(
  neo4jClient: Neo4jClient,
  nodeIndexCache: NodeIndexCache,
  filePath: string
): Promise<void> {
  // Remove from cache first
  nodeIndexCache.removeFile(filePath);

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

**Rename Detection with Configurable Window**:

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
  nodeIndexCache: NodeIndexCache,
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
          oldPathPrefix: oldPath.replace(/\.[^.]+$/, '')
        },
        "WRITE",
        "RenameFile"
      ),
    DEFAULT_RETRY_POLICY,
    `RenameFile(${oldPath} → ${newPath})`
  );

  // Update cache with new path (will be reparsed to get fresh data)
  nodeIndexCache.removeFile(oldPath);

  console.info(`Renamed file in graph: ${oldPath} → ${newPath}`);
}
```

### P0.10: Crash Recovery with structuralInProgress

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
  // Find files that were mid-structural update (crash during parse/update)
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

### P1.1: Schema Verification in Phase 0 — HIGH PRIORITY FIX

```typescript
// src/devac/startup.ts

export interface SchemaVerificationResult {
  valid: boolean;
  missingIndexes: string[];
  missingConstraints: string[];
  warnings: string[];
}

export async function verifyNeo4jSchema(
  neo4jClient: Neo4jClient
): Promise<SchemaVerificationResult> {
  const result: SchemaVerificationResult = {
    valid: true,
    missingIndexes: [],
    missingConstraints: [],
    warnings: [],
  };

  // Required indexes for performance
  const requiredIndexes = [
    { label: "File", property: "filePath" },
    { label: "Node", property: "entityId" },
    { label: "Node", property: "filePath" },
  ];

  // Check indexes
  const indexResult = await neo4jClient.runTransaction(
    `SHOW INDEXES YIELD labelsOrTypes, properties
     RETURN labelsOrTypes, properties`,
    {},
    "READ",
    "CheckIndexes"
  );

  const existingIndexes = new Set(
    indexResult.records.map(r => {
      const labels = r.get("labelsOrTypes") as string[];
      const props = r.get("properties") as string[];
      return `${labels[0]}:${props[0]}`;
    })
  );

  for (const idx of requiredIndexes) {
    if (!existingIndexes.has(`${idx.label}:${idx.property}`)) {
      result.missingIndexes.push(`${idx.label}(${idx.property})`);
      result.valid = false;
    }
  }

  // Check for uniqueness constraint on File.filePath
  const constraintResult = await neo4jClient.runTransaction(
    `SHOW CONSTRAINTS YIELD labelsOrTypes, properties, type
     WHERE type = 'UNIQUENESS'
     RETURN labelsOrTypes, properties`,
    {},
    "READ",
    "CheckConstraints"
  );

  const existingConstraints = new Set(
    constraintResult.records.map(r => {
      const labels = r.get("labelsOrTypes") as string[];
      const props = r.get("properties") as string[];
      return `${labels[0]}:${props[0]}`;
    })
  );

  if (!existingConstraints.has("File:filePath")) {
    result.warnings.push("UNIQUENESS constraint on File.filePath recommended");
  }

  if (!result.valid) {
    console.error("Schema verification failed:");
    console.error("  Missing indexes:", result.missingIndexes.join(", "));
    console.error("  Run schema migration to fix.");
  }

  if (result.warnings.length > 0) {
    console.warn("Schema warnings:", result.warnings.join(", "));
  }

  return result;
}

// Schema creation helper (for Phase 0)
export async function createRequiredIndexes(neo4jClient: Neo4jClient): Promise<void> {
  const queries = [
    "CREATE INDEX file_path_idx IF NOT EXISTS FOR (f:File) ON (f.filePath)",
    "CREATE INDEX node_entity_id_idx IF NOT EXISTS FOR (n:Node) ON (n.entityId)",
    "CREATE INDEX node_file_path_idx IF NOT EXISTS FOR (n:Node) ON (n.filePath)",
  ];

  for (const query of queries) {
    await neo4jClient.runTransaction(query, {}, "WRITE", "CreateIndex");
  }

  console.info("Required indexes created/verified");
}
```

### P1.2: ts-morph Incremental Lifecycle with Warm-Up — HIGH PRIORITY FIX

```typescript
// src/devac/services/ts-morph-manager.ts

import { Project, SourceFile } from "ts-morph";

export class TsMorphProjectManager {
  private project: Project | null = null;
  private workspaceRoot: string;
  private fileVersions: Map<string, number> = new Map();
  private isWarmedUp: boolean = false;

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

  /**
   * HIGH PRIORITY FIX: Warm up ts-morph by pre-loading common files.
   * This reduces latency for the first semantic resolution.
   */
  async warmUp(filePaths: string[]): Promise<void> {
    if (this.isWarmedUp || !this.project) return;

    const startTime = Date.now();
    let loaded = 0;

    for (const filePath of filePaths.slice(0, 50)) {  // Limit warm-up to 50 files
      try {
        this.project.addSourceFileAtPath(filePath);
        loaded++;
      } catch {
        // Ignore files that can't be loaded
      }
    }

    this.isWarmedUp = true;
    console.info(`ts-morph warm-up complete: ${loaded} files in ${Date.now() - startTime}ms`);
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

  // Get files that import the given file (for cascading updates)
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
    this.isWarmedUp = false;
  }
}
```

### P1.3: Parse Error Handling Flow — HIGH PRIORITY FIX

```typescript
// In ValidationCoordinator

async function handleParseError(
  neo4jClient: Neo4jClient,
  filePath: string,
  error: Error,
  coordinator: ValidationCoordinatorService
): Promise<void> {
  // HIGH PRIORITY FIX: Clear status and mark error
  await neo4jClient.runTransaction(
    `MERGE (f:File {filePath: $filePath})
     SET f.structuralInProgress = false,
         f.structuralComplete = false,
         f.parseError = $error,
         f.parseErrorAt = datetime()`,
    { filePath, error: error.message },
    "WRITE",
    "MarkParseError"
  );

  // Emit parse error event
  coordinator.send({
    type: "PARSE_ERROR",
    filePath,
    error: error.message,
  });

  // Log for metrics
  console.error(`Parse error for ${filePath}:`, error.message);
}
```

### P1.4: Backpressure with Deduplication

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
  private isPaused = false;  // NEW: Support for circuit breaker pause

  constructor(
    policy: QueuePolicy = DEFAULT_QUEUE_POLICY,
    keyFn: (data: T) => string = () => ""
  ) {
    this.policy = policy;
    this.keyFn = keyFn;
  }

  enqueue(data: T, priority: "high" | "normal" = "normal", version: number = Date.now()): boolean {
    // Deduplicate by key, keeping latest version
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
    if (this.isPaused) return undefined;  // Don't dequeue when paused
    return this.items.shift();
  }

  pause(): void {
    this.isPaused = true;
    console.info(`Queue paused (${this.items.length} items pending)`);
  }

  resume(): void {
    this.isPaused = false;
    console.info(`Queue resumed (${this.items.length} items pending)`);
  }

  size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  getStats(): { size: number; dropped: number; deduplicated: number; paused: boolean } {
    return {
      size: this.items.length,
      dropped: this.droppedCount,
      deduplicated: this.deduplicatedCount,
      paused: this.isPaused,
    };
  }

  clear(): void {
    this.items = [];
    this.warningIssued = false;
  }
}
```

### P1.5: Neo4j Circuit Breaker with Queue Coordination — HIGH PRIORITY FIX

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

### P1.6: Graceful Shutdown

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

### P1.7: FileMutex with LRU Cleanup (Bug Fixed)

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

    // Collect paths to delete first, then delete (bug fix from v1.10)
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

### P1.8: Memory Pressure Monitoring

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

### P2.1: Performance Budgets (Qualified by Environment)

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

**Note**: Without APOC, expect 50-150ms additional latency per file due to multiple queries.

### P2.2: Cascading Updates for Dependent Files

```typescript
// In SemanticResolverActor after resolution completes

async function handleSemanticComplete(
  result: SemanticResolutionResult,
  coordinator: ValidationCoordinatorService,
  neo4jClient: Neo4jClient
): Promise<void> {
  // Write semantic results to Neo4j (with version guard)
  const writeResult = await writeSemanticResults(neo4jClient, result);

  // Skip cascading if version was stale
  if (writeResult.skippedDueToVersion) {
    console.info(`Skipped cascading for ${result.filePath} due to version change`);
    return;
  }

  // Queue dependent files for re-analysis
  if (result.dependentFiles.length > 0) {
    console.info(
      `Queueing ${result.dependentFiles.length} dependent files for semantic re-analysis`
    );
    
    coordinator.send({
      type: "SEMANTIC_COMPLETE",
      filePath: result.filePath,
      dependents: result.dependentFiles,
    });
  }
}
```

### P2.3: Integration Test Scenarios — Moved Earlier

```typescript
// tests/integration/incremental-updates.test.ts
// NOTE: Run at END OF PHASE 2, not Phase 4

describe("Incremental Updates - Smoke Tests", () => {
  describe("Add file", () => {
    it("should create File node and owned Node nodes");
    it("should set structuralComplete=true after processing");
    it("should update NodeIndexCache");
  });

  describe("Change file", () => {
    it("should replace old nodes with new nodes atomically");
    it("should preserve structuralVersion ordering");
    it("should handle rapid changes (deduplication)");
  });

  describe("Delete file", () => {
    it("should remove File node and all owned nodes");
    it("should handle delete during processing gracefully");
    it("should remove from NodeIndexCache");
  });

  describe("Rename file", () => {
    it("should update filePath on File and Node nodes");
    it("should update entityId references");
  });

  describe("Parse error", () => {
    it("should mark parseError on File node");
    it("should emit PARSE_ERROR event");
    it("should NOT set structuralComplete=true");
  });

  describe("File existence race", () => {
    it("should handle file deleted between event and parse");
  });
});

// Additional tests for Phase 3
describe("Semantic Resolution - Smoke Tests", () => {
  describe("Cross-file resolution", () => {
    it("should resolve imports using NodeIndexCache");
    it("should write semantic relationships with version guard");
    it("should skip if structuralVersion changed");
  });

  describe("Cascading updates", () => {
    it("should queue dependent files for re-analysis");
  });
});
```

---

## Startup Wiring Code

```typescript
// src/devac/main.ts

import { Neo4jClient } from "../database/neo4j-client.js";
import { ValidationCoordinatorActor } from "./actors/validation-coordinator.actor.js";
import { SemanticResolverActor } from "./actors/semantic-resolver.actor.js";
import { Neo4jHealthCheck } from "../database/neo4j-health.js";
import { TsMorphProjectManager } from "./services/ts-morph-manager.js";
import { NodeIndexCache } from "./services/node-index-cache.js";
import { RelationshipResolverAdapter } from "../pipeline/adapters/relationship-resolver-adapter.js";
import { connectFileWatcherToCoordinator } from "./services/file-watcher-integration.js";
import { createShutdownManager } from "./shutdown.js";
import { detectApocAvailability, recoverFromCrash, verifyNeo4jSchema } from "./startup.js";
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

  // 2. Verify schema (HIGH PRIORITY FIX)
  const schemaResult = await verifyNeo4jSchema(neo4jClient);
  if (!schemaResult.valid) {
    throw new Error(`Neo4j schema verification failed: ${schemaResult.missingIndexes.join(", ")}`);
  }

  // 3. Check APOC availability
  const apocStatus = await detectApocAvailability(neo4jClient);

  // 4. Initialize health check with circuit breaker
  const neo4jHealth = new Neo4jHealthCheck(neo4jClient);

  // 5. Initialize ts-morph project manager
  const tsMorphManager = new TsMorphProjectManager(config.workspaceRoot);
  await tsMorphManager.initialize();
  shutdownManager.register("tsMorph", async () => tsMorphManager.dispose());

  // 6. Initialize node index cache (CRITICAL FIX)
  const nodeIndexCache = new NodeIndexCache();
  shutdownManager.register("nodeIndexCache", async () => nodeIndexCache.clear());

  // 7. Create relationship resolver adapter (with cache)
  const resolverAdapter = new RelationshipResolverAdapter(
    neo4jClient,
    tsMorphManager,
    nodeIndexCache,  // CRITICAL FIX: Inject cache
    config.workspaceRoot
  );

  // 8. Initialize memory monitor
  const memoryMonitor = new MemoryMonitor();
  memoryMonitor.start();
  shutdownManager.register("memoryMonitor", async () => memoryMonitor.stop());

  // 9. Create event queue with deduplication by filePath
  const eventQueue = new BoundedPriorityQueue<FileChangeEvent>(
    { maxSize: 1000, dropPolicy: "oldest", warnThreshold: 0.8 },
    (event) => event.path
  );

  // 10. Create coordinator actor
  const coordinator = createValidationCoordinatorActor({
    neo4jClient,
    neo4jHealth,
    useApoc: apocStatus.available,
    tsMorphManager,
    nodeIndexCache,  // CRITICAL FIX: Pass cache
    resolverAdapter,
    eventQueue,
    workspaceRoot: config.workspaceRoot,
  });
  shutdownManager.register("coordinator", async () => {
    coordinator.send({ type: "SHUTDOWN" });
    await new Promise(resolve => setTimeout(resolve, 5000));
  });

  // 11. Wire circuit breaker to coordinator AND queue (HIGH PRIORITY FIX)
  neo4jHealth.onStateChange((state) => {
    if (state.isOpen) {
      coordinator.send({ type: "CIRCUIT_OPEN" });
      eventQueue.pause();  // Pause queue when circuit opens
    } else {
      coordinator.send({ type: "CIRCUIT_CLOSED" });
      eventQueue.resume();  // Resume queue when circuit closes
    }
  });

  // 12. Wire memory monitor to coordinator
  memoryMonitor.onStateChange((state) => {
    if (state === "critical") {
      coordinator.send({ type: "PAUSE" });
      eventQueue.pause();
    } else if (state === "healthy") {
      coordinator.send({ type: "RESUME" });
      eventQueue.resume();
    }
  });

  // 13. Perform crash recovery
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

  // 14. Warm up ts-morph (HIGH PRIORITY FIX)
  const warmUpFiles = recovery.semanticIncomplete.slice(0, 50);
  await tsMorphManager.warmUp(warmUpFiles);

  // 15. Connect FileWatcher
  const stopWatcher = connectFileWatcherToCoordinator(coordinator, {
    watchPaths: config.watchPaths,
    debounceMs: parseInt(process.env.DEVAC_DEBOUNCE_MS ?? "100", 10),
  });
  shutdownManager.register("fileWatcher", async () => stopWatcher());

  // 16. Start coordinator
  coordinator.send({ type: "START" });

  console.info("DevAC started successfully");
  console.info(`  Workspace: ${config.workspaceRoot}`);
  console.info(`  APOC: ${apocStatus.available ? `v${apocStatus.version}` : "not available (slower)"}`);
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
  fileDeleted?: boolean;  // NEW: Flag for deleted files
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
    const structuralVersion = startTime;

    const guardResult = await checkFile(filePath, {
      ...DEFAULT_FILE_GUARD_CONFIG,
      maxFileSizeBytes: this.config.maxFileSizeBytes ?? DEFAULT_FILE_GUARD_CONFIG.maxFileSizeBytes,
    });

    // CRITICAL FIX: Handle file not existing (deleted between event and parse)
    if (!guardResult.exists) {
      return {
        success: false,
        fileDeleted: true,
        skipReason: guardResult.reason,
      };
    }

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
        skipReason: `Language not supported in v1.11: ${language}`,
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
        this.config.useApoc,
        structuralVersion
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

## Implementation Timeline (48 days)

### Phase 0: Verification (Days 1-3)

**Day 1:**
- Run `tsc --noEmit` - capture actual error count
- Verify APOC installation and version, set `useApoc` flag
- **Verify Neo4j schema** (indexes, constraints) — HIGH PRIORITY
- Map ALL import paths in actors

**Day 2:**
- Create `src/pipeline/` directory structure
- Document all import path fixes needed
- Measure baseline Neo4j latency (local vs remote)

**Day 3:**
- Verify existing tests pass
- **Verify type contracts against actual source code** — EXIT GATE
- **EXIT GATE**: All blockers documented, schema verified

### Phase 1a: Import Path Fixes (Days 4-7)

**Day 4:**
- Fix import paths in `validation-coordinator.actor.ts`
- Fix import paths in `semantic-resolver.actor.ts`

**Day 5:**
- Fix import paths in `graph-updater.actor.ts`
- Fix import paths in remaining actors

**Day 6-7:**
- Fix import paths in services
- Verify `tsc --noEmit` error count reduced
- **EXIT GATE**: Import path errors resolved

### Phase 0.5: API Reconciliation (Days 8-13)

**Day 8:**
- Create type definitions in `src/devac/types/events.ts` (complete events)
- Create type definitions in `src/devac/actors/types.ts`

**Day 9:**
- Create `ParseResultAdapter` (with corrected ExportedSymbol type)
- Create `file-watcher-integration.ts`

**Day 10:**
- Create `NodeIndexCache` — CRITICAL FIX
- Create `RelationshipResolverAdapter` (with NodeIndexCache)

**Day 11:**
- Create `SemanticUpdater` with version guard — CRITICAL FIX
- Create `file-guard.ts` with existence check — CRITICAL FIX

**Day 12-13:**
- Verify all adapter interfaces compile
- Write unit tests for adapters
- **EXIT GATE**: All adapters created, type contracts verified, unit tests pass

### Phase 1b: Fix TypeScript Errors (Days 14-25) — EXTENDED

**Day 14:**
- Install `@types/babel__traverse`
- Fix `structural-parser.ts` errors
- Fix `semantic-resolver.ts` errors

**Day 15-19:**
- Fix `validation-coordinator.actor.ts` (~30 errors)
- Focus on XState v5 typing patterns
- Rewrite state machine definitions as needed

**Day 20-22:**
- Fix `validation-coordinator.service.ts` errors
- Fix utility files

**Day 23-24:**
- Fix remaining actors (script-executor, affected-calculator)
- Fix test files

**Day 25:**
- Verify: `tsc --noEmit` produces 0 errors
- Run existing tests: `npm test`
- **EXIT GATE**: Zero TypeScript errors, existing tests pass

### Phase 2: Core Integration (Days 26-37)

**Day 26:**
- Create `LanguageRouter` with file guard and existence check
- Wire LanguageRouter into ValidationCoordinatorActor

**Day 27:**
- Implement FileMutex with LRU cleanup
- Add `withLock` wrapper

**Day 28:**
- Add delete/rename handling to ValidationCoordinator
- Add configurable rename window

**Day 29:**
- Implement retry policy with exponential backoff
- Implement APOC fallback with version check

**Day 30:**
- Add Neo4j health check with circuit breaker
- Wire circuit breaker to queue pause/resume — HIGH PRIORITY FIX

**Day 31:**
- Add queue backpressure with deduplication
- Add crash recovery with structuralInProgress flag

**Day 32:**
- Add graceful shutdown handling
- Add memory pressure monitoring

**Day 33:**
- Create startup wiring code
- Add schema verification to startup
- Add ts-morph warm-up phase — HIGH PRIORITY FIX

**Day 34-35:**
- Integration smoke tests — MOVED EARLIER
- Test: add, change, delete, rename cycle
- Test: file existence race condition
- Test: parse error handling

**Day 36-37:**
- Fix issues found
- Performance benchmarking
- **EXIT GATE**: Basic pipeline working for TS/JS, smoke tests pass

### Phase 3: Semantic Resolution (Days 38-45)

**Day 38:**
- Implement `TsMorphProjectManager` with warm-up
- Add incremental file updates

**Day 39-40:**
- Integrate with SemanticResolverActor
- Wire RelationshipResolverAdapter with NodeIndexCache

**Day 41-42:**
- Implement semantic write-back flow with version guard
- Test semantic resolution with ts-morph

**Day 43:**
- Add dependent file detection for cascading
- Test cascading updates

**Day 44-45:**
- Semantic resolution integration tests
- Fix issues
- **EXIT GATE**: Semantic resolution working incrementally

### Phase 4: Polish (Days 46-48)

**Day 46:**
- Full test suite: `npm test`
- Performance benchmarks against qualified targets
- Document known limitations

**Day 47:**
- Fix regressions
- Rename reconciliation pass implementation

**Day 48:**
- Final testing
- Buffer for unexpected issues
- **EXIT GATE**: All exit criteria met

---

## Success Criteria

### Phase 0 Exit
- [ ] APOC status and version determined
- [ ] **Neo4j schema verified** (indexes exist)
- [ ] All import paths mapped with fixes documented
- [ ] **Type contracts verified against actual source code**
- [ ] `src/pipeline/` directory created

### Phase 1a Exit
- [ ] Import path errors resolved in all actors
- [ ] Can import between actor/service files without path errors

### Phase 0.5 Exit
- [ ] All type contracts defined (aligned with actual code)
- [ ] **ExportedSymbol type matches actual structural-parser.ts**
- [ ] **NodeIndexCache created for cross-file resolution**
- [ ] All adapters created (with NodeIndexCache injection)
- [ ] **SemanticUpdater with version guard created**
- [ ] **FileGuard with existence check created**
- [ ] Adapter unit tests pass

### Phase 1b Exit
- [ ] `tsc --noEmit` produces 0 errors
- [ ] Existing unit tests pass

### Phase 2 Exit
- [ ] File add/change/delete triggers correct graph updates
- [ ] **File existence race condition handled**
- [ ] **Parse errors properly marked with status update**
- [ ] Rename detection working
- [ ] Per-file mutex prevents race conditions
- [ ] Crash recovery handles structuralInProgress and semanticQueued
- [ ] **Circuit breaker pauses queue when open**
- [ ] Queue deduplication working
- [ ] Graceful shutdown drains queue
- [ ] Memory monitoring pauses on critical
- [ ] **Integration smoke tests pass** (moved from Phase 4)

### Phase 3 Exit
- [ ] ts-morph Project updates incrementally
- [ ] **ts-morph warm-up reduces first-file latency**
- [ ] **Semantic resolution uses NodeIndexCache for full node index**
- [ ] **Semantic write-back has version guard**
- [ ] Dependent file cascading working
- [ ] Semantic integration tests pass

### Final
- [ ] `npm test` passes
- [ ] All integration tests pass
- [ ] Performance meets qualified targets (P50 <400ms warm/local/APOC)
- [ ] Documentation updated

---

## Performance Targets (Qualified)

| Metric | Target (Local+APOC) | Target (Local, no APOC) | Target (Remote) |
|--------|---------------------|------------------------|-----------------|
| Structural parse | <100ms | <100ms | <100ms |
| Graph update | <150ms | <300ms | <500ms |
| **Total (warm)** | **<400ms** | **<550ms** | **<800ms** |
| Cold start | <1500ms | <2000ms | <3000ms |

**SLO**: P50 <400ms, P95 <800ms, P99 <2000ms (measured over 24h)

**Note**: APOC is **strongly recommended**. Without APOC, expect 50-150ms additional latency per file.

---

## Known Limitations (v1.11)

1. **Languages supported**: TypeScript, JavaScript only
2. **Deferred to v2**: Python, Java (Tree-sitter), C/C++, Go, C#
3. **Validation execution disabled**: AffectedCalculator + ScriptExecutor → v2
4. **Cross-file edges**: May be stale until semantic resolution completes (version-guarded)
5. **Rename detection**: Best-effort heuristic (configurable window, default 100ms)
6. **Large files skipped**: Files >500KB are not processed
7. **No full reconciliation on startup**: Only crash recovery, not full filesystem diff
8. **Cascading updates**: Dependent files queued for semantic-only re-analysis
9. **StorageManager bypassed**: Incremental updates use direct Neo4j transactions

---

## Files to Create

| File | Purpose | Phase |
|------|---------|-------|
| `src/devac/types/events.ts` | Event type definitions (complete) | 0.5 |
| `src/devac/actors/types.ts` | Actor input/output types | 0.5 |
| `src/devac/actors/semantic-updater.ts` | Semantic write-back with version guard | 0.5 |
| `src/devac/services/node-index-cache.ts` | In-memory node cache for semantic resolution | 0.5 |
| `src/pipeline/language-router.ts` | Route files to parsers | 2 |
| `src/pipeline/adapters/parse-result-adapter.ts` | Bridge type mismatch (aligned) | 0.5 |
| `src/pipeline/adapters/relationship-resolver-adapter.ts` | Wrap resolver (with NodeIndexCache) | 0.5 |
| `src/devac/utils/file-mutex.ts` | Per-file locking with LRU | 2 |
| `src/devac/utils/file-guard.ts` | File size/type/existence validation | 2 |
| `src/devac/utils/retry.ts` | Retry with exponential backoff | 2 |
| `src/devac/utils/apoc-fallback.ts` | Non-APOC Cypher queries | 2 |
| `src/devac/utils/bounded-queue.ts` | Backpressure queue with dedup and pause | 2 |
| `src/devac/utils/rename-detector.ts` | Rename detection (configurable) | 2 |
| `src/devac/utils/reconciliation.ts` | Post-rename integrity check | 4 |
| `src/devac/utils/metrics.ts` | Performance logging (qualified) | 2 |
| `src/devac/utils/memory-monitor.ts` | Memory pressure monitoring | 2 |
| `src/devac/services/file-watcher-integration.ts` | Connect FileWatcher to actor | 0.5 |
| `src/devac/services/ts-morph-manager.ts` | ts-morph Project lifecycle with warm-up | 3 |
| `src/devac/startup.ts` | APOC detection, schema verification, crash recovery | 2 |
| `src/devac/shutdown.ts` | Graceful shutdown handling | 2 |
| `src/devac/main.ts` | Startup wiring code | 2 |
| `src/database/neo4j-health.ts` | Health check with circuit breaker | 2 |

## Files to Modify

| File | Changes | Phase |
|------|---------|-------|
| `validation-coordinator.actor.ts` | Fix imports, add all events, mutex, delete handling, crash recovery, circuit breaker, parse error handling | 1a, 2 |
| `graph-updater.actor.ts` | Fix imports, batch relationships, APOC fallback, retry policy, structuralInProgress, update NodeIndexCache | 1a, 2 |
| `semantic-resolver.actor.ts` | Fix imports, use adapter with NodeIndexCache, ts-morph lifecycle, cascading | 1a, 3 |
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
- Worker thread option for parsing under heavy load
- Queue persistence/clearing rules on crash (beyond in-memory)

---

## Validation Checklist

### Critical Items Addressed

| Issue | Section | Status |
|-------|---------|--------|
| RelationshipResolverAdapter design fix (node index) | P0.5, P0.6 | ✅ ADDRESSED |
| ExportedSymbol type corrected | Type Contracts | ✅ ADDRESSED |
| File existence check | P0.8 | ✅ ADDRESSED |
| Version guard in semantic write-back | P0.7 | ✅ ADDRESSED |

### High Priority Items Addressed

| Issue | Section | Status |
|-------|---------|--------|
| Schema verification in Phase 0 | P1.1 | ✅ ADDRESSED |
| StorageManager relationship documented | Architecture | ✅ ADDRESSED |
| State machine diagram | Architecture | ✅ ADDRESSED |
| Integration tests moved earlier | P2.3, Timeline | ✅ ADDRESSED |
| Phase 1b timeline extended | Timeline | ✅ ADDRESSED |
| Parse error handling flow | P1.3 | ✅ ADDRESSED |
| ts-morph warm-up phase | P1.2 | ✅ ADDRESSED |
| Circuit breaker ↔ queue interaction | P1.4, P1.5 | ✅ ADDRESSED |

### Timeline Adjustment
- v1.8: 26 days
- v1.9: 30 days
- v1.10: 38 days
- v1.11: **48 days** (+10 days for critical fixes and extended Phase 1b)

### Scope
- TypeScript/JavaScript only (focus on reliability)
- Tree-sitter languages deferred to v2

**Spec v1.11 is IMPLEMENTATION-READY.**
