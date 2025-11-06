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
import {
  findNearestTsConfig,
  clearTsConfigCache,
} from "./utils/tsconfig-finder.js";
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
import { StorageManager } from "./storage-manager.js";

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
  private processedTsFiles: string[] = []; // Track TS files for Pass 2 repopulation
  private storageManager: StorageManager | null = null; // For streaming writes

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot
      ? path.resolve(workspaceRoot)
      : process.cwd();

    // Initialize Project using the main tsconfig.json
    // skipAddingFilesFromTsConfig: reduces memory by only loading files we explicitly add
    this.tsProject = new Project({
      tsConfigFilePath: "tsconfig.json",
      skipAddingFilesFromTsConfig: true,
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
   * Sets the StorageManager for streaming writes during batch processing
   */
  setStorageManager(storage: StorageManager): void {
    this.storageManager = storage;
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
      // Process TS/JS files in batches to avoid memory exhaustion
      // Adaptive batch sizing based on total file count
      // Reduced from 100 to 50 for better memory management (see TS_MORPH_PERFORMANCE_ANALYSIS.md)
      let BATCH_SIZE: number;
      if (tsFilesToAdd.length < 10000) {
        BATCH_SIZE = 50;
      } else if (tsFilesToAdd.length < 50000) {
        BATCH_SIZE = 40;
      } else {
        BATCH_SIZE = 30;
      }

      const batches = [];
      for (let i = 0; i < tsFilesToAdd.length; i += BATCH_SIZE) {
        batches.push(tsFilesToAdd.slice(i, i + BATCH_SIZE));
      }

      logger.info(
        `Processing ${tsFilesToAdd.length} TS/JS files in ${batches.length} batches of ${BATCH_SIZE} ` +
          `(adaptive sizing: ${tsFilesToAdd.length < 10000 ? "small" : tsFilesToAdd.length < 50000 ? "medium" : "large"} repo)`,
      );

      // Track all processed files for Pass 2 repopulation
      this.processedTsFiles = [...tsFilesToAdd];

      // Track timing for ETA calculation
      const batchTimes: number[] = [];
      const startTime = Date.now();

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        if (!batch || batch.length === 0) continue;

        const batchStartTime = Date.now();

        // Log progress more frequently for better visibility
        const shouldLogProgress =
          (i + 1) % 5 === 0 || i === 0 || i === batches.length - 1;

        if (shouldLogProgress) {
          // Calculate ETA based on average batch time
          let eta = "calculating...";
          if (batchTimes.length > 0) {
            const avgBatchTime =
              batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
            const remainingBatches = batches.length - (i + 1);
            const etaMs = avgBatchTime * remainingBatches;
            const etaMinutes = Math.ceil(etaMs / 60000);
            eta =
              etaMinutes > 0 ? `~${etaMinutes}m remaining` : "<1m remaining";
          }

          const memUsage = process.memoryUsage();
          const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
          const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

          logger.info(
            `📦 Batch ${i + 1}/${batches.length} (${Math.round(((i + 1) / batches.length) * 100)}%) - ` +
              `${batch.length} files | Memory: ${heapUsedMB}/${heapTotalMB}MB | ${eta}`,
          );
        }

        // Parse files ONE AT A TIME with individual Projects and timeouts
        // This prevents entire batch from hanging due to one slow file
        await this._parseFilesOneByOne(batch);

        // Write batch results to Neo4j immediately (streaming writes)
        if (this.storageManager) {
          await this.writeCurrentBatchToStorage();
        }

        // Clear tsconfig cache after each batch to prevent memory buildup
        clearTsConfigCache();

        // Force garbage collection after each batch if available (run with --expose-gc flag)
        if (global.gc) {
          global.gc();
        }

        // Track batch time for ETA
        const batchTime = Date.now() - batchStartTime;
        batchTimes.push(batchTime);

        // Keep only last 10 batch times for rolling average
        if (batchTimes.length > 10) {
          batchTimes.shift();
        }
      }

      const totalTime = Date.now() - startTime;
      const totalMinutes = Math.round(totalTime / 60000);
      logger.info(
        `✅ All ${tsFilesToAdd.length} TS/JS files processed in ${batches.length} batches ` +
          `(${totalMinutes}m ${Math.round((totalTime % 60000) / 1000)}s)`,
      );
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
   * Returns the list of TypeScript files that were processed in batches.
   * Used to repopulate the project for Pass 2.
   */
  getProcessedTsFiles(): string[] {
    return this.processedTsFiles;
  }

  /**
   * Re-adds all TypeScript files to the project for Pass 2 relationship resolution.
   * This is needed because batch processing removes files after parsing them.
   * @param filePaths - Array of file paths to add back
   */
  async repopulateProjectForPass2(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) {
      return;
    }

    logger.info(
      `Re-adding ${filePaths.length} TS/JS files for Pass 2 relationship resolution...`,
    );

    // Process in batches to avoid memory issues
    const BATCH_SIZE = 200; // Larger batch size for Pass 2 since we're just loading, not parsing
    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
      const batch = filePaths.slice(i, i + BATCH_SIZE);
      this.tsProject.addSourceFilesAtPaths(batch);

      if ((i + BATCH_SIZE) % 1000 === 0) {
        logger.info(
          `Re-added ${Math.min(i + BATCH_SIZE, filePaths.length)}/${filePaths.length} files...`,
        );
      }
    }

    logger.info(`All ${filePaths.length} TS/JS files re-added for Pass 2`);
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
    const FILE_PARSE_TIMEOUT_MS = 30000; // 30 seconds per file
    const failedFiles: string[] = [];
    const timeoutFiles: string[] = [];
    let successCount = 0;

    for (const sourceFile of this.tsProject.getSourceFiles()) {
      const filePath = sourceFile.getFilePath().replace(/\\/g, "/"); // Normalize path
      logger.debug(`Parsing TS/JS file: ${filePath}`);

      // Only process files that were part of the initial target scan for this run
      if (!targetFiles.has(filePath)) {
        // logger.trace(`Skipping non-target TS/JS file: ${filePath}`); // Optional: trace logging
        continue;
      }

      // 1. Create FileNode
      const filename = path.basename(filePath);
      const fileEntityId = generateEntityId("file", filePath, filename, 1, 0);

      // Get package information if available
      const pkg = this.packageExtractor?.getPackageForFile(filePath);

      const fileNode: FileNode = {
        // Explicitly type as FileNode
        id: generateInstanceId(instanceCounter, "file", filename),
        entityId: fileEntityId,
        kind: "File",
        name: filename,
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
        // 3. Call individual parsers with timeout protection
        await withTimeout(
          (async () => {
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
          })(),
          FILE_PARSE_TIMEOUT_MS,
          `File parsing timeout after ${FILE_PARSE_TIMEOUT_MS}ms`,
        );

        // Store the result for this file
        this.tsResults.set(filePath, result);
        successCount++;
        logger.debug(
          `Finished parsing TS/JS file: ${filePath}. Nodes: ${result.nodes.length}, Rels: ${result.relationships.length}`,
        );
      } catch (error: any) {
        if (error.message.includes("timeout")) {
          logger.warn(
            `⏱️  Timeout parsing file (${FILE_PARSE_TIMEOUT_MS}ms exceeded): ${filePath}`,
          );
          timeoutFiles.push(filePath);
        } else {
          logger.error(
            `❌ Error parsing TS/JS file ${filePath}: ${error.message}`,
            {
              stack: error.stack?.substring(0, 300),
            },
          );
          failedFiles.push(filePath);
        }
        // Continue processing other files despite the error
      }
    }

    // Log summary
    logger.info(
      `Finished parsing TS/JS files: ${successCount}/${targetFiles.size} successful, ` +
        `${timeoutFiles.length} timeouts, ${failedFiles.length} errors`,
    );

    if (timeoutFiles.length > 0) {
      logger.warn(`Files that timed out (${timeoutFiles.length}):`, {
        files: timeoutFiles.slice(0, 10),
      });
    }
    if (failedFiles.length > 0) {
      logger.warn(`Files that failed (${failedFiles.length}):`, {
        files: failedFiles.slice(0, 10),
      });
    }
  }

  /**
   * Parse TypeScript/JavaScript files ONE AT A TIME with individual Projects.
   * Each file gets its own Project instance with a timeout wrapper to prevent hangs.
   * This is slower due to Project instantiation overhead, but prevents one slow file from blocking the entire batch.
   *
   * @param filePaths - Array of file paths to parse
   */
  private async _parseFilesOneByOne(filePaths: string[]): Promise<void> {
    const FILE_PARSE_TIMEOUT_MS = 30000; // 30 seconds per file
    const PROJECT_CREATE_TIMEOUT_MS = 10000; // 10 seconds to create Project + add file
    const PROGRESS_LOG_INTERVAL = 10; // Log progress every 10 files
    const SLOW_FILE_THRESHOLD_MS = 5000; // Warn if file takes >5 seconds
    let successCount = 0;
    let timeoutCount = 0;
    let errorCount = 0;

    logger.info(
      `Parsing ${filePaths.length} files one-by-one with individual Projects...`,
    );

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i]!;
      const filePathNormalized = path.resolve(filePath).replace(/\\/g, "/");
      const startTime = Date.now();

      try {
        // Wrap Project creation and file parsing in timeout
        await withTimeout(
          (async () => {
            // Find the nearest tsconfig.json for this file
            // This ensures we use per-package tsconfig for accurate path resolution
            const nearestTsConfig = await findNearestTsConfig(
              filePath,
              this.workspaceRoot,
            );

            // Create individual Project for this one file
            // Use per-package tsconfig if found, otherwise fall back to minimal compiler options
            const fileProject = nearestTsConfig
              ? new Project({
                  tsConfigFilePath: nearestTsConfig,
                  skipAddingFilesFromTsConfig: true, // Don't load other files from tsconfig
                })
              : new Project({
                  compilerOptions: {
                    allowJs: true,
                    skipLibCheck: true,
                  },
                });

            // Add only this one file
            fileProject.addSourceFileAtPath(filePath);

            // Parse the single file
            const sourceFile = fileProject.getSourceFile(filePathNormalized);
            if (!sourceFile) {
              throw new Error(
                `Source file not found after adding: ${filePath}`,
              );
            }

            // Parse the file using existing logic
            await this._parseSingleSourceFile(sourceFile, filePathNormalized);

            // Clean up
            fileProject.removeSourceFile(sourceFile);

            successCount++;
          })(),
          PROJECT_CREATE_TIMEOUT_MS + FILE_PARSE_TIMEOUT_MS,
          `File processing timeout after ${PROJECT_CREATE_TIMEOUT_MS + FILE_PARSE_TIMEOUT_MS}ms: ${filePath}`,
        );

        // Log timing for slow files
        const duration = Date.now() - startTime;
        if (duration > SLOW_FILE_THRESHOLD_MS) {
          logger.warn(
            `⏱️ Slow file: ${path.basename(filePath)} took ${Math.round(duration / 1000)}s`,
          );
        }

        // Log progress at regular intervals
        if (
          (i + 1) % PROGRESS_LOG_INTERVAL === 0 ||
          i + 1 === filePaths.length
        ) {
          const percentComplete = Math.round(
            ((i + 1) / filePaths.length) * 100,
          );
          logger.info(
            `Progress: ${i + 1}/${filePaths.length} (${percentComplete}%) - ` +
              `Success: ${successCount}, Timeouts: ${timeoutCount}, Errors: ${errorCount}`,
          );
        }
      } catch (error: any) {
        if (error.message.includes("timeout")) {
          logger.warn(
            `⏱️ Timeout parsing file (${PROJECT_CREATE_TIMEOUT_MS + FILE_PARSE_TIMEOUT_MS}ms): ${filePath}`,
          );
          timeoutCount++;
        } else {
          logger.error(`❌ Error parsing file ${filePath}: ${error.message}`);
          errorCount++;
        }
        // Continue to next file
      }
    }

    logger.info(
      `Completed one-by-one parsing: ${successCount}/${filePaths.length} successful, ` +
        `${timeoutCount} timeouts, ${errorCount} errors`,
    );
  }

  /**
   * Parse a single TypeScript/JavaScript source file and extract AST nodes.
   * This is the core parsing logic extracted for reuse in per-file parsing.
   *
   * @param sourceFile - The ts-morph SourceFile to parse
   * @param filePath - The normalized file path
   */
  private async _parseSingleSourceFile(
    sourceFile: any,
    filePath: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const instanceCounter = { count: 0 };
    const filename = path.basename(filePath);
    const fileEntityId = generateEntityId("file", filePath, filename, 1, 0);

    // Get package information if available
    const pkg = this.packageExtractor?.getPackageForFile(filePath);

    const fileNode: FileNode = {
      id: generateInstanceId(instanceCounter, "file", filename),
      entityId: fileEntityId,
      kind: "File",
      name: filename,
      filePath: filePath,
      language:
        sourceFile.getLanguageVariant() === ts.LanguageVariant.JSX
          ? "TSX"
          : "TypeScript",
      startLine: 1,
      endLine: sourceFile.getEndLineNumber(),
      startColumn: 0,
      endColumn: 0,
      loc: sourceFile.getEndLineNumber(),
      properties: pkg ? { packageName: pkg.name } : undefined,
      createdAt: now,
    };

    const result: SingleFileParseResult = {
      filePath: filePath,
      nodes: [fileNode],
      relationships: [],
    };

    const addNode = (node: AstNode) => {
      result.nodes.push(node);
    };
    const addRelationship = (rel: RelationshipInfo) => {
      result.relationships.push(rel);
    };

    const context = {
      filePath: filePath,
      sourceFile: sourceFile,
      fileNode: fileNode,
      result: result,
      addNode: addNode,
      addRelationship: addRelationship,
      generateId: (
        prefix: string,
        identifier: string,
        options?: { line?: number; column?: number },
      ) => generateInstanceId(instanceCounter, prefix, identifier, options),
      generateEntityId: generateEntityId,
      logger: createContextLogger(`Parser-${path.basename(filePath)}`),
      resolveImportPath: (source: string, imp: string) => {
        return imp;
      },
      now: now,
    };

    // Parse with timeout
    await withTimeout(
      (async () => {
        parseImports(context);
        parseFunctions(context);
        parseClasses(context);
        parseVariables(context);
        parseInterfaces(context);
        parseTypeAliases(context);
        if (context.fileNode.language === "TSX") {
          parseJsx(context);
        }
      })(),
      30000,
      `File content parsing timeout: ${filePath}`,
    );

    // Store the result
    this.tsResults.set(filePath, result);
  }

  /**
   * Parse TypeScript/JavaScript files from a batch-specific Project instance.
   * This method is called for each batch to prevent memory accumulation.
   *
   * @param project - The ts-morph Project instance for this batch
   * @param targetFiles - A Set containing the normalized absolute paths of the files to be parsed.
   */
  private async _parseTsProjectFilesBatch(
    project: Project,
    targetFiles: Set<string>,
  ): Promise<void> {
    logger.info(
      `Starting TS/JS parsing. Project has ${project.getSourceFiles().length} files. Filtering for ${targetFiles.size} target files.`,
    );
    const now = new Date().toISOString();
    const instanceCounter = { count: 0 }; // Simple counter for instance IDs per run
    const FILE_PARSE_TIMEOUT_MS = 30000; // 30 seconds per file
    const failedFiles: string[] = [];
    const timeoutFiles: string[] = [];
    let successCount = 0;

    for (const sourceFile of project.getSourceFiles()) {
      const filePath = sourceFile.getFilePath().replace(/\\/g, "/"); // Normalize path
      logger.debug(`Parsing TS/JS file: ${filePath}`);

      // Only process files that were part of the initial target scan for this run
      if (!targetFiles.has(filePath)) {
        continue;
      }

      // 1. Create FileNode
      const filename = path.basename(filePath);
      const fileEntityId = generateEntityId("file", filePath, filename, 1, 0);

      // Get package information if available
      const pkg = this.packageExtractor?.getPackageForFile(filePath);

      const fileNode: FileNode = {
        id: generateInstanceId(instanceCounter, "file", filename),
        entityId: fileEntityId,
        kind: "File",
        name: filename,
        filePath: filePath,
        language:
          sourceFile.getLanguageVariant() === ts.LanguageVariant.JSX
            ? "TSX"
            : "TypeScript",
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
        nodes: [fileNode],
        relationships: [],
      };

      const addNode = (node: AstNode) => {
        result.nodes.push(node);
      };
      const addRelationship = (rel: RelationshipInfo) => {
        result.relationships.push(rel);
      };

      const context = {
        filePath: filePath,
        sourceFile: sourceFile,
        fileNode: fileNode,
        result: result,
        addNode: addNode,
        addRelationship: addRelationship,
        generateId: (
          prefix: string,
          identifier: string,
          options?: { line?: number; column?: number },
        ) => generateInstanceId(instanceCounter, prefix, identifier, options),
        generateEntityId: generateEntityId,
        logger: createContextLogger(`Parser-${path.basename(filePath)}`),
        resolveImportPath: (source: string, imp: string) => {
          return imp;
        },
        now: now,
      };

      try {
        // 3. Call individual parsers with timeout protection
        await withTimeout(
          (async () => {
            parseImports(context);
            parseFunctions(context);
            parseClasses(context);
            parseVariables(context);
            parseInterfaces(context);
            parseTypeAliases(context);
            if (context.fileNode.language === "TSX") {
              parseJsx(context);
            }
          })(),
          FILE_PARSE_TIMEOUT_MS,
          `File parsing timeout after ${FILE_PARSE_TIMEOUT_MS}ms`,
        );

        // Store the result for this file
        this.tsResults.set(filePath, result);
        successCount++;
        logger.debug(
          `Finished parsing TS/JS file: ${filePath}. Nodes: ${result.nodes.length}, Rels: ${result.relationships.length}`,
        );
      } catch (error: any) {
        if (error.message.includes("timeout")) {
          logger.warn(
            `⏱️  Timeout parsing file (${FILE_PARSE_TIMEOUT_MS}ms exceeded): ${filePath}`,
          );
          timeoutFiles.push(filePath);
        } else {
          logger.error(
            `❌ Error parsing TS/JS file ${filePath}: ${error.message}`,
            {
              stack: error.stack?.substring(0, 300),
            },
          );
          failedFiles.push(filePath);
        }
      }
    }

    // Log summary
    logger.info(
      `Finished parsing TS/JS files: ${successCount}/${targetFiles.size} successful, ` +
        `${timeoutFiles.length} timeouts, ${failedFiles.length} errors`,
    );

    if (timeoutFiles.length > 0) {
      logger.warn(`Files that timed out (${timeoutFiles.length}):`, {
        files: timeoutFiles.slice(0, 10),
      });
    }
    if (failedFiles.length > 0) {
      logger.warn(`Files that failed (${failedFiles.length}):`, {
        files: failedFiles.slice(0, 10),
      });
    }
  }

  /**
   * Write current batch results to storage (streaming writes).
   * Extracts nodes and relationships from tsResults and writes to Neo4j.
   * Clears tsResults after writing to free memory.
   */
  private async writeCurrentBatchToStorage(): Promise<void> {
    if (!this.storageManager) {
      throw new Error("StorageManager not initialized for streaming writes");
    }

    // Extract nodes and relationships from current batch
    const batchNodes: AstNode[] = [];
    const batchRels: RelationshipInfo[] = [];

    for (const result of this.tsResults.values()) {
      batchNodes.push(...result.nodes);
      batchRels.push(...result.relationships);
    }

    logger.info(
      `📝 Writing batch to Neo4j: ${batchNodes.length} nodes, ${batchRels.length} relationships`,
    );

    // Write nodes
    if (batchNodes.length > 0) {
      await this.storageManager.saveNodesBatch(batchNodes);
    }

    // Group relationships by type and write
    if (batchRels.length > 0) {
      const relsByType = this.groupRelationshipsByType(batchRels);
      for (const [type, rels] of Object.entries(relsByType)) {
        if (rels.length > 0) {
          await this.storageManager.saveRelationshipsBatch(type, rels);
        }
      }
    }

    // Clear memory immediately after writing
    this.tsResults.clear();

    logger.debug(`✅ Batch written and memory cleared`);
  }

  /**
   * Group relationships by their type for batch writing.
   * StorageManager requires relationships to be grouped by type.
   */
  private groupRelationshipsByType(
    rels: RelationshipInfo[],
  ): Record<string, RelationshipInfo[]> {
    return rels.reduce(
      (acc, rel) => {
        if (!acc[rel.type]) acc[rel.type] = [];
        acc[rel.type]!.push(rel);
        return acc;
      },
      {} as Record<string, RelationshipInfo[]>,
    );
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

/**
 * Wraps an async function with a timeout to prevent indefinite hanging.
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param timeoutError - Error message if timeout occurs
 * @returns The promise result or throws timeout error
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: string,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutError));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutHandle!);
    return result;
  } catch (error) {
    clearTimeout(timeoutHandle!);
    throw error;
  }
}
