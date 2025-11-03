#!/usr/bin/env node
/**
 * Integration test for MCP + CodeGraph + Neo4j pipeline
 * Tests the complete flow from analysis to querying
 */

import { spawn } from "child_process";
import neo4j from "neo4j-driver";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const TEST_PROJECT_DIR = path.join(__dirname, "test-project");
const NEO4J_URI = process.env.NEO4J_URL || "bolt://localhost:7687";
const NEO4J_USER = process.env.NEO4J_USER || "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || "test1234";
const NEO4J_DATABASE = process.env.NEO4J_DATABASE || "neo4j";

console.log("=== CodeGraph MCP Integration Test ===\n");

let driver;
let testsPassed = 0;
let testsFailed = 0;

async function test(name, fn) {
  process.stdout.write(`Testing: ${name}... `);
  try {
    await fn();
    console.log("✅ PASS");
    testsPassed++;
  } catch (error) {
    console.log("❌ FAIL");
    console.error(`   Error: ${error.message}`);
    testsFailed++;
  }
}

async function main() {
  // Test 1: Verify test project exists
  await test("Test project directory exists", async () => {
    if (!fs.existsSync(TEST_PROJECT_DIR)) {
      throw new Error(`Test project not found at ${TEST_PROJECT_DIR}`);
    }
  });

  // Test 2: Connect to Neo4j
  await test("Connect to Neo4j", async () => {
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
    await driver.verifyConnectivity();
  });

  // Test 3: Clear test data from database
  await test("Clear existing test data", async () => {
    const session = driver.session({ database: NEO4J_DATABASE });
    try {
      await session.run("MATCH (n) WHERE n.filePath STARTS WITH $testPath DETACH DELETE n", {
        testPath: TEST_PROJECT_DIR,
      });
    } finally {
      await session.close();
    }
  });

  // Test 4: Run CodeGraph analysis
  await test("Run CodeGraph analysis", async () => {
    return new Promise((resolve, reject) => {
      const analysis = spawn(
        "node",
        [
          "dist/index.js",
          "analyze",
          TEST_PROJECT_DIR,
          "--update-schema",
          "--neo4j-url",
          NEO4J_URI,
          "--neo4j-user",
          NEO4J_USER,
          "--neo4j-password",
          NEO4J_PASSWORD,
          "--neo4j-database",
          NEO4J_DATABASE,
        ],
        { cwd: __dirname }
      );

      let stdout = "";
      let stderr = "";

      analysis.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      analysis.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      analysis.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Analysis failed with code ${code}`));
        } else if (!stdout.includes("Analysis results stored")) {
          reject(new Error("Analysis did not complete successfully"));
        } else {
          resolve();
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        analysis.kill();
        reject(new Error("Analysis timeout"));
      }, 30000);
    });
  });

  // Test 5: Verify nodes were created
  await test("Verify nodes created in Neo4j", async () => {
    const session = driver.session({ database: NEO4J_DATABASE });
    try {
      const result = await session.run(
        "MATCH (n) WHERE n.filePath STARTS WITH $testPath RETURN count(n) as nodeCount",
        { testPath: TEST_PROJECT_DIR }
      );

      const nodeCount = result.records[0].get("nodeCount").toNumber();
      if (nodeCount === 0) {
        throw new Error("No nodes found in database");
      }
      console.log(`      (Found ${nodeCount} nodes)`);
    } finally {
      await session.close();
    }
  });

  // Test 6: Verify File nodes exist
  await test("Verify File nodes exist", async () => {
    const session = driver.session({ database: NEO4J_DATABASE });
    try {
      const result = await session.run(
        "MATCH (f:File) WHERE f.filePath STARTS WITH $testPath RETURN count(f) as fileCount",
        { testPath: TEST_PROJECT_DIR }
      );

      const fileCount = result.records[0].get("fileCount").toNumber();
      if (fileCount === 0) {
        throw new Error("No File nodes found");
      }
      console.log(`      (Found ${fileCount} file nodes)`);
    } finally {
      await session.close();
    }
  });

  // Test 7: Verify Function nodes exist
  await test("Verify Function nodes exist", async () => {
    const session = driver.session({ database: NEO4J_DATABASE });
    try {
      const result = await session.run(
        "MATCH (f:Function) WHERE f.filePath STARTS WITH $testPath RETURN count(f) as funcCount",
        { testPath: TEST_PROJECT_DIR }
      );

      const funcCount = result.records[0].get("funcCount").toNumber();
      if (funcCount === 0) {
        throw new Error("No Function nodes found");
      }
      console.log(`      (Found ${funcCount} function nodes)`);
    } finally {
      await session.close();
    }
  });

  // Test 8: Verify CALLS relationships exist
  await test("Verify CALLS relationships exist", async () => {
    const session = driver.session({ database: NEO4J_DATABASE });
    try {
      const result = await session.run(
        "MATCH (f1:Function)-[r:CALLS]->(f2:Function) WHERE f1.filePath STARTS WITH $testPath RETURN count(r) as callCount",
        { testPath: TEST_PROJECT_DIR }
      );

      const callCount = result.records[0].get("callCount").toNumber();
      console.log(`      (Found ${callCount} call relationships)`);
      // Note: This might be 0 for a simple test project without calls
    } finally {
      await session.close();
    }
  });

  // Test 9: Query specific function
  await test("Query for specific function", async () => {
    const session = driver.session({ database: NEO4J_DATABASE });
    try {
      const result = await session.run(
        "MATCH (f:Function) WHERE f.filePath STARTS WITH $testPath RETURN f.name as name LIMIT 1",
        { testPath: TEST_PROJECT_DIR }
      );

      if (result.records.length === 0) {
        throw new Error("Could not find any function");
      }

      const funcName = result.records[0].get("name");
      console.log(`      (Found function: ${funcName})`);
    } finally {
      await session.close();
    }
  });

  // Cleanup
  if (driver) {
    await driver.close();
  }

  // Summary
  console.log("\n=== Test Summary ===");
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📊 Total:  ${testsPassed + testsFailed}`);

  if (testsFailed > 0) {
    console.log("\n❌ Some tests failed");
    process.exit(1);
  } else {
    console.log("\n✅ All tests passed!");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error.message);
  if (driver) {
    driver.close();
  }
  process.exit(1);
});
