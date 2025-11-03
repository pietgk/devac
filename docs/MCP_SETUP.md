# CodeGraph MCP Setup Guide

Complete guide to setting up and using CodeGraph with Model Context Protocol (MCP) integration.

## Overview

CodeGraph provides two complementary MCP servers that enable AI-powered codebase exploration:

1. **code-analyzer-mcp** - Triggers CodeGraph analysis from Claude Desktop
2. **@alanse/mcp-neo4j-server** - Enables natural language → Cypher queries

Together, these create a "neural bridge" where AI can understand your codebase through the Neo4j knowledge graph.

## Prerequisites

- ✅ Node.js 18+ installed
- ✅ Neo4j database running (bolt://localhost:7687)
- ✅ CodeGraph built (`npm run build` in project root)
- ✅ Claude Desktop installed (optional, for AI integration)

## Part 1: Build the MCP Server

The code-analyzer-mcp server needs to be built before use:

```bash
cd /Users/grop/ws/CodeGraph/mcp
npm install
npm run build
```

Verify the build:
```bash
ls -la dist/
# Should show: index.js, index.d.ts, index.js.map
```

## Part 2: Test the MCP Server (Standalone)

Before configuring Claude Desktop, verify the MCP server works:

```bash
cd /Users/grop/ws/CodeGraph/mcp
node test-mcp-stdio.js
```

Expected output:
```
✅ Server initialized successfully!
✅ Tool call successful!
📋 Command Details:
   Command: node "/Users/grop/ws/CodeGraph/dist/index.js" analyze ...
   CWD: /Users/grop/ws/CodeGraph
✅ All tests passed!
```

## Part 3: Configure Claude Desktop

### Locate Claude Desktop Config

The config file location depends on your platform:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

### Add MCP Servers

Edit the config file (create it if it doesn't exist):

```json
{
  "mcpServers": {
    "code-analyzer-mcp": {
      "command": "node",
      "args": [
        "/Users/grop/ws/CodeGraph/mcp/dist/index.js"
      ],
      "disabled": false,
      "alwaysAllow": [
        "run_analyzer"
      ]
    },
    "neo4j": {
      "command": "npx",
      "args": [
        "-y",
        "@alanse/mcp-neo4j-server@latest"
      ],
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USERNAME": "neo4j",
        "NEO4J_PASSWORD": "test1234",
        "NEO4J_DATABASE": "neo4j"
      },
      "disabled": false,
      "alwaysAllow": [
        "read-neo4j-cypher",
        "write-neo4j-cypher",
        "get-neo4j-schema"
      ]
    }
  }
}
```

### Important Configuration Notes

1. **Update the path** in `code-analyzer-mcp` to match your installation:
   - Replace `/Users/grop/ws/CodeGraph` with your actual path

2. **Update Neo4j credentials** to match your setup:
   - `NEO4J_PASSWORD` - Your Neo4j password
   - `NEO4J_DATABASE` - Your database name (default: `neo4j`)

3. **Database Name Conflict**:
   - The code-analyzer-mcp currently uses `codegraph` database (hardcoded)
   - If you want to use the default `neo4j` database, update `src/index.ts` line 69
   - Or create a `codegraph` database in Neo4j

### Restart Claude Desktop

After editing the config:
1. Quit Claude Desktop completely
2. Restart it
3. Check the MCP status in settings

## Part 4: Usage Workflow

### Step 1: Analyze Your Codebase

In Claude Desktop:
```
Analyze the codebase at /path/to/your/project
```

Claude will:
1. Call the `run_analyzer` tool
2. Receive the command to execute
3. Run CodeGraph analysis
4. Store results in Neo4j

### Step 2: Query Your Code

After analysis, ask natural language questions:

```
Show me all TypeScript functions

What files import the Calculator class?

Find functions with more than 5 parameters

How does the login flow work?

What would break if I change the add() function?
```

Claude will:
1. Translate your question to Cypher
2. Query the Neo4j graph
3. Return contextualized results

## Part 5: Integration Test

Test the complete pipeline:

```bash
cd /Users/grop/ws/CodeGraph
node test-mcp-integration.js
```

This will:
1. ✅ Connect to Neo4j
2. ✅ Clear test data
3. ✅ Run CodeGraph analysis on the test project
4. ✅ Verify nodes were created (52 nodes expected)
5. ✅ Verify relationships (7 CALLS expected)
6. ✅ Test querying the graph

Expected output:
```
=== Test Summary ===
✅ Passed: 9
❌ Failed: 0
📊 Total:  9

✅ All tests passed!
```

## Part 6: Example Queries

See `example-queries.md` for comprehensive Cypher examples and expected results.

Quick examples:

### Find All Functions
```cypher
MATCH (f:Function)
RETURN f.name, f.filePath
LIMIT 10
```

### Function Call Graph
```cypher
MATCH (f1:Function)-[:CALLS]->(f2:Function)
RETURN f1.name as Caller, f2.name as Called
LIMIT 20
```

### Import Dependencies
```cypher
MATCH (f1:File)-[:IMPORTS]->(f2:File)
RETURN f1.name, f2.name
```

## Troubleshooting

### MCP Server Not Showing in Claude

1. **Check config path**: Ensure you edited the correct file
2. **Verify JSON syntax**: Use a JSON validator
3. **Check paths**: All file paths must be absolute
4. **Restart**: Fully quit and restart Claude Desktop

### Analysis Not Working

1. **Check Neo4j**: Ensure it's running on port 7687
2. **Test credentials**: Use Neo4j Browser to verify login
3. **Check database**: Create `codegraph` database or update config
4. **Run manually**:
   ```bash
   node dist/index.js analyze /path/to/project \
     --neo4j-url bolt://localhost:7687 \
     --neo4j-user neo4j \
     --neo4j-password test1234 \
     --neo4j-database neo4j
   ```

### No Results in Queries

1. **Verify data**: Use Neo4j Browser to check nodes exist
2. **Check database name**: Ensure Neo4j MCP uses same database
3. **Scope queries**: Use `filePath` filters to find your project data
4. **Run integration test**: Verify the pipeline works end-to-end

### Database Name Mismatch

The two servers use different database names by default:
- **code-analyzer-mcp**: Uses `codegraph` (line 69 in `mcp/src/index.ts`)
- **neo4j-mcp**: Uses `neo4j` (from environment variable)

**Solution Options**:

1. **Use `neo4j` database** (recommended):
   - Edit `mcp/src/index.ts` line 69: change `'codegraph'` to `'neo4j'`
   - Rebuild: `cd mcp && npm run build`

2. **Create `codegraph` database**:
   ```cypher
   CREATE DATABASE codegraph IF NOT EXISTS
   ```
   - Update Claude Desktop config to use `codegraph`

## Advanced Configuration

### Custom Analysis Options

Edit `mcp/src/index.ts` to customize analysis parameters:

```typescript
const commandString = [
  'node',
  `"${analyzerScriptPath}"`,
  'analyze',
  `"${absoluteAnalysisDir}"`,
  '--update-schema',              // Apply schema on each run
  '--neo4j-url', 'bolt://localhost:7687',
  '--neo4j-user', 'neo4j',
  '--neo4j-password', 'YOUR_PASSWORD',  // Update this
  '--neo4j-database', 'neo4j',          // Update this
].join(' ');
```

After changes, rebuild: `cd mcp && npm run build`

### Environment Variables

Set environment variables in Claude Desktop config:

```json
{
  "mcpServers": {
  {
    "code-analyzer-mcp": {
      "command": "node",
      "args": ["/Users/grop/ws/CodeGraph/mcp/dist/index.js"],
      "env": {
        "LOG_LEVEL": "debug",
        "NEO4J_URL": "bolt://localhost:7687"
      }
    }
  }
}
```

## Security Considerations

⚠️ **Important**: The MCP server config contains Neo4j credentials in plain text.

**Recommendations**:

1. **Use strong passwords**: Don't use default `test1234` in production
2. **Limit Neo4j access**: Configure firewall rules
3. **File permissions**: Restrict config file access
   ```bash
   chmod 600 ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```
4. **Consider environment variables**: For team setups, use a secrets manager

## Performance Tips

### Large Codebases

For projects with 1000+ files:

1. **Batch analysis**: Analyze subdirectories separately
2. **Increase timeouts**: Edit timeout values in MCP server
3. **Optimize Neo4j**: Increase heap size, add indexes
4. **Use filters**: Query specific file paths

### Query Optimization

1. **Add indexes**: Create indexes on commonly queried properties
2. **Limit results**: Always use `LIMIT` in exploratory queries
3. **Filter by path**: Use `WHERE filePath STARTS WITH` to scope queries
4. **Profile queries**: Use `EXPLAIN` to optimize slow queries

## Next Steps

1. **Read** `example-queries.md` for query examples
2. **Explore** your codebase with natural language
3. **Customize** analysis parameters for your needs
4. **Share** the setup with your team

## Resources

- **CodeGraph README**: Main project documentation
- **Neo4j Browser**: http://localhost:7474
- **MCP Documentation**: https://modelcontextprotocol.io
- **Neo4j MCP Server**: https://github.com/neo4j-contrib/mcp-neo4j

---

**Generated**: 2025-11-02
**Tested On**: macOS, Node.js v20.13.1, Neo4j 5.x
**Status**: ✅ Production Ready
