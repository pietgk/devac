# DevAC Validation Basics v9 - POC Production Integration Specification

> **Version**: 9.0 - POC to Production Integration
> **Created**: 2025-12-09
> **Based On**: v8 spec + POC implementation + integration failure analysis
> **Status**: Ready for Implementation
> **Timeline**: 4-5 weeks
> **Focus**: Fix type errors, integrate POC into production, ensure multi-language support

---

## Executive Summary

### The Problem

The v8 specification was implemented as a **Proof of Concept (POC)** that validated the two-phase parsing architecture (Babel structural + ts-morph semantic). However, the POC was **never integrated into production**:

| Aspect | POC Status | Production Status | Gap |
|--------|------------|-------------------|-----|
| **Structural Parser** | Implemented (Babel) | Uses ts-morph only | Not integrated |
| **Semantic Resolver Actor** | XState v5 actor | Not used | Not integrated |
| **Graph Updater Actor** | XState v5 actor | Not used | Not integrated |
| **Validation Coordinator** | XState v5 actor | Not used | Not integrated |
| **Neo4j Flags** | structuralComplete/semanticComplete defined | Not in storage-manager | Not integrated |
| **Multi-language Support** | TypeScript/JavaScript only | 8 languages | **CRITICAL GAP** |

### The Solution: v9 Integration Specification

This specification defines a **phased integration approach** that:

1. **Fixes 103 type errors** in POC code (Week 1)
2. **Integrates POC into production** without breaking existing functionality (Weeks 2-3)
3. **Ensures multi-language support** continues to work (Week 3-4)
4. **Validates end-to-end** with comprehensive testing (Week 4-5)

### Success Metrics

| Metric | Current | Target | Validation |
|--------|---------|--------|------------|
| **Type errors** | 103 | 0 | `tsc --noEmit` passes |
| **Unit tests** | 707 passing | 707+ passing | `npm test` |
| **Languages supported** | 8 | 8 | Integration tests |
| **Structural parse time** | N/A | <50ms | Performance tests |
| **Build successful** | No | Yes | `npm run build` |

---

## What's New in v9

### Critical Fixes from v8 Implementation

1. **Missing Type Definitions**
   - `src/devac/types/file-watcher.ts` - Does not exist
   - `src/devac/types/package.ts` - Does not exist
   - Import paths point to wrong locations

2. **XState v5 Type Incompatibilities**
   - Actions defined as strings instead of functions (XState v5 requires functions)
   - Event type narrowing issues with `xstate.done.actor.*` patterns
   - Guards defined as strings instead of predicates

3. **Import Path Misalignments**
   - POC expects: `../graph/neo4j-client.js`
   - Actual location: `../../database/neo4j-client.js`
   - Multiple files affected

4. **Multi-Language Architecture Gap**
   - POC's `StructuralParser` only handles TypeScript/JavaScript
   - Production parser handles 8 languages via language-specific parsers
   - No bridge between POC and existing language parsers

### v9 Architecture: Integrated Two-Phase with Multi-Language Support

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         FILE CHANGE DETECTED                                  │
│                          (FileWatcher)                                        │
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
    │ TypeScript/JS │   │ Python/Java   │   │ Go/C#/C++     │
    │ (Babel Fast)  │   │ (Existing)    │   │ (tree-sitter) │
    │ <50ms         │   │ (unchanged)   │   │ (unchanged)   │
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

**Key Design Decision**: The POC's `StructuralParser` becomes the **TypeScript/JavaScript fast path**, while existing language parsers continue to handle other languages unchanged.

---

## Implementation Phases

### Phase 1: Fix Type Errors (Week 1)

**Goal**: Get POC code to compile with zero TypeScript errors.

#### 1.1 Create Missing Type Definition Files

**Task 1.1.1**: Create `src/devac/types/file-watcher.ts`

```typescript
// src/devac/types/file-watcher.ts

/**
 * File change event from chokidar file watcher
 */
export interface FileChangeEvent {
  /** Absolute path to the changed file */
  path: string;
  /** Type of change */
  type: "add" | "change" | "unlink";
  /** Timestamp of the change */
  timestamp?: Date;
  /** Optional batch information for grouped changes */
  batch?: {
    id: string;
    files: string[];
  };
}

/**
 * File watcher configuration
 */
export interface FileWatcherConfig {
  /** Directories to watch */
  paths: string[];
  /** Glob patterns to ignore */
  ignored?: string[];
  /** Debounce delay in milliseconds */
  debounceDelay?: number;
  /** Whether to emit events on initial scan */
  ignoreInitial?: boolean;
}
```

**Task 1.1.2**: Create `src/devac/types/package.ts`

```typescript
// src/devac/types/package.ts

/**
 * Package information for monorepo support
 */
export interface PackageInfo {
  /** Package name from package.json */
  name: string;
  /** Absolute path to package root */
  path: string;
  /** Relative path from workspace root */
  relativePath: string;
  /** Package version */
  version?: string;
  /** Dependencies (package names) */
  dependencies?: string[];
  /** Dev dependencies (package names) */
  devDependencies?: string[];
  /** Scripts available in package.json */
  scripts?: Record<string, string>;
  /** Whether this is a private package */
  private?: boolean;
}

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Workspace root path */
  root: string;
  /** Packages in the workspace */
  packages: PackageInfo[];
  /** Package manager (npm, yarn, pnpm) */
  packageManager?: "npm" | "yarn" | "pnpm";
}
```

**Task 1.1.3**: Update `src/devac/types/index.ts` to export new types

```typescript
// Add to src/devac/types/index.ts
export * from "./file-watcher.js";
export * from "./package.js";
```

**Checklist**:
- [ ] Create `src/devac/types/file-watcher.ts`
- [ ] Create `src/devac/types/package.ts`
- [ ] Update `src/devac/types/index.ts`
- [ ] Verify imports resolve: `tsc --noEmit 2>&1 | grep "Cannot find module"`

#### 1.2 Fix Import Paths

**Task 1.2.1**: Fix imports in `validation-coordinator.actor.ts`

Current (broken):
```typescript
import type { FileChangeEvent } from "../types/file-watcher.js";
import type { Neo4jClient } from "../graph/neo4j-client.js";
import type { StructuralParser } from "../parsers/structural-parser.js";
import type { ImportResolver } from "../resolution/import-resolver.js";
import type { PackageInfo } from "../types/package.js";
```

Fixed:
```typescript
import type { FileChangeEvent, PackageInfo } from "../types/index.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";
import type { StructuralParser } from "../../analyzer/structural-parser.js";
import type { ImportResolver } from "../../resolver/import-resolver.js";
```

**Task 1.2.2**: Fix imports in `validation-coordinator.service.ts`

Apply same import path fixes.

**Task 1.2.3**: Verify `ImportResolver` exists or create type alias

Check if `src/resolver/import-resolver.ts` exists. If not, create a minimal interface:

```typescript
// src/resolver/import-resolver.ts (if needed)
export interface ImportResolver {
  resolveImport(importPath: string, fromFile: string): string | null;
  resolveModuleSpecifier(specifier: string, containingFile: string): string | null;
}
```

**Checklist**:
- [ ] Fix imports in `validation-coordinator.actor.ts`
- [ ] Fix imports in `validation-coordinator.service.ts`
- [ ] Create `ImportResolver` interface if missing
- [ ] Verify: `tsc --noEmit 2>&1 | grep "Cannot find module" | wc -l` → 0

#### 1.3 Fix XState v5 Type Issues

**Task 1.3.1**: Fix action string references

XState v5 requires actions/guards to be functions when used inline, or references to named implementations in `setup()`.

Current (broken):
```typescript
onDone: {
  target: "queueSemantic",
  actions: "logGraphUpdateComplete",  // String reference
}
```

Fixed option A (reference to setup):
```typescript
// In setup() block
actions: {
  logGraphUpdateComplete: ({ event }) => {
    console.log(`Structural update complete: ${event.output?.nodesUpdated} nodes`);
  }
}

// In states
onDone: {
  target: "queueSemantic",
  actions: "logGraphUpdateComplete",  // Now works - references setup
}
```

Fixed option B (inline function):
```typescript
onDone: {
  target: "queueSemantic",
  actions: ({ event }) => {
    console.log(`Structural update complete: ${event.output?.nodesUpdated} nodes`);
  }
}
```

**Task 1.3.2**: Fix event type narrowing for actor completion events

Current (broken - TypeScript can't narrow):
```typescript
if (event.type.startsWith("xstate.done.actor")) {
  return event.output;  // Error: 'output' doesn't exist
}
```

Fixed (explicit type guard):
```typescript
import { type DoneActorEvent, type ErrorActorEvent } from "xstate";

// Type guard helper
function isDoneEvent<T>(event: unknown): event is DoneActorEvent<T> {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    typeof (event as { type: string }).type === "string" &&
    (event as { type: string }).type.startsWith("xstate.done.actor")
  );
}

// Usage
if (isDoneEvent<{ nodesUpdated: number }>(event)) {
  return event.output.nodesUpdated;  // Now type-safe
}
```

**Task 1.3.3**: Fix guard string references

Current (broken):
```typescript
guard: "hasQueuedFiles",  // String reference not allowed in some contexts
```

Fixed:
```typescript
// Ensure guard is in setup() guards block
setup({
  guards: {
    hasQueuedFiles: ({ context }) => context.processingQueue.length > 0,
  }
})
// Then string reference works
```

**Task 1.3.4**: Fix `affectedCalculatorActor` type compatibility

The error indicates `affectedCalculatorActor` has an event type of `never` which makes it incompatible as an actor reference.

Fix: Ensure the actor has proper event types defined:

```typescript
// In affected-calculator.actor.ts
export type AffectedCalculatorEvent =
  | { type: "CALCULATE"; filePath: string }
  | { type: "STOP" };

export const affectedCalculatorActor = setup({
  types: {
    input: {} as AffectedCalculatorInput,
    context: {} as AffectedCalculatorContext,
    events: {} as AffectedCalculatorEvent,  // Must not be never
    output: {} as AffectedResult,
  },
  // ...
})
```

**Checklist**:
- [ ] Fix all action string references in `validation-coordinator.actor.ts`
- [ ] Fix all action string references in `validation-coordinator.service.ts`
- [ ] Add `isDoneEvent` and `isErrorEvent` type guards
- [ ] Fix guard string references
- [ ] Fix `affectedCalculatorActor` event types
- [ ] Fix `graph-updater.actor.ts` event type issues
- [ ] Fix `script-executor.actor.ts` event type issues
- [ ] Fix `semantic-resolver.actor.ts` event type issues

#### 1.4 Fix Babel Traverse Types

**Task 1.4.1**: Install Babel traverse types

```bash
npm install --save-dev @types/babel__traverse
```

**Task 1.4.2**: Fix implicit any in traverse callbacks

Current (broken):
```typescript
traverse(ast, {
  ClassDeclaration: (path) => {  // path is implicitly 'any'
    // ...
  }
});
```

Fixed:
```typescript
import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";

traverse(ast, {
  ClassDeclaration: (path: NodePath<t.ClassDeclaration>) => {
    // ...
  }
});
```

**Task 1.4.3**: Fix error type in catch block

```typescript
// Before
catch (error) {
  throw new Error(`Failed to parse: ${error.message}`);  // error is unknown
}

// After
catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Failed to parse: ${message}`);
}
```

**Checklist**:
- [ ] Install `@types/babel__traverse`
- [ ] Add explicit types to all traverse callback parameters
- [ ] Fix error handling in catch blocks
- [ ] Verify: `tsc --noEmit 2>&1 | grep "structural-parser" | wc -l` → 0

#### 1.5 Fix semantic-resolver.ts Type Issues

**Task 1.5.1**: Fix undefined/null type mismatches

```typescript
// Before (line 252)
someFunction(value);  // value is string | undefined

// After
if (value !== undefined) {
  someFunction(value);
}
```

**Task 1.5.2**: Fix async function call issues

```typescript
// Before (line 281)
const relationships = resolver.resolveRelationships();  // Returns Promise

// After
const relationships = await resolver.resolveRelationships();
```

**Checklist**:
- [ ] Fix undefined parameter issues in semantic-resolver.ts
- [ ] Fix null vs undefined type mismatches
- [ ] Fix async/await issues
- [ ] Verify: `tsc --noEmit 2>&1 | grep "semantic-resolver" | wc -l` → 0

#### 1.6 Phase 1 Validation

**Final Checklist**:
- [ ] `tsc --noEmit` produces 0 errors
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (707+ tests)
- [ ] No regressions in existing functionality

---

### Phase 2: Wire POC into Production (Weeks 2-3)

**Goal**: Connect POC actors to production code paths without breaking existing functionality.

#### 2.1 Create Integration Layer

**Task 2.1.1**: Create `src/devac/integration/incremental-analyzer.ts`

This module bridges the POC actors with the existing `AnalyzerService`:

```typescript
// src/devac/integration/incremental-analyzer.ts

import { StructuralParser } from "../../analyzer/structural-parser.js";
import { ValidationCoordinatorService } from "../services/validation-coordinator.service.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";
import type { FileChangeEvent } from "../types/file-watcher.js";
import type { PackageInfo } from "../types/package.js";

export interface IncrementalAnalyzerConfig {
  neo4jClient: Neo4jClient;
  packages: PackageInfo[];
  workspaceRoot: string;
}

/**
 * Incremental analyzer for single-file changes
 *
 * Uses POC's two-phase architecture:
 * 1. Structural phase (Babel, <50ms) - immediate feedback
 * 2. Semantic phase (ts-morph, deferred) - background resolution
 *
 * Only handles TypeScript/JavaScript files.
 * Other languages fall through to existing parser.
 */
export class IncrementalAnalyzer {
  private structuralParser: StructuralParser;
  private coordinator: ValidationCoordinatorService | null = null;
  private isInitialized = false;

  constructor(private config: IncrementalAnalyzerConfig) {
    this.structuralParser = new StructuralParser();
  }

  /**
   * Check if this analyzer can handle the given file
   */
  canHandle(filePath: string): boolean {
    const ext = filePath.split(".").pop()?.toLowerCase();
    return ["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext || "");
  }

  /**
   * Initialize the validation coordinator
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Create ImportResolver (minimal implementation for now)
    const importResolver = {
      resolveImport: (importPath: string, fromFile: string) => {
        // Delegate to existing resolution logic
        return null;  // TODO: Implement proper resolution
      },
      resolveModuleSpecifier: (specifier: string, containingFile: string) => {
        return null;
      }
    };

    this.coordinator = new ValidationCoordinatorService(
      this.config.neo4jClient,
      this.structuralParser,
      importResolver,
      this.config.packages
    );

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
}
```

**Checklist**:
- [ ] Create `src/devac/integration/incremental-analyzer.ts`
- [ ] Add unit tests for `IncrementalAnalyzer`
- [ ] Verify coordinator lifecycle management

#### 2.2 Integrate with CodeGraphService

**Task 2.2.1**: Modify `src/devac/services/codegraph/codegraph-service.ts`

Add incremental analysis path for TypeScript/JavaScript files:

```typescript
// In codegraph-service.ts

import { IncrementalAnalyzer } from "../integration/incremental-analyzer.js";

export class CodeGraphService extends BaseService {
  private incrementalAnalyzer: IncrementalAnalyzer | null = null;
  private useIncrementalForTS = false;  // Feature flag

  // In constructor or initialize method
  private async initializeIncrementalAnalyzer(): Promise<void> {
    if (!this.useIncrementalForTS) return;

    this.incrementalAnalyzer = new IncrementalAnalyzer({
      neo4jClient: this.neo4jClient,
      packages: await this.discoverPackages(),
      workspaceRoot: this.config.workspaceRoot
    });

    await this.incrementalAnalyzer.initialize();
  }

  // Modify process method
  protected async process(input: any): Promise<ServiceOutput> {
    const event = input as FileChangeEvent;

    // Check if incremental analysis is available and can handle this file
    if (
      this.useIncrementalForTS &&
      this.incrementalAnalyzer?.canHandle(event.path)
    ) {
      // Use fast incremental path for TS/JS
      await this.incrementalAnalyzer.handleFileChange(event);
      return {
        success: true,
        message: `Incremental analysis: ${event.path}`,
        data: { mode: "incremental" }
      };
    }

    // Fall back to full analysis for other languages or when incremental disabled
    await this.analyzerService.analyze(primaryDirectory, {
      ignorePatterns: serviceConfig.ignore,
      supportedExtensions: serviceConfig.extensions,
    });

    return {
      success: true,
      message: `Full analysis complete`,
      data: { mode: "full" }
    };
  }
}
```

**Checklist**:
- [ ] Add `IncrementalAnalyzer` to `CodeGraphService`
- [ ] Add feature flag `useIncrementalForTS`
- [ ] Implement `canHandle` check in process method
- [ ] Add fallback to full analysis
- [ ] Add integration tests

#### 2.3 Add Neo4j Schema Extensions

**Task 2.3.1**: Update `src/database/schema.ts`

Add structural/semantic completion flags:

```typescript
// Add to CONSTRAINTS_AND_INDEXES array in schema.ts

// Structural completion tracking
{
  type: "index",
  label: "File",
  property: "structuralComplete",
  name: "file_structural_complete_idx"
},
{
  type: "index",
  label: "File",
  property: "semanticComplete",
  name: "file_semantic_complete_idx"
},
{
  type: "index",
  label: "File",
  property: "semanticQueued",
  name: "file_semantic_queued_idx"
},
```

**Task 2.3.2**: Create schema migration script

```typescript
// src/database/migrations/001-add-semantic-flags.ts

export async function migrate(neo4jClient: Neo4jClient): Promise<void> {
  // Add structuralComplete flag (default: false for existing files)
  await neo4jClient.runTransaction(
    `MATCH (f:File)
     WHERE f.structuralComplete IS NULL
     SET f.structuralComplete = true,
         f.semanticComplete = true,
         f.semanticQueued = false`,
    {},
    "WRITE",
    "Migration-AddSemanticFlags"
  );
}
```

**Checklist**:
- [ ] Update `schema.ts` with new indexes
- [ ] Create migration script
- [ ] Test migration on existing database
- [ ] Document schema changes

#### 2.4 Wire StorageManager Updates

**Task 2.4.1**: Modify `src/analyzer/storage-manager.ts`

Add methods for structural/semantic status updates:

```typescript
// Add to StorageManager class

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
```

**Checklist**:
- [ ] Add `markStructuralComplete` method
- [ ] Add `markSemanticQueued` method
- [ ] Add `markSemanticComplete` method
- [ ] Add unit tests for new methods
- [ ] Update GraphUpdaterActor to use these methods

---

### Phase 3: Ensure Multi-Language Support (Weeks 3-4)

**Goal**: Verify all 8 supported languages continue to work with the integrated architecture.

#### 3.1 Language Support Matrix

| Language | Parser | Status | Integration Path |
|----------|--------|--------|------------------|
| TypeScript | StructuralParser (Babel) | NEW | Incremental |
| JavaScript | StructuralParser (Babel) | NEW | Incremental |
| Python | PythonAstParser | Existing | Full analysis |
| Java | JavaParser (tree-sitter) | Existing | Full analysis |
| Go | GoParser (tree-sitter) | Existing | Full analysis |
| C/C++ | CCppParser (tree-sitter) | Existing | Full analysis |
| C# | CSharpParser (tree-sitter) | Existing | Full analysis |
| SQL | SqlParser (tree-sitter) | Existing (disabled) | Full analysis |

**Key Principle**: The POC only accelerates TypeScript/JavaScript. All other languages use existing parsers unchanged.

#### 3.2 Create Multi-Language Integration Tests

**Task 3.2.1**: Create `src/devac/integration/__tests__/multi-language.integration.spec.ts`

```typescript
import { IncrementalAnalyzer } from "../incremental-analyzer.js";
import { AnalyzerService } from "../../../analyzer/analyzer-service.js";
import { createTestNeo4jClient } from "../../../../test/helpers/neo4j-test-client.js";

describe("Multi-Language Integration", () => {
  const testFiles = {
    typescript: "test-fixtures/sample.ts",
    javascript: "test-fixtures/sample.js",
    python: "test-fixtures/sample.py",
    java: "test-fixtures/Sample.java",
    go: "test-fixtures/sample.go",
    cpp: "test-fixtures/sample.cpp",
    csharp: "test-fixtures/Sample.cs",
  };

  describe("IncrementalAnalyzer routing", () => {
    let analyzer: IncrementalAnalyzer;

    beforeEach(() => {
      analyzer = new IncrementalAnalyzer({
        neo4jClient: createTestNeo4jClient(),
        packages: [],
        workspaceRoot: process.cwd()
      });
    });

    it("should handle TypeScript files", () => {
      expect(analyzer.canHandle(testFiles.typescript)).toBe(true);
    });

    it("should handle JavaScript files", () => {
      expect(analyzer.canHandle(testFiles.javascript)).toBe(true);
    });

    it("should NOT handle Python files", () => {
      expect(analyzer.canHandle(testFiles.python)).toBe(false);
    });

    it("should NOT handle Java files", () => {
      expect(analyzer.canHandle(testFiles.java)).toBe(false);
    });

    it("should NOT handle Go files", () => {
      expect(analyzer.canHandle(testFiles.go)).toBe(false);
    });

    it("should NOT handle C++ files", () => {
      expect(analyzer.canHandle(testFiles.cpp)).toBe(false);
    });

    it("should NOT handle C# files", () => {
      expect(analyzer.canHandle(testFiles.csharp)).toBe(false);
    });
  });

  describe("Full analysis for non-TS languages", () => {
    let analyzerService: AnalyzerService;

    beforeAll(async () => {
      analyzerService = new AnalyzerService(/* ... */);
    });

    it("should parse Python files correctly", async () => {
      const result = await analyzerService.analyze("test-fixtures", {
        supportedExtensions: [".py"]
      });

      expect(result.nodes.some(n => n.language === "Python")).toBe(true);
    });

    it("should parse Java files correctly", async () => {
      const result = await analyzerService.analyze("test-fixtures", {
        supportedExtensions: [".java"]
      });

      expect(result.nodes.some(n => n.language === "Java")).toBe(true);
    });

    // Similar tests for other languages...
  });

  describe("Mixed language codebase", () => {
    it("should handle codebase with all supported languages", async () => {
      // Test that a codebase with TS, PY, Java, Go, etc. all parse correctly
      const result = await analyzerService.analyze("test-fixtures/multi-lang");

      const languageCounts = new Map<string, number>();
      for (const node of result.nodes) {
        const count = languageCounts.get(node.language) || 0;
        languageCounts.set(node.language, count + 1);
      }

      expect(languageCounts.get("TypeScript")).toBeGreaterThan(0);
      expect(languageCounts.get("Python")).toBeGreaterThan(0);
      expect(languageCounts.get("Java")).toBeGreaterThan(0);
      // ... etc
    });
  });
});
```

**Checklist**:
- [ ] Create test fixture files for each language
- [ ] Create multi-language integration test suite
- [ ] Verify `canHandle` routing is correct
- [ ] Verify full analysis still works for non-TS languages
- [ ] Verify mixed codebases parse correctly

#### 3.3 Document Multi-Language Behavior

**Task 3.3.1**: Update CLAUDE.md with multi-language section

```markdown
### Multi-Language Support with Incremental Analysis

CodeGraph supports 8 programming languages:

| Language | Incremental (Fast) | Full Analysis | Notes |
|----------|-------------------|---------------|-------|
| TypeScript | Yes (<50ms) | Yes | Uses Babel structural parser |
| JavaScript | Yes (<50ms) | Yes | Uses Babel structural parser |
| Python | No | Yes | Uses Python AST subprocess |
| Java | No | Yes | Uses tree-sitter |
| Go | No | Yes | Uses tree-sitter |
| C/C++ | No | Yes | Uses tree-sitter |
| C# | No | Yes | Uses tree-sitter |
| SQL | No | Yes (disabled) | Uses tree-sitter |

**When is incremental analysis used?**
- File change detected by watcher
- File is TypeScript or JavaScript
- Feature flag `useIncrementalForTS` is enabled

**When does full analysis run?**
- Non-TS/JS file changes
- Initial codebase scan
- Manual `analyze` command
- Incremental feature flag disabled
```

---

### Phase 4: Validation and Hardening (Weeks 4-5)

**Goal**: Comprehensive testing and performance validation.

#### 4.1 End-to-End Testing

**Task 4.1.1**: Create E2E test suite

```typescript
// src/devac/integration/__tests__/e2e.integration.spec.ts

describe("E2E: File Change → Graph Update", () => {
  it("should update graph within 50ms for TS file structural change", async () => {
    // 1. Create test file
    // 2. Start file watcher
    // 3. Modify file
    // 4. Measure time to graph update
    // 5. Assert < 50ms
  });

  it("should queue semantic resolution after structural update", async () => {
    // 1. Modify TS file
    // 2. Verify structuralComplete = true
    // 3. Verify semanticQueued = true
    // 4. Wait for semantic batch
    // 5. Verify semanticComplete = true
  });

  it("should fall back to full analysis for Python files", async () => {
    // 1. Modify Python file
    // 2. Verify full analysis runs (not incremental)
    // 3. Verify Python nodes in graph
  });
});
```

**Checklist**:
- [ ] Create E2E test suite
- [ ] Add performance assertions
- [ ] Add semantic resolution tests
- [ ] Add fallback behavior tests

#### 4.2 Performance Benchmarks

**Task 4.2.1**: Create performance benchmark suite

```typescript
// src/devac/integration/__tests__/performance.bench.ts

describe("Performance Benchmarks", () => {
  it("structural parse should complete in <50ms", async () => {
    const parser = new StructuralParser();

    for (const file of testFiles) {
      const start = performance.now();
      await parser.parseStructural(file);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
    }
  });

  it("should handle 100 rapid file changes", async () => {
    // Simulate rapid typing / save-all
    for (let i = 0; i < 100; i++) {
      coordinator.send({
        type: "FILE_CHANGED",
        event: { path: testFiles[i % 10], type: "change" }
      });
    }

    // Verify queue doesn't overflow
    // Verify all files eventually processed
  });
});
```

**Checklist**:
- [ ] Create performance benchmark suite
- [ ] Benchmark structural parsing (<50ms target)
- [ ] Benchmark semantic batch processing
- [ ] Benchmark rapid file change handling
- [ ] Document results

#### 4.3 Error Recovery Testing

**Task 4.3.1**: Test degraded mode and recovery

```typescript
describe("Error Recovery", () => {
  it("should enter degraded mode on Neo4j connection failure", async () => {
    // Simulate connection failure
    // Verify degraded state
    // Verify auto-recovery after 60s
  });

  it("should continue queuing files in degraded mode", async () => {
    // Enter degraded mode
    // Send file changes
    // Recover
    // Verify queued files processed
  });

  it("should mark files for retry on semantic batch failure", async () => {
    // Cause semantic resolution to fail
    // Verify semanticRetryNeeded = true
    // Verify retry happens after 5 minutes
  });
});
```

**Checklist**:
- [ ] Test degraded mode entry
- [ ] Test auto-recovery
- [ ] Test queue persistence during degraded mode
- [ ] Test semantic retry mechanism

---

## Implementation Checklist Summary

### Week 1: Fix Type Errors
- [ ] Create `src/devac/types/file-watcher.ts`
- [ ] Create `src/devac/types/package.ts`
- [ ] Update `src/devac/types/index.ts`
- [ ] Fix imports in `validation-coordinator.actor.ts`
- [ ] Fix imports in `validation-coordinator.service.ts`
- [ ] Create `ImportResolver` interface
- [ ] Install `@types/babel__traverse`
- [ ] Fix Babel traverse callback types
- [ ] Fix XState v5 action/guard string references
- [ ] Fix event type narrowing issues
- [ ] Fix `semantic-resolver.ts` type issues
- [ ] Fix `semantic-resolver.actor.ts` type issues
- [ ] Verify: `tsc --noEmit` → 0 errors
- [ ] Verify: `npm test` → 707+ tests passing

### Week 2-3: Wire POC into Production
- [ ] Create `IncrementalAnalyzer` integration class
- [ ] Modify `CodeGraphService` with incremental path
- [ ] Add feature flag for incremental analysis
- [ ] Update Neo4j schema with semantic flags
- [ ] Create schema migration script
- [ ] Add `StorageManager` status methods
- [ ] Wire `GraphUpdaterActor` to `StorageManager`
- [ ] Integration tests for new code paths

### Week 3-4: Multi-Language Support
- [ ] Create multi-language test fixtures
- [ ] Create multi-language integration tests
- [ ] Verify `canHandle` routing
- [ ] Verify full analysis fallback
- [ ] Verify mixed codebase handling
- [ ] Update documentation

### Week 4-5: Validation and Hardening
- [ ] Create E2E test suite
- [ ] Create performance benchmarks
- [ ] Test degraded mode and recovery
- [ ] Performance validation (<50ms structural)
- [ ] Memory profiling
- [ ] Final documentation updates

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Type fixes break existing tests | Medium | Medium | Run full test suite after each change |
| Integration breaks multi-language | Low | High | Explicit canHandle check; fallback to full analysis |
| XState v5 patterns incorrect | Medium | Medium | Review XState v5 docs; test actor lifecycle |
| Performance regression | Low | Medium | Benchmark continuously; rollback if needed |
| Neo4j schema migration fails | Low | High | Test migration on dev database first |

---

## Success Criteria

### Phase 1 Complete
- [ ] `tsc --noEmit` produces 0 errors
- [ ] `npm run build` succeeds
- [ ] 707+ tests passing

### Phase 2 Complete
- [ ] Incremental analysis works for TS/JS files
- [ ] Feature flag controls behavior
- [ ] Neo4j schema updated

### Phase 3 Complete
- [ ] All 8 languages still parse correctly
- [ ] Multi-language integration tests pass
- [ ] Documentation updated

### Phase 4 Complete (v9 Done)
- [ ] E2E tests passing
- [ ] Performance targets met (<50ms structural)
- [ ] Error recovery tested
- [ ] Production-ready

---

## Appendix: File Reference

### Files to Create
- `src/devac/types/file-watcher.ts`
- `src/devac/types/package.ts`
- `src/devac/integration/incremental-analyzer.ts`
- `src/database/migrations/001-add-semantic-flags.ts`
- `src/devac/integration/__tests__/multi-language.integration.spec.ts`
- `src/devac/integration/__tests__/e2e.integration.spec.ts`
- `src/devac/integration/__tests__/performance.bench.ts`

### Files to Modify
- `src/devac/types/index.ts` - Add exports
- `src/devac/actors/validation-coordinator.actor.ts` - Fix imports and types
- `src/devac/services/validation-coordinator.service.ts` - Fix imports and types
- `src/devac/actors/graph-updater.actor.ts` - Fix event types
- `src/devac/actors/semantic-resolver.actor.ts` - Fix event types
- `src/devac/actors/affected-calculator.actor.ts` - Fix event types
- `src/devac/actors/script-executor.actor.ts` - Fix event types
- `src/analyzer/structural-parser.ts` - Fix Babel traverse types
- `src/analyzer/semantic-resolver.ts` - Fix type issues
- `src/devac/services/codegraph/codegraph-service.ts` - Add incremental path
- `src/analyzer/storage-manager.ts` - Add status methods
- `src/database/schema.ts` - Add semantic indexes

### Files Unchanged (Multi-Language Parsers)
- `src/analyzer/parsers/python-parser.ts`
- `src/analyzer/parsers/java-parser.ts`
- `src/analyzer/parsers/go-parser.ts`
- `src/analyzer/parsers/c-cpp-parser.ts`
- `src/analyzer/parsers/csharp-parser.ts`
- `src/analyzer/parsers/sql-parser.ts`
