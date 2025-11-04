#!/usr/bin/env node
import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  "bolt://localhost:7687",
  neo4j.auth.basic("neo4j", "test1234"),
);

async function runQuery(query, description) {
  const session = driver.session({ database: "codegraph" });
  try {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`📊 ${description}`);
    console.log("=".repeat(80));

    const result = await session.run(query);

    if (result.records.length === 0) {
      console.log("No results found.");
      return;
    }

    // Print header
    const keys = result.records[0].keys;
    console.log("\n" + keys.join(" | "));
    console.log("-".repeat(80));

    // Print rows
    result.records.forEach((record) => {
      const values = keys.map((key) => {
        const val = record.get(key);
        if (Array.isArray(val)) {
          return val.join(", ");
        }
        return val !== null && val !== undefined ? val.toString() : "null";
      });
      console.log(values.join(" | "));
    });

    console.log(`\nTotal: ${result.records.length} rows`);
  } catch (error) {
    console.error("Query error:", error.message);
  } finally {
    await session.close();
  }
}

async function main() {
  try {
    // Query 1: Node type counts
    await runQuery(
      `MATCH (n) RETURN labels(n)[0] as NodeType, count(n) as Count ORDER BY Count DESC`,
      "Node Types Overview",
    );

    // Query 2: Files
    await runQuery(
      `MATCH (f:File) RETURN f.name as FileName, f.loc as LinesOfCode ORDER BY f.loc DESC LIMIT 15`,
      "Top 15 Files by Lines of Code",
    );

    // Query 3: Functions
    await runQuery(
      `MATCH (f:Function) RETURN f.name as FunctionName, f.filePath as File LIMIT 20`,
      "Sample Functions",
    );

    // Query 4: Function calls
    await runQuery(
      `MATCH (source)-[r:CALLS]->(target) RETURN source.name as Caller, target.name as Called LIMIT 15`,
      "Function Calls",
    );

    // Query 5: Imports
    await runQuery(
      `MATCH (f:File)-[i:IMPORTS]->(target) RETURN f.name as File, count(i) as ImportCount ORDER BY ImportCount DESC LIMIT 15`,
      "Files with Most Imports",
    );

    // Query 6: Classes
    await runQuery(
      `MATCH (c:Class) RETURN c.name as ClassName, c.filePath as File LIMIT 10`,
      "Classes Found",
    );

    // Query 7: Interfaces
    await runQuery(
      `MATCH (i:Interface) RETURN i.name as InterfaceName, i.filePath as File LIMIT 10`,
      "Interfaces Found",
    );

    // Query 8: Type Aliases
    await runQuery(
      `MATCH (t:TypeAlias) RETURN t.name as TypeName, t.filePath as File LIMIT 10`,
      "Type Aliases",
    );

    // Query 9: Relationship types
    await runQuery(
      `MATCH ()-[r]->() RETURN type(r) as RelationshipType, count(r) as Count ORDER BY Count DESC`,
      "Relationship Types",
    );

    // Query 10: Most connected nodes (fixed for Neo4j 5.x)
    await runQuery(
      `MATCH (n)
       WHERE EXISTS { (n)-[:IMPORTS|CALLS|EXTENDS|HAS_PARAMETER]->() }
          OR EXISTS { ()<-[:IMPORTS|CALLS|EXTENDS|HAS_PARAMETER]-(n) }
       WITH n, labels(n)[0] as Type
       MATCH (n)-[r]-()
       WITH Type, n.name as Name, count(r) as connections
       RETURN Type, Name, connections
       ORDER BY connections DESC
       LIMIT 15`,
      "Most Connected Nodes",
    );

    // Query 11: Cross-Package Dependencies
    await runQuery(
      `MATCH (p1:Package)-[d:DEPENDS_ON]->(p2:Package)
       WITH p1, p2, count(d) as depCount
       ORDER BY depCount DESC
       RETURN p1.name as FromPackage,
              p2.name as ToPackage,
              depCount as Dependencies`,
      "Cross-Package Dependencies",
    );

    // Query 12: Package Import Frequency
    await runQuery(
      `MATCH (f1:File)-[:BELONGS_TO]->(p1:Package)
       MATCH (f1)-[:IMPORTS]->(f2:File)-[:BELONGS_TO]->(p2:Package)
       WHERE p1 <> p2
       WITH p1.name as SourcePkg, p2.name as TargetPkg, count(*) as imports
       ORDER BY imports DESC
       RETURN SourcePkg, TargetPkg, imports
       LIMIT 20`,
      "Most Frequent Cross-Package Imports",
    );

    // Query 13: Orphaned Files (not in any package)
    await runQuery(
      `MATCH (f:File)
       WHERE NOT EXISTS { (f)-[:BELONGS_TO]->(:Package) }
       RETURN f.name as File, f.filePath as Path
       LIMIT 20`,
      "Files Not Belonging to Any Package",
    );

    // Query 14: Package Health Metrics
    await runQuery(
      `MATCH (p:Package)<-[:BELONGS_TO]-(f:File)
       WITH p, count(f) as fileCount
       OPTIONAL MATCH (p)<-[:DEPENDS_ON]-(dependent:Package)
       WITH p, fileCount, count(dependent) as dependents
       OPTIONAL MATCH (p)-[:DEPENDS_ON]->(dependency:Package)
       WITH p, fileCount, dependents, count(dependency) as dependencies
       RETURN p.name as Package,
              p.path as Path,
              fileCount as Files,
              dependents as DependentPackages,
              dependencies as PackageDependencies
       ORDER BY fileCount DESC`,
      "Package Health Metrics",
    );

    // Query 15: Circular Dependencies Detection
    await runQuery(
      `MATCH path = (p1:Package)-[:DEPENDS_ON*2..5]->(p1)
       WITH p1, [p in nodes(path) | p.name] as cycle
       RETURN DISTINCT p1.name as Package, cycle as CircularPath`,
      "Circular Package Dependencies",
    );
  } finally {
    await driver.close();
  }
}

main().catch(console.error);
