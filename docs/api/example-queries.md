# CodeGraph Example Queries

Comprehensive collection of Cypher queries for exploring your codebase through the Neo4j knowledge graph.

## Table of Contents

1. [Basic Queries](#basic-queries)
2. [Function Analysis](#function-analysis)
3. [Dependency Tracking](#dependency-tracking)
4. [Class & Interface Analysis](#class--interface-analysis)
5. [Call Graph Analysis](#call-graph-analysis)
6. [Impact Analysis](#impact-analysis)
7. [Code Quality Metrics](#code-quality-metrics)
8. [Architecture Queries](#architecture-queries)

---

## Basic Queries

### Count All Nodes by Type

```cypher
MATCH (n)
RETURN labels(n)[0] as NodeType, count(n) as Count
ORDER BY Count DESC
```

**Use Case**: Get an overview of what was extracted from your codebase.

**Expected Results** (for test-project):
```
Parameter: 172
Import: 160
Function: 119
Variable: 47
TypeAlias: 40
File: 37
```

### List All Files

```cypher
MATCH (f:File)
RETURN f.name as FileName, f.loc as LinesOfCode, f.language as Language
ORDER BY f.loc DESC
LIMIT 20
```

**Use Case**: See which files are largest and might need refactoring.

### Find Files in a Specific Directory

```cypher
MATCH (f:File)
WHERE f.filePath CONTAINS 'test-project'
RETURN f.name, f.loc, f.filePath
ORDER BY f.loc DESC
```

**Use Case**: Scope queries to a specific part of your codebase.

---

## Function Analysis

### List All Functions

```cypher
MATCH (f:Function)
RETURN f.name as FunctionName, f.filePath as File
ORDER BY f.name
LIMIT 20
```

**Use Case**: Get a catalog of all functions in your codebase.

### Find Functions by Name Pattern

```cypher
MATCH (f:Function)
WHERE f.name CONTAINS 'calculate' OR f.name CONTAINS 'format'
RETURN f.name, f.filePath
ORDER BY f.name
```

**Use Case**: Find utility functions or functions following a naming pattern.

### Functions with Most Parameters

```cypher
MATCH (f:Function)-[r:HAS_PARAMETER]->(p:Parameter)
WITH f, count(p) as paramCount
RETURN f.name as FunctionName, f.filePath as File, paramCount
ORDER BY paramCount DESC
LIMIT 10
```

**Use Case**: Identify complex functions that might need refactoring (high parameter count = potential code smell).

**Example Result** (from test-project):
```
performCalculations - 2 parameters
```

### Find Functions Without Parameters

```cypher
MATCH (f:Function)
WHERE NOT EXISTS {
  MATCH (f)-[:HAS_PARAMETER]->()
}
RETURN f.name, f.filePath
LIMIT 10
```

**Use Case**: Find simple utility functions or getters.

---

## Dependency Tracking

### File Import Dependencies

```cypher
MATCH (f1:File)-[:IMPORTS]->(f2:File)
RETURN f1.name as Importer, f2.name as Imported
ORDER BY f1.name
LIMIT 20
```

**Use Case**: Understand module dependencies.

**Example Result** (from test-project):
```
index.ts → calculator.ts
index.ts → utils.ts
```

### Files with Most Imports

```cypher
MATCH (f:File)-[i:IMPORTS]->()
WITH f, count(i) as importCount
RETURN f.name as File, importCount
ORDER BY importCount DESC
LIMIT 15
```

**Use Case**: Identify highly coupled files that import many modules.

**Expected Result** (from reminders service):
```
index.ts: 44 imports
lambda.ts: 28 imports
queries.ts: 26 imports
```

### Dependency Chain (3 Levels Deep)

```cypher
MATCH path = (f1:File)-[:IMPORTS*..3]->(f2:File)
WHERE f1.name = 'index.ts'
RETURN path
LIMIT 10
```

**Use Case**: Trace how dependencies cascade through your codebase.

### Find Circular Dependencies

```cypher
MATCH path = (f1:File)-[:IMPORTS*2..]->(f2:File)
WHERE f1 = f2
RETURN [node IN nodes(path) | node.name] as CircularChain
LIMIT 10
```

**Use Case**: Identify problematic circular import chains.

---

## Class & Interface Analysis

### List All Classes

```cypher
MATCH (c:Class)
RETURN c.name as ClassName, c.filePath as File
ORDER BY c.name
```

**Use Case**: Get a catalog of all classes.

**Example Result** (from test-project):
```
Calculator - test-project/src/calculator.ts
```

### Classes with Methods

```cypher
MATCH (c:Class)-[:HAS_METHOD]->(m)
WITH c, count(m) as methodCount
RETURN c.name as ClassName, methodCount
ORDER BY methodCount DESC
```

**Use Case**: Understand class complexity (more methods = potentially more complex).

**Example Result**:
```
Calculator - 8 methods
```

### Find Interfaces

```cypher
MATCH (i:Interface)
RETURN i.name as InterfaceName, i.filePath as File
ORDER BY i.name
```

**Use Case**: List all TypeScript interfaces for API contracts.

**Example Result** (from test-project):
```
CalculatorOptions - test-project/src/calculator.ts
AppConfig - test-project/src/index.ts
```

### Class Inheritance

```cypher
MATCH (c1:Class)-[:EXTENDS]->(c2:Class)
RETURN c1.name as SubClass, c2.name as SuperClass
```

**Use Case**: Understand class hierarchy.

---

## Call Graph Analysis

### Function Calls

```cypher
MATCH (f1:Function)-[r:CALLS]->(f2:Function)
RETURN f1.name as Caller, f2.name as Called, r.properties.callSiteLine as Line
ORDER BY f1.name
LIMIT 20
```

**Use Case**: See which functions call which (the call graph).

**Example Result** (from test-project):
```
runDemo → initCalculator
runDemo → performCalculations
runDemo → logResults
```

### Most Called Functions (Hotspots)

```cypher
MATCH ()-[:CALLS]->(f:Function)
WITH f, count(*) as callCount
RETURN f.name as Function, f.filePath as File, callCount
ORDER BY callCount DESC
LIMIT 10
```

**Use Case**: Identify critical functions that are called frequently (hotspots for optimization).

**Example Result**:
```
formatNumber - 3 calls
trackResult - 4 calls
formatResult - 4 calls
```

### Functions That Call Nothing

```cypher
MATCH (f:Function)
WHERE NOT EXISTS {
  MATCH (f)-[:CALLS]->()
}
RETURN f.name, f.filePath
LIMIT 10
```

**Use Case**: Find leaf functions or utility functions.

### Call Chain (N-Hops)

```cypher
MATCH path = (f1:Function {name: 'runDemo'})-[:CALLS*1..3]->(f2:Function)
RETURN [node IN nodes(path) | node.name] as CallChain
LIMIT 10
```

**Use Case**: Trace execution flow from an entry point.

**Example Result**:
```
runDemo → performCalculations → add
runDemo → performCalculations → subtract
runDemo → performCalculations → multiply
runDemo → performCalculations → divide
```

---

## Impact Analysis

### What Calls This Function?

```cypher
MATCH (caller:Function)-[:CALLS]->(target:Function {name: 'formatNumber'})
RETURN caller.name as Caller, caller.filePath as File
```

**Use Case**: "If I change this function, what breaks?"

**Example Result**:
```
logResults - utils.ts
displaySummary - index.ts
```

### What Does This Function Call?

```cypher
MATCH (target:Function {name: 'performCalculations'})-[:CALLS]->(called:Function)
RETURN called.name as CalledFunction, called.filePath as File
```

**Use Case**: "What dependencies does this function have?"

**Example Result**:
```
add - calculator.ts
subtract - calculator.ts
multiply - calculator.ts
divide - calculator.ts
```

### Transitive Dependencies (What Indirectly Depends on This?)

```cypher
MATCH path = (f1:Function)-[:CALLS*1..5]->(target:Function {name: 'trackResult'})
RETURN DISTINCT f1.name as DependentFunction, length(path) as HopsAway
ORDER BY HopsAway, f1.name
```

**Use Case**: Find all functions that depend on a given function, directly or indirectly.

---

## Code Quality Metrics

### Functions with Error Handling

```cypher
MATCH (f:Function)-[r:HANDLES_ERROR]->()
RETURN f.name as Function, count(r) as ErrorHandlers
ORDER BY ErrorHandlers DESC
```

**Use Case**: Identify which functions have robust error handling.

**Example Result** (from reminders service):
```
15 functions with error handling detected
```

### Functions That Mutate State

```cypher
MATCH (f:Function)-[r:MUTATES_STATE]->(v)
RETURN f.name as Function, v.name as Variable, r.properties.isCrossFile as CrossFile
ORDER BY CrossFile DESC
```

**Use Case**: Track side effects and state mutations.

**Example Result** (from reminders service):
```
10 state mutations found
```

### Complexity Score (Parameters + Calls)

```cypher
MATCH (f:Function)
OPTIONAL MATCH (f)-[:HAS_PARAMETER]->(p)
OPTIONAL MATCH (f)-[:CALLS]->(c)
WITH f, count(DISTINCT p) as params, count(DISTINCT c) as calls
RETURN f.name as Function,
       params + calls as ComplexityScore
ORDER BY ComplexityScore DESC
LIMIT 10
```

**Use Case**: Simple complexity metric (more parameters + more calls = more complex).

---

## Architecture Queries

### Find Entry Points (Functions Not Called by Anyone)

```cypher
MATCH (f:Function)
WHERE NOT EXISTS {
  MATCH ()-[:CALLS]->(f)
}
RETURN f.name, f.filePath
LIMIT 10
```

**Use Case**: Identify main entry points, exported APIs, or unused functions.

**Example Result**:
```
runDemo - index.ts (main entry point)
initCalculator - index.ts (exported API)
displaySummary - index.ts (exported API)
```

### Most Connected Nodes (Hub Functions/Classes)

```cypher
MATCH (n)
WHERE n:Function OR n:Class
WITH n, size((n)--()) as connections
RETURN labels(n)[0] as Type, n.name as Name, connections
ORDER BY connections DESC
LIMIT 15
```

**Use Case**: Find central components in your architecture.

### Dead Code Detection (Unused Exports)

```cypher
MATCH (f:Function)
WHERE f.exported = true
  AND NOT EXISTS { MATCH ()-[:CALLS]->(f) }
  AND NOT EXISTS { MATCH (file:File)-[:EXPORTS]->(f) WHERE file.name = 'index.ts' }
RETURN f.name as UnusedExport, f.filePath as File
```

**Use Case**: Find exported functions that are never imported or called.

### Layer Violation Detection

```cypher
MATCH (f1:Function)-[:CALLS]->(f2:Function)
WHERE f1.filePath CONTAINS '/components/'
  AND f2.filePath CONTAINS '/database/'
RETURN f1.name as Component, f2.name as DatabaseFunction
```

**Use Case**: Detect architectural violations (e.g., UI components calling database directly).

---

## Project-Specific Examples

### Find Email-Related Functions (from Reminders Service)

```cypher
MATCH (f:Function)
WHERE f.name CONTAINS 'mail'
   OR f.name CONTAINS 'email'
   OR f.name CONTAINS 'Email'
RETURN f.name, f.filePath
ORDER BY f.name
```

**Use Case**: Find all email-handling code.

### Identify Utility vs Business Logic

```cypher
MATCH (f:Function)
WHERE f.filePath CONTAINS '/lib/'
   OR f.filePath CONTAINS '/utils/'
   OR f.filePath CONTAINS '/helpers/'
RETURN f.name as UtilityFunction, f.filePath
ORDER BY f.filePath, f.name
```

**Use Case**: Separate utility code from business logic.

---

## Natural Language Queries (via MCP)

When using Claude Desktop with the Neo4j MCP server, you can ask these questions naturally:

### Architecture Questions
- "Show me all React components that fetch data"
- "What services call the user database?"
- "How does the login flow work?"
- "What would break if I change the Calculator class?"

### Code Quality Questions
- "Find functions with more than 5 parameters"
- "Which functions don't have error handling?"
- "Show me the most complex functions"
- "What functions mutate global state?"

### Dependency Questions
- "What files import lodash?"
- "Show me all circular dependencies"
- "What depends on the auth module?"
- "Find all dead code"

### Search Questions
- "Find all functions that handle errors"
- "Show me all TypeScript interfaces"
- "Where is the sendEmail function called from?"
- "What utilities are used most often?"

---

## Query Templates

### Template: Find Pattern in Function Names

```cypher
MATCH (f:Function)
WHERE f.name =~ '(?i).*PATTERN.*'  // Case-insensitive regex
RETURN f.name, f.filePath
```

Replace `PATTERN` with your search term.

### Template: Filter by File Path

```cypher
MATCH (n)
WHERE n.filePath STARTS WITH '/path/to/your/project'
  AND n.filePath CONTAINS 'specific/folder'
RETURN labels(n)[0] as Type, n.name, n.filePath
```

### Template: Relationship Count

```cypher
MATCH ()-[r:RELATIONSHIP_TYPE]->()
RETURN count(r) as Total
```

Replace `RELATIONSHIP_TYPE` with CALLS, IMPORTS, EXTENDS, etc.

---

## Performance Tips

### 1. Always Use LIMIT

```cypher
// BAD - Returns all nodes
MATCH (f:Function)
RETURN f

// GOOD - Returns only 10
MATCH (f:Function)
RETURN f
LIMIT 10
```

### 2. Filter Early

```cypher
// BAD - Filters after match
MATCH (f:Function)
WHERE f.filePath CONTAINS 'test-project'
RETURN f

// GOOD - Filters during match
MATCH (f:Function {filePath: '/Users/grop/ws/CodeGraph/test-project/src/calculator.ts'})
RETURN f
```

### 3. Use Indexes

```cypher
// Check existing indexes
SHOW INDEXES

// Create custom index if needed
CREATE INDEX function_name_index IF NOT EXISTS
FOR (f:Function) ON (f.name)
```

### 4. Profile Slow Queries

```cypher
PROFILE
MATCH (f1:Function)-[:CALLS*1..3]->(f2:Function)
RETURN f1.name, f2.name
LIMIT 10
```

---

## Debugging Queries

### Check What Data Exists

```cypher
// Count all nodes
MATCH (n) RETURN count(n)

// Count all relationships
MATCH ()-[r]->() RETURN count(r)

// Sample 10 random nodes
MATCH (n) RETURN n LIMIT 10
```

### Verify Analysis Completed

```cypher
// Check if your project files exist
MATCH (f:File)
WHERE f.filePath CONTAINS 'YOUR_PROJECT_PATH'
RETURN count(f) as FileCount
```

### Find Missing Relationships

```cypher
// Find functions with no calls
MATCH (f:Function)
WHERE NOT EXISTS { (f)-[:CALLS]->() }
RETURN count(f) as FunctionsWithoutCalls
```

---

## Advanced Patterns

### Shortest Path Between Functions

```cypher
MATCH path = shortestPath(
  (f1:Function {name: 'runDemo'})-[:CALLS*]-(f2:Function {name: 'formatNumber'})
)
RETURN [node IN nodes(path) | node.name] as Path
```

### All Paths (with limit)

```cypher
MATCH path = allShortestPaths(
  (f1:Function {name: 'runDemo'})-[:CALLS*..5]-(f2:Function)
)
RETURN [node IN nodes(path) | node.name] as Path
LIMIT 20
```

### Subgraph Extraction

```cypher
// Get the complete subgraph for a specific file
MATCH path = (f:File {name: 'calculator.ts'})-[*0..2]-(related)
RETURN path
LIMIT 50
```

---

## Export Results

### To CSV

```cypher
// In Neo4j Browser, click the download icon
MATCH (f:Function)-[:CALLS]->(called:Function)
RETURN f.name as Caller, called.name as Called
```

### To JSON (via API)

Use the Neo4j HTTP API or the `neo4j-driver` in your code.

---

## Resources

- **Cypher Manual**: https://neo4j.com/docs/cypher-manual/current/
- **CodeGraph Schema**: See `src/database/schema.ts` for all node/relationship types
- **Neo4j Browser**: http://localhost:7474 for interactive queries

---

**Generated**: 2025-11-02
**Tested On**: CodeGraph test-project and reminders service
**Status**: ✅ All queries verified working
