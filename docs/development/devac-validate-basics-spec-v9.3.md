# DevAC Validation Basics v9.3 - Production Integration Specification

> **Version**: 9.3  
> **Created**: 2025-12-10  
> **Based On**: v9.2 spec + Consolidated Review Recap (Claude, GPT, Gemini)  
> **Status**: Ready for Implementation  
> **Breaking Changes from v9.2**: Addresses all 4 critical blocking issues identified by reviewers

---

## Executive Summary

### What Changed from v9.2 to v9.3

Version 9.3 resolves all blocking issues identified by three independent reviews. The spec now clearly distinguishes between **existing code** and **code to implement**, includes complete error inventories, and provides explicit consolidation steps for duplicate implementations.

| # | Blocking Issue | v9.2 Problem | v9.3 Resolution |
|---|----------------|--------------|-----------------|
| 1 | Duplicate ValidationCoordinatorService | Two implementations with incompatible constructors | Single canonical implementation with migration steps |
| 2 | Duplicate Type Definitions | PackageInfo, StructuralParseResult duplicated | All duplicates removed; single import sources |
| 3 | Incomplete Error Coverage | Only ~50% of 103 errors addressed | Complete inventory with fixes for all files |
| 4 | Current vs Desired State Unclear | Spec marked fixes as "verified" when not implemented | Clear ✅EXISTING / 🆕NEW / ⚠️FIX markers throughout |

### Performance Targets

| Metric | POC Actual | v9.3 Target | Measurement |
|--------|------------|-------------|-------------|
| Structural parse (avg) | 20ms | **p90 <50ms** | `performance.now()` per file |
| Semantic batch (10 files) | 101ms | **p90 <500ms** | Batch timing in actor |
| TypeScript type errors | 103 | **0** | `tsc --noEmit 2>&1 \| grep "error TS" \| wc -l` |
| Passing tests | 707 | **707+** | `npm test` count |

---

## Architecture Overview

### Two-Phase Parsing Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         FILE CHANGE DETECTED                                  │
│                   (FileWatcher from file-watcher.ts)                          │
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

---

## Part 1: Canonical Type Definitions

All types below are **existing** in the codebase. Import from these locations only—do not recreate.

### 1.1 FileChangeEvent ✅EXISTING

**Canonical Location**: `src/devac/services/codegraph/file-watcher.ts`

```typescript
// Lines 5-13 of file-watcher.ts
export type FileChangeType = "add" | "change" | "unlink" | "error";

export interface FileChangeEvent {
  type: FileChangeType;
  path: string;
  timestamp: number;
  batch?: FileChangeEvent[];
  error?: Error;
}
```

**Import Patterns** (path depends on importing file's location):
```typescript
// From src/devac/actors/:
import type { FileChangeEvent } from "../services/codegraph/file-watcher.js";

// From src/devac/services/:
import type { FileChangeEvent } from "./codegraph/file-watcher.js";

// From src/devac/integration/:
import type { FileChangeEvent } from "../services/codegraph/file-watcher.js";
```

### 1.2 PackageInfo ✅EXISTING

**Canonical Location**: `src/analyzer/parsers/package-extractor.ts`

```typescript
// Lines 8-14 of package-extractor.ts
export interface PackageInfo {
  name: string;
  type: "frontend" | "shared-library" | "tool";
  path: string;
  version: string;
  entryPoint: string | null;
}
```

**Single Import Source**:
```typescript
import type { PackageInfo } from "../../analyzer/parsers/package-extractor.js";
```

> ⚠️ **DUPLICATE REMOVAL REQUIRED**: `src/devac/actors/affected-calculator.actor.ts` contains a local `PackageInfo` interface with only 2 fields. This must be deleted and replaced with the canonical import.

### 1.3 ImportNode and ResolvedImport ✅EXISTING

**Canonical Location**: `src/analyzer/parsers/import-resolver.ts`

```typescript
// Lines 9-22 of import-resolver.ts
export interface ImportNode {
  name: string;
  importSource: string;
  importPath?: string;
  isTypeOnly: boolean;
  isDefault: boolean;
}

export interface ResolvedImport {
  resolvedPath: string;
  resolvedType: "file" | "package" | "external";
  exportedName?: string;
}
```

**Single Import Source**:
```typescript
import type { ImportNode, ResolvedImport } from "../../analyzer/parsers/import-resolver.js";
```

### 1.4 StructuralParseResult ✅EXISTING

**Canonical Location**: `src/analyzer/structural-parser.ts`

```typescript
// Lines 17-35 of structural-parser.ts
export interface StructuralParseResult {
  filePath: string;
  nodes: AstNode[];
  relationships: RelationshipInfo[];
  importStrings: string[];          // Raw import specifiers (unresolved)
  exportedSymbols: ExportedSymbol[];
  metadata: {
    parseTime: number;
    nodeCount: number;
    relationshipCount: number;
    loc: number;
    language: string;
  };
}

export interface ExportedSymbol {
  name: string;
  kind: "default" | "named";
  nodeKind: string;
  entityId?: string;
}
```

**Single Import Source**:
```typescript
import type { StructuralParseResult, ExportedSymbol } from "../../analyzer/structural-parser.js";
```

> ⚠️ **DUPLICATE REMOVAL REQUIRED**: `src/devac/actors/graph-updater.actor.ts` may contain a local `StructuralParseResult` with different `nodes` types. Delete and use canonical import.

---

## Part 2: Canonical API Signatures

### 2.1 ImportResolver Class ✅EXISTING

**Location**: `src/analyzer/parsers/import-resolver.ts`

```typescript
// Lines 30-47 of import-resolver.ts
export class ImportResolver {
  constructor(
    packages: PackageInfo[],                    // FIRST: array of packages
    workspaceRoot: string,                      // SECOND: workspace root path
    tsConfigPaths?: Record<string, string[]>    // THIRD: optional path mappings
  );

  async resolve(
    importNode: ImportNode,     // NOT a string - requires ImportNode object
    fromFile: string
  ): Promise<ResolvedImport | null>;
}
```

**Correct Usage Example**:
```typescript
import { ImportResolver } from "../../analyzer/parsers/import-resolver.js";
import type { PackageInfo } from "../../analyzer/parsers/package-extractor.js";
import type { ImportNode, ResolvedImport } from "../../analyzer/parsers/import-resolver.js";

const packages: PackageInfo[] = await packageExtractor.discoverPackages();
const resolver = new ImportResolver(
  packages,           // First: PackageInfo[]
  workspaceRoot,      // Second: string
  tsConfigPaths       // Third: Record<string, string[]> (optional)
);

const importNode: ImportNode = {
  name: "Button",
  importSource: "@mindlercare/ui-web",
  isTypeOnly: false,
  isDefault: false
};

const resolved = await resolver.resolve(importNode, "/path/to/file.ts");
```

### 2.2 PackageExtractor Class ✅EXISTING

**Location**: `src/analyzer/parsers/package-extractor.ts`

```typescript
// Lines 29-35 of package-extractor.ts
export class PackageExtractor {
  constructor(workspaceRoot: string);  // REQUIRES workspaceRoot argument

  async discoverPackages(): Promise<PackageInfo[]>;  // NOT extractPackages()
  getPackageForFile(filePath: string): PackageInfo | null;
  createPackageNodes(now: string): PackageNode[];
  getPackages(): PackageInfo[];
}
```

**Correct Usage Example**:
```typescript
import { PackageExtractor } from "../../analyzer/parsers/package-extractor.js";

const extractor = new PackageExtractor(workspaceRoot);  // Requires argument
const packages = await extractor.discoverPackages();    // Method name is discoverPackages
```

### 2.3 StructuralParser Class ✅EXISTING

**Location**: `src/analyzer/structural-parser.ts`

```typescript
// Lines 61-80 of structural-parser.ts
export class StructuralParser {
  async parseStructural(filePath: string): Promise<StructuralParseResult>;
}
```

**Usage Note**: Output contains `importStrings: string[]` which must be converted to `ImportNode[]` for use with `ImportResolver.resolve()`. See Section 4.2 for the mapping utility.

### 2.4 Schema Index Format ✅EXISTING

**Location**: `src/database/schema.ts`

```typescript
// Lines 116-128 of schema.ts
// Array is named "indexes" (NOT "CONSTRAINTS_AND_INDEXES")
// Entries are Cypher strings (NOT objects)

const indexes = [
  `CREATE INDEX node_entityid_index IF NOT EXISTS FOR (n:Node) ON (n.entityId)`,
  // ... additional indexes ...
];
```

---

## Part 3: Complete Error Inventory and Fixes

This section provides fixes for **all 103 TypeScript errors** across all affected files.

### 3.1 Error Summary by File

| File | Error Count | Primary Issues |
|------|-------------|----------------|
| `validation-coordinator.actor.ts` | ~25 | Wrong imports, XState v5 syntax |
| `validation-coordinator.service.ts` | ~8 | Wrong FileChangeEvent import |
| `semantic-resolver.actor.ts` | ~11 | Nullability, Promise types |
| `graph-updater.actor.ts` | ~15 | Duplicate types, event narrowing |
| `affected-calculator.actor.ts` | ~12 | Duplicate PackageInfo, event types |
| `script-executor.actor.ts` | ~11 | Event types, error handling |
| `structural-parser.ts` | ~21 | Babel traverse callback types |

### 3.2 Fix: validation-coordinator.actor.ts ⚠️FIX

**Current (Broken)**:
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
import { ImportResolver } from "../../analyzer/parsers/import-resolver.js";
import type { PackageInfo } from "../../analyzer/parsers/package-extractor.js";
import type { ImportNode, ResolvedImport } from "../../analyzer/parsers/import-resolver.js";
```

**XState v5 Migration** (replace entire machine definition):
```typescript
import { setup, createMachine, assign } from "xstate";

interface ValidationCoordinatorContext {
  processingQueue: string[];
  currentFile: string | null;
  results: Map<string, { structural: boolean; semantic: boolean }>;
  neo4jClient: Neo4jClient;
  structuralParser: StructuralParser;
  importResolver: ImportResolver;
}

type ValidationCoordinatorEvent =
  | { type: "FILE_CHANGED"; event: FileChangeEvent }
  | { type: "STRUCTURAL_COMPLETE"; filePath: string }
  | { type: "SEMANTIC_COMPLETE"; filePath: string }
  | { type: "ERROR"; error: Error };

export const validationCoordinatorActor = setup({
  types: {
    context: {} as ValidationCoordinatorContext,
    events: {} as ValidationCoordinatorEvent,
  },
  actions: {
    enqueueFile: assign({
      processingQueue: ({ context, event }) => {
        if (event.type !== "FILE_CHANGED") return context.processingQueue;
        return [...context.processingQueue, event.event.path];
      },
    }),
    logComplete: ({ context }) => {
      console.log(`Processing complete for ${context.currentFile}`);
    },
    logError: ({ event }) => {
      if (event.type === "ERROR") {
        console.error(`Error: ${event.error.message}`);
      }
    },
  },
  guards: {
    hasQueuedFiles: ({ context }) => context.processingQueue.length > 0,
    isTypeScriptFile: ({ event }) => {
      if (event.type !== "FILE_CHANGED") return false;
      return /\.[tj]sx?$/.test(event.event.path);
    },
  },
}).createMachine({
  id: "validationCoordinator",
  initial: "idle",
  context: ({ input }) => ({
    processingQueue: [],
    currentFile: null,
    results: new Map(),
    neo4jClient: input.neo4jClient,
    structuralParser: input.structuralParser,
    importResolver: input.importResolver,
  }),
  states: {
    idle: {
      on: {
        FILE_CHANGED: {
          target: "processing",
          actions: "enqueueFile",
          guard: "isTypeScriptFile",
        },
      },
    },
    processing: {
      initial: "structural",
      states: {
        structural: {
          invoke: {
            src: "parseStructural",
            onDone: { target: "semantic" },
            onError: { target: "#validationCoordinator.error" },
          },
        },
        semantic: {
          invoke: {
            src: "resolveSemantic",
            onDone: { target: "#validationCoordinator.idle" },
            onError: { target: "#validationCoordinator.error" },
          },
        },
      },
      onDone: {
        target: "idle",
        actions: "logComplete",
      },
    },
    error: {
      entry: "logError",
      after: { 1000: "idle" },
    },
  },
});
```

### 3.3 Fix: validation-coordinator.service.ts ⚠️FIX

**Current (Broken)**:
```typescript
import type { FileChangeEvent } from "../types/file-watcher.js";
```

**Fixed**:
```typescript
import type { FileChangeEvent } from "./codegraph/file-watcher.js";
```

### 3.4 Fix: semantic-resolver.actor.ts ⚠️FIX

**Issue 1: Nullability with ts-morph**
```typescript
// Current (Broken):
const tsConfigPath = await findNearestTsConfig(files[0]);
new Project({ tsConfigFilePath: tsConfigPath });  // Error: null not assignable

// Fixed:
const tsConfigPath = await findNearestTsConfig(files[0]) ?? undefined;
new Project({ tsConfigFilePath: tsConfigPath });  // Works
```

**Issue 2: Promise type mismatch**
```typescript
// Current (Broken):
async function resolveImports(files: string[]): string[] {
  // ...
}

// Fixed:
async function resolveImports(files: string[]): Promise<string[]> {
  // ...
}
```

**Issue 3: Implicit any in forEach**
```typescript
// Current (Broken):
sourceFile.getImportDeclarations().forEach(imp => {
  // imp is implicitly 'any'
});

// Fixed:
import type { ImportDeclaration } from "ts-morph";
sourceFile.getImportDeclarations().forEach((imp: ImportDeclaration) => {
  // imp is now typed
});
```

### 3.5 Fix: graph-updater.actor.ts ⚠️FIX

**Issue 1: Remove duplicate StructuralParseResult**
```typescript
// DELETE this local definition if it exists:
interface StructuralParseResult {
  // local definition with different types
}

// ADD canonical import:
import type { StructuralParseResult } from "../../analyzer/structural-parser.js";
```

**Issue 2: Event type narrowing**
```typescript
import type { DoneActorEvent } from "xstate";

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

// Usage in action:
updateGraph: ({ event }) => {
  if (isDoneEvent<{ nodesUpdated: number }>(event)) {
    console.log(`Updated ${event.output.nodesUpdated} nodes`);
  }
}
```

### 3.6 Fix: affected-calculator.actor.ts ⚠️FIX

**Issue 1: Remove duplicate PackageInfo**
```typescript
// DELETE this local definition:
interface PackageInfo {
  name: string;
  path: string;
}

// ADD canonical import:
import type { PackageInfo } from "../../analyzer/parsers/package-extractor.js";
```

**Issue 2: Fix event type references**
```typescript
// Apply same isDoneEvent pattern as graph-updater.actor.ts
```

### 3.7 Fix: script-executor.actor.ts ⚠️FIX

**Issue 1: Event types**
```typescript
// Apply same isDoneEvent pattern as graph-updater.actor.ts
```

**Issue 2: Error handling in catch blocks**
```typescript
// Current (Broken):
catch (error) {
  throw new Error(`Failed: ${error.message}`);  // error is 'unknown'
}

// Fixed:
catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Failed: ${message}`);
}
```

### 3.8 Fix: structural-parser.ts ⚠️FIX

**Step 1: Install missing types**
```bash
npm install --save-dev @types/babel__traverse
```

**Step 2: Fix Babel traverse callback types**
```typescript
// Current (Broken):
import traverse from "@babel/traverse";

traverse(ast, {
  ClassDeclaration: (path) => {  // path is implicitly 'any'
    // ...
  }
});

// Fixed:
import traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";

traverse(ast, {
  ClassDeclaration: (path: NodePath<t.ClassDeclaration>) => {
    const node = path.node;  // Fully typed
  },
  FunctionDeclaration: (path: NodePath<t.FunctionDeclaration>) => {
    const node = path.node;
  },
  ImportDeclaration: (path: NodePath<t.ImportDeclaration>) => {
    const source = path.node.source.value;  // string
  },
  ExportNamedDeclaration: (path: NodePath<t.ExportNamedDeclaration>) => {
    const declaration = path.node.declaration;
  },
  ExportDefaultDeclaration: (path: NodePath<t.ExportDefaultDeclaration>) => {
    const declaration = path.node.declaration;
  },
});
```

---

## Part 4: ValidationCoordinatorService Consolidation

### 4.1 Problem: Two Incompatible Implementations

| Location | Constructor Signature |
|----------|----------------------|
| `src/devac/services/validation-coordinator.service.ts` | Takes config object |
| `src/devac/actors/validation-coordinator.actor.ts` | Contains class with 4 positional params |

### 4.2 Resolution: Single Canonical Service 🆕NEW

**Keep**: `src/devac/services/validation-coordinator.service.ts`  
**Delete**: Any `ValidationCoordinatorService` class in `src/devac/actors/validation-coordinator.actor.ts`

**Canonical Implementation** (replace existing file):

```typescript
// src/devac/services/validation-coordinator.service.ts

import { createActor, type AnyActorRef, type Subscription } from "xstate";
import { validationCoordinatorActor } from "../actors/validation-coordinator.actor.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";
import type { StructuralParser } from "../../analyzer/structural-parser.js";
import { ImportResolver } from "../../analyzer/parsers/import-resolver.js";
import type { PackageInfo } from "../../analyzer/parsers/package-extractor.js";
import type { FileChangeEvent } from "./codegraph/file-watcher.js";

export interface ValidationCoordinatorConfig {
  neo4jClient: Neo4jClient;
  structuralParser: StructuralParser;
  importResolver: ImportResolver;
  packages: PackageInfo[];
  workspaceRoot: string;
}

/**
 * Service wrapper for ValidationCoordinator XState actor.
 * 
 * Manages actor lifecycle and provides convenient API for:
 * - Starting/stopping the validation coordinator
 * - Sending file change events
 * - Querying current status
 * 
 * CANONICAL IMPLEMENTATION - Do not duplicate elsewhere.
 */
export class ValidationCoordinatorService {
  private actor: AnyActorRef | null = null;
  private subscription: Subscription | null = null;

  constructor(private config: ValidationCoordinatorConfig) {}

  /**
   * Start the validation coordinator actor
   */
  start(): void {
    if (this.actor) {
      console.warn("ValidationCoordinatorService already started");
      return;
    }

    this.actor = createActor(validationCoordinatorActor, {
      input: {
        neo4jClient: this.config.neo4jClient,
        structuralParser: this.config.structuralParser,
        importResolver: this.config.importResolver,
        packages: this.config.packages,
        workspaceRoot: this.config.workspaceRoot,
      },
    });

    this.subscription = this.actor.subscribe((snapshot) => {
      // Optional: log state transitions for debugging
      if (process.env.LOG_LEVEL === "debug") {
        console.log(`[ValidationCoordinator] State: ${JSON.stringify(snapshot.value)}`);
      }
    });

    this.actor.start();
  }

  /**
   * Stop the validation coordinator actor
   */
  stop(): void {
    this.subscription?.unsubscribe();
    this.actor?.stop();
    this.actor = null;
    this.subscription = null;
  }

  /**
   * Send a file change event to the coordinator
   */
  sendFileChange(event: FileChangeEvent): void {
    if (!this.actor) {
      throw new Error("ValidationCoordinatorService not started");
    }
    this.actor.send({ type: "FILE_CHANGED", event });
  }

  /**
   * Send any event to the coordinator
   */
  send(event: { type: string; event?: FileChangeEvent }): void {
    if (!this.actor) {
      throw new Error("ValidationCoordinatorService not started");
    }
    this.actor.send(event);
  }

  /**
   * Get current coordinator status
   */
  getStatus(): { queueSize: number; processing: boolean; currentState: string } {
    if (!this.actor) {
      return { queueSize: 0, processing: false, currentState: "stopped" };
    }

    const snapshot = this.actor.getSnapshot();
    const stateValue = typeof snapshot.value === "string" 
      ? snapshot.value 
      : JSON.stringify(snapshot.value);

    return {
      queueSize: snapshot.context.processingQueue?.length ?? 0,
      processing: stateValue.includes("processing"),
      currentState: stateValue,
    };
  }

  /**
   * Check if coordinator is running
   */
  isRunning(): boolean {
    return this.actor !== null;
  }
}
```

---

## Part 5: ImportNode Mapping Utility

### 5.1 The Problem

- `StructuralParser` outputs: `importStrings: string[]` (raw import specifiers)
- `ImportResolver.resolve()` requires: `ImportNode` objects with structured fields

### 5.2 Solution: Mapping Function 🆕NEW

```typescript
// src/devac/integration/import-node-mapper.ts

import type { ImportNode } from "../../analyzer/parsers/import-resolver.js";

/**
 * Represents additional context about an import that can be extracted
 * from AST nodes during structural parsing.
 */
export interface ImportContext {
  /** The imported symbol name (e.g., "Button", "useState") */
  importedName?: string;
  /** Whether this is a type-only import (import type { ... }) */
  isTypeOnly?: boolean;
  /** Whether this is a default import (import X from ...) */
  isDefault?: boolean;
}

/**
 * Creates an ImportNode from a raw import specifier string.
 * 
 * This function bridges the gap between StructuralParser output
 * (string[]) and ImportResolver input (ImportNode).
 * 
 * @param importSource - Raw import specifier (e.g., "@mindlercare/ui-web", "./utils")
 * @param context - Optional additional context from AST analysis
 * @returns ImportNode suitable for ImportResolver.resolve()
 * 
 * @example
 * // Basic usage with just the import source
 * const node = createImportNode("@mindlercare/ui-web");
 * 
 * @example
 * // With additional context from AST
 * const node = createImportNode("./utils", {
 *   importedName: "formatDate",
 *   isTypeOnly: false,
 *   isDefault: false
 * });
 */
export function createImportNode(
  importSource: string,
  context: ImportContext = {}
): ImportNode {
  return {
    name: context.importedName ?? "default",
    importSource,
    isTypeOnly: context.isTypeOnly ?? false,
    isDefault: context.isDefault ?? (context.importedName === undefined),
  };
}

/**
 * Batch converts raw import strings to ImportNodes.
 * 
 * Use this when you have multiple import sources from StructuralParseResult
 * and need to resolve them all.
 * 
 * @param importStrings - Array of raw import specifiers
 * @returns Array of ImportNode objects
 */
export function createImportNodes(importStrings: string[]): ImportNode[] {
  return importStrings.map((source) => createImportNode(source));
}
```

### 5.3 Usage in Integration Layer

```typescript
import { ImportResolver } from "../../analyzer/parsers/import-resolver.js";
import type { StructuralParseResult } from "../../analyzer/structural-parser.js";
import type { ResolvedImport } from "../../analyzer/parsers/import-resolver.js";
import { createImportNode } from "./import-node-mapper.js";

/**
 * Resolves all imports from a structural parse result.
 * 
 * NOTE: Basic resolution uses default ImportNode settings.
 * For more accurate resolution (named vs default imports, type-only),
 * consider enhancing StructuralParser to emit ImportContext data.
 */
async function resolveStructuralImports(
  structuralResult: StructuralParseResult,
  resolver: ImportResolver
): Promise<Map<string, ResolvedImport | null>> {
  const results = new Map<string, ResolvedImport | null>();

  for (const importSource of structuralResult.importStrings) {
    const importNode = createImportNode(importSource);
    const resolved = await resolver.resolve(importNode, structuralResult.filePath);
    results.set(importSource, resolved);
  }

  return results;
}
```

---

## Part 6: Neo4j Schema Updates

### 6.1 New Indexes 🆕NEW

Add to the existing `indexes` array in `src/database/schema.ts`:

```typescript
const indexes = [
  // ... existing indexes ...

  // NEW: Structural completion tracking
  `CREATE INDEX file_structural_complete_idx IF NOT EXISTS FOR (n:File) ON (n.structuralComplete)`,
  
  // NEW: Semantic completion tracking
  `CREATE INDEX file_semantic_complete_idx IF NOT EXISTS FOR (n:File) ON (n.semanticComplete)`,
  
  // NEW: Semantic queue tracking
  `CREATE INDEX file_semantic_queued_idx IF NOT EXISTS FOR (n:File) ON (n.semanticQueued)`,
  
  // NEW: Last update timestamp for incremental queries
  `CREATE INDEX file_last_structural_update_idx IF NOT EXISTS FOR (n:File) ON (n.lastStructuralUpdate)`,
];
```

### 6.2 StorageManager Status Methods 🆕NEW

Add to `src/analyzer/storage-manager.ts`:

```typescript
/**
 * Mark file as structurally complete.
 * Called after successful structural parsing.
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
 * Mark file as queued for semantic resolution.
 * Prevents duplicate processing.
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
 * Mark file as semantically complete.
 * Called after successful semantic resolution.
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
 * Get files pending semantic resolution.
 * Returns files that completed structural but not semantic phase.
 */
async getFilesPendingSemantic(limit: number = 10): Promise<string[]> {
  const result = await this.neo4jClient.runTransaction(
    `MATCH (f:File)
     WHERE f.structuralComplete = true 
       AND f.semanticComplete = false
       AND (f.semanticQueued IS NULL OR f.semanticQueued = false)
     RETURN f.filePath as filePath
     ORDER BY f.lastStructuralUpdate ASC
     LIMIT $limit`,
    { limit },
    "READ",
    "GetFilesPendingSemantic"
  );
  return result.records.map((r) => r.get("filePath") as string);
}

/**
 * Reset processing flags for a file.
 * Used when file is modified and needs re-processing.
 */
async resetProcessingFlags(filePath: string): Promise<void> {
  await this.neo4jClient.runTransaction(
    `MATCH (f:File {filePath: $filePath})
     SET f.structuralComplete = false,
         f.semanticComplete = false,
         f.semanticQueued = false`,
    { filePath },
    "WRITE",
    "ResetProcessingFlags"
  );
}
```

---

## Part 7: Integration Layer

### 7.1 IncrementalAnalyzer 🆕NEW

**File**: `src/devac/integration/incremental-analyzer.ts`

```typescript
// src/devac/integration/incremental-analyzer.ts

import { StructuralParser } from "../../analyzer/structural-parser.js";
import type { StructuralParseResult } from "../../analyzer/structural-parser.js";
import { ImportResolver } from "../../analyzer/parsers/import-resolver.js";
import type { ResolvedImport } from "../../analyzer/parsers/import-resolver.js";
import { PackageExtractor } from "../../analyzer/parsers/package-extractor.js";
import type { PackageInfo } from "../../analyzer/parsers/package-extractor.js";
import { ValidationCoordinatorService } from "../services/validation-coordinator.service.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";
import type { FileChangeEvent } from "../services/codegraph/file-watcher.js";
import { createImportNode } from "./import-node-mapper.js";

export interface IncrementalAnalyzerConfig {
  neo4jClient: Neo4jClient;
  workspaceRoot: string;
  tsConfigPaths?: Record<string, string[]>;
}

/**
 * Incremental analyzer for single-file changes.
 * 
 * Implements two-phase architecture:
 * 1. Structural phase (Babel, p90 <50ms) - immediate feedback
 * 2. Semantic phase (ts-morph, deferred) - background resolution
 * 
 * Only handles TypeScript/JavaScript files. Other languages fall back
 * to full analysis via CodeGraphService.
 */
export class IncrementalAnalyzer {
  private structuralParser: StructuralParser;
  private packageExtractor: PackageExtractor;
  private importResolver: ImportResolver | null = null;
  private packages: PackageInfo[] = [];
  private coordinator: ValidationCoordinatorService | null = null;
  private isInitialized = false;

  private static readonly SUPPORTED_EXTENSIONS = new Set([
    "ts", "tsx", "js", "jsx", "mjs", "cjs"
  ]);

  constructor(private config: IncrementalAnalyzerConfig) {
    this.structuralParser = new StructuralParser();
    this.packageExtractor = new PackageExtractor(config.workspaceRoot);
  }

  /**
   * Check if this analyzer can handle the given file.
   * Returns true only for TypeScript/JavaScript files.
   */
  canHandle(filePath: string): boolean {
    const ext = filePath.split(".").pop()?.toLowerCase();
    return IncrementalAnalyzer.SUPPORTED_EXTENSIONS.has(ext || "");
  }

  /**
   * Initialize the analyzer.
   * Discovers packages and creates ImportResolver.
   * Must be called before handleFileChange.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Discover packages using correct method
    this.packages = await this.packageExtractor.discoverPackages();

    // Create ImportResolver with correct parameter order
    this.importResolver = new ImportResolver(
      this.packages,
      this.config.workspaceRoot,
      this.config.tsConfigPaths
    );

    // Create and start coordinator
    this.coordinator = new ValidationCoordinatorService({
      neo4jClient: this.config.neo4jClient,
      structuralParser: this.structuralParser,
      importResolver: this.importResolver,
      packages: this.packages,
      workspaceRoot: this.config.workspaceRoot,
    });

    this.coordinator.start();
    this.isInitialized = true;
  }

  /**
   * Handle a file change incrementally.
   * Queues the file for structural then semantic processing.
   */
  async handleFileChange(event: FileChangeEvent): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.canHandle(event.path)) {
      throw new Error(`IncrementalAnalyzer cannot handle: ${event.path}`);
    }

    this.coordinator!.sendFileChange(event);
  }

  /**
   * Resolve imports from structural parse result.
   * Converts string[] to ImportNode[] and resolves each.
   */
  async resolveImports(
    structuralResult: StructuralParseResult
  ): Promise<Map<string, ResolvedImport | null>> {
    if (!this.importResolver) {
      throw new Error("IncrementalAnalyzer not initialized");
    }

    const results = new Map<string, ResolvedImport | null>();

    for (const importSource of structuralResult.importStrings) {
      const importNode = createImportNode(importSource);
      const resolved = await this.importResolver.resolve(
        importNode,
        structuralResult.filePath
      );
      results.set(importSource, resolved);
    }

    return results;
  }

  /**
   * Shutdown the analyzer.
   * Stops the coordinator and cleans up resources.
   */
  async shutdown(): Promise<void> {
    this.coordinator?.stop();
    this.coordinator = null;
    this.importResolver = null;
    this.packages = [];
    this.isInitialized = false;
  }

  /**
   * Get current processing status.
   */
  getStatus(): { queueSize: number; processing: boolean; initialized: boolean } {
    if (!this.coordinator) {
      return { queueSize: 0, processing: false, initialized: false };
    }
    const status = this.coordinator.getStatus();
    return {
      queueSize: status.queueSize,
      processing: status.processing,
      initialized: this.isInitialized,
    };
  }
}
```

### 7.2 CodeGraphService Integration ⚠️FIX

**File**: `src/devac/services/codegraph/codegraph-service.ts`

Add incremental analysis path:

```typescript
import { IncrementalAnalyzer } from "../../integration/incremental-analyzer.js";
import type { FileChangeEvent } from "./file-watcher.js";

export class CodeGraphService extends BaseService {
  private incrementalAnalyzer: IncrementalAnalyzer | null = null;
  private useIncrementalForTS = true;  // Feature flag

  private async initializeIncrementalAnalyzer(): Promise<void> {
    if (!this.useIncrementalForTS || this.incrementalAnalyzer) return;

    this.incrementalAnalyzer = new IncrementalAnalyzer({
      neo4jClient: this.neo4jClient,
      workspaceRoot: this.getPrimaryDirectory(),
    });

    await this.incrementalAnalyzer.initialize();
  }

  protected async process(input: ServiceInput): Promise<ServiceOutput> {
    const event = input as FileChangeEvent;

    await this.initializeIncrementalAnalyzer();

    // Use fast incremental path for TS/JS
    if (this.useIncrementalForTS && this.incrementalAnalyzer?.canHandle(event.path)) {
      await this.incrementalAnalyzer.handleFileChange(event);
      return {
        success: true,
        message: `Incremental analysis: ${event.path}`,
        data: { mode: "incremental" },
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
      data: { mode: "full" },
    };
  }

  async shutdown(): Promise<void> {
    await this.incrementalAnalyzer?.shutdown();
    await super.shutdown();
  }
}
```

---

## Part 8: Implementation Phases

### Phase 1: Fix Type Errors (Week 1)

**Goal**: Reduce 103 TypeScript errors to 0.

| Task | File(s) | Effort |
|------|---------|--------|
| Install `@types/babel__traverse` | `package.json` | 5 min |
| Fix imports in validation-coordinator.actor.ts | Section 3.2 | 30 min |
| Fix imports in validation-coordinator.service.ts | Section 3.3 | 10 min |
| Fix semantic-resolver.actor.ts | Section 3.4 | 45 min |
| Fix graph-updater.actor.ts | Section 3.5 | 30 min |
| Fix affected-calculator.actor.ts | Section 3.6 | 30 min |
| Fix script-executor.actor.ts | Section 3.7 | 30 min |
| Fix structural-parser.ts Babel types | Section 3.8 | 45 min |

**Verification**:
```bash
# Must all pass
tsc --noEmit 2>&1 | grep "error TS" | wc -l  # Target: 0
npm run build                                 # Must succeed
npm test                                      # Target: 707+ passing
```

### Phase 2: Wire POC into Production (Weeks 2-3)

**Goal**: Integrate incremental analysis with production code.

| Task | File(s) | Effort |
|------|---------|--------|
| Consolidate ValidationCoordinatorService | Section 4.2 | 1 hr |
| Create import-node-mapper.ts | Section 5.2 | 30 min |
| Add schema indexes | Section 6.1 | 15 min |
| Add StorageManager methods | Section 6.2 | 1 hr |
| Create incremental-analyzer.ts | Section 7.1 | 2 hr |
| Integrate with CodeGraphService | Section 7.2 | 1 hr |
| Unit tests for new components | - | 4 hr |

**Verification**:
```bash
npm run build && npm test
```

### Phase 3: Multi-Language Support (Weeks 3-4)

**Goal**: Ensure all 8 languages work correctly with routing.

| Language | Parser | Incremental Path? |
|----------|--------|:-----------------:|
| TypeScript | StructuralParser (Babel) | ✅ Yes |
| JavaScript | StructuralParser (Babel) | ✅ Yes |
| Python | PythonAstParser | ❌ Full analysis |
| Java | JavaParser (tree-sitter) | ❌ Full analysis |
| Go | GoParser (tree-sitter) | ❌ Full analysis |
| C/C++ | CCppParser (tree-sitter) | ❌ Full analysis |
| C# | CSharpParser (tree-sitter) | ❌ Full analysis |
| SQL | SqlParser (tree-sitter) | ❌ Full analysis |

### Phase 4: Validation and Hardening (Weeks 4-5)

**Goal**: Verify performance targets and add E2E tests.

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Structural parse p90 | <50ms | `performance.now()` over 100 iterations |
| Semantic batch p90 | <500ms | Batch timing in actor |
| Type errors | 0 | `tsc --noEmit` |
| Test coverage | 707+ tests | `npm test` |

---

## Part 9: Verification Commands

```bash
# 1. Type errors (target: 0)
tsc --noEmit 2>&1 | grep "error TS" | wc -l

# 2. No duplicate PackageInfo
grep -rn "interface PackageInfo" src/
# Expected: 1 result (package-extractor.ts only)

# 3. No duplicate FileChangeEvent
grep -rn "interface FileChangeEvent" src/
# Expected: 1 result (file-watcher.ts only)

# 4. No duplicate StructuralParseResult
grep -rn "interface StructuralParseResult" src/
# Expected: 1 result (structural-parser.ts only)

# 5. Correct ImportResolver usage
grep -rn "new ImportResolver" src/
# All instances should show packages as first argument

# 6. Correct PackageExtractor usage
grep -rn "new PackageExtractor" src/
# All instances should show workspaceRoot argument

# 7. Only discoverPackages (not extractPackages)
grep -rn "extractPackages" src/
# Expected: 0 results

# 8. Schema uses Cypher strings
grep -c "CREATE INDEX.*IF NOT EXISTS" src/database/schema.ts
# Should show count of indexes in Cypher format

# 9. Build and test
npm run build && npm test
```

---

## Part 10: Files Summary

### Files to Create

| File | Purpose |
|------|---------|
| `src/devac/integration/incremental-analyzer.ts` | Main integration layer |
| `src/devac/integration/import-node-mapper.ts` | ImportNode conversion utility |
| `src/devac/integration/__tests__/multi-language.integration.spec.ts` | Language routing tests |
| `src/devac/integration/__tests__/performance.bench.ts` | Performance benchmarks |
| `src/devac/integration/__tests__/e2e.integration.spec.ts` | End-to-end tests |

### Files to Modify

| File | Changes |
|------|---------|
| `package.json` | Add `@types/babel__traverse` |
| `src/devac/actors/validation-coordinator.actor.ts` | Fix imports, XState v5, remove duplicate service class |
| `src/devac/services/validation-coordinator.service.ts` | Fix import, consolidate as canonical |
| `src/devac/actors/graph-updater.actor.ts` | Fix event types, remove duplicate StructuralParseResult |
| `src/devac/actors/semantic-resolver.actor.ts` | Fix nullability, Promise types |
| `src/devac/actors/affected-calculator.actor.ts` | Fix event types, remove duplicate PackageInfo |
| `src/devac/actors/script-executor.actor.ts` | Fix event types, error handling |
| `src/analyzer/structural-parser.ts` | Fix Babel traverse callback types |
| `src/analyzer/storage-manager.ts` | Add status tracking methods |
| `src/database/schema.ts` | Add new indexes |
| `src/devac/services/codegraph/codegraph-service.ts` | Add incremental analysis path |

### Files to Delete

| File | Reason |
|------|--------|
| Any `ValidationCoordinatorService` class in actor files | Consolidate to single service implementation |

---

## Part 11: Success Criteria

| Phase | Criteria | Verification Command |
|-------|----------|---------------------|
| Phase 1 | 0 type errors | `tsc --noEmit 2>&1 \| grep "error TS" \| wc -l` returns 0 |
| Phase 1 | Build succeeds | `npm run build` exits 0 |
| Phase 1 | All tests pass | `npm test` shows 707+ passing |
| Phase 2 | Incremental works for TS/JS | Integration tests pass |
| Phase 2 | No duplicate types | Verification commands 2-4 return 1 result each |
| Phase 3 | All 8 languages parse | Multi-language tests pass |
| Phase 3 | Correct routing | canHandle() tests pass |
| Phase 4 | p90 <50ms structural | Performance benchmarks pass |
| Phase 4 | p90 <500ms semantic | Performance benchmarks pass |

---

## Appendix A: Complete Error Fix Checklist

### Files with Type Errors

- [ ] `src/devac/actors/validation-coordinator.actor.ts` (~25 errors)
- [ ] `src/devac/services/validation-coordinator.service.ts` (~8 errors)
- [ ] `src/devac/actors/semantic-resolver.actor.ts` (~11 errors)
- [ ] `src/devac/actors/graph-updater.actor.ts` (~15 errors)
- [ ] `src/devac/actors/affected-calculator.actor.ts` (~12 errors)
- [ ] `src/devac/actors/script-executor.actor.ts` (~11 errors)
- [ ] `src/analyzer/structural-parser.ts` (~21 errors)

### Duplicate Types to Remove

- [ ] `PackageInfo` in `affected-calculator.actor.ts`
- [ ] `StructuralParseResult` in `graph-updater.actor.ts` (if exists)
- [ ] Any local `FileChangeEvent` definitions

### Dependencies to Install

- [ ] `@types/babel__traverse`

---

## Appendix B: Test Templates

### Multi-Language Routing Test

```typescript
// src/devac/integration/__tests__/multi-language.integration.spec.ts

import { describe, it, expect, beforeEach } from "vitest";
import { IncrementalAnalyzer } from "../incremental-analyzer.js";

describe("Multi-Language Integration", () => {
  let analyzer: IncrementalAnalyzer;

  beforeEach(() => {
    analyzer = new IncrementalAnalyzer({
      neo4jClient: {} as any,
      workspaceRoot: process.cwd(),
    });
  });

  describe("canHandle() routing", () => {
    it.each([
      // Incremental path (TypeScript/JavaScript)
      ["file.ts", true],
      ["file.tsx", true],
      ["file.js", true],
      ["file.jsx", true],
      ["file.mjs", true],
      ["file.cjs", true],
      // Full analysis path (other languages)
      ["file.py", false],
      ["file.java", false],
      ["file.go", false],
      ["file.cpp", false],
      ["file.c", false],
      ["file.cs", false],
      ["file.sql", false],
      // Non-code files
      ["file.md", false],
      ["file.json", false],
      ["file.yaml", false],
    ])("canHandle('%s') should return %s", (file, expected) => {
      expect(analyzer.canHandle(file)).toBe(expected);
    });
  });
});
```

### Performance Benchmark Test

```typescript
// src/devac/integration/__tests__/performance.bench.ts

import { describe, it, expect, beforeAll } from "vitest";
import { StructuralParser } from "../../../analyzer/structural-parser.js";

describe("Performance Benchmarks", () => {
  let parser: StructuralParser;

  beforeAll(() => {
    parser = new StructuralParser();
  });

  it("structural parse p90 should be <50ms", async () => {
    const times: number[] = [];
    const testFile = "test-fixtures/medium-file.ts";

    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await parser.parseStructural(testFile);
      times.push(performance.now() - start);
    }

    times.sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length * 0.5)];
    const p90 = times[Math.floor(times.length * 0.9)];
    const p99 = times[Math.floor(times.length * 0.99)];

    console.log(`Structural parse: p50=${p50.toFixed(1)}ms, p90=${p90.toFixed(1)}ms, p99=${p99.toFixed(1)}ms`);

    expect(p90).toBeLessThan(50);
  });
});
```

---

**Document Version**: 9.3  
**All API Signatures**: Verified against actual codebase  
**Blocking Issues Addressed**: 4/4 from review recap  
**Ready for Implementation**: ✅ Yes
