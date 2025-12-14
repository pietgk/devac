/**
 * Integration tests for DevAC v2.0
 *
 * Tests the full pipeline: parse → write → read
 * Validates that the system works end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";

import { TypeScriptParser } from "../parsers/typescript-parser.js";
import { DuckDBPool } from "../storage/duckdb-pool.js";
import { SeedWriter } from "../storage/seed-writer.js";
import { SeedReader } from "../storage/seed-reader.js";
import { DEFAULT_PARSER_CONFIG } from "../parsers/parser-interface.js";

// Test fixtures path
const FIXTURES_DIR = path.join(__dirname, "fixtures");

describe("Integration: Parse → Write → Read Cycle", () => {
  let pool: DuckDBPool;
  let tempDir: string;

  beforeEach(async () => {
    // Create a fresh DuckDB pool for each test
    pool = new DuckDBPool({ memoryLimit: "256MB" });
    await pool.initialize();

    // Create a temp directory for seed files
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "devac-test-"));
  });

  afterEach(async () => {
    // Cleanup
    await pool.shutdown();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("parses a TypeScript file and extracts nodes", async () => {
    const parser = new TypeScriptParser();
    const filePath = path.join(FIXTURES_DIR, "sample-class.ts");

    const config = {
      ...DEFAULT_PARSER_CONFIG,
      repoName: "test-repo",
      packagePath: "test-package",
      branch: "main",
    };

    const result = await parser.parse(filePath, config);

    // Should have parsed successfully
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.filePath).toBe(filePath);
    expect(result.sourceFileHash).toBeTruthy();

    // Should have found key entities
    const nodeNames = result.nodes.map((n) => n.name);
    expect(nodeNames).toContain("UserService");
    expect(nodeNames).toContain("BaseService");
    expect(nodeNames).toContain("createUser");
    expect(nodeNames).toContain("validateUser");
  });

  it("parses and extracts class methods correctly", async () => {
    const parser = new TypeScriptParser();
    const filePath = path.join(FIXTURES_DIR, "sample-class.ts");

    const config = {
      ...DEFAULT_PARSER_CONFIG,
      repoName: "test-repo",
      packagePath: "test-package",
      branch: "main",
    };

    const result = await parser.parse(filePath, config);

    // Find UserService class methods
    const methodNodes = result.nodes.filter(
      (n) =>
        n.kind === "method" && n.qualified_name?.startsWith("UserService."),
    );

    const methodNames = methodNodes.map((n) => n.name);
    expect(methodNames).toContain("process");
    expect(methodNames).toContain("getUser");
  });

  it("extracts imports as external references", async () => {
    const parser = new TypeScriptParser();
    const filePath = path.join(FIXTURES_DIR, "sample-class.ts");

    const config = {
      ...DEFAULT_PARSER_CONFIG,
      repoName: "test-repo",
      packagePath: "test-package",
      branch: "main",
    };

    const result = await parser.parse(filePath, config);

    // Should have external references
    expect(result.externalRefs.length).toBeGreaterThan(0);

    // Should have found EventEmitter import
    const eventEmitterRef = result.externalRefs.find(
      (r) => r.imported_symbol === "EventEmitter",
    );
    expect(eventEmitterRef).toBeTruthy();
    expect(eventEmitterRef?.module_specifier).toBe("events");
  });

  it("extracts type-only imports correctly", async () => {
    const parser = new TypeScriptParser();
    const filePath = path.join(FIXTURES_DIR, "sample-class.ts");

    const config = {
      ...DEFAULT_PARSER_CONFIG,
      repoName: "test-repo",
      packagePath: "test-package",
      branch: "main",
    };

    const result = await parser.parse(filePath, config);

    // Should have type-only import for Readable
    const readableRef = result.externalRefs.find(
      (r) => r.imported_symbol === "Readable",
    );
    expect(readableRef).toBeTruthy();
    expect(readableRef?.is_type_only).toBe(true);
  });

  it("extracts edges (CONTAINS relationships)", async () => {
    const parser = new TypeScriptParser();
    const filePath = path.join(FIXTURES_DIR, "sample-class.ts");

    const config = {
      ...DEFAULT_PARSER_CONFIG,
      repoName: "test-repo",
      packagePath: "test-package",
      branch: "main",
    };

    const result = await parser.parse(filePath, config);

    // Should have CONTAINS edges
    const containsEdges = result.edges.filter(
      (e) => e.edge_type === "CONTAINS",
    );
    expect(containsEdges.length).toBeGreaterThan(0);

    // File should contain classes
    const fileNode = result.nodes.find((n) => n.kind === "module");
    expect(fileNode).toBeTruthy();

    const fileContainsClass = containsEdges.some(
      (e) => e.source_entity_id === fileNode?.entity_id,
    );
    expect(fileContainsClass).toBe(true);
  });

  it("generates unique entity IDs for all nodes", async () => {
    const parser = new TypeScriptParser();
    const filePath = path.join(FIXTURES_DIR, "sample-class.ts");

    const config = {
      ...DEFAULT_PARSER_CONFIG,
      repoName: "test-repo",
      packagePath: "test-package",
      branch: "main",
    };

    const result = await parser.parse(filePath, config);

    // All entity IDs should be unique
    const entityIds = result.nodes.map((n) => n.entity_id);
    const uniqueIds = new Set(entityIds);
    expect(uniqueIds.size).toBe(entityIds.length);
  });

  it("writes and reads seeds correctly", async () => {
    // Parse the file
    const parser = new TypeScriptParser();
    const filePath = path.join(FIXTURES_DIR, "sample-class.ts");

    const config = {
      ...DEFAULT_PARSER_CONFIG,
      repoName: "test-repo",
      packagePath: tempDir,
      branch: "main",
    };

    const parseResult = await parser.parse(filePath, config);

    // Write to seeds
    const writer = new SeedWriter(pool, tempDir);
    const writeResult = await writer.writeFile(parseResult);

    expect(writeResult.success).toBe(true);
    expect(writeResult.nodesWritten).toBeGreaterThan(0);

    // Read back from seeds
    const reader = new SeedReader(pool, tempDir);
    const nodesResult = await reader.readNodes();

    // Should have same number of nodes (result has .rows property)
    expect(nodesResult.rows.length).toBe(parseResult.nodes.length);

    // Check a specific node exists
    const userServiceNode = nodesResult.rows.find(
      (n) => n.name === "UserService",
    );
    expect(userServiceNode).toBeTruthy();
    expect(userServiceNode?.kind).toBe("class");
  });

  it("handles multiple file parsing", async () => {
    const parser = new TypeScriptParser();

    const config = {
      ...DEFAULT_PARSER_CONFIG,
      repoName: "test-repo",
      packagePath: "test-package",
      branch: "main",
    };

    // Parse both fixture files
    const result1 = await parser.parse(
      path.join(FIXTURES_DIR, "sample-class.ts"),
      config,
    );
    const result2 = await parser.parse(
      path.join(FIXTURES_DIR, "sample-functions.ts"),
      config,
    );

    // Both should have nodes
    expect(result1.nodes.length).toBeGreaterThan(0);
    expect(result2.nodes.length).toBeGreaterThan(0);

    // Entity IDs should be unique across files
    const allIds = [
      ...result1.nodes.map((n) => n.entity_id),
      ...result2.nodes.map((n) => n.entity_id),
    ];
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
  });

  it("handles parse errors gracefully", async () => {
    const parser = new TypeScriptParser();

    const config = {
      ...DEFAULT_PARSER_CONFIG,
      repoName: "test-repo",
      packagePath: "test-package",
      branch: "main",
    };

    // Create a file with syntax errors
    const badFile = path.join(tempDir, "bad.ts");
    await fs.writeFile(badFile, "export function { broken syntax");

    const result = await parser.parse(badFile, config);

    // Should not throw, but may have warnings or empty results
    expect(result).toBeTruthy();
    // Parser uses error recovery, so it might still parse something
  });
});

describe("Integration: Query Capabilities", () => {
  let pool: DuckDBPool;
  let tempDir: string;
  let reader: SeedReader;

  beforeEach(async () => {
    pool = new DuckDBPool({ memoryLimit: "256MB" });
    await pool.initialize();
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "devac-query-test-"));

    // Parse and write fixture file
    const parser = new TypeScriptParser();
    const filePath = path.join(FIXTURES_DIR, "sample-class.ts");

    const config = {
      ...DEFAULT_PARSER_CONFIG,
      repoName: "test-repo",
      packagePath: tempDir,
      branch: "main",
    };

    const parseResult = await parser.parse(filePath, config);
    const writer = new SeedWriter(pool, tempDir);
    await writer.writeFile(parseResult);

    reader = new SeedReader(pool, tempDir);
  });

  afterEach(async () => {
    await pool.shutdown();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("reads nodes and can filter by kind in memory", async () => {
    const nodesResult = await reader.readNodes();
    const classes = nodesResult.rows.filter((n) => n.kind === "class");
    const functions = nodesResult.rows.filter((n) => n.kind === "function");

    expect(classes.length).toBeGreaterThan(0);
    expect(functions.length).toBeGreaterThan(0);

    // All results should match the filter
    expect(classes.every((n) => n.kind === "class")).toBe(true);
    expect(functions.every((n) => n.kind === "function")).toBe(true);
  });

  it("reads edges and can filter by type in memory", async () => {
    const edgesResult = await reader.readEdges();
    const containsEdges = edgesResult.rows.filter(
      (e) => e.edge_type === "CONTAINS",
    );

    expect(containsEdges.length).toBeGreaterThan(0);
    expect(containsEdges.every((e) => e.edge_type === "CONTAINS")).toBe(true);
  });

  it("reads external references", async () => {
    const refsResult = await reader.readExternalRefs();

    expect(refsResult.rows.length).toBeGreaterThan(0);

    // Should include our imports
    const moduleSpecifiers = refsResult.rows.map((r) => r.module_specifier);
    expect(moduleSpecifiers).toContain("events");
    expect(moduleSpecifiers).toContain("stream");
  });

  it("executes custom SQL queries", async () => {
    const parquetPath = path.join(
      tempDir,
      ".devac",
      "seed",
      "base",
      "nodes.parquet",
    );
    const result = await reader.querySeeds<{ count: number }>(
      `SELECT COUNT(*) as count FROM read_parquet('${parquetPath}')`,
    );

    expect(result.rows.length).toBe(1);
    expect(Number(result.rows[0].count)).toBeGreaterThan(0);
  });
});
