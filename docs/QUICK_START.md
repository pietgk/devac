# CodeGraph Quick Start Guide

Get started with CodeGraph in 5 minutes and generate your first C4 diagram.

## Prerequisites

- ✅ Node.js 18+ installed
- ✅ Neo4j running (Desktop or Docker)
- ✅ A codebase to analyze (TypeScript, JavaScript, Python, Java, etc.)

## Installation

```bash
# Clone or download CodeGraph
cd /path/to/CodeGraph

# Install dependencies
npm install

# Build
npm run build
```

## Configuration

### 1. Set Up Neo4j Credentials

Create `.env` file:

```bash
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_password
NEO4J_DATABASE=codegraph
```

### 2. Start Neo4j

```bash
# If using Neo4j Desktop: Start your database
# If using Docker:
docker run \
  --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/your_password \
  neo4j:latest
```

## Basic Usage

### Analyze a Single Project

```bash
# Analyze current directory
node dist/index.js analyze . --update-schema

# Analyze specific directory
node dist/index.js analyze /path/to/your/project --update-schema

# With options
node dist/index.js analyze . \
  --update-schema \
  --ignore "**/node_modules/**,**/dist/**" \
  --extensions .ts,.js,.py
```

### Options

| Flag | Description | Example |
|------|-------------|---------|
| `--update-schema` | Create/update Neo4j constraints | Required first run |
| `--reset-db` | Clear database before analysis | `--reset-db` |
| `--ignore <patterns>` | Comma-separated ignore patterns | `"**/test/**,**/build/**"` |
| `--extensions <exts>` | File extensions to process | `.ts,.js,.py` |
| `-v, -vv, -vvv` | Verbosity levels | `-vv` for debug |

## Generate C4 Diagrams

### Step 1: Run Analysis

```bash
node dist/index.js analyze /path/to/monorepo --update-schema
```

### Step 2: Open Neo4j Browser

```bash
open http://localhost:7474
```

### Step 3: Run C4 Queries

#### Container Diagram (Package Dependencies)

```cypher
MATCH (p1:Package)-[d:DEPENDS_ON]->(p2:Package)
RETURN p1.name as source,
       p1.type as sourceType,
       p2.name as target,
       p2.type as targetType,
       d.weight as imports
ORDER BY d.weight DESC
LIMIT 20
```

**Visualize**:
- Click "Graph" view in Neo4j Browser
- See package dependency network
- Thicker edges = more imports

#### Component Diagram (React Components)

```cypher
// After ComponentAnalyzer integration
MATCH (pkg:Package {name: "your-package"})<-[:BELONGS_TO]-(f:File)
MATCH (f)-[:CONTAINS]->(comp:Function {isReactComponent: true})
OPTIONAL MATCH (comp)-[:RENDERS_COMPONENT]->(child:Function)
OPTIONAL MATCH (comp)-[:USES_HOOK]->(hook:Function)
RETURN comp.name,
       comp.filePath,
       collect(DISTINCT child.name) as renders,
       collect(DISTINCT hook.name) as hooks
ORDER BY comp.name
LIMIT 20
```

## Workspace Management (Monorepos)

### 1. Create Workspace Config

```bash
# Create workspace directory
mkdir -p .codegraph

# Initialize config
cat > .codegraph/workspace.json << 'EOF'
{
  "workspaceName": "MyCompany",
  "repositories": [
    {
      "name": "frontend",
      "path": "/path/to/frontend-monorepo",
      "enabled": true
    },
    {
      "name": "backend",
      "path": "/path/to/backend-services",
      "enabled": true
    }
  ],
  "filterPresets": [
    {
      "name": "frontend-only",
      "repositories": ["frontend"],
      "maxFiles": 1000
    }
  ]
}
EOF
```

### 2. Sync Workspace

```bash
# Sync all repositories
node dist/index.js workspace sync

# Sync with filter
node dist/index.js workspace sync --filter frontend

# Use preset
node dist/index.js workspace sync --filter-preset frontend-only

# With verbosity
node dist/index.js workspace sync -vv
```

### 3. Check Status

```bash
node dist/index.js workspace status
```

## Common Queries

### 1. Find All Packages

```cypher
MATCH (p:Package)
OPTIONAL MATCH (p)<-[:BELONGS_TO]-(f:File)
RETURN p.name, p.type, p.version, count(f) as fileCount
ORDER BY fileCount DESC
```

### 2. Check Import Resolution Rate

```cypher
MATCH (i:Import)
WITH count(i) as total
MATCH ()-[:RESOLVES_TO]->()
WITH total, count(*) as resolved
RETURN total, 
       resolved, 
       round(resolved * 100.0 / total, 2) as resolvedPercent
```

**Expected**: >90% resolution rate

### 3. Find Most Imported Files

```cypher
MATCH (target)<-[:RESOLVES_TO]-(i:Import)
WHERE target:File OR target:Function
RETURN target.name,
       target.filePath,
       count(i) as importCount
ORDER BY importCount DESC
LIMIT 20
```

### 4. Find Circular Dependencies

```cypher
MATCH path = (p1:Package)-[:DEPENDS_ON*2..5]->(p1)
RETURN [node in nodes(path) | node.name] as cycle,
       length(path) as cycleLength
ORDER BY cycleLength
LIMIT 10
```

### 5. Component Hierarchy

```cypher
// After ComponentAnalyzer integration
MATCH (parent:Function {isReactComponent: true})
       -[:RENDERS_COMPONENT]->(child:Function)
RETURN parent.name, 
       parent.filePath,
       collect(child.name) as renderedComponents
ORDER BY size(renderedComponents) DESC
LIMIT 20
```

### 6. Find Hook Usage

```cypher
// After ComponentAnalyzer integration
MATCH (hook:Function {isHook: true})<-[:USES_HOOK]-(comp:Function)
RETURN hook.name,
       count(comp) as usedByCount,
       collect(comp.name)[0..5] as usedByComponents
ORDER BY usedByCount DESC
LIMIT 10
```

## Validation Checklist

After running analysis, verify:

```cypher
// 1. Check nodes created
MATCH (n)
RETURN labels(n)[0] as nodeType, count(n) as count
ORDER BY count DESC

// 2. Check relationships created
MATCH ()-[r]->()
RETURN type(r) as relType, count(r) as count
ORDER BY count DESC

// 3. Verify packages detected
MATCH (p:Package)
RETURN count(p) as packageCount

// 4. Verify file-package mapping
MATCH (:File)-[:BELONGS_TO]->(:Package)
RETURN count(*) as mappedFiles

// 5. Verify package dependencies
MATCH (:Package)-[d:DEPENDS_ON]->(:Package)
RETURN count(d) as dependencies,
       avg(d.weight) as avgImports
```

**Expected Results** (for medium-sized monorepo):

| Metric | Expected |
|--------|----------|
| Package nodes | 5-20 |
| File nodes | 500-2000 |
| Function nodes | 1000-5000 |
| BELONGS_TO relationships | Match file count |
| DEPENDS_ON relationships | 10-100 |
| Import resolution rate | >90% |

## Troubleshooting

### Neo4j Connection Failed

```bash
# Check Neo4j is running
curl http://localhost:7474

# Verify credentials in .env
cat .env
```

### No Packages Detected

```bash
# Check if workspace.yaml or package.json exists
ls pnpm-workspace.yaml package.json

# Verify package structure
cat pnpm-workspace.yaml
```

### Low Import Resolution Rate (<80%)

Possible causes:
- Missing `tsconfig.json` path aliases
- External packages not in workspace
- Relative imports with wrong extensions

Solution:
```bash
# Run with debug logging
node dist/index.js analyze . -vv --update-schema
```

### Memory Issues

```bash
# Limit files processed
node dist/index.js analyze . --max-files 1000

# Or use workspace filter
node dist/index.js workspace sync --filter-preset small-batch
```

## Next Steps

1. **Explore Architecture**: Read `docs/architecture/ARCHITECTURE.md`
2. **Learn Entity ID System**: Understand function overloading support
3. **Add ComponentAnalyzer**: Enable React component tracking (1 hour)
4. **Custom Queries**: Write queries for your specific needs
5. **Extend CodeGraph**: Add new extractors for your languages

## Example: Real-World Workflow

```bash
# 1. Set up workspace
mkdir -p .codegraph
cat > .codegraph/workspace.json << 'EOF'
{
  "workspaceName": "MyCompany",
  "repositories": [
    {
      "name": "frontend-monorepo",
      "path": "/Users/me/frontend-monorepo",
      "enabled": true
    }
  ]
}
EOF

# 2. Initial sync (verbose)
node dist/index.js workspace sync -vv --update-schema

# 3. Verify in Neo4j Browser
open http://localhost:7474

# 4. Run C4 Container query
# Copy-paste Container Diagram query from above

# 5. Analyze results
# - Which packages are most coupled?
# - Are there circular dependencies?
# - What's the import resolution rate?

# 6. Make code changes

# 7. Re-sync to see changes
node dist/index.js workspace sync --filter frontend-monorepo
```

## Tips

- **Start Small**: Test on a small project first
- **Use Verbosity**: `-vv` helps debug issues
- **Check Schema**: Run `--update-schema` after CodeGraph updates
- **Save Queries**: Create favorites in Neo4j Browser
- **Workspace Presets**: Define presets for common analysis scenarios
- **Incremental Analysis**: Use workspace filtering for fast iterations

## Resources

- **Full Documentation**: `docs/architecture/ARCHITECTURE.md`
- **Session Notes**: `docs/sessions/archive/023-analysis/` (historical context)
- **Issue Tracker**: Check GitHub issues for known problems
- **Neo4j Docs**: https://neo4j.com/docs/

## Getting Help

If you encounter issues:

1. Check Neo4j Browser logs (http://localhost:7474)
2. Run with `-vvv` for maximum verbosity
3. Verify `.env` configuration
4. Check `docs/architecture/ARCHITECTURE.md` for detailed info
5. Review validation queries above

---

**You're ready to explore your codebase with CodeGraph! 🚀**
