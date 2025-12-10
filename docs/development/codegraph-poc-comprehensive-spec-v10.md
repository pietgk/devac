# CodeGraph POC Comprehensive Specification v10

> **Version**: 10.0
> **Date**: 2025-12-10
> **Status**: Complete Analysis & Implementation Plan
> **Goal**: Implement incremental graph updates from file changes for all supported languages

---

## Executive Summary

### The Paradigm Shift: Batch → Incremental

| Aspect | Original CodeGraph (Batch) | POC Goal (Incremental) |
|--------|---------------------------|------------------------|
| **Trigger** | Manual CLI command | File system events |
| **Scope** | Entire repository | Single file changes |
| **Frequency** | On-demand | Real-time, continuous |
| **Speed** | 30-60s per repo | <100ms per file |
| **Graph Updates** | Full re-sync | Atomic add/change/delete |
| **Use Case** | Initial analysis | Live development |

### The Original Vision

CodeGraph is a system that:
1. **Parses code** (8 supported languages) into an AST
2. **Stores the AST in Neo4j** as a graph of nodes and relationships
3. **Enables intelligent validation** by knowing which files are affected by a change
4. **Reduces validation time** from 30-60s (full repo) to 2-5s (affected files only)

### The POC Objective

Transform CodeGraph from **batch processing** (analyze entire repo on command) to **incremental updates** (react to file changes in real-time):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BATCH APPROACH (Current)                          │
│                                                                             │
│   CLI Command ──► Scan All Files ──► Parse All ──► Write All to Neo4j      │
│                      (slow)          (slow)          (slow)                 │
│                                                                             │
│   Total time: 30-60 seconds per repository                                  │
└─────────────────────────────────────────────────────────────────────────────┘

                                    ▼

┌─────────────────────────────────────────────────────────────────────────────┐
│                        INCREMENTAL APPROACH (POC Goal)                      │
│                                                                             │
│   File Change ──► Parse Single File ──► Update Graph Atomically            │
│     (event)         (<100ms)              (<50ms)                           │
│                                                                             │
│   Total time: <200ms per file change                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Multi-Language Support Requirement

The POC must support **all 8 languages** that CodeGraph handles:

| Language | Current Parser | Incremental Target | Status |
|----------|---------------|-------------------|--------|
| TypeScript | Babel (StructuralParser) | <50ms | ✅ POC exists |
| JavaScript | Babel (StructuralParser) | <50ms | ✅ POC exists |
| Python | Subprocess → Python AST | <100ms | ⚠️ Needs work |
| Java | tree-sitter-java | <80ms | ✅ Already fast |
| Go | tree-sitter-go | <50ms | ✅ Already fast |
| C/C++ | tree-sitter-c/cpp | <80ms | ✅ Already fast |
| C# | tree-sitter-c-sharp | <70ms | ✅ Already fast |
| SQL | tree-sitter-sql | <50ms | ⚠️ Disabled |

**Key Finding**: Tree-sitter languages are already fast enough. The main challenges are:
1. **TypeScript/JavaScript**: POC exists but not integrated
2. **Python**: Subprocess overhead (~200-500ms) needs elimination
3. **Integration**: No unified incremental pipeline exists

---

## Current State Analysis

### What Works (Ready for Incremental)

| Component | Status | Speed | Notes |
|-----------|--------|-------|-------|
| **StructuralParser** | ✅ Working | ~20ms | Babel-based, TS/JS only, has tests |
| **tree-sitter parsers** | ✅ Working | 30-80ms | Java, Go, C++, C#, SQL |
| **StorageManager** | ✅ Working | <50ms | Saves nodes/relationships to Neo4j |
| **Neo4jClient** | ✅ Working | - | Database connectivity |
| **FileWatcher** | ✅ Working | - | Chokidar-based, debouncing |
| **ImportResolver** | ✅ Working | - | Module resolution |
| **PackageExtractor** | ✅ Working | - | Package discovery |

### What's Broken

| Component | Errors | Issues |
|-----------|--------|--------|
| **validation-coordinator.actor.ts** | 37 | Wrong imports, XState v5 issues |
| **validation-coordinator.service.ts** | 19 | Duplicate implementation |
| **graph-updater.actor.ts** | 4 | Duplicate types, event narrowing |
| **semantic-resolver.actor.ts** | 7 | Argument mismatches |
| **affected-calculator.actor.ts** | 5 | Duplicate types |
| **script-executor.actor.ts** | 8 | Complex XState issues |
| **structural-parser.ts** | 9 | Missing @types/babel__traverse |
| **semantic-resolver.ts** | 2 | null vs undefined |

### What's Missing

1. **Incremental Pipeline**: No component connects FileWatcher → Parser → Neo4j
2. **Multi-Language Router**: No unified handler for different file types
3. **Atomic Graph Updates**: No delete-then-insert for changed files
4. **Python Keep-Alive**: Subprocess overhead not addressed

---

## Architecture: Incremental Multi-Language Pipeline

### Design Goals

1. **Single file changes update graph in <200ms**
2. **Support all 8 languages through unified interface**
3. **Atomic updates**: delete old nodes, insert new ones
4. **Two-phase parsing**: structural (fast) + semantic (deferred)
5. **No XState complexity** until proven needed

### Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     INCREMENTAL MULTI-LANGUAGE PIPELINE                     │
│                                                                             │
│  ┌──────────────┐                                                           │
│  │  FileWatcher │ ──► FileChangeEvent { path, type: add|change|unlink }     │
│  └──────────────┘                                                           │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    LanguageRouter                                    │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  .ts/.tsx/.js/.jsx/.mjs/.cjs → StructuralParser (Babel)     │   │   │
│  │  │  .py                         → PythonParser (keep-alive)    │   │   │
│  │  │  .java                       → JavaParser (tree-sitter)     │   │   │
│  │  │  .go                         → GoParser (tree-sitter)       │   │   │
│  │  │  .c/.cpp/.h/.hpp             → CppParser (tree-sitter)      │   │   │
│  │  │  .cs                         → CSharpParser (tree-sitter)   │   │   │
│  │  │  .sql                        → SqlParser (tree-sitter)      │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                   │
│         ▼ ParseResult { nodes, relationships, imports, exports }            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    GraphUpdater                                      │   │
│  │  1. Delete existing nodes for file (if change/unlink)               │   │
│  │  2. Insert new nodes (if add/change)                                │   │
│  │  3. Insert structural relationships                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    SemanticResolver (deferred, TS/JS only)          │   │
│  │  - Queues files for batch processing                                │   │
│  │  - Resolves IMPORTS relationships across files                      │   │
│  │  - Uses ts-morph for type information                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Atomic Graph Update Strategy

For file changes, we need **atomic delete-then-insert** to maintain consistency:

```typescript
async function updateFileInGraph(
  filePath: string,
  parseResult: ParseResult,
  neo4jClient: Neo4jClient
): Promise<void> {
  await neo4jClient.runTransactionWork(async (tx) => {
    // Step 1: Delete all existing nodes owned by this file
    await tx.run(
      `MATCH (f:File {filePath: $filePath})
       OPTIONAL MATCH (f)-[:CONTAINS|OWNS*]->(n)
       DETACH DELETE n
       WITH f
       DETACH DELETE f`,
      { filePath }
    );

    // Step 2: Create new file node
    await tx.run(
      `CREATE (f:File:Node $props)`,
      { props: parseResult.fileNode }
    );

    // Step 3: Create all child nodes
    for (const node of parseResult.nodes) {
      await tx.run(
        `CREATE (n:Node:${node.kind} $props)`,
        { props: node }
      );
    }

    // Step 4: Create structural relationships
    for (const rel of parseResult.relationships) {
      await tx.run(
        `MATCH (source:Node {entityId: $sourceId})
         MATCH (target:Node {entityId: $targetId})
         CREATE (source)-[r:${rel.type} $props]->(target)`,
        { sourceId: rel.sourceId, targetId: rel.targetId, props: rel.properties }
      );
    }
  }, "WRITE", "AtomicFileUpdate");
}
```

---

## Implementation Plan

### Phase 1: Fix Core Components (2-3 days)

**Goal**: Get TypeScript compiling with 0 errors in essential files.

#### 1.1 Install Missing Dependencies
```bash
npm install --save-dev @types/babel__traverse
```

#### 1.2 Fix structural-parser.ts (9 errors)

Add explicit Babel traverse types:
```typescript
import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";

traverse(ast, {
  ClassDeclaration: (path: NodePath<t.ClassDeclaration>) => {
    const node = path.node;
    // ...
  },
  FunctionDeclaration: (path: NodePath<t.FunctionDeclaration>) => {
    // ...
  },
  // ... other visitors
});
```

Fix error handling:
```typescript
catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Failed to parse ${filePath}: ${message}`);
}
```

#### 1.3 Fix semantic-resolver.ts (2 errors)

Fix null vs undefined:
```typescript
const nearestTsConfig = await findNearestTsConfig(filePaths[0], process.cwd());

const miniProject = new Project({
  tsConfigFilePath: nearestTsConfig ?? undefined,  // Convert null to undefined
  skipAddingFilesFromTsConfig: true,
});
```

### Phase 2: Create Incremental Pipeline (3-4 days)

**Goal**: Build unified pipeline connecting FileWatcher → Parsers → Neo4j.

#### 2.1 Create Language Router

```typescript
// src/pipeline/language-router.ts

import { StructuralParser } from "../analyzer/structural-parser.js";
import { PythonParser } from "../analyzer/python-parser.js";
import { JavaParser } from "../analyzer/parsers/java-parser.js";
import { GoParser } from "../analyzer/parsers/go-parser.js";
import { CCppParser } from "../analyzer/parsers/c-cpp-parser.js";
import { CSharpParser } from "../analyzer/parsers/csharp-parser.js";
import type { AstNode, RelationshipInfo } from "../analyzer/types.js";

export interface ParseResult {
  filePath: string;
  nodes: AstNode[];
  relationships: RelationshipInfo[];
  importStrings: string[];
  exportedSymbols: { name: string; kind: string }[];
  metadata: {
    parseTime: number;
    language: string;
  };
}

export class LanguageRouter {
  private structuralParser = new StructuralParser();
  private pythonParser = new PythonParser();
  private javaParser: JavaParser;
  private goParser: GoParser;
  private cppParser: CCppParser;
  private csharpParser: CSharpParser;

  private static readonly EXTENSION_MAP: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".java": "java",
    ".go": "go",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".sql": "sql",
  };

  constructor() {
    // Initialize tree-sitter parsers
    this.javaParser = new JavaParser();
    this.goParser = new GoParser();
    this.cppParser = new CCppParser();
    this.csharpParser = new CSharpParser();
  }

  canHandle(filePath: string): boolean {
    const ext = this.getExtension(filePath);
    return ext in LanguageRouter.EXTENSION_MAP;
  }

  getLanguage(filePath: string): string | null {
    const ext = this.getExtension(filePath);
    return LanguageRouter.EXTENSION_MAP[ext] ?? null;
  }

  async parse(filePath: string): Promise<ParseResult> {
    const language = this.getLanguage(filePath);
    
    if (!language) {
      throw new Error(`Unsupported file type: ${filePath}`);
    }

    const startTime = performance.now();

    switch (language) {
      case "typescript":
      case "javascript":
        return this.parseTypeScript(filePath);

      case "python":
        return this.parsePython(filePath);

      case "java":
        return this.parseJava(filePath);

      case "go":
        return this.parseGo(filePath);

      case "c":
      case "cpp":
        return this.parseCpp(filePath);

      case "csharp":
        return this.parseCSharp(filePath);

      default:
        throw new Error(`Parser not implemented for: ${language}`);
    }
  }

  private async parseTypeScript(filePath: string): Promise<ParseResult> {
    // Use the fast Babel-based StructuralParser
    const result = await this.structuralParser.parseStructural(filePath);
    return {
      filePath: result.filePath,
      nodes: result.nodes,
      relationships: result.relationships,
      importStrings: result.importStrings,
      exportedSymbols: result.exportedSymbols,
      metadata: {
        parseTime: result.metadata.parseTime,
        language: result.metadata.language,
      },
    };
  }

  private async parsePython(filePath: string): Promise<ParseResult> {
    // Use existing Python parser (TODO: add keep-alive process)
    const result = await this.pythonParser.parseFile({
      path: filePath,
      extension: ".py",
    });
    
    return this.convertLegacyResult(result, filePath, "Python");
  }

  private async parseJava(filePath: string): Promise<ParseResult> {
    const result = await this.javaParser.parseFile({
      path: filePath,
      extension: ".java",
    });
    
    return this.convertLegacyResult(result, filePath, "Java");
  }

  private async parseGo(filePath: string): Promise<ParseResult> {
    const result = await this.goParser.parseFile({
      path: filePath,
      extension: ".go",
    });
    
    return this.convertLegacyResult(result, filePath, "Go");
  }

  private async parseCpp(filePath: string): Promise<ParseResult> {
    const ext = this.getExtension(filePath);
    const result = await this.cppParser.parseFile({
      path: filePath,
      extension: ext,
    });
    
    return this.convertLegacyResult(result, filePath, ext === ".c" ? "C" : "C++");
  }

  private async parseCSharp(filePath: string): Promise<ParseResult> {
    const result = await this.csharpParser.parseFile({
      path: filePath,
      extension: ".cs",
    });
    
    return this.convertLegacyResult(result, filePath, "C#");
  }

  private convertLegacyResult(
    result: { nodes: AstNode[]; relationships: RelationshipInfo[] },
    filePath: string,
    language: string
  ): ParseResult {
    return {
      filePath,
      nodes: result.nodes,
      relationships: result.relationships,
      importStrings: [],  // Legacy parsers don't extract imports separately
      exportedSymbols: [],
      metadata: {
        parseTime: 0,  // Not tracked in legacy parsers
        language,
      },
    };
  }

  private getExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf(".");
    return lastDot >= 0 ? filePath.substring(lastDot) : "";
  }
}
```

#### 2.2 Create Incremental Pipeline

```typescript
// src/pipeline/incremental-pipeline.ts

import { LanguageRouter, type ParseResult } from "./language-router.js";
import { StorageManager } from "../analyzer/storage-manager.js";
import { SemanticResolver } from "../analyzer/semantic-resolver.js";
import { FileWatcher, type FileChangeEvent } from "../devac/services/codegraph/file-watcher.js";
import type { Neo4jClient } from "../database/neo4j-client.js";
import { createContextLogger } from "../utils/logger.js";

const logger = createContextLogger("IncrementalPipeline");

export interface PipelineConfig {
  neo4jClient: Neo4jClient;
  workspaceRoot: string;
  watchPaths: string[];
  ignorePatterns: string[];
  enableSemanticResolution: boolean;  // Only for TS/JS
}

export interface PipelineStats {
  filesProcessed: number;
  nodesCreated: number;
  relationshipsCreated: number;
  errors: number;
  byLanguage: Record<string, number>;
  lastProcessedFile: string | null;
  averageProcessingTime: number;
}

export class IncrementalPipeline {
  private languageRouter: LanguageRouter;
  private storageManager: StorageManager;
  private semanticResolver: SemanticResolver | null = null;
  private fileWatcher: FileWatcher | null = null;
  private isRunning = false;
  private processingTimes: number[] = [];

  private stats: PipelineStats = {
    filesProcessed: 0,
    nodesCreated: 0,
    relationshipsCreated: 0,
    errors: 0,
    byLanguage: {},
    lastProcessedFile: null,
    averageProcessingTime: 0,
  };

  constructor(private config: PipelineConfig) {
    this.languageRouter = new LanguageRouter();
    this.storageManager = new StorageManager(config.neo4jClient);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Pipeline already running");
      return;
    }

    logger.info("Starting incremental pipeline...");
    this.isRunning = true;

    // Initialize semantic resolver for TS/JS if enabled
    if (this.config.enableSemanticResolution) {
      // Would need ImportResolver and packages - simplified for now
      logger.info("Semantic resolution enabled for TypeScript/JavaScript");
    }

    // Start file watcher
    for (const watchPath of this.config.watchPaths) {
      this.fileWatcher = new FileWatcher({
        watchPath,
        ignorePatterns: this.config.ignorePatterns,
        debounceMs: 300,
        onEvent: (event) => this.handleFileChange(event),
      });

      await this.fileWatcher.start();
      logger.info(`Watching: ${watchPath}`);
    }

    logger.info("Incremental pipeline started");
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.fileWatcher) {
      this.fileWatcher[Symbol.dispose]();
      this.fileWatcher = null;
    }

    logger.info("Pipeline stopped", { stats: this.stats });
  }

  async handleFileChange(event: FileChangeEvent): Promise<void> {
    const { path: filePath, type } = event;

    // Skip unsupported files
    if (!this.languageRouter.canHandle(filePath)) {
      logger.debug(`Skipping unsupported file: ${filePath}`);
      return;
    }

    const startTime = performance.now();
    const language = this.languageRouter.getLanguage(filePath) ?? "unknown";

    logger.info(`Processing ${type}: ${filePath} (${language})`);

    try {
      switch (type) {
        case "unlink":
          await this.handleFileDelete(filePath);
          break;

        case "add":
        case "change":
          await this.handleFileAddOrChange(filePath);
          break;
      }

      // Update stats
      this.stats.filesProcessed++;
      this.stats.lastProcessedFile = filePath;
      this.stats.byLanguage[language] = (this.stats.byLanguage[language] ?? 0) + 1;

      const duration = performance.now() - startTime;
      this.processingTimes.push(duration);
      this.stats.averageProcessingTime = 
        this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length;

      logger.info(`Processed ${filePath} in ${duration.toFixed(0)}ms`);

    } catch (error) {
      this.stats.errors++;
      logger.error(`Error processing ${filePath}:`, error);
    }
  }

  private async handleFileAddOrChange(filePath: string): Promise<void> {
    // Step 1: Parse file
    const parseResult = await this.languageRouter.parse(filePath);

    // Step 2: Atomic update in Neo4j (delete old, insert new)
    await this.atomicGraphUpdate(filePath, parseResult);

    // Step 3: Queue for semantic resolution (TS/JS only)
    const language = this.languageRouter.getLanguage(filePath);
    if (
      this.semanticResolver &&
      (language === "typescript" || language === "javascript")
    ) {
      this.semanticResolver.enqueue(filePath, "normal");
    }

    this.stats.nodesCreated += parseResult.nodes.length;
    this.stats.relationshipsCreated += parseResult.relationships.length;
  }

  private async handleFileDelete(filePath: string): Promise<void> {
    await this.config.neo4jClient.runTransaction(
      `MATCH (f:File {filePath: $filePath})
       OPTIONAL MATCH (f)-[:CONTAINS|OWNS*]->(n)
       DETACH DELETE f, n`,
      { filePath },
      "WRITE",
      "DeleteFile"
    );

    logger.info(`Deleted from graph: ${filePath}`);
  }

  private async atomicGraphUpdate(
    filePath: string,
    parseResult: ParseResult
  ): Promise<void> {
    // Delete existing and insert new in single transaction
    await this.config.neo4jClient.runTransactionWork(
      async (tx) => {
        // Delete existing nodes for this file
        await tx.run(
          `MATCH (f:File {filePath: $filePath})
           OPTIONAL MATCH (f)-[:CONTAINS|OWNS*]->(n)
           DETACH DELETE n
           WITH f
           DETACH DELETE f`,
          { filePath }
        );

        // Insert new nodes using StorageManager
        // Note: StorageManager batches internally, but for atomic update
        // we should do it in one transaction
      },
      "WRITE",
      "AtomicFileUpdate"
    );

    // For now, use StorageManager (may need to refactor for true atomicity)
    await this.storageManager.saveNodesBatch(parseResult.nodes);
    
    const relsByType = new Map<string, typeof parseResult.relationships>();
    for (const rel of parseResult.relationships) {
      const existing = relsByType.get(rel.type) || [];
      existing.push(rel);
      relsByType.set(rel.type, existing);
    }
    for (const [type, rels] of relsByType) {
      await this.storageManager.saveRelationshipsBatch(type, rels);
    }
  }

  /**
   * Process a single file manually (for testing)
   */
  async processFile(filePath: string): Promise<ParseResult> {
    if (!this.languageRouter.canHandle(filePath)) {
      throw new Error(`Unsupported file type: ${filePath}`);
    }

    const parseResult = await this.languageRouter.parse(filePath);
    await this.atomicGraphUpdate(filePath, parseResult);
    return parseResult;
  }

  getStats(): PipelineStats {
    return { ...this.stats };
  }
}
```

### Phase 3: Python Keep-Alive Process (2-3 days)

**Goal**: Eliminate Python subprocess overhead (~200-500ms → <100ms).

The existing `python-parser.ts` spawns a new Python process for each file. We need to:

1. Create a persistent Python process that stays alive
2. Communicate via stdin/stdout JSON protocol
3. Handle process crashes gracefully

```typescript
// src/analyzer/parsers/python-keep-alive.ts

import { spawn, type ChildProcess } from "child_process";
import { createContextLogger } from "../../utils/logger.js";

const logger = createContextLogger("PythonKeepAlive");

export class PythonKeepAliveParser {
  private process: ChildProcess | null = null;
  private requestQueue: Map<string, {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private requestId = 0;

  async start(): Promise<void> {
    if (this.process) return;

    // Start Python process with our AST parsing script
    this.process = spawn("python3", ["-u", "scripts/ast-parser-server.py"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data) => {
      this.handleResponse(data.toString());
    });

    this.process.on("exit", (code) => {
      logger.warn(`Python process exited with code ${code}`);
      this.process = null;
      // Reject all pending requests
      for (const [id, { reject }] of this.requestQueue) {
        reject(new Error("Python process crashed"));
      }
      this.requestQueue.clear();
    });

    logger.info("Python keep-alive process started");
  }

  async parseFile(filePath: string): Promise<any> {
    if (!this.process) {
      await this.start();
    }

    const id = String(++this.requestId);

    return new Promise((resolve, reject) => {
      this.requestQueue.set(id, { resolve, reject });

      const request = JSON.stringify({ id, action: "parse", filePath });
      this.process?.stdin?.write(request + "\n");
    });
  }

  private handleResponse(data: string): void {
    try {
      const response = JSON.parse(data);
      const { id, result, error } = response;

      const pending = this.requestQueue.get(id);
      if (pending) {
        this.requestQueue.delete(id);
        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve(result);
        }
      }
    } catch (error) {
      logger.error("Failed to parse Python response:", error);
    }
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
```

### Phase 4: Testing & Verification (2-3 days)

**Goal**: Ensure all languages work correctly with incremental updates.

#### Test Cases

```typescript
// src/pipeline/__tests__/incremental-pipeline.test.ts

describe("IncrementalPipeline", () => {
  describe("Language Routing", () => {
    it.each([
      ["file.ts", "typescript"],
      ["file.tsx", "typescript"],
      ["file.js", "javascript"],
      ["file.jsx", "javascript"],
      ["file.py", "python"],
      ["file.java", "java"],
      ["file.go", "go"],
      ["file.cpp", "cpp"],
      ["file.c", "c"],
      ["file.cs", "csharp"],
    ])("should route %s to %s parser", async (file, expectedLanguage) => {
      const router = new LanguageRouter();
      expect(router.getLanguage(file)).toBe(expectedLanguage);
      expect(router.canHandle(file)).toBe(true);
    });
  });

  describe("Incremental Updates", () => {
    it("should handle file add", async () => {
      // Create file, verify nodes in Neo4j
    });

    it("should handle file change (atomic update)", async () => {
      // Modify file, verify old nodes deleted, new nodes created
    });

    it("should handle file delete", async () => {
      // Delete file, verify nodes removed from Neo4j
    });
  });

  describe("Performance", () => {
    it.each([
      [".ts", 50],
      [".js", 50],
      [".py", 100],
      [".java", 80],
      [".go", 50],
      [".cpp", 80],
      [".cs", 70],
    ])("should parse %s files in <%dms", async (ext, targetMs) => {
      // Benchmark parsing speed
    });
  });
});
```

### Phase 5: Affected Calculation (2-3 days)

**Goal**: Query Neo4j to find files affected by a change.

```typescript
// src/pipeline/affected-calculator.ts

export interface AffectedResult {
  scope: "file" | "package" | "repository";
  files: string[];
  packages: string[];
  dependentCount: number;
}

export class AffectedCalculator {
  constructor(private neo4jClient: Neo4jClient) {}

  async calculateAffected(changedFilePath: string): Promise<AffectedResult> {
    // Get direct dependents
    const directResult = await this.neo4jClient.runTransaction(
      `MATCH (changed:File {filePath: $path})
       OPTIONAL MATCH (changed)<-[:IMPORTS]-(dependent:File)
       RETURN dependent.filePath as filePath`,
      { path: changedFilePath },
      "READ",
      "DirectDependents"
    );

    const directDependents = directResult.records
      .map(r => r.get("filePath"))
      .filter(Boolean);

    if (directDependents.length > 50) {
      return this.calculatePackageScope(changedFilePath);
    }

    // Get transitive dependents (limited depth)
    const transitiveResult = await this.neo4jClient.runTransaction(
      `MATCH (changed:File {filePath: $path})
       OPTIONAL MATCH path = (changed)<-[:IMPORTS*1..3]-(dependent:File)
       RETURN DISTINCT dependent.filePath as filePath
       LIMIT 100`,
      { path: changedFilePath },
      "READ",
      "TransitiveDependents"
    );

    const allDependents = new Set([
      changedFilePath,
      ...directDependents,
      ...transitiveResult.records.map(r => r.get("filePath")).filter(Boolean)
    ]);

    if (allDependents.size > 100) {
      return this.calculatePackageScope(changedFilePath);
    }

    return {
      scope: "file",
      files: Array.from(allDependents),
      packages: [],
      dependentCount: allDependents.size,
    };
  }

  private async calculatePackageScope(filePath: string): Promise<AffectedResult> {
    const result = await this.neo4jClient.runTransaction(
      `MATCH (f:File {filePath: $path})<-[:CONTAINS_FILE]-(p:Package)
       RETURN p.name as packageName`,
      { path: filePath },
      "READ",
      "FindPackage"
    );

    const packageName = result.records[0]?.get("packageName") ?? "unknown";

    return {
      scope: "package",
      files: [],
      packages: [packageName],
      dependentCount: -1,
    };
  }
}
```

---

## Timeline Summary

| Phase | Duration | Goal |
|-------|----------|------|
| Phase 1 | 2-3 days | Fix TypeScript errors (11 total) |
| Phase 2 | 3-4 days | Create incremental pipeline + language router |
| Phase 3 | 2-3 days | Python keep-alive process |
| Phase 4 | 2-3 days | Testing all languages |
| Phase 5 | 2-3 days | Affected calculation |

**Total: ~2-3 weeks**

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/pipeline/language-router.ts` | Routes files to correct parser |
| `src/pipeline/incremental-pipeline.ts` | Main orchestration |
| `src/pipeline/affected-calculator.ts` | Calculate affected files |
| `src/analyzer/parsers/python-keep-alive.ts` | Persistent Python process |
| `scripts/ast-parser-server.py` | Python AST parsing server |
| `src/pipeline/__tests__/*.test.ts` | Tests |

## Files to Modify

| File | Changes |
|------|---------|
| `package.json` | Add `@types/babel__traverse` |
| `src/analyzer/structural-parser.ts` | Fix Babel traverse types |
| `src/analyzer/semantic-resolver.ts` | Fix null vs undefined |

## Files to Archive (Optional)

| File | Reason |
|------|--------|
| `src/devac/actors/*.ts` | Broken XState actors |

---

## Success Criteria

1. **TypeScript compiles**: `tsc --noEmit` → 0 errors
2. **All languages parse**: TS, JS, Python, Java, Go, C/C++, C#
3. **Performance targets met**:
   - TypeScript/JavaScript: <50ms
   - Python: <100ms (with keep-alive)
   - Tree-sitter languages: <100ms
4. **Atomic updates work**: Change file, verify old nodes deleted, new nodes created
5. **Affected calculation works**: Query "what depends on X?"

---

## Verification Commands

```bash
# 1. Check TypeScript errors
npx tsc --noEmit

# 2. Run pipeline tests
npm test -- --grep "IncrementalPipeline"

# 3. Process a TypeScript file
npm run pipeline -- process src/analyzer/structural-parser.ts

# 4. Process a Python file
npm run pipeline -- process scripts/ast-parser-server.py

# 5. Query affected files
npm run query -- "MATCH (f:File {name: 'structural-parser.ts'})<-[:IMPORTS*1..3]-(d) RETURN d.name"

# 6. Check performance
npm run benchmark -- --file src/analyzer/structural-parser.ts
```

---

## Summary

This spec captures the full scope of the POC:

1. **Paradigm shift**: Batch → Incremental (the core innovation)
2. **Multi-language support**: All 8 languages through unified pipeline
3. **Atomic updates**: Delete-then-insert for consistency
4. **Two-phase parsing**: Structural (fast) + Semantic (deferred, TS/JS only)
5. **Performance targets**: <100ms per file for all languages
6. **Python optimization**: Keep-alive process to eliminate subprocess overhead

The previous specs (v1-v9.4) focused too narrowly on fixing XState TypeScript errors. This spec takes a step back to define **what we're actually building** and **why**, then charts a practical implementation path.
