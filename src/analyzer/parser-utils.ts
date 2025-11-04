import * as path from "path";
import * as crypto from "crypto";
import fsPromises from "fs/promises";
import * as fsSync from "fs"; // Keep sync version for path resolution checks
import { FileSystemError } from "../utils/errors.js";
import { InstanceCounter } from "./types.js";
import config from "../config/index.js"; // Import config for TEMP_DIR

const TEMP_DIR = config.tempDir; // Use tempDir from config

/**
 * Ensures the temporary directory for intermediate results exists.
 */
export async function ensureTempDir(): Promise<void> {
  try {
    await fsPromises.mkdir(TEMP_DIR, { recursive: true });
  } catch (error: any) {
    throw new FileSystemError(
      `Failed to create temporary directory: ${TEMP_DIR}`,
      { originalError: error },
    );
  }
}

/**
 * Generates a unique temporary file path based on the source file path hash.
 * @param sourceFilePath - The absolute path of the source file.
 * @returns The absolute path for the temporary JSON file.
 */
export function getTempFilePath(sourceFilePath: string): string {
  // Normalize path before hashing for consistency
  const normalizedPath = sourceFilePath.replace(/\\/g, "/");
  const hash = crypto.createHash("sha256").update(normalizedPath).digest("hex");
  return path.join(TEMP_DIR, `${hash}.json`);
}

/**
 * Resolves a relative import path to an absolute path, attempting to find the correct file extension.
 * @param sourcePath - The absolute path of the file containing the import.
 * @param importPath - The relative or module path string from the import statement.
 * @returns The resolved absolute path or the original importPath if it's likely a node module or alias.
 */
export function resolveImportPath(
  sourcePath: string,
  importPath: string,
): string {
  // If it's not a relative path, assume it's a node module or alias (handled later by resolver)
  if (!importPath.startsWith(".")) {
    return importPath;
  }

  const sourceDir = path.dirname(sourcePath);
  // Remove .js/.jsx extension if present, as we want to find the .ts/.tsx source
  const importPathWithoutJsExt = importPath.replace(/\.jsx?$/i, "");
  let resolvedPath = path.resolve(sourceDir, importPathWithoutJsExt);

  // Attempt to resolve extension if missing
  if (!path.extname(resolvedPath)) {
    const extensions = config.supportedExtensions; // Use extensions from config
    let found = false;
    // Check for file with extension
    for (const ext of extensions) {
      try {
        if (fsSync.statSync(resolvedPath + ext).isFile()) {
          resolvedPath += ext;
          found = true;
          break;
        }
      } catch {
        /* Ignore */
      }
    }
    // Check for index file in directory if file wasn't found directly
    if (!found) {
      for (const ext of extensions) {
        const indexPath = path.join(resolvedPath, `index${ext}`);
        try {
          if (fsSync.statSync(indexPath).isFile()) {
            resolvedPath = indexPath;
            found = true;
            break;
          }
        } catch {
          /* Ignore */
        }
      }
    }
    // If still not found, return the original resolved path without extension.
    // The relationship resolver might handle this later based on available nodes.
  }
  // Normalize path separators for consistency
  return resolvedPath.replace(/\\/g, "/");
}

/**
 * LEGACY: Generates entity ID using old format (for reference during migration).
 * This function will be removed after full migration to hybrid format.
 * @deprecated Use generateEntityId() or generateSimpleEntityId() instead
 */
export function generateEntityIdLegacy(
  prefix: string,
  qualifiedName: string,
): string {
  if (!prefix || !qualifiedName) {
    console.warn(
      `generateEntityIdLegacy called with empty prefix or qualifiedName. Prefix: ${prefix}, QN: ${qualifiedName}`,
    );
    return `${prefix || "unknown"}:unknown:${Date.now()}`;
  }

  // Parse qualified name to extract components for new format
  // Expected formats: "filepath:name" or "filepath:name:line" or "filepath:Parent.method"
  const parts = qualifiedName.split(":");

  if (parts.length < 2) {
    console.warn(`generateEntityIdLegacy: unexpected format: ${qualifiedName}`);
    return `${prefix}:${qualifiedName}#${Date.now()}`;
  }

  const filepath = parts[0].replace(/\\/g, "/");
  let name = parts[1];
  let line = 1;
  let column = 0;

  // If third part exists and is a number, use it as line number
  if (parts.length >= 3 && !isNaN(parseInt(parts[2]))) {
    line = parseInt(parts[2]);
  } else if (parts.length >= 3) {
    // Not a number, concatenate to name
    name = parts.slice(1).join(":");
  }

  // Call new hybrid format
  return generateEntityId(prefix, filepath, name, line, column);
}

/**
 * Generates a hybrid entity ID - supports both legacy and new signatures.
 *
 * Format: {prefix}:{filepath}:{name}:{signature_hint}#{hash}
 *
 * Examples:
 *   - function:/src/utils.ts:process:(string)#a7f3e9c2
 *   - function:/src/utils.ts:process:(number)#b8e4f0c3
 *   - method:/src/User.ts:UserService.getUser#c9f5e1d4
 *   - function:/src/app.ts:callback_map_arg0#d0a6f3a5
 *
 * The hash ensures uniqueness even for:
 *   - Function overloading (same name, different signatures)
 *   - Anonymous functions (same name, different locations)
 *   - Nested entities (same name, different parent contexts)
 */

// Legacy signature for backward compatibility
export function generateEntityId(prefix: string, qualifiedName: string): string;

// New signature with full parameters
export function generateEntityId(
  prefix: string,
  filepath: string,
  name: string,
  line: number,
  column: number,
  signatureHint?: string,
  fullSignature?: string,
): string;

// Implementation
export function generateEntityId(
  prefix: string,
  filepathOrQualifiedName: string,
  name?: string,
  line?: number,
  column?: number,
  signatureHint?: string,
  fullSignature?: string,
): string {
  // Detect which signature was used
  if (arguments.length === 2) {
    // Legacy signature: generateEntityId(prefix, qualifiedName)
    return generateEntityIdLegacy(prefix, filepathOrQualifiedName);
  }

  // New signature - validate required params
  const filepath = filepathOrQualifiedName;
  if (
    !prefix ||
    !filepath ||
    !name ||
    line === undefined ||
    column === undefined
  ) {
    console.warn(`generateEntityId missing required params`, {
      prefix,
      filepath,
      name,
      line,
      column,
    });
    return `${prefix || "unknown"}:unknown:${Date.now()}`;
  }

  // Continue with new implementation below

  // Normalize filepath (forward slashes only)
  const normalizedPath = filepath.replace(/\\/g, "/");

  // Build hash components for guaranteed uniqueness
  // Hash includes: path, name, location, and signature
  const hashComponents = [
    normalizedPath,
    name,
    line.toString(),
    column.toString(),
    fullSignature || signatureHint || "",
  ].join("::");

  // Generate 8-character hash (sufficient for uniqueness in most projects)
  // Using first 8 chars of SHA-256 provides ~4.3 billion unique combinations
  const hash = crypto
    .createHash("sha256")
    .update(hashComponents)
    .digest("hex")
    .substring(0, 8);

  // Build human-readable prefix parts
  const readableParts: string[] = [normalizedPath, name];

  // Add signature hint if provided (for overloaded functions)
  if (signatureHint) {
    readableParts.push(signatureHint);
  }

  const readablePrefix = readableParts.join(":");

  // Combine: prefix:readable#hash
  return `${prefix.toLowerCase()}:${readablePrefix}#${hash}`;
}

/**
 * Generates entity ID for entities without signatures (classes, interfaces, variables, etc.)
 * Convenience wrapper around generateEntityId() for simpler cases.
 *
 * @param prefix - Entity type (class, interface, variable, etc.)
 * @param filepath - Normalized file path
 * @param name - Entity name
 * @param line - Start line number
 * @param column - Start column number
 * @returns Hybrid entity ID string
 */
export function generateSimpleEntityId(
  prefix: string,
  filepath: string,
  name: string,
  line: number,
  column: number,
): string {
  return generateEntityId(prefix, filepath, name, line, column);
}

/**
 * Generates a unique instance ID for a node or relationship within the context of a single file parse.
 * Primarily used for temporary identification during parsing.
 * @param instanceCounter - The counter object for the current file parse.
 * @param prefix - The type of the element (e.g., 'class', 'function', 'calls'). Lowercase.
 * @param identifier - A descriptive identifier (e.g., qualified name, source:target).
 * @param options - Optional line and column numbers for added uniqueness context.
 * @returns The generated instance ID string.
 */
export function generateInstanceId(
  instanceCounter: InstanceCounter,
  prefix: string,
  identifier: string,
  options: { line?: number; column?: number } = {},
): string {
  if (!prefix || !identifier) {
    console.warn(
      `generateInstanceId called with empty prefix or identifier. Prefix: ${prefix}, ID: ${identifier}`,
    );
  }
  const safeIdentifier = identifier
    .replace(/\\/g, "/")
    .replace(/[^a-zA-Z0-9_.:/-]/g, "_");

  let contextSuffix = "";
  // Include line/column if available for better debugging/uniqueness
  if (options.line !== undefined) contextSuffix += `:L${options.line}`;
  if (options.column !== undefined) contextSuffix += `:C${options.column}`;

  const counter = ++instanceCounter.count; // Increment counter for uniqueness within the file
  // Format: type:identifier:Lline:Ccol:counter
  const id = `${prefix}:${safeIdentifier}${contextSuffix}:${counter}`;
  return id;
}
