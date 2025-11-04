import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  "bolt://localhost:7687",
  neo4j.auth.basic("neo4j", "test1234")
);

async function queryButtonDetails() {
  const session = driver.session({ database: "codegraph" });

  try {
    // Get distinct button component types
    console.log("\n=== DISTINCT BUTTON COMPONENT TYPES ===\n");
    const typesResult = await session.run(`
      MATCH (n)
      WHERE n.name CONTAINS 'Button' AND 'Component' IN labels(n)
      RETURN DISTINCT n.name as componentName,
             count(*) as usageCount,
             collect(DISTINCT n.filePath)[0..3] as sampleFiles
      ORDER BY usageCount DESC
      LIMIT 20
    `);

    typesResult.records.forEach((record) => {
      const name = record.get("componentName");
      const count = record.get("usageCount").toNumber();
      const files = record.get("sampleFiles");
      console.log(`${name} (used ${count} times)`);
      files.forEach(file => console.log(`  - ${file}`));
      console.log("");
    });

    // Get custom Button components (actual definitions)
    console.log("\n=== CUSTOM BUTTON COMPONENT DEFINITIONS ===\n");
    const defsResult = await session.run(`
      MATCH (n)
      WHERE (n.name CONTAINS 'Button' OR n.filePath CONTAINS 'Button')
        AND ('Component' IN labels(n) OR 'Function' IN labels(n))
        AND n.filePath =~ '.*[Bb]utton\\.(tsx|ts|jsx|js)$'
      RETURN DISTINCT n.name as name,
             labels(n) as labels,
             n.filePath as filePath,
             n.line as line,
             n.description as description
      ORDER BY n.filePath
      LIMIT 30
    `);

    defsResult.records.forEach((record, idx) => {
      const name = record.get("name");
      const labels = record.get("labels");
      const filePath = record.get("filePath");
      const line = record.get("line");
      const description = record.get("description");

      console.log(`${idx + 1}. ${name} [${labels.join(", ")}]`);
      console.log(`   File: ${filePath}:${line || "?"}`);
      if (description) console.log(`   Description: ${description}`);
      console.log("");
    });

    // Get imports of Button components
    console.log("\n=== BUTTON COMPONENT IMPORTS ===\n");
    const importsResult = await session.run(`
      MATCH (n:Import)
      WHERE n.name CONTAINS 'Button' OR n.importPath CONTAINS 'Button'
      RETURN DISTINCT n.name as importName,
             n.importPath as importPath,
             count(*) as importCount
      ORDER BY importCount DESC
      LIMIT 30
    `);

    importsResult.records.forEach((record) => {
      const name = record.get("importName");
      const path = record.get("importPath");
      const count = record.get("importCount").toNumber();
      console.log(`${name} from "${path}" (imported ${count} times)`);
    });

    // Get Button usage by library
    console.log("\n\n=== BUTTON USAGE BY LIBRARY ===\n");
    const libResult = await session.run(`
      MATCH (n:Import)
      WHERE n.name CONTAINS 'Button'
      WITH n.importPath as lib, count(*) as count
      WHERE lib STARTS WITH '@' OR lib STARTS WITH 'react'
      RETURN lib, count
      ORDER BY count DESC
      LIMIT 15
    `);

    libResult.records.forEach((record) => {
      const lib = record.get("lib");
      const count = record.get("count").toNumber();
      console.log(`${lib}: ${count} imports`);
    });

  } finally {
    await session.close();
  }
}

try {
  await queryButtonDetails();
} catch (error) {
  console.error("Error querying database:", error.message);
} finally {
  await driver.close();
}
