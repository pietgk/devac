/**
 * Unit tests for StructuralParser
 *
 * Tests the fast Babel-based AST parsing without type checking.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { StructuralParser } from "../structural-parser.js";
import { writeFile, mkdir, rm } from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test fixtures directory
const FIXTURES_DIR = path.join(__dirname, "__fixtures__", "structural-parser");

describe("StructuralParser", () => {
  let parser: StructuralParser;

  beforeEach(() => {
    parser = new StructuralParser();
  });

  // ==========================================================================
  // Basic Parsing Tests
  // ==========================================================================

  describe("parseStructural()", () => {
    it("should parse a simple TypeScript file", async () => {
      const testFile = path.join(FIXTURES_DIR, "simple.ts");
      await ensureFixtureFile(testFile, `
        export class MyClass {
          constructor() {}

          myMethod() {
            return "hello";
          }
        }
      `);

      const result = await parser.parseStructural(testFile);

      expect(result.filePath).toBe(testFile);
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.metadata.language).toBe("TypeScript");
      expect(result.metadata.parseTime).toBeLessThan(200); // <200ms target
    });

    it("should parse a file with functions", async () => {
      const testFile = path.join(FIXTURES_DIR, "functions.ts");
      await ensureFixtureFile(testFile, `
        export function greet(name: string): string {
          return \`Hello, \${name}\`;
        }

        const add = (a: number, b: number) => a + b;

        async function fetchData() {
          return await Promise.resolve("data");
        }
      `);

      const result = await parser.parseStructural(testFile);

      // Should have File node + 3 function nodes
      expect(result.nodes.length).toBe(4);

      // Check function nodes
      const funcNodes = result.nodes.filter(n => n.kind === "Function");
      expect(funcNodes.length).toBe(3);

      // Check one is async
      const asyncFunc = funcNodes.find(n => n.isAsync);
      expect(asyncFunc).toBeDefined();
      expect(asyncFunc!.name).toBe("fetchData");
    });

    it("should parse JSX/TSX files", async () => {
      const testFile = path.join(FIXTURES_DIR, "component.tsx");
      await ensureFixtureFile(testFile, `
        import React from "react";

        export const MyComponent = () => {
          return <div>Hello World</div>;
        };
      `);

      const result = await parser.parseStructural(testFile);

      expect(result.metadata.language).toBe("TypeScript");
      expect(result.importStrings).toContain("react");
    });
  });

  // ==========================================================================
  // Node Extraction Tests
  // ==========================================================================

  describe("Node Extraction", () => {
    it("should extract File node", async () => {
      const testFile = path.join(FIXTURES_DIR, "empty.ts");
      await ensureFixtureFile(testFile, "// Empty file");

      const result = await parser.parseStructural(testFile);

      const fileNode = result.nodes.find(n => n.kind === "File");
      expect(fileNode).toBeDefined();
      expect(fileNode!.name).toBe("empty.ts");
      expect(fileNode!.filePath).toBe(testFile);
      expect(fileNode!.entityId).toBe(`file:${testFile}`);
    });

    it("should extract Class nodes", async () => {
      const testFile = path.join(FIXTURES_DIR, "class.ts");
      await ensureFixtureFile(testFile, `
        export class UserService {
          private users: User[] = [];

          constructor() {}

          getUsers() {
            return this.users;
          }

          static create() {
            return new UserService();
          }
        }
      `);

      const result = await parser.parseStructural(testFile);

      const classNode = result.nodes.find(n => n.kind === "Class");
      expect(classNode).toBeDefined();
      expect(classNode!.name).toBe("UserService");
      expect(classNode!.kind).toBe("Class");

      // Should have 3 methods: constructor, getUsers, create
      const methodNodes = result.nodes.filter(n => n.kind === "Method");
      expect(methodNodes.length).toBe(3);

      // Check static method
      const staticMethod = methodNodes.find(m => m.isStatic);
      expect(staticMethod).toBeDefined();
      expect(staticMethod!.name).toBe("create");
    });

    it("should extract Method nodes with parent reference", async () => {
      const testFile = path.join(FIXTURES_DIR, "methods.ts");
      await ensureFixtureFile(testFile, `
        class Calculator {
          add(a: number, b: number) {
            return a + b;
          }
        }
      `);

      const result = await parser.parseStructural(testFile);

      const classNode = result.nodes.find(n => n.kind === "Class");
      const methodNode = result.nodes.find(n => n.kind === "Method");

      expect(methodNode).toBeDefined();
      expect(methodNode!.parentId).toBeDefined();
      expect(methodNode!.parentId).toContain(classNode!.entityId);
    });

    it("should extract arrow functions", async () => {
      const testFile = path.join(FIXTURES_DIR, "arrows.ts");
      await ensureFixtureFile(testFile, `
        const greet = (name: string) => \`Hello, \${name}\`;
        const add = (a: number, b: number) => a + b;

        export const asyncFetch = async () => {
          return await fetch("/api/data");
        };
      `);

      const result = await parser.parseStructural(testFile);

      const funcNodes = result.nodes.filter(n => n.kind === "Function");
      expect(funcNodes.length).toBe(3);

      const asyncFunc = funcNodes.find(n => n.name === "asyncFetch");
      expect(asyncFunc!.isAsync).toBe(true);
    });
  });

  // ==========================================================================
  // Relationship Extraction Tests
  // ==========================================================================

  describe("Relationship Extraction", () => {
    it("should extract CONTAINS relationships (File → Class)", async () => {
      const testFile = path.join(FIXTURES_DIR, "contains.ts");
      await ensureFixtureFile(testFile, `
        export class MyClass {}
      `);

      const result = await parser.parseStructural(testFile);

      const containsRel = result.relationships.find(
        r => r.type === "CONTAINS" && r.targetId.includes("class:")
      );

      expect(containsRel).toBeDefined();
      expect(containsRel!.type).toBe("CONTAINS");
      expect(containsRel!.sourceId).toContain("file:");
      expect(containsRel!.properties?.phase).toBe("structural");
    });

    it("should extract OWNS relationships (Class → Method)", async () => {
      const testFile = path.join(FIXTURES_DIR, "owns.ts");
      await ensureFixtureFile(testFile, `
        class MyClass {
          myMethod() {}
        }
      `);

      const result = await parser.parseStructural(testFile);

      const ownsRel = result.relationships.find(r => r.type === "OWNS");

      expect(ownsRel).toBeDefined();
      expect(ownsRel!.type).toBe("OWNS");
      expect(ownsRel!.sourceId).toContain("class:");
      expect(ownsRel!.targetId).toContain("method:");
    });

    it("should extract multiple CONTAINS relationships", async () => {
      const testFile = path.join(FIXTURES_DIR, "multiple.ts");
      await ensureFixtureFile(testFile, `
        export class ClassA {}
        export class ClassB {}
        export function funcA() {}
        export function funcB() {}
      `);

      const result = await parser.parseStructural(testFile);

      const containsRels = result.relationships.filter(r => r.type === "CONTAINS");
      expect(containsRels.length).toBe(4); // 2 classes + 2 functions
    });
  });

  // ==========================================================================
  // Import/Export Extraction Tests
  // ==========================================================================

  describe("Import/Export Extraction", () => {
    it("should extract import strings", async () => {
      const testFile = path.join(FIXTURES_DIR, "imports.ts");
      await ensureFixtureFile(testFile, `
        import React from "react";
        import { useState, useEffect } from "react";
        import * as utils from "./utils";
        import type { User } from "@/types";
      `);

      const result = await parser.parseStructural(testFile);

      expect(result.importStrings).toContain("react");
      expect(result.importStrings).toContain("./utils");
      expect(result.importStrings).toContain("@/types");
      expect(result.importStrings.length).toBe(4);
    });

    it("should extract named exports", async () => {
      const testFile = path.join(FIXTURES_DIR, "exports.ts");
      await ensureFixtureFile(testFile, `
        export class MyClass {}
        export function myFunc() {}
        export const myVar = 42;
      `);

      const result = await parser.parseStructural(testFile);

      expect(result.exportedSymbols.length).toBe(3);

      const classExport = result.exportedSymbols.find(e => e.name === "MyClass");
      expect(classExport).toBeDefined();
      expect(classExport!.kind).toBe("named");
      expect(classExport!.nodeKind).toBe("Class");
    });

    it("should extract default export", async () => {
      const testFile = path.join(FIXTURES_DIR, "default-export.ts");
      await ensureFixtureFile(testFile, `
        export default class MyClass {}
      `);

      const result = await parser.parseStructural(testFile);

      const defaultExport = result.exportedSymbols.find(e => e.kind === "default");
      expect(defaultExport).toBeDefined();
      expect(defaultExport!.name).toBe("MyClass");
    });

    it("should extract re-exports", async () => {
      const testFile = path.join(FIXTURES_DIR, "reexport.ts");
      await ensureFixtureFile(testFile, `
        export { MyClass, MyFunction } from "./other";
      `);

      const result = await parser.parseStructural(testFile);

      expect(result.importStrings).toContain("./other");
      expect(result.exportedSymbols.length).toBe(2);
    });
  });

  // ==========================================================================
  // Performance Tests
  // ==========================================================================

  describe("Performance", () => {
    it("should parse small file in <200ms", async () => {
      const testFile = path.join(FIXTURES_DIR, "perf-small.ts");
      await ensureFixtureFile(testFile, `
        export class SmallClass {
          method1() {}
          method2() {}
        }

        export function helper() {
          return "test";
        }
      `);

      const result = await parser.parseStructural(testFile);

      expect(result.metadata.parseTime).toBeLessThan(200);
    });

    it("should parse medium file in <200ms", async () => {
      const testFile = path.join(FIXTURES_DIR, "perf-medium.ts");

      // Generate medium-sized file (10 classes, 50 methods)
      const content = Array.from({ length: 10 }, (_, i) => `
        export class Class${i} {
          ${Array.from({ length: 5 }, (_, j) => `
            method${j}() {
              return ${i * j};
            }
          `).join("\n")}
        }
      `).join("\n");

      await ensureFixtureFile(testFile, content);

      const result = await parser.parseStructural(testFile);

      expect(result.metadata.parseTime).toBeLessThan(200);
      expect(result.nodes.length).toBeGreaterThan(50); // 1 file + 10 classes + 50 methods
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe("Error Handling", () => {
    it("should handle syntax errors gracefully", async () => {
      const testFile = path.join(FIXTURES_DIR, "syntax-error.ts");
      await ensureFixtureFile(testFile, `
        export class MyClass {
          // Missing closing brace
      `);

      // Should throw but with clear error message
      await expect(parser.parseStructural(testFile)).rejects.toThrow();
    });

    it("should handle empty files", async () => {
      const testFile = path.join(FIXTURES_DIR, "empty.ts");
      await ensureFixtureFile(testFile, "");

      const result = await parser.parseStructural(testFile);

      expect(result.nodes.length).toBe(1); // Just the File node
      expect(result.relationships.length).toBe(0);
    });

    it("should handle files with only comments", async () => {
      const testFile = path.join(FIXTURES_DIR, "comments.ts");
      await ensureFixtureFile(testFile, `
        // This is a comment
        /* Block comment */
        /**
         * JSDoc comment
         */
      `);

      const result = await parser.parseStructural(testFile);

      expect(result.nodes.length).toBe(1); // Just the File node
    });
  });

  // ==========================================================================
  // Metadata Tests
  // ==========================================================================

  describe("Metadata", () => {
    it("should calculate lines of code correctly", async () => {
      const testFile = path.join(FIXTURES_DIR, "loc.ts");
      const content = `
        line 1
        line 2
        line 3
      `.trim();
      await ensureFixtureFile(testFile, content);

      const result = await parser.parseStructural(testFile);

      expect(result.metadata.loc).toBe(3);
    });

    it("should detect TypeScript language", async () => {
      const testFile = path.join(FIXTURES_DIR, "test.ts");
      await ensureFixtureFile(testFile, "export class Test {}");

      const result = await parser.parseStructural(testFile);

      expect(result.metadata.language).toBe("TypeScript");
    });

    it("should detect JavaScript language", async () => {
      const testFile = path.join(FIXTURES_DIR, "test.js");
      await ensureFixtureFile(testFile, "export class Test {}");

      const result = await parser.parseStructural(testFile);

      expect(result.metadata.language).toBe("JavaScript");
    });

    it("should count nodes and relationships correctly", async () => {
      const testFile = path.join(FIXTURES_DIR, "counts.ts");
      await ensureFixtureFile(testFile, `
        export class MyClass {
          method1() {}
          method2() {}
        }
      `);

      const result = await parser.parseStructural(testFile);

      // 1 File + 1 Class + 2 Methods = 4 nodes
      expect(result.metadata.nodeCount).toBe(4);

      // 1 CONTAINS (File → Class) + 2 OWNS (Class → Methods) = 3 relationships
      expect(result.metadata.relationshipCount).toBe(3);
    });
  });
});

// ==========================================================================
// Helper Functions
// ==========================================================================

/**
 * Ensure fixture file exists with content
 */
async function ensureFixtureFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);

  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }

  await writeFile(filePath, content.trim(), "utf-8");
}
