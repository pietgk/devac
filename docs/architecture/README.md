# Architecture Documentation

This directory contains comprehensive architecture documentation for CodeGraph and DevAC systems.

## Documents

### [CodeGraph Architecture](./codegraph-architecture.md)
**Complete technical architecture for CodeGraph v3.0**

Topics covered:
- System overview and design philosophy
- Multi-language parser architecture (7 languages supported)
- Two-pass parsing pipeline
- Entity ID system with overloading support
- Neo4j graph schema
- C4 diagram generation
- Package detection and import resolution
- Workspace management for monorepos

**Audience:** Developers, architects, contributors

---

### [DevAC Architecture](../development/code-status.md)
**Development Agent Coordinator (DevAC) system architecture**

Note: Full architecture is documented in the Code Status document which includes comprehensive Mermaid diagrams.

Topics covered:
- Orchestrator state machine design
- Service lifecycle management
- Event-driven architecture with EventBus
- Logging system with line tracking
- Real-time monitoring with SSE
- Web server and API design
- CodeGraph service integration

**Audience:** DevAC users, service developers, platform engineers

---

### [Service Communication Architecture](./service-communication.md)
**Inter-service communication patterns and best practices**

Topics covered:
- Event-driven communication
- Service registry patterns
- Health checking and monitoring
- Error handling and graceful degradation
- Resource management

**Audience:** Service developers, system integrators

---

## Architecture Diagrams

Both main architecture documents include comprehensive Mermaid diagrams:

### CodeGraph Architecture Diagrams
- **System Context** - CodeGraph in the broader ecosystem
- **Container Diagram** - Major components (parsers, database, CLI)
- **Component Diagram** - Detailed component relationships
- **Entity ID System** - How overloading works
- **C4 Generation Pipeline** - From code to diagrams

### DevAC Architecture Diagrams
- **System Context** - DevAC platform overview
- **Container Diagram** - Orchestrator, services, web server, databases
- **Component Diagrams** - Orchestration and logging subsystems
- **Sequence Diagrams** - Initial scan and file change processing flows

## Related Documentation

- **[Development Guide](../development/)** - Current code status, testing, build process
- **[API Documentation](../api/)** - Query examples and API usage
- **[Session History](../sessions/)** - Historical architecture decisions and implementations

## Quick Navigation

**Want to understand...**
- **How CodeGraph works?** → Read [CodeGraph Architecture](./codegraph-architecture.md)
- **How DevAC orchestrates services?** → Read [DevAC Architecture](../development/code-status.md)
- **How services communicate?** → Read [Service Communication](./service-communication.md)
- **Current system state?** → Read [Code Status](../development/code-status.md)
