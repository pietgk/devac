# DevAC Spec v1.8: Incremental Graph Updates

> **Version**: 1.8 (Implementation-Ready)  
> **Date**: 2025-12-10  
> **Status**: APPROVED FOR IMPLEMENTATION  
> **Timeline**: 26 days

---

## Goal

Transform CodeGraph from **batch processing** (30-60s per repo) to **incremental updates** (<500ms per file change) for TypeScript, JavaScript, Python, and Java.

**Deferred to v2**: C/C++, Go, C#, validation script execution

---

## Spec Evolution Summary

| Version | Key Decision | Status |
|---------|-------------|--------|
| v1.0-v1.6 | Various approaches, increasing complexity | Superseded |
| v1.7 | P0/P1 fixes: batched writes, error handling, parser timeout | Adopted |
| v1.8 | Phase 0.5 added, rollback strategy, delete/rename handling, APOC fallback, 26-day timeline | Current |

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
    ├─► [2] LanguageRouter.parse() → StructuralParseResult
    │       └─► ParseResultAdapter → GraphUpdater format
    │
    ├─► [3] GraphUpdaterActor → Neo4j atomic update
    │       └─► Transaction: DELETE old → CREATE new (single tx)
    │
    ├─► [4] SemanticResolverActor.enqueue() [TS/JS only]
    │
    └─► [5] FileMutex.release()

(AffectedCalculator + ScriptExecutor → DEFERRED to v2)
```

### Verified File Locations

| Component | Path |
|-----------|------|
| ValidationCoordinatorActor | `src/devac/actors/validation-coordinator.actor.ts` |
| GraphUpdaterActor | `src/devac/actors/graph-updater.actor.ts` |
| SemanticResolverActor | `src/devac/actors/semantic-resolver.actor.ts` |
| FileWatcher | `src/devac/services/codegraph/file-watcher.ts` |
| Neo4jClient | `src/database/neo4j-client.ts` |
| StructuralParser | `src/analyzer/structural-parser.ts` |

---

## P0: MUST FIX Items (Blockers)

### P0.1: Transaction Rollback Strategy

**Principle**: All graph updates use single Neo4j transaction. If any step fails, entire transaction rolls back automatically.

```typescript
// GraphUpdater atomic update - single transaction guarantees atomicity
async function updateFileInGraph(
  neo4jClient: Neo4jClient,
  filePath: string,
  parseResult: GraphUpdaterResult
): Promise<{ nodesUpdated: number }> {
  // SINGLE TRANSACTION: If any step fails, Neo4j rolls back everything
  return neo4jClient.runTransactionWork(
    async (tx) => {
      // Step 1: Delete existing nodes for this file
      await tx.run(
        `MATCH (f:File {filePath: $filePath})-[:OWNS]->(n:Node)
         DETACH DELETE n`,
        { filePath }
      );

      // Step 2: Delete file node relationships and update
      await tx.run(
        `MATCH (f:File {filePath: $filePath})
         OPTIONAL MATCH (f)-[r]-()
         DELETE r`,
        { filePath }
      );

      // Step 3: Create/update file node
      await tx.run(
        `MERGE (f:File {filePath: $filePath})
         SET f.structuralComplete = true,
             f.semanticQueued = true,
             f.lastModified = datetime(),
             f.parseError = null`,
        { filePath }
      );

      // Step 4: Create nodes (batched)
      let nodesCreated = 0;
      if (parseResult.nodes.length > 0) {
        const result = await createNodesBatched(tx, parseResult.nodes, filePath);
        nodesCreated = result.nodesCreated;
      }

      // Step 5: Create relationships (batched by type)
      if (parseResult.relationships.length > 0) {
        await createRelationshipsBatched(tx, parseResult.relationships);
      }

      // Step 6: Store imports and exports
      await storeImportsAndExports(tx, filePath, parseResult);

      return { nodesCreated };
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
| Neo4j connection lost | Retry 3x with backoff | Existing nodes preserved |
| Process crash during tx | Uncommitted tx discarded | Existing nodes preserved |

**Guarantee**: File never has "zero nodes" due to partial failure.

### P0.2: Crash Recovery

On startup, requeue files that were mid-processing:

```typescript
// Add to ValidationCoordinatorActor startup sequence
async function recoverFromCrash(neo4jClient: Neo4jClient): Promise<string[]> {
  // Find files that were queued for semantic but never completed
  const result = await neo4jClient.runTransaction(
    `MATCH (f:File)
     WHERE f.semanticQueued = true AND f.semanticComplete = false
     RETURN f.filePath as filePath
     LIMIT 100`,
    {},
    "READ",
    "CrashRecovery-FindQueued"
  );

  const filesToRequeue = result.records.map(r => r.get("filePath") as string);

  if (filesToRequeue.length > 0) {
    console.info(`Crash recovery: requeueing ${filesToRequeue.length} files for semantic resolution`);
  }

  return filesToRequeue;
}

// In startup sequence:
states: {
  starting: {
    invoke: {
      src: fromPromise(async ({ input }) => {
        // 1. Verify Neo4j connection
        await input.neo4jHealth.checkHealth();

        // 2. Recover crashed files
        const crashedFiles = await recoverFromCrash(input.neo4jClient);

        // 3. Requeue for semantic resolution
        for (const filePath of crashedFiles) {
          input.semanticQueue.enqueue(filePath, "normal");
        }

        return { recoveredCount: crashedFiles.length };
      }),
      onDone: "reconciling",
      onError: "degraded",
    },
  },
}
```

### P0.3: APOC Fallback Cypher

If APOC is not installed, use standard Cypher:

```typescript
// src/devac/utils/apoc-fallback.ts

export async function createNodesWithLabels(
  tx: ManagedTransaction,
  nodes: NodeData[],
  useApoc: boolean
): Promise<{ nodesCreated: number }> {
  if (useApoc) {
    // APOC version (preferred - single query)
    const result = await tx.run(
      `UNWIND $nodes AS nodeData
       CREATE (n:Node)
       SET n = nodeData.properties, n.entityId = nodeData.entityId
       WITH n, nodeData
       CALL apoc.create.addLabels(n, [nodeData.kind]) YIELD node
       RETURN count(node) as created`,
      { nodes }
    );
    return { nodesCreated: toNumber(result.records[0]?.get("created")) };
  } else {
    // Non-APOC fallback (multiple queries by kind)
    const byKind = groupBy(nodes, n => n.kind);
    let totalCreated = 0;

    for (const [kind, kindNodes] of Object.entries(byKind)) {
      // Validate kind against whitelist to prevent injection
      if (!VALID_NODE_KINDS.includes(kind)) {
        console.warn(`Skipping invalid node kind: ${kind}`);
        continue;
      }

      const result = await tx.run(
        `UNWIND $nodes AS nodeData
         CREATE (n:Node:${kind})
         SET n = nodeData.properties, n.entityId = nodeData.entityId
         RETURN count(n) as created`,
        { nodes: kindNodes.map(n => ({ properties: n.properties, entityId: n.entityId })) }
      );
      totalCreated += toNumber(result.records[0]?.get("created"));
    }

    return { nodesCreated: totalCreated };
  }
}

const VALID_NODE_KINDS = [
  "Function", "Class", "Method", "Variable", "Interface",
  "TypeAlias", "Enum", "Module", "Import", "Export"
];

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {} as Record<string, T[]>);
}
```

**Detection on startup**:

```typescript
// In Phase 0 verification
let apocAvailable = false;

try {
  await neo4jClient.runTransaction(
    `RETURN apoc.version() as version`,
    {},
    "READ",
    "CheckApoc"
  );
  apocAvailable = true;
  console.info("APOC detected - using optimized queries");
} catch {
  apocAvailable = false;
  console.warn("APOC not available - using fallback queries (slower)");
}

// Store in context for GraphUpdater
context.useApoc = apocAvailable;
```

### P0.4: Delete/Rename Handling

**File Deletion Flow**:

```typescript
// ValidationCoordinatorActor - handle unlink events
states: {
  processing: {
    initial: "checkEventType",
    states: {
      checkEventType: {
        always: [
          {
            guard: ({ context }) => context.fileEvent?.type === "unlink",
            target: "deletingFile",
          },
          {
            target: "acquiringLock",
          },
        ],
      },

      deletingFile: {
        invoke: {
          src: fromPromise(async ({ input }) => {
            const { filePath, neo4jClient } = input;

            // Atomic delete of file and all owned nodes
            await neo4jClient.runTransaction(
              `MATCH (f:File {filePath: $filePath})
               OPTIONAL MATCH (f)-[:OWNS]->(n:Node)
               DETACH DELETE n, f`,
              { filePath },
              "WRITE",
              "DeleteFile"
            );

            console.info(`Deleted file from graph: ${filePath}`);
            return { deleted: true };
          }),
          onDone: "checkQueue",
          onError: {
            target: "checkQueue",
            actions: ({ event }) => {
              console.error("Failed to delete file from graph:", event.error);
            },
          },
        },
      },

      // ... rest of states
    },
  },
}
```

**Rename Detection** (best-effort via timestamp heuristic):

```typescript
// Chokidar emits rename as unlink + add within ~100ms
interface RenameDetector {
  pendingUnlinks: Map<string, { timestamp: number; size?: number }>;
  windowMs: number;
}

function detectRename(
  event: FileChangeEvent,
  detector: RenameDetector
): { type: "rename"; oldPath: string; newPath: string } | null {
  if (event.type === "unlink") {
    detector.pendingUnlinks.set(event.path, { timestamp: Date.now() });

    // Cleanup old entries
    const staleThreshold = Date.now() - (detector.windowMs * 2);
    for (const [path, info] of detector.pendingUnlinks) {
      if (info.timestamp < staleThreshold) {
        detector.pendingUnlinks.delete(path);
      }
    }

    return null;
  }

  if (event.type === "add") {
    // Look for recent unlink
    for (const [oldPath, info] of detector.pendingUnlinks) {
      if (Date.now() - info.timestamp < detector.windowMs) {
        detector.pendingUnlinks.delete(oldPath);
        return { type: "rename", oldPath, newPath: event.path };
      }
    }
  }

  return null;
}

// On rename detected, update paths instead of delete+create
async function handleRename(
  neo4jClient: Neo4jClient,
  oldPath: string,
  newPath: string
): Promise<void> {
  await neo4jClient.runTransaction(
    `MATCH (f:File {filePath: $oldPath})
     SET f.filePath = $newPath
     WITH f
     MATCH (n:Node {filePath: $oldPath})
     SET n.filePath = $newPath`,
    { oldPath, newPath },
    "WRITE",
    "RenameFile"
  );
}
```

### P0.5: API Reconciliation (RelationshipResolver)

The existing `RelationshipResolver` may have constructor signature mismatches. Create adapter:

```typescript
// src/pipeline/adapters/relationship-resolver-adapter.ts

import { RelationshipResolver as ExistingResolver } from "../../analyzer/relationship-resolver.js";

export interface RelationshipResolverInterface {
  resolve(fromFile: string, importPath: string): string | null;
}

export class RelationshipResolverAdapter implements RelationshipResolverInterface {
  private resolver: ExistingResolver | null = null;

  constructor(private neo4jClient: unknown, private workspaceRoot: string) {
    try {
      // Attempt to instantiate with expected signature
      this.resolver = new ExistingResolver(neo4jClient as any, workspaceRoot);
    } catch (error) {
      console.warn("RelationshipResolver instantiation failed, using stub:", error);
    }
  }

  resolve(fromFile: string, importPath: string): string | null {
    if (this.resolver) {
      try {
        return this.resolver.resolve(fromFile, importPath);
      } catch {
        return null;
      }
    }
    // Stub: defer resolution to semantic phase
    return null;
  }
}
```

---

## P1: SHOULD FIX Items (High Risk)

### P1.1: Inter-Component Contracts

**FileChangeEvent** (FileWatcher → ValidationCoordinator):

```typescript
export type FileChangeType = "add" | "change" | "unlink";

export interface FileChangeEvent {
  type: FileChangeType;
  path: string;           // Absolute file path
  timestamp: number;      // Unix timestamp ms
}
```

**ParseResult** (LanguageRouter → ValidationCoordinator):

```typescript
export interface ParseResult {
  success: boolean;
  data?: GraphUpdaterResult;  // Only if success=true
  error?: string;             // Only if success=false
}
```

**GraphUpdaterResult** (ParseResultAdapter → GraphUpdater):

```typescript
export interface GraphUpdaterResult {
  nodes: Array<{
    entityId: string;
    kind: string;
    name: string;
    filePath: string;
    line: number;
    column: number;
  }>;
  relationships: Array<{
    source: string;  // entityId
    target: string;  // entityId
    type: string;    // Must be in VALID_RELATIONSHIP_TYPES
  }>;
  importStrings: string[];
  exportedSymbols: Array<{ name: string; kind: string }>;
}
```

**SemanticQueueEvent** (ValidationCoordinator → SemanticResolver):

```typescript
export interface SemanticQueueEvent {
  type: "ENQUEUE";
  filePath: string;
  priority: "high" | "normal";
}
```

### P1.2: FileWatcher → Actor Glue Code

```typescript
// src/devac/services/file-watcher-integration.ts

import { watch } from "chokidar";
import type { ValidationCoordinatorService } from "../actors/validation-coordinator.actor.js";

export function connectFileWatcherToCoordinator(
  coordinator: ValidationCoordinatorService,
  watchPaths: string[],
  options: { ignorePatterns?: string[] } = {}
): () => void {
  const watcher = watch(watchPaths, {
    ignored: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**",
      ...(options.ignorePatterns || []),
    ],
    persistent: true,
    ignoreInitial: true,  // Don't emit for existing files on startup
  });

  const handleEvent = (type: "add" | "change" | "unlink") => (path: string) => {
    coordinator.send({
      type: "FILE_CHANGED",
      event: {
        type,
        path,
        timestamp: Date.now(),
      },
    });
  };

  watcher.on("add", handleEvent("add"));
  watcher.on("change", handleEvent("change"));
  watcher.on("unlink", handleEvent("unlink"));

  watcher.on("error", (error) => {
    console.error("FileWatcher error:", error);
  });

  // Return cleanup function
  return () => {
    watcher.close();
  };
}
```

### P1.3: FileMutex LRU Cleanup

Prevent memory leak from unbounded lock map:

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
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60000; // 1 minute
    this.startCleanupTimer();
  }

  async acquire(filePath: string): Promise<{ release: () => void; superseded: boolean }> {
    this.lastAccess.set(filePath, Date.now());

    const seq = (this.sequence.get(filePath) ?? 0) + 1;
    this.sequence.set(filePath, seq);

    const existing = this.locks.get(filePath);
    if (existing) {
      await existing;
    }

    if (this.sequence.get(filePath) !== seq) {
      return { release: () => {}, superseded: true };
    }

    let releaseFn: () => void;
    const lockPromise = new Promise<void>(resolve => {
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

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);
  }

  private cleanup(): void {
    // Remove entries not accessed in last 5 minutes
    const staleThreshold = Date.now() - 300000;
    let removed = 0;

    for (const [path, lastAccess] of this.lastAccess) {
      if (lastAccess < staleThreshold && !this.locks.has(path)) {
        this.sequence.delete(path);
        this.lastAccess.delete(path);
        removed++;
      }
    }

    // If still over max, remove oldest entries
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
  }
}
```

### P1.4: Tree-Sitter Feature Flag

Disable tree-sitter paths until Phase 3:

```typescript
// src/pipeline/language-router.ts

export interface LanguageRouterConfig {
  enableTreeSitter: boolean;  // Default: false until Phase 3
  workspaceRoot: string;
}

export class LanguageRouter {
  private config: LanguageRouterConfig;

  constructor(config: LanguageRouterConfig) {
    this.config = config;
  }

  async parse(filePath: string): Promise<ParseResult> {
    const language = this.getLanguage(filePath);

    if (!language) {
      return { success: false, error: "Unsupported file type" };
    }

    // TypeScript/JavaScript always supported
    if (language === "typescript" || language === "javascript") {
      return this.parseWithBabel(filePath);
    }

    // Tree-sitter languages gated by feature flag
    if (!this.config.enableTreeSitter) {
      return {
        success: false,
        error: `Tree-sitter parsing disabled. Language: ${language}`,
      };
    }

    return this.parseWithTreeSitter(filePath, language);
  }
}

// Usage:
const router = new LanguageRouter({
  enableTreeSitter: process.env.ENABLE_TREE_SITTER === "true",
  workspaceRoot: "/path/to/workspace",
});
```

### P1.5: Neo4j Circuit Breaker

Stop all operations after N consecutive failures:

```typescript
// src/database/neo4j-health.ts

export class Neo4jHealthCheck {
  private consecutiveFailures = 0;
  private maxConsecutiveFailures = 5;
  private circuitOpen = false;
  private circuitOpenedAt: number | null = null;
  private circuitResetMs = 30000; // 30 seconds

  constructor(private neo4jClient: Neo4jClient) {}

  async checkHealth(): Promise<boolean> {
    // Check if circuit should reset
    if (this.circuitOpen && this.circuitOpenedAt) {
      if (Date.now() - this.circuitOpenedAt > this.circuitResetMs) {
        console.info("Neo4j circuit breaker: attempting reset");
        this.circuitOpen = false;
      }
    }

    if (this.circuitOpen) {
      return false;
    }

    try {
      await this.neo4jClient.runTransaction(
        `RETURN 1 as health`,
        {},
        "READ",
        "HealthCheck"
      );
      this.consecutiveFailures = 0;
      return true;
    } catch (error) {
      this.consecutiveFailures++;

      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        console.error(`Neo4j circuit breaker OPEN after ${this.consecutiveFailures} failures`);
        this.circuitOpen = true;
        this.circuitOpenedAt = Date.now();
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

### P1.6: Tree-Sitter Strategy

**Decision**: Use tree-sitter native Node.js bindings (not subprocess, not WASM).

**Rationale**:
- Native bindings are fastest (~5-50ms parse time)
- tree-sitter npm packages available for Python, Java
- No subprocess overhead
- WASM adds complexity without significant benefit for server-side

**Implementation** (Phase 3):

```typescript
// src/pipeline/parsers/tree-sitter-parser.ts

import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import Java from "tree-sitter-java";

const parsers: Record<string, Parser> = {};

function getParser(language: string): Parser {
  if (!parsers[language]) {
    const parser = new Parser();
    switch (language) {
      case "python":
        parser.setLanguage(Python);
        break;
      case "java":
        parser.setLanguage(Java);
        break;
      default:
        throw new Error(`No tree-sitter parser for: ${language}`);
    }
    parsers[language] = parser;
  }
  return parsers[language];
}

export async function parseWithTreeSitter(
  filePath: string,
  language: string,
  sourceCode: string
): Promise<TreeSitterResult> {
  const parser = getParser(language);
  const tree = parser.parse(sourceCode);

  // Extract nodes and relationships from tree
  const nodes: NodeData[] = [];
  const relationships: RelationshipData[] = [];

  // Walk tree and extract relevant nodes
  walkTree(tree.rootNode, filePath, nodes, relationships);

  return { nodes, relationships };
}
```

---

## LanguageRouter (Complete)

```typescript
// src/pipeline/language-router.ts

import path from "path";
import { StructuralParser } from "../analyzer/structural-parser.js";
import { adaptParseResult } from "./adapters/parse-result-adapter.js";
import type { GraphUpdaterResult } from "../devac/actors/graph-updater.actor.js";

const PARSE_TIMEOUT_MS = 30000;

export interface ParseResult {
  success: boolean;
  data?: GraphUpdaterResult;
  error?: string;
}

export interface LanguageRouterConfig {
  enableTreeSitter: boolean;
  workspaceRoot: string;
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
    const language = this.getLanguage(filePath);

    if (!language) {
      return { success: false, error: "Unsupported file type" };
    }

    try {
      const result = await Promise.race([
        this.parseByLanguage(filePath, language),
        this.createTimeoutPromise(),
      ]);

      if (result === "TIMEOUT") {
        return { success: false, error: `Parse timeout after ${PARSE_TIMEOUT_MS}ms` };
      }

      return { success: true, data: adaptParseResult(result) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async parseByLanguage(filePath: string, language: string): Promise<unknown> {
    if (language === "typescript" || language === "javascript") {
      return this.structuralParser.parseStructural(filePath);
    }

    if (!this.config.enableTreeSitter) {
      throw new Error(`Tree-sitter disabled. Cannot parse: ${language}`);
    }

    return this.parseWithTreeSitter(filePath, language);
  }

  private async parseWithTreeSitter(filePath: string, language: string): Promise<unknown> {
    // Phase 3 implementation
    throw new Error(`Tree-sitter parser for ${language} not yet implemented`);
  }

  private createTimeoutPromise(): Promise<"TIMEOUT"> {
    return new Promise(resolve => {
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
  ".py": "python",
  ".java": "java",
  // Deferred to v2:
  // ".go": "go",
  // ".c": "c",
  // ".cpp": "cpp",
  // ".cs": "csharp",
};
```

---

## Implementation Timeline (26 days)

### Phase 0: Verification (Days 1-2)

**Day 1:**
- Run `tsc --noEmit` - capture actual error count (expect 103+)
- Verify APOC installation, set `useApoc` flag
- Verify Neo4j indexes exist
- Map ALL import paths

**Day 2:**
- Create missing type stubs
- Measure baseline Neo4j latency
- **EXIT GATE**: All blockers documented

### Phase 0.5: API Reconciliation (Days 3-4) - NEW

**Day 3:**
- Create `RelationshipResolverAdapter`
- Create inter-component TypeScript interfaces
- Create `file-watcher-integration.ts`

**Day 4:**
- Verify all component interfaces compile
- **EXIT GATE**: All adapters created, interfaces defined

### Phase 1: Fix TypeScript Errors (Days 5-11)

**Day 5:**
- Install `@types/babel__traverse`
- Fix `structural-parser.ts` (9 errors)
- Fix `semantic-resolver.ts` (2 errors)

**Day 6-7:**
- Fix `validation-coordinator.actor.ts` (~37 errors)

**Day 8:**
- Fix `validation-coordinator.service.ts` (~19 errors)
- Fix utility files

**Day 9-10:**
- Fix remaining actors

**Day 11:**
- Verify: `tsc --noEmit` produces 0 errors
- **EXIT GATE**: Zero TypeScript errors

### Phase 2: Core Integration (Days 12-19)

**Day 12:**
- Create `parse-result-adapter.ts`
- Create `LanguageRouter` with feature flag

**Day 13:**
- Wire LanguageRouter into ValidationCoordinatorActor
- Add delete/rename handling

**Day 14:**
- Implement FileMutex with LRU cleanup
- Integrate into processing flow

**Day 15:**
- Add batched relationship creation (with APOC fallback)
- Add Neo4j health check with circuit breaker

**Day 16:**
- Add error handling states
- Add queue backpressure
- Add crash recovery on startup

**Day 17-18:**
- Integration smoke tests
- Test: add, change, delete, rename cycle

**Day 19:**
- Fix issues found
- **EXIT GATE**: Basic pipeline working for TS/JS

### Phase 3: Tree-Sitter Languages (Days 20-23)

**Day 20:**
- Create tree-sitter adapter
- Install tree-sitter-python, tree-sitter-java

**Day 21:**
- Wire Python parser
- Test Python files

**Day 22:**
- Wire Java parser
- Test Java files

**Day 23:**
- Fix issues, edge cases
- **EXIT GATE**: Python + Java working

### Phase 4: Polish (Days 24-26)

**Day 24:**
- Full test suite: `npm test`
- Fix regressions

**Day 25:**
- Performance benchmarks
- Document known limitations

**Day 26:**
- Final testing
- Buffer for unexpected issues

---

## Success Criteria

### Phase 0 Exit
- [ ] APOC status determined, fallback ready if needed
- [ ] All import paths mapped
- [ ] Neo4j baseline latency measured

### Phase 0.5 Exit
- [ ] All adapters created
- [ ] All interfaces compile

### Phase 1 Exit
- [ ] `tsc --noEmit` produces 0 errors

### Phase 2 Exit
- [ ] File add/change/delete triggers correct graph updates
- [ ] Rename detection working
- [ ] Per-file mutex prevents race conditions
- [ ] Crash recovery requeues incomplete files
- [ ] Circuit breaker stops operations on Neo4j failure

### Phase 3 Exit
- [ ] Python files parse and update graph
- [ ] Java files parse and update graph

### Final
- [ ] `npm test` passes
- [ ] Total latency <500ms per file (warm cache)

---

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| TS/JS structural parse | <100ms | Babel |
| Graph update (batched) | <300ms | With APOC; <400ms without |
| Total per-file latency | <500ms | Warm cache |
| Cold start | <3s | First file after startup |

---

## Known Limitations (v1.8)

1. **Languages deferred**: C/C++, Go, C# → v2
2. **Validation execution disabled**: AffectedCalculator + ScriptExecutor → v2
3. **Cross-file edges may be stale**: Until semantic re-resolution
4. **Rename detection**: Best-effort timestamp heuristic (100ms window)
5. **No full reconciliation**: Crash recovery only, not full filesystem diff

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/pipeline/language-router.ts` | Route files to parsers |
| `src/pipeline/adapters/parse-result-adapter.ts` | Bridge type mismatch |
| `src/pipeline/adapters/relationship-resolver-adapter.ts` | Wrap existing resolver |
| `src/pipeline/adapters/tree-sitter-adapter.ts` | Adapt tree-sitter output |
| `src/devac/utils/file-mutex.ts` | Per-file locking with LRU |
| `src/devac/utils/apoc-fallback.ts` | Non-APOC Cypher queries |
| `src/devac/services/file-watcher-integration.ts` | Connect FileWatcher to actor |
| `src/database/neo4j-health.ts` | Health check with circuit breaker |

## Files to Modify

| File | Changes |
|------|---------|
| `validation-coordinator.actor.ts` | Add mutex, delete handling, crash recovery, error states |
| `graph-updater.actor.ts` | Batch relationships, APOC fallback |
| `structural-parser.ts` | Fix types |
| All other actors | Fix XState v5 typing |

---

## Deferred to v2

- C/C++, Go, C# tree-sitter parsers
- Full filesystem reconciliation algorithm
- AffectedCalculator + ScriptExecutor pipeline
- Metrics export (Prometheus/StatsD)
- Graceful shutdown with drain
- Stale data indicator (`Project.needsFullRescan`)

---

## Validation Checklist

### P0 Items Addressed

| Issue | Section | Status |
|-------|---------|--------|
| Transaction rollback strategy | P0.1 | ADDRESSED |
| Crash recovery | P0.2 | ADDRESSED |
| APOC fallback Cypher | P0.3 | ADDRESSED |
| Delete/rename handling | P0.4 | ADDRESSED |
| API reconciliation (RelationshipResolver) | P0.5 | ADDRESSED |

### P1 Items Addressed

| Issue | Section | Status |
|-------|---------|--------|
| Inter-component contracts | P1.1 | ADDRESSED |
| FileWatcher → Actor glue code | P1.2 | ADDRESSED |
| FileMutex LRU cleanup | P1.3 | ADDRESSED |
| Tree-sitter feature flag | P1.4 | ADDRESSED |
| Neo4j circuit breaker | P1.5 | ADDRESSED |
| Tree-sitter strategy defined | P1.6 | ADDRESSED |

### Timeline Adjustment
- Original: 22 days
- Revised: **26 days** (+4 days for Phase 0.5 and buffer)

**Spec v1.8 is IMPLEMENTATION-READY.**
