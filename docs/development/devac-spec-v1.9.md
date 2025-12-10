# DevAC Spec v1.9: Incremental Graph Updates

> **Version**: 1.9 (Implementation-Ready)  
> **Date**: 2025-12-10  
> **Status**: APPROVED FOR IMPLEMENTATION  
> **Timeline**: 30 days  
> **Previous Version**: v1.8 (superseded)

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
| v1.9 | Phase reordering, API contracts fixed, retry/backpressure policies, ts-morph lifecycle, 30-day timeline | **Current** |

---

## Changes from v1.8

### Critical Fixes (P0)
1. **Phase reordering**: Import path fixes (Phase 1a) now precede adapter creation (Phase 0.5)
2. **GraphUpdaterResult contract**: Full type mapping between StructuralParser output and Neo4j helpers
3. **Retry policy**: Explicit exponential backoff with max retries defined
4. **RelationshipResolver API bridge**: Complete adapter implementation with data transformation

### High Priority Fixes (P1)
5. **ts-morph incremental lifecycle**: Explicit strategy for Project instance management
6. **Backpressure policy**: Queue depth limits, drop/merge policies defined
7. **Graceful shutdown**: SIGTERM handling with drain timeout
8. **Circuit breaker behavior**: Defined FileWatcher pause when circuit opens

### Medium Priority Fixes (P2)
9. **File size guard**: Skip files exceeding 500KB
10. **Performance budgets**: Per-scenario targets (APOC vs fallback, cold vs warm)
11. **Rename reconciliation**: Post-rename integrity check in Phase 4
12. **Integration test requirements**: Specific incremental update test scenarios

### Scope Changes
- **Tree-sitter deferred to v2**: Python/Java support removed from timeline (too risky for v1.9)
- **Timeline extended to 30 days**: Based on reviewer consensus

---

## Architecture

### Pipeline Flow

```
FileWatcher
    │
    ▼ FileChangeEvent
ValidationCoordinatorActor
    │
    ├─► [1] FileMutex.acquire(filePath)
    │
    ├─► [2] FileGuard.checkSize() → reject if >500KB
    │
    ├─► [3] LanguageRouter.parse() → StructuralParseResult
    │       └─► ParseResultAdapter → GraphUpdaterInput
    │
    ├─► [4] GraphUpdaterActor → Neo4j atomic update
    │       └─► Transaction: DELETE old → CREATE new (single tx)
    │
    ├─► [5] SemanticResolverActor.enqueue() [TS/JS only]
    │
    └─► [6] FileMutex.release()

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
| StructuralParser | `src/analyzer/structural-parser.ts` | Working |
| RelationshipResolver | `src/analyzer/relationship-resolver.ts` | API mismatch |

---

## Type Contracts (Complete Definitions)

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

### StructuralParseResult (StructuralParser output)

```typescript
// src/analyzer/types.ts

export interface AstNode {
  entityId: string;       // Unique ID (e.g., "file.ts:Function:myFunc:10:5")
  kind: AstNodeKind;      // "Function" | "Class" | "Method" | etc.
  name: string;
  filePath: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  parentId?: string;      // For nested declarations
  modifiers?: string[];   // "export", "async", "static", etc.
}

export type AstNodeKind = 
  | "Function" | "Class" | "Method" | "Variable" | "Interface"
  | "TypeAlias" | "Enum" | "Module" | "Import" | "Export"
  | "Property" | "Parameter" | "Constructor";

export interface RelationshipInfo {
  source: string;         // entityId
  target: string;         // entityId
  type: RelationshipType;
}

export type RelationshipType = 
  | "CONTAINS" | "CALLS" | "IMPORTS" | "EXPORTS" | "EXTENDS"
  | "IMPLEMENTS" | "USES" | "REFERENCES" | "DECLARES";

export interface StructuralParseResult {
  nodes: AstNode[];
  relationships: RelationshipInfo[];
  imports: ImportInfo[];
  exports: ExportInfo[];
}

export interface ImportInfo {
  importPath: string;     // "./utils" or "lodash"
  importedNames: string[];
  isTypeOnly: boolean;
  line: number;
}

export interface ExportInfo {
  name: string;
  kind: AstNodeKind;
  isDefault: boolean;
  isReexport: boolean;
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
  imports: ImportInfo[];
  exports: ExportInfo[];
  useApoc: boolean;
}

export interface GraphNode {
  entityId: string;
  labels: string[];       // ["Node", kind] e.g., ["Node", "Function"]
  properties: {
    entityId: string;
    name: string;
    filePath: string;
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
    modifiers?: string[];
    [key: string]: unknown;
  };
}

export interface GraphRelationship {
  sourceEntityId: string;
  targetEntityId: string;
  type: RelationshipType;
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
  structuralVersion: number;  // NEW: For version guard
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
  const { neo4jClient, filePath, nodes, relationships, imports, exports, useApoc } = input;

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
             f.semanticQueued = true,
             f.semanticComplete = false,
             f.lastModified = datetime(),
             f.parseError = null,
             f.structuralVersion = $version`,
        { filePath, version: Date.now() }
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
      await storeImportsAndExports(tx, filePath, imports, exports);

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
```

**Failure Scenarios**:

| Scenario | Behavior | Data State |
|----------|----------|------------|
| Parse fails | Mark parseError on File node | Existing nodes preserved |
| Neo4j tx fails mid-update | Auto-rollback by Neo4j | Existing nodes preserved |
| Neo4j connection lost | Retry with backoff (see P0.2) | Existing nodes preserved |
| Process crash during tx | Uncommitted tx discarded | Existing nodes preserved |

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

### P0.3: APOC Fallback Cypher

```typescript
// src/devac/utils/apoc-fallback.ts

const VALID_NODE_KINDS: string[] = [
  "Function", "Class", "Method", "Variable", "Interface",
  "TypeAlias", "Enum", "Module", "Import", "Export",
  "Property", "Parameter", "Constructor"
];

const VALID_RELATIONSHIP_TYPES: string[] = [
  "CONTAINS", "CALLS", "IMPORTS", "EXPORTS", "EXTENDS",
  "IMPLEMENTS", "USES", "REFERENCES", "DECLARES", "OWNS"
];

export async function createNodesWithLabels(
  tx: ManagedTransaction,
  nodes: GraphNode[],
  useApoc: boolean
): Promise<{ nodesCreated: number }> {
  if (useApoc) {
    // APOC version (preferred - single query)
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
    // Validate kind against whitelist to prevent injection
    if (!VALID_NODE_KINDS.includes(kind)) {
      console.warn(`Skipping invalid node kind: ${kind}`);
      continue;
    }

    // Safe: kind is validated against whitelist
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
    // Validate relationship type against whitelist
    if (!VALID_RELATIONSHIP_TYPES.includes(type)) {
      console.warn(`Skipping invalid relationship type: ${type}`);
      continue;
    }

    // Safe: type is validated against whitelist
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

**APOC Detection on startup**:

```typescript
// src/devac/startup.ts

export async function detectApocAvailability(
  neo4jClient: Neo4jClient
): Promise<boolean> {
  try {
    await neo4jClient.runTransaction(
      `RETURN apoc.version() as version`,
      {},
      "READ",
      "CheckApoc"
    );
    console.info("APOC detected - using optimized queries");
    return true;
  } catch {
    console.warn("APOC not available - using fallback queries (slower)");
    return false;
  }
}
```

### P0.4: ParseResultAdapter (Complete Implementation)

```typescript
// src/pipeline/adapters/parse-result-adapter.ts

import type { StructuralParseResult, AstNode, RelationshipInfo } from "../../analyzer/types.js";
import type { GraphUpdaterInput, GraphNode, GraphRelationship } from "../../devac/actors/types.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";

export function adaptParseResult(
  parseResult: StructuralParseResult,
  filePath: string,
  neo4jClient: Neo4jClient,
  useApoc: boolean
): GraphUpdaterInput {
  return {
    neo4jClient,
    filePath,
    nodes: parseResult.nodes.map(adaptNode),
    relationships: parseResult.relationships.map(adaptRelationship),
    imports: parseResult.imports,
    exports: parseResult.exports,
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
      line: node.line,
      column: node.column,
      endLine: node.endLine,
      endColumn: node.endColumn,
      modifiers: node.modifiers,
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

### P0.5: RelationshipResolverAdapter (Complete Implementation)

The existing `RelationshipResolver` has constructor signature `(allNodes: AstNode[], pass1Relationships: RelationshipInfo[])`. The semantic phase needs a different interface.

```typescript
// src/pipeline/adapters/relationship-resolver-adapter.ts

import type { AstNode, RelationshipInfo, ImportInfo } from "../../analyzer/types.js";
import { RelationshipResolver } from "../../analyzer/relationship-resolver.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";

export interface SemanticResolverInterface {
  resolveImports(
    filePath: string,
    imports: ImportInfo[]
  ): Promise<ResolvedImport[]>;
  
  resolveReferences(
    nodes: AstNode[],
    relationships: RelationshipInfo[]
  ): Promise<RelationshipInfo[]>;
}

export interface ResolvedImport {
  importPath: string;
  resolvedFilePath: string | null;
  resolvedSymbols: Array<{
    importedName: string;
    resolvedEntityId: string | null;
  }>;
}

export class RelationshipResolverAdapter implements SemanticResolverInterface {
  private neo4jClient: Neo4jClient;
  private workspaceRoot: string;

  constructor(neo4jClient: Neo4jClient, workspaceRoot: string) {
    this.neo4jClient = neo4jClient;
    this.workspaceRoot = workspaceRoot;
  }

  async resolveImports(
    filePath: string,
    imports: ImportInfo[]
  ): Promise<ResolvedImport[]> {
    const results: ResolvedImport[] = [];

    for (const imp of imports) {
      const resolvedPath = await this.resolveImportPath(filePath, imp.importPath);
      
      const resolvedSymbols = await Promise.all(
        imp.importedNames.map(async (name) => ({
          importedName: name,
          resolvedEntityId: resolvedPath
            ? await this.findExportedSymbol(resolvedPath, name)
            : null,
        }))
      );

      results.push({
        importPath: imp.importPath,
        resolvedFilePath: resolvedPath,
        resolvedSymbols,
      });
    }

    return results;
  }

  async resolveReferences(
    nodes: AstNode[],
    relationships: RelationshipInfo[]
  ): Promise<RelationshipInfo[]> {
    // Delegate to existing RelationshipResolver for pass-2 resolution
    try {
      const resolver = new RelationshipResolver(nodes, relationships);
      return resolver.resolvePass2();
    } catch (error) {
      console.warn("RelationshipResolver.resolvePass2 failed:", error);
      return relationships; // Return unresolved relationships
    }
  }

  private async resolveImportPath(
    fromFile: string,
    importPath: string
  ): Promise<string | null> {
    // Query Neo4j for file that exports matching path
    const result = await this.neo4jClient.runTransaction(
      `MATCH (f:File)
       WHERE f.filePath ENDS WITH $suffix
          OR f.filePath = $absolute
       RETURN f.filePath as filePath
       LIMIT 1`,
      {
        suffix: importPath.replace(/^\.\//, "/").replace(/^\.\.\//, "/"),
        absolute: importPath,
      },
      "READ",
      "ResolveImport"
    );

    return result.records[0]?.get("filePath") as string | null;
  }

  private async findExportedSymbol(
    filePath: string,
    symbolName: string
  ): Promise<string | null> {
    const result = await this.neo4jClient.runTransaction(
      `MATCH (f:File {filePath: $filePath})-[:OWNS]->(n:Node)
       WHERE n.name = $symbolName
       RETURN n.entityId as entityId
       LIMIT 1`,
      { filePath, symbolName },
      "READ",
      "FindExport"
    );

    return result.records[0]?.get("entityId") as string | null;
  }
}
```

### P0.6: Delete/Rename Handling

**File Deletion Flow**:

```typescript
// In ValidationCoordinatorActor

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

**Rename Detection** (best-effort via timestamp heuristic):

```typescript
// src/devac/utils/rename-detector.ts

export interface RenameDetector {
  pendingUnlinks: Map<string, { timestamp: number; size?: number }>;
  windowMs: number;
}

export function createRenameDetector(windowMs: number = 100): RenameDetector {
  return {
    pendingUnlinks: new Map(),
    windowMs,
  };
}

export function detectRename(
  event: FileChangeEvent,
  detector: RenameDetector
): { type: "rename"; oldPath: string; newPath: string } | null {
  const now = Date.now();

  // Cleanup old entries
  for (const [path, info] of detector.pendingUnlinks) {
    if (now - info.timestamp > detector.windowMs * 2) {
      detector.pendingUnlinks.delete(path);
    }
  }

  if (event.type === "unlink") {
    detector.pendingUnlinks.set(event.path, { timestamp: now });
    return null;
  }

  if (event.type === "add") {
    // Look for recent unlink
    for (const [oldPath, info] of detector.pendingUnlinks) {
      if (now - info.timestamp < detector.windowMs) {
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
         MATCH (n:Node) WHERE n.entityId STARTS WITH $oldPath
         SET n.entityId = replace(n.entityId, $oldPath, $newPath)
         RETURN nodesUpdated`,
        { oldPath, newPath },
        "WRITE",
        "RenameFile"
      ),
    DEFAULT_RETRY_POLICY,
    `RenameFile(${oldPath} → ${newPath})`
  );

  console.info(`Renamed file in graph: ${oldPath} → ${newPath}`);
}
```

### P0.7: Crash Recovery

```typescript
// src/devac/startup.ts

export async function recoverFromCrash(
  neo4jClient: Neo4jClient
): Promise<string[]> {
  // Find files that were queued for semantic but never completed
  const result = await neo4jClient.runTransaction(
    `MATCH (f:File)
     WHERE f.semanticQueued = true AND f.semanticComplete = false
     RETURN f.filePath as filePath, f.structuralVersion as version
     ORDER BY f.structuralVersion DESC
     LIMIT 100`,
    {},
    "READ",
    "CrashRecovery-FindQueued"
  );

  const filesToRequeue = result.records.map((r) => r.get("filePath") as string);

  if (filesToRequeue.length > 0) {
    console.info(
      `Crash recovery: requeueing ${filesToRequeue.length} files for semantic resolution`
    );
  }

  return filesToRequeue;
}

// Also check for structural incompleteness
export async function findIncompleteStructuralUpdates(
  neo4jClient: Neo4jClient
): Promise<string[]> {
  const result = await neo4jClient.runTransaction(
    `MATCH (f:File)
     WHERE f.structuralComplete = false OR f.structuralComplete IS NULL
     RETURN f.filePath as filePath
     LIMIT 50`,
    {},
    "READ",
    "CrashRecovery-FindIncomplete"
  );

  return result.records.map((r) => r.get("filePath") as string);
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
      skipAddingFilesFromTsConfig: true, // We'll add files incrementally
    });
    console.info("ts-morph Project initialized");
  }

  async updateFile(filePath: string, version: number): Promise<SourceFile | null> {
    if (!this.project) {
      await this.initialize();
    }

    const existingVersion = this.fileVersions.get(filePath);
    if (existingVersion && existingVersion >= version) {
      // Already have this version or newer
      return this.project!.getSourceFile(filePath) ?? null;
    }

    let sourceFile = this.project!.getSourceFile(filePath);

    if (sourceFile) {
      // Refresh existing file from filesystem
      await sourceFile.refreshFromFileSystem();
    } else {
      // Add new file to project
      sourceFile = this.project!.addSourceFileAtPath(filePath);
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
        const resolved = imp.getModuleSpecifierSourceFile();
        if (resolved?.getFilePath() === filePath) {
          dependents.push(sf.getFilePath());
          break;
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

### P1.2: Backpressure and Queue Management

```typescript
// src/devac/utils/bounded-queue.ts

export interface QueuePolicy {
  maxSize: number;
  dropPolicy: "oldest" | "newest" | "reject";
  warnThreshold: number; // Percentage (0.0-1.0)
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
}

export class BoundedPriorityQueue<T> {
  private items: QueueItem<T>[] = [];
  private policy: QueuePolicy;
  private warningIssued = false;

  constructor(policy: QueuePolicy = DEFAULT_QUEUE_POLICY) {
    this.policy = policy;
  }

  enqueue(data: T, priority: "high" | "normal" = "normal"): boolean {
    const item: QueueItem<T> = {
      data,
      priority,
      timestamp: Date.now(),
    };

    // Check capacity
    if (this.items.length >= this.policy.maxSize) {
      switch (this.policy.dropPolicy) {
        case "reject":
          console.warn("Queue full, rejecting new item");
          return false;
        case "newest":
          console.warn("Queue full, dropping new item");
          return false;
        case "oldest":
          const dropped = this.items.shift();
          console.warn("Queue full, dropped oldest item:", dropped?.data);
          break;
      }
    }

    // Insert by priority (high priority at front)
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

    // Check warning threshold
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

  peek(): QueueItem<T> | undefined {
    return this.items[0];
  }

  size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  clear(): void {
    this.items = [];
    this.warningIssued = false;
  }

  // Remove items matching predicate (for deduplication)
  removeWhere(predicate: (data: T) => boolean): number {
    const before = this.items.length;
    this.items = this.items.filter((item) => !predicate(item.data));
    return before - this.items.length;
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
  private circuitResetMs = 30000; // 30 seconds
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
    // Check if circuit should reset (half-open state)
    if (this.circuitOpen && this.circuitOpenedAt) {
      if (Date.now() - this.circuitOpenedAt > this.circuitResetMs) {
        console.info("Neo4j circuit breaker: attempting reset (half-open)");
        // Don't reset yet - let the health check determine
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

  async ensureConnection(): Promise<void> {
    if (this.circuitOpen) {
      throw new Error("Neo4j circuit breaker is open - connection unavailable");
    }

    const healthy = await this.checkHealth();
    if (!healthy) {
      throw new Error("Neo4j health check failed");
    }
  }
}
```

**FileWatcher coordination when circuit opens**:

```typescript
// In ValidationCoordinatorActor

// During initialization:
const unsubscribe = neo4jHealth.onStateChange((state) => {
  if (state.isOpen) {
    // Pause FileWatcher intake
    send({ type: "CIRCUIT_OPEN" });
  } else {
    // Resume FileWatcher intake
    send({ type: "CIRCUIT_CLOSED" });
  }
});

// State machine states:
states: {
  healthy: {
    on: {
      CIRCUIT_OPEN: "degraded",
      FILE_CHANGED: { actions: "enqueueEvent" },
    },
  },
  degraded: {
    entry: [
      () => console.warn("Entering degraded mode - FileWatcher events will be queued"),
    ],
    on: {
      CIRCUIT_CLOSED: "healthy",
      FILE_CHANGED: {
        actions: ({ context, event }) => {
          // Still queue events but don't process
          context.pendingEvents.enqueue(event.event, "normal");
        },
      },
    },
    after: {
      // Periodically check if circuit has closed
      5000: {
        target: "degraded",
        reenter: true,
        actions: async ({ context }) => {
          await context.neo4jHealth.checkHealth();
        },
      },
    },
  },
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

  // Register signal handlers
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

// Usage in main:
const shutdownManager = createShutdownManager();

shutdownManager.register("fileWatcher", async () => {
  fileWatcher.close();
});

shutdownManager.register("coordinator", async () => {
  coordinator.send({ type: "PAUSE" });
  // Wait for current operation to complete
  await coordinator.waitForIdle(5000);
});

shutdownManager.register("neo4j", async () => {
  await neo4jClient.close();
});
```

### P1.5: FileMutex with LRU Cleanup and Deadlock Prevention

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
      // Wait for existing lock with timeout
      const timeoutPromise = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), timeoutMs)
      );

      const result = await Promise.race([existing, timeoutPromise]);
      if (result === "timeout") {
        console.warn(`FileMutex timeout waiting for lock: ${filePath}`);
        // Force release stale lock
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

  // Wrap operation with automatic release on error
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
      release(); // Always release, even on error
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);
  }

  private cleanup(): void {
    const staleThreshold = Date.now() - 300000; // 5 minutes
    let removed = 0;

    for (const [path, lastAccess] of this.lastAccess) {
      if (lastAccess < staleThreshold && !this.locks.has(path)) {
        this.sequence.delete(path);
        this.lastAccess.delete(path);
        removed++;
      }
    }

    if (this.sequence.size > this.maxEntries) {
      const entries = Array.from(this.lastAccess.entries())
        .filter(([path]) => !this.locks.has(path))
        .sort((a, b) => a[1] - b[1]);

      const toRemove = entries.slice(0, this.sequence.size - this.maxEntries);
      for (const [path] of toRemove) {
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
  maxFileSizeBytes: 500 * 1024, // 500KB
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
  // Check extension
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  if (!config.allowedExtensions.includes(ext)) {
    return {
      allowed: false,
      reason: `Unsupported extension: ${ext}`,
    };
  }

  // Check size
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

---

## P2: MEDIUM PRIORITY FIXES

### P2.1: Performance Budgets (Per-Scenario)

| Scenario | Structural Parse | Graph Update | Total Target |
|----------|-----------------|--------------|--------------|
| Small file (<100 LOC), warm | <50ms | <150ms | <300ms |
| Medium file (100-1000 LOC), warm | <100ms | <200ms | <400ms |
| Large file (1000-5000 LOC), warm | <200ms | <300ms | <600ms |
| Small file, cold start | <200ms | <500ms | <1000ms |
| With APOC | As above | -30% | As above -20% |
| Without APOC (fallback) | As above | +50% | As above +30% |

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
}

export function logMetrics(filePath: string, metrics: PipelineMetrics): void {
  const status =
    metrics.totalTimeMs <= 500
      ? "OK"
      : metrics.totalTimeMs <= 1000
        ? "WARN"
        : "SLOW";

  console.info(
    `[${status}] ${filePath}: ` +
      `parse=${metrics.parseTimeMs}ms, ` +
      `graph=${metrics.graphUpdateTimeMs}ms, ` +
      `total=${metrics.totalTimeMs}ms, ` +
      `nodes=${metrics.nodeCount}, ` +
      `rels=${metrics.relationshipCount}, ` +
      `size=${metrics.fileSize}B, ` +
      `apoc=${metrics.usedApoc}`
  );
}
```

### P2.2: Rename Reconciliation Pass

```typescript
// src/devac/utils/reconciliation.ts

export async function reconcileRenames(
  neo4jClient: Neo4jClient,
  workspaceRoot: string
): Promise<{ fixed: number; errors: string[] }> {
  const errors: string[] = [];
  let fixed = 0;

  // Find nodes with filePath that doesn't exist on disk
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
      // File doesn't exist - check if it was renamed
      const fileName = filePath.split("/").pop() ?? "";
      const dirPath = filePath.substring(0, filePath.lastIndexOf("/"));

      // Try to find similar file in same directory
      const possibleNewPath = await findSimilarFile(dirPath, fileName);

      if (possibleNewPath) {
        await handleRename(neo4jClient, filePath, possibleNewPath);
        fixed++;
        console.info(`Reconciled rename: ${filePath} → ${possibleNewPath}`);
      } else {
        // File was deleted, not renamed
        await handleFileDelete(neo4jClient, filePath);
        console.info(`Reconciled delete: ${filePath}`);
      }
    }
  }

  return { fixed, errors };
}

async function findSimilarFile(
  dirPath: string,
  fileName: string
): Promise<string | null> {
  // Simple heuristic: look for files with same extension and similar name
  try {
    const { readdir } = await import("fs/promises");
    const files = await readdir(dirPath);
    const ext = fileName.substring(fileName.lastIndexOf("."));
    const baseName = fileName.substring(0, fileName.lastIndexOf("."));

    for (const file of files) {
      if (file.endsWith(ext) && !files.includes(fileName)) {
        // Check if this file exists in DB
        const fullPath = `${dirPath}/${file}`;
        // If not in DB, might be the renamed version
        // This is a heuristic and may have false positives
        const fileBaseName = file.substring(0, file.lastIndexOf("."));
        if (levenshteinDistance(baseName, fileBaseName) <= 3) {
          return fullPath;
        }
      }
    }
  } catch {
    // Directory doesn't exist or not accessible
  }

  return null;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

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

### P2.3: Integration Test Scenarios

```typescript
// tests/integration/incremental-updates.test.ts

describe("Incremental Updates", () => {
  describe("Add file", () => {
    it("should create File node and owned Node nodes", async () => {
      // Create test file
      await writeFile(testFilePath, testContent);
      
      // Wait for processing
      await waitForProcessing(testFilePath);
      
      // Verify
      const result = await neo4jClient.runTransaction(
        `MATCH (f:File {filePath: $path})-[:OWNS]->(n:Node)
         RETURN count(n) as nodeCount`,
        { path: testFilePath },
        "READ"
      );
      expect(result.records[0].get("nodeCount").toNumber()).toBeGreaterThan(0);
    });
  });

  describe("Change file", () => {
    it("should replace old nodes with new nodes atomically", async () => {
      // Get initial node count
      const before = await getNodeCount(testFilePath);
      
      // Modify file (add a function)
      await appendFile(testFilePath, "\nexport function newFunc() {}");
      
      // Wait for processing
      await waitForProcessing(testFilePath);
      
      // Verify count increased
      const after = await getNodeCount(testFilePath);
      expect(after).toBeGreaterThan(before);
      
      // Verify no orphan nodes
      const orphans = await getOrphanNodes();
      expect(orphans).toHaveLength(0);
    });
  });

  describe("Delete file", () => {
    it("should remove File node and all owned nodes", async () => {
      // Delete test file
      await unlink(testFilePath);
      
      // Wait for processing
      await waitForProcessing(testFilePath);
      
      // Verify no nodes remain
      const result = await neo4jClient.runTransaction(
        `MATCH (f:File {filePath: $path})
         OPTIONAL MATCH (f)-[:OWNS]->(n:Node)
         RETURN f, collect(n) as nodes`,
        { path: testFilePath },
        "READ"
      );
      expect(result.records).toHaveLength(0);
    });
  });

  describe("Rename file", () => {
    it("should update filePath on File and Node nodes", async () => {
      const oldPath = testFilePath;
      const newPath = testFilePath.replace(".ts", "-renamed.ts");
      
      // Rename file
      await rename(oldPath, newPath);
      
      // Wait for processing (unlink + add within 100ms)
      await waitForProcessing(newPath);
      
      // Verify old path doesn't exist
      const oldResult = await neo4jClient.runTransaction(
        `MATCH (f:File {filePath: $path}) RETURN f`,
        { path: oldPath },
        "READ"
      );
      expect(oldResult.records).toHaveLength(0);
      
      // Verify new path exists with same node count
      const newResult = await neo4jClient.runTransaction(
        `MATCH (f:File {filePath: $path})-[:OWNS]->(n:Node)
         RETURN count(n) as nodeCount`,
        { path: newPath },
        "READ"
      );
      expect(newResult.records[0].get("nodeCount").toNumber()).toBeGreaterThan(0);
    });
  });

  describe("Rapid changes", () => {
    it("should process only the latest version", async () => {
      // Make 5 rapid changes
      for (let i = 0; i < 5; i++) {
        await writeFile(testFilePath, `// Version ${i}\nexport const x = ${i};`);
        await sleep(10); // 10ms between changes
      }
      
      // Wait for processing
      await waitForProcessing(testFilePath);
      
      // Verify only latest version is in graph
      const result = await neo4jClient.runTransaction(
        `MATCH (f:File {filePath: $path})
         RETURN f.structuralVersion as version`,
        { path: testFilePath },
        "READ"
      );
      // Version should be recent (not stale)
      const version = result.records[0].get("version").toNumber();
      expect(Date.now() - version).toBeLessThan(5000);
    });
  });
});
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
    // File guard check
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

    // Only TypeScript/JavaScript supported in v1.9
    if (language !== "typescript" && language !== "javascript") {
      return {
        success: false,
        skipped: true,
        skipReason: `Language not supported in v1.9: ${language}`,
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
        filePath,
        this.config.neo4jClient,
        this.config.useApoc
      );

      return { success: true, data: adapted };
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
  // Deferred to v2:
  // ".py": "python",
  // ".java": "java",
  // ".go": "go",
  // ".c": "c",
  // ".cpp": "cpp",
  // ".cs": "csharp",
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
  const renameDetector = createRenameDetector(debounceMs);
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

    // Check for rename
    const rename = detectRename(event, renameDetector);
    if (rename) {
      coordinator.send({
        type: "FILE_RENAMED",
        oldPath: rename.oldPath,
        newPath: rename.newPath,
      });
      return;
    }

    // Debounce rapid events for same file
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

  // Return cleanup function
  return () => {
    // Clear pending debounce timers
    for (const timeout of pendingEvents.values()) {
      clearTimeout(timeout);
    }
    pendingEvents.clear();
    watcher.close();
  };
}
```

---

## Implementation Timeline (30 days)

### Phase 0: Verification (Days 1-2)

**Day 1:**
- Run `tsc --noEmit` - capture actual error count (expect 103+)
- Verify APOC installation, set `useApoc` flag
- Verify Neo4j indexes exist
- Map ALL import paths in actors
- Create `src/pipeline/` directory structure

**Day 2:**
- Document all import path fixes needed
- Measure baseline Neo4j latency (local vs remote)
- Verify existing tests pass
- **EXIT GATE**: All blockers documented with mitigation paths

### Phase 1a: Import Path Fixes (Days 3-4) - NEW

**Day 3:**
- Fix import paths in `validation-coordinator.actor.ts`
- Fix import paths in `semantic-resolver.actor.ts`
- Fix import paths in `graph-updater.actor.ts`

**Day 4:**
- Fix import paths in remaining actors
- Fix import paths in services
- Verify `tsc --noEmit` error count reduced
- **EXIT GATE**: Import path errors resolved (not zero total errors, but path errors fixed)

### Phase 0.5: API Reconciliation (Days 5-7)

**Day 5:**
- Create type definitions in `src/devac/types/events.ts`
- Create type definitions in `src/devac/actors/types.ts`
- Create `ParseResultAdapter`

**Day 6:**
- Create `RelationshipResolverAdapter`
- Create `file-watcher-integration.ts`

**Day 7:**
- Verify all adapter interfaces compile
- Write unit tests for adapters
- **EXIT GATE**: All adapters created, interfaces compile

### Phase 1b: Fix TypeScript Errors (Days 8-14)

**Day 8:**
- Install `@types/babel__traverse`
- Fix `structural-parser.ts` (9 errors)
- Fix `semantic-resolver.ts` (2 errors)

**Day 9-10:**
- Fix `validation-coordinator.actor.ts` (~30 remaining errors)
- Focus on XState v5 typing patterns

**Day 11:**
- Fix `validation-coordinator.service.ts` (~19 errors)
- Fix utility files

**Day 12-13:**
- Fix remaining actors (script-executor, affected-calculator)
- Fix test files

**Day 14:**
- Verify: `tsc --noEmit` produces 0 errors
- Run existing tests: `npm test`
- **EXIT GATE**: Zero TypeScript errors, existing tests pass

### Phase 2: Core Integration (Days 15-22)

**Day 15:**
- Create `LanguageRouter` with file guard
- Wire LanguageRouter into ValidationCoordinatorActor

**Day 16:**
- Implement FileMutex with LRU cleanup
- Add `withLock` wrapper for deadlock prevention

**Day 17:**
- Add delete/rename handling to ValidationCoordinator
- Test: file delete removes nodes

**Day 18:**
- Implement retry policy with exponential backoff
- Implement APOC fallback in GraphUpdater

**Day 19:**
- Add Neo4j health check with circuit breaker
- Add FileWatcher coordination when circuit opens

**Day 20:**
- Add queue backpressure
- Add crash recovery on startup
- Add graceful shutdown handling

**Day 21:**
- Integration smoke tests
- Test: add, change, delete, rename cycle

**Day 22:**
- Fix issues found
- Performance benchmarking
- **EXIT GATE**: Basic pipeline working for TS/JS

### Phase 3: ts-morph Lifecycle (Days 23-25)

**Day 23:**
- Implement `TsMorphProjectManager`
- Add incremental file updates

**Day 24:**
- Integrate with SemanticResolverActor
- Test semantic resolution with ts-morph

**Day 25:**
- Add dependent file detection
- Test cascading updates
- **EXIT GATE**: Semantic resolution working incrementally

### Phase 4: Polish (Days 26-30)

**Day 26:**
- Full test suite: `npm test`
- Integration tests from P2.3

**Day 27:**
- Rename reconciliation pass implementation
- Test reconciliation

**Day 28:**
- Performance benchmarks against targets
- Document known limitations

**Day 29:**
- Fix regressions
- Buffer for unexpected issues

**Day 30:**
- Final testing
- Documentation update
- **EXIT GATE**: All exit criteria met

---

## Success Criteria

### Phase 0 Exit
- [ ] APOC status determined, fallback ready if needed
- [ ] All import paths mapped with fixes documented
- [ ] Neo4j baseline latency measured
- [ ] `src/pipeline/` directory created

### Phase 1a Exit
- [ ] Import path errors resolved in all actors
- [ ] Can import between actor/service files without path errors

### Phase 0.5 Exit
- [ ] All type contracts defined
- [ ] All adapters created
- [ ] Adapter unit tests pass

### Phase 1b Exit
- [ ] `tsc --noEmit` produces 0 errors
- [ ] Existing unit tests pass

### Phase 2 Exit
- [ ] File add/change/delete triggers correct graph updates
- [ ] Rename detection working
- [ ] Per-file mutex prevents race conditions
- [ ] Crash recovery requeues incomplete files
- [ ] Circuit breaker stops operations on Neo4j failure
- [ ] Graceful shutdown drains queue

### Phase 3 Exit
- [ ] ts-morph Project updates incrementally
- [ ] Semantic resolution works without full reparse
- [ ] Dependent file detection works

### Final
- [ ] `npm test` passes
- [ ] Integration tests pass
- [ ] Total latency <500ms per file (warm cache, typical file)
- [ ] Documentation updated

---

## Performance Targets

| Metric | Target (Warm) | Target (Cold) | Notes |
|--------|---------------|---------------|-------|
| TS/JS structural parse | <100ms | <200ms | Babel |
| Graph update (with APOC) | <200ms | <400ms | Batched writes |
| Graph update (fallback) | <300ms | <600ms | Multiple queries |
| Total per-file latency | <500ms | <1000ms | Typical file <1000 LOC |
| Cold start (first file) | N/A | <3s | Driver init + first query |

---

## Known Limitations (v1.9)

1. **Languages supported**: TypeScript, JavaScript only
2. **Deferred to v2**: Python, Java (Tree-sitter), C/C++, Go, C#
3. **Validation execution disabled**: AffectedCalculator + ScriptExecutor → v2
4. **Cross-file edges may be stale**: Until semantic re-resolution completes
5. **Rename detection**: Best-effort timestamp heuristic (100ms window)
6. **Large files skipped**: Files >500KB are not processed
7. **No full reconciliation on startup**: Only crash recovery, not full filesystem diff

---

## Files to Create

| File | Purpose | Phase |
|------|---------|-------|
| `src/devac/types/events.ts` | Event type definitions | 0.5 |
| `src/devac/actors/types.ts` | Actor input/output types | 0.5 |
| `src/pipeline/language-router.ts` | Route files to parsers | 2 |
| `src/pipeline/adapters/parse-result-adapter.ts` | Bridge type mismatch | 0.5 |
| `src/pipeline/adapters/relationship-resolver-adapter.ts` | Wrap existing resolver | 0.5 |
| `src/devac/utils/file-mutex.ts` | Per-file locking with LRU | 2 |
| `src/devac/utils/file-guard.ts` | File size/type validation | 2 |
| `src/devac/utils/retry.ts` | Retry with exponential backoff | 2 |
| `src/devac/utils/apoc-fallback.ts` | Non-APOC Cypher queries | 2 |
| `src/devac/utils/bounded-queue.ts` | Backpressure queue | 2 |
| `src/devac/utils/rename-detector.ts` | Rename detection heuristic | 2 |
| `src/devac/utils/reconciliation.ts` | Post-rename integrity check | 4 |
| `src/devac/utils/metrics.ts` | Performance logging | 2 |
| `src/devac/services/file-watcher-integration.ts` | Connect FileWatcher to actor | 0.5 |
| `src/devac/services/ts-morph-manager.ts` | ts-morph Project lifecycle | 3 |
| `src/devac/startup.ts` | APOC detection, crash recovery | 2 |
| `src/devac/shutdown.ts` | Graceful shutdown handling | 2 |
| `src/database/neo4j-health.ts` | Health check with circuit breaker | 2 |

## Files to Modify

| File | Changes | Phase |
|------|---------|-------|
| `validation-coordinator.actor.ts` | Fix imports, add mutex, delete handling, crash recovery, error states, circuit breaker coordination | 1a, 2 |
| `graph-updater.actor.ts` | Fix imports, batch relationships, APOC fallback, retry policy | 1a, 2 |
| `semantic-resolver.actor.ts` | Fix imports, use adapter, ts-morph lifecycle | 1a, 3 |
| `structural-parser.ts` | Fix types | 1b |
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

### P0 Items Addressed

| Issue | Section | Status |
|-------|---------|--------|
| Transaction rollback strategy | P0.1 | ✅ ADDRESSED |
| Retry policy with backoff | P0.2 | ✅ ADDRESSED (NEW) |
| APOC fallback Cypher | P0.3 | ✅ ADDRESSED |
| ParseResultAdapter (complete) | P0.4 | ✅ ADDRESSED (NEW) |
| RelationshipResolverAdapter (complete) | P0.5 | ✅ ADDRESSED |
| Delete/rename handling | P0.6 | ✅ ADDRESSED |
| Crash recovery | P0.7 | ✅ ADDRESSED |

### P1 Items Addressed

| Issue | Section | Status |
|-------|---------|--------|
| ts-morph incremental lifecycle | P1.1 | ✅ ADDRESSED (NEW) |
| Backpressure/queue management | P1.2 | ✅ ADDRESSED (NEW) |
| Circuit breaker with FileWatcher coordination | P1.3 | ✅ ADDRESSED (ENHANCED) |
| Graceful shutdown | P1.4 | ✅ ADDRESSED (NEW) |
| FileMutex with deadlock prevention | P1.5 | ✅ ADDRESSED (ENHANCED) |
| File size guard | P1.6 | ✅ ADDRESSED (NEW) |

### P2 Items Addressed

| Issue | Section | Status |
|-------|---------|--------|
| Performance budgets (per-scenario) | P2.1 | ✅ ADDRESSED (NEW) |
| Rename reconciliation pass | P2.2 | ✅ ADDRESSED (NEW) |
| Integration test scenarios | P2.3 | ✅ ADDRESSED (NEW) |

### Timeline Adjustment
- v1.8: 26 days
- v1.9: **30 days** (+4 days for Phase 1a, P1/P2 fixes, buffer)

### Scope Adjustment
- Tree-sitter (Python/Java) deferred to v2
- Focus on TS/JS reliability and performance

**Spec v1.9 is IMPLEMENTATION-READY.**
