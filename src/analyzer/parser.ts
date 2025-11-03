// src/analyzer/parser.ts
import path from "path";
import fs from "fs/promises";
import { Project, ScriptKind } from "ts-morph";
import { FileInfo } from "../scanner/file-scanner.js";
import {
  AstNode,
  RelationshipInfo,
  SingleFileParseResult,
  FileNode,
} from "./types.js";
// Import FileNode
import { PythonAstParser } from "./python-parser.js";
import { CCppParser } from "./parsers/c-cpp-parser.js";
import { JavaParser } from "./parsers/java-parser.js";
import { GoParser } from "./parsers/go-parser.js";
import { CSharpParser } from "./parsers/csharp-parser.js";
// import { SqlParser } from './parsers/sql-parser.js'; // Temporarily disabled
// Import individual TS parsers
import { parseFunctions } from "./parsers/function-parser.js";
import { parseClasses } from "./parsers/class-parser.js";
import { parseVariables } from "./parsers/variable-parser.js";
import { parseInterfaces } from "./parsers/interface-parser.js";
import { parseTypeAliases } from "./parsers/type-alias-parser.js";
import { parseJsx } from "./parsers/jsx-parser.js";
import { parseImports } from "./parsers/import-parser.js";
import { PackageExtractor, PackageInfo } from "./parsers/package-extractor.js";
import { ImportResolver } from "./parsers/import-resolver.js";

import { createContextLogger } from "../utils/logger.js";
import { ParserError } from "../utils/errors.js";
import config from "../config/index.js";
import { generateEntityId, generateInstanceId } from "./parser-utils.js";
import ts from "typescript";

const logger = createContextLogger("Parser");

/**
 * Orchestrates the parsing process for different languages.
 */
export class Parser {
  private tsProject: Project;
  private pythonParser: PythonAstParser;
  private cppParser: CCppParser;
  private javaParser: JavaParser;
  private goParser: GoParser;
  private csharpParser: CSharpParser;
  private tsResults: Map<string, SingleFileParseResult> = new Map();
  private packageExtractor: PackageExtractor | null = null;
  private importResolver: ImportResolver | null = null;
  private packages: PackageInfo[] = [];
  private workspaceRoot: string = "";

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot
      ? path.resolve(workspaceRoot)
      : process.cwd();

    // Initialize Project using the main tsconfig.json
    this.tsProject = new Project({
      tsConfigFilePath: "tsconfig.json",
    });
    this.pythonParser = new PythonAstParser();
    this.cppParser = new CCppParser();
    this.javaParser = new JavaParser();
    this.goParser = new GoParser();
    this.csharpParser = new CSharpParser();

    logger.info("Parser initialized (SQL parser temporarily disabled).");
  }

  /**
   * Initializes package detection for the workspace.
   * Must be called before parseFiles to enable package boundaries.
   */
  async initializePackages(): Promise<void> {
    logger.info("Initializing package detection...");
    this.packageExtractor = new PackageExtractor(this.workspaceRoot);
    this.packages = await this.packageExtractor.discoverPackages();

    // Initialize ImportResolver with discovered packages
    const tsConfig = this.tsProject.getCompilerOptions();
    const paths = tsConfig.paths as Record<string, string[]> | undefined;

    this.importResolver = new ImportResolver(
      this.packages,
      this.workspaceRoot,
      paths,
    );

    logger.info(`Initialized with ${this.packages.length} packages`);
  }

  /**
   * Gets the ImportResolver instance
   */
  getImportResolver(): ImportResolver | null {
    return this.importResolver;
  }

  /**
   * Gets discovered packages
   */
  getPackages(): PackageInfo[] {
    return this.packages;
  }

  /**
   * Parses a list of files, delegating to the appropriate language parser.
   * For TS/JS files, it adds them to the ts-morph project but doesn't generate separate JSON.
   * @param files - An array of FileInfo objects.
   * @returns A promise that resolves when all files have been parsed (Pass 1).
   */
  async parseFiles(files: FileInfo[]): Promise<void> {
    logger.info(`Starting Pass 1 processing for ${files.length} files...`);
    const parsePromises: Promise<string | null>[] = [];
    // Store normalized paths of all files passed to this specific run
    const targetFilePaths = new Set(
      files.map((f) => path.resolve(f.path).replace(/\\/g, "/")),
    );

    const tsFilesToAdd: string[] = [];

    for (const file of files) {
      let parsePromise: Promise<string | null> | null = null;
      try {
        switch (file.extension) {
          case ".py":
            parsePromise = this.pythonParser.parseFile(file);
            break;
          case ".c":
          case ".cpp":
          case ".h":
          case ".hpp":
            parsePromise = this.cppParser.parseFile(file);
            break;
          case ".java":
            parsePromise = this.javaParser.parseFile(file);
            break;
          case ".go":
            parsePromise = this.goParser.parseFile(file);
            break;
          case ".cs":
            parsePromise = this.csharpParser.parseFile(file);
            break;
          // case '.sql': // Temporarily disabled
          //     parsePromise = this.sqlParser.parseFile(file);
          //     break;
          case ".ts":
          case ".tsx":
          case ".js":
          case ".jsx":
          case ".mjs":
          case ".cjs":
            // Add TS/JS files to the project instead of calling a separate parser
            logger.debug(`Adding TS/JS file to project: ${file.path}`);
            tsFilesToAdd.push(file.path);
            parsePromise = Promise.resolve(null); // No JSON file generated for TS/JS in Pass 1
            break;
          default:
            const supportedNonSql = config.supportedExtensions.filter(
              (ext) => ext !== ".sql",
            );
            if (!supportedNonSql.includes(file.extension)) {
              logger.warn(
                `Unsupported file type: ${file.extension} for ${file.path}`,
              );
            } else if (file.extension === ".sql") {
              logger.info(
                `Skipping SQL file due to parser being temporarily disabled: ${file.path}`,
              );
            }
            parsePromise = Promise.resolve(null);
        }
      } catch (error: any) {
        logger.error(
          `Error initiating processing for ${file.path}: ${error.message}`,
        );
        parsePromise = Promise.resolve(null);
      }
      if (parsePromise) {
        parsePromises.push(
          parsePromise.catch((err) => {
            logger.error(`Parsing failed for ${file.path}: ${err.message}`);
            return null;
          }),
        );
      }
    }

    if (tsFilesToAdd.length > 0) {
      this.tsProject.addSourceFilesAtPaths(tsFilesToAdd);
      logger.info(
        `Added ${tsFilesToAdd.length} TS/JS files to the ts-morph project.`,
      );
      // Now parse the added TS/JS files
      // Pass the set of target file paths to filter which sourceFiles get fully parsed
      await this._parseTsProjectFiles(targetFilePaths);
    }

    await Promise.all(parsePromises);
    logger.info("Pass 1 processing completed for all initiated files.");
  }

  /**
   * Collects all nodes and relationships from the temporary JSON files
   * generated during Pass 1 (for non-TS languages).
   * Uses Maps to ensure entityId uniqueness.
   * @returns An object containing arrays of all nodes and relationships.
   * Includes results from in-memory TS parsing.
   */
  async collectResults(): Promise<{
    allNodes: AstNode[];
    allRelationships: RelationshipInfo[];
  }> {
    logger.info("Starting collection of Pass 1 results (JSON + TS)...");
    const nodeMap = new Map<string, AstNode>(); // Use Map for nodes
    const relationshipMap = new Map<string, RelationshipInfo>(); // Use Map for relationships
    const tempDir = config.tempDir;

    try {
      const files = await fs.readdir(tempDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      logger.info(`Found ${jsonFiles.length} temporary JSON files to process.`);
      let processedJsonCount = 0;

      for (const file of jsonFiles) {
        processedJsonCount++;
        const filePath = path.join(tempDir, file);
        // logger.debug(`[collectResults] Processing JSON file ${processedJsonCount}/${jsonFiles.length}: ${file}`); // Removed log
        try {
          const content = await fs.readFile(filePath, "utf-8");
          const result: SingleFileParseResult = JSON.parse(content);
          // logger.debug(`[collectResults] Parsed JSON for: ${file} (Source Path: ${result.filePath})`); // Removed log

          if (result.filePath && result.nodes && result.relationships) {
            // Deduplicate nodes within this specific JSON file first
            const fileNodeMap = new Map<string, AstNode>();
            let intraFileDuplicates = 0;
            for (const node of result.nodes) {
              if (fileNodeMap.has(node.entityId)) {
                // logger.warn(`[collectResults] Intra-file duplicate node entityId found in ${result.filePath}: ${node.entityId} (Kind: ${node.kind})`); // Removed log
                intraFileDuplicates++;
              }
              fileNodeMap.set(node.entityId, node);
            }
            if (intraFileDuplicates > 0) {
              logger.warn(
                `[collectResults] Found ${intraFileDuplicates} intra-file duplicate nodes in ${result.filePath}.`,
              );
            }

            // Add unique nodes from this file to the main map
            for (const [entityId, node] of fileNodeMap.entries()) {
              if (nodeMap.has(entityId)) {
                const existingNode = nodeMap.get(entityId);
                if (node.kind === "File" && existingNode?.kind === "File") {
                  logger.warn(
                    `[collectResults] Overwriting File node with entityId: ${entityId} (Incoming: ${node.filePath}, Existing: ${existingNode?.filePath})`,
                  );
                } else if (existingNode?.filePath !== node.filePath) {
                  // logger.warn(`[collectResults] Cross-file duplicate node entityId (overwriting): ${entityId} (Kind: ${node.kind}, Incoming: ${node.filePath}, Existing: ${existingNode?.filePath})`); // Removed log
                }
              }
              nodeMap.set(entityId, node);
            }

            // Add relationships to map (duplicates less likely but handle anyway)
            for (const rel of result.relationships) {
              if (relationshipMap.has(rel.entityId)) {
                // logger.warn(`[collectResults] Overwriting relationship with duplicate entityId: ${rel.entityId} (Type: ${rel.type})`); // Removed log
              }
              relationshipMap.set(rel.entityId, rel);
            }
            // logger.debug(`[collectResults] Processed ${fileNodeMap.size} unique nodes and ${result.relationships.length} relationships from ${file}`); // Removed log
          } else {
            logger.warn(`Skipping invalid JSON structure in file: ${file}`);
          }
          await fs
            .unlink(filePath)
            .catch((err) =>
              logger.warn(
                `Failed to delete temp file ${filePath}: ${err.message}`,
              ),
            );
        } catch (error: any) {
          logger.error(
            `Error processing or deleting temp file ${filePath}: ${error.message}`,
          );
          try {
            await fs.unlink(filePath);
          } catch {
            /* ignore cleanup error */
          }
        }
      }

      // --- REMOVED TS/JS File Node Generation Logic ---
      // --- REMOVED Directory Node Generation Logic ---
    } catch (error: any) {
      logger.error(`Error reading temp directory ${tempDir}: ${error.message}`);
    }

    // Add results from in-memory TS parsing
    logger.info(
      `Adding results from ${this.tsResults.size} parsed TS/JS files...`,
    );
    for (const [filePath, result] of this.tsResults.entries()) {
      // Deduplicate nodes within this specific TS file result first
      const fileNodeMap = new Map<string, AstNode>();
      let intraFileDuplicates = 0;
      for (const node of result.nodes) {
        if (fileNodeMap.has(node.entityId)) {
          intraFileDuplicates++;
        }
        fileNodeMap.set(node.entityId, node);
      }
      if (intraFileDuplicates > 0) {
        logger.warn(
          `[collectResults-TS] Found ${intraFileDuplicates} intra-file duplicate nodes in ${filePath}.`,
        );
      }

      // Add unique nodes from this file to the main map
      for (const [entityId, node] of fileNodeMap.entries()) {
        if (nodeMap.has(entityId)) {
          logger.warn(
            `[collectResults-TS] Overwriting node with duplicate entityId: ${entityId} (Kind: ${node.kind}, File: ${node.filePath})`,
          );
        }
        nodeMap.set(entityId, node);
      }

      // Add relationships from this file to the main map
      for (const rel of result.relationships) {
        if (relationshipMap.has(rel.entityId)) {
          logger.warn(
            `[collectResults-TS] Overwriting relationship with duplicate entityId: ${rel.entityId} (Type: ${rel.type})`,
          );
        }
        relationshipMap.set(rel.entityId, rel);
      }
    }
    this.tsResults.clear(); // Clear memory after collection

    // Add Package nodes if packages were discovered
    if (this.packageExtractor && this.packages.length > 0) {
      const now = new Date().toISOString();
      const packageNodes = this.packageExtractor.createPackageNodes(now);

      for (const pkgNode of packageNodes) {
        if (!nodeMap.has(pkgNode.entityId)) {
          nodeMap.set(pkgNode.entityId, pkgNode);
        }
      }

      logger.info(`Added ${packageNodes.length} Package nodes`);

      // Create BELONGS_TO relationships between Files and Packages
      let belongsToCount = 0;
      for (const [entityId, node] of nodeMap.entries()) {
        if (
          node.kind === "File" &&
          node.properties &&
          node.properties.packageName
        ) {
          const packageName = node.properties.packageName;
          const pkgNode = packageNodes.find((p) => p.name === packageName);

          if (pkgNode) {
            const relEntityId = generateEntityId(
              "belongs_to",
              `${node.entityId}:${pkgNode.entityId}`,
            );
            const belongsToRel: RelationshipInfo = {
              id: `belongs_to_${node.id}_${pkgNode.id}`,
              entityId: relEntityId,
              type: "BELONGS_TO",
              sourceId: node.entityId,
              targetId: pkgNode.entityId,
              createdAt: now,
            };

            if (!relationshipMap.has(relEntityId)) {
              relationshipMap.set(relEntityId, belongsToRel);
              belongsToCount++;
            }
          }
        }
      }

      logger.info(`Created ${belongsToCount} BELONGS_TO relationships`);
    }

    const allNodes = Array.from(nodeMap.values());
    const allRelationships = Array.from(relationshipMap.values());

    logger.info(
      `Collected ${allNodes.length} unique nodes and ${allRelationships.length} unique relationships from all sources.`,
    );
    return { allNodes, allRelationships };
  }

  /**
   * Provides access to the ts-morph Project instance.
   * Useful for Pass 2 relationship resolution.
   */
  getTsProject(): Project {
    return this.tsProject;
  }

  /**
   * Parses all TypeScript/JavaScript SourceFile objects currently in the ts-morph project.
   * Only processes files whose paths are included in the targetFiles set.
   * @param targetFiles - A Set containing the normalized absolute paths of the files to be parsed.
   */
  private async _parseTsProjectFiles(targetFiles: Set<string>): Promise<void> {
    logger.info(
      `Starting TS/JS parsing. Project has ${this.tsProject.getSourceFiles().length} files. Filtering for ${targetFiles.size} target files.`,
    );
    const now = new Date().toISOString();
    const instanceCounter = { count: 0 }; // Simple counter for instance IDs per run

    for (const sourceFile of this.tsProject.getSourceFiles()) {
      const filePath = sourceFile.getFilePath().replace(/\\/g, "/"); // Normalize path
      logger.debug(`Parsing TS/JS file: ${filePath}`);

      // Only process files that were part of the initial target scan for this run
      if (!targetFiles.has(filePath)) {
        // logger.trace(`Skipping non-target TS/JS file: ${filePath}`); // Optional: trace logging
        continue;
      }

      // 1. Create FileNode
      const fileEntityId = generateEntityId("file", filePath);

      // Get package information if available
      const pkg = this.packageExtractor?.getPackageForFile(filePath);

      const fileNode: FileNode = {
        // Explicitly type as FileNode
        id: generateInstanceId(
          instanceCounter,
          "file",
          path.basename(filePath),
        ),
        entityId: fileEntityId,
        kind: "File",
        name: path.basename(filePath),
        filePath: filePath,
        language:
          sourceFile.getLanguageVariant() === ts.LanguageVariant.JSX
            ? "TSX"
            : "TypeScript", // Basic language detection
        startLine: 1,
        endLine: sourceFile.getEndLineNumber(),
        startColumn: 0,
        endColumn: 0,
        loc: sourceFile.getEndLineNumber(),
        properties: pkg ? { packageName: pkg.name } : undefined,
        createdAt: now,
      };

      // 2. Prepare result and context for this file
      const result: SingleFileParseResult = {
        filePath: filePath,
        nodes: [fileNode], // Start with the file node
        relationships: [],
      };

      const addNode = (node: AstNode) => {
        result.nodes.push(node);
      };
      const addRelationship = (rel: RelationshipInfo) => {
        result.relationships.push(rel);
      };

      const context = {
        // Create ParserContext
        filePath: filePath,
        sourceFile: sourceFile,
        fileNode: fileNode, // Pass the created FileNode
        result: result, // Pass the result object
        addNode: addNode,
        addRelationship: addRelationship,
        generateId: (
          prefix: string,
          identifier: string,
          options?: { line?: number; column?: number },
        ) => generateInstanceId(instanceCounter, prefix, identifier, options),
        generateEntityId: generateEntityId,
        logger: createContextLogger(`Parser-${path.basename(filePath)}`), // File-specific logger context
        resolveImportPath: (source: string, imp: string) => {
          /* TODO: Implement proper import resolution */ return imp;
        },
        now: now,
      };

      try {
        // 3. Call individual parsers
        parseImports(context); // Add call to import parser
        parseFunctions(context);
        parseClasses(context);
        parseVariables(context);
        parseInterfaces(context);
        parseTypeAliases(context);
        // Check language from the fileNode within the context
        if (context.fileNode.language === "TSX") {
          // Only parse JSX if applicable
          parseJsx(context);
        }
        // Call other parsers (e.g., parseExports)

        // Store the result for this file
        this.tsResults.set(filePath, result);
        logger.debug(
          `Finished parsing TS/JS file: ${filePath}. Nodes: ${result.nodes.length}, Rels: ${result.relationships.length}`,
        );
      } catch (error: any) {
        logger.error(`Error parsing TS/JS file ${filePath}: ${error.message}`, {
          stack: error.stack?.substring(0, 300),
        });
      }
    }
    logger.info(`Finished parsing ${targetFiles.size} target TS/JS files.`);
  }
}

// Helper function to ensure ts-morph compiler options are compatible
function ensureTsConfig(project: Project): void {
  const currentSettings = project.compilerOptions.get();
  if (!currentSettings.jsx) {
    project.compilerOptions.set({ jsx: ts.JsxEmit.React });
    logger.info("Set default JSX compiler option for ts-morph project.");
  }
}
