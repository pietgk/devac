/**
 * DevAC v2.0 - Federated Architecture
 *
 * DuckDB + Parquet based code analysis system.
 * Replaces Neo4j with file-based storage.
 *
 * @module devac-v2
 */

// Types (base types)
export * from "./types/index.js";

// Storage (excludes StructuralParseResult which is re-exported from parsers)
export {
  DuckDBPool,
  isFatalError,
  executeWithRecovery,
  getDefaultPool,
  shutdownDefaultPool,
  NODES_SCHEMA,
  EDGES_SCHEMA,
  EXTERNAL_REFS_SCHEMA,
  INDEXES,
  PARQUET_OPTIONS,
  initializeSchemas,
  getCopyToParquet,
  getReadFromParquet,
  getUnifiedQuery,
  acquireLock,
  releaseLock,
  isLockStale,
  withLock,
  withSeedLock,
  getLockInfo,
  forceReleaseLock,
  SeedWriter,
  createSeedWriter,
  SeedReader,
  createSeedReader,
  queryMultiplePackages,
} from "./storage/index.js";
export type {
  PoolStats,
  PoolConfig,
  LockInfo,
  LockOptions,
  WriteOptions,
  WriteResult,
  QueryResult,
  IntegrityResult,
} from "./storage/index.js";

// Analyzer (excludes generateScopeHash which conflicts with utils)
export {
  generateEntityId,
  normalizeComponent,
  normalizePathComponent,
  parseEntityId,
  isValidEntityId,
  entityIdsMatch,
  getRepoFromEntityId,
  getPackagePathFromEntityId,
  getKindFromEntityId,
  createEntityIdGenerator,
  generateEntityIdsForFile,
  deriveChildEntityId,
  LanguageRouter,
  createLanguageRouter,
  getDefaultRouter,
  resetDefaultRouter,
  DEFAULT_EXTENSION_MAP,
  createAnalysisOrchestrator,
} from "./analyzer/index.js";
export type {
  EntityIdComponents,
  ParsedEntityId,
  AnalysisOrchestrator,
  FileChangeEvent,
  AnalysisResult,
  PackageResult,
  BatchResult,
  ResolutionResult,
  OrchestratorStatus,
  OrchestratorOptions,
} from "./analyzer/index.js";

// Parsers
export * from "./parsers/index.js";

// Utils (excludes generateScopeHash which is also in analyzer)
export {
  writeFileAtomic,
  writeJsonAtomic,
  copyFileAtomic,
  moveFileAtomic,
  fsyncDirectory,
  createTempFile,
  cleanupTempFiles,
  ensureDir,
  removeIfExists,
  fileExists,
  getFileMtime,
  computeStringHash,
  computeBufferHash,
  computeFileHash,
  computeFileHashes,
  hasFileChanged,
  findChangedFiles,
  generateRandomHash,
  combineHashes,
  cleanupPackageSeeds,
  findOrphanedSeeds,
  removeAllSeeds,
  cleanupOrphanedFiles,
  getSeedStorageStats,
  verifySeedStructure,
} from "./utils/index.js";
export type {
  AtomicWriteOptions,
  CleanupOptions,
  CleanupResult,
} from "./utils/index.js";

/**
 * DevAC v2.0 Version
 */
export const VERSION = "2.0.0";

/**
 * Quick start example:
 *
 * ```typescript
 * import {
 *   DuckDBPool,
 *   createSeedWriter,
 *   createSeedReader,
 *   generateEntityId,
 * } from "./devac-v2";
 *
 * // Initialize pool
 * const pool = new DuckDBPool();
 * await pool.initialize();
 *
 * // Create writer/reader for a package
 * const writer = createSeedWriter(pool, "/path/to/package");
 * const reader = createSeedReader(pool, "/path/to/package");
 *
 * // Write parse results
 * await writer.writeFile(parseResult);
 *
 * // Query nodes
 * const nodes = await reader.readNodes();
 *
 * // Cleanup
 * await pool.shutdown();
 * ```
 */
