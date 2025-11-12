// src/devac/services/lint/__tests__/code-extractor.spec.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CodeExtractor } from "../code-extractor.js";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("CodeExtractor", () => {
  let extractor: CodeExtractor;
  let testFile: string;

  beforeEach(async () => {
    extractor = new CodeExtractor();

    // Create a temporary test file
    const testDir = join(tmpdir(), "code-extractor-test");
    await mkdir(testDir, { recursive: true });
    testFile = join(testDir, "test-file.ts");

    // Create a sample file with 20 lines
    const content = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}: Some code here`).join("\n");
    await writeFile(testFile, content, "utf-8");
  });

  afterEach(async () => {
    // Clean up test file
    try {
      await unlink(testFile);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  describe("extractSnippet", () => {
    it("should extract snippet with default context (±5 lines)", async () => {
      const snippet = await extractor.extractSnippet(testFile, 10, 5);

      expect(snippet).toBeDefined();
      expect(snippet).toHaveLength(11); // 5 before + 1 error line + 5 after

      // Check line numbers
      expect(snippet![0].line).toBe(5);
      expect(snippet![5].line).toBe(10); // Error line
      expect(snippet![10].line).toBe(15);

      // Check highlight
      expect(snippet![5].highlight).toBe(true);
      expect(snippet![0].highlight).toBeUndefined();
      expect(snippet![10].highlight).toBeUndefined();

      // Check text content
      expect(snippet![5].text).toBe("Line 10: Some code here");
    });

    it("should handle error at start of file", async () => {
      const snippet = await extractor.extractSnippet(testFile, 1, 5);

      expect(snippet).toBeDefined();
      expect(snippet).toHaveLength(6); // Line 1 + 5 after (can't go before line 1)

      expect(snippet![0].line).toBe(1);
      expect(snippet![0].highlight).toBe(true);
      expect(snippet![5].line).toBe(6);
    });

    it("should handle error at end of file", async () => {
      const snippet = await extractor.extractSnippet(testFile, 20, 5);

      expect(snippet).toBeDefined();
      expect(snippet).toHaveLength(6); // 5 before + line 20 (can't go after line 20)

      expect(snippet![0].line).toBe(15);
      expect(snippet![5].line).toBe(20);
      expect(snippet![5].highlight).toBe(true);
    });

    it("should handle small context window", async () => {
      const snippet = await extractor.extractSnippet(testFile, 10, 2);

      expect(snippet).toBeDefined();
      expect(snippet).toHaveLength(5); // 2 before + 1 error line + 2 after

      expect(snippet![0].line).toBe(8);
      expect(snippet![2].line).toBe(10);
      expect(snippet![2].highlight).toBe(true);
      expect(snippet![4].line).toBe(12);
    });

    it("should handle context window of 0", async () => {
      const snippet = await extractor.extractSnippet(testFile, 10, 0);

      expect(snippet).toBeDefined();
      expect(snippet).toHaveLength(1); // Just the error line

      expect(snippet![0].line).toBe(10);
      expect(snippet![0].highlight).toBe(true);
    });

    it("should return undefined for non-existent file", async () => {
      const snippet = await extractor.extractSnippet("/non/existent/file.ts", 10, 5);

      expect(snippet).toBeUndefined();
    });

    it("should handle empty lines", async () => {
      const contentWithEmpty = "Line 1\n\nLine 3\n\nLine 5";
      await writeFile(testFile, contentWithEmpty, "utf-8");

      const snippet = await extractor.extractSnippet(testFile, 3, 1);

      expect(snippet).toBeDefined();
      expect(snippet).toHaveLength(3);

      expect(snippet![0].text).toBe("");
      expect(snippet![1].text).toBe("Line 3");
      expect(snippet![1].highlight).toBe(true);
      expect(snippet![2].text).toBe("");
    });

    it("should preserve indentation and whitespace", async () => {
      const contentWithWhitespace = "  function test() {\n    return true;\n  }";
      await writeFile(testFile, contentWithWhitespace, "utf-8");

      const snippet = await extractor.extractSnippet(testFile, 2, 1);

      expect(snippet).toBeDefined();
      expect(snippet![0].text).toBe("  function test() {");
      expect(snippet![1].text).toBe("    return true;");
      expect(snippet![2].text).toBe("  }");
    });
  });

  describe("formatSnippet", () => {
    it("should format snippet with line numbers", () => {
      const snippet = [
        { line: 8, text: "const foo = 1;" },
        { line: 9, text: "const bar = 2;" },
        { line: 10, text: "const baz = foo + bar;", highlight: true },
        { line: 11, text: "console.log(baz);" },
      ];

      const formatted = extractor.formatSnippet(snippet);

      expect(formatted).toContain("   8   const foo = 1;");
      expect(formatted).toContain("   9   const bar = 2;");
      expect(formatted).toContain("  10 > const baz = foo + bar;");
      expect(formatted).toContain("  11   console.log(baz);");
    });

    it("should handle large line numbers", () => {
      const snippet = [
        { line: 9998, text: "line before" },
        { line: 9999, text: "error here", highlight: true },
        { line: 10000, text: "line after" },
      ];

      const formatted = extractor.formatSnippet(snippet);

      expect(formatted).toContain("9998   line before");
      expect(formatted).toContain("9999 > error here");
      expect(formatted).toContain("10000   line after");
    });

    it("should handle empty snippet", () => {
      const formatted = extractor.formatSnippet([]);

      expect(formatted).toBe("");
    });
  });

  describe("extractAndFormat", () => {
    it("should extract and format in one call", async () => {
      const formatted = await extractor.extractAndFormat(testFile, 10, 2);

      expect(formatted).toBeDefined();
      expect(formatted).toContain("   8   Line 8: Some code here");
      expect(formatted).toContain("   9   Line 9: Some code here");
      expect(formatted).toContain("  10 > Line 10: Some code here");
      expect(formatted).toContain("  11   Line 11: Some code here");
      expect(formatted).toContain("  12   Line 12: Some code here");
    });

    it("should return undefined for non-existent file", async () => {
      const formatted = await extractor.extractAndFormat("/non/existent/file.ts", 10, 5);

      expect(formatted).toBeUndefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle single-line file", async () => {
      await writeFile(testFile, "Single line only", "utf-8");

      const snippet = await extractor.extractSnippet(testFile, 1, 5);

      expect(snippet).toBeDefined();
      expect(snippet).toHaveLength(1);
      expect(snippet![0].line).toBe(1);
      expect(snippet![0].text).toBe("Single line only");
      expect(snippet![0].highlight).toBe(true);
    });

    it("should handle file with trailing newline", async () => {
      await writeFile(testFile, "Line 1\nLine 2\n", "utf-8");

      const snippet = await extractor.extractSnippet(testFile, 2, 1);

      expect(snippet).toBeDefined();
      expect(snippet).toHaveLength(3);
      expect(snippet![0].text).toBe("Line 1");
      expect(snippet![1].text).toBe("Line 2");
      expect(snippet![2].text).toBe(""); // Trailing newline creates empty line
    });

    it("should handle unicode characters", async () => {
      const unicodeContent = "const emoji = '🚀';\nconst chinese = '你好';\nconst math = 'π ≈ 3.14';";
      await writeFile(testFile, unicodeContent, "utf-8");

      const snippet = await extractor.extractSnippet(testFile, 2, 1);

      expect(snippet).toBeDefined();
      expect(snippet![0].text).toBe("const emoji = '🚀';");
      expect(snippet![1].text).toBe("const chinese = '你好';");
      expect(snippet![2].text).toBe("const math = 'π ≈ 3.14';");
    });
  });
});
