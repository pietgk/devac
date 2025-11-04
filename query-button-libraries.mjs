import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  "bolt://localhost:7687",
  neo4j.auth.basic("neo4j", "test1234")
);

async function queryButtonLibraries() {
  const session = driver.session({ database: "codegraph" });

  try {
    // Get all imports that mention Button
    console.log("\n=== ALL BUTTON-RELATED IMPORTS ===\n");
    const importsResult = await session.run(`
      MATCH (f:File)-[:HAS_IMPORT]->(i:Import)
      WHERE i.name CONTAINS 'Button' OR i.source CONTAINS 'button'
      RETURN i.name as importName,
             i.source as source,
             i.importPath as path,
             count(DISTINCT f) as fileCount
      ORDER BY fileCount DESC, source
      LIMIT 40
    `);

    importsResult.records.forEach((record) => {
      const name = record.get("importName");
      const source = record.get("source") || "?";
      const path = record.get("path");
      const count = record.get("fileCount").toNumber();
      console.log(`${name} from "${source}" (${count} files)`);
      if (path && path !== source) console.log(`  Path: ${path}`);
    });

    // Count Button JSX elements by type
    console.log("\n\n=== JSX BUTTON ELEMENTS BY TYPE ===\n");
    const jsxResult = await session.run(`
      MATCH (n:JSXElement)
      WHERE n.name CONTAINS 'Button'
      RETURN n.name as buttonType,
             count(*) as usageCount
      ORDER BY usageCount DESC
      LIMIT 25
    `);

    jsxResult.records.forEach((record) => {
      const type = record.get("buttonType");
      const count = record.get("usageCount").toNumber();
      console.log(`<${type} /> - ${count} usages`);
    });

    // Find files with most Button usage
    console.log("\n\n=== FILES WITH MOST BUTTON USAGE ===\n");
    const filesResult = await session.run(`
      MATCH (n:JSXElement)
      WHERE n.name CONTAINS 'Button'
      WITH n.filePath as file, count(*) as buttonCount
      ORDER BY buttonCount DESC
      LIMIT 20
      RETURN file, buttonCount
    `);

    filesResult.records.forEach((record, idx) => {
      const file = record.get("file");
      const count = record.get("buttonCount").toNumber();
      // Shorten the path
      const shortPath = file.replace("/Users/grop/ws/", "");
      console.log(`${idx + 1}. ${shortPath} (${count} buttons)`);
    });

    // Get custom Button component files
    console.log("\n\n=== CUSTOM BUTTON COMPONENT FILES ===\n");
    const customResult = await session.run(`
      MATCH (f:File)
      WHERE f.filePath =~ '.*[Bb]utton\\.(tsx|ts|jsx|js)$'
        AND NOT f.filePath CONTAINS 'node_modules'
      RETURN f.filePath as filePath,
             f.name as fileName
      ORDER BY f.filePath
    `);

    customResult.records.forEach((record, idx) => {
      const path = record.get("filePath");
      const shortPath = path.replace("/Users/grop/ws/", "");
      console.log(`${idx + 1}. ${shortPath}`);
    });

    // Analyze button variants/props
    console.log("\n\n=== BUTTON VARIANTS/STYLES USED ===\n");
    const variantsResult = await session.run(`
      MATCH (btn:JSXElement)-[:HAS_PROP]->(prop:JSXAttribute)
      WHERE btn.name CONTAINS 'Button'
        AND (prop.name = 'variant' OR prop.name = 'color' OR prop.name = 'size')
      RETURN prop.name as propName,
             prop.value as propValue,
             count(*) as usageCount
      ORDER BY propName, usageCount DESC
      LIMIT 50
    `);

    const propGroups = {};
    variantsResult.records.forEach((record) => {
      const propName = record.get("propName");
      const propValue = record.get("propValue");
      const count = record.get("usageCount").toNumber();

      if (!propGroups[propName]) propGroups[propName] = [];
      propGroups[propName].push({ value: propValue, count });
    });

    Object.keys(propGroups).forEach(propName => {
      console.log(`\n${propName.toUpperCase()}:`);
      propGroups[propName].forEach(({ value, count }) => {
        console.log(`  ${value}: ${count} usages`);
      });
    });

  } finally {
    await session.close();
  }
}

try {
  await queryButtonLibraries();
} catch (error) {
  console.error("Error querying database:", error.message);
  console.error(error.stack);
} finally {
  await driver.close();
}
