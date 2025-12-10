# DevAC Spec v1.7: Incremental Graph Updates

> **Version**: 1.7 (Implementation-Ready)  
> **Date**: 2025-12-10  
> **Status**: APPROVED FOR IMPLEMENTATION  
> **Timeline**: 22 days

---

## Goal

Transform CodeGraph from **batch processing** (30-60s per repo) to **incremental updates** (<500ms per file change) for TypeScript, JavaScript, Python, and Java.

**Deferred to v1.8+**: C/C++, Go, C#, validation script execution

---

## Spec Evolution Summary

| Version | Key Decision | Status |
|---------|-------------|--------|
| v1.0-v1.5 | Various approaches, increasing complexity | Superseded |
| v1.6 | Phase 0 verification, scope narrowing, defer validation | Adopted |
| v1.7 | P0/P1 fixes: batched writes, error handling, parser timeout, reduced language scope | Current |

---

## Architecture

### Pipeline Flow (v1.7 Scope)

```
FileWatcher
    │
    ▼ FileChangeEvent
ValidationCoordinatorActor
    │
    ├─► [1] LanguageRouter.parse() → StructuralParseResult
    │       └─► ParseResultAdapter → GraphUpdater format
    │
    ├─► [2] GraphUpdaterActor → Neo4j atomic update
    │       └─► Batched relationship creation (P1)
    │
    └─► [3] SemanticResolverActor.enqueue() [TS/JS only]

(AffectedCalculator + ScriptExecutor → DEFERRED to v2)
```

### Verified File Locations

| Component | Path |
|-----------|------|
| ValidationCoordinatorActor | `src/devac/actors/validation-coordinator.actor.ts` |
| GraphUpdaterActor | `src/devac/actors/graph-updater.actor.ts` |
| SemanticResolverActor | `src/devac/actors/semantic-resolver.actor.ts` |
| AffectedCalculatorActor | `src/devac/actors/affected-calculator.actor.ts` |
| ScriptExecutorActor | `src/devac/actors/script-executor.actor.ts` |
| FileWatcher | `src/devac/services/codegraph/file-watcher.ts` |
| Neo4jClient | `src/database/neo4j-client.ts` |
| StructuralParser | `src/analyzer/structural-parser.ts` |

---

## P0: MUST FIX Items

### P0.1: APOC Installation Verification

GraphUpdater uses `apoc.create.addLabels`. Must verify APOC is installed:

```typescript
// Phase 0, Day 1: Add to verification checklist
async function verifyApocInstalled(neo4jClient: Neo4jClient): Promise<boolean> {
  try {
    const result = await neo4jClient.runTransaction(
      `RETURN apoc.version() as version`,
      {},
      "READ",
      "VerifyApoc"
    );
    console.log(`APOC version: ${result.records[0]?.get("version")}`);
    return true;
  } catch {
    console.error("APOC not installed - required for GraphUpdater");
    return false;
  }
}
```

**Fallback if APOC unavailable**: Modify GraphUpdater to use multiple CREATE statements with explicit labels instead of `apoc.create.addLabels`.

### P0.2: Complete Import Path Mapping

All import paths in `validation-coordinator.actor.ts`:

```typescript
// CURRENT (WRONG):
import type { FileChangeEvent } from "../types/file-watcher.js";
import type { Neo4jClient } from "../graph/neo4j-client.js";
import type { StructuralParser } from "../parsers/structural-parser.js";
import type { ImportResolver } from "../resolution/import-resolver.js";
import type { PackageInfo } from "../types/package.js";

// CORRECTED:
import type { FileChangeEvent } from "../services/codegraph/file-watcher.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";
import type { StructuralParser } from "../../analyzer/structural-parser.js";
// ImportResolver: Check if exists, else create stub
// PackageInfo: Check if exists, else create stub
```

**Missing Types Resolution**:

```typescript
// src/devac/types/package.ts (CREATE if missing)
export interface PackageInfo {
  name: string;
  path: string;
}

// src/devac/types/import-resolver.ts (CREATE if missing)
export interface ImportResolver {
  resolve(importPath: string, fromFile: string): string | null;
}

// Stub implementation for v1.7:
export class StubImportResolver implements ImportResolver {
  resolve(importPath: string, fromFile: string): string | null {
    // Defer actual resolution to semantic phase
    return null;
  }
}
```

### P0.3: @types/babel__traverse Installation

```bash
npm install --save-dev @types/babel__traverse --legacy-peer-deps
```

### P0.4: Parse Result Adapter

Bridge type mismatch between StructuralParser output and GraphUpdater input:

```typescript
// src/pipeline/adapters/parse-result-adapter.ts

import type { StructuralParseResult as GraphUpdaterResult } from "../../devac/actors/graph-updater.actor.js";

interface ParserOutput {
  nodes: Array<{
    entityId: string;
    kind: string;
    name: string;
    filePath: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
  }>;
  relationships: Array<{
    sourceId: string;
    targetId: string;
    type: string;
  }>;
  importStrings: string[];
  exportedSymbols: Array<{ name: string; kind: string }>;
}

export function adaptParseResult(parserOutput: ParserOutput): GraphUpdaterResult {
  return {
    nodes: parserOutput.nodes.map(n => ({
      entityId: n.entityId,
      kind: n.kind,
      name: n.name,
      filePath: n.filePath,
      line: n.startLine,
      column: n.startColumn,
    })),
    relationships: parserOutput.relationships.map(r => ({
      source: r.sourceId,
      target: r.targetId,
      type: r.type,
    })),
    importStrings: parserOutput.importStrings,
    exportedSymbols: parserOutput.exportedSymbols,
  };
}
```

### P0.5: Per-File Mutex Design

Prevent race conditions from rapid saves:

```typescript
// src/devac/utils/file-mutex.ts

export class FileMutex {
  private locks = new Map<string, Promise<void>>();
  private sequence = new Map<string, number>();

  async acquire(filePath: string): Promise<{ release: () => void; superseded: boolean }> {
    const seq = (this.sequence.get(filePath) ?? 0) + 1;
    this.sequence.set(filePath, seq);

    // Wait for existing lock
    const existing = this.locks.get(filePath);
    if (existing) {
      await existing;
    }

    // Check if superseded by newer request
    if (this.sequence.get(filePath) !== seq) {
      return { release: () => {}, superseded: true };
    }

    // Create new lock
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
}
```

**Integration into ValidationCoordinatorActor**:

```typescript
// Add to context:
context: {
  fileMutex: new FileMutex(),
  // ... other context
}

// Use in processing state:
states: {
  processing: {
    initial: "acquiringLock",
    states: {
      acquiringLock: {
        invoke: {
          src: fromPromise(async ({ input }) => {
            return input.fileMutex.acquire(input.filePath);
          }),
          onDone: [
            {
              guard: ({ event }) => event.output.superseded,
              target: "#watching",  // Skip, newer event will handle
            },
            {
              target: "parsing",
              actions: assign({ lockRelease: ({ event }) => event.output.release }),
            },
          ],
        },
      },
      // ... rest of states
      complete: {
        entry: ({ context }) => context.lockRelease?.(),
        // ...
      },
    },
  },
}
```

### P0.6: Neo4j Required Indexes

```cypher
-- Phase 0 verification query
CREATE INDEX file_path IF NOT EXISTS FOR (f:File) ON (f.filePath);
CREATE INDEX node_entityId IF NOT EXISTS FOR (n:Node) ON (n.entityId);
CREATE INDEX node_filePath IF NOT EXISTS FOR (n:Node) ON (n.filePath);
```

---

## P1: SHOULD FIX Items

### P1.1: Batched Relationship Creation

Current GraphUpdater creates relationships one-by-one. Batch for performance:

```typescript
// BEFORE (slow):
for (const rel of parseResult.relationships) {
  await tx.run(
    `MATCH (source:Node {entityId: $source})
     MATCH (target:Node {entityId: $target})
     MERGE (source)-[r:${rel.type}]->(target)`,
    { source: rel.source, target: rel.target }
  );
}

// AFTER (batched):
if (parseResult.relationships.length > 0) {
  // Group by relationship type for safety (avoid Cypher injection)
  const byType = groupBy(parseResult.relationships, r => r.type);
  
  for (const [relType, rels] of Object.entries(byType)) {
    // Validate relationship type against whitelist
    if (!VALID_RELATIONSHIP_TYPES.includes(relType)) {
      throw new Error(`Invalid relationship type: ${relType}`);
    }
    
    await tx.run(
      `UNWIND $rels as rel
       MATCH (source:Node {entityId: rel.source})
       MATCH (target:Node {entityId: rel.target})
       MERGE (source)-[r:${relType}]->(target)
       SET r.phase = "structural"`,
      { rels: rels.map(r => ({ source: r.source, target: r.target })) }
    );
  }
}

const VALID_RELATIONSHIP_TYPES = [
  "CONTAINS", "OWNS", "IMPORTS", "CALLS", "EXTENDS", "IMPLEMENTS", "REFERENCES"
];
```

### P1.2: Neo4j Health Check & Reconnection

```typescript
// src/database/neo4j-health.ts

export class Neo4jHealthCheck {
  private isHealthy = true;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelayMs = 1000;

  constructor(private neo4jClient: Neo4jClient) {}

  async checkHealth(): Promise<boolean> {
    try {
      await this.neo4jClient.runTransaction(
        `RETURN 1 as health`,
        {},
        "READ",
        "HealthCheck"
      );
      this.isHealthy = true;
      this.reconnectAttempts = 0;
      return true;
    } catch (error) {
      this.isHealthy = false;
      return false;
    }
  }

  async ensureConnection(): Promise<void> {
    if (this.isHealthy) return;

    while (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.warn(`Neo4j reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      
      await sleep(this.reconnectDelayMs * this.reconnectAttempts); // Exponential backoff
      
      if (await this.checkHealth()) {
        console.info("Neo4j connection restored");
        return;
      }
    }

    throw new Error("Neo4j connection failed after max reconnection attempts");
  }

  getStatus(): { healthy: boolean; reconnectAttempts: number } {
    return { healthy: this.isHealthy, reconnectAttempts: this.reconnectAttempts };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

**Integration**:

```typescript
// In ValidationCoordinatorActor, before graph update:
states: {
  updatingGraph: {
    invoke: {
      src: fromPromise(async ({ input }) => {
        await input.neo4jHealth.ensureConnection();
        return updateGraph(input);
      }),
      // ...
    },
  },
}
```

### P1.3: Semantic Queue Contract

```typescript
// src/devac/types/semantic-queue.ts

export interface SemanticQueueEvent {
  type: "ENQUEUE";
  filePath: string;
  priority: "high" | "normal";
}

export interface SemanticQueueConfig {
  maxSize: number;           // Default: 100
  deduplicateByPath: boolean; // Default: true
  highPriorityFirst: boolean; // Default: true
}

// Deduplication: If same filePath already in queue, update priority (don't add duplicate)
// Failure: On semantic failure, mark file with semanticError (distinct from parseError)
// Retry: Automatic retry with exponential backoff (max 3 attempts)
```

**Queue Implementation** (already exists in SemanticResolverActor, document contract):

```typescript
// Expected behavior:
// 1. ENQUEUE received with filePath
// 2. If filePath already in queue:
//    - If new priority is "high", upgrade existing entry
//    - Else, ignore (already queued)
// 3. If queue full (>maxSize), drop oldest "normal" priority entries
// 4. Process in batches (batchSize: 10, delay: 100ms between batches)
```

### P1.4: Queue Backpressure

Limit queue size to prevent memory issues:

```typescript
// In ValidationCoordinatorActor context:
const QUEUE_CONFIG = {
  maxSize: 100,
  overflowBehavior: "dropOldest" as const,
};

// In queueFileChange action:
actions: {
  queueFileChange: assign({
    processingQueue: ({ context, event }) => {
      if (event.type !== "FILE_CHANGED") return context.processingQueue;
      
      // Deduplicate
      let queue = context.processingQueue.filter(e => e.path !== event.event.path);
      queue.push(event.event);
      
      // Enforce max size
      if (queue.length > QUEUE_CONFIG.maxSize) {
        console.warn(`Queue overflow: dropping oldest ${queue.length - QUEUE_CONFIG.maxSize} events`);
        queue = queue.slice(-QUEUE_CONFIG.maxSize);
      }
      
      return queue;
    },
  }),
}
```

### P1.5: Parser Timeout

Prevent hanging parsers from blocking pipeline:

```typescript
// src/pipeline/language-router.ts

const PARSE_TIMEOUT_MS = 30000; // 30 seconds

export class LanguageRouter {
  async parse(filePath: string): Promise<ParseResult> {
    const language = this.getLanguage(filePath);
    if (!language) {
      return { success: false, error: "Unsupported file type" };
    }

    try {
      const result = await Promise.race([
        this.parseByLanguage(filePath, language),
        this.createTimeoutError(filePath),
      ]);
      
      if ("timeout" in result) {
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

  private createTimeoutError(filePath: string): Promise<{ timeout: true }> {
    return new Promise(resolve => {
      setTimeout(() => resolve({ timeout: true }), PARSE_TIMEOUT_MS);
    });
  }
}
```

---

## Error Handling (P0/P1 Consolidated)

### Error State Machine

```typescript
// ValidationCoordinatorActor error handling states
states: {
  processing: {
    states: {
      parsing: {
        invoke: {
          src: "parseWithLanguageRouter",
          onDone: [
            {
              guard: ({ event }) => !event.output.success,
              target: "handleParseError",
              actions: assign({ parseError: ({ event }) => event.output.error }),
            },
            {
              target: "updatingGraph",
            },
          ],
          onError: {
            target: "handleParseError",
            actions: assign({ parseError: ({ event }) => event.error?.message }),
          },
        },
      },

      handleParseError: {
        invoke: {
          src: fromPromise(async ({ input }) => {
            // Mark file with parseError in Neo4j (preserve existing nodes)
            await input.neo4jClient.runTransaction(
              `MERGE (f:File {filePath: $filePath})
               SET f.parseError = $error,
                   f.parseErrorAt = datetime()`,
              { filePath: input.filePath, error: input.parseError },
              "WRITE",
              "MarkParseError"
            );
          }),
          onDone: "checkQueue",
          onError: "checkQueue", // Still continue even if marking fails
        },
      },

      updatingGraph: {
        invoke: {
          src: "graphUpdater",
          onDone: {
            target: "clearParseError",
          },
          onError: {
            target: "handleGraphError",
            actions: assign({ graphError: ({ event }) => event.error?.message }),
          },
        },
      },

      clearParseError: {
        // On successful update, clear any previous parseError
        invoke: {
          src: fromPromise(async ({ input }) => {
            await input.neo4jClient.runTransaction(
              `MATCH (f:File {filePath: $filePath})
               SET f.parseError = null,
                   f.parseErrorAt = null,
                   f.structuralComplete = true`,
              { filePath: input.filePath },
              "WRITE",
              "ClearParseError"
            );
          }),
          onDone: "queueSemantic",
          onError: "queueSemantic", // Continue even if clear fails
        },
      },

      handleGraphError: {
        entry: ({ context }) => {
          console.error(`Graph update failed for ${context.fileEvent?.path}: ${context.graphError}`);
        },
        always: [
          {
            guard: ({ context }) => (context.graphRetryCount ?? 0) < 3,
            target: "updatingGraph",
            actions: assign({ graphRetryCount: ({ context }) => (context.graphRetryCount ?? 0) + 1 }),
          },
          {
            target: "markSyncError",
          },
        ],
      },

      markSyncError: {
        invoke: {
          src: fromPromise(async ({ input }) => {
            await input.neo4jClient.runTransaction(
              `MERGE (f:File {filePath: $filePath})
               SET f.syncError = $error,
                   f.syncErrorAt = datetime()`,
              { filePath: input.filePath, error: input.graphError },
              "WRITE",
              "MarkSyncError"
            );
          }),
          onDone: "checkQueue",
          onError: "checkQueue",
        },
      },

      checkQueue: {
        entry: ({ context }) => context.lockRelease?.(),
        always: [
          { guard: "hasQueuedFiles", target: "#processing", actions: "dequeueNextFile" },
          { target: "#watching" },
        ],
      },
    },
  },
}
```

---

## LanguageRouter (Complete Implementation)

```typescript
// src/pipeline/language-router.ts

import path from "path";
import { StructuralParser } from "../analyzer/structural-parser.js";
import { adaptParseResult } from "./adapters/parse-result-adapter.js";
import type { StructuralParseResult as GraphUpdaterResult } from "../devac/actors/graph-updater.actor.js";

const PARSE_TIMEOUT_MS = 30000;

export interface ParseResult {
  success: boolean;
  data?: GraphUpdaterResult;
  error?: string;
}

export class LanguageRouter {
  private structuralParser: StructuralParser;
  private treeSitterParsers: Map<string, unknown> = new Map();

  constructor(private workspaceRoot: string) {
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

    // Check if language is supported in v1.7
    if (!V17_SUPPORTED_LANGUAGES.includes(language)) {
      return { success: false, error: `Language ${language} deferred to v1.8` };
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
    switch (language) {
      case "typescript":
      case "javascript":
        return this.structuralParser.parseStructural(filePath);
      case "python":
      case "java":
        return this.parseWithTreeSitter(filePath, language);
      default:
        throw new Error(`Unsupported language: ${language}`);
    }
  }

  private async parseWithTreeSitter(filePath: string, language: string): Promise<unknown> {
    // Tree-sitter integration - to be implemented in Phase 3
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
  ".go": "go",       // Deferred to v1.8
  ".c": "c",         // Deferred to v1.8
  ".cpp": "cpp",     // Deferred to v1.8
  ".cs": "csharp",   // Deferred to v1.8
};

// v1.7 supported languages (reduced scope per review)
const V17_SUPPORTED_LANGUAGES = ["typescript", "javascript", "python", "java"];
```

---

## Implementation Timeline (22 days)

### Phase 0: Verification (Days 1-2)

**Day 1:**
- Run `tsc --noEmit 2>&1 | head -300` - capture actual errors
- Verify APOC installation
- Verify Neo4j indexes exist
- Map ALL import paths (not just top 5)
- Install `@types/babel__traverse`

**Day 2:**
- Create missing type stubs (PackageInfo, ImportResolver)
- Measure baseline Neo4j transaction latency
- Document Phase 0 findings
- **EXIT GATE**: All blockers identified and documented

### Phase 1: Fix TypeScript Errors (Days 3-9) [+2 buffer]

**Day 3:**
- Fix `structural-parser.ts` (9 errors)
- Fix `semantic-resolver.ts` (2 errors)

**Day 4-5:**
- Fix `validation-coordinator.actor.ts` (~37 errors)
  - Fix import paths
  - Apply XState v5 event typing pattern

**Day 6:**
- Fix `validation-coordinator.service.ts` (~19 errors)
- Fix utility files (performance-monitor, query-profiler)

**Day 7-8:**
- Fix remaining actors:
  - `graph-updater.actor.ts` (4 errors)
  - `affected-calculator.actor.ts` (5 errors)
  - `semantic-resolver.actor.ts` (7 errors)
  - `script-executor.actor.ts` (8 errors)

**Day 9:**
- Verify: `tsc --noEmit` produces 0 errors
- **EXIT GATE**: Zero TypeScript errors

### Phase 2: Core Integration (Days 10-16)

**Day 10:**
- Create `parse-result-adapter.ts`
- Create `LanguageRouter` class

**Day 11:**
- Wire LanguageRouter into ValidationCoordinatorActor
- Disable AffectedCalculator + ScriptExecutor steps

**Day 12:**
- Implement per-file mutex (FileMutex class)
- Integrate into processing flow

**Day 13:**
- Add batched relationship creation to GraphUpdater
- Add Neo4j health check

**Day 14:**
- Add error handling states (parseError, syncError)
- Add queue backpressure

**Day 15:**
- Integration smoke tests
- Test: add, change, delete file cycle

**Day 16:**
- Fix issues found
- **EXIT GATE**: Basic pipeline working for TS/JS

### Phase 3: Tree-Sitter Languages (Days 17-19) [reduced scope]

**Day 17:**
- Create tree-sitter adapter
- Wire Python parser

**Day 18:**
- Wire Java parser
- Test both languages

**Day 19:**
- Fix issues, edge cases
- **EXIT GATE**: Python + Java working

### Phase 4: Polish (Days 20-22)

**Day 20:**
- Full test suite: `npm test`
- Fix regressions

**Day 21:**
- Performance benchmarks
- Document known limitations

**Day 22:**
- Final testing
- Buffer for unexpected issues

---

## Success Criteria

### Phase 0 Exit
- [ ] APOC installation verified OR fallback implemented
- [ ] All import paths mapped
- [ ] Neo4j baseline latency <50ms for single write
- [ ] Missing types identified and stubbed

### Phase 1 Exit
- [ ] `tsc --noEmit` produces 0 errors

### Phase 2 Exit
- [ ] File add triggers graph update
- [ ] File change triggers graph update
- [ ] File delete removes nodes
- [ ] Semantic queue receives files
- [ ] Per-file mutex prevents race conditions
- [ ] Parse errors marked on File node
- [ ] Queue backpressure working

### Phase 3 Exit
- [ ] Python files parse and update graph
- [ ] Java files parse and update graph

### Final
- [ ] `npm test` passes
- [ ] Structural parsing <500ms per file (relaxed from 300ms)
- [ ] No race conditions observed

---

## Performance Targets (Revised)

| Metric | Target | Notes |
|--------|--------|-------|
| TS/JS structural parse | <100ms | Babel is fast |
| Graph update (batched) | <200ms | With batched relationships |
| Total per-file latency | <500ms | Relaxed from 300ms |
| Semantic resolution | 2-10s/batch | Background, acceptable |
| Cold start | <2s | First file after startup |

---

## Known Limitations (v1.7)

1. **Languages deferred**: C/C++, Go, C# → v1.8
2. **Validation execution disabled**: AffectedCalculator + ScriptExecutor → v2
3. **Cross-file edges may be stale**: Until semantic re-resolution
4. **Startup reconciliation**: Full re-scan (not incremental diff)
5. **No graceful shutdown**: Basic process.exit
6. **No metrics export**: In-memory only

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/pipeline/language-router.ts` | Route files to parsers |
| `src/pipeline/adapters/parse-result-adapter.ts` | Bridge type mismatch |
| `src/pipeline/adapters/tree-sitter-adapter.ts` | Adapt tree-sitter output |
| `src/devac/types/package.ts` | PackageInfo type (if missing) |
| `src/devac/types/import-resolver.ts` | ImportResolver type (if missing) |
| `src/devac/utils/file-mutex.ts` | Per-file locking |
| `src/database/neo4j-health.ts` | Health check & reconnection |

## Files to Modify

| File | Changes |
|------|---------|
| `validation-coordinator.actor.ts` | Fix imports, add mutex, add error states, disable affected/validation |
| `graph-updater.actor.ts` | Fix XState typing, batch relationships |
| `structural-parser.ts` | Fix missing types |
| All other actors | Fix XState v5 typing |

---

## Deferred to v1.8+

### P2: NICE TO HAVE
- Heap monitoring for semantic batches
- Structured logging for file.processed
- Graceful shutdown handler
- Unit tests for LanguageRouter, adapters

### P3: DEFER TO v1.8+
- C/C++, Go, C# tree-sitter parsers
- Startup reconciliation algorithm (incremental diff)
- Affected file recalculation loop
- Schema migration strategy
- Full observability/metrics export

---

## Validation Checklist

### P0 Items Addressed

| Issue | Section | Status |
|-------|---------|--------|
| Verify APOC installation | P0.1 | ADDRESSED |
| Map ALL import paths | P0.2 | ADDRESSED |
| Install @types/babel__traverse | P0.3 | ADDRESSED |
| Implement parse-result-adapter | P0.4 | ADDRESSED |
| Design per-file mutex | P0.5 | ADDRESSED |
| Neo4j required indexes | P0.6 | ADDRESSED |

### P1 Items Addressed

| Issue | Section | Status |
|-------|---------|--------|
| Batch relationship creation | P1.1 | ADDRESSED |
| Neo4j health check/reconnection | P1.2 | ADDRESSED |
| Document semantic queue contract | P1.3 | ADDRESSED |
| Add queue backpressure | P1.4 | ADDRESSED |
| Add parser timeout | P1.5 | ADDRESSED |

### "What Needs Work Before v1.7" Items

| Issue | Resolution |
|-------|------------|
| Performance optimization (batched writes) | P1.1 - Batched relationship creation |
| Error handling completeness | Error Handling section with full state machine |
| Startup reconciliation design | Documented as "full re-scan" (acceptable for MVP) |
| Full observability | Deferred to v1.8 (P3) |

**Spec v1.7 is IMPLEMENTATION-READY.**
