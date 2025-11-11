# CodeGraph Documentation

Welcome to the CodeGraph documentation! This directory contains comprehensive documentation for CodeGraph (static code analysis) and DevAC (Development Agent Coordinator).

## 📚 Documentation Structure

### 🚀 [Guides](./guides/)
User-facing guides to get started and learn CodeGraph features:
- **[Quick Start Guide](./guides/quick-start.md)** - Get up and running in 5 minutes
- **[Customization Guide](./guides/customization-guide.md)** - Customize CodeGraph for your needs
- **[Primitives Guide](./guides/primitives-guide.md)** - Understanding CodeGraph primitives
- **[Demo Guide](./guides/demo-guide.md)** - Running demos and examples
- **[MCP Setup Guide](./guides/mcp-setup.md)** - Model Context Protocol integration

### 🏗️ [Architecture](./architecture/)
System architecture and design documentation:
- **[CodeGraph Architecture](./architecture/codegraph-architecture.md)** - Core CodeGraph system design
- **[DevAC Architecture](./development/code-status.md)** - DevAC orchestration architecture
- **[Service Communication](./architecture/service-communication.md)** - Inter-service communication patterns

### 🔌 [API](./api/)
API documentation and query examples:
- **[Example Queries](./api/example-queries.md)** - Neo4j Cypher query examples
- **[C4 Diagram Queries](./api/)** - Generating C4 diagrams from the graph

### 💻 [Development](./development/)
Documentation for developers contributing to CodeGraph:
- **[Code Status](./development/code-status.md)** - Current code quality and architecture review
- **[Testing Strategy](./development/testing-strategy.md)** - Testing approach and guidelines
- **[Build Guide](./development/build-guide.md)** - Building and packaging
- **[Roadmap](./development/roadmap.md)** - Future development plans

### ✨ [Features](./features/)
Documentation for specific features and implementations:
- **[UI Gen CLI](./features/ui-gen-cli.md)** - UI generation command-line tool
- **[Accuracy Improvements](./features/accuracy-improvements.md)** - Parser accuracy enhancements
- **[Call Graph Fix](./features/call-graph-fix.md)** - Call graph resolution improvements
- **[Component Ownership](./features/component-ownership.md)** - Tracking component ownership

### 🔬 [Research](./research/)
Research documents and architectural decision analysis:
- **[CPG vs Context Embedding](./research/cpg-vs-context-embedding.md)** - Analysis of graph approaches
- **[Graph vs File Reading](./research/graph-vs-file-reading.md)** - Query optimization strategies
- **[SQL Integration Plan](./research/sql-integration-plan.md)** - Adding SQL database support

### 📊 [Workspace Analysis](./workspace-analysis/)
Example analyses of real-world codebases (Mindler workspace examples):
- **[B2B Membership Flow](./workspace-analysis/b2b-membership-nl-pending.md)** - Corporate membership system
- **[iCBT Journaling Flow](./workspace-analysis/icbt-journaling-flow.md)** - Therapy program integration
- **[Questionnaire Automation](./workspace-analysis/automatic-questionnaire-frequency.md)** - Clinical questionnaire system
- **[Questionnaire Details](./workspace-analysis/questionnaire-details.md)** - Questionnaire catalog

### 📝 [Session History](./sessions/)
Chronological development sessions for CodeGraph:
- **[Session Index](./sessions/README.md)** - Complete list of 24 CodeGraph development sessions
- Sessions cover entity ID improvements, CLI implementation, workspace support, performance optimization, and more

### 🔧 [DevAC Session History](./devac-sessions/)
Chronological development sessions for DevAC orchestrator:
- **[Session Index](./devac-sessions/README.md)** - Complete list of 24 DevAC development sessions
- Sessions cover testing strategy, integration, logging architecture, and UI implementation

## Quick Links

### For New Users
1. Start with the **[Quick Start Guide](./guides/quick-start.md)**
2. Review **[Example Queries](./api/example-queries.md)** to see what you can do
3. Check out the **[Demo Guide](./guides/demo-guide.md)** for hands-on examples

### For Developers
1. Read the **[CodeGraph Architecture](./architecture/codegraph-architecture.md)**
2. Review the **[Code Status](./development/code-status.md)** for current state
3. Check the **[Roadmap](./development/roadmap.md)** for planned work

### For Contributors
1. Review **[Testing Strategy](./development/testing-strategy.md)**
2. Follow **[Build Guide](./development/build-guide.md)**
3. Browse **[Session History](./sessions/README.md)** to understand past decisions

## Other Resources

- **[QUICK_VALIDATION.md](./QUICK_VALIDATION.md)** - Quick validation checklist
- **[jira/](./jira/)** - Project management and status
- **[example-questions/](./example-questions/)** - Example use cases and queries

## Contributing

When adding new documentation:
- Place user-facing guides in `guides/`
- Place architecture docs in `architecture/`
- Place research/analysis in `research/`
- Place session notes in `sessions/` or `devac-sessions/` with sequential numbering
- Update this README with links to your new content

## Questions?

Check the **[Session History](./sessions/README.md)** for historical context, or review the **[Architecture](./architecture/)** documentation for system design details.
