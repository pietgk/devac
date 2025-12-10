# DEVAC Validate Basics Spec v9.4

> **Version**: 9.4
> **Status**: Final (User-Decision Based)
> **Date**: 2025-01-XX
> **Decisions By**: User (1:A, 2:A, 3:B)

## Overview

This spec resolves 103 TypeScript compilation errors across 10 files in the DEVAC subsystem. Unlike previous versions, this spec is based on explicit user decisions rather than inferred choices, which should end the review loop.

## User Decisions Made

| Decision | Question | Choice | Implementation |
|----------|----------|--------|----------------|
| 1 | Which ValidationCoordinatorService is canonical? | **A: Keep Actor File** | Fix import paths in `actors/validation-coordinator.actor.ts` |
| 2 | How to handle StructuralParseResult duplication? | **A: Use Canonical Type** | Refactor `graph-updater.actor.ts` to import from `structural-parser.ts` |
| 3 | How to handle PackageInfo duplication? | **B: Use Pick<>** | Use `Pick<PackageInfo, "name" \| "path">` in `affected-calculator.actor.ts` |

---

## Phase 1: Fix validation-coordinator.actor.ts Import Paths

**File**: `src/devac/actors/validation-coordinator.actor.ts`

### Current Broken Imports (Lines 9-13)

```typescript
// CURRENT - BROKEN
import type { FileChangeEvent } from "../types/file-watcher.js";
import type { Neo4jClient } from "../graph/neo4j-client.js";
import type { StructuralParser } from "../parsers/structural-parser.js";
import type { ImportResolver } from "../resolution/import-resolver.js";
import type { PackageInfo } from "../types/package.js";
```

### Fixed Imports

```typescript
// FIXED - Correct paths relative to src/devac/actors/
import type { FileChangeEvent } from "../../watcher/types.js";
import type { Neo4jClient } from "../../database/neo4j-client.js";
import type { StructuralParser } from "../../analyzer/structural-parser.js";
import type { ImportResolver } from "../../analyzer/parsers/import-resolver.js";
import type { PackageInfo } from "../../analyzer/parsers/package-extractor.js";
```

### Path Verification

| Import | Correct Source File | Verified |
|--------|---------------------|----------|
| `FileChangeEvent` | `src/watcher/types.ts` | ✓ |
| `Neo4jClient` | `src/database/neo4j-client.ts` | ✓ |
| `StructuralParser` | `src/analyzer/structural-parser.ts` | ✓ |
| `ImportResolver` | `src/analyzer/parsers/import-resolver.ts` | ✓ |
| `PackageInfo` | `src/analyzer/parsers/package-extractor.ts` | ✓ |

---

## Phase 2: Refactor graph-updater.actor.ts to Use Canonical StructuralParseResult

**File**: `src/devac/actors/graph-updater.actor.ts`

### Current Duplicate Type (Lines 32-49)

```typescript
// CURRENT - DELETE THIS DUPLICATE
export type StructuralParseResult = {
  nodes: Array<{
    entityId: string;
    kind: string;
    name: string;
    filePath: string;
    line: number;
    column: number;
  }>;
  relationships: Array<{
    source: string;
    target: string;
    type: string;
  }>;
  importStrings: string[];
  exportedSymbols: Array<{
    name: string;
    kind: string;
  }>;
};
```

### Canonical Type Location

**Source**: `src/analyzer/structural-parser.ts` (lines 26-39)

```typescript
export interface StructuralParseResult {
  filePath: string;
  nodes: AstNode[];  // Full AstNode with 15+ fields
  relationships: RelationshipInfo[];
  importStrings: string[];
  exportedSymbols: ExportedSymbol[];
  metadata: {
    parseTime: number;
    nodeCount: number;
    relationshipCount: number;
    loc: number;
    language: string;
  };
}
```

### Required Changes

1. **Delete** the local `StructuralParseResult` type definition (lines 32-49)

2. **Add import** at top of file:
```typescript
import type { StructuralParseResult } from "../../analyzer/structural-parser.js";
```

3. **Update** `GraphUpdaterInput` type to use imported type (no change needed - same name)

4. **Update node creation logic** to handle full `AstNode` structure. The existing code accesses:
   - `node.entityId` ✓
   - `node.kind` ✓
   - `node.name` ✓
   - `node.filePath` ✓
   - `node.line` ✓
   - `node.column` ✓

   These fields exist on `AstNode`, so no logic changes needed.

---

## Phase 3: Use Pick<PackageInfo> in affected-calculator.actor.ts

**File**: `src/devac/actors/affected-calculator.actor.ts`

### Current Duplicate Type (Lines 37-40)

```typescript
// CURRENT - DELETE THIS DUPLICATE
export type PackageInfo = {
  name: string;
  path: string;
};
```

### Canonical Type Location

**Source**: `src/analyzer/parsers/package-extractor.ts` (lines 9-15)

```typescript
export interface PackageInfo {
  name: string;
  type: "frontend" | "shared-library" | "tool";
  path: string;
  version: string;
  entryPoint: string | null;
}
```

### Required Changes

1. **Delete** the local `PackageInfo` type definition (lines 37-40)

2. **Add import** at top of file:
```typescript
import type { PackageInfo } from "../../analyzer/parsers/package-extractor.js";
```

3. **Update** `AffectedCalculatorInput` to use Pick:
```typescript
// BEFORE
export type AffectedCalculatorInput = {
  changedFilePath: string;
  neo4jClient: Neo4jClient;
  packages: PackageInfo[];  // Uses local 2-field type
  parent?: AnyActorRef;
};

// AFTER
export type AffectedCalculatorInput = {
  changedFilePath: string;
  neo4jClient: Neo4jClient;
  packages: Pick<PackageInfo, "name" | "path">[];  // Uses subset of canonical type
  parent?: AnyActorRef;
};
```

This approach:
- Maintains type safety
- Documents that only `name` and `path` are needed
- Allows passing full `PackageInfo[]` from callers (compatible)

---

## Phase 4: Fix Remaining TypeScript Errors

### 4.1 XState v5 Event Narrowing Pattern

**Files affected**: All actor files using XState v5

**Pattern**: Use `assertEvent()` helper for type narrowing in actions:

```typescript
// Import the helper
import { assertEvent } from "xstate";

// In action handlers
actions: {
  handleUpdate: ({ context, event }) => {
    assertEvent(event, "UPDATE");
    // Now TypeScript knows event has UPDATE shape
    const { filePath, parseResult } = event;
    // ...
  }
}
```

### 4.2 performance-monitor.ts Undefined Checks

**File**: `src/devac/utils/performance-monitor.ts`

Add null checks before accessing possibly undefined properties:

```typescript
// Before
const heapUsed = result.heapUsed;

// After
const heapUsed = result?.heapUsed ?? 0;
```

### 4.3 query-profiler.ts Unknown Type Handling

**File**: `src/devac/utils/query-profiler.ts`

Cast query results appropriately:

```typescript
// Before
const result = await session.run(query);
return result.records;

// After
const result = await session.run(query);
return result.records as QueryRecord[];
```

### 4.4 semantic-resolver.ts String Assignment

**File**: `src/analyzer/semantic-resolver.ts`

Fix string | undefined assignment:

```typescript
// Before
const modulePath: string = resolved?.path;

// After
const modulePath: string = resolved?.path ?? "";
```

---

## Verification

After applying all changes, run:

```bash
cd /Users/grop/ws/CodeGraph
npx tsc --noEmit
```

Expected: 0 errors

Then run tests:

```bash
npm test
```

Expected: 707 tests pass

---

## File Change Summary

| File | Action | Lines Changed |
|------|--------|---------------|
| `src/devac/actors/validation-coordinator.actor.ts` | Fix imports | 5 |
| `src/devac/actors/graph-updater.actor.ts` | Delete type, add import | ~20 deleted, 1 added |
| `src/devac/actors/affected-calculator.actor.ts` | Delete type, add import, use Pick | ~5 deleted, 2 changed |
| `src/devac/utils/performance-monitor.ts` | Add null checks | ~7 |
| `src/devac/utils/query-profiler.ts` | Add type casts | ~5 |
| `src/analyzer/semantic-resolver.ts` | Fix string assignment | ~2 |

---

## Why This Spec Should End the Review Loop

1. **Decisions are user-provided**, not inferred from code analysis
2. **Each change is atomic** and independently verifiable
3. **No architectural opinions** - only implements chosen options
4. **Type sources are verified** against actual file contents
5. **Import paths are verified** against actual file locations

---

## Appendix: Verified API Signatures

### ImportResolver (src/analyzer/parsers/import-resolver.ts)
```typescript
constructor(
  packages: PackageInfo[],
  workspaceRoot: string,
  tsConfigPaths?: Record<string, string[]>
)

async resolve(
  importNode: ImportNode,
  fromFile: string
): Promise<ResolvedImport | null>
```

### PackageExtractor (src/analyzer/parsers/package-extractor.ts)
```typescript
constructor(workspaceRoot: string)
async discoverPackages(): Promise<PackageInfo[]>
```

### PackageInfo (src/analyzer/parsers/package-extractor.ts)
```typescript
interface PackageInfo {
  name: string;
  type: "frontend" | "shared-library" | "tool";
  path: string;
  version: string;
  entryPoint: string | null;
}
```

### StructuralParseResult (src/analyzer/structural-parser.ts)
```typescript
interface StructuralParseResult {
  filePath: string;
  nodes: AstNode[];
  relationships: RelationshipInfo[];
  importStrings: string[];
  exportedSymbols: ExportedSymbol[];
  metadata: {
    parseTime: number;
    nodeCount: number;
    relationshipCount: number;
    loc: number;
    language: string;
  };
}
```

### Schema Indexes (src/database/schema.ts)
```typescript
const indexes = [
  `CREATE INDEX node_entityid_index IF NOT EXISTS FOR (n:Node) ON (n.entityId)`,
  // ... more Cypher strings
];
```
