/**
 * CLI Commands Index
 *
 * Re-exports all CLI command implementations.
 */

export { analyzeCommand } from "./analyze.js";
export { queryCommand } from "./query.js";
export { verifyCommand } from "./verify.js";
export { cleanCommand } from "./clean.js";

export type {
  AnalyzeOptions,
  AnalyzeResult,
  QueryOptions,
  QueryResult,
  VerifyOptions,
  VerifyResult,
  CleanOptions,
  CleanResult,
} from "./types.js";
