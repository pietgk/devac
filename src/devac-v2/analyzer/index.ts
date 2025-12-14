/**
 * Analyzer Module Exports
 *
 * Analysis orchestration and entity ID generation for DevAC v2.0
 */

// Entity ID generation
export {
  generateEntityId,
  generateScopeHash,
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
} from "./entity-id-generator.js";
export type { EntityIdComponents, ParsedEntityId } from "./entity-id-generator.js";

// Language router
export {
  LanguageRouter,
  createLanguageRouter,
  getDefaultRouter,
  resetDefaultRouter,
  DEFAULT_EXTENSION_MAP,
} from "./language-router.js";
