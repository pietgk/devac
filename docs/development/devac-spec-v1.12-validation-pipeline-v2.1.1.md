# DevAC Validation Pipeline Architecture v2.1.1

**System:** DevAC, Language-Agnostic Federated Validation Pipeline  
**Version:** 2.1.1  
**Status:** Draft  
**Last Updated:** 2025-01-XX

---

## Terminology

> **Critical:** This spec uses precise terminology. See full glossary at end.

| Term | Meaning |
|------|---------|
| **Workspace** | The entire monorepo (all projects) |
| **Project** | A single buildable/testable unit (any language) |
| **Manifest file** | Config file defining a project (package.json, *.csproj, pyproject.toml) |
| **Project dependency** | Dependency on another workspace project |
| **External dependency** | Third-party package (npm, NuGet, PyPI) |

**NOT used:** "Package" (too overloaded with npm meaning)

---

## Overview

This specification describes a **language-agnostic** validation pipeline for polyglot monorepos. It learns from existing tools (Nx, Bazel, Turborepo) while focusing DevAC on its unique value: **LLM integration and intelligent issue enrichment**.

> **Design Philosophy:** Don't reinvent what Nx does well. Focus on what makes DevAC unique.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                         DEVAC LAYERED ARCHITECTURE                          │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Layer 4: LLM INTEGRATION                         │   │
│  │  • MCP Server  • Prompt generation  • Fix loop  • Skills            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                  │                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                   Layer 3: ISSUE INTELLIGENCE                       │   │
│  │  • Enrichment  • CodeGraph  • Root cause  • Cross-project correlation│  │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                  │                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                   Layer 2: VALIDATION CORE                          │   │
│  │  • Standard issue format  • Validator plugins  • Parsers  • Storage │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                  │                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                   Layer 1: ORCHESTRATION                            │   │
│  │  Option A: Simple (Git + manifest parsing)                          │   │
│  │  Option B: Nx integration                                           │   │
│  │  Option C: Native tools per language                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Project Discovery

### Workspace Configuration

```yaml
# .devac/workspace.yaml

workspace:
  name: mindler-monorepo
  
# Where to find projects
discovery:
  roots:
    - projects/*       # Library projects
    - apps/*           # Application projects
    - services/*       # Backend services
  
  exclude:
    - "**/node_modules"
    - "**/dist"
    - "**/build"

# How to identify project types by their manifest files
project_types:
  typescript:
    manifest:
      file: package.json
      required_fields: [name]
      indicator_deps: [typescript]  # Has typescript in dependencies
    dependencies:
      field: dependencies
      workspace_filter: "workspace:*"  # Yarn workspace protocol
      
  expo:
    manifest:
      file: app.json
      required_fields: [expo]
    inherits: typescript
    
  nextjs:
    manifest:
      files: [next.config.js, next.config.mjs, next.config.ts]
    inherits: typescript
    
  dotnet:
    manifest:
      pattern: "*.csproj"
    dependencies:
      pattern: '<ProjectReference Include="([^"]+)"'
      
  python:
    manifest:
      file: pyproject.toml
      required_fields: [project.name]
    dependencies:
      field: project.dependencies
      path_filter: "{ path = "  # Path dependencies are workspace projects
```

### Project Detection Logic

```typescript
interface Project {
  name: string;
  path: string;                    // Relative to workspace root
  type: ProjectType;
  manifestFile: ManifestFile;
  projectDependencies: string[];   // Other projects in workspace
}

interface ManifestFile {
  path: string;
  type: 'package.json' | 'csproj' | 'fsproj' | 'pyproject.toml' | 'go.mod' | 'Cargo.toml';
}

type ProjectType = 
  | 'typescript' 
  | 'javascript'
  | 'expo' 
  | 'nextjs' 
  | 'dotnet' 
  | 'python'
  | 'go'
  | 'rust';

async function discoverProjects(workspaceRoot: string): Promise<Project[]> {
  const config = await loadWorkspaceConfig(workspaceRoot);
  const projects: Project[] = [];
  
  for (const root of config.discovery.roots) {
    const dirs = await glob(root, { cwd: workspaceRoot });
    
    for (const dir of dirs) {
      const project = await detectProject(dir, config.project_types);
      if (project) {
        projects.push(project);
      }
    }
  }
  
  return projects;
}

async function detectProject(
  dir: string, 
  typeConfigs: ProjectTypeConfig[]
): Promise<Project | null> {
  for (const [typeName, config] of Object.entries(typeConfigs)) {
    const manifest = await findManifest(dir, config.manifest);
    if (manifest) {
      return {
        name: await extractProjectName(manifest, config),
        path: dir,
        type: typeName as ProjectType,
        manifestFile: manifest,
        projectDependencies: await extractProjectDependencies(manifest, config),
      };
    }
  }
  return null;
}
```

---

## Dependency Graph

### Building the Graph

```typescript
interface DependencyGraph {
  projects: Map<string, Project>;
  dependencies: Map<string, string[]>;    // project → its dependencies
  dependents: Map<string, string[]>;      // project → what depends on it
}

function buildDependencyGraph(projects: Project[]): DependencyGraph {
  const graph: DependencyGraph = {
    projects: new Map(),
    dependencies: new Map(),
    dependents: new Map(),
  };
  
  // Index all projects
  for (const project of projects) {
    graph.projects.set(project.name, project);
    graph.dependencies.set(project.name, project.projectDependencies);
    graph.dependents.set(project.name, []);
  }
  
  // Build reverse graph (dependents)
  for (const project of projects) {
    for (const dep of project.projectDependencies) {
      if (graph.dependents.has(dep)) {
        graph.dependents.get(dep)!.push(project.name);
      }
    }
  }
  
  return graph;
}
```

### Parsing Project Dependencies by Language

```typescript
// TypeScript/JavaScript: Parse workspace dependencies from package.json
async function parseTypeScriptDependencies(
  manifestPath: string,
  allProjects: string[]
): Promise<string[]> {
  const packageJson = await readJson(manifestPath);
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  
  return Object.keys(allDeps).filter(dep => 
    // Workspace protocol (yarn/pnpm)
    allDeps[dep].startsWith('workspace:') ||
    // Or matches a known project name
    allProjects.includes(dep)
  );
}

// C# / .NET: Parse ProjectReference from *.csproj
async function parseDotNetDependencies(manifestPath: string): Promise<string[]> {
  const csproj = await readFile(manifestPath, 'utf-8');
  const pattern = /<ProjectReference Include="([^"]+)"/g;
  const deps: string[] = [];
  
  let match;
  while ((match = pattern.exec(csproj)) !== null) {
    // Extract project name from path like "../Shared/Shared.csproj"
    const refPath = match[1];
    const projectName = path.basename(refPath, '.csproj');
    deps.push(projectName);
  }
  
  return deps;
}

// Python: Parse path dependencies from pyproject.toml
async function parsePythonDependencies(
  manifestPath: string,
  allProjects: string[]
): Promise<string[]> {
  const pyproject = await readToml(manifestPath);
  const deps: string[] = [];
  
  // Look for path dependencies
  for (const dep of pyproject.project?.dependencies || []) {
    // Format: "shared @ {path = '../shared'}"
    if (dep.includes('path =')) {
      const pathMatch = dep.match(/path\s*=\s*['"]([^'"]+)['"]/);
      if (pathMatch) {
        const projectName = path.basename(pathMatch[1]);
        if (allProjects.includes(projectName)) {
          deps.push(projectName);
        }
      }
    }
  }
  
  return deps;
}
```

---

## Affected Detection

### File-Based Approach (Nx-Style)

```typescript
async function getAffectedProjects(
  changedFiles: string[],
  graph: DependencyGraph
): Promise<string[]> {
  // Step 1: Map changed files to projects
  const directlyChanged = new Set<string>();
  
  for (const file of changedFiles) {
    for (const [name, project] of graph.projects) {
      if (file.startsWith(project.path + '/')) {
        directlyChanged.add(name);
        break;
      }
    }
  }
  
  // Step 2: Find transitive dependents
  const affected = new Set(directlyChanged);
  const queue = [...directlyChanged];
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = graph.dependents.get(current) || [];
    
    for (const dep of dependents) {
      if (!affected.has(dep)) {
        affected.add(dep);
        queue.push(dep);  // Check its dependents too
      }
    }
  }
  
  return Array.from(affected);
}

// Get changed files from Git
async function getChangedFiles(base: string = 'origin/main'): Promise<string[]> {
  const { stdout } = await exec(`git diff ${base} --name-only`);
  return stdout.trim().split('\n').filter(Boolean);
}
```

### Topological Sort for Execution Order

```typescript
function topologicalSort(
  projects: string[],
  graph: DependencyGraph
): string[] {
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  
  function visit(project: string) {
    if (visited.has(project)) return;
    if (visiting.has(project)) {
      throw new Error(`Circular dependency detected: ${project}`);
    }
    
    visiting.add(project);
    
    // Visit dependencies first
    for (const dep of graph.dependencies.get(project) || []) {
      if (projects.includes(dep)) {
        visit(dep);
      }
    }
    
    visiting.delete(project);
    visited.add(project);
    sorted.push(project);
  }
  
  for (const project of projects) {
    visit(project);
  }
  
  return sorted;
}
```

---

## Validator System

### Generic Validator Interface

```typescript
interface Validator {
  name: string;
  description: string;
  projectTypes: ProjectType[];  // Which project types this applies to
  
  validate(context: ValidationContext): Promise<ValidationResult>;
}

interface ValidationContext {
  project: Project;
  workspaceRoot: string;
  changedFiles?: string[];
  config: ValidatorConfig;
}

interface ValidationResult {
  validator: string;
  project: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  issues: Issue[];
  duration_ms: number;
}

interface Issue {
  id: string;
  file: string;
  line: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  code?: string;        // TS2322, CS0001, E501
  source?: string;      // tsc, eslint, dotnet, mypy
  
  // Enrichment (added later)
  context?: IssueContext;
  prompt_md?: string;
}
```

### Built-in Validators

```yaml
# Validators by project type

typescript:
  validators:
    - name: typecheck
      command: npx tsc --noEmit
      parser: typescript-diagnostic
      
    - name: lint
      command: npx eslint --format json {files}
      parser: eslint-json
      
    - name: test
      command: npx vitest run --reporter=json
      parser: vitest-json

expo:
  inherits: typescript
  validators:
    - name: expo-doctor
      command: npx expo-doctor
      parser: expo-doctor

nextjs:
  inherits: typescript
  validators:
    - name: next-lint
      command: npx next lint --format json
      parser: eslint-json

dotnet:
  validators:
    - name: build
      command: dotnet build --no-restore -warnaserror
      parser: msbuild
      
    - name: test
      command: dotnet test --no-build --logger "trx;LogFileName=results.trx"
      parser: trx

python:
  validators:
    - name: typecheck
      command: mypy --output=json .
      parser: mypy-json
      
    - name: lint
      command: ruff check --output-format=json .
      parser: ruff-json
      
    - name: test
      command: pytest --tb=short -q
      parser: pytest
```

---

## Output Parsers

```typescript
interface OutputParser {
  name: string;
  parse(stdout: string, stderr: string, exitCode: number): Issue[];
}

// TypeScript compiler output parser
const typescriptParser: OutputParser = {
  name: 'typescript-diagnostic',
  parse(stdout, stderr, exitCode) {
    const issues: Issue[] = [];
    const pattern = /^(.+)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)$/gm;
    
    let match;
    while ((match = pattern.exec(stderr)) !== null) {
      issues.push({
        id: crypto.randomUUID(),
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        severity: match[4] as 'error' | 'warning',
        code: match[5],
        message: match[6],
        source: 'tsc',
      });
    }
    return issues;
  },
};

// MSBuild output parser (C# / .NET)
const msbuildParser: OutputParser = {
  name: 'msbuild',
  parse(stdout, stderr, exitCode) {
    const issues: Issue[] = [];
    // MSBuild format: "File.cs(10,5): error CS0001: Message"
    const pattern = /^(.+)\((\d+),(\d+)\): (error|warning) (CS\d+): (.+)$/gm;
    
    let match;
    while ((match = pattern.exec(stdout)) !== null) {
      issues.push({
        id: crypto.randomUUID(),
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        severity: match[4] as 'error' | 'warning',
        code: match[5],
        message: match[6],
        source: 'dotnet',
      });
    }
    return issues;
  },
};

// ESLint JSON output parser
const eslintParser: OutputParser = {
  name: 'eslint-json',
  parse(stdout, stderr, exitCode) {
    const results = JSON.parse(stdout);
    const issues: Issue[] = [];
    
    for (const file of results) {
      for (const msg of file.messages) {
        issues.push({
          id: crypto.randomUUID(),
          file: file.filePath,
          line: msg.line,
          column: msg.column,
          severity: msg.severity === 2 ? 'error' : 'warning',
          code: msg.ruleId,
          message: msg.message,
          source: 'eslint',
        });
      }
    }
    return issues;
  },
};
```

---

## Project Configuration

### Per-Project Config

```yaml
# projects/shared/.devac/project.yaml

project:
  name: shared
  type: typescript
  
validators:
  typecheck:
    enabled: true
    
  lint:
    enabled: true
    config:
      extensions: [.ts, .tsx]
      
  test:
    enabled: true
    config:
      coverage: true

# Override inherited validators
overrides:
  audit:
    enabled: false  # Disable security audit for this project
```

### Workspace-Level Defaults

```yaml
# .devac/workspace.yaml

defaults:
  typescript:
    validators: [typecheck, lint, test]
    
  dotnet:
    validators: [build, test]
    
  python:
    validators: [typecheck, lint, test]

# Validation phases
phases:
  quick:
    description: Fast feedback during development
    validators: [typecheck, lint]
    
  full:
    description: Complete validation before commit/merge
    validators: [typecheck, lint, test, audit]
```

---

## MCP Integration

### Tools

```typescript
const mcpTools: MCPTool[] = [
  {
    name: 'get_workspace_status',
    description: 'Get validation status across all projects',
    parameters: {},
    handler: async () => ({
      projects: await getAllProjectStatuses(),
      dependency_graph: await getDependencyGraphSummary(),
    }),
  },

  {
    name: 'get_affected_projects',
    description: 'Get projects affected by current changes',
    parameters: {
      base: { type: 'string', default: 'origin/main' },
    },
    handler: async ({ base }) => {
      const changed = await getChangedFiles(base);
      const affected = await getAffectedProjects(changed, graph);
      return {
        changed_files: changed.length,
        affected_projects: affected,
        execution_order: topologicalSort(affected, graph),
      };
    },
  },

  {
    name: 'get_issues',
    description: 'Get validation issues with optional filters',
    parameters: {
      project: { type: 'string', optional: true },
      severity: { type: 'string', enum: ['error', 'warning', 'info'], optional: true },
      validator: { type: 'string', optional: true },
    },
    handler: async (filters) => {
      const issues = await queryIssues(filters);
      return issues.map(i => ({
        ...i,
        prompt_md: i.prompt_md,  // Pre-generated, language-aware
      }));
    },
  },

  {
    name: 'run_validation',
    description: 'Run validation on a project',
    parameters: {
      project: { type: 'string', required: true },
      phase: { type: 'string', enum: ['quick', 'full'], default: 'quick' },
    },
    handler: async ({ project, phase }) => {
      return await runValidation(project, phase);
    },
  },

  {
    name: 'get_project_info',
    description: 'Get detailed information about a project',
    parameters: {
      project: { type: 'string', required: true },
    },
    handler: async ({ project }) => {
      const p = graph.projects.get(project);
      return {
        name: p.name,
        type: p.type,
        path: p.path,
        manifest: p.manifestFile.path,
        dependencies: graph.dependencies.get(project),
        dependents: graph.dependents.get(project),
        validators: getValidatorsForType(p.type),
      };
    },
  },
];
```

---

## Directory Structure

```
workspace/                          # WORKSPACE root
├── .devac/
│   ├── workspace.yaml              # Workspace configuration
│   ├── hub/
│   │   ├── state.json              # Validation state
│   │   ├── dependency-graph.json   # Cached project dependencies
│   │   └── issues/
│   │       └── all-issues.parquet  # Aggregated issues
│   └── parsers/                    # Custom output parsers
│
├── projects/                       # PROJECT directory
│   ├── shared/                     # A PROJECT (TypeScript)
│   │   ├── .devac/
│   │   │   └── project.yaml        # Project-specific config
│   │   ├── package.json            # MANIFEST FILE (JS/TS specific)
│   │   ├── tsconfig.json
│   │   └── src/
│   │
│   ├── api/                        # A PROJECT (C# .NET)
│   │   ├── .devac/
│   │   │   └── project.yaml
│   │   ├── Api.csproj              # MANIFEST FILE (.NET specific)
│   │   └── src/
│   │
│   └── data-pipeline/              # A PROJECT (Python)
│       ├── .devac/
│       │   └── project.yaml
│       ├── pyproject.toml          # MANIFEST FILE (Python specific)
│       └── src/
│
└── apps/                           # Applications
    ├── mobile/                     # A PROJECT (Expo)
    │   ├── package.json            # MANIFEST FILE
    │   └── app.json
    │
    └── web/                        # A PROJECT (Next.js)
        ├── package.json            # MANIFEST FILE
        └── next.config.js
```

---

## CLI Interface

```bash
# Workspace commands
devac status                        # Show workspace validation status
devac graph                         # Show project dependency graph
devac affected                      # List affected projects

# Project commands
devac validate <project>            # Validate a specific project
devac validate --affected           # Validate all affected projects
devac validate --all                # Validate all projects

# Phase selection
devac validate <project> --quick    # Fast validation (typecheck, lint)
devac validate <project> --full     # Full validation (all validators)

# Output
devac issues                        # List all issues
devac issues --project=shared       # Issues for specific project
devac issues --severity=error       # Filter by severity

# Watch mode
devac watch                         # Watch for changes, validate affected
```

---

## Glossary

| Term | Definition |
|------|------------|
| **Workspace** | The entire monorepo containing all projects |
| **Project** | A single buildable/testable unit (any language) |
| **Manifest file** | The configuration file defining a project (package.json, *.csproj, pyproject.toml, etc.) |
| **Project dependency** | A dependency on another project within the same workspace |
| **External dependency** | A third-party dependency from a registry (npm, NuGet, PyPI) |
| **Dependency graph** | The directed graph of project dependencies within the workspace |
| **Affected projects** | Projects that need revalidation due to changes in their dependencies |
| **Validator** | A tool that checks code for issues (tsc, eslint, dotnet build, mypy) |
| **Parser** | Converts validator output to standard Issue format |

### Terms NOT Used

| Avoided Term | Why | Use Instead |
|--------------|-----|-------------|
| Package | Overloaded (npm package vs workspace unit) | Project |
| Package-level | Ambiguous | Project-level |
| package.json (generic) | Not all projects have it | Manifest file |

---

## Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  DEVAC v2.1.1 KEY POINTS                                                    │
│                                                                             │
│  TERMINOLOGY                                                                │
│  • "Project" = buildable unit (not "package")                               │
│  • "Manifest file" = config file (not always "package.json")               │
│  • "Project dependency" = workspace internal (not npm/NuGet)               │
│                                                                             │
│  LANGUAGE-AGNOSTIC                                                          │
│  • Core doesn't assume any specific language                                │
│  • Manifest parsing is pluggable per language                               │
│  • Validators are configured per project type                               │
│                                                                             │
│  AFFECTED DETECTION                                                         │
│  • Git-based (what files changed?)                                          │
│  • File → Project mapping                                                   │
│  • Transitive dependent traversal                                           │
│  • No API/interface tracking (simpler, like Nx)                             │
│                                                                             │
│  FOCUS                                                                      │
│  • Orchestration: Simple or adopt Nx                                        │
│  • Unique value: LLM integration, enrichment, CodeGraph                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
