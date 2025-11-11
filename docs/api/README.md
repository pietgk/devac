# API Documentation

This directory contains API documentation, query examples, and usage patterns for CodeGraph and DevAC.

## Query Examples

### [Example Queries](./example-queries.md)
**Comprehensive collection of Neo4j Cypher queries**

Query categories:
- **Basic Queries** - Simple entity lookups and counts
- **Relationship Queries** - Following imports, dependencies, calls
- **C4 Diagram Queries** - Generating Container and Component diagrams
- **Code Analysis Queries** - Finding patterns, unused code, complexity
- **Cross-Package Queries** - Analyzing dependencies across packages
- **Performance Queries** - Using indexes and optimizations

**Use cases:**
- Learning the graph schema
- Building custom analysis tools
- Generating reports and visualizations
- Troubleshooting and debugging

---

## DevAC REST API

The DevAC web server provides REST API endpoints for service management and monitoring.

### Health Check
```
GET /health
```
Returns orchestrator status, service counts, and SSE statistics.

### Service Management
```
GET /api/services          # List all services
GET /api/services/:id      # Get service details
```

### Real-Time Events
```
GET /api/events            # SSE endpoint for real-time events
```

### Logs API
```
GET /api/logs/history      # Get recent logs from memory
GET /api/logs/file/:name   # Download specific log file
GET /api/logs/range        # Get logs by line range
```

### API Documentation Status
- ⚠️ **OpenAPI/Swagger spec** - Planned for Phase 2.5
- ✅ **REST endpoints** - Fully functional
- ✅ **SSE streaming** - Production-ready
- ⚠️ **Authentication** - Planned for Phase 3

---

## Graph Schema

CodeGraph stores parsed code in Neo4j with the following node types:

### Core Entities
- **File** - Source files
- **Package** - Packages/modules/namespaces
- **Class** - Classes, interfaces, types
- **Function** - Functions, methods, procedures
- **Variable** - Variables, constants, fields
- **Import** - Import statements
- **Export** - Export statements

### DevAC Tracking
- **Service** - DevAC services (e.g., CodeGraph)
- **Collection** - Analysis run metadata
- **LogFile** - Log file references
- **Resource** - Large data file references

### Relationships
- **CONTAINS** - File contains entities
- **IMPORTS** - Import relationships
- **EXPORTS** - Export relationships
- **CALLS** - Function call relationships
- **EXTENDS** - Class inheritance
- **IMPLEMENTS** - Interface implementation
- **COLLECTED_AT** - Service collected data
- **LOGGED_IN** - Collection linked to log file

---

## Language-Specific Queries

Each supported language has specific patterns. See [Example Queries](./example-queries.md) for:
- **TypeScript/JavaScript** - Module system, JSX components
- **Python** - Modules, classes, decorators
- **Java** - Packages, classes, interfaces
- **C#** - Namespaces, classes, LINQ
- **Go** - Packages, receivers, interfaces
- **C/C++** - Headers, functions, templates

---

## Best Practices

### Query Performance
1. **Use indexes** - Neo4j automatically indexes entity IDs
2. **Limit results** - Add `LIMIT` clauses for exploration
3. **Use EXPLAIN** - Understand query plans with `EXPLAIN` prefix
4. **Filter early** - Apply WHERE clauses before expensive operations

### Common Patterns
```cypher
// Finding entry points
MATCH (f:Function)
WHERE NOT ()-[:CALLS]->(f)
RETURN f.name

// Analyzing dependencies
MATCH (f1:File)-[:IMPORTS]->(f2:File)
RETURN f1.path, f2.path

// Finding unused exports
MATCH (e:Export)
WHERE NOT ()-[:IMPORTS]->(:File {path: e.file})
RETURN e.name, e.file
```

---

## Related Documentation

- **[Architecture](../architecture/)** - System design and graph schema details
- **[Development Guide](../development/)** - Working with the codebase
- **[Example Questions](../example-questions/)** - Real-world use cases

## Contributing

When adding new queries:
1. Add to [example-queries.md](./example-queries.md) in the appropriate section
2. Include:
   - Clear description
   - Use case
   - Example output
   - Performance considerations
3. Test queries on real codebases
4. Document any limitations
