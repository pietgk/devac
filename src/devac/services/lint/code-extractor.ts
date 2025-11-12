// src/devac/services/lint/code-extractor.ts

import { readFile } from "fs/promises";

/**
 * Represents a single line in a code snippet
 */
export interface SnippetLine {
  line: number;
  text: string;
  highlight?: boolean;
}

/**
 * CodeExtractor - Extract code snippets with surrounding context
 *
 * Per spec v1.4.0:
 * - Extracts ±N lines around error location
 * - Formats as array of {line, text, highlight} objects
 * - Highlights the error line
 * - Handles edge cases (file start/end, missing files)
 */
export class CodeExtractor {
  /**
   * Extract code snippet around a specific line
   *
   * @param filePath - Absolute path to the source file
   * @param errorLine - Line number where error occurred (1-indexed)
   * @param contextLines - Number of lines to include before/after error (default: 5)
   * @returns Array of snippet lines, or undefined if file cannot be read
   */
  async extractSnippet(
    filePath: string,
    errorLine: number,
    contextLines: number = 5,
  ): Promise<SnippetLine[] | undefined> {
    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");

      // Calculate range (1-indexed line numbers)
      const startLine = Math.max(1, errorLine - contextLines);
      const endLine = Math.min(lines.length, errorLine + contextLines);

      // Extract snippet lines
      const snippet: SnippetLine[] = [];

      for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
        const lineIndex = lineNum - 1; // Convert to 0-indexed for array access
        const text = lines[lineIndex] || "";

        const snippetLine: SnippetLine = {
          line: lineNum,
          text: text,
        };

        // Only set highlight if true (omit if false to keep it undefined)
        if (lineNum === errorLine) {
          snippetLine.highlight = true;
        }

        snippet.push(snippetLine);
      }

      return snippet;
    } catch (error) {
      // File might not exist, be inaccessible, or have encoding issues
      // Return undefined to indicate snippet extraction failed
      return undefined;
    }
  }

  /**
   * Format snippet as human-readable text (for logging/debugging)
   *
   * @param snippet - Snippet lines to format
   * @returns Formatted string with line numbers and highlight marker
   */
  formatSnippet(snippet: SnippetLine[]): string {
    return snippet
      .map((line) => {
        const lineNum = line.line.toString().padStart(4, " ");
        const marker = line.highlight ? " >" : "  ";
        return `${lineNum}${marker} ${line.text}`;
      })
      .join("\n");
  }

  /**
   * Extract snippet and format as text in one call (convenience method)
   *
   * @param filePath - Absolute path to the source file
   * @param errorLine - Line number where error occurred (1-indexed)
   * @param contextLines - Number of lines to include before/after error
   * @returns Formatted snippet string, or undefined if extraction fails
   */
  async extractAndFormat(
    filePath: string,
    errorLine: number,
    contextLines: number = 5,
  ): Promise<string | undefined> {
    const snippet = await this.extractSnippet(
      filePath,
      errorLine,
      contextLines,
    );
    return snippet ? this.formatSnippet(snippet) : undefined;
  }
}
