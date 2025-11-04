import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  "bolt://localhost:7687",
  neo4j.auth.basic("neo4j", "test1234")
);

async function queryButtons() {
  const session = driver.session({ database: "codegraph" });

  try {
    const result = await session.run(`
      MATCH (n)
      WHERE n.name CONTAINS 'Button'
         OR n.filePath CONTAINS 'Button'
         OR n.filePath CONTAINS 'button'
      RETURN labels(n) as labels,
             n.name as name,
             n.filePath as filePath,
             n.line as line,
             n.description as description,
             n.visibility as visibility
      ORDER BY n.filePath, n.line
      LIMIT 100
    `);

    console.log(`\nFound ${result.records.length} Button-related nodes:\n`);
    console.log("=".repeat(80));

    result.records.forEach((record, index) => {
      const labels = record.get("labels");
      const name = record.get("name");
      const filePath = record.get("filePath");
      const line = record.get("line");
      const description = record.get("description");
      const visibility = record.get("visibility");

      console.log(`\n${index + 1}. [${labels.join(", ")}] ${name}`);
      console.log(`   File: ${filePath}${line ? `:${line}` : ""}`);
      if (description) console.log(`   Description: ${description}`);
      if (visibility) console.log(`   Visibility: ${visibility}`);
    });

    // Get relationships for Button components
    console.log("\n" + "=".repeat(80));
    console.log("\nButton Component Relationships:\n");

    const relResult = await session.run(`
      MATCH (n)-[r]->(m)
      WHERE n.name CONTAINS 'Button'
      RETURN n.name as from,
             type(r) as relationship,
             m.name as to,
             n.filePath as fromFile,
             m.filePath as toFile
      ORDER BY n.name, type(r)
      LIMIT 50
    `);

    relResult.records.forEach((record) => {
      const from = record.get("from");
      const rel = record.get("relationship");
      const to = record.get("to");
      const fromFile = record.get("fromFile");
      const toFile = record.get("toFile");

      console.log(`${from} --[${rel}]--> ${to}`);
      if (fromFile !== toFile) {
        console.log(`  (${fromFile} → ${toFile})`);
      }
    });

  } finally {
    await session.close();
  }
}

try {
  await queryButtons();
} catch (error) {
  console.error("Error querying database:", error.message);
} finally {
  await driver.close();
}
