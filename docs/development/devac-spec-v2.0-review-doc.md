# DevAC Spec v2.0 - Comprehensive Architecture Documentation

**Date:** 2025-12-14  
**Purpose:** Detailed technical documentation explaining how the v2.0 architecture works with and without the identified critical fixes  
**Audience:** Technical decision-makers reviewing the spec for implementation approval

---

## Table of Contents

1. [Overview](#1-overview)
2. [Current v1.x Architecture (Baseline)](#2-current-v1x-architecture-baseline)
3. [Proposed v2.0 Architecture](#3-proposed-v20-architecture)
4. [Critical Fixes Impact Analysis](#4-critical-fixes-impact-analysis)
5. [Flow Diagrams](#5-flow-diagrams)
6. [State Machine Diagrams](#6-state-machine-diagrams)
7. [Sequence Diagrams](#7-sequence-diagrams)
8. [Risk Assessment Matrix](#8-risk-assessment-matrix)
9. [Decision Framework](#9-decision-framework)

---

## 1. Overview

### 1.1 What is DevAC v2.0?

DevAC v2.0 represents a major architectural pivot from a Neo4j-based graph database backend to a DuckDB+Parquet file-based storage system. The goal is to:

1. **Eliminate server dependency** - No Neo4j server required
2. **Improve performance** - Faster queries with columnar storage
3. **Enable federation** - Per-package, per-branch data partitioning
4. **Simplify sync** - "Source is truth" eliminates reconciliation

### 1.2 Current Codebase Components (v1.x)

The existing codebase in `/Users/grop/ws/CodeGraph/` already implements:

| Component | Location | Status |
|-----------|----------|--------|
| StructuralParser (Babel) | `src/analyzer/structural-parser.ts` | ✅ Ready for v2.0 |
| Parser (ts-morph) | `src/analyzer/parser.ts` | ✅ Keep for semantic |
| AnalyzerService | `src/analyzer/analyzer-service.ts` | 🔄 Needs modification |
| RelationshipResolver | `src/analyzer/relationship-resolver.ts` | ✅ Portable |
| StorageManager | `src/analyzer/storage-manager.ts` | ❌ Replace with SeedWriter |
| Neo4jClient | `src/database/neo4j-client.ts` | ❌ Remove |
| FileScanner | `src/scanner/file-scanner.ts` | ✅ Keep |

### 1.3 Review Findings Summary

Three independent AI reviewers (Claude, GPT, Gemini) evaluated the v2.0 spec:

- **Architecture:** ✅ Approved unanimously
- **Error Handling:** ❌ Critical gaps identified
- **Concurrency:** ❌ No protection mechanism
- **Performance:** ⚠️ Inconsistent targets

---

## 2. Current v1.x Architecture (Baseline)

### 2.1 Current Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CURRENT v1.x FLOW                             │
└─────────────────────────────────────────────────────────────────────┘

┌──────────┐     ┌─────────────┐     ┌────────┐     ┌───────────────┐
│Directory │────▶│ FileScanner │────▶│ Parser │────▶│StorageManager │
└──────────┘     └─────────────┘     └────────┘     └───────────────┘
                                          │                  │
                                          ▼                  ▼
                              ┌───────────────────┐   ┌───────────┐
                              │RelationshipResolver│  │Neo4jClient│
                              └───────────────────┘   └───────────┘
                                          │                  │
                                          └────────┬─────────┘
                                                   ▼
                                          ┌─────────────┐
                                          │  Neo4j DB   │
                                          │  (Server)   │
                                          └─────────────┘
```

### 2.2 Current Code Structure

**AnalyzerService.analyze() Flow:**

```typescript
// src/analyzer/analyzer-service.ts (simplified)

async analyze(directory: string): Promise<void> {
  // 1. Scan files
  const files = await scanner.scan();
  
  // 2. Pass 1: Parse files (structural)
  await this.parser.parseFiles(files);
  const { allNodes, allRelationships } = await this.parser.collectResults();
  
  // 3. Pass 2: Resolve relationships (semantic)
  const resolver = new RelationshipResolver(allNodes, allRelationships);
  const pass2Relationships = await resolver.resolveRelationships(tsProject);
  
  // 4. Store to Neo4j
  await this.storageManager.saveNodesBatch(allNodes);
  await this.storageManager.saveRelationshipsBatch(type, relationships);
  
  // 5. Cleanup
  await this.neo4jClient.closeDriver();
}
```

### 2.3 Current Problems (Why v2.0?)

| Problem | Impact | Evidence |
|---------|--------|----------|
| Neo4j server dependency | Complex deployment | Requires Neo4j Desktop/Server |
| NodeIndexCache overhead | Memory issues | Was removed as symptom fix |
| Complex sync logic | Error-prone | Reconciliation edge cases |
| Single database | No multi-repo support | Can't federate |

---

## 3. Proposed v2.0 Architecture

### 3.1 New Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PROPOSED v2.0 FLOW                            │
└─────────────────────────────────────────────────────────────────────┘

┌──────────┐     ┌─────────────┐     ┌───────────────┐     ┌──────────┐
│Directory │────▶│ FileScanner │────▶│LanguageRouter │────▶│ Parser   │
└──────────┘     └─────────────┘     └───────────────┘     └──────────┘
                                                                 │
                                                                 ▼
                                          ┌───────────────────────────┐
                                          │      SeedWriter           │
                                          │  (Atomic Parquet Write)   │
                                          └───────────────────────────┘
                                                       │
                                    ┌──────────────────┼──────────────────┐
                                    ▼                  ▼                  ▼
                             ┌───────────┐      ┌───────────┐      ┌───────────┐
                             │ nodes.pq  │      │ edges.pq  │      │ meta.pq   │
                             └───────────┘      └───────────┘      └───────────┘
                                    │                  │                  │
                                    └──────────────────┼──────────────────┘
                                                       ▼
                                          ┌───────────────────────────┐
                                          │        DuckDB             │
                                          │   (In-Process Query)      │
                                          └───────────────────────────┘
```

### 3.2 Key Architectural Changes

| Aspect | v1.x | v2.0 |
|--------|------|------|
| Storage | Neo4j (server) | Parquet files |
| Query Engine | Neo4j (Cypher) | DuckDB (SQL) |
| Data Model | Property Graph | Columnar Tables |
| Partitioning | None | Per-package-per-branch |
| Sync Model | Reconcile | Source is truth |
| Write Pattern | Batch to server | Atomic file rename |

### 3.3 New Component Definitions

**SeedWriter Interface (replaces StorageManager):**

```typescript
// Proposed new interface
interface SeedWriter {
  // Write entire package data atomically
  writePackage(packagePath: string, data: SeedData): Promise<void>;
  
  // Stream mode for watch (single file)
  writeFile(result: StructuralParseResult): Promise<void>;
  
  // Delete file data
  deleteFile(filePath: string): Promise<void>;
  
  // Read for querying
  readPackage(packagePath: string): Promise<SeedData>;
}

interface SeedData {
  nodes: ParquetTable;
  edges: ParquetTable;
  metadata: ParquetTable;
}
```

**LanguageRouter Interface (extracted from Parser):**

```typescript
// Proposed extraction from current Parser class
interface LanguageRouter {
  // Route to appropriate parser based on extension
  getParser(filePath: string): LanguageParser;
  
  // Get supported extensions for FileWatcher filtering
  getSupportedExtensions(): string[];
  
  // Check if file type is supported
  isSupported(filePath: string): boolean;
}

interface LanguageParser {
  parse(filePath: string): Promise<StructuralParseResult>;
}
```

### 3.4 Directory Structure (v2.0)

```
project-root/
├── .devac/
│   └── seed/
│       ├── .lock                    # Advisory lock file (NEW - from C1)
│       ├── manifest.json            # Package registry
│       ├── base/                    # Main branch data
│       │   └── @scope/
│       │       └── package-name/
│       │           ├── nodes.parquet
│       │           ├── edges.parquet
│       │           └── meta.parquet
│       └── branch/                  # Feature branch deltas
│           └── feature-xyz/
│               └── @scope/
│                   └── package-name/
│                       ├── nodes.parquet  # Changed/added nodes
│                       ├── edges.parquet  # Changed/added edges
│                       └── meta.parquet
```

---

## 4. Critical Fixes Impact Analysis

The review identified 4 CRITICAL issues (C1-C4) that must be addressed before Phase 1 starts. This section explains each fix and its impact.

### 4.1 C1: Concurrent Write Protection

**Problem:** No mechanism prevents two processes from writing simultaneously.

**Without Fix (DANGER):**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CONCURRENT WRITE - NO PROTECTION                  │
└─────────────────────────────────────────────────────────────────────┘

  Terminal A                          Terminal B
      │                                   │
      ▼                                   ▼
  devac analyze                       devac analyze
      │                                   │
      ▼                                   ▼
  Read nodes.parquet ────────┐    ┌──── Read nodes.parquet
      │                      │    │         │
  Parse file1.ts             │    │     Parse file2.ts
      │                      │    │         │
  Merge into buffer          │    │     Merge into buffer
      │                      │    │         │
  Write temp-a.parquet       │    │     Write temp-b.parquet
      │                      │    │         │
      ▼                      │    │         ▼
  rename(temp-a, nodes.pq) ──┴────┴──▶ rename(temp-b, nodes.pq)
                                            │
                                            ▼
                              ❌ file1.ts DATA LOST!
                              (Terminal A's changes overwritten)
```

**With Fix (SAFE):**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CONCURRENT WRITE - WITH LOCK FILE                 │
└─────────────────────────────────────────────────────────────────────┘

  Terminal A                          Terminal B
      │                                   │
      ▼                                   ▼
  devac analyze                       devac analyze
      │                                   │
      ▼                                   ▼
  Acquire .lock ──────────────────────▶ Try acquire .lock
      │                                   │
      │ (Lock acquired)                   │ ❌ Lock held!
      ▼                                   ▼
  Read nodes.parquet                  Wait / Abort / Queue
      │                                   │
  Parse files                             │
      │                                   │
  Write temp.parquet                      │
      │                                   │
  rename(temp, nodes.pq)                  │
      │                                   │
  Release .lock ─────────────────────────▶ (Now can acquire)
      │                                   │
      ▼                                   ▼
  ✅ Success                          Process normally
```

**Lock Implementation:**

```typescript
// Proposed lock mechanism
class SeedLock {
  private lockPath: string;
  private lockFd: number | null = null;
  
  async acquire(timeout: number = 30000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        // Exclusive lock using fs.open with O_EXCL
        this.lockFd = await fs.open(this.lockPath, 'wx');
        await fs.writeFile(this.lockPath, JSON.stringify({
          pid: process.pid,
          acquired: new Date().toISOString(),
          hostname: os.hostname()
        }));
        return true;
      } catch (e) {
        if (e.code === 'EEXIST') {
          // Check if lock is stale (process died)
          if (await this.isLockStale()) {
            await fs.unlink(this.lockPath);
            continue;
          }
          await sleep(100);
        } else throw e;
      }
    }
    return false;
  }
  
  async release(): Promise<void> {
    if (this.lockFd) {
      await fs.close(this.lockFd);
      await fs.unlink(this.lockPath);
      this.lockFd = null;
    }
  }
  
  private async isLockStale(): Promise<boolean> {
    try {
      const content = JSON.parse(await fs.readFile(this.lockPath, 'utf8'));
      // Lock is stale if process no longer exists
      return !process.kill(content.pid, 0);
    } catch { return true; }
  }
}
```

### 4.2 C2: Error Classification

**Problem:** No distinction between retryable and terminal errors.

**Without Fix (CHAOS):**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ERROR HANDLING - NO CLASSIFICATION                │
└─────────────────────────────────────────────────────────────────────┘

  Parse file.ts
      │
      ▼
  ❌ Error occurs
      │
      ▼
  What type?
      │
      ├───▶ Syntax error?        → ???
      ├───▶ Network timeout?     → ???
      ├───▶ Disk full?           → ???
      ├───▶ File locked?         → ???
      └───▶ Corrupt parquet?     → ???
      
  All treated the same:
      │
      ▼
  throw Error("Something went wrong")  ← No recovery strategy
```

**With Fix (STRUCTURED):**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ERROR HANDLING - WITH CLASSIFICATION              │
└─────────────────────────────────────────────────────────────────────┘

  Parse file.ts
      │
      ▼
  ❌ Error occurs
      │
      ▼
  Classify error
      │
      ├───▶ RETRYABLE_TRANSIENT (network, lock)
      │         │
      │         ▼
      │     Retry with exponential backoff (max 3 attempts)
      │         │
      │         └───▶ Success? Continue : Escalate to terminal
      │
      ├───▶ RETRYABLE_USER (syntax error)
      │         │
      │         ▼
      │     Log warning, skip file, continue with others
      │     Mark file as "needs_attention" in metadata
      │
      ├───▶ TERMINAL_RECOVERABLE (corrupt parquet)
      │         │
      │         ▼
      │     Delete corrupt file, trigger re-parse from source
      │     Log for audit trail
      │
      └───▶ TERMINAL_FATAL (disk full, permissions)
                │
                ▼
            Stop immediately, surface clear error message
            Preserve partial state for debugging
```

**Error Classification Schema:**

```typescript
enum ErrorType {
  // Retry automatically
  RETRYABLE_TRANSIENT = 'RETRYABLE_TRANSIENT',  // Network, locks
  
  // Skip and continue
  RETRYABLE_USER = 'RETRYABLE_USER',            // Syntax errors
  
  // Auto-recover
  TERMINAL_RECOVERABLE = 'TERMINAL_RECOVERABLE', // Corrupt data
  
  // Stop and report
  TERMINAL_FATAL = 'TERMINAL_FATAL'              // System errors
}

interface ClassifiedError {
  type: ErrorType;
  original: Error;
  context: {
    filePath?: string;
    operation?: string;
    attempt?: number;
  };
  recovery?: RecoveryAction;
}

interface RecoveryAction {
  action: 'retry' | 'skip' | 'regenerate' | 'abort';
  delay?: number;
  maxAttempts?: number;
}
```

### 4.3 C3: Corrupt Parquet Recovery

**Problem:** No integrity check or auto-recovery for corrupted seed files.

**Without Fix (STUCK):**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CORRUPTION SCENARIO - NO RECOVERY                 │
└─────────────────────────────────────────────────────────────────────┘

  Power failure during write
      │
      ▼
  nodes.parquet = CORRUPT
      │
      ▼
  User runs: devac query
      │
      ▼
  DuckDB.read(nodes.parquet)
      │
      ▼
  ❌ "Parquet magic bytes invalid"
      │
      ▼
  User confused, no guidance
      │
      ▼
  Manual deletion required
  Re-run full analysis
  Hours of work lost
```

**With Fix (AUTO-RECOVER):**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CORRUPTION SCENARIO - AUTO RECOVERY               │
└─────────────────────────────────────────────────────────────────────┘

  Power failure during write
      │
      ▼
  nodes.parquet = CORRUPT
      │
      ▼
  User runs: devac query
      │
      ▼
  SeedReader.readWithIntegrity(nodes.parquet)
      │
      ├───▶ Check 1: File exists?
      │         └───▶ If no: Mark as "needs_regeneration"
      │
      ├───▶ Check 2: Valid Parquet magic bytes?
      │         └───▶ If no: Mark as "corrupted"
      │
      ├───▶ Check 3: Row count matches metadata?
      │         └───▶ If no: Mark as "incomplete"
      │
      └───▶ Check 4: Can read footer/schema?
                └───▶ If no: Mark as "damaged"
      │
      ▼
  Corruption detected!
      │
      ▼
  Automatic recovery:
      │
      ├───▶ Log corruption details for audit
      ├───▶ Delete corrupt file
      ├───▶ Scan source files for package
      ├───▶ Re-parse and regenerate parquet
      └───▶ Notify user (non-blocking)
      │
      ▼
  ✅ Query proceeds with fresh data
```

**Integrity Check Implementation:**

```typescript
interface IntegrityCheckResult {
  isValid: boolean;
  issues: IntegrityIssue[];
  recommendation: 'proceed' | 'regenerate' | 'abort';
}

interface IntegrityIssue {
  type: 'missing' | 'corrupted' | 'incomplete' | 'schema_mismatch';
  file: string;
  details: string;
}

class SeedIntegrityChecker {
  async check(packagePath: string): Promise<IntegrityCheckResult> {
    const issues: IntegrityIssue[] = [];
    
    // Check each parquet file
    for (const file of ['nodes.parquet', 'edges.parquet', 'meta.parquet']) {
      const filePath = path.join(packagePath, file);
      
      // Check 1: File exists
      if (!await fs.exists(filePath)) {
        issues.push({ type: 'missing', file, details: 'File not found' });
        continue;
      }
      
      // Check 2: Magic bytes
      const buffer = await fs.readFile(filePath, { length: 4 });
      if (buffer.toString() !== 'PAR1') {
        issues.push({ type: 'corrupted', file, details: 'Invalid magic bytes' });
        continue;
      }
      
      // Check 3: Can read with DuckDB
      try {
        await duckdb.query(`SELECT COUNT(*) FROM '${filePath}'`);
      } catch (e) {
        issues.push({ type: 'corrupted', file, details: e.message });
      }
    }
    
    return {
      isValid: issues.length === 0,
      issues,
      recommendation: issues.some(i => i.type === 'corrupted') 
        ? 'regenerate' 
        : issues.length > 0 ? 'abort' : 'proceed'
    };
  }
}
```

### 4.4 C4: Entity ID Encoding

**Problem:** Entity ID generation lacks explicit specification for encoding and normalization.

**Without Fix (CROSS-PARSER DRIFT):**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ENTITY ID - INCONSISTENT ENCODING                 │
└─────────────────────────────────────────────────────────────────────┘

  TypeScript Parser                   Python Parser
        │                                   │
        ▼                                   ▼
  Process file: café.ts              Process file: café.py
        │                                   │
        ▼                                   ▼
  entityId =                          entityId = 
  sha256("café" as UTF-8)             sha256("café" as Latin-1)
        │                                   │
        ▼                                   ▼
  "a1b2c3..."                         "x7y8z9..."  ← DIFFERENT!
        │                                   │
        └────────────┬────────────────────────┘
                     │
                     ▼
        Cross-file relationship fails!
        Can't link café.ts imports to café.py exports
```

**With Fix (DETERMINISTIC):**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ENTITY ID - NORMALIZED ENCODING                   │
└─────────────────────────────────────────────────────────────────────┘

  TypeScript Parser                   Python Parser
        │                                   │
        ▼                                   ▼
  Process file: café.ts              Process file: café.py
        │                                   │
        ▼                                   ▼
  normalize(filePath):                normalize(filePath):
    1. Convert backslash to /           1. Convert backslash to /
    2. Unicode NFC normalize            2. Unicode NFC normalize
    3. Lowercase                        3. Lowercase
    4. Encode as UTF-8                  4. Encode as UTF-8
        │                                   │
        ▼                                   ▼
  entityId =                          entityId = 
  generateEntityId(normalized)        generateEntityId(normalized)
        │                                   │
        ▼                                   ▼
  "a1b2c3..."                         matches reference
        │                                   │
        └────────────┬────────────────────────┘
                     │
                     ▼
        ✅ Cross-file relationships work!
```

**Entity ID Generation Specification:**

```typescript
/**
 * Entity ID generation rules (C4 fix)
 * 
 * Format: {kind}:{repo}:{package}:{scope_hash}
 * 
 * Normalization steps (MUST be applied in order):
 * 1. Path separator: Replace all \ with /
 * 2. Unicode: Apply NFC normalization
 * 3. Case: Lowercase for case-insensitive matching
 * 4. Encoding: UTF-8
 * 5. Hash: SHA-256, first 16 hex characters
 */
function generateEntityId(
  kind: string,
  filePath: string,
  name: string,
  line: number,
  column: number
): string {
  // Step 1: Normalize path
  const normalizedPath = normalizePath(filePath);
  
  // Step 2: Build scope string
  const scopeString = `${normalizedPath}:${name}:${line}:${column}`;
  
  // Step 3: Generate hash
  const hash = crypto
    .createHash('sha256')
    .update(scopeString, 'utf8')  // Explicit UTF-8
    .digest('hex')
    .substring(0, 16);
  
  return `${kind}:${hash}`;
}

function normalizePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')           // Step 1: Backslash to forward slash
    .normalize('NFC')              // Step 2: Unicode normalization
    .toLowerCase();                // Step 3: Lowercase
}
```

---

## 5. Flow Diagrams

### 5.1 Complete Analysis Flow (v2.0 with fixes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DEVAC v2.0 ANALYSIS FLOW                           │
│                            (With All Fixes Applied)                          │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │  User runs   │
                              │devac analyze │
                              └──────┬───────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │ C1: Acquire .lock   │
                          │  (with timeout)     │
                          └──────────┬──────────┘
                                     │
                   ┌─────────────────┼─────────────────┐
                   │                 │                 │
                   ▼                 ▼                 ▼
             Lock acquired     Lock timeout      Lock stale
                   │                 │                 │
                   │                 ▼                 ▼
                   │           Return error    Clean & retry
                   │                                   │
                   └───────────────────────────────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │ C3: Check integrity │
                          │ of existing seeds   │
                          └──────────┬──────────┘
                                     │
                   ┌─────────────────┼─────────────────┐
                   │                 │                 │
                   ▼                 ▼                 ▼
             Seeds valid      Seeds missing    Seeds corrupt
                   │                 │                 │
                   │                 ▼                 ▼
                   │           Full re-parse    Delete & re-parse
                   │                 │                 │
                   └─────────────────┴─────────────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │   FileScanner       │
                          │   Find all files    │
                          └──────────┬──────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │   LanguageRouter    │
                          │ Route to parser     │
                          └──────────┬──────────┘
                                     │
                   ┌─────────────────┼─────────────────┐
                   │                 │                 │
                   ▼                 ▼                 ▼
              .ts/.tsx          .py files        .java/.go
                   │                 │                 │
                   ▼                 ▼                 ▼
           ┌────────────┐   ┌────────────┐   ┌────────────┐
           │TS Parser   │   │Python      │   │TreeSitter  │
           │(Babel/     │   │Parser      │   │Parser      │
           │ ts-morph)  │   │(subprocess)│   │            │
           └─────┬──────┘   └─────┬──────┘   └─────┬──────┘
                 │                │                │
                 └────────────────┴────────────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │ C2: Error handling  │
                       │ with classification │
                       └──────────┬──────────┘
                                  │
                ┌─────────────────┼─────────────────┐
                │                 │                 │
                ▼                 ▼                 ▼
           Success         Retryable          Terminal
                │                │                 │
                │                ▼                 ▼
                │          Retry/Skip         Log & abort
                │                │
                └────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ C4: Normalize IDs   │
              │ (UTF-8, NFC, case)  │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │    SeedWriter       │
              │ Atomic Parquet      │
              │ write (temp+rename) │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ Release .lock       │
              │ Cleanup temp files  │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │    ✅ Complete      │
              └─────────────────────┘
```

### 5.2 Incremental Update Flow (Watch Mode)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        WATCH MODE INCREMENTAL UPDATE                         │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────┐                              ┌─────────────┐
  │  chokidar   │                              │  DuckDB     │
  │  watcher    │                              │  Query      │
  └──────┬──────┘                              └──────▲──────┘
         │                                            │
         │ File change event                          │
         ▼                                            │
  ┌─────────────┐                                     │
  │  Debounce   │ 100-300ms                           │
  │  (coalesce) │                                     │
  └──────┬──────┘                                     │
         │                                            │
         ▼                                            │
  ┌─────────────┐                                     │
  │ Hash check  │ File content hash                   │
  │ (skip if    │ vs stored hash                      │
  │  unchanged) │                                     │
  └──────┬──────┘                                     │
         │                                            │
         │ Changed?                                   │
         │                                            │
    Yes  │  No                                        │
    ┌────┴────┐                                       │
    │         │                                       │
    ▼         ▼                                       │
┌───────┐  Skip                                       │
│Parse  │  (no-op)                                    │
│file   │                                             │
└───┬───┘                                             │
    │                                                 │
    ▼                                                 │
┌────────────────┐                                    │
│ Acquire .lock  │ Per-package lock                   │
│ (wait or queue)│                                    │
└───────┬────────┘                                    │
        │                                             │
        ▼                                             │
┌────────────────┐                                    │
│ Read existing  │                                    │
│ package.parquet│                                    │
└───────┬────────┘                                    │
        │                                             │
        ▼                                             │
┌────────────────┐                                    │
│ Merge changes: │                                    │
│ - Remove old   │                                    │
│   file entries │                                    │
│ - Add new      │                                    │
│   parse result │                                    │
└───────┬────────┘                                    │
        │                                             │
        ▼                                             │
┌────────────────┐                                    │
│ Write temp.pq  │                                    │
│ then rename    │ Atomic operation                   │
│ to nodes.pq    │                                    │
└───────┬────────┘                                    │
        │                                             │
        ▼                                             │
┌────────────────┐                                    │
│ Release .lock  │                                    │
│ Update in-mem  │ ────────────────────────────────────┘
│ cache          │
└────────────────┘
```

---

## 6. State Machine Diagrams

### 6.1 SeedWriter State Machine

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SEEDWRITER STATE MACHINE                             │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │    IDLE      │
                              └──────┬───────┘
                                     │ write() called
                                     ▼
                          ┌─────────────────────┐
                          │  ACQUIRING_LOCK     │
                          └──────────┬──────────┘
                                     │
                   ┌─────────────────┼─────────────────┐
                   │                 │                 │
            Lock acquired     Lock timeout        Lock stale
                   │                 │                 │
                   ▼                 ▼                 ▼
            ┌──────────┐      ┌──────────┐      ┌──────────┐
            │ LOCKED   │      │  ERROR   │      │CLEANING  │
            └────┬─────┘      └──────────┘      │ LOCK     │
                 │                              └────┬─────┘
                 │                                   │
                 ▼                                   │
          ┌───────────────┐                          │
          │  READING      │◀─────────────────────────┘
          │  EXISTING     │
          └───────┬───────┘
                  │
                  │
            ┌─────┴─────┐
            │           │
      Read success  Read error
            │           │
            ▼           ▼
     ┌───────────┐ ┌───────────┐
     │  MERGING  │ │RECOVERING │
     └─────┬─────┘ │ (C3 fix)  │
           │       └─────┬─────┘
           │             │
           ▼             │
     ┌───────────┐       │
     │  WRITING  │       │
     │  TEMP     │◀──────┘
     └─────┬─────┘
           │
           │
     ┌─────┴─────┐
     │           │
  Write OK   Write fail
     │           │
     ▼           ▼
┌──────────┐ ┌──────────┐
│ RENAMING │ │ CLEANUP  │
└────┬─────┘ │ TEMP     │
     │       └────┬─────┘
     │            │
     ▼            ▼
┌──────────┐ ┌──────────┐
│ RELEASE  │ │  ERROR   │
│  LOCK    │ └──────────┘
└────┬─────┘
     │
     ▼
┌──────────┐
│ SUCCESS  │
└──────────┘
```

### 6.2 Analysis Pipeline State Machine

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ANALYSIS PIPELINE STATE MACHINE                        │
└─────────────────────────────────────────────────────────────────────────────┘

States:
  [INIT] ──▶ [SCANNING] ──▶ [PASS1_PARSING] ──▶ [PASS2_RESOLVING] ──▶ [STORING] ──▶ [COMPLETE]
                                    │                   │                │
                                    ▼                   ▼                ▼
                               [ERROR_RECOVERY]   [ERROR_RECOVERY]  [ERROR_RECOVERY]
                                    │                   │                │
                                    │                   │                │
                                    ├───────────────────┴────────────────┤
                                    │                                    │
                                    ▼                                    ▼
                              [RETRY_FILE]                          [FATAL_ERROR]


Transitions:

INIT → SCANNING
  trigger: analyze() called
  action: Initialize scanner, acquire global lock

SCANNING → PASS1_PARSING  
  trigger: scan() returns files
  action: Create parse queue

PASS1_PARSING → PASS2_RESOLVING
  trigger: All files parsed or skipped
  action: Collect nodes, prepare resolver

PASS1_PARSING → ERROR_RECOVERY
  trigger: C2 classified error
  action: Apply recovery strategy

ERROR_RECOVERY → RETRY_FILE
  trigger: RETRYABLE_TRANSIENT
  action: Exponential backoff, retry

ERROR_RECOVERY → PASS1_PARSING
  trigger: RETRYABLE_USER (skip file)
  action: Log warning, continue

ERROR_RECOVERY → FATAL_ERROR
  trigger: TERMINAL_FATAL
  action: Cleanup, report error

PASS2_RESOLVING → STORING
  trigger: Resolution complete
  action: Prepare batch write

STORING → COMPLETE
  trigger: All writes successful
  action: Release lock, cleanup temp

STORING → ERROR_RECOVERY
  trigger: Write failure
  action: C3 recovery or abort
```

---

## 7. Sequence Diagrams

### 7.1 Full Analysis Sequence (with fixes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FULL ANALYSIS SEQUENCE                              │
└─────────────────────────────────────────────────────────────────────────────┘

 User          CLI         LockMgr      Scanner      Router       Parser      SeedWriter
  │             │             │            │            │            │            │
  │ analyze()   │             │            │            │            │            │
  │────────────▶│             │            │            │            │            │
  │             │             │            │            │            │            │
  │             │ acquire()   │            │            │            │            │
  │             │────────────▶│            │            │            │            │
  │             │             │            │            │            │            │
  │             │   ◀─────────│ lock_held  │            │            │            │
  │             │             │            │            │            │            │
  │             │  (C3) checkIntegrity()   │            │            │            │
  │             │────────────────────────────────────────────────────▶│            │
  │             │             │            │            │            │ check      │
  │             │             │            │            │            │────────────▶│
  │             │             │            │            │            │   ◀────────│
  │             │   ◀────────────────────────────────────────────────│ valid/regen│
  │             │             │            │            │            │            │
  │             │  scan()     │            │            │            │            │
  │             │─────────────────────────▶│            │            │            │
  │             │             │            │ files[]    │            │            │
  │             │   ◀─────────────────────│            │            │            │
  │             │             │            │            │            │            │
  │             │             │            │            │            │            │
  │             │  ┌──────────loop for each file────────────────────┐│            │
  │             │  │          │            │            │            ││            │
  │             │  │ route()  │            │            │            ││            │
  │             │  │────────────────────────────────────▶│           ││            │
  │             │  │          │            │  parser    │            ││            │
  │             │  │  ◀────────────────────────────────│            ││            │
  │             │  │          │            │            │            ││            │
  │             │  │  parse() │            │            │            ││            │
  │             │  │─────────────────────────────────────────────────▶│            │
  │             │  │          │            │            │            ││            │
  │             │  │   (C2) on error: classify & handle              ││            │
  │             │  │          │            │            │            ││            │
  │             │  │  (C4) normalize entityIds                       ││            │
  │             │  │          │            │            │            ││            │
  │             │  │  result  │            │            │            ││            │
  │             │  │  ◀───────────────────────────────────────────────│            │
  │             │  │          │            │            │            ││            │
  │             │  └──────────────────────────────────────────────────┘│            │
  │             │             │            │            │            │            │
  │             │  writeBatch()            │            │            │            │
  │             │─────────────────────────────────────────────────────────────────▶│
  │             │             │            │            │            │   atomic   │
  │             │             │            │            │            │   write    │
  │             │   ◀──────────────────────────────────────────────────────────────│
  │             │             │            │            │            │            │
  │             │  release()  │            │            │            │            │
  │             │────────────▶│            │            │            │            │
  │             │   ◀─────────│ released   │            │            │            │
  │             │             │            │            │            │            │
  │   complete  │             │            │            │            │            │
  │◀────────────│             │            │            │            │            │
```

### 7.2 Concurrent Access Sequence (prevented by C1)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CONCURRENT ACCESS PREVENTION (C1)                         │
└─────────────────────────────────────────────────────────────────────────────┘

 Terminal A      LockMgr     Terminal B
     │              │             │
     │ acquire()    │             │
     │─────────────▶│             │
     │              │             │
     │ ◀────────────│ granted    │
     │              │             │
     │              │  acquire()  │
     │              │◀────────────│
     │              │             │
     │              │ "lock held by PID 1234"
     │              │────────────▶│
     │              │             │
     │              │             │ (waits or aborts)
     │              │             │
     │  (does work) │             │
     │              │             │
     │ release()    │             │
     │─────────────▶│             │
     │              │             │
     │ ◀────────────│ released   │
     │              │             │
     │              │  retry()    │
     │              │◀────────────│
     │              │             │
     │              │────────────▶│ granted
     │              │             │
     │              │             │ (proceeds safely)
```

### 7.3 Error Recovery Sequence (C2 + C3)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ERROR RECOVERY SEQUENCE                              │
└─────────────────────────────────────────────────────────────────────────────┘

 Parser        ErrorClassifier    RecoveryHandler    SeedWriter
    │                 │                  │                │
    │ parse() throws  │                  │                │
    │ SyntaxError     │                  │                │
    │                 │                  │                │
    │ classify()      │                  │                │
    │────────────────▶│                  │                │
    │                 │                  │                │
    │ ◀───────────────│ RETRYABLE_USER  │                │
    │                 │                  │                │
    │ handleError()   │                  │                │
    │─────────────────────────────────────▶│                │
    │                 │                  │                │
    │                 │   skip_file      │                │
    │ ◀──────────────────────────────────│                │
    │                 │                  │                │
    │ (continues with next file)         │                │
    │                 │                  │                │
    │                 │                  │                │
  ═══════════════════════════════════════════════════════════════════
    │                 │                  │                │
    │ read() throws   │                  │                │
    │ ParquetCorrupt  │                  │                │
    │                 │                  │                │
    │ classify()      │                  │                │
    │────────────────▶│                  │                │
    │                 │                  │                │
    │ ◀───────────────│ TERMINAL_RECOVERABLE             │
    │                 │                  │                │
    │ handleError()   │                  │                │
    │─────────────────────────────────────▶│                │
    │                 │                  │                │
    │                 │                  │ deleteCorrupt()│
    │                 │                  │───────────────▶│
    │                 │                  │                │
    │                 │                  │ ◀──────────────│
    │                 │                  │                │
    │                 │   regenerate     │                │
    │ ◀──────────────────────────────────│                │
    │                 │                  │                │
    │ (re-parses affected package)       │                │
```

---

## 8. Risk Assessment Matrix

### 8.1 Risks WITHOUT Fixes Applied

| Risk ID | Scenario | Probability | Impact | Risk Score | Mitigation |
|---------|----------|-------------|--------|------------|------------|
| R1 | Two `devac analyze` commands run simultaneously | HIGH (30%) | CRITICAL | 🔴 30 | None without C1 |
| R2 | Parse error crashes entire analysis | MEDIUM (20%) | HIGH | 🟠 16 | None without C2 |
| R3 | Power failure corrupts parquet | LOW (5%) | CRITICAL | 🟠 10 | None without C3 |
| R4 | Cross-parser entity ID mismatch | MEDIUM (25%) | HIGH | 🟠 20 | None without C4 |
| R5 | Performance targets not met | HIGH (40%) | MEDIUM | 🟠 16 | Accept as stretch |

### 8.2 Risks WITH Fixes Applied

| Risk ID | Scenario | Probability | Impact | Risk Score | Mitigation |
|---------|----------|-------------|--------|------------|------------|
| R1 | Two `devac analyze` commands run simultaneously | LOW (5%) | LOW | 🟢 2 | C1: Lock file |
| R2 | Parse error crashes entire analysis | LOW (5%) | LOW | 🟢 2 | C2: Classification |
| R3 | Power failure corrupts parquet | LOW (5%) | LOW | 🟢 2 | C3: Auto-recovery |
| R4 | Cross-parser entity ID mismatch | LOW (2%) | LOW | 🟢 1 | C4: Normalization |
| R5 | Performance targets not met | MEDIUM (20%) | LOW | 🟢 4 | Revised targets |

### 8.3 Residual Risks (Post-Fix)

| Risk | Description | Mitigation Strategy |
|------|-------------|---------------------|
| Windows file locking | Deferred to Phase 4+ | Acceptable for initial release |
| Python parser latency | May exceed 200ms cold | Warm worker in Phase 3 |
| Large package rewrites | Base branch 300-500ms | Lazy update strategy |
| DuckDB memory limits | 512MB default | Add OOM guidance |

---

## 9. Decision Framework

### 9.1 What You Need to Decide

Based on this documentation, you need to make the following decisions:

#### Decision 1: Approve Phase 1 Start?

| Option | Prerequisites | Timeline | Risk |
|--------|---------------|----------|------|
| **A: GO now** | None | Phase 1 in 18 days | 🔴 HIGH - no fixes |
| **B: GO after C-fixes** | Complete C1-C4 | +2 days, then 18 days | 🟢 LOW |
| **C: NO-GO** | N/A | Postpone | None |

**Recommendation:** Option B (Conditional GO)

#### Decision 2: Accept Revised Performance Targets?

| Original Target | Revised Target | Change |
|-----------------|----------------|--------|
| <100ms incremental | <300ms p50 | +200ms |
| <200ms parse | <400ms p50 | +200ms |
| <500ms cold | <700ms p50 | +200ms |

**Recommendation:** Accept revised targets as primary; keep original as stretch.

#### Decision 3: LanguageRouter Implementation

| Option | Description | Effort |
|--------|-------------|--------|
| **A: Refactor** | Extract from existing Parser class | 1 day |
| **B: New class** | Ground-up implementation | 3 days |

**Recommendation:** Option A (Refactor)

### 9.2 Approval Checklist

Before approving Phase 1, verify:

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | C1 (Lock file) spec complete | ⬜ | |
| 2 | C2 (Error classification) spec complete | ⬜ | |
| 3 | C3 (Recovery) spec complete | ⬜ | |
| 4 | C4 (Entity ID encoding) spec complete | ⬜ | |
| 5 | Performance targets revised in spec | ⬜ | |
| 6 | Timeline includes +20% buffer | ⬜ | |
| 7 | Phase 1 checkpoint defined | ⬜ | |

### 9.3 Summary Recommendation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RECOMMENDATION SUMMARY                             │
└─────────────────────────────────────────────────────────────────────────────┘

  VERDICT: 🟡 CONDITIONAL GO
  
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ BEFORE Phase 1 starts:                                                   │
  │   ✓ Complete C1-C4 specs (~2 days)                                      │
  │   ✓ Revise performance targets                                          │
  │   ✓ Add 20% timeline buffer                                             │
  └─────────────────────────────────────────────────────────────────────────┘
  
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ AFTER Phase 1 completes:                                                 │
  │   ✓ Checkpoint: Validate assumptions with real 10K file codebase        │
  │   ✓ Adjust Phase 2 design if performance issues found                   │
  └─────────────────────────────────────────────────────────────────────────┘
  
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ RATIONALE:                                                               │
  │   • Architecture is sound (3/3 reviewers agree)                         │
  │   • Technology choices are proven                                       │
  │   • 60%+ existing code reusable                                         │
  │   • Critical gaps are addressable with 2 days work                      │
  │   • Risk profile acceptable after fixes                                 │
  └─────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix A: Quick Reference

### A.1 Key Files to Modify

| Current File | Action | New File (if applicable) |
|--------------|--------|--------------------------|
| `src/analyzer/storage-manager.ts` | Replace | `src/storage/seed-writer.ts` |
| `src/analyzer/parser.ts` | Extract | `src/analyzer/language-router.ts` |
| `src/database/neo4j-client.ts` | Remove | N/A |
| `src/analyzer/analyzer-service.ts` | Modify | Same |
| (new) | Create | `src/storage/seed-lock.ts` |
| (new) | Create | `src/storage/integrity-checker.ts` |
| (new) | Create | `src/errors/error-classifier.ts` |

### A.2 New Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| `duckdb-async` | DuckDB Node.js bindings | ^0.9.0 |
| `parquet-wasm` | Parquet read/write | ^0.5.0 |

### A.3 Removed Dependencies

| Package | Reason |
|---------|--------|
| `neo4j-driver` | No longer needed |

---

*End of Documentation*
