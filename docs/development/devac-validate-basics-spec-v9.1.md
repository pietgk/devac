# DevAC Validation Basics v9.1 - Production Integration Specification

> **Version**: 9.1 (with-fixes)
> **Created**: 2025-12-09
> **Based On**: v9 spec + Review Recap (3 independent reviews) + POC Final Report
> **Status**: Ready for Implementation
> **Timeline**: 4-5 weeks
> **Focus**: Fix all critical issues, integrate POC into production, ensure multi-language support

---

## Executive Summary

### Overview

This specification incorporates **7 critical fixes** identified across 3 independent reviews (Gemini, GPT, Claude) of the v9 spec. All fixes address real issues that would have caused runtime failures or compilation errors.

### Critical Fixes Summary

| # | Issue | v9 Problem | v9.1 Solution |
|---|-------|-----------|------------------------|
| 1 | PackageInfo collision | Creates duplicate type | Use existing from `package-extractor.ts` |
| 2 | ImportResolver path | Wrong import path | Correct: `../../analyzer/parsers/import-resolver.js` |
| 3 | tsconfig nullability | `null` passed where `undefined` expected | Use `?? undefined` pattern |
| 4 | Schema migration | Creates migration runner (doesn't exist) | Add indexes to `schema.ts` array directly |
| 5 | FileChangeEvent overlap | Creates duplicate type | Use existing from `file-watcher.ts` |
| 6 | Stubbed ImportResolver | Returns `null` always | Wire real `ImportResolver` class |
| 7 | Duplicate ValidationCoordinator | Two classes, different signatures | Consolidate to single class |

### Performance Targets (Based on POC Results)

| Metric | v9 Target | POC Actual | v9.1 Target |
|--------|-----------|------------|---------------------|
| Structural parse | <50ms strict | 20ms average | **p90 <50ms** |
| Semantic batch (10 files) | 2-5s | 101ms | **p90 <500ms** |
| Type errors | 0 | 103 | **0** |
| Test coverage | 707+ | 707 | **707+** |

---

## Architecture Overview

### Two-Phase Parsing Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         FILE CHANGE DETECTED                                  │
│                     (FileWatcher - existing component)                        │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│              ValidationCoordinatorService (XState v5)                         │
│              ┌─────────────────────────────────────────────────────┐         │
│              │  idle → initializing → scanning → watching          │         │
│              │                                    │                 │         │
│              │  On FILE_CHANGED:                  ▼                 │         │
│              │    watching → processing (structural + semantic)     │         │
│              └─────────────────────────────────────────────────────┘         │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            │                   │                   │
            ▼                   ▼                   ▼
    ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
    │ TypeScript/JS │   │ Python        │   │ Java/Go/C#/   │
    │ (Babel Fast)  │   │ (native AST)  │   │ C++ (tree-    │
    │ p90 <50ms     │   │ (unchanged)   │   │ sitter)       │
    └───────┬───────┘   └───────┬───────┘   └───────┬───────┘
            │                   │                   │
            └───────────────────┴───────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   Neo4j Database      │
                    │   (unified storage)   │
                    └───────────────────────┘
```

### Key Design Decision

The POC's `StructuralParser` becomes the **TypeScript/JavaScript fast path**. All other languages continue using existing parsers unchanged.

---

## Existing Types to Reuse (DO NOT RECREATE)

### 1. FileChangeEvent (src/devac/services/codegraph/file-watcher.ts)

**Location**: `src/devac/services/codegraph/file-watcher.ts`

```typescript
// EXISTING - DO NOT RECREATE
export type FileChangeType = "add" | "change" | "unlink" | "error";

export interface FileChangeEvent {
  type: FileChangeType;
  path: string;
  timestamp: number;
  batch?: FileChangeEvent[];
  error?: Error;
}
```

**Import Pattern**:
```typescript
import type { FileChangeEvent, FileChangeType } from "../services/codegraph/file-watcher.js";
```

### 2. PackageInfo (src/analyzer/parsers/package-extractor.ts)

**Location**: `src/analyzer/parsers/package-extractor.ts`

```typescript
// EXISTING - DO NOT RECREATE
export interface PackageInfo {
  name: string;
  type: "frontend" | "shared-library" | "tool";
  path: string;
  version: string;
  entryPoint: string | null;
}
```

**Import Pattern**:
```typescript
import type { PackageInfo } from "../../analyzer/parsers/package-extractor.js";
```

### 3. ImportResolver (src/analyzer/parsers/import-resolver.ts)

**Location**: `src/analyzer/parsers/import-resolver.ts`

```typescript
// EXISTING - USE THIS CLASS
export class ImportResolver {
  constructor(workspaceRoot: string, tsConfigPath?: string);
  resolveImport(importPath: string, fromFile: string): string | null;
  resolveModuleSpecifier(specifier: string, containingFile: string): string | null;
}
```

**Import Pattern**:
```typescript
import { ImportResolver } from "../../analyzer/parsers/import-resolver.js";
```

---

## Implementation Phases

### Phase 1: Fix Type Errors (Week 1)

**Goal**: Reduce 103 TypeScript errors to 0.

#### 1.1 Install Missing Type Dependencies

```bash
npm install --save-dev @types/babel__traverse
```

**Verification**:
```bash
npm ls @types/babel__traverse
# Should show version installed
```

#### 1.2 Fix Import Paths in validation-coordinator.actor.ts

**File**: `src/devac/actors/validation-coordinator.actor.ts`

**Current (BROKEN)**:
```typescript
import type { FileChangeEvent } from "../types/file-watcher.js";
import type { Neo4jClient } from "../graph/neo4j-client.js";
import type { StructuralParser } from "../parsers/structural-parser.js";
import type { ImportResolver } from "../resolution/import-resolver.js";
import type { PackageInfo } from "../types/package.js";
```

**Fixed**:
```typescript
import type { FileChangeEvent } from "../services/codegraph/file-watcher.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";
import type { StructuralParser } from "../../analyzer/structural-parser.js";
import type { ImportResolver } from "../../analyzer/parsers/import-resolver.js";
import type { PackageInfo } from "../../analyzer/parsers/package-extractor.js";
```

**Verification**:
```bash
tsc --noEmit 2>&1 | grep "Cannot find module" | grep validation-coordinator
# Should return 0 results
```

#### 1.3 Fix Import Paths in validation-coordinator.service.ts

**File**: `src/devac/services/validation-coordinator.service.ts`

Apply identical import path fixes as section 1.2.

#### 1.4 Fix tsconfig Nullability Issues

**Problem**: `findNearestTsConfig()` returns `string | null`, but ts-morph expects `string | undefined`.

**File**: `src/devac/actors/semantic-resolver.actor.ts` (and similar files)

**Current (BROKEN)**:
```typescript
const tsConfigPath = await findNearestTsConfig(files[0]);
new Project({ tsConfigFilePath: tsConfigPath }); // Error: null not assignable to undefined
```

**Fixed**:
```typescript
const tsConfigPath = await findNearestTsConfig(files[0]) ?? undefined;
new Project({ tsConfigFilePath: tsConfigPath }); // Now works
```

**Verification**:
```bash
tsc --noEmit 2>&1 | grep "tsConfigFilePath"
# Should return 0 results
```

#### 1.5 Fix Babel Traverse Callback Types

**File**: `src/analyzer/structural-parser.ts`

**Current (BROKEN)**:
```typescript
import traverse from "@babel/traverse";

traverse(ast, {
  ClassDeclaration: (path) => {  // path is implicitly 'any'
    // ...
  }
});
```

**Fixed**:
```typescript
import traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";

traverse(ast, {
  ClassDeclaration: (path: NodePath<t.ClassDeclaration>) => {
    const node = path.node;
    // Now fully typed
  }
});
```

#### 1.6 Fix XState v5 Action/Guard References

**Problem**: XState v5 requires actions/guards to be defined in `setup()` block when referenced by string.

**File**: `src/devac/actors/validation-coordinator.actor.ts`

**Current (BROKEN)**:
```typescript
export const validationCoordinatorActor = createMachine({
  // ...
  states: {
    processing: {
      onDone: {
        target: "idle",
        actions: "logComplete",  // String ref without setup() definition
      }
    }
  }
});
```

**Fixed**:
```typescript
export const validationCoordinatorActor = setup({
  types: {
    context: {} as ValidationCoordinatorContext,
    events: {} as ValidationCoordinatorEvent,
  },
  actions: {
    logComplete: ({ context, event }) => {
      console.log(`Processing complete for ${context.currentFile}`);
    },
  },
  guards: {
    hasQueuedFiles: ({ context }) => context.processingQueue.length > 0,
  },
}).createMachine({
  // Now string references work
  states: {
    processing: {
      onDone: {
        target: "idle",
        actions: "logComplete",  // References setup() definition
      }
    }
  }
});
```

#### 1.7 Fix XState v5 Event Type Narrowing

**Problem**: TypeScript can't narrow `event.type.startsWith("xstate.done.actor")`.

**File**: `src/devac/actors/graph-updater.actor.ts` (and similar)

**Solution**: Create type guard helper:

```typescript
import type { DoneActorEvent, ErrorActorEvent } from "xstate";

// Type guard for done events
function isDoneActorEvent<T>(event: unknown): event is DoneActorEvent<T> {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    typeof (event as { type: string }).type === "string" &&
    (event as { type: string }).type.startsWith("xstate.done.actor")
  );
}

// Usage
if (isDoneActorEvent<{ nodesUpdated: number }>(event)) {
  console.log(`Updated ${event.output.nodesUpdated} nodes`);  // Type-safe
}
```

#### 1.8 Fix Error Handling in Catch Blocks

**File**: `src/analyzer/structural-parser.ts` (and similar)

**Current (BROKEN)**:
```typescript
catch (error) {
  throw new Error(`Failed to parse: ${error.message}`);  // error is 'unknown'
}
```

**Fixed**:
```typescript
catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Failed to parse: ${message}`);
}
```

#### 1.9 Phase 1 Verification Checklist

```bash
# 1. Check type errors count
tsc --noEmit 2>&1 | wc -l
# Target: 0 errors

# 2. Check build succeeds
npm run build
# Target: Success

# 3. Check tests pass
npm test
# Target: 707+ tests passing

# 4. Check no duplicate type definitions
grep -rn "interface PackageInfo" src/
# Target: Only 1 result (in package-extractor.ts)

grep -rn "interface FileChangeEvent" src/
# Target: Only 1 result (in file-watcher.ts)
```

---

### Phase 2: Wire POC into Production (Weeks 2-3)

**Goal**: Connect POC actors to production code paths.

#### 2.1 Create Integration Layer

**File**: `src/devac/integration/incremental-analyzer.ts` (NEW FILE)

```typescript
// src/devac/integration/incremental-analyzer.ts

import { StructuralParser } from "../../analyzer/structural-parser.js";
import { ImportResolver } from "../../analyzer/parsers/import-resolver.js";
import { ValidationCoordinatorService } from "../services/validation-coordinator.service.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";
import type { FileChangeEvent } from "../services/codegraph/file-watcher.js";
import type { PackageInfo } from "../../analyzer/parsers/package-extractor.js";

export interface IncrementalAnalyzerConfig {
  neo4jClient: Neo4jClient;
  packages: PackageInfo[];
  workspaceRoot: string;
  tsConfigPath?: string;
}

/**
 * Incremental analyzer for single-file changes.
 * 
 * Uses two-phase architecture:
 * 1. Structural phase (Babel, p90 <50ms) - immediate feedback
 * 2. Semantic phase (ts-morph, deferred) - background resolution
 * 
 * Only handles TypeScript/JavaScript files.
 */
export class IncrementalAnalyzer {
  private structuralParser: StructuralParser;
  private importResolver: ImportResolver;
  private coordinator: ValidationCoordinatorService | null = null;
  private isInitialized = false;

  private static readonly SUPPORTED_EXTENSIONS = new Set([
    "ts", "tsx", "js", "jsx", "mjs", "cjs"
  ]);

  constructor(private config: IncrementalAnalyzerConfig) {
    this.structuralParser = new StructuralParser();
    // Wire REAL ImportResolver, not a stub
    this.importResolver = new ImportResolver(
      config.workspaceRoot,
      config.tsConfigPath
    );
  }

  /**
   * Check if this analyzer can handle the given file
   */
  canHandle(filePath: string): boolean {
    const ext = filePath.split(".").pop()?.toLowerCase();
    return IncrementalAnalyzer.SUPPORTED_EXTENSIONS.has(ext || "");
  }

  /**
   * Initialize the validation coordinator
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.coordinator = new ValidationCoordinatorService({
      neo4jClient: this.config.neo4jClient,
      structuralParser: this.structuralParser,
      importResolver: this.importResolver,
      packages: this.config.packages,
      workspaceRoot: this.config.workspaceRoot,
    });

    this.coordinator.start();
    this.isInitialized = true;
  }

  /**
   * Handle a file change incrementally
   */
  async handleFileChange(event: FileChangeEvent): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.canHandle(event.path)) {
      throw new Error(`IncrementalAnalyzer cannot handle: ${event.path}`);
    }

    this.coordinator?.send({
      type: "FILE_CHANGED",
      event
    });
  }

  /**
   * Shutdown the analyzer
   */
  async shutdown(): Promise<void> {
    this.coordinator?.stop();
    this.isInitialized = false;
  }

  /**
   * Get current queue status
   */
  getStatus(): { queueSize: number; processing: boolean } {
    if (!this.coordinator) {
      return { queueSize: 0, processing: false };
    }
    return this.coordinator.getStatus();
  }
}
```

#### 2.2 Consolidate ValidationCoordinatorService

**Problem**: Two classes with same name exist:
- `src/devac/actors/validation-coordinator.service.ts`
- `src/devac/services/validation-coordinator.service.ts`

**Solution**: Keep only the one in `services/` directory with options pattern.

**File**: `src/devac/services/validation-coordinator.service.ts`

```typescript
// src/devac/services/validation-coordinator.service.ts

import { createActor, type AnyActorRef } from "xstate";
import { validationCoordinatorActor } from "../actors/validation-coordinator.actor.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";
import type { StructuralParser } from "../../analyzer/structural-parser.js";
import type { ImportResolver } from "../../analyzer/parsers/import-resolver.js";
import type { PackageInfo } from "../../analyzer/parsers/package-extractor.js";
import type { FileChangeEvent } from "./codegraph/file-watcher.js";

export interface ValidationCoordinatorServiceOptions {
  neo4jClient: Neo4jClient;
  structuralParser: StructuralParser;
  importResolver: ImportResolver;
  packages: PackageInfo[];
  workspaceRoot: string;
}

/**
 * Service wrapper for ValidationCoordinator actor.
 * 
 * Manages actor lifecycle and provides convenient API for file change handling.
 */
export class ValidationCoordinatorService {
  private actor: AnyActorRef | null = null;

  constructor(private options: ValidationCoordinatorServiceOptions) {}

  /**
   * Start the coordinator actor
   */
  start(): void {
    if (this.actor) return;

    this.actor = createActor(validationCoordinatorActor, {
      input: {
        neo4jClient: this.options.neo4jClient,
        structuralParser: this.options.structuralParser,
        importResolver: this.options.importResolver,
        packages: this.options.packages,
        workspaceRoot: this.options.workspaceRoot,
      }
    });

    this.actor.start();
  }

  /**
   * Stop the coordinator actor
   */
  stop(): void {
    this.actor?.stop();
    this.actor = null;
  }

  /**
   * Send event to the actor
   */
  send(event: { type: string; event?: FileChangeEvent }): void {
    this.actor?.send(event);
  }

  /**
   * Get current status
   */
  getStatus(): { queueSize: number; processing: boolean } {
    const snapshot = this.actor?.getSnapshot();
    if (!snapshot) {
      return { queueSize: 0, processing: false };
    }
    return {
      queueSize: snapshot.context.processingQueue?.length ?? 0,
      processing: snapshot.matches("processing"),
    };
  }
}
```

**Action**: Delete `src/devac/actors/validation-coordinator.service.ts` after consolidation.

#### 2.3 Add Neo4j Schema Indexes

**File**: `src/database/schema.ts`

**Add to the existing indexes array** (DO NOT create migration runner):

```typescript
// Add these to the CONSTRAINTS_AND_INDEXES array in schema.ts

// Structural completion tracking
{
  type: "index",
  label: "File",
  property: "structuralComplete",
  name: "file_structural_complete_idx"
},
// Semantic completion tracking
{
  type: "index",
  label: "File",
  property: "semanticComplete",
  name: "file_semantic_complete_idx"
},
// Semantic queue tracking
{
  type: "index",
  label: "File",
  property: "semanticQueued",
  name: "file_semantic_queued_idx"
},
```

**Verification**:
```bash
grep -c "structuralComplete\|semanticComplete\|semanticQueued" src/database/schema.ts
# Expected: 3 (one for each index)
```

#### 2.4 Add StorageManager Status Methods

**File**: `src/analyzer/storage-manager.ts`

Add these methods to the existing `StorageManager` class:

```typescript
/**
 * Mark file as structurally complete
 */
async markStructuralComplete(filePath: string): Promise<void> {
  await this.neo4jClient.runTransaction(
    `MATCH (f:File {filePath: $filePath})
     SET f.structuralComplete = true,
         f.lastStructuralUpdate = datetime()`,
    { filePath },
    "WRITE",
    "MarkStructuralComplete"
  );
}

/**
 * Mark file as queued for semantic resolution
 */
async markSemanticQueued(filePath: string): Promise<void> {
  await this.neo4jClient.runTransaction(
    `MATCH (f:File {filePath: $filePath})
     SET f.semanticQueued = true,
         f.semanticComplete = false`,
    { filePath },
    "WRITE",
    "MarkSemanticQueued"
  );
}

/**
 * Mark file as semantically complete
 */
async markSemanticComplete(filePath: string): Promise<void> {
  await this.neo4jClient.runTransaction(
    `MATCH (f:File {filePath: $filePath})
     SET f.semanticComplete = true,
         f.semanticQueued = false,
         f.lastSemanticUpdate = datetime()`,
    { filePath },
    "WRITE",
    "MarkSemanticComplete"
  );
}

/**
 * Get files pending semantic resolution
 */
async getFilesPendingSemantic(limit: number = 10): Promise<string[]> {
  const result = await this.neo4jClient.runTransaction(
    `MATCH (f:File)
     WHERE f.structuralComplete = true 
       AND f.semanticComplete = false
       AND (f.semanticQueued IS NULL OR f.semanticQueued = false)
     RETURN f.filePath as filePath
     LIMIT $limit`,
    { limit },
    "READ",
    "GetFilesPendingSemantic"
  );
  return result.records.map(r => r.get("filePath") as string);
}
```

#### 2.5 Integrate with CodeGraphService

**File**: `src/devac/services/codegraph/codegraph-service.ts`

Add incremental analysis path:

```typescript
import { IncrementalAnalyzer } from "../../integration/incremental-analyzer.js";
import { PackageExtractor } from "../../../analyzer/parsers/package-extractor.js";

export class CodeGraphService extends BaseService {
  private incrementalAnalyzer: IncrementalAnalyzer | null = null;
  private useIncrementalForTS = true;  // Feature flag

  /**
   * Initialize incremental analyzer for TS/JS files
   */
  private async initializeIncrementalAnalyzer(): Promise<void> {
    if (!this.useIncrementalForTS || this.incrementalAnalyzer) return;

    // Use existing PackageExtractor to discover packages
    const packageExtractor = new PackageExtractor();
    const packages = await packageExtractor.extractPackages(this.getPrimaryDirectory());

    this.incrementalAnalyzer = new IncrementalAnalyzer({
      neo4jClient: this.neo4jClient,
      packages,
      workspaceRoot: this.getPrimaryDirectory(),
    });

    await this.incrementalAnalyzer.initialize();
  }

  /**
   * Process file change with incremental or full analysis
   */
  protected async process(input: ServiceInput): Promise<ServiceOutput> {
    const event = input as FileChangeEvent;

    // Initialize incremental analyzer if needed
    await this.initializeIncrementalAnalyzer();

    // Use fast incremental path for TS/JS
    if (this.useIncrementalForTS && this.incrementalAnalyzer?.canHandle(event.path)) {
      await this.incrementalAnalyzer.handleFileChange(event);
      return {
        success: true,
        message: `Incremental analysis: ${event.path}`,
        data: { mode: "incremental" }
      };
    }

    // Fall back to full analysis for other languages
    await this.analyzerService.analyze(this.getPrimaryDirectory(), {
      ignorePatterns: this.config.ignore,
      supportedExtensions: this.config.extensions,
    });

    return {
      success: true,
      message: "Full analysis complete",
      data: { mode: "full" }
    };
  }
}
```

---

### Phase 3: Multi-Language Support (Weeks 3-4)

**Goal**: Verify all 8 languages continue to work.

#### 3.1 Language Support Matrix

| Language | Parser | Incremental? | Notes |
|----------|--------|:------------:|-------|
| TypeScript | StructuralParser (Babel) | ✅ | NEW - fast path |
| JavaScript | StructuralParser (Babel) | ✅ | NEW - fast path |
| Python | PythonAstParser | ❌ | Unchanged - native AST |
| Java | JavaParser (tree-sitter) | ❌ | Unchanged |
| Go | GoParser (tree-sitter) | ❌ | Unchanged |
| C/C++ | CCppParser (tree-sitter) | ❌ | Unchanged |
| C# | CSharpParser (tree-sitter) | ❌ | Unchanged |
| SQL | SqlParser (tree-sitter) | ❌ | Unchanged (disabled) |

#### 3.2 Multi-Language Integration Tests

**File**: `src/devac/integration/__tests__/multi-language.integration.spec.ts` (NEW FILE)

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { IncrementalAnalyzer } from "../incremental-analyzer.js";
import { AnalyzerService } from "../../../analyzer/analyzer-service.js";

describe("Multi-Language Integration", () => {
  describe("IncrementalAnalyzer.canHandle()", () => {
    let analyzer: IncrementalAnalyzer;

    beforeEach(() => {
      analyzer = new IncrementalAnalyzer({
        neo4jClient: {} as any,
        packages: [],
        workspaceRoot: process.cwd(),
      });
    });

    // TypeScript/JavaScript - should use incremental
    it.each([
      ["file.ts", true],
      ["file.tsx", true],
      ["file.js", true],
      ["file.jsx", true],
      ["file.mjs", true],
      ["file.cjs", true],
    ])("canHandle(%s) should return %s", (file, expected) => {
      expect(analyzer.canHandle(file)).toBe(expected);
    });

    // Other languages - should NOT use incremental (fall back to full)
    it.each([
      ["file.py", false],
      ["file.java", false],
      ["file.go", false],
      ["file.cpp", false],
      ["file.cs", false],
      ["file.sql", false],
      ["file.md", false],
      ["file.json", false],
    ])("canHandle(%s) should return %s", (file, expected) => {
      expect(analyzer.canHandle(file)).toBe(expected);
    });
  });

  describe("Full analysis fallback for non-TS languages", () => {
    it("should parse Python files via full analysis", async () => {
      // Test that Python files still work through existing pipeline
    });

    it("should parse Java files via full analysis", async () => {
      // Test that Java files still work
    });

    // Additional language tests...
  });
});
```

---

### Phase 4: Validation and Hardening (Weeks 4-5)

**Goal**: Comprehensive testing and performance validation.

#### 4.1 Performance Benchmarks

**File**: `src/devac/integration/__tests__/performance.bench.ts` (NEW FILE)

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { StructuralParser } from "../../../analyzer/structural-parser.js";

describe("Performance Benchmarks", () => {
  let parser: StructuralParser;
  const testFiles = [
    "test-fixtures/small-file.ts",      // ~50 LOC
    "test-fixtures/medium-file.ts",     // ~500 LOC
    "test-fixtures/large-file.ts",      // ~2000 LOC
  ];

  beforeAll(() => {
    parser = new StructuralParser();
  });

  it("structural parse p90 should be <50ms for typical files", async () => {
    const times: number[] = [];
    
    for (let i = 0; i < 100; i++) {
      for (const file of testFiles) {
        const start = performance.now();
        await parser.parseStructural(file);
        times.push(performance.now() - start);
      }
    }

    times.sort((a, b) => a - b);
    const p90 = times[Math.floor(times.length * 0.9)];
    
    console.log(`Structural parse times:
      p50: ${times[Math.floor(times.length * 0.5)].toFixed(2)}ms
      p90: ${p90.toFixed(2)}ms
      p99: ${times[Math.floor(times.length * 0.99)].toFixed(2)}ms`);
    
    expect(p90).toBeLessThan(50);
  });
});
```

#### 4.2 End-to-End Tests

**File**: `src/devac/integration/__tests__/e2e.integration.spec.ts` (NEW FILE)

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { IncrementalAnalyzer } from "../incremental-analyzer.js";
import { createTestNeo4jClient, cleanupTestDatabase } from "../../../../test/helpers/neo4j-test-client.js";

describe("E2E: File Change → Graph Update", () => {
  let analyzer: IncrementalAnalyzer;
  let neo4jClient: any;

  beforeAll(async () => {
    neo4jClient = createTestNeo4jClient();
    analyzer = new IncrementalAnalyzer({
      neo4jClient,
      packages: [],
      workspaceRoot: process.cwd(),
    });
    await analyzer.initialize();
  });

  afterAll(async () => {
    await analyzer.shutdown();
    await cleanupTestDatabase(neo4jClient);
  });

  it("should update graph within p90 <50ms for TS file", async () => {
    const testFile = "test-fixtures/sample.ts";
    const start = performance.now();
    
    await analyzer.handleFileChange({
      type: "change",
      path: testFile,
      timestamp: Date.now(),
    });
    
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(100); // Allow some margin for Neo4j
  });

  it("should set structuralComplete=true after structural phase", async () => {
    const testFile = "test-fixtures/sample.ts";
    
    await analyzer.handleFileChange({
      type: "change",
      path: testFile,
      timestamp: Date.now(),
    });
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const result = await neo4jClient.runTransaction(
      `MATCH (f:File {filePath: $filePath})
       RETURN f.structuralComplete as complete`,
      { filePath: testFile },
      "READ",
      "CheckStructuralComplete"
    );
    
    expect(result.records[0]?.get("complete")).toBe(true);
  });
});
```

---

## Implementation Checklist

### Week 1: Fix Type Errors

- [ ] Install `@types/babel__traverse`
- [ ] Fix imports in `validation-coordinator.actor.ts`
- [ ] Fix imports in `validation-coordinator.service.ts`
- [ ] Fix tsconfig nullability with `?? undefined`
- [ ] Fix Babel traverse callback types
- [ ] Fix XState v5 action/guard references in all actor files
- [ ] Fix event type narrowing with type guards
- [ ] Fix error handling in catch blocks
- [ ] Verify: `tsc --noEmit` → 0 errors
- [ ] Verify: `npm run build` → success
- [ ] Verify: `npm test` → 707+ passing

### Week 2-3: Wire POC into Production

- [ ] Create `src/devac/integration/incremental-analyzer.ts`
- [ ] Consolidate `ValidationCoordinatorService` (delete duplicate)
- [ ] Add schema indexes to `schema.ts` array
- [ ] Add `StorageManager` status methods
- [ ] Integrate with `CodeGraphService`
- [ ] Unit tests for new components

### Week 3-4: Multi-Language Support

- [ ] Create multi-language integration tests
- [ ] Verify all 8 languages still parse correctly
- [ ] Verify `canHandle()` routing works
- [ ] Verify full analysis fallback

### Week 4-5: Validation

- [ ] Create performance benchmarks
- [ ] Create E2E tests
- [ ] Verify p90 <50ms for structural parse
- [ ] Verify all tests pass
- [ ] Final documentation

---

## Verification Commands

```bash
# 1. Check type errors
tsc --noEmit 2>&1 | wc -l
# Expected: 0

# 2. Check no duplicate types
grep -rn "interface PackageInfo" src/
# Expected: 1 result (package-extractor.ts)

grep -rn "interface FileChangeEvent" src/
# Expected: 1 result (file-watcher.ts)

# 3. Check import paths
grep -rn "import.*ImportResolver" src/devac/
# Expected: All paths contain "../../analyzer/parsers/"

# 4. Check schema indexes
grep -c "structuralComplete\|semanticComplete\|semanticQueued" src/database/schema.ts
# Expected: 3

# 5. Check for duplicate service classes
find src -name "validation-coordinator.service.ts" | wc -l
# Expected: 1 (in services/ directory)

# 6. Build and test
npm run build && npm test
# Expected: Success, 707+ tests passing
```

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Type fixes break tests | Medium | Medium | Run tests after each fix |
| Integration breaks multi-language | Low | High | `canHandle` check + fallback |
| XState v5 patterns incorrect | Medium | Medium | Review XState v5 docs |
| Performance regression | Low | Medium | Benchmark continuously |

---

## Success Criteria

| Phase | Criteria | Verification |
|-------|----------|--------------|
| Phase 1 | 0 type errors | `tsc --noEmit` |
| Phase 1 | Build succeeds | `npm run build` |
| Phase 1 | 707+ tests pass | `npm test` |
| Phase 2 | Incremental works for TS/JS | Integration tests |
| Phase 3 | All 8 languages parse | Multi-language tests |
| Phase 4 | p90 <50ms structural | Performance benchmarks |

---

## Appendix: Files to Create

| File | Purpose |
|------|---------|
| `src/devac/integration/incremental-analyzer.ts` | Integration layer |
| `src/devac/integration/__tests__/multi-language.integration.spec.ts` | Language routing tests |
| `src/devac/integration/__tests__/performance.bench.ts` | Performance benchmarks |
| `src/devac/integration/__tests__/e2e.integration.spec.ts` | End-to-end tests |

## Appendix: Files to Modify

| File | Changes |
|------|---------|
| `package.json` | Add `@types/babel__traverse` |
| `src/devac/actors/validation-coordinator.actor.ts` | Fix imports, XState v5 types |
| `src/devac/services/validation-coordinator.service.ts` | Fix imports, consolidate |
| `src/devac/actors/graph-updater.actor.ts` | Fix event types |
| `src/devac/actors/semantic-resolver.actor.ts` | Fix nullability, event types |
| `src/devac/actors/affected-calculator.actor.ts` | Fix event types |
| `src/devac/actors/script-executor.actor.ts` | Fix event types |
| `src/analyzer/structural-parser.ts` | Fix Babel types |
| `src/analyzer/semantic-resolver.ts` | Fix string/undefined |
| `src/analyzer/storage-manager.ts` | Add status methods |
| `src/database/schema.ts` | Add indexes to array |
| `src/devac/services/codegraph/codegraph-service.ts` | Add incremental path |

## Appendix: Files to Delete

| File | Reason |
|------|--------|
| `src/devac/actors/validation-coordinator.service.ts` | Duplicate - consolidate to services/ |

---

**Document Version**: 9.1 (with-fixes)
**Reviews Incorporated**: Gemini, GPT, Claude (3/3 consensus on critical fixes)
**POC Results Used**: 20ms structural parse, 101ms semantic batch
