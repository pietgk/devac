# DevAC - Development Analytics Centre

**Status**: 🚧 Phase 1 Core Foundation (In Progress)

DevAC is a real-time development analytics platform that collects, monitors, and visualizes development activities across your codebase. It uses XState v5 actors for elegant service orchestration and stores all data in a queryable Neo4j graph database.

## Vision

DevAC provides developers with a unified command center that:

- **Collects** data from multiple sources (code, git, builds, tests)
- **Watches** for changes in real-time using file system observers
- **Stores** everything as a queryable knowledge graph in Neo4j
- **Visualizes** insights through an interactive web UI
- **Answers** questions about your development using natural language queries

## Architecture

```
DevAC uses XState v5 Actor Model:

┌─────────────────────────────────────────────┐
│         Orchestrator (Root Actor)           │
│  - Service Registry                         │
│  - Event Bus                                │
│  - Lifecycle Management                     │
└──────────────┬──────────────────────────────┘
               │
               ├─► Service Actor: CodeGraph
               │   └─ States: idle → scanning → watching → processing
               │
               ├─► Service Actor: Git Activity
               │   └─ States: idle → indexing → watching → analyzing
               │
               ├─► Service Actor: Build Metrics
               │   └─ States: idle → watching → parsing → aggregating
               │
               └─► Service Actor: Test Results
                   └─ States: idle → watching → parsing → analyzing
```

Each service follows a consistent pattern:
1. **Initialize**: Set up resources
2. **Scan**: Initial data collection
3. **Watch**: Monitor for changes (chokidar + fallback polling)
4. **Process**: Transform data → graph nodes/relationships
5. **Output**: Write to Neo4j + log files with round-robin rotation

## Installation

```bash
# Clone and install dependencies
git clone <repo-url>
cd CodeGraph
git checkout core
npm install

# Build
npm run build
```

## Quick Start

```bash
# Initialize DevAC in your workspace
npm run devac init

# Edit configuration
vim .devac/config.json

# Start DevAC
npm run devac start

# In another terminal, check service status
npm run devac service list
```

## Phase 1: Core Foundation ✅

**Completed:**
- ✅ TypeScript type system for services, events, and config
- ✅ Base service actor pattern (XState v5)
- ✅ Orchestrator actor with service registry
- ✅ Event bus for inter-service communication
- ✅ CLI commands: `init`, `start`, `stop`, `service`
- ✅ Configuration management with defaults

**Directory Structure:**
```
src/devac/
├── types/              # TypeScript definitions
│   ├── service.ts      # Service types
│   ├── workspace.ts    # Workspace types
│   ├── events.ts       # Event types
│   └── config.ts       # Configuration types
├── orchestrator/       # Core orchestration
│   ├── orchestrator.ts # Main orchestrator actor
│   ├── service-registry.ts
│   └── event-bus.ts
├── services/           # Service implementations
│   └── base-service.ts # Abstract base class
├── cli/                # CLI commands
│   ├── commands/
│   │   ├── init.ts
│   │   ├── start.ts
│   │   ├── stop.ts
│   │   └── service.ts
│   ├── config.ts
│   └── index.ts
└── web/                # (Coming in Phase 3)
```

## Phase 2: First Service (CodeGraph Migration) 🚧

**TODO:**
- [ ] Create CodeGraphService extending BaseService
- [ ] Wrap existing AnalyzerService logic
- [ ] Add chokidar watcher for incremental updates
- [ ] Implement round-robin logging
- [ ] Add resource references for large data
- [ ] Test end-to-end service lifecycle

## Phase 3: Web UI Foundation 📋

**Planned:**
- Fastify web server with SSE for real-time updates
- React + TanStack Router + TanStack Query
- Dashboard with service status cards
- Service manager UI
- Graph viewer (Cytoscape.js)
- Log viewer with virtual scrolling

## Phase 4: Additional Services 📋

**Planned:**
- Git Activity Service
- Build Metrics Service
- Test Results Service

## Phase 5: Query Engine 📋

**Planned:**
- Natural language → Cypher query translation
- GWT (Given-When-Then) template system
- TypeScript code generator for complex queries
- Secure code executor (isolated-vm)

## Configuration

`.devac/config.json`:
```json
{
  "version": "1.0.0",
  "neo4j": {
    "uri": "bolt://localhost:7687",
    "username": "neo4j",
    "password": "password",
    "database": "devac"
  },
  "web": {
    "port": 3000,
    "host": "localhost",
    "cors": true
  },
  "services": {
    "codegraph": {
      "enabled": true,
      "directories": ["./"],
      "extensions": [".ts", ".js", ".py"],
      "ignore": ["**/node_modules/**"],
      "watch": true
    },
    "git": {
      "enabled": true,
      "repositories": ["./"],
      "watch": true
    }
  },
  "logging": {
    "level": "info",
    "maxFileSize": "10MB",
    "maxFiles": 10
  },
  "workspace": {
    "autoDiscover": true
  }
}
```

## Key Design Principles

1. **Convention over Configuration**: Auto-discover repositories, minimal setup
2. **Real-time by Default**: Watchers for updates, not periodic polling
3. **Graph-First**: All data stored as queryable graph relationships
4. **Service Isolation**: Each service is an independent actor
5. **Resource References**: Large data (logs, artifacts) referenced, not embedded
6. **Elegant Simplicity**: Clean architecture, easy to understand and extend

## Graph Schema (DevAC-specific)

```cypher
// Service tracking
(:Service {id, name, type, status, startedAt})
(:Collection {id, serviceId, timestamp, stats})
(:Event {id, type, timestamp, data})
(:Resource {id, type, path, format, size, lines})

// Relationships
(Service)-[:COLLECTED_AT]->(Collection)
(Collection)-[:PRODUCED]->(DomainNode)
(Collection)-[:LOGGED_IN {startLine, endLine}]->(Resource:LogFile)
(Collection)-[:STORED_DATA_IN]->(Resource:DataFile)
(Event)-[:TRIGGERED_BY]->(Service)
```

Domain nodes (File, Class, Commit, BuildRun, TestCase, etc.) are service-specific.

## CLI Commands

```bash
# Initialize workspace
npm run devac init [--name <name>] [--interactive]

# Start DevAC
npm run devac start [--config <path>] [--port <number>] [--no-web]

# Stop DevAC (placeholder)
npm run devac stop [--force]

# Manage services
npm run devac service list
npm run devac service start <service-id>
npm run devac service stop <service-id>
npm run devac service restart <service-id>
npm run devac service status [<service-id>]
```

## Development

```bash
# Run in development mode (ts-node)
npm run devac:dev init
npm run devac:dev start

# Build TypeScript
npm run build

# Run tests
npm test

# Lint
npm run lint

# Format
npm run format
```

## Workspace Concept

DevAC supports multiple workspaces, each with its own:
- Neo4j database
- Configuration
- Service instances
- Log files

Workspaces can be linked to:
- Git branches (e.g., `feature/new-api`)
- Deployment stages (e.g., `dev`, `staging`, `prod`)
- Named environments (e.g., `local-dev`, `ci-build`)

## Logging

Services use round-robin log files:

```
logs/
├── codegraph/
│   ├── 001.log  (10MB)
│   ├── 002.log  (10MB)
│   └── 003.log  (current)
├── git/
└── build/
```

Each collection references its log entries:
```cypher
(Collection)-[:LOGGED_IN {startLine: 1, endLine: 1500}]->(LogFile {path: "logs/codegraph/001.log"})
```

## Contributing

This is an early-stage project. Contributions welcome!

Areas needing help:
- Service implementations (git, build, test)
- Web UI components
- Natural language query engine
- Documentation

## License

MIT

## Acknowledgments

- Inspired by the mindler architecture-v2 XState v5 actor pattern
- Built on the existing CodeGraph analyzer foundation
- Influenced by Anthropic's code execution with MCP patterns
