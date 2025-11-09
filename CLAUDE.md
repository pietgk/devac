# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CodeGraph Analyzer is a multi-language static code analysis tool that parses codebases and stores them as queryable knowledge graphs in Neo4j. It supports TypeScript/JavaScript, Python, Java, C#, C/C++, Go, SQL, and more, enabling AI-powered code comprehension through the Model Context Protocol (MCP).

## Architecture

### Core Components

**Two-Pass Analysis Pipeline:**
1. **Pass 1 (Parsing)**: Scans files and extracts AST nodes (classes, functions, variables, etc.)
2. **Pass 2 (Resolution)**: Resolves cross-file relationships (imports, calls, inheritance)

**Key Modules:**
- `src/analyzer/analyzer-service.ts` - Orchestrates the analysis pipeline
- `src/analyzer/parser.ts` - Coordinates language-specific parsers
- `src/analyzer/parsers/` - Individual parsers for each language (ts-morph, tree-sitter, Python AST)
- `src/analyzer/relationship-resolver.ts` - Resolves cross-file relationships in Pass 2
- `src/analyzer/storage-manager.ts` - Batches and writes nodes/relationships to Neo4j
- `src/database/neo4j-client.ts` - Manages Neo4j driver lifecycle and transactions
- `src/scanner/file-scanner.ts` - Recursively scans directories with ignore patterns

**Language Parsers:**
- TypeScript/JavaScript: `ts-morph` (in-memory project with type checker)
- Python: `python-parser.ts` spawns Python subprocess using native `ast` module
- Java/C#/Go/C++: `tree-sitter-*` parsers
- SQL: `tree-sitter-sql`

### Data Flow

```
Directory → FileScanner → Parser (Pass 1) → Collect Nodes & Relationships
                                          ↓
                          RelationshipResolver (Pass 2) → Resolve Cross-File Refs
                                          ↓
                          StorageManager → Neo4j (Batch Writes)
```

### MCP Integration

The `mcp/` directory contains an MCP server (`mcp/src/index.ts`) that exposes the analyzer to AI assistants:
- **Tool:** `run_analyzer` - Triggers analysis of a directory
- **Workflow:** Returns command details as JSON; expects external execution
- Integrates with `@alanse/mcp-neo4j-server` for natural language → Cypher query translation

## Performance Considerations

### Large Repository Handling

CodeGraph uses several strategies to handle large codebases efficiently:

#### 1. **Declaration File Filtering**
- **Problem**: TypeScript declaration files (`.d.ts`) contribute massive file counts (e.g., 171K+ in node_modules)
- **Solution**: Automatically skips `.d.ts` files during scanning - they don't need deep parsing
- **Impact**: Reduces file count by 95%+ in typical repos (180K → 9K files for monorepo-3.0)
- **Location**: `src/scanner/file-scanner.ts`

#### 2. **Adaptive Batch Sizing**
- **Problem**: Fixed batch sizes cause memory issues on large repos
- **Solution**: Automatically adjusts batch size based on total file count:
  - Small repos (< 10K files): 100 files/batch
  - Medium repos (10K-50K files): 75 files/batch  
  - Large repos (> 50K files): 50 files/batch
- **Impact**: Prevents OOM errors while maintaining performance
- **Location**: `src/analyzer/parser.ts` - `parseFiles()` method

#### 3. **File-Level Timeout Protection**
- **Problem**: Problematic files can hang indefinitely, blocking entire analysis
- **Solution**: 30-second timeout per file with graceful fallback
- **Impact**: Analysis continues even if individual files fail
- **Location**: `src/analyzer/parser.ts` - `_parseTsProjectFiles()` method

#### 4. **Batch Memory Management**
- **Process**: After parsing each batch, source files are removed from ts-morph project
- **Garbage Collection**: Forced GC every 20 batches (run with `--expose-gc` flag)
- **Monitoring**: Real-time heap usage tracking in logs

#### 5. **Enhanced Progress Logging**
- **ETA Calculation**: Shows estimated time remaining based on rolling average
- **Memory Tracking**: Displays heap usage (e.g., "Memory: 78/193MB")
- **Batch Progress**: Logs every 10 batches with percentage completion
- **Error Summary**: Final report shows success/timeout/error counts

### Recommended Ignore Patterns

The following patterns are automatically excluded (see `src/config/index.ts`):

```
**/node_modules/**      # npm dependencies
**/dist/**             # Build output
**/build/**            # Build output
**/.next/**            # Next.js
**/.turbo/**           # Turborepo cache
**/.expo/**            # Expo build
**/storybook-static/** # Storybook
**/*.test.ts           # Test files
**/*.spec.ts           # Spec files
**/*.d.ts              # Declaration files (filtered at scan time)
```

### Troubleshooting Large Repos

**Symptom**: Analysis hangs or runs very slowly
- **Check**: Are `.d.ts` files being filtered? (Should see 95%+ reduction)
- **Check**: Is `node_modules` properly ignored?
- **Solution**: Verify ignore patterns in workspace config

**Symptom**: Out of memory errors
- **Check**: Current batch size in logs
- **Solution**: Reduce batch size manually in `parser.ts` or add more RAM
- **Prevention**: Run with `--expose-gc` flag: `node --expose-gc dist/index.js ...`

**Symptom**: Individual files timing out
- **Check**: Look for "⏱️ Timeout parsing file" warnings in logs
- **Action**: These files are automatically skipped, analysis continues
- **Investigation**: Check the specific files for syntax errors or complexity

### Performance Benchmarks

| Repository | Files | Batch Size | Analysis Time | Nodes Extracted |
|------------|-------|------------|---------------|-----------------|
| CodeGraph | 76 | 100 | ~3s | 1,537 |
| frontend-monorepo | 945 | 100 | ~57s | 26,670 |
| app | ~3K | 100 | ~2m | 140,563 |
| monorepo-3.0 | 2,099* | 100 | ~5-10m** | TBD |

\* After `.d.ts` filtering (was 180K+ total files)  
** Estimated based on file count

## Development Commands

### Build & Run

```bash
# Install dependencies
npm install

# Compile TypeScript to dist/
npm run build

# Run analyzer directly (after building)
npm start

# Development mode with ts-node (slower, no compilation)
npm run dev

# Quick analyze with schema update
npm run analyze
```

### Testing

DevAC uses a two-tier testing strategy:
- **Unit Tests**: Fast, mocked dependencies (~62 tests, <5s)
- **Integration Tests**: Real Neo4j database (~25 tests, ~10-30s)

#### Test Setup (One-Time)

1. **Verify Neo4j Connection**:
```bash
npm run neo4j:verify
```

2. **Create Test Database**:
```bash
npm run neo4j:setup-test-db
```

This creates a dedicated `codegraph_test` database for test isolation.

#### Running Tests

```bash
# All tests (unit + integration)
npm test

# Unit tests only (fast, no Neo4j required)
npm run test:unit

# Integration tests only (requires Neo4j)
npm run test:integration

# Watch mode for TDD
npm run test:watch

# With coverage report
npm run test:coverage
```

**See `TEST_SETUP.md` for detailed testing documentation.**

### Code Quality

```bash
# Lint TypeScript files
npm run lint

# Format with Prettier
npm run format
```

### Analyzing a Codebase

```bash
# Basic analysis (uses config defaults)
node dist/index.js analyze <path-to-codebase>

# With options
node dist/index.js analyze /path/to/project \
  --extensions .ts,.py,.java \
  --ignore "**/test/**,**/mocks/**" \
  --update-schema \
  --neo4j-url bolt://localhost:7687 \
  --neo4j-user neo4j \
  --neo4j-password your_password \
  --neo4j-database codegraph

# Full reset (DANGER: deletes all data)
node dist/index.js analyze . --reset-db --update-schema
```

**Important Flags:**
- `--update-schema`: Updates Neo4j constraints/indexes (needed after schema changes)
- `--reset-db`: **DESTRUCTIVE** - Deletes all nodes/relationships before analysis
- `--extensions`: Override default supported file types
- `--ignore`: Add custom ignore patterns (appends to defaults)

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# Logging
LOG_LEVEL=info  # debug, info, warn, error

# Neo4j Connection
NEO4J_URL=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password
NEO4J_DATABASE=codegraph

# Performance
STORAGE_BATCH_SIZE=100

# Temporary Files
TEMP_DIR=./analysis-data/temp
```

**Defaults:** See `src/config/index.ts` for all default values.

### Ignore Patterns

Default ignore patterns (from `src/config/index.ts`):
- `**/node_modules/**`, `**/.git/**`, `**/dist/**`, `**/build/**`
- `**/*.test.ts`, `**/*.spec.ts` (test files)
- `**/__pycache__/**`, `**/venv/**` (Python)
- `**/target/**`, `**/*.class` (Java)
- `**/bin/**`, `**/obj/**` (C#)

### Supported File Extensions

Default: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.hh`, `.java`, `.cs`, `.go`, `.sql`

## Neo4j Database

### Prerequisites

- Neo4j Desktop 5.26+ or Neo4j Community/Enterprise
- **Recommended Plugins:** APOC Core, Graph Data Science (GDS) Library

### Schema

The analyzer creates these node types:
- `File`, `Directory` - File system structure
- `Class`, `Interface`, `Function`, `Method` - Code elements
- `Variable`, `Parameter`, `TypeAlias` - Data types
- `Component` - React/UI components
- `SQLTable` - Database tables

Relationships:
- `IMPORTS`, `EXPORTS` - Module dependencies
- `CALLS`, `CALLS_METHOD` - Function calls
- `EXTENDS`, `IMPLEMENTS` - Inheritance
- `HAS_METHOD`, `HAS_PROPERTY` - Class members
- `RENDERS_ELEMENT`, `USES_COMPONENT` - React relationships
- `REFERENCES_TABLE` - SQL relationships

### Schema Management

```bash
# Update schema (run after schema changes)
node dist/index.js analyze . --update-schema

# View schema in Neo4j
CALL db.schema.visualization()
```

## Key Implementation Details

### TypeScript Path Aliases

- **Issue:** Runtime Node.js doesn't support TypeScript path aliases (`@/*`)
- **Solution:** All imports use relative paths (`.js` extensions required for ESM)
- **tsconfig.json:** Defines `@/*` mapping for IDE support only

### ES Modules

- **Module Type:** ESM (`"type": "module"` in package.json)
- **Import Requirements:** Use `.js` extensions even for `.ts` files (TypeScript strips types only)
- **__dirname:** Not available in ESM; use `fileURLToPath(import.meta.url)`

### Neo4j Driver Lifecycle

- **Lazy Initialization:** Driver created on first use via `initializeDriver(context)`
- **Session Management:** `runTransaction()` auto-closes sessions
- **Context Strings:** All methods accept context for logging (e.g., "Analyzer", "Schema")
- **Cleanup:** Always call `closeDriver(context)` in finally blocks

### Batch Processing

- **Nodes:** Saved in batches of `config.storageBatchSize` (default: 100)
- **Relationships:** Grouped by type, then batched
- **Why:** Reduces round-trips to Neo4j; improves performance for large codebases

### Parser Strategy

**TypeScript/JavaScript:**
- Uses `ts-morph` Project with type checker enabled
- Resolves imports via TypeScript's resolution logic
- Handles JSX/TSX elements for React components

**Python:**
- Spawns Python subprocess with `-c` flag
- Passes code via stdin, receives JSON on stdout
- Requires Python 3 in PATH

**Tree-sitter Languages:**
- Parses to generic tree-sitter AST
- Custom node visitors for each language
- No semantic analysis (no type resolution)

### Testing

- **Framework:** Vitest
- **Integration Tests:** Use `@testcontainers/neo4j` for ephemeral databases
- **Test Database:** Separate from dev database; auto-cleaned between tests
- **Fixtures:** Located alongside spec files

## Common Tasks

### Adding a New Language Parser

1. Install tree-sitter grammar: `npm install tree-sitter-<language>`
2. Create parser: `src/analyzer/parsers/<language>-parser.ts`
3. Implement `parse(fileInfo, project)` returning `AstNode[]` and `RelationshipInfo[]`
4. Add tests: `<language>-parser.spec.ts`
5. Register in `src/analyzer/parser.ts` switch statement
6. Add extension to `config.supportedExtensions`

### Adding a New Node Type

1. Update `src/analyzer/types.ts` - Add to `NodeType` enum
2. Update `src/database/schema.ts` - Add constraint/index in `CONSTRAINTS_AND_INDEXES`
3. Run with `--update-schema` to apply

### Adding a New Relationship Type

1. Update `src/analyzer/types.ts` - Add to `RelationshipType`
2. Emit from parser or resolver
3. No schema changes needed (relationships are dynamic in Neo4j)

### Debugging Analysis

```bash
# Enable debug logging
LOG_LEVEL=debug npm run build && node dist/index.js analyze .

# Check what files are being scanned
LOG_LEVEL=debug npm run build && node dist/index.js analyze . 2>&1 | grep "Scanning"

# Verify Neo4j data after analysis
# In Neo4j Browser:
MATCH (n) RETURN labels(n), count(n)
MATCH ()-[r]->() RETURN type(r), count(r)
```

### MCP Server Development

```bash
# Build MCP server
cd mcp
npm install
npm run build

# MCP server runs via stdio transport (no direct execution)
# Configure in Claude Desktop or other MCP client
```

## Troubleshooting

**"Failed to connect to Neo4j"**
- Verify Neo4j is running: Check Neo4j Desktop
- Check connection string: `bolt://localhost:7687` (default)
- Verify credentials in `.env`

**"No files found to analyze"**
- Check ignore patterns: May be excluding target files
- Verify extensions: Use `--extensions` to override
- Check directory path: Must exist and be readable

**"Python parser failed"**
- Ensure Python 3 is in PATH: `python --version` or `python3 --version`
- Check Python syntax: Parser uses Python's `ast` module

**TypeScript import errors**
- Ensure `.js` extensions in imports (ESM requirement)
- Check `tsconfig.json` paths are relative
- Rebuild after import changes: `npm run build`

## Project Structure

```
CodeGraph/
├── src/
│   ├── analyzer/           # Core analysis logic
│   │   ├── parsers/        # Language-specific parsers
│   │   ├── resolvers/      # Cross-file relationship resolution
│   │   ├── analyzer-service.ts   # Main orchestrator
│   │   ├── parser.ts       # Parser coordinator
│   │   ├── relationship-resolver.ts
│   │   ├── storage-manager.ts
│   │   └── types.ts        # Core type definitions
│   ├── database/           # Neo4j integration
│   │   ├── neo4j-client.ts # Driver management
│   │   └── schema.ts       # Schema creation
│   ├── scanner/            # File system scanning
│   ├── cli/                # CLI commands
│   ├── config/             # Configuration
│   ├── utils/              # Logging, errors, helpers
│   └── index.ts            # CLI entry point
├── mcp/                    # MCP server for AI integration
├── dist/                   # Compiled JavaScript (gitignored)
├── package.json
├── tsconfig.json
└── .env                    # Environment variables (gitignored)
```

## Dependencies

**Runtime:**
- `neo4j-driver` - Neo4j database client
- `ts-morph` - TypeScript/JavaScript parsing
- `tree-sitter-*` - Multi-language parsing
- `commander` - CLI framework
- `chokidar` - File watching (used in MCP watcher)
- `winston` - Logging

**Development:**
- `vitest` - Testing framework
- `@testcontainers/neo4j` - Test database containers
- `typescript` - Type checking & compilation
- `eslint`, `prettier` - Code quality
