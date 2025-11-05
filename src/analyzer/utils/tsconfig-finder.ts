import fs from "fs/promises";
import path from "path";
import { createContextLogger } from "../../utils/logger.js";

const logger = createContextLogger("TsConfigFinder");

/**
 * Cache for tsconfig paths to avoid redundant filesystem lookups.
 * Key: directory path
 * Value: tsconfig path (or null if not found)
 */
const tsconfigCache = new Map<string, string | null>();

/**
 * Finds the nearest tsconfig.json file by walking up the directory tree.
 *
 * @param filePath - The file path to start searching from
 * @param workspaceRoot - Optional workspace root to stop searching at
 * @returns The absolute path to the nearest tsconfig.json, or null if not found
 */
export async function findNearestTsConfig(
  filePath: string,
  workspaceRoot?: string,
): Promise<string | null> {
  const absoluteFilePath = path.resolve(filePath);
  let currentDir = path.dirname(absoluteFilePath);
  const rootDir = workspaceRoot ? path.resolve(workspaceRoot) : path.parse(currentDir).root;

  // Check cache first
  if (tsconfigCache.has(currentDir)) {
    return tsconfigCache.get(currentDir)!;
  }

  // Walk up the directory tree
  while (true) {
    const tsconfigPath = path.join(currentDir, "tsconfig.json");

    try {
      await fs.access(tsconfigPath);
      // tsconfig.json exists
      logger.debug(`Found tsconfig.json for ${filePath}: ${tsconfigPath}`);

      // Cache this result for the directory
      tsconfigCache.set(currentDir, tsconfigPath);

      return tsconfigPath;
    } catch {
      // tsconfig.json doesn't exist, move up one directory
    }

    // Check if we've reached the workspace root or filesystem root
    if (currentDir === rootDir || currentDir === path.parse(currentDir).root) {
      logger.debug(`No tsconfig.json found for ${filePath}`);
      tsconfigCache.set(currentDir, null);
      return null;
    }

    // Move up one directory
    const parentDir = path.dirname(currentDir);

    // Prevent infinite loop (shouldn't happen, but safety check)
    if (parentDir === currentDir) {
      logger.warn(`Reached filesystem root without finding tsconfig for ${filePath}`);
      tsconfigCache.set(currentDir, null);
      return null;
    }

    currentDir = parentDir;
  }
}

/**
 * Clears the tsconfig cache.
 * Useful when processing batches to free memory.
 */
export function clearTsConfigCache(): void {
  const cacheSize = tsconfigCache.size;
  tsconfigCache.clear();
  logger.debug(`Cleared tsconfig cache (${cacheSize} entries)`);
}

/**
 * Gets the current cache size (for monitoring/debugging).
 */
export function getTsConfigCacheSize(): number {
  return tsconfigCache.size;
}
