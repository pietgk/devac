import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import fs from "fs/promises";
import { CCppParser } from "./c-cpp-parser.js"; // Adjust path as needed
import { FileInfo } from "../../scanner/file-scanner.js"; // Adjust path as needed
import { AstNode, RelationshipInfo, SingleFileParseResult } from "../types.js"; // Adjust path as needed
import config from "../../config/index.js"; // Adjust path as needed

// Helper to parse a fixture file and return the result
async function parseFixture(
  fixturePath: string,
): Promise<SingleFileParseResult> {
  const parser = new CCppParser();
  const absolutePath = path.resolve(process.cwd(), fixturePath);
  const fileInfo: FileInfo = {
    path: absolutePath,
    name: path.basename(fixturePath),
    extension: path.extname(fixturePath),
  };

  // Ensure temp dir exists (parser might rely on it)
  try {
    await fs.mkdir(config.tempDir, { recursive: true });
  } catch (e) {
    /* Ignore if exists */
  }

  const tempFilePath = await parser.parseFile(fileInfo);
  const resultJson = await fs.readFile(tempFilePath, "utf-8");
  await fs.unlink(tempFilePath); // Clean up temp file
  return JSON.parse(resultJson);
}

describe("CCppParser Unit Tests", () => {
  const fixtureDir = "test_fixtures/cpp/shape_calculator";

  it("should parse main.cpp and identify the File node", async () => {
    const fixturePath = path.join(fixtureDir, "src/main.cpp");
    const result = await parseFixture(fixturePath);
    const fileNode = result.nodes.find((n) => n.kind === "File");

    expect(fileNode).toBeDefined();
    expect(fileNode?.name).toBe("main.cpp");
    expect(fileNode?.language).toBe("C++");
    expect(fileNode?.filePath).toContain(fixturePath.replace(/\\/g, "/"));
  });

  it("should identify function definitions in main.cpp", async () => {
    const fixturePath = path.join(fixtureDir, "src/main.cpp");
    const result = await parseFixture(fixturePath);
    const funcNodes = result.nodes.filter((n) => n.kind === "CFunction"); // Using CFunction for now

    expect(funcNodes.length).toBe(2); // Corrected: printShapeInfo, main

    const printFunc = funcNodes.find((n) => n.name === "printShapeInfo");
    expect(printFunc).toBeDefined();
    expect(printFunc?.startLine).toBe(44); // Corrected: actual line in fixture

    const mainFunc = funcNodes.find((n) => n.name === "main");
    expect(mainFunc).toBeDefined();
    expect(mainFunc?.startLine).toBe(49); // Corrected: actual line in fixture
  });

  it("should identify #include directives in main.cpp", async () => {
    const fixturePath = path.join(fixtureDir, "src/main.cpp");
    const result = await parseFixture(fixturePath);
    const includeNodes = result.nodes.filter(
      (n) => n.kind === "IncludeDirective",
    );
    const includeRels = result.relationships.filter(
      (r) => r.type === "INCLUDES",
    );
    const fileNode = result.nodes.find((n) => n.kind === "File");

    expect(includeNodes.length).toBe(2); // Corrected: iostream, cmath
    expect(includeRels.length).toBe(2);

    const iostreamInclude = includeNodes.find(
      (n) => n.properties?.includePath === "iostream",
    );
    expect(iostreamInclude).toBeDefined();
    expect(iostreamInclude?.properties?.isSystemInclude).toBe(true);

    const cmathInclude = includeNodes.find(
      (n) => n.properties?.includePath === "cmath",
    );
    expect(cmathInclude).toBeDefined();
    expect(cmathInclude?.properties?.isSystemInclude).toBe(true);

    // Check relationship source
    expect(includeRels.every((r) => r.sourceId === fileNode?.entityId)).toBe(
      true,
    );
  });

  it("should identify class definitions in Circle.h", async () => {
    // Note: Current parser doesn't explicitly create CppClass nodes yet.
    // This test will fail until class parsing is implemented.
    const fixturePath = path.join(fixtureDir, "src/shapes/Circle.h");
    const result = await parseFixture(fixturePath);
    const classNode = result.nodes.find(
      (n) => n.kind === "CppClass" && n.name === "Circle",
    );

    expect(classNode).toBeDefined(); // This will fail initially
  });

  it("should identify method definitions in Circle.cpp", async () => {
    // Circle.cpp contains method implementations (not in class body, so parsed as CFunction)
    const fixturePath = path.join(fixtureDir, "src/shapes/Circle.cpp");
    const result = await parseFixture(fixturePath);
    const methodNodes = result.nodes.filter((n) => n.kind === "CFunction");

    expect(methodNodes.length).toBe(4); // Corrected: Constructor, area, perimeter, getType

    const areaMethod = methodNodes.find((n) => n.name === "area");
    expect(areaMethod).toBeDefined();
    expect(areaMethod?.startLine).toBe(6); // Corrected: actual line in fixture

    const constructorMethod = methodNodes.find((n) => n.name === "Circle");
    expect(constructorMethod).toBeDefined();
    expect(constructorMethod?.startLine).toBe(4); // Corrected: actual line in fixture
  });

  // Add more tests for other files, classes, relationships as parser evolves
});
