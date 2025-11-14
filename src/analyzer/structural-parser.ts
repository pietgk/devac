/**
 * Structural Parser: Fast AST parsing without type checking
 *
 * Uses @babel/parser for speed, extracts only structural data.
 * Target: <200ms for typical file.
 *
 * Part of Lazy Semantic Resolution POC (Experiment 5)
 */

import { parse, type ParserOptions } from "@babel/parser";
import traverse from "@babel/traverse";
import type { File as BabelFile, Node as BabelNode } from "@babel/types";
import * as t from "@babel/types";
import { readFile } from "fs/promises";
import * as path from "path";
import { performance } from "perf_hooks";
import type { AstNode, RelationshipInfo } from "./types.js";
import { createContextLogger } from "../utils/logger.js";

const logger = createContextLogger("StructuralParser");

// ============================================================================
// Types
// ============================================================================

export interface StructuralParseResult {
  filePath: string;
  nodes: AstNode[];
  relationships: RelationshipInfo[];
  importStrings: string[]; // Unresolved import specifiers
  exportedSymbols: ExportedSymbol[]; // What this file exports
  metadata: {
    parseTime: number;
    nodeCount: number;
    relationshipCount: number;
    loc: number;
    language: string;
  };
}

export interface ExportedSymbol {
  name: string;
  kind: "default" | "named";
  nodeKind: string; // "Class", "Function", "Variable", etc.
  entityId?: string; // Link to actual node entity ID
}

// ============================================================================
// Babel Parser Configuration
// ============================================================================

const PARSER_OPTIONS: ParserOptions = {
  sourceType: "module",
  plugins: [
    "typescript",
    "jsx",
    "decorators-legacy",
    "classProperties",
    "classPrivateProperties",
    "classPrivateMethods",
    "exportDefaultFrom",
    "exportNamespaceFrom",
    "dynamicImport",
    "nullishCoalescingOperator",
    "optionalChaining",
    "optionalCatchBinding",
    "numericSeparator",
    "bigInt",
    "objectRestSpread",
    "asyncGenerators",
  ],
  errorRecovery: true, // Continue parsing even with syntax errors
};

// ============================================================================
// StructuralParser Class
// ============================================================================

export class StructuralParser {
  private instanceCounter = 0;

  /**
   * Parse file structure without type checking
   *
   * This is the main entry point for structural parsing.
   * It extracts nodes, relationships, imports, and exports using
   * fast Babel AST parsing (no ts-morph, no type checking).
   */
  async parseStructural(filePath: string): Promise<StructuralParseResult> {
    const startTime = performance.now();

    logger.debug(`Starting structural parse: ${filePath}`);

    // Read file
    const source = await readFile(filePath, "utf-8");
    const loc = source.split("\n").length;

    // Detect language
    const language = this.detectLanguage(filePath);

    // Fast parse (no type checking)
    let ast: BabelFile;
    try {
      ast = parse(source, PARSER_OPTIONS);
    } catch (error) {
      logger.error(`Parse error in ${filePath}:`, error);
      throw new Error(`Failed to parse ${filePath}: ${error.message}`);
    }

    // Initialize result
    const result: StructuralParseResult = {
      filePath,
      nodes: [],
      relationships: [],
      importStrings: [],
      exportedSymbols: [],
      metadata: {
        parseTime: 0,
        nodeCount: 0,
        relationshipCount: 0,
        loc,
        language,
      },
    };

    // Create file node
    const fileNode = this.createFileNode(filePath, source, language);
    result.nodes.push(fileNode);

    // Walk AST to extract nodes and relationships
    this.extractFromAST(ast, filePath, fileNode, result);

    // Calculate metadata
    result.metadata.parseTime = performance.now() - startTime;
    result.metadata.nodeCount = result.nodes.length;
    result.metadata.relationshipCount = result.relationships.length;

    logger.debug(
      `Structural parse complete: ${filePath} ` +
        `(${result.metadata.parseTime.toFixed(0)}ms, ` +
        `${result.metadata.nodeCount} nodes, ` +
        `${result.metadata.relationshipCount} rels)`,
    );

    return result;
  }

  /**
   * Extract nodes and relationships from Babel AST
   */
  private extractFromAST(
    ast: BabelFile,
    filePath: string,
    fileNode: AstNode,
    result: StructuralParseResult,
  ): void {
    // Map to track node entity IDs for relationship linking
    const nodeEntityIdMap = new Map<BabelNode, string>();

    traverse(ast, {
      // ========================================================================
      // Classes
      // ========================================================================
      ClassDeclaration: (path) => {
        const node = path.node;
        if (!node.id) return; // Anonymous class (rare)

        const classNode = this.createClassNode(node, filePath);
        result.nodes.push(classNode);
        nodeEntityIdMap.set(node, classNode.entityId);

        // CONTAINS relationship: File → Class
        result.relationships.push({
          id: this.generateId("rel"),
          entityId: this.generateEntityId(
            "rel",
            `${fileNode.entityId}:CONTAINS:${classNode.entityId}`,
          ),
          type: "CONTAINS",
          sourceId: fileNode.entityId,
          targetId: classNode.entityId,
          properties: { phase: "structural" },
          createdAt: new Date().toISOString(),
        });

        // Extract methods
        for (const member of node.body.body) {
          if (t.isClassMethod(member) && t.isIdentifier(member.key)) {
            const methodNode = this.createMethodNode(
              member,
              filePath,
              classNode.entityId,
            );
            result.nodes.push(methodNode);

            // OWNS relationship: Class → Method
            result.relationships.push({
              id: this.generateId("rel"),
              entityId: this.generateEntityId(
                "rel",
                `${classNode.entityId}:OWNS:${methodNode.entityId}`,
              ),
              type: "OWNS",
              sourceId: classNode.entityId,
              targetId: methodNode.entityId,
              properties: { phase: "structural" },
              createdAt: new Date().toISOString(),
            });
          }
        }
      },

      // ========================================================================
      // Functions
      // ========================================================================
      FunctionDeclaration: (path) => {
        const node = path.node;
        if (!node.id) return; // Anonymous function

        const funcNode = this.createFunctionNode(node, filePath);
        result.nodes.push(funcNode);
        nodeEntityIdMap.set(node, funcNode.entityId);

        // CONTAINS relationship: File → Function
        result.relationships.push({
          id: this.generateId("rel"),
          entityId: this.generateEntityId(
            "rel",
            `${fileNode.entityId}:CONTAINS:${funcNode.entityId}`,
          ),
          type: "CONTAINS",
          sourceId: fileNode.entityId,
          targetId: funcNode.entityId,
          properties: { phase: "structural" },
          createdAt: new Date().toISOString(),
        });
      },

      // Arrow functions (const x = () => {})
      VariableDeclarator: (path) => {
        const node = path.node;
        if (!t.isIdentifier(node.id)) return;
        if (
          !t.isArrowFunctionExpression(node.init) &&
          !t.isFunctionExpression(node.init)
        )
          return;

        const funcNode = this.createArrowFunctionNode(node, filePath);
        result.nodes.push(funcNode);

        // CONTAINS relationship: File → Function
        result.relationships.push({
          id: this.generateId("rel"),
          entityId: this.generateEntityId(
            "rel",
            `${fileNode.entityId}:CONTAINS:${funcNode.entityId}`,
          ),
          type: "CONTAINS",
          sourceId: fileNode.entityId,
          targetId: funcNode.entityId,
          properties: { phase: "structural" },
          createdAt: new Date().toISOString(),
        });
      },

      // ========================================================================
      // Imports (store as strings, not resolved)
      // ========================================================================
      ImportDeclaration: (path) => {
        const importString = path.node.source.value;
        result.importStrings.push(importString);

        logger.debug(`Import found: ${importString} in ${filePath}`);
      },

      // ========================================================================
      // Exports
      // ========================================================================
      ExportNamedDeclaration: (path) => {
        const node = path.node;

        // Track source for re-exports: export { X } from './other'
        if (node.source) {
          result.importStrings.push(node.source.value);
        }

        if (node.declaration) {
          // export class X {} or export function Y() {}
          const names = this.extractNamesFromDeclaration(node.declaration);
          for (const name of names) {
            result.exportedSymbols.push({
              name,
              kind: "named",
              nodeKind: this.getNodeKind(node.declaration),
            });
          }
        } else if (node.specifiers) {
          // export { X, Y }
          for (const specifier of node.specifiers) {
            if (
              t.isExportSpecifier(specifier) &&
              t.isIdentifier(specifier.exported)
            ) {
              result.exportedSymbols.push({
                name: specifier.exported.name,
                kind: "named",
                nodeKind: "Unknown", // Can't determine without type info
              });
            }
          }
        }
      },

      ExportDefaultDeclaration: (path) => {
        const node = path.node;
        const name = this.extractDefaultExportName(node.declaration);

        result.exportedSymbols.push({
          name,
          kind: "default",
          nodeKind: this.getNodeKind(node.declaration),
        });
      },

      // Handle export * from './other'
      ExportAllDeclaration: (path) => {
        const node = path.node;
        if (node.source) {
          result.importStrings.push(node.source.value);
        }
      },
    });
  }

  // ==========================================================================
  // Node Creation Helpers
  // ==========================================================================

  /**
   * Create File node
   */
  private createFileNode(
    filePath: string,
    source: string,
    language: string,
  ): AstNode {
    const loc = source.split("\n").length;

    return {
      id: this.generateId("node"),
      entityId: `file:${filePath}`,
      kind: "File",
      name: path.basename(filePath),
      filePath,
      startLine: 1,
      endLine: loc,
      startColumn: 0,
      endColumn: 0,
      language,
      loc,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Create Class node
   */
  private createClassNode(node: t.ClassDeclaration, filePath: string): AstNode {
    const name = node.id!.name;
    const loc = node.loc;

    return {
      id: this.generateId("node"),
      entityId: this.generateEntityId(
        "class",
        `${filePath}:${name}:${loc?.start.line}`,
      ),
      kind: "Class",
      name,
      filePath,
      startLine: loc?.start.line ?? 0,
      endLine: loc?.end.line ?? 0,
      startColumn: loc?.start.column ?? 0,
      endColumn: loc?.end.column ?? 0,
      language: this.detectLanguage(filePath),
      isAbstract: node.abstract ?? false,
      isExported: false, // Will be updated if we find an export
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Create Method node
   */
  private createMethodNode(
    node: t.ClassMethod,
    filePath: string,
    parentClassId: string,
  ): AstNode {
    const name = t.isIdentifier(node.key) ? node.key.name : "unknown";
    const loc = node.loc;

    return {
      id: this.generateId("node"),
      entityId: this.generateEntityId(
        "method",
        `${parentClassId}:${name}:${loc?.start.line}`,
      ),
      kind: "Method",
      name,
      filePath,
      startLine: loc?.start.line ?? 0,
      endLine: loc?.end.line ?? 0,
      startColumn: loc?.start.column ?? 0,
      endColumn: loc?.end.column ?? 0,
      language: this.detectLanguage(filePath),
      parentId: parentClassId,
      isStatic: node.static ?? false,
      isAsync: node.async ?? false,
      isGenerator: node.generator ?? false,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Create Function node (for function declarations)
   */
  private createFunctionNode(
    node: t.FunctionDeclaration,
    filePath: string,
  ): AstNode {
    const name = node.id!.name;
    const loc = node.loc;

    return {
      id: this.generateId("node"),
      entityId: this.generateEntityId(
        "function",
        `${filePath}:${name}:${loc?.start.line}`,
      ),
      kind: "Function",
      name,
      filePath,
      startLine: loc?.start.line ?? 0,
      endLine: loc?.end.line ?? 0,
      startColumn: loc?.start.column ?? 0,
      endColumn: loc?.end.column ?? 0,
      language: this.detectLanguage(filePath),
      isAsync: node.async ?? false,
      isGenerator: node.generator ?? false,
      isExported: false, // Will be updated if we find an export
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Create Function node (for arrow functions / const x = () => {})
   */
  private createArrowFunctionNode(
    node: t.VariableDeclarator,
    filePath: string,
  ): AstNode {
    const name = t.isIdentifier(node.id) ? node.id.name : "unknown";
    const loc = node.loc;
    const funcNode = node.init as
      | t.ArrowFunctionExpression
      | t.FunctionExpression;

    return {
      id: this.generateId("node"),
      entityId: this.generateEntityId(
        "function",
        `${filePath}:${name}:${loc?.start.line}`,
      ),
      kind: "Function",
      name,
      filePath,
      startLine: loc?.start.line ?? 0,
      endLine: loc?.end.line ?? 0,
      startColumn: loc?.start.column ?? 0,
      endColumn: loc?.end.column ?? 0,
      language: this.detectLanguage(filePath),
      isAsync: funcNode.async ?? false,
      isExported: false,
      createdAt: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Detect programming language from file extension
   */
  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath);

    switch (ext) {
      case ".ts":
      case ".tsx":
        return "TypeScript";
      case ".js":
      case ".jsx":
        return "JavaScript";
      case ".mjs":
        return "JavaScript";
      default:
        return "Unknown";
    }
  }

  /**
   * Extract names from a declaration (for exports)
   */
  private extractNamesFromDeclaration(declaration: BabelNode): string[] {
    if (t.isClassDeclaration(declaration) && declaration.id) {
      return [declaration.id.name];
    }
    if (t.isFunctionDeclaration(declaration) && declaration.id) {
      return [declaration.id.name];
    }
    if (t.isVariableDeclaration(declaration)) {
      return declaration.declarations
        .filter((d) => t.isIdentifier(d.id))
        .map((d) => (d.id as t.Identifier).name);
    }
    return [];
  }

  /**
   * Extract default export name
   */
  private extractDefaultExportName(declaration: BabelNode): string {
    if (t.isClassDeclaration(declaration) && declaration.id) {
      return declaration.id.name;
    }
    if (t.isFunctionDeclaration(declaration) && declaration.id) {
      return declaration.id.name;
    }
    if (t.isIdentifier(declaration)) {
      return declaration.name;
    }
    return "default";
  }

  /**
   * Get node kind from declaration
   */
  private getNodeKind(declaration: BabelNode): string {
    if (t.isClassDeclaration(declaration)) return "Class";
    if (t.isFunctionDeclaration(declaration)) return "Function";
    if (t.isVariableDeclaration(declaration)) return "Variable";
    return "Unknown";
  }

  /**
   * Generate unique instance ID
   */
  private generateId(prefix: string): string {
    return `${prefix}-${++this.instanceCounter}`;
  }

  /**
   * Generate globally unique entity ID
   */
  private generateEntityId(kind: string, qualifiedName: string): string {
    return `${kind}:${qualifiedName}`;
  }
}
