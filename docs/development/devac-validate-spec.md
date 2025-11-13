# DevAC Validation System Specification

**Version:** 1.0.0  
**Date:** 2025-11-13  
**Status:** Design Phase

## Executive Summary

This spec defines an efficient, graph-based validation system that runs TypeScript type checking, linting, and tests **only when needed** by tracking dependencies in Neo4j and using change detection to determine affected scope.

**Core Principle:** Never run validation twice for unchanged code; always run validation for affected code.

---

## 1. Current State Assessment

### 1.1 Graph Data Quality (as of 2025-11-13)

**Coverage:**
- **Total Files Analyzed:** 3,950 (68% of workspace)
- **Repositories:**
  - `app`: 1,323 files (React Native)
  - `frontend-monorepo`: 919 files (Web apps)
  - `monorepo-3.0`: 645 files (Backend services)
  - `mindler`: 463 files (Unknown - needs investigation)
  - `contentful-monorepo`: 425 files (CMS config)
  - `CodeGraph`: 173 files (This project)

**Node Types Extracted:**
- **Files:** 3,950
- **Functions:** 15,584 (100% named)
- **Imports:** 17,740 (with moduleSpecifier, importedNames)
- **Parameters:** 16,743
- **Variables:** 8,066
- **Type Aliases:** 3,159
- **JSX Elements:** 9,854
- **JSX Attributes:** 15,755
- **Interfaces:** 859
- **Classes:** 195
- **Methods:** 900
- **Tailwind Classes:** 209

**Relationship Types:**
- `CONTAINS`: 20,077 (File → AST nodes)
- `IMPORTS`: 17,740 (File → Import node)
- `HAS_PARAMETER`: 16,743
- `HAS_PROP`: 15,755
- `RENDERS_ELEMENT`: 7,395
- `HAS_METHOD`: 900
- `USES_TAILWIND_CLASS`: 236

### 1.2 What's Working

✅ **AST Extraction:** Deep parsing of TypeScript/TSX files  
✅ **Import Detection:** Captures all import statements with named/default imports  
✅ **Function/Class Extraction:** Comprehensive code structure analysis  
✅ **React/JSX Analysis:** Component structure and props  

### 1.3 What's Missing for Validation

❌ **Package Metadata:** No `package.json` files analyzed (not in extension list)  
❌ **File-to-File Dependencies:** Import nodes exist but no resolved `File→File` edges  
❌ **Configuration Files:** `tsconfig.json`, `.eslintrc`, `jest.config.js` not tracked  
❌ **Type-Only Imports:** Not distinguished for dependency analysis  
❌ **Monorepo Structure:** No `Repository` or `Package` nodes  
❌ **Build Artifacts:** No tracking of `.d.ts`, compiled outputs  
❌ **Test Relationships:** No `TEST_FOR` relationships  

### 1.4 Data Quality Issues

**Critical:**
1. **No Package Graph:** Cannot determine package boundaries or dependencies
2. **Unresolved Imports:** Import nodes have `moduleSpecifier` but no link to target file
3. **Missing Config Dependencies:** Changes to configs don't trigger validation

**Non-Critical:**
4. Incomplete coverage (68%) - stopped on a hung file
5. No git metadata (commits, branches) for change detection

---

## 2. Dependency Model

### 2.1 Dependency Types

#### File-Level Dependencies
```cypher
// Direct import relationship
(:File {path: "/app/Button.tsx"})-[:IMPORTS {
  isTypeOnly: false,
  importedNames: ["useState", "useEffect"]
}]->(:File {path: "react"})

// Type-only import (doesn't require runtime validation)
(:File {path: "/app/types.ts"})-[:IMPORTS {
  isTypeOnly: true,
  importedNames: ["ButtonProps"]
}]->(:File {path: "./Button.types.ts"})
```

**Why:** File changes affect all importers. Type-only imports only affect TypeScript checking, not runtime/tests.

#### Package-Level Dependencies
```cypher
(:Package {name: "@mindler/app"})-[:DEPENDS_ON {
  version: "^1.0.0",
  type: "dependencies" // or "devDependencies"
}]->(:Package {name: "@mindler/ui"})
```

**Why:** Package.json changes affect all files in dependent packages.

#### Configuration Dependencies
```cypher
(:File)-[:USES_CONFIG]->(:ConfigFile {path: "tsconfig.json", type: "typescript"})
(:Package)-[:HAS_CONFIG]->(:ConfigFile {path: "jest.config.js", type: "test"})
```

**Why:** Config changes affect all files/packages that use them.

#### Test Dependencies
```cypher
(:TestFile {path: "Button.test.tsx"})-[:TESTS]->(:File {path: "Button.tsx"})
(:TestFile)-[:TESTS_INTEGRATION]->(:Package {name: "@mindler/app"})
```

**Why:** Know which tests to run when code changes.

### 2.2 Graph Schema Extensions

#### New Node Types

```typescript
// Repository (monorepo root or standalone)
interface Repository {
  path: string;              // "/Users/grop/ws/monorepo-3.0"
  name: string;              // "monorepo-3.0"
  type: "monorepo" | "standalone";
  packageManager: "npm" | "yarn" | "pnpm";
  rootConfig: {
    typescript?: string;     // path to root tsconfig
    eslint?: string;         // path to root eslintrc
  };
}

// Package (workspace package)
interface Package {
  name: string;              // "@mindler/app"
  path: string;              // "/Users/grop/ws/monorepo-3.0/packages/app"
  version: string;           // "1.0.0"
  main?: string;             // entry point
  types?: string;            // .d.ts entry
  scripts: Record<string, string>;
}

// ConfigFile
interface ConfigFile {
  path: string;
  type: "typescript" | "eslint" | "jest" | "vite" | "webpack";
  extends?: string[];        // configs it extends
  affectsFilePatterns: string[]; // "src/**/*.ts"
}

// ValidationRun (track what was validated when)
interface ValidationRun {
  id: string;
  type: "typecheck" | "lint" | "test";
  scope: "file" | "package" | "repository";
  targetPath: string;
  status: "success" | "failure" | "skipped";
  startedAt: string;
  completedAt: string;
  gitCommit?: string;
  errors: number;
  warnings: number;
}
```

#### New Relationships

```cypher
// Repository structure
(:Repository)-[:CONTAINS]->(:Package)
(:Package)-[:CONTAINS]->(:File)

// Package dependencies
(:Package)-[:DEPENDS_ON {version, type}]->(:Package)

// File imports (RESOLVED)
(:File)-[:IMPORTS_FILE {
  importedNames: string[],
  isTypeOnly: boolean,
  isRelative: boolean
}]->(:File)

// External dependencies
(:File)-[:IMPORTS_EXTERNAL {
  packageName: string,
  importedNames: string[]
}]->(:Package)

// Config dependencies
(:File)-[:USES_CONFIG]->(:ConfigFile)
(:Package)-[:HAS_CONFIG]->(:ConfigFile)
(:ConfigFile)-[:EXTENDS]->(:ConfigFile)

// Test relationships
(:TestFile)-[:TESTS]->(:File)
(:TestFile)-[:TESTS_PACKAGE]->(:Package)

// Validation history
(:File)-[:VALIDATED_BY]->(:ValidationRun)
(:Package)-[:VALIDATED_BY]->(:ValidationRun)
```

---

## 3. Change Detection Strategy

### 3.1 Change Sources

**File System Watcher (Real-time)**
```typescript
// Already implemented in CodeGraph service
chokidar.watch(paths).on('change', (filePath) => {
  // Mark file as changed
  // Trigger affected analysis
});
```

**Git Diff (CI/PR mode)**
```typescript
// For PR validation
const changedFiles = execSync('git diff --name-only origin/main...HEAD')
  .toString()
  .split('\n');
```

**Manual Trigger (Full sync)**
```bash
# Force validation of everything
devac validate --all
```

### 3.2 Affected Calculation Algorithm

**Core Algorithm (inspired by Nx/Turborepo):**

```cypher
// 1. Find changed files
MATCH (changed:File)
WHERE changed.lastModified > $sinceTimestamp
   OR changed.entityId IN $explicitChanges

// 2. Find all files that import changed files (transitive)
MATCH path = (affected:File)-[:IMPORTS_FILE*1..]->(changed)
RETURN DISTINCT affected

// 3. Find packages containing affected files
MATCH (pkg:Package)-[:CONTAINS]->(affected)
RETURN DISTINCT pkg

// 4. Find packages that depend on affected packages
MATCH (dependentPkg:Package)-[:DEPENDS_ON*1..]->(pkg)
RETURN DISTINCT dependentPkg
```

**Why Transitive:** If `A → B → C` and `C` changes, both `B` and `A` are affected because they transitively depend on `C`.

**Optimization:** Limit transitive depth to prevent full-graph traversal:
```cypher
// Limit to 5 levels deep (configurable)
MATCH path = (affected:File)-[:IMPORTS_FILE*1..5]->(changed)
```

### 3.3 Config Change Handling

**Special Case:** Config changes affect broader scope:

```cypher
// If tsconfig.json changes, ALL TypeScript files are affected
MATCH (config:ConfigFile {type: "typescript"})
WHERE config.entityId IN $changedFiles

MATCH (file:File)-[:USES_CONFIG]->(config)
RETURN file

// For monorepo: if root tsconfig changes, ALL packages affected
MATCH (config:ConfigFile {path: $repoRoot + "/tsconfig.json"})
MATCH (pkg:Package)-[:USES_CONFIG]->(config)
RETURN pkg
```

**Why:** Compiler options, lint rules, test configs affect ALL files that use them.

---

## 4. Service Triggering Architecture

### 4.1 When to Run Each Service

#### TypeCheck
**Trigger When:**
- TS/TSX file changes
- `tsconfig.json` changes  
- `.d.ts` file changes
- Package dependency added/removed (affects module resolution)

**Scope Determination:**
```typescript
// File-level: only if isolated
if (fileHasNoImporters(file) && !fileImportsChanged) {
  runTypeCheck([file]);
}

// Package-level: if file has importers in same package
if (affectedFilesInSamePackage(file)) {
  runTypeCheck(package);
}

// Repository-level: if cross-package dependencies
if (affectedFilesAcrossPackages(file)) {
  runTypeCheck(repository);
}
```

#### Lint
**Trigger When:**
- Any source file changes (.ts, .tsx, .js, .jsx)
- ESLint config changes

**Scope:** Usually file-level (lint doesn't follow dependencies like TypeScript):
```typescript
runLint(changedFiles); // Lint only changed files

// Exception: if .eslintrc changes, lint all files
if (eslintConfigChanged) {
  runLint(allFiles);
}
```

#### Test
**Trigger When:**
- Source file changes AND has tests
- Test file changes
- Test config changes (jest.config, vitest.config)
- Dependencies change (might affect mocking)

**Scope Determination:**
```cypher
// Find tests for changed files
MATCH (changed:File)<-[:TESTS]-(test:TestFile)
RETURN test

// Find integration tests for changed packages
MATCH (changed:File)<-[:CONTAINS]-(pkg:Package)
MATCH (test:TestFile)-[:TESTS_PACKAGE]->(pkg)
RETURN test
```

### 4.2 Batching and Deduplication

**Problem:** 10 files change in a package → triggers 10 separate validations → wasteful

**Solution:** Batch changes within a time window:

```typescript
class ValidationBatcher {
  private changeQueue: Map<string, Set<string>> = new Map(); // type → files
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_WINDOW = 2000; // 2 seconds

  queueChange(file: string, validationType: 'typecheck' | 'lint' | 'test') {
    if (!this.changeQueue.has(validationType)) {
      this.changeQueue.set(validationType, new Set());
    }
    this.changeQueue.get(validationType)!.add(file);

    // Reset batch timer
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(() => this.flush(), this.BATCH_WINDOW);
  }

  private async flush() {
    for (const [type, files] of this.changeQueue.entries()) {
      // Calculate affected scope
      const affected = await this.calculateAffected(files);
      
      // Determine optimal scope (file vs package vs repo)
      const scope = this.determineScope(affected);
      
      // Run validation
      await this.runValidation(type, scope);
    }
    this.changeQueue.clear();
  }

  private determineScope(affected: AffectedFiles): ValidationScope {
    // If <= 10 files in same package: file-level
    if (affected.files.length <= 10 && affected.packages.length === 1) {
      return { type: 'file', targets: affected.files };
    }
    
    // If 1-3 packages: package-level
    if (affected.packages.length <= 3) {
      return { type: 'package', targets: affected.packages };
    }
    
    // Otherwise: repository-level
    return { type: 'repository', targets: [affected.repository] };
  }
}
```

**Why:** Batching prevents redundant runs while staying responsive (2s is fast enough for dev feedback).

### 4.3 Fallback Full Sync

**Problem:** Edge cases where incremental validation misses errors (cache corruption, graph stale, etc.)

**Solution:** Periodic full validation:

```typescript
// Daily full validation (CI job)
cron.schedule('0 2 * * *', async () => {
  await runFullValidation({
    typecheck: true,
    lint: true,
    test: true,
    updateGraph: true // Rebuild dependency graph from scratch
  });
});

// Manual trigger for safety
$ devac validate --full --verify-graph
```

**Why:** 100% correctness guarantee while maintaining speed during development.

---

## 5. Graph Schema Extensions Implementation

### 5.1 Repository & Package Discovery

**Step 1: Find all package.json files**
```typescript
async function discoverMonorepo(rootPath: string): Promise<Repository> {
  const packageJsonFiles = await glob('**/package.json', {
    cwd: rootPath,
    ignore: ['**/node_modules/**']
  });

  const packages: Package[] = [];
  
  for (const pkgPath of packageJsonFiles) {
    const pkgJson = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    
    packages.push({
      name: pkgJson.name,
      path: path.dirname(pkgPath),
      version: pkgJson.version,
      main: pkgJson.main,
      types: pkgJson.types,
      scripts: pkgJson.scripts,
      dependencies: pkgJson.dependencies,
      devDependencies: pkgJson.devDependencies
    });
  }

  return {
    path: rootPath,
    name: path.basename(rootPath),
    type: packages.length > 1 ? 'monorepo' : 'standalone',
    packageManager: detectPackageManager(rootPath),
    packages
  };
}
```

**Step 2: Create graph nodes**
```cypher
// Create repository
CREATE (r:Repository {
  path: $repoPath,
  name: $repoName,
  type: $repoType,
  packageManager: $pkgManager,
  entityId: $entityId,
  createdAt: datetime()
})

// Create packages
UNWIND $packages AS pkg
CREATE (p:Package {
  name: pkg.name,
  path: pkg.path,
  version: pkg.version,
  main: pkg.main,
  types: pkg.types,
  entityId: $entityId,
  createdAt: datetime()
})

// Link repository to packages
MATCH (r:Repository {path: $repoPath})
MATCH (p:Package) WHERE p.path STARTS WITH r.path
CREATE (r)-[:CONTAINS]->(p)

// Link packages to files
MATCH (p:Package)
MATCH (f:File) WHERE f.filePath STARTS WITH p.path
CREATE (p)-[:CONTAINS]->(f)
```

### 5.2 Resolving Import Relationships

**Problem:** Import nodes have `moduleSpecifier` but no link to actual file

**Solution:** Resolve imports using Node.js module resolution algorithm

```typescript
async function resolveImport(
  fromFile: string,
  moduleSpecifier: string,
  tsconfig?: TSConfig
): Promise<string | null> {
  // Relative import: ./Button, ../utils/helpers
  if (moduleSpecifier.startsWith('.')) {
    return resolveRelativeImport(fromFile, moduleSpecifier);
  }

  // Path alias: @/components/Button
  if (tsconfig?.compilerOptions?.paths) {
    const resolved = resolvePathAlias(moduleSpecifier, tsconfig);
    if (resolved) return resolved;
  }

  // Package import: react, @mindler/ui
  return resolvePackageImport(moduleSpecifier);
}

// Update graph with resolved imports
async function linkImportsToFiles() {
  const imports = await neo4j.query(`
    MATCH (f:File)-[:IMPORTS]->(i:Import)
    RETURN f.filePath as from, i.moduleSpecifier as spec, i
  `);

  for (const { from, spec, i } of imports) {
    const resolved = await resolveImport(from, spec, getTsConfig(from));
    
    if (resolved && isLocalFile(resolved)) {
      // Create File→File edge
      await neo4j.query(`
        MATCH (from:File {filePath: $fromPath})
        MATCH (to:File {filePath: $toPath})
        CREATE (from)-[:IMPORTS_FILE {
          importedNames: $names,
          isTypeOnly: $typeOnly,
          isRelative: $isRelative
        }]->(to)
      `, {
        fromPath: from,
        toPath: resolved,
        names: i.importedNames,
        typeOnly: i.isTypeOnly,
        isRelative: spec.startsWith('.')
      });
    } else if (isExternalPackage(spec)) {
      // Link to external package
      await neo4j.query(`
        MATCH (from:File {filePath: $fromPath})
        MATCH (pkg:Package {name: $pkgName})
        CREATE (from)-[:IMPORTS_EXTERNAL {
          packageName: $pkgName,
          importedNames: $names
        }]->(pkg)
      `, {
        fromPath: from,
        pkgName: getPackageName(spec),
        names: i.importedNames
      });
    }
  }
}
```

**Why:** Resolved imports enable transitive dependency analysis for affected calculation.

### 5.3 Configuration Tracking

**Discover configs:**
```typescript
async function discoverConfigs(repoPath: string): Promise<ConfigFile[]> {
  const configs: ConfigFile[] = [];

  // TypeScript configs
  const tsconfigs = await glob('**/tsconfig*.json', { cwd: repoPath });
  for (const config of tsconfigs) {
    const content = JSON.parse(await fs.readFile(config, 'utf-8'));
    configs.push({
      path: config,
      type: 'typescript',
      extends: content.extends ? [content.extends] : [],
      affectsFilePatterns: content.include || ['**/*.ts', '**/*.tsx']
    });
  }

  // ESLint configs
  const eslintConfigs = await glob('**/.eslintrc*', { cwd: repoPath });
  // Similar for eslint, jest, etc.

  return configs;
}
```

**Link to affected files:**
```cypher
// Create config nodes
CREATE (c:ConfigFile {
  path: $path,
  type: $type,
  extends: $extends,
  affectsFilePatterns: $patterns,
  entityId: $entityId
})

// Link files to configs they use
MATCH (c:ConfigFile {type: "typescript"})
MATCH (f:File {language: "TypeScript"})
WHERE any(pattern IN c.affectsFilePatterns WHERE f.filePath =~ pattern)
CREATE (f)-[:USES_CONFIG]->(c)

// Link config inheritance
MATCH (child:ConfigFile), (parent:ConfigFile)
WHERE parent.path IN child.extends
CREATE (child)-[:EXTENDS]->(parent)
```

### 5.4 Test Relationship Mapping

**Heuristic-based discovery:**
```typescript
function findTestsForFile(sourceFile: string): string[] {
  const tests: string[] = [];
  const dir = path.dirname(sourceFile);
  const name = path.basename(sourceFile, path.extname(sourceFile));

  // Convention 1: Button.tsx → Button.test.tsx (co-located)
  const colocated = path.join(dir, `${name}.test.tsx`);
  if (fs.existsSync(colocated)) tests.push(colocated);

  // Convention 2: Button.tsx → __tests__/Button.test.tsx
  const testDir = path.join(dir, '__tests__', `${name}.test.tsx`);
  if (fs.existsSync(testDir)) tests.push(testDir);

  // Convention 3: src/Button.tsx → tests/Button.test.tsx
  const parallelTests = sourceFile.replace('/src/', '/tests/').replace('.tsx', '.test.tsx');
  if (fs.existsSync(parallelTests)) tests.push(parallelTests);

  return tests;
}
```

**Create relationships:**
```cypher
// Link test files to source files
MATCH (test:File) WHERE test.filePath =~ '.*\\.test\\.(ts|tsx|js|jsx)$'
MATCH (src:File {filePath: $sourceFile})
CREATE (test)-[:TESTS]->(src)

// Link integration tests to packages
MATCH (test:File) WHERE test.filePath =~ '.*\\.integration\\.test\\.tsx?$'
MATCH (pkg:Package)-[:CONTAINS]->(test)
CREATE (test)-[:TESTS_PACKAGE]->(pkg)
```

---

## 6. Implementation Strategy

### 6.1 Phase 1: Graph Schema Enhancement (Week 1-2)

**Goals:**
- Add Repository, Package, ConfigFile node types
- Discover and populate repository/package structure
- Resolve import relationships

**Deliverables:**
```cypher
// Verify schema
CALL db.schema.visualization()

// Check repository structure
MATCH (r:Repository)-[:CONTAINS]->(p:Package)-[:CONTAINS]->(f:File)
RETURN r.name, count(DISTINCT p) as packages, count(f) as files

// Check resolved imports
MATCH (f1:File)-[r:IMPORTS_FILE]->(f2:File)
RETURN count(r) as resolvedImports
```

**Implementation:**
```typescript
// src/devac/services/codegraph/enhancers/repository-enhancer.ts
export class RepositoryEnhancer {
  async enhance(rootPath: string) {
    const repo = await this.discoverRepository(rootPath);
    await this.createRepositoryNode(repo);
    
    for (const pkg of repo.packages) {
      await this.createPackageNode(pkg);
      await this.linkPackageToFiles(pkg);
      await this.linkPackageDependencies(pkg);
    }
  }
}

// src/devac/services/codegraph/enhancers/import-resolver.ts
export class ImportResolver {
  async resolveAllImports() {
    const imports = await this.getUnresolvedImports();
    
    for (const imp of imports) {
      const resolved = await this.resolve(imp);
      if (resolved) {
        await this.createImportEdge(imp, resolved);
      }
    }
  }
}
```

### 6.2 Phase 2: Change Detection & Affected Analysis (Week 3)

**Goals:**
- Implement affected calculation algorithm
- Add batching and deduplication
- Create ValidationRun tracking

**Deliverables:**
```typescript
// API for affected calculation
const affected = await affectedAnalyzer.calculate({
  changedFiles: ['src/Button.tsx'],
  since: '2025-11-12T00:00:00Z'
});

// Result
{
  files: ['src/Button.tsx', 'src/App.tsx'], // transitive
  packages: ['@mindler/ui', '@mindler/app'],
  repositories: ['mindler']
}
```

**Implementation:**
```typescript
// src/devac/validation/affected-analyzer.ts
export class AffectedAnalyzer {
  async calculate(options: CalculateOptions): Promise<AffectedScope> {
    // 1. Find directly changed files
    const changed = await this.getChangedFiles(options);
    
    // 2. Find transitively affected files
    const affected = await this.findTransitiveAffected(changed);
    
    // 3. Group by package/repository
    return this.groupByScope(affected);
  }

  private async findTransitiveAffected(files: string[]): Promise<Set<string>> {
    return neo4j.query(`
      MATCH (changed:File) WHERE changed.filePath IN $files
      MATCH path = (affected:File)-[:IMPORTS_FILE*1..5]->(changed)
      RETURN DISTINCT affected.filePath
    `, { files });
  }
}
```

### 6.3 Phase 3: Service Integration (Week 4)

**Goals:**
- Integrate affected analysis with TypeCheck/Lint/Test services
- Implement scope determination (file vs package vs repo)
- Add batching to prevent redundant runs

**Implementation:**
```typescript
// src/devac/validation/validation-coordinator.ts
export class ValidationCoordinator {
  private batcher = new ValidationBatcher();
  private affectedAnalyzer = new AffectedAnalyzer();

  async onFileChange(filePath: string) {
    // Queue for batching
    this.batcher.queueChange(filePath, ['typecheck', 'lint', 'test']);
  }

  async runValidation(type: ValidationType, scope: ValidationScope) {
    const run = await this.createValidationRun(type, scope);
    
    try {
      const result = await this.executeValidation(type, scope);
      await this.updateValidationRun(run, result);
      
      // Broadcast via SSE
      this.eventBus.emit('validation:complete', { run, result });
    } catch (error) {
      await this.handleValidationError(run, error);
    }
  }

  private async executeValidation(
    type: ValidationType,
    scope: ValidationScope
  ): Promise<ValidationResult> {
    switch (type) {
      case 'typecheck':
        return this.typecheckService.run(scope);
      case 'lint':
        return this.lintService.run(scope);
      case 'test':
        return this.testService.run(scope);
    }
  }
}
```

### 6.4 Phase 4: Validation History & Caching (Week 5)

**Goals:**
- Track validation runs in graph
- Skip validation for unchanged files
- Implement hash-based caching (inspired by Bazel)

**Implementation:**
```typescript
// Hash-based validation skip
async function shouldSkipValidation(
  file: string,
  validationType: string
): Promise<boolean> {
  const currentHash = await hashFile(file);
  
  const lastRun = await neo4j.query(`
    MATCH (f:File {filePath: $file})-[:VALIDATED_BY]->(run:ValidationRun {type: $type})
    WHERE run.status = "success"
    RETURN run.fileHash as hash
    ORDER BY run.completedAt DESC
    LIMIT 1
  `, { file, type: validationType });

  return lastRun && lastRun.hash === currentHash;
}

// Track validation runs
async function recordValidationRun(run: ValidationRun) {
  await neo4j.query(`
    CREATE (run:ValidationRun {
      id: $id,
      type: $type,
      scope: $scope,
      targetPath: $targetPath,
      status: $status,
      startedAt: $startedAt,
      completedAt: $completedAt,
      errors: $errors,
      warnings: $warnings,
      fileHashes: $fileHashes,
      gitCommit: $gitCommit
    })
    
    // Link to validated files
    WITH run
    UNWIND $validatedFiles AS filePath
    MATCH (f:File {filePath: filePath})
    CREATE (f)-[:VALIDATED_BY]->(run)
  `, run);
}
```

### 6.5 Phase 5: UI & Monitoring (Week 6)

**Goals:**
- Real-time validation status in UI
- Dependency graph visualization
- Validation history dashboard

**Implementation:**
```typescript
// SSE events for real-time updates
eventBus.on('validation:started', (run) => {
  sseManager.broadcast({
    type: 'VALIDATION_STARTED',
    run: {
      id: run.id,
      type: run.type,
      scope: run.scope,
      targetPath: run.targetPath
    }
  });
});

eventBus.on('validation:complete', (run, result) => {
  sseManager.broadcast({
    type: 'VALIDATION_COMPLETE',
    run: {
      ...run,
      status: result.status,
      errors: result.errors.length,
      warnings: result.warnings.length
    }
  });
});

// Frontend visualization
function DependencyGraphView() {
  const [affected, setAffected] = useState<AffectedScope | null>(null);

  useEffect(() => {
    // Fetch affected files for current change
    api.getAffected({ since: lastCommit }).then(setAffected);
  }, [lastCommit]);

  return (
    <GraphVisualization
      nodes={affected?.files}
      edges={affected?.dependencies}
      highlightAffected={true}
    />
  );
}
```

---

## 7. Performance Considerations

### 7.1 Graph Query Optimization

**Problem:** Transitive import queries can be slow on large graphs

**Solutions:**
1. **Limit traversal depth** (max 5 levels):
   ```cypher
   MATCH path = (a:File)-[:IMPORTS_FILE*1..5]->(b:File)
   ```

2. **Index critical properties**:
   ```cypher
   CREATE INDEX file_path_idx FOR (f:File) ON (f.filePath);
   CREATE INDEX package_name_idx FOR (p:Package) ON (p.name);
   ```

3. **Cache frequent queries** (Redis/in-memory):
   ```typescript
   const cachedAffected = await cache.get(`affected:${fileHash}`);
   if (cachedAffected) return JSON.parse(cachedAffected);
   ```

4. **Incremental graph updates** (don't rebuild from scratch):
   ```typescript
   // Only update changed nodes/edges
   await neo4j.query(`
     MATCH (f:File {filePath: $path})
     SET f.lastModified = $timestamp,
         f.hash = $hash
   `);
   ```

### 7.2 Batching Strategy

**Optimal batch window:** 2 seconds (responsive yet efficient)

**Batch size limits:**
- **File-level:** Max 100 files → switch to package-level
- **Package-level:** Max 10 packages → switch to repo-level

**Deduplication:**
```typescript
// Don't run typecheck if already running for same scope
if (this.runningValidations.has(`typecheck:${scope.id}`)) {
  logger.info('Validation already running, skipping duplicate');
  return;
}
```

### 7.3 Memory Management

**Problem:** Large graph queries can consume significant memory

**Solutions:**
1. **Stream results** instead of loading all at once:
   ```typescript
   const stream = neo4j.queryStream('MATCH (f:File) RETURN f');
   for await (const record of stream) {
     await processFile(record);
   }
   ```

2. **Pagination for large result sets**:
   ```cypher
   MATCH (f:File)
   RETURN f
   SKIP $offset
   LIMIT 1000
   ```

3. **Connection pooling** (avoid exhausting connections):
   ```typescript
   const pool = new Neo4jPool({
     maxSize: 50,
     acquisitionTimeout: 60000
   });
   ```

---

## 8. Edge Cases & Fallbacks

### 8.1 Circular Dependencies

**Problem:** A imports B imports A → infinite loop in affected calculation

**Solution:** Track visited nodes:
```cypher
// Use APOC plugin for cycle detection
CALL apoc.path.expandConfig(start, {
  relationshipFilter: "IMPORTS_FILE>",
  uniqueness: "NODE_GLOBAL", // Don't revisit nodes
  maxLevel: 10
})
```

### 8.2 Dynamic Imports

**Problem:** `import('./Button').then(...)` not statically analyzable

**Solution:** Heuristic extraction from AST:
```typescript
// Detect dynamic imports in AST
if (node.isCallExpression() && node.getExpression().getText() === 'import') {
  const arg = node.getArguments()[0];
  if (arg.isStringLiteral()) {
    const moduleSpec = arg.getLiteralValue();
    // Treat as static import for dependency purposes
  }
}
```

### 8.3 Monorepo Package Updates

**Problem:** Package A updates → all dependents need validation, but `package.json` might not be tracked

**Solution:** Watch `package.json` files explicitly:
```typescript
chokidar.watch('**/package.json', { ignoreInitial: false })
  .on('change', async (pkgPath) => {
    const pkg = await loadPackage(pkgPath);
    await this.updatePackageDependencies(pkg);
    await this.triggerDependentValidation(pkg);
  });
```

### 8.4 External Package Updates

**Problem:** `npm install` updates external dependency → might break types/code

**Solution:** Detect `node_modules` changes:
```typescript
// Hash package-lock.json or pnpm-lock.yaml
const lockfileHash = await hashFile('pnpm-lock.yaml');
if (lockfileHash !== lastKnownHash) {
  logger.info('Dependencies changed, triggering full validation');
  await this.runFullValidation();
}
```

### 8.5 Stale Graph Recovery

**Problem:** Graph gets out of sync with filesystem

**Solution:** Periodic reconciliation:
```typescript
// Daily job
async function reconcileGraph() {
  // 1. Find files in graph that no longer exist
  const orphanedFiles = await neo4j.query(`
    MATCH (f:File)
    WHERE NOT exists(f.filePath) OR NOT file.exists(f.filePath)
    RETURN f.filePath
  `);
  
  await neo4j.query(`
    MATCH (f:File) WHERE f.filePath IN $paths
    DETACH DELETE f
  `, { paths: orphanedFiles });

  // 2. Find new files not in graph
  const allFiles = await glob('**/*.{ts,tsx,js,jsx}');
  const filesInGraph = await neo4j.query('MATCH (f:File) RETURN f.filePath');
  const newFiles = difference(allFiles, filesInGraph);
  
  for (const file of newFiles) {
    await this.analyzeFile(file);
  }
}
```

---

## 9. Metrics & Observability

### 9.1 Key Metrics to Track

**Validation Performance:**
- `validation.duration` (ms) - how long validations take
- `validation.scope` (file|package|repo) - scope distribution
- `validation.skipped` (count) - how many skipped due to cache
- `validation.errors` (count) - errors found
- `validation.warnings` (count) - warnings found

**Affected Analysis:**
- `affected.files.count` - files affected per change
- `affected.packages.count` - packages affected
- `affected.calculation_time` (ms) - query performance
- `affected.depth.avg` - average transitive depth

**Graph Health:**
- `graph.nodes.total` - total nodes
- `graph.relationships.total` - total relationships
- `graph.import.resolution_rate` - % of imports resolved
- `graph.orphaned_nodes` - nodes with no relationships

### 9.2 Dashboard Queries

**Validation Status Overview:**
```cypher
MATCH (run:ValidationRun)
WHERE run.completedAt > datetime() - duration('P1D') // Last 24h
RETURN 
  run.type,
  run.status,
  count(*) as runs,
  avg(duration.between(run.startedAt, run.completedAt)) as avgDuration,
  sum(run.errors) as totalErrors
ORDER BY run.type, run.status
```

**Most Affected Files:**
```cypher
MATCH (f:File)<-[:IMPORTS_FILE*]-(importer)
RETURN f.filePath, count(DISTINCT importer) as importers
ORDER BY importers DESC
LIMIT 20
```

**Validation Cache Hit Rate:**
```cypher
MATCH (run:ValidationRun)
WHERE run.completedAt > datetime() - duration('P1D')
RETURN 
  run.type,
  sum(CASE WHEN run.cached THEN 1 ELSE 0 END) as cacheHits,
  count(*) as total,
  (sum(CASE WHEN run.cached THEN 1 ELSE 0 END) * 100.0 / count(*)) as hitRate
```

---

## 10. Migration Path

### 10.1 Current State → Target State

**Current:** Services run on entire repos, no dependency awareness  
**Target:** Services run only on affected files/packages

**Migration Steps:**

**Week 1:** Add graph schema enhancements (non-breaking)
- Deploy Repository/Package/ConfigFile nodes
- Run import resolution in background
- Verify data quality

**Week 2:** Parallel run (both old and new system)
- Run current services as-is
- ALSO calculate affected scope and compare
- Log differences, tune algorithm

**Week 3:** Gradual rollout
- Enable affected-based validation for 10% of changes
- Monitor for missed errors
- Increase to 50%, then 100%

**Week 4:** Cleanup
- Remove old monolithic validation
- Enable caching
- Optimize queries

### 10.2 Rollback Plan

**If affected analysis misses errors:**
```typescript
// Feature flag to revert to full validation
if (config.VALIDATION_MODE === 'full') {
  return await runFullValidation(type);
}

// Otherwise use affected
return await runAffectedValidation(type, affected);
```

**Emergency override:**
```bash
# Force full validation if graph is suspected stale
devac validate --full --ignore-affected
```

---

## 11. Success Criteria

**Phase 1 Complete When:**
- ✅ All repositories/packages discovered in graph
- ✅ 95%+ of imports resolved to File→File edges
- ✅ Config files linked to affected files

**Phase 2 Complete When:**
- ✅ Affected calculation returns correct transitive dependencies
- ✅ Config changes trigger appropriate scope
- ✅ Batching reduces duplicate runs by 80%+

**Phase 3 Complete When:**
- ✅ TypeCheck/Lint/Test run only on affected scope
- ✅ Average validation time reduced by 60%+ (vs full repo validation)
- ✅ No false negatives (all errors caught)

**Phase 4 Complete When:**
- ✅ Cache hit rate > 50% for unchanged files
- ✅ Validation history queryable via API/UI

**Phase 5 Complete When:**
- ✅ Real-time validation status in UI
- ✅ Dependency graph visualization shows affected scope
- ✅ Metrics dashboard operational

---

## 12. Open Questions

1. **Should we track AST-level changes?**
   - Current: File-level hashing
   - Alternative: Track function/class hashes → skip validation if only comments changed
   - Tradeoff: Complexity vs granularity

2. **How to handle generated files?**
   - Example: `.d.ts` generated from `.ts`
   - Should changes to generated files trigger validation?
   - Probably: track source → generated relationship

3. **Cross-repository dependencies?**
   - If `mindler/app` depends on `mindler/ui` via file system (not npm)
   - How to represent in graph?
   - Solution: External repository nodes with DEPENDS_ON edges

4. **Test selection optimization?**
   - Beyond file-level: can we skip tests for type-only changes?
   - Heuristic: if change is in `.types.ts` file, only run TypeScript

5. **Caching strategy for CI?**
   - Local cache: in `.devac/cache/`
   - Remote cache: S3/Redis?
   - Turborepo-style hash-based cache?

---

## 13. References

**Inspiration:**
- Turborepo: Package graph + task caching
- Nx: Affected command + project graph
- Bazel: Build graph + file hashing + hermetic builds

**Key Learnings:**
- **Turborepo:** Hash-based fingerprinting, remote caching, task dependencies
- **Nx:** Affected analysis, project graph extensibility, git-based change detection
- **Bazel:** Transitive dependencies, incremental correctness, isolated builds

**Applied to DevAC:**
- Use Neo4j graph instead of in-memory graph
- Extend to validation (not just build)
- Track at file/package/repo level
- Real-time via SSE instead of CLI-only

---

## Appendix A: Cypher Query Library

### A.1 Affected Files for Changed File
```cypher
// Find all files affected by changes to Button.tsx
MATCH (changed:File {filePath: "/app/Button.tsx"})
MATCH path = (affected:File)-[:IMPORTS_FILE*1..5]->(changed)
RETURN DISTINCT affected.filePath, length(path) as depth
ORDER BY depth
```

### A.2 Affected Packages
```cypher
// Find packages affected by file changes
MATCH (changed:File) WHERE changed.filePath IN $changedFiles
MATCH (pkg:Package)-[:CONTAINS]->(changed)
WITH collect(DISTINCT pkg) as directlyAffected

MATCH (dependent:Package)-[:DEPENDS_ON*1..]->(affected:Package)
WHERE affected IN directlyAffected
RETURN DISTINCT dependent.name
```

### A.3 Files Using Config
```cypher
// Find all files using a specific tsconfig
MATCH (config:ConfigFile {path: "/app/tsconfig.json"})
MATCH (file:File)-[:USES_CONFIG]->(config)
RETURN file.filePath
```

### A.4 Test Coverage Map
```cypher
// Find source files without tests
MATCH (src:File)
WHERE NOT src.filePath =~ '.*\\.test\\..*'
  AND NOT exists((src)<-[:TESTS]-())
RETURN src.filePath
```

### A.5 Import Depth Analysis
```cypher
// Find files with deepest import chains
MATCH path = (leaf:File)-[:IMPORTS_FILE*]->(root:File)
WHERE NOT exists((root)-[:IMPORTS_FILE]->())
RETURN leaf.filePath, length(path) as depth
ORDER BY depth DESC
LIMIT 20
```

### A.6 Package Dependency Graph
```cypher
// Visualize package dependencies
MATCH (p1:Package)-[r:DEPENDS_ON]->(p2:Package)
RETURN p1.name as from, p2.name as to, r.version as version
```

### A.7 Validation History for File
```cypher
// Get validation history for a file
MATCH (f:File {filePath: $path})-[:VALIDATED_BY]->(run:ValidationRun)
RETURN run.type, run.status, run.completedAt, run.errors, run.warnings
ORDER BY run.completedAt DESC
LIMIT 10
```

---

## Appendix B: Configuration Examples

### B.1 DevAC Config with Validation
```json
{
  "version": "1.0.0",
  "services": {
    "codegraph": {
      "enabled": true,
      "directories": ["/Users/grop/ws"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"],
      "enhancers": {
        "repository": true,
        "importResolver": true,
        "configTracker": true,
        "testMapper": true
      }
    },
    "typecheck": {
      "enabled": true,
      "mode": "affected", // "affected" | "full" | "manual"
      "scope": "auto", // "auto" | "file" | "package" | "repository"
      "cache": true,
      "repositories": [
        {
          "path": "/Users/grop/ws/monorepo-3.0",
          "strategy": "affected-turborepo"
        }
      ]
    },
    "lint": {
      "enabled": true,
      "mode": "affected",
      "cache": true,
      "repositories": [
        {
          "path": "/Users/grop/ws/monorepo-3.0",
          "strategy": "affected-per-package"
        }
      ]
    },
    "test": {
      "enabled": true,
      "mode": "affected",
      "testMapper": "heuristic", // "heuristic" | "explicit" | "all"
      "runIntegrationTests": "onPackageChange",
      "repositories": [
        {
          "path": "/Users/grop/ws/monorepo-3.0",
          "strategy": "affected-jest"
        }
      ]
    }
  },
  "validation": {
    "batchWindow": 2000,
    "maxTransitiveDepth": 5,
    "cacheStrategy": "hash-based",
    "fallbackFullSync": {
      "enabled": true,
      "schedule": "0 2 * * *"
    },
    "scopes": {
      "file": { "maxFiles": 10 },
      "package": { "maxPackages": 3 },
      "repository": {}
    }
  }
}
```

### B.2 Affected Analysis Config
```typescript
// .devac/affected.config.ts
export default {
  // Transitive depth limit
  maxDepth: 5,

  // File patterns to always include
  alwaysAffected: [
    '**/package.json',
    '**/tsconfig.json',
    '**/.eslintrc*'
  ],

  // File patterns to ignore
  ignorePatterns: [
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/*.stories.tsx'
  ],

  // Custom affected logic
  customRules: [
    {
      // If root tsconfig changes, affect all TS files
      condition: (file) => file === 'tsconfig.json',
      affectedFiles: () => glob('**/*.ts', '**/*.tsx')
    }
  ]
};
```

---

**End of Specification**

This spec provides a complete blueprint for building an efficient, graph-based validation system that runs only what's needed while maintaining 100% correctness through periodic full syncs.
