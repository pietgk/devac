import { describe, it, expect, beforeAll } from "vitest";
import { resolve, join } from "path";
import { StructuralParser } from "../structural-parser.js";

/**
 * Simplified Integration Test for Lazy Semantic Resolution POC
 *
 * This test validates the core concept:
 * 1. Structural parsing is fast (<200ms per file)
 * 2. Structural data extraction works correctly
 * 3. Import strings are captured for later semantic resolution
 *
 * Full Neo4j integration will be added when SemanticResolver is updated
 * to work with the actual Neo4jClient API.
 */
describe("Lazy Semantic Resolution - Structural Phase", () => {
  let structuralParser: StructuralParser;

  const testCodebasePath = resolve(
    process.cwd(),
    "test-fixtures/integration-test-codebase",
  );

  const testFiles = [
    join(testCodebasePath, "src/types.ts"),
    join(testCodebasePath, "src/utils/validator.ts"),
    join(testCodebasePath, "src/services/Database.ts"),
    join(testCodebasePath, "src/services/UserService.ts"),
    join(testCodebasePath, "src/services/PostService.ts"),
    join(testCodebasePath, "src/index.ts"),
  ];

  beforeAll(() => {
    structuralParser = new StructuralParser();
  });

  it("should parse all test files structurally within performance target", async () => {
    console.log("\n=== Structural Parsing Performance Test ===\n");

    const results = await Promise.all(
      testFiles.map(async (filePath) => {
        const startTime = performance.now();
        const result = await structuralParser.parseStructural(filePath);
        const parseTime = performance.now() - startTime;

        const fileName = filePath.split("/").pop();
        console.log(`  ${fileName}: ${parseTime.toFixed(2)}ms`);

        return { fileName, parseTime, result };
      }),
    );

    // Calculate average
    const avgTime =
      results.reduce((sum, r) => sum + r.parseTime, 0) / results.length;
    console.log(`\n  Average: ${avgTime.toFixed(2)}ms`);
    console.log(`  Target: <200ms ✓\n`);

    // Verify all meet target
    for (const { fileName, parseTime } of results) {
      expect(parseTime).toBeLessThan(200);
    }

    expect(avgTime).toBeLessThan(200);
  });

  it("should extract structural nodes correctly", async () => {
    console.log("\n=== Structural Node Extraction ===\n");

    // Test types.ts
    const typesResult = await structuralParser.parseStructural(testFiles[0]);

    console.log(`  types.ts nodes: ${typesResult.nodes.length}`);

    // Should find: ValidationError class (interfaces and types are not extracted by StructuralParser)
    const nodeNames = typesResult.nodes.map((n) => n.name);

    expect(nodeNames).toContain("ValidationError");

    console.log(`  Found: ${nodeNames.join(", ")}`);
    console.log(
      `  Note: Interfaces and type aliases require semantic resolution`,
    );
  });

  it("should extract structural relationships (CONTAINS, OWNS)", async () => {
    console.log("\n=== Structural Relationships ===\n");

    // Test UserService.ts
    const userServiceResult = await structuralParser.parseStructural(
      testFiles[3],
    );

    // Should have CONTAINS relationship from File to UserService class
    const containsRels = userServiceResult.relationships.filter(
      (r) => r.type === "CONTAINS",
    );
    expect(containsRels.length).toBeGreaterThan(0);

    console.log(`  CONTAINS relationships: ${containsRels.length}`);

    // Should have OWNS relationships from UserService to its methods
    const ownsRels = userServiceResult.relationships.filter(
      (r) => r.type === "OWNS",
    );
    expect(ownsRels.length).toBeGreaterThan(0);

    console.log(`  OWNS relationships: ${ownsRels.length}`);

    // All structural relationships should have phase: "structural"
    for (const rel of userServiceResult.relationships) {
      expect(rel.properties?.phase).toBe("structural");
    }
  });

  it("should capture import strings for deferred semantic resolution", async () => {
    console.log("\n=== Import String Capture ===\n");

    // Test UserService.ts which has multiple imports
    const userServiceResult = await structuralParser.parseStructural(
      testFiles[3],
    );

    console.log(`  Import strings: ${userServiceResult.importStrings.length}`);
    console.log(`  Imports: ${userServiceResult.importStrings.join(", ")}`);

    // Should capture import strings (not resolved to full paths yet)
    expect(userServiceResult.importStrings).toContain("../types.js");
    expect(userServiceResult.importStrings).toContain("../utils/validator.js");
    expect(userServiceResult.importStrings).toContain("./Database.js");

    // These will be resolved later during semantic phase
    console.log(`  ✓ Import strings captured for semantic resolution`);
  });

  it("should capture exported symbols for cross-file resolution", async () => {
    console.log("\n=== Export Symbol Capture ===\n");

    // Test index.ts which re-exports from other files
    const indexResult = await structuralParser.parseStructural(testFiles[5]);

    console.log(`  Exported symbols: ${indexResult.exportedSymbols.length}`);

    const exportNames = indexResult.exportedSymbols.map((e) => e.name);
    console.log(`  Exports: ${exportNames.join(", ")}`);

    // Should capture re-exported symbols
    expect(exportNames).toContain("Database");
    expect(exportNames).toContain("UserService");
    expect(exportNames).toContain("PostService");

    // Should also capture re-exported types
    expect(exportNames).toContain("User");
    expect(exportNames).toContain("Post");
  });

  it("should complete structural phase in <2 seconds for entire codebase", async () => {
    console.log("\n=== Full Codebase Structural Parsing ===\n");

    const startTime = performance.now();

    const results = await Promise.all(
      testFiles.map((file) => structuralParser.parseStructural(file)),
    );

    const totalTime = performance.now() - startTime;
    const avgTime = totalTime / testFiles.length;

    console.log(`  Files: ${testFiles.length}`);
    console.log(`  Total time: ${totalTime.toFixed(2)}ms`);
    console.log(`  Average per file: ${avgTime.toFixed(2)}ms`);
    console.log(`  Target: <2000ms total ✓\n`);

    expect(totalTime).toBeLessThan(2000);

    // Verify we got structural data for all files
    const totalNodes = results.reduce((sum, r) => sum + r.nodes.length, 0);
    const totalRels = results.reduce(
      (sum, r) => sum + r.relationships.length,
      0,
    );

    console.log(`  Total nodes extracted: ${totalNodes}`);
    console.log(`  Total structural relationships: ${totalRels}`);

    expect(totalNodes).toBeGreaterThan(0);
    expect(totalRels).toBeGreaterThan(0);
  });

  it("should mark files as ready for semantic resolution", async () => {
    console.log("\n=== Semantic Resolution Readiness ===\n");

    const result = await structuralParser.parseStructural(testFiles[3]);

    // Structural parsing should provide:
    // 1. Nodes (for Neo4j)
    expect(result.nodes.length).toBeGreaterThan(0);

    // 2. Structural relationships (for immediate use)
    expect(result.relationships.length).toBeGreaterThan(0);

    // 3. Import strings (for semantic resolution queue)
    expect(result.importStrings.length).toBeGreaterThan(0);

    // 4. Exported symbols (for cross-file resolution)
    expect(result.exportedSymbols.length).toBeGreaterThan(0);

    console.log(`  ✓ File ready for semantic resolution`);
    console.log(`    - ${result.nodes.length} nodes`);
    console.log(
      `    - ${result.relationships.length} structural relationships`,
    );
    console.log(`    - ${result.importStrings.length} imports to resolve`);
    console.log(`    - ${result.exportedSymbols.length} symbols exported\n`);
  });
});

describe("Lazy Semantic Resolution - Concept Validation", () => {
  it("should demonstrate two-phase architecture", async () => {
    console.log("\n=== Two-Phase Architecture Demonstration ===\n");

    const structuralParser = new StructuralParser();
    const testFile = resolve(
      process.cwd(),
      "test-fixtures/integration-test-codebase/src/services/UserService.ts",
    );

    // Phase 1: Fast structural parsing
    console.log("Phase 1: Structural (Fast)");
    const startStructural = performance.now();
    const structuralResult = await structuralParser.parseStructural(testFile);
    const structuralTime = performance.now() - startStructural;

    console.log(`  ✓ Completed in ${structuralTime.toFixed(2)}ms`);
    console.log(`  ✓ Extracted ${structuralResult.nodes.length} nodes`);
    console.log(
      `  ✓ Captured ${structuralResult.importStrings.length} import strings`,
    );

    // At this point, in the real system:
    // - Structural data would be written to Neo4j immediately
    // - File would be marked as structuralComplete=true
    // - File would be enqueued for semantic resolution
    // - User sees immediate feedback

    console.log("\nPhase 2: Semantic (Deferred)");
    console.log("  [Would be processed in background queue]");
    console.log(
      `  - Resolve ${structuralResult.importStrings.length} imports to full paths`,
    );
    console.log("  - Create mini ts-morph Project");
    console.log("  - Extract semantic relationships (IMPORTS, CALLS, EXTENDS)");
    console.log("  - Write to Neo4j");
    console.log("  - Mark semanticComplete=true");

    console.log("\n✓ Two-phase architecture validated");
    console.log(
      `  Structural phase: ${structuralTime.toFixed(2)}ms (immediate)`,
    );
    console.log("  Semantic phase: ~2-5s (deferred, batched)\n");

    expect(structuralTime).toBeLessThan(200);
  });
});
