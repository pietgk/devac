# DevAC Status System Specification

> Version: 1.4.0
> Last Updated: 2025-11-12
> Status: Draft
> Changes: Added Phase -1 (Workspace Discovery & Configuration) documentation - implementation completed

## Table of Contents

1. [Overview](#overview)
2. [Design Principles](#design-principles)
3. [Workspace-Aware Service Configuration](#workspace-aware-service-configuration)
4. [Status Data Structure](#status-data-structure)
5. [CLI Status Command](#cli-status-command)
6. [API Enhancements](#api-enhancements)
7. [UI State Synchronization](#ui-state-synchronization)
8. [LLM-Friendly Format](#llm-friendly-format)
9. [Service Status Templates](#service-status-templates)
10. [Implementation Guide](#implementation-guide)
11. [Testing Requirements](#testing-requirements)

---

## Overview

### Purpose

Create a comprehensive, multi-level status system for DevAC that provides:
- **Human-readable** status for developers via CLI and UI
- **LLM-friendly** diagnostics with enough context to solve 80% of issues without additional tool calls
- **Real-time** state synchronization between services, orchestrator, and UI
- **Multi-level** status views: summary, attention-needed, detailed

### Key Requirements

1. **CLI Status Command**: `npm run devac:dev -- status` shows all service statuses
2. **State Sync Fix**: UI always reflects true service state (no idle/processing mismatch)
3. **Attention Filtering**: Errors and warnings are clearly separated from normal logs
4. **Code Context**: Errors include surrounding code snippets (±5 lines) when applicable
5. **Actionable**: Status includes enough information to fix issues without reading files

### Success Metrics

- ✅ LLM can solve 80% of issues from status alone (no additional file reads)
- ✅ UI state matches backend state 100% of the time
- ✅ Developers can diagnose issues in &lt;30 seconds
- ✅ All features covered by E2E tests

---

## Design Principles

### 1. Information Hierarchy

Status information is organized in three levels:

**Level 1: Summary** (Quick scan)
- One-line per service: `codegraph healthy-watching (1500 files, 0 errors)`
- Color-coded: green (healthy), yellow (degraded), red (error)
- Shows current state and key metrics

**Level 2: Attention-Needed** (What needs action)
- Errors and warnings only
- Includes timestamps and service context
- Groups related issues together

**Level 3: Detailed** (Deep dive)
- Full logs with filtering options
- Complete statistics and configuration
- Resource references and collection history

### 2. Context is King

Every error includes enough context to understand and fix it:

```typescript
{
  level: "error",
  message: "Type error in src/services/user.ts:45",
  service: "typecheck",
  code: {
    file: "src/services/user.ts",
    line: 45,
    column: 12,
    snippet: [
      { line: 43, text: "export class UserService {" },
      { line: 44, text: "  async getUser(id: string): Promise<User> {" },
      { line: 45, text: "    return this.db.users.findOne(id);", highlight: true },
      { line: 46, text: "    //       ^-- Argument of type 'string' is not assignable to type 'number'" },
      { line: 47, text: "  }" }
    ]
  },
  suggestion: "Change parameter type to 'number' or use Number(id)"
}
```

### 3. Non-Blocking Architecture

- **UI never locks**: All operations are async and non-blocking
- **Progressive loading**: Show what's available, stream updates
- **Graceful degradation**: If API is slow, show cached data + loading indicator
- **Real-time updates**: SSE for instant status changes, polling as fallback

### 4. Event-Driven Updates

- **Watch mode uses SSE**: No polling, no screen clearing
- **Incremental updates**: Show changes as they happen
- **Terminal UI with Ink**: Reactive components, no flicker
- **Real-time stream**: Like `tail -f` but structured

### 5. LLM-Optimized

Status output is designed for LLM consumption:

```
SERVICE STATUS REPORT - 2025-11-12T14:30:00Z

SUMMARY:
  codegraph: healthy-watching | 1500 files | 2748 nodes | 5419 rels | 0 errors
  typecheck: degraded-idle | 45 files | 3 errors | Last run: 2m ago
  lint: healthy-idle | 45 files | 0 warnings | Last run: 1m ago
  test: healthy-watching | 253 tests | 253 passed | 0 failed

ATTENTION NEEDED:

[typecheck] 3 type errors require attention:

1. src/services/user.ts:45:12
   Error: Argument of type 'string' is not assignable to type 'number'

   43 | export class UserService {
   44 |   async getUser(id: string): Promise&lt;User&gt; {
   45 |     return this.db.users.findOne(id);
      |            ^-- Error here
   46 |   }

   Suggestion: Change parameter type to 'number' or convert: findOne(Number(id))

2. src/models/payment.ts:89:5
   ...

RECOMMENDATIONS:
- Fix 3 type errors in typecheck service
- All other services are healthy
```

This format gives LLM everything needed to:
- Understand the error (file, line, context)
- See the surrounding code
- Get actionable suggestions
- Fix without reading files (80% of cases)

---

## Workspace-Aware Service Configuration

### The Challenge

**CodeGraph** operates at the repository/directory level with a uniform approach across all repositories. However, **TypeCheck, Lint, and Test services** require package-aware context because different repositories have different structures:

**Real-world complexity**:
- `monorepo-3.0/`: 32 npm workspace packages, each needs `npm run test -w <package-name>`
- `frontend-monorepo/`: pnpm workspace with Turbo, uses `pnpm -F "package-name" run test`
- `npm-private-packages/`: Collection of independent packages, each with own commands
- `app/`: Single Expo app with specific test configuration
- `public-website-3/`: Next.js app with its own test setup
- `CodeGraph/`: TypeScript library with standard npm scripts

### Solution Architecture: Discovery + LLM-Assisted Configuration

We use a **two-phase approach**:

1. **Automated Discovery**: Detect workspace structure and available commands
2. **LLM-Assisted Configuration**: Analyze discovery results and propose optimal configuration

#### Phase 1: Automated Workspace Discovery

**Discovery Service** scans each repository to determine:

```typescript
interface WorkspaceDiscovery {
  repository: {
    path: string;
    name: string;
  };

  // Workspace metadata
  workspaceType: 'npm' | 'pnpm' | 'yarn' | 'single' | 'unknown';
  packageManager: string;  // npm, pnpm, yarn
  packageManagerVersion?: string;

  // Root package.json
  rootPackage: {
    name: string;
    scripts: Record<string, string>;
    workspaces?: string[];
  };

  // Discovered packages/workspaces
  packages: PackageDiscovery[];

  // Build system (if monorepo)
  buildSystem?: 'turborepo' | 'lerna' | 'nx' | 'none';

  // Node version requirement
  nodeVersion?: string;  // From .nvmrc, volta, or package.json engines
}

interface PackageDiscovery {
  name: string;
  path: string;  // Relative to repo root
  packageJson: {
    name: string;
    scripts: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  // Detected capabilities
  hasTests: boolean;
  hasLint: boolean;
  hasTypeCheck: boolean;

  // Script names found
  testScript?: string;      // 'test', 'test:unit', 'test:integration', etc.
  lintScript?: string;      // 'lint', 'lint:check', etc.
  typeCheckScript?: string; // 'typecheck', 'type-check', 'tsc', etc.

  // TypeScript config
  tsConfigPath?: string;    // Path to tsconfig.json

  // ESLint config
  eslintConfigPath?: string; // Path to .eslintrc.* or eslintConfig in package.json
}
```

**Discovery Algorithm**:

```typescript
async function discoverWorkspace(repoPath: string): Promise<WorkspaceDiscovery> {
  // 1. Read root package.json
  const rootPackage = await readPackageJson(path.join(repoPath, 'package.json'));

  // 2. Detect workspace type
  const workspaceType = detectWorkspaceType(rootPackage);

  // 3. Find all packages
  const packages = await findPackages(repoPath, rootPackage.workspaces);

  // 4. For each package, detect capabilities
  for (const pkg of packages) {
    pkg.hasTests = hasTestFiles(pkg.path) || hasScript(pkg.packageJson, 'test');
    pkg.hasLint = hasScript(pkg.packageJson, 'lint');
    pkg.hasTypeCheck = hasScript(pkg.packageJson, 'typecheck', 'type-check') ||
                       fs.existsSync(path.join(pkg.path, 'tsconfig.json'));
  }

  // 5. Detect build system
  const buildSystem = detectBuildSystem(repoPath, rootPackage);

  return { repository, workspaceType, packageManager, rootPackage, packages, buildSystem };
}
```

#### Phase 2: LLM-Assisted Configuration

Once discovery is complete, an **LLM analyzes the results** and proposes service configurations:

**LLM Prompt Template**:
```
You are configuring DevAC services for a codebase. Based on the workspace discovery below,
propose optimal configurations for TypeCheck, Lint, and Test services.

WORKSPACE DISCOVERY:
{workspaceDiscovery JSON}

REQUIREMENTS:
1. Determine which services can run at repo level vs package level
2. For monorepos, decide granularity: run per-package or aggregate at root
3. Propose specific commands to run for each service
4. Consider performance: parallel execution, watch mode, caching
5. Handle special cases (Expo, Next.js, TypeScript projects)

OUTPUT FORMAT:
{
  "recommendations": {
    "typecheck": { ... },
    "lint": { ... },
    "test": { ... }
  },
  "rationale": "Explanation of decisions"
}
```

**LLM Output Example** (for monorepo-3.0):
```json
{
  "recommendations": {
    "typecheck": {
      "strategy": "aggregate",
      "command": "npm run typecheck --workspaces --if-present",
      "workingDirectory": "/Users/grop/ws/monorepo-3.0",
      "rationale": "Root-level typecheck aggregates all workspace type errors efficiently"
    },
    "lint": {
      "strategy": "aggregate",
      "command": "npm run lint --workspaces --if-present",
      "workingDirectory": "/Users/grop/ws/monorepo-3.0",
      "rationale": "Root-level lint can check all workspaces at once"
    },
    "test": {
      "strategy": "per-package",
      "packages": [
        {
          "name": "event-loki",
          "command": "npm run test -w event-loki",
          "workingDirectory": "/Users/grop/ws/monorepo-3.0",
          "enabled": true
        },
        {
          "name": "mindlerapi",
          "command": "npm run test -w mindlerapi",
          "workingDirectory": "/Users/grop/ws/monorepo-3.0",
          "enabled": true
        }
        // ... 30 more packages
      ],
      "rationale": "Per-package testing provides granular pass/fail visibility and faster watch mode"
    }
  },
  "rationale": "This monorepo uses npm workspaces with 32 services. TypeCheck and Lint can aggregate at root for efficiency. Tests should run per-package to provide detailed feedback and enable parallel execution."
}
```

**LLM Output Example** (for frontend-monorepo with pnpm + Turbo):
```json
{
  "recommendations": {
    "typecheck": {
      "strategy": "turborepo",
      "command": "pnpm run check-types",
      "workingDirectory": "/Users/grop/ws/frontend-monorepo",
      "rationale": "Turbo handles workspace orchestration with caching"
    },
    "lint": {
      "strategy": "turborepo",
      "command": "pnpm run lint",
      "workingDirectory": "/Users/grop/ws/frontend-monorepo",
      "rationale": "Turbo aggregates lint across all workspaces with caching"
    },
    "test": {
      "strategy": "turborepo",
      "command": "pnpm run test",
      "workingDirectory": "/Users/grop/ws/frontend-monorepo",
      "rationale": "Turbo orchestrates parallel test execution across workspaces"
    }
  },
  "rationale": "This workspace uses Turbo which provides efficient caching and parallel execution. Leverage Turbo's built-in orchestration rather than managing packages individually."
}
```

**LLM Output Example** (for app - single Expo package):
```json
{
  "recommendations": {
    "typecheck": {
      "strategy": "single",
      "command": "npm run typecheck",
      "workingDirectory": "/Users/grop/ws/app",
      "rationale": "Single Expo app with TypeScript"
    },
    "lint": {
      "strategy": "single",
      "command": "npm run lint",
      "workingDirectory": "/Users/grop/ws/app",
      "rationale": "Standard ESLint setup"
    },
    "test": {
      "strategy": "single",
      "command": "npm run test",
      "workingDirectory": "/Users/grop/ws/app",
      "rationale": "Jest tests for React Native app"
    }
  },
  "rationale": "Single package repository with standard npm scripts. No workspace complexity."
}
```

#### Configuration Schema

**Final `.devac/config.json` Structure**:

```json
{
  "version": "1.0.0",
  "services": {
    "codegraph": {
      "enabled": true,
      "directories": [
        "/Users/grop/ws/CodeGraph",
        "/Users/grop/ws/monorepo-3.0",
        "/Users/grop/ws/app"
      ]
    },
    "typecheck": {
      "enabled": true,
      "repositories": [
        {
          "path": "/Users/grop/ws/monorepo-3.0",
          "strategy": "aggregate",
          "command": "npm run typecheck --workspaces --if-present",
          "watch": true
        },
        {
          "path": "/Users/grop/ws/frontend-monorepo",
          "strategy": "turborepo",
          "command": "pnpm run check-types",
          "watch": true
        },
        {
          "path": "/Users/grop/ws/app",
          "strategy": "single",
          "command": "npm run typecheck",
          "watch": true
        }
      ]
    },
    "lint": {
      "enabled": true,
      "repositories": [
        {
          "path": "/Users/grop/ws/monorepo-3.0",
          "strategy": "aggregate",
          "command": "npm run lint --workspaces --if-present",
          "watch": true,
          "autoFix": false
        },
        {
          "path": "/Users/grop/ws/frontend-monorepo",
          "strategy": "turborepo",
          "command": "pnpm run lint",
          "watch": true
        }
      ]
    },
    "test": {
      "enabled": true,
      "repositories": [
        {
          "path": "/Users/grop/ws/monorepo-3.0",
          "strategy": "per-package",
          "packages": [
            {
              "name": "event-loki",
              "command": "npm run test -w event-loki",
              "enabled": true,
              "watch": true
            },
            {
              "name": "mindlerapi",
              "command": "npm run test -w mindlerapi",
              "enabled": true,
              "watch": true
            }
            // User can enable/disable individual packages
          ]
        },
        {
          "path": "/Users/grop/ws/app",
          "strategy": "single",
          "command": "npm run test",
          "watch": true
        }
      ]
    }
  }
}
```

#### Configuration Workflow

**CLI Command**: `npm run devac:dev -- configure`

```bash
$ npm run devac:dev -- configure

DevAC Configuration Wizard

Step 1: Discovering workspaces...
✓ Found 6 repositories
✓ Detected workspace types
✓ Scanned 47 packages

Step 2: Analyzing with LLM...
✓ Generated configuration recommendations

Step 3: Review proposed configuration

Repository: monorepo-3.0 (npm workspaces, 32 packages)
  TypeCheck: Aggregate at root (npm run typecheck --workspaces)
  Lint: Aggregate at root (npm run lint --workspaces)
  Test: Per-package (32 packages, run individually)

Repository: frontend-monorepo (pnpm + Turbo, 8 packages)
  TypeCheck: Use Turbo (pnpm run check-types)
  Lint: Use Turbo (pnpm run lint)
  Test: Use Turbo (pnpm run test)

Repository: app (single Expo package)
  TypeCheck: npm run typecheck
  Lint: npm run lint
  Test: npm run test

[A]ccept all, [E]dit, [C]ancel? a

✓ Configuration saved to .devac/config.json
✓ You can now run: npm run devac:dev -- start
```

**Edit Mode** (for fine-tuning):
```bash
[E]dit selected

Which repository to edit?
1. monorepo-3.0
2. frontend-monorepo
3. app
> 1

monorepo-3.0 - Test service configuration:
  Strategy: per-package (32 packages)

  Which packages should run tests?
  [Space to toggle, Enter to confirm]

  ☑ event-loki
  ☑ mindlerapi
  ☑ b2b-membership
  ☐ admin-api (no tests found)
  ☐ legacy-sync (deprecated)
  ...

Options:
  [A] Enable all with tests
  [N] Enable none
  [C] Custom selection
> C

[Custom selection mode...]
```

#### Service Implementation Approach

Each service (TypeCheck, Lint, Test) needs to handle multiple repositories with different strategies:

```typescript
export class TypeCheckService extends BaseService {
  private processes: Map<string, ChildProcess> = new Map();

  protected async initialize(): Promise<void> {
    const config = this.config.config as TypeCheckServiceConfig;

    // Start typecheck process for each repository
    for (const repo of config.repositories) {
      if (!repo.enabled) continue;

      const process = this.spawnTypeCheck(repo);
      this.processes.set(repo.path, process);

      // Parse output and emit errors
      this.parseTypeCheckOutput(process, repo.path);
    }
  }

  private spawnTypeCheck(repo: RepositoryConfig): ChildProcess {
    return spawn(repo.command, {
      cwd: repo.path,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }

  private parseTypeCheckOutput(process: ChildProcess, repoPath: string): void {
    // Parse tsc output
    // Extract errors with file, line, column
    // Extract code snippets
    // Store in context
    // Emit status updates
  }
}
```

#### Benefits of This Approach

1. **Flexibility**: Handles diverse repo structures (monorepos, single packages, different build tools)
2. **LLM-Assisted**: Leverages LLM intelligence to propose optimal configuration
3. **User Control**: User reviews and approves configuration before running
4. **Granularity**: Can enable/disable individual packages in monorepos
5. **Maintainability**: Configuration stored in version-controlled file
6. **Extensibility**: Easy to add new repositories or update commands

#### Edge Cases Handled

- **No package.json**: Skip discovery, mark as unsupported
- **Missing scripts**: LLM proposes running tools directly (`tsc --noEmit`)
- **Turborepo/Lerna/Nx**: LLM recognizes and leverages build system capabilities
- **Different package managers**: Detects npm/pnpm/yarn and uses correct commands
- **Volta/nvm**: Respects Node version requirements
- **Private packages**: Only discovers what user has access to
- **Large monorepos**: User can selectively enable packages to avoid overwhelming output

#### Implementation Status

**Phase -1 has been COMPLETED** with the following:

**Completed Files**:
- ✓ `src/devac/discovery/workspace-discovery.ts` - Repository structure detection
- ✓ `src/devac/discovery/llm-config-generator.ts` - Configuration analysis (rule-based, ready for LLM)
- ✓ `src/devac/types/workspace.ts` - Discovery data structures
- ✓ `src/devac/types/config.ts` - Repository/package configuration types
- ✓ `src/devac/cli/commands/configure.ts` - Interactive configuration wizard
- ✓ `src/devac/services/command-based-service.ts` - Strategy execution engine

**Key Features Implemented**:
- ✓ Workspace discovery algorithm (detects npm/pnpm/yarn, monorepos, build systems)
- ✓ Package capability detection (hasTests, hasLint, hasTypeCheck)
- ✓ Configuration strategy analysis (aggregate, per-package, turborepo, single)
- ✓ CLI configure command with interactive workflow
- ✓ Service execution supporting all strategies
- ✓ **Code snippet extraction for Lint service (±5 lines around errors)**
- ✓ TypeCheck/Test services: File/line/column only (no snippets initially)

**Usage**:
```bash
npm run devac:dev -- configure
```

This will:
1. Discover workspace structures in configured directories
2. Analyze and propose optimal execution strategies
3. Display recommendations for review
4. Save approved configuration to `.devac/config.json`

**Code Context Strategy** (for LLM assistance):
- **Lint service**: Includes ±5 lines of surrounding code (proven valuable in MVP)
- **TypeCheck service**: File/line/column only initially (evaluate value before adding snippets)
- **Test service**: File/line only initially (diffs more valuable than snippets)

See **Phase -1** in Implementation Guide for detailed documentation.

---

## Status Data Structure

### Core Types

```typescript
/**
 * Service status levels
 */
export type ServiceStatus =
  | 'idle'           // Not started
  | 'initializing'   // Starting up
  | 'scanning'       // Initial scan in progress
  | 'watching'       // Watching for changes (idle state)
  | 'processing'     // Actively processing changes
  | 'degraded'       // Working but has issues
  | 'error'          // Failed, needs intervention
  | 'stopping'       // Shutting down
  | 'stopped';       // Stopped

/**
 * Health status
 */
export type HealthStatus =
  | 'healthy'        // All good
  | 'degraded'       // Has warnings or non-critical errors
  | 'error';         // Has critical errors

/**
 * Multi-level status response
 */
export interface ServiceStatusResponse {
  // Level 1: Summary
  summary: {
    serviceId: string;
    name: string;
    type: ServiceType;
    status: ServiceStatus;
    health: HealthStatus;
    statusText: string;  // "healthy-watching (1500 files, 0 errors)"
    lastUpdate: string;  // ISO timestamp
  };

  // Level 2: Attention-needed (errors and warnings)
  attention: {
    errorCount: number;
    warningCount: number;
    issues: StatusIssue[];
  };

  // Level 3: Detailed
  detailed: {
    stats: CollectionStats;
    config: ServiceConfig;
    resources: ResourceReference[];
    recentLogs: LogEntry[];
    collections: CollectionInfo[];
  };
}

/**
 * Status issue with context
 */
export interface StatusIssue {
  id: string;
  level: 'error' | 'warn';
  message: string;
  timestamp: string;
  service: string;

  // Code context (for typecheck, lint, test services)
  code?: {
    file: string;
    line: number;
    column?: number;
    snippet: CodeSnippet[];
  };

  // Stack trace (for runtime errors)
  stack?: string;

  // Actionable suggestion
  suggestion?: string;

  // Related issues (group similar errors)
  relatedIssues?: string[];
}

/**
 * Code snippet line
 */
export interface CodeSnippet {
  line: number;
  text: string;
  highlight?: boolean;  // The line with the error
}

/**
 * Collection information
 */
export interface CollectionInfo {
  id: string;
  timestamp: string;
  stats: CollectionStats;
  logFile?: ResourceReference;
  duration: number;
}
```

### Aggregated Status

```typescript
/**
 * Aggregated status for all services
 */
export interface AggregatedStatus {
  timestamp: string;
  orchestrator: {
    status: string;
    uptime: number;
    serviceCount: number;
  };
  services: ServiceStatusResponse[];
  summary: {
    totalServices: number;
    healthy: number;
    degraded: number;
    error: number;
    totalErrors: number;
    totalWarnings: number;
  };
  attentionNeeded: StatusIssue[];
}
```

---

## CLI Status Command

### Command Syntax

```bash
npm run devac:dev -- status [options]

Options:
  --service <id>      Show status for specific service
  --level <level>     Filter by level: summary|attention|detailed (default: summary)
  --errors-only       Show only errors (no warnings)
  --format <format>   Output format: text|json|markdown (default: text)
  --watch             Watch mode: real-time updates via SSE (event-driven, no polling)
  --help              Show help
```

**Note on Watch Mode**: Uses Server-Sent Events (SSE) for real-time updates. Does not poll or clear screen. Updates are incremental and event-driven, similar to `tail -f` but with structured output.

### Examples

**1. Summary view (default)**
```bash
$ npm run devac:dev -- status

DevAC Status - 2025-11-12T14:30:00Z

SERVICES (4 total):
  ✓ codegraph    healthy-watching    1500 files, 0 errors
  ⚠ typecheck    degraded-idle       45 files, 3 errors
  ✓ lint         healthy-idle        45 files, 0 warnings
  ✓ test         healthy-watching    253 tests, 0 failures

SUMMARY:
  Healthy: 3, Degraded: 1, Error: 0
  Total Errors: 3, Warnings: 0

⚠ 1 service needs attention. Run with --level attention for details.
```

**2. Attention view**
```bash
$ npm run devac:dev -- status --level attention

DevAC Status - 2025-11-12T14:30:00Z

ATTENTION NEEDED (3 issues):

[typecheck] Error in src/services/user.ts:45:12 (TS2345)
  Argument of type 'string' is not assignable to type 'number'

[lint] Error in src/services/payment.ts:23:8 (@typescript-eslint/no-explicit-any)
  Unexpected any. Specify a different type.
  
  21 | export class PaymentService {
  22 |   async processPayment(amount: any): Promise<void> {
  23 |     if (amount < 0) {
     |     ^-- Avoid using 'any'
  24 |       throw new Error("Invalid amount");
  25 |   }
  
  Fixable: Yes
  Suggestion: Replace 'any' with 'number'

[test] Failed: should validate negative amounts
  File: src/services/payment.spec.ts:45
  Expected: true, Received: false

RECOMMENDATIONS:
  • Fix 3 type errors in typecheck service
  • Run: npm run devac:dev -- logs --service typecheck --errors-only
```

**3. Service-specific detailed view**
```bash
$ npm run devac:dev -- status --service codegraph --level detailed

Service: codegraph (CodeGraph)
Status: healthy-watching
Health: healthy
Uptime: 15m 32s

STATISTICS:
  Items Processed: 1500
  Nodes Created: 2748
  Relationships Created: 5419
  Duration: 45.2s
  Errors: 0
  Warnings: 0

CONFIGURATION:
  Directories: 6
    - /Users/grop/ws/CodeGraph
    - /Users/grop/ws/monorepo-3.0
    - /Users/grop/ws/app
    - /Users/grop/ws/frontend-monorepo
    - /Users/grop/ws/public-website-3
    - /Users/grop/ws/npm-private-packages
  Extensions: .ts, .js, .py, .java, .go
  Watch: enabled

RECENT COLLECTIONS:
  1. 2025-11-12T14:28:15Z - 1500 files, 2748 nodes, 5419 rels (45.2s)
  2. 2025-11-12T14:12:03Z - 148 files, 450 nodes, 892 rels (5.1s)

LOGS (last 10):
  [14:28:15] info: Completed analysis of /Users/grop/ws/npm-private-packages
  [14:28:10] info: Completed analysis of /Users/grop/ws/public-website-3
  ...
```

**4. Watch mode**
```bash
$ npm run devac:dev -- status --watch

# Updates every 2 seconds, clears screen
# Press Ctrl+C to exit
```

**5. JSON output (for scripting/LLM)**
```bash
$ npm run devac:dev -- status --format json

{
  "timestamp": "2025-11-12T14:30:00Z",
  "services": [...],
  "summary": {...},
  "attentionNeeded": [...]
}
```

### Implementation Details

**File**: `src/devac/cli/commands/status.ts`

```typescript
import { Command } from 'commander';
import { createStatusFormatter } from '../status-formatter.js';
import { DevACApiClient } from '../api-client.js';

export function createStatusCommand(): Command {
  return new Command('status')
    .description('Show DevAC service status')
    .option('--service <id>', 'Show status for specific service')
    .option('--level <level>', 'Status level: summary|attention|detailed', 'summary')
    .option('--errors-only', 'Show only errors')
    .option('--format <format>', 'Output format: text|json|markdown', 'text')
    .option('--watch', 'Watch mode: real-time SSE updates')
    .action(async (options) => {
      const apiClient = new DevACApiClient('http://localhost:3000');
      const formatter = createStatusFormatter(options.format);

      if (options.watch) {
        // Stream updates via SSE
        await apiClient.streamStatus((status) => {
          formatter.render(status, options);
        });
      } else {
        // One-time fetch
        const status = await apiClient.fetchStatus({
          level: options.level,
          service: options.service
        });
        formatter.render(status, options);
      }
    });
}
```

**File**: `src/devac/cli/api-client.ts` (NEW)

This is a **Node.js HTTP client** (not related to demo.html browser UI) that the CLI uses to communicate with the running DevAC server:

```typescript
import fetch from 'node-fetch';
import EventSource from 'eventsource';

/**
 * DevAC API Client for CLI
 * Communicates with running DevAC server via HTTP/SSE
 */
export class DevACApiClient {
  constructor(private baseUrl: string) {}

  /**
   * Fetch status once (for non-watch mode)
   */
  async fetchStatus(options: FetchStatusOptions): Promise<AggregatedStatus> {
    const params = new URLSearchParams({
      level: options.level || 'summary',
      ...(options.service && { service: options.service })
    });

    const response = await fetch(`${this.baseUrl}/api/status?${params}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch status: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Stream status updates via SSE (for watch mode)
   */
  async streamStatus(callback: (status: AggregatedStatus) => void): Promise<void> {
    const eventSource = new EventSource(`${this.baseUrl}/api/status/stream`);

    eventSource.on('status', (event) => {
      const status = JSON.parse(event.data);
      callback(status);
    });

    eventSource.on('error', (error) => {
      console.error('SSE connection error:', error);
      eventSource.close();
    });

    // Keep connection alive
    return new Promise((resolve) => {
      process.on('SIGINT', () => {
        eventSource.close();
        resolve();
      });
    });
  }
}
```

**File**: `src/devac/cli/status-formatter.ts`

```typescript
export class StatusFormatter {
  formatSummary(status: AggregatedStatus): string;
  formatAttention(status: AggregatedStatus): string;
  formatDetailed(status: ServiceStatusResponse): string;
  formatJSON(status: AggregatedStatus): string;
  formatMarkdown(status: AggregatedStatus): string;
}
```

---

## API Enhancements

### New Endpoint: Aggregated Status

```typescript
/**
 * GET /api/status
 *
 * Query params:
 *   - level: summary|attention|detailed (default: summary)
 *   - service: Filter by service ID
 *
 * Response: AggregatedStatus
 */
router.get('/api/status', async (req, res) => {
  const level = req.query.level || 'summary';
  const serviceFilter = req.query.service as string | undefined;

  // Gather status from all services
  const status = await gatherAggregatedStatus(registry, eventBus, {
    level,
    serviceFilter
  });

  res.json(status);
});
```

### Enhanced Endpoint: Service Status

```typescript
/**
 * GET /api/services/:serviceId/status
 *
 * Query params:
 *   - level: summary|attention|detailed (default: summary)
 *
 * Response: ServiceStatusResponse
 */
router.get('/api/services/:serviceId/status', async (req, res) => {
  const { serviceId } = req.params;
  const level = req.query.level || 'summary';

  const status = await getServiceStatus(serviceId, registry, eventBus, {
    level
  });

  res.json(status);
});
```

### Enhanced Endpoint: Attention Logs

```typescript
/**
 * GET /api/logs/attention
 *
 * Get only logs that need attention (errors and warnings)
 * Includes code context when available
 *
 * Query params:
 *   - service: Filter by service
 *   - since: Unix timestamp
 *   - limit: Max entries (default: 50)
 *
 * Response: { issues: StatusIssue[] }
 */
router.get('/api/logs/attention', async (req, res) => {
  const filter: LogFilter = {
    level: ['error', 'warn'],
    service: req.query.service as string | undefined,
    since: req.query.since ? parseInt(req.query.since as string) : undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string) : 50
  };

  const logs = eventBus.getLogHistory(filter);
  const issues = logsToStatusIssues(logs);

  res.json({ issues });
});
```

### New Endpoint: Status Streaming (for CLI watch mode)

```typescript
/**
 * GET /api/status/stream
 *
 * Server-Sent Events endpoint for real-time status streaming
 * Used by CLI --watch mode for event-driven updates
 *
 * Events:
 *   - event: status, data: AggregatedStatus (on any status change)
 *   - event: heartbeat, data: { timestamp } (every 30s)
 *
 * No query params - always streams full aggregated status
 */
router.get('/api/status/stream', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial status
  const initialStatus = await gatherAggregatedStatus(registry, eventBus);
  res.write(`event: status\n`);
  res.write(`data: ${JSON.stringify(initialStatus)}\n\n`);

  // Subscribe to service state changes
  const unsubscribe = eventBus.subscribe('SERVICE_STATE_CHANGED', async () => {
    const status = await gatherAggregatedStatus(registry, eventBus);
    res.write(`event: status\n`);
    res.write(`data: ${JSON.stringify(status)}\n\n`);
  });

  // Heartbeat
  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\n`);
    res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    unsubscribe();
    clearInterval(heartbeat);
    res.end();
  });
});
```

---

## UI State Synchronization

### Problem Statement

**Current Issue**: UI displays "idle" status while service is actually "processing" files.

**Root Cause**: Service state transitions in XState machine are not propagated to EventBus, so SSE manager doesn't know about state changes.

### Solution Architecture

```
BaseService (XState) --[state change]--> EventBus --[SSE]--> UI
                                            ↓
                                      Log History
                                            ↓
                                      /api/status (fallback)
```

### Implementation Steps

#### 1. Emit State Changes from BaseService

**File**: `src/devac/services/base-service.ts`

Add state transition actions that publish to EventBus:

```typescript
export abstract class BaseService {
  // Add EventBus reference
  protected eventBus?: EventBus;

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  createMachine() {
    // Add action to publish state changes
    actions: {
      publishStateChange: ({ context }) => {
        if (this.eventBus) {
          this.eventBus.publish({
            type: 'SERVICE_STATE_CHANGED',
            serviceId: context.config.id,
            status: context.status,
            health: context.health,
            stats: context.stats
          }, context.config.id);
        }
      }
    },

    states: {
      scanning: {
        entry: ['publishStateChange'],  // Add to all states
        // ...
      },
      watching: {
        entry: ['publishStateChange'],
        // ...
      },
      processing: {
        entry: ['publishStateChange'],
        // ...
      }
    }
  }
}
```

#### 2. Broadcast State Changes via SSE

**File**: `src/devac/web/sse-manager.ts`

Subscribe to SERVICE_STATE_CHANGED events:

```typescript
export class SSEManager {
  start(): void {
    // Subscribe to state change events
    this.eventBus.subscribe('SERVICE_STATE_CHANGED', (envelope) => {
      this.broadcast({
        type: 'service_status',
        data: {
          serviceId: envelope.event.serviceId,
          status: envelope.event.status,
          health: envelope.event.health,
          stats: envelope.event.stats,
          timestamp: envelope.timestamp
        }
      });
    });
  }
}
```

#### 3. Update UI on State Events

**File**: `src/devac/web/frontend/demo.html`

```javascript
// Subscribe to service status events
eventSource.addEventListener('service_status', (event) => {
  const data = JSON.parse(event.data);

  // Update service card immediately
  updateServiceCard(data.serviceId, {
    status: data.status,
    health: data.health,
    stats: data.stats
  });
});

// Fallback: poll /api/services every 30s to reconcile
setInterval(async () => {
  const services = await fetch('/api/services').then(r => r.json());
  services.forEach(service => {
    updateServiceCard(service.id, service);
  });
}, 30000);
```

#### 4. Add State Reconciliation

If SSE connection drops or misses events, reconcile on reconnect:

```javascript
eventSource.addEventListener('open', async () => {
  console.log('SSE connected, reconciling state...');
  const services = await fetch('/api/services').then(r => r.json());
  services.forEach(service => {
    updateServiceCard(service.id, service, { force: true });
  });
});
```

### Testing State Sync

**E2E Test**: `src/devac/web/__tests__/state-sync.e2e.spec.ts`

```typescript
describe('UI State Synchronization', () => {
  it('should update UI when service transitions to processing', async () => {
    // Start DevAC
    // Trigger file change to start processing
    // Assert UI shows "processing" within 1 second
    // Wait for completion
    // Assert UI shows "watching" within 1 second
  });

  it('should reconcile state after SSE reconnect', async () => {
    // Start DevAC
    // Kill SSE connection
    // Change service state
    // Reconnect SSE
    // Assert UI reflects current state
  });
});
```

---

## LLM-Friendly Format

### Design Goals

1. **Self-contained**: Include all context needed to understand and fix issues
2. **Structured**: Easy for LLM to parse (clear sections, consistent format)
3. **Actionable**: Include suggestions and next steps
4. **Concise**: 80/20 rule - most important information first

### Text Format Template

```
DEVAC STATUS REPORT
Generated: {timestamp}
Orchestrator: {status}, Uptime: {uptime}, Services: {count}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{service_name}: {health}-{status} | {key_metrics}
{service_name}: {health}-{status} | {key_metrics}
...

Overall: {healthy_count} healthy, {degraded_count} degraded, {error_count} error
Issues: {total_errors} errors, {total_warnings} warnings

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ATTENTION NEEDED ({issue_count} issues)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[{service}] {level}: {message}
Location: {file}:{line}:{column}
Time: {timestamp}

Code:
  {line-2} | {code}
  {line-1} | {code}
→ {line}   | {code}
           | ^-- {error_message}
  {line+1} | {code}
  {line+2} | {code}

Suggestion: {actionable_suggestion}

Related Issues:
  • {related_issue_summary}

────────────────────────────────────────────────────────

[Next issue...]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RECOMMENDATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Fix {error_count} type errors in typecheck service
• Review {warning_count} lint warnings
• All other services are healthy
• Next: Run `npm run devac:dev -- logs --service {service} --errors-only`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### JSON Format (for programmatic access)

```json
{
  "timestamp": "2025-11-12T14:30:00Z",
  "orchestrator": {
    "status": "running",
    "uptime": 932,
    "serviceCount": 3
  },
  "services": [
    {
      "summary": {
        "serviceId": "codegraph",
        "name": "CodeGraph",
        "type": "codegraph",
        "status": "watching",
        "health": "healthy",
        "statusText": "healthy-watching (1500 files, 0 errors)",
        "lastUpdate": "2025-11-12T14:28:15Z"
      },
      "attention": {
        "errorCount": 0,
        "warningCount": 0,
        "issues": []
      }
    },
    {
      "summary": {
        "serviceId": "typecheck",
        "name": "TypeScript Type Checker",
        "type": "typecheck",
        "status": "idle",
        "health": "degraded",
        "statusText": "degraded-idle (45 files, 3 errors)",
        "lastUpdate": "2025-11-12T14:28:00Z"
      },
      "attention": {
        "errorCount": 3,
        "warningCount": 0,
        "issues": [
          {
            "id": "typecheck-error-1",
            "level": "error",
            "message": "Argument of type 'string' is not assignable to type 'number'",
            "timestamp": "2025-11-12T14:28:00Z",
            "service": "typecheck",
            "code": {
              "file": "src/services/user.ts",
              "line": 45,
              "column": 12,
              "snippet": [
                { "line": 43, "text": "export class UserService {" },
                { "line": 44, "text": "  async getUser(id: string): Promise<User> {" },
                { "line": 45, "text": "    return this.db.users.findOne(id);", "highlight": true },
                { "line": 46, "text": "  }" }
              ]
            },
            "suggestion": "Change parameter type to 'number' or use Number(id)"
          }
        ]
      }
    }
  ],
  "summary": {
    "totalServices": 3,
    "healthy": 2,
    "degraded": 1,
    "error": 0,
    "totalErrors": 3,
    "totalWarnings": 0
  },
  "attentionNeeded": [...]
}
```

### Usage Examples for LLM

**Prompt Pattern**:
```
Check the status of the codebase by running:
npm run devac:dev -- status --level attention

Then fix any issues found.
```

**LLM Receives**:
```
[typecheck] Error in src/services/user.ts:45:12
  Argument of type 'string' is not assignable to type 'number'

  43 | export class UserService {
  44 |   async getUser(id: string): Promise<User> {
  45 |     return this.db.users.findOne(id);
     |            ^-- Error here
  46 |   }

  Suggestion: Change parameter type to 'number' or use Number(id)
```

**LLM Can**:
1. Understand the error without reading the file
2. See the exact location and surrounding code
3. Get an actionable suggestion
4. Fix the issue (80% success rate)

---

## Service Status Templates

### CodeGraph Service

```typescript
export interface CodeGraphStatus extends ServiceStatusResponse {
  summary: {
    serviceId: 'codegraph';
    name: 'CodeGraph';
    type: 'codegraph';
    status: ServiceStatus;
    health: HealthStatus;
    statusText: string;  // "healthy-watching (1500 files, 2748 nodes, 5419 rels)"
    lastUpdate: string;
  };
  detailed: {
    stats: {
      itemsProcessed: number;      // Files analyzed
      nodesCreated: number;         // Graph nodes
      relationshipsCreated: number; // Graph relationships
      duration: number;             // Last collection duration (ms)
      errors: number;
      warnings: number;
    };
    config: {
      directories: string[];
      extensions: string[];
      ignore: string[];
      watch: boolean;
    };
    collections: CollectionInfo[];  // Recent analysis runs
  };
}
```

### TypeCheck Service

```typescript
export interface TypeCheckStatus extends ServiceStatusResponse {
  summary: {
    serviceId: 'typecheck';
    name: 'TypeScript Type Checker';
    type: 'typecheck';
    status: ServiceStatus;
    health: HealthStatus;
    statusText: string;  // "degraded-idle (45 files, 3 errors)"
    lastUpdate: string;
  };
  attention: {
    errorCount: number;
    warningCount: number;
    issues: TypeCheckIssue[];  // Includes code snippets
  };
  detailed: {
    stats: {
      filesChecked: number;
      errors: number;
      warnings: number;
      duration: number;
    };
    config: {
      tsconfig: string;
      strict: boolean;
      skipLibCheck: boolean;
    };
    errorsByFile: Map<string, number>;  // Grouped errors
  };
}

export interface TypeCheckIssue extends StatusIssue {
  code: {
    file: string;
    line: number;
    column: number;
    snippet: CodeSnippet[];  // ±5 lines of context
  };
  errorCode: string;  // TS2345, TS2322, etc.
  suggestion: string;  // Actionable fix suggestion
}
```

### Lint Service

```typescript
export interface LintStatus extends ServiceStatusResponse {
  summary: {
    serviceId: 'lint';
    name: 'ESLint';
    type: 'lint';
    status: ServiceStatus;
    health: HealthStatus;
    statusText: string;  // "healthy-idle (45 files, 0 warnings)"
    lastUpdate: string;
  };
  attention: {
    errorCount: number;
    warningCount: number;
    issues: LintIssue[];  // Includes code snippets
  };
  detailed: {
    stats: {
      filesLinted: number;
      errors: number;
      warnings: number;
      fixableErrors: number;
      fixableWarnings: number;
      duration: number;
    };
    config: {
      eslintConfig: string;
      ignoredFiles: string[];
    };
    ruleViolations: Map<string, number>;  // Violations by rule
  };
}

export interface LintIssue extends StatusIssue {
  code: {
    file: string;
    line: number;
    column: number;
    snippet: CodeSnippet[];
  };
  rule: string;           // no-unused-vars, @typescript-eslint/no-explicit-any
  fixable: boolean;       // Can ESLint auto-fix this?
  suggestion: string;     // How to fix manually
}
```

### Test Service

```typescript
export interface TestStatus extends ServiceStatusResponse {
  summary: {
    serviceId: 'test';
    name: 'Vitest';
    type: 'test';
    status: ServiceStatus;
    health: HealthStatus;
    statusText: string;  // "healthy-idle (253 tests, 0 failures)"
    lastUpdate: string;
  };
  attention: {
    errorCount: number;      // Test failures
    warningCount: number;    // Flaky tests
    issues: TestFailure[];   // Includes failure context
  };
  detailed: {
    stats: {
      totalTests: number;
      passed: number;
      failed: number;
      skipped: number;
      duration: number;
      coverage?: {
        lines: number;
        statements: number;
        functions: number;
        branches: number;
      };
    };
    config: {
      testMatch: string[];
      coverage: boolean;
      watch: boolean;
    };
    failuresByFile: Map<string, number>;
  };
}

export interface TestFailure extends StatusIssue {
  testName: string;
  testFile: string;
  code: {
    file: string;
    line: number;
    snippet: CodeSnippet[];
  };
  expected: any;
  received: any;
  diff: string;          // Colored diff output
  suggestion: string;
}
```

---

## Implementation Guide

### Phase -1: Workspace Discovery & Configuration (COMPLETED ✓)

**Purpose**: Intelligently discover workspace structures and propose optimal service configurations before running any services.

**The Challenge**: 
- CodeGraph operates uniformly at directory level (list of directories to analyze)
- TypeCheck/Lint/Test must respect package boundaries and workspace structure (repo-level with strategies)
- Different repos use different package managers (npm/pnpm/yarn)
- Monorepos need per-package or aggregate strategies
- Build tools (Turborepo) should be leveraged when available

**Implementation Summary**:

**1. Workspace Discovery** (`src/devac/discovery/workspace-discovery.ts`)
   - Scans each repository to detect structure
   - Identifies workspace type (npm/pnpm/yarn/single), package manager, build system
   - Finds all packages and their capabilities (hasTests, hasLint, hasTypeCheck)
   - Locates config files (tsconfig.json, .eslintrc, etc.)
   - Detects Node version requirements (.nvmrc, volta, package.json engines)

**2. Configuration Analysis** (`src/devac/discovery/llm-config-generator.ts`)
   - Analyzes discovery results to propose execution strategies
   - Determines optimal approach per service and repository:
     - **aggregate**: Run once at root for all packages (e.g., `npm run test --workspaces`)
     - **per-package**: Run individually per package (e.g., `npm run test -w package-name`)
     - **turborepo**: Leverage build system orchestration (e.g., `pnpm run test` with Turbo)
     - **single**: Standard single-package execution
   - Currently uses rule-based logic (designed for future LLM integration)
   - Generates workspace-specific commands (npm -w, pnpm -F, yarn workspace)

**3. CLI Configure Command** (`src/devac/cli/commands/configure.ts`)
   - Interactive workflow: discover → analyze → propose → confirm → save
   - Displays recommendations with rationale
   - User can accept all, edit individual configs, or cancel
   - Saves final configuration to `.devac/config.json`
   - Per-package enable/disable for granular control

**4. Service Execution** (`src/devac/services/command-based-service.ts`)
   - Executes commands based on configured strategy
   - Handles all strategy types (aggregate, per-package, turborepo, single)
   - Supports workspace-specific syntax for different package managers
   - **Code snippet extraction**: Lint service includes ±5 lines around errors
   - TypeCheck/Test services: File/line/column only (no snippets initially)

**Key Distinction**:
- **CodeGraph service**: Operates at directory/repo level with `directories: [...]` config
- **TypeCheck/Lint/Test services**: Operate at repo level with `repositories: [{ strategy, command }]` config
- This is because CodeGraph analyzes files uniformly, while TypeCheck/Lint/Test must respect package structure

**Key Types**:
- `WorkspaceDiscovery` (`src/devac/types/workspace.ts`): Complete repo analysis result
- `PackageDiscovery` (`src/devac/types/workspace.ts`): Individual package metadata
- `ServiceRecommendation` (`src/devac/types/workspace.ts`): Proposed execution strategy
- `RepositoryConfig` (`src/devac/types/config.ts`): Final configuration with strategy
- `PackageConfig` (`src/devac/types/config.ts`): Per-package configuration

**Code Context Strategy** (for LLM error diagnosis):
- **Lint service**: Includes ±5 lines of surrounding code (proven valuable in MVP)
- **TypeCheck service**: File/line/column only initially (evaluate value before adding)
- **Test service**: File/line only initially (diffs more valuable than snippets)
- Rationale: Start with proven valuable features, add others if needed

**Completed Files**:
- ✓ `src/devac/discovery/workspace-discovery.ts` - Workspace structure detection
- ✓ `src/devac/discovery/llm-config-generator.ts` - Strategy recommendation engine
- ✓ `src/devac/types/workspace.ts` - Discovery data structures
- ✓ `src/devac/types/config.ts` - Configuration types (RepositoryConfig, PackageConfig)
- ✓ `src/devac/cli/commands/configure.ts` - Interactive configuration wizard
- ✓ `src/devac/services/command-based-service.ts` - Strategy execution engine

**Usage**:
```bash
# Run the configuration wizard
npm run devac:dev -- configure

# Or specify directories to discover
npm run devac:dev -- configure -d "/path/to/repo1,/path/to/repo2"

# Auto-accept recommendations
npm run devac:dev -- configure -y
```

**Example Output**:
```
🔧 DevAC Configuration Wizard

📂 Discovering 3 directories...
  ✓ Found npm workspace with 32 packages (monorepo-3.0)
  ✓ Found pnpm workspace with Turborepo (frontend-monorepo)
  ✓ Found single Expo package (app)

🤖 Analyzing workspaces and generating recommendations...

📋 Proposed Configuration:

Repository: monorepo-3.0 (npm workspaces, 32 packages)
  TypeCheck: aggregate (npm run typecheck --workspaces)
  Lint: aggregate (npm run lint --workspaces)
  Test: per-package (32 packages configured)

Repository: frontend-monorepo (pnpm + Turbo, 8 packages)
  TypeCheck: turborepo (pnpm run check-types)
  Lint: turborepo (pnpm run lint)
  Test: turborepo (pnpm run test)

Accept this configuration? [Y/n] y

✅ Configuration saved to .devac/config.json
```

---

### Phase 0: Implement TypeCheck, Lint, and Test Services (NEW)

**Prerequisites**: Phase -1 workspace discovery must be completed ✓

**Purpose**: Add real, useful services before implementing status system. These provide:
- Real errors with code context for testing status display
- Immediate developer value
- Foundation for LLM-friendly error format

**Services to implement** (based on `docs/research/mvp-services-example.md`):

1. **TypeCheckService** - TypeScript type checking
   - Runs: `tsc --noEmit --watch`
   - Parses TypeScript diagnostics
   - Extracts file, line, column, error code
   - **NO code snippets initially** (evaluate value later)
   - Status includes error counts by file

2. **LintService** - ESLint checking (code snippets included)
   - Runs: `eslint --format json --watch`
   - Parses ESLint JSON output
   - **Extracts ±5 lines of surrounding code** (proven valuable in MVP)
   - Groups violations by rule
   - Identifies fixable errors
   - Status includes auto-fix suggestions

3. **TestService** - Vitest test runner
   - Runs: `vitest watch --reporter=json`
   - Parses test results
   - Tracks pass/fail/skip counts
   - **NO code snippets initially** (diffs more valuable)
   - Captures failure diffs
   - Status includes coverage info (if enabled)

**Files to create**:
```
src/devac/services/typecheck/
  ├── typecheck-service.ts       # BaseService implementation
  ├── tsc-parser.ts              # Parse TypeScript diagnostic output
  └── __tests__/
      └── typecheck-service.spec.ts

src/devac/services/lint/
  ├── lint-service.ts            # BaseService implementation
  ├── eslint-parser.ts           # Parse ESLint JSON output
  ├── code-extractor.ts          # Extract ±5 lines from source files
  └── __tests__/
      └── lint-service.spec.ts

src/devac/services/test/
  ├── test-service.ts            # BaseService implementation
  ├── vitest-parser.ts           # Parse Vitest JSON output
  └── __tests__/
      └── test-service.spec.ts
```

**Note**: `code-extractor.ts` is ONLY in lint service. TypeCheck and Test services do NOT extract code snippets initially.

**Implementation approach**:
1. Each service extends BaseService
2. Use child_process.spawn() to run tool in watch mode
3. Parse stdout/stderr to extract errors
4. Extract code snippets ONLY for Lint service (±5 lines around error)
5. TypeCheck and Test: Store file/line/column only (no snippets initially)
6. Store errors in service context
7. Emit status updates when errors change

**Rationale**: MVP experience shows lint snippets are valuable for context. TypeCheck and Test errors may be better served by their native output formats (TypeScript diagnostics, test diffs). Start simple and add snippets later if proven valuable.

**Example TypeCheck error** (without code snippets for now):
```typescript
{
  file: "src/services/user.ts",
  line: 45,
  column: 12,
  code: "TS2345",
  message: "Argument of type 'string' is not assignable to type 'number'",
  // Note: Code snippet extraction NOT implemented initially
  // Only Lint service includes snippets (proven valuable in MVP)
}
```

**Example Lint error with context** (code snippets proven valuable):
```typescript
{
  file: "src/services/user.ts",
  line: 45,
  column: 12,
  rule: "@typescript-eslint/no-explicit-any",
  message: "Unexpected any. Specify a different type.",
  snippet: [
    { line: 43, text: "export class UserService {" },
    { line: 44, text: "  async getUser(id: any): Promise<User> {" },
    { line: 45, text: "    return this.db.users.findOne(id);", highlight: true },
    { line: 46, text: "    //                      ^-- Avoid using 'any'" },
    { line: 47, text: "  }" }
  ],
  fixable: true,
  suggestion: "Replace 'any' with specific type like 'string' or 'number'"
}
```

**Example Test error** (without code snippets for now):
```typescript
{
  testName: "should validate user input",
  testFile: "src/services/user.spec.ts",
  line: 23,
  message: "Expected 'valid' to equal 'invalid'",
  expected: "invalid",
  received: "valid",
  // Note: Code snippet extraction NOT implemented initially
  // Focus on diff output instead
}
```

**Code Snippet Strategy**:
- **Lint service**: Include ±5 lines (proven valuable in MVP)
- **TypeCheck service**: File/line/column only initially (evaluate value before adding snippets)
- **Test service**: File/line only initially (diffs more valuable than snippets)
- **Future**: Can add snippets to TypeCheck/Test if proven valuable

**Why implement this first?**
- Provides real test data for status system
- Validates error format with real tools
- Immediate value to developers
- Tests BaseService patterns with different service types
- Enables better E2E testing of status features
- Lint snippets proven valuable, others experimental

**Remove dummy services**:
- ❌ Delete `src/devac/services/git/` (if exists)
- ❌ Delete `src/devac/services/build/` (if exists)

### Phase 1: Status Specification ✓
- Create this document
- Review with team
- Define type definitions

### Phase 2: CLI Status Command

**Files to create**:
1. `src/devac/cli/commands/status.ts` - Command handler
2. `src/devac/cli/status-formatter.ts` - Output formatting
3. `src/devac/cli/api-client.ts` - HTTP client for DevAC API

**Files to modify**:
1. `src/devac/cli/index.ts` - Register status command

**Steps**:
1. Create DevACApiClient (Node.js HTTP client) that connects to running DevAC instance
2. Implement status fetching from `/api/status` endpoint (one-time fetch)
3. Implement SSE streaming from `/api/status/stream` endpoint (watch mode)
4. Create formatters for text, JSON, markdown output
5. Add color/symbol rendering for terminal
6. Implement event-driven watch mode (SSE-based, no polling, no screen clearing)
7. Add error handling for connection failures and SSE disconnects
8. Write unit tests for formatters
9. Write integration tests for command

**Note**: The CLI API client is a **Node.js HTTP/SSE client** for terminal use, completely separate from the browser-based demo.html UI.

### Phase 3: Fix UI State Synchronization

**Files to modify**:
1. `src/devac/services/base-service.ts` - Add state change publishing
2. `src/devac/web/sse-manager.ts` - Subscribe to state changes
3. `src/devac/web/frontend/demo.html` - Handle state events
4. `src/devac/orchestrator/orchestrator.ts` - Pass EventBus to services

**Steps**:
1. Add `eventBus` property to BaseService
2. Add `publishStateChange` action to state machine
3. Call action on all state transitions
4. Subscribe to SERVICE_STATE_CHANGED in SSEManager
5. Broadcast state changes to connected clients
6. Update UI to handle service_status events
7. Add state reconciliation on reconnect
8. Add polling fallback every 30s
9. Write E2E test for state sync

### Phase 4: Implement Multi-Level Status API

**Files to create**:
1. `src/devac/web/routes/status.ts` - Status aggregation logic
2. `src/devac/types/status.ts` - Status type definitions

**Files to modify**:
1. `src/devac/web/server.ts` - Register status routes
2. `src/devac/web/routes/services.ts` - Add /status endpoint
3. `src/devac/web/routes/logs.ts` - Add /attention endpoint

**Steps**:
1. Define status types in `types/status.ts`
2. Implement status aggregation function
3. Create GET /api/status endpoint
4. Create GET /api/services/:id/status endpoint
5. Create GET /api/logs/attention endpoint
6. Add helper functions for issue formatting
7. Implement code snippet extraction (for future services)
8. Write unit tests for aggregation logic
9. Write integration tests for API endpoints

### Phase 5: Enhanced UI Implementation

**Files to modify**:
1. `src/devac/web/frontend/demo.html` - Add status views
2. CSS styling for multi-level status display

**Components to add**:
1. Service summary cards (existing, enhance)
2. Attention panel (errors/warnings)
3. Detailed view modal
4. Log viewer with filters
5. Status timeline

**Steps**:
1. Enhance service cards with attention indicators
2. Add attention panel below service cards
3. Add click handlers for drill-down to detailed view
4. Implement log filtering UI (level, service, search)
5. Add status timeline visualization
6. Ensure UI remains non-blocking (async/await all API calls)
7. Add loading states and error handling
8. Write E2E tests for UI interactions

### Phase 6: E2E Test Suite

**Files to create**:
1. `src/devac/web/__tests__/status.e2e.spec.ts`
2. `src/devac/web/__tests__/state-sync.e2e.spec.ts`
3. `src/devac/cli/__tests__/status-command.e2e.spec.ts`

**Test scenarios**:
1. CLI status command output
2. UI state synchronization
3. Multi-level status API responses
4. Log filtering and search
5. Attention-needed issue display
6. Watch mode updates
7. Error handling and recovery

---

## Testing Requirements

### Unit Tests

**Status Formatter** (`status-formatter.spec.ts`):
- ✓ Format summary output
- ✓ Format attention output
- ✓ Format detailed output
- ✓ Format JSON output
- ✓ Format markdown output
- ✓ Color and symbol rendering
- ✓ Handle empty status
- ✓ Handle errors gracefully

**Status Aggregation** (`status-aggregation.spec.ts`):
- ✓ Aggregate status from multiple services
- ✓ Calculate summary statistics
- ✓ Filter attention-needed issues
- ✓ Group related issues
- ✓ Handle missing services
- ✓ Handle degraded services

### Integration Tests

**Status API** (`status-api.integration.spec.ts`):
- ✓ GET /api/status returns aggregated status
- ✓ GET /api/status?service=X filters by service
- ✓ GET /api/status?level=attention returns only issues
- ✓ GET /api/services/:id/status returns service status
- ✓ GET /api/logs/attention returns filtered logs
- ✓ Handles invalid service IDs
- ✓ Handles missing query params

**CLI Command** (`status-command.integration.spec.ts`):
- ✓ Executes status command successfully
- ✓ Connects to running DevAC instance
- ✓ Formats output correctly
- ✓ Handles connection errors
- ✓ Supports all options (--service, --level, etc.)
- ✓ Watch mode works correctly

### E2E Tests

**State Synchronization** (`state-sync.e2e.spec.ts`):
- ✓ UI updates when service transitions to processing
- ✓ UI updates when service returns to watching
- ✓ UI updates when service encounters error
- ✓ UI reconciles state after SSE reconnect
- ✓ UI polls as fallback when SSE disconnected
- ✓ Multiple clients see same state

**Status Display** (`status-display.e2e.spec.ts`):
- ✓ Summary view shows all services
- ✓ Attention panel shows errors and warnings
- ✓ Detailed view shows full service info
- ✓ Log viewer filters by level
- ✓ Log viewer searches text
- ✓ Click service opens detailed view
- ✓ Click issue opens code location

**CLI End-to-End** (`cli-e2e.spec.ts`):
- ✓ Start DevAC, run status command, verify output
- ✓ Trigger error, verify shows in attention view
- ✓ Watch mode updates automatically
- ✓ JSON format is valid JSON
- ✓ Markdown format renders correctly

### Performance Tests

**Status Response Time**:
- ✓ /api/status responds in &lt;100ms (summary)
- ✓ /api/status responds in &lt;200ms (attention)
- ✓ /api/status responds in &lt;500ms (detailed)
- ✓ CLI command completes in &lt;1s
- ✓ UI updates within 1s of state change

**Load Tests**:
- ✓ Handles 10 concurrent status requests
- ✓ Handles 100 SSE connections
- ✓ Handles 1000 log entries in memory

---

## Future Enhancements

### 1. Service-Specific Plugins

Allow services to define custom status formatters:

```typescript
export interface ServiceStatusPlugin {
  formatSummary(status: ServiceStatusResponse): string;
  formatAttention(issues: StatusIssue[]): string;
  extractCodeContext(issue: StatusIssue): CodeSnippet[];
}
```

### 2. Status History

Track status changes over time:

```typescript
export interface StatusHistory {
  serviceId: string;
  snapshots: StatusSnapshot[];
}

export interface StatusSnapshot {
  timestamp: string;
  status: ServiceStatus;
  health: HealthStatus;
  errorCount: number;
  warningCount: number;
}
```

### 3. Alerting and Notifications

Notify when services become degraded:

```typescript
export interface AlertConfig {
  onDegraded: (service: string) => void;
  onError: (service: string, error: Error) => void;
  onRecovered: (service: string) => void;
}
```

### 4. Status Dashboard

Web-based dashboard with:
- Real-time status visualization
- Historical trends
- Error analytics
- Service health scorecards

### 5. LLM Integration

Direct LLM integration:

```bash
npm run devac:dev -- status --llm

# Sends status to configured LLM
# Gets back suggested fixes
# Optionally applies fixes automatically
```

---

## Appendix

### A. Color Codes for CLI

```typescript
export const STATUS_COLORS = {
  healthy: '\x1b[32m',    // Green
  degraded: '\x1b[33m',   // Yellow
  error: '\x1b[31m',      // Red
  idle: '\x1b[90m',       // Gray
  processing: '\x1b[36m', // Cyan
  reset: '\x1b[0m',       // Reset
};

export const STATUS_SYMBOLS = {
  healthy: '✓',
  degraded: '⚠',
  error: '✗',
  processing: '◉',
  idle: '○',
};
```

### B. Example Status Responses

See [LLM-Friendly Format](#llm-friendly-format) section for complete examples.

### C. API Response Schemas

All API responses follow this structure:

```typescript
{
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}
```

---

## Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-11-12 | DevAC Team | Initial specification |
| 1.1.0 | 2025-11-12 | DevAC Team | **Major updates based on feedback:**<br/>• Added Phase 0: TypeCheck, Lint, Test services (from MVP example)<br/>• Clarified CLI API client (Node.js HTTP/SSE client, separate from demo.html)<br/>• Changed watch mode to event-driven (SSE-based, no polling, no screen clearing)<br/>• Added `/api/status/stream` endpoint for CLI watch mode<br/>• Updated all examples to include 4 services (codegraph, typecheck, lint, test)<br/>• Removed references to dummy git/build services |
| 1.2.0 | 2025-11-12 | DevAC Team | **Added workspace-aware configuration:**<br/>• New section: Workspace-Aware Service Configuration<br/>• Automated workspace discovery (npm/pnpm/yarn, monorepos vs single packages)<br/>• LLM-assisted configuration generation (`npm run devac:dev -- configure`)<br/>• Flexible strategies: aggregate, per-package, turborepo, single<br/>• Handles real-world complexity (32-package monorepos, Turbo, Expo, Next.js)<br/>• User review/edit workflow before saving config<br/>• Addresses TypeCheck/Lint/Test package-awareness vs CodeGraph directory-level |
| 1.3.0 | 2025-11-12 | DevAC Team | **Code snippet strategy clarification:**<br/>• **Lint service**: Include ±5 lines (proven valuable in MVP)<br/>• **TypeCheck service**: File/line/column only, NO snippets initially<br/>• **Test service**: File/line only, NO snippets initially (diffs more valuable)<br/>• Rationale: Start simple, add snippets to TypeCheck/Test only if proven valuable<br/>• Updated all examples to show different error formats per service<br/>• Removed code-extractor.ts from TypeCheck/Test service file structures |

---

## References

- [MVP Services Example](../research/mvp-services-example.md) - Reference implementation
- [DevAC Architecture](./code-status.md) - System architecture
- [BaseService](../../src/devac/services/base-service.ts) - Service state machine
- [EventBus](../../src/devac/orchestrator/event-bus.ts) - Event system
