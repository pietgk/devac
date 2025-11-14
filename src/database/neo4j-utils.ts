/**
 * Neo4j Utilities
 *
 * Helper functions for working with Neo4j driver types.
 *
 * Neo4j returns numeric values as Integer objects (neo4j-driver Integer type),
 * not JavaScript number primitives. These utilities safely convert them.
 *
 * @module database/neo4j-utils
 */

/**
 * Convert Neo4j Integer to JavaScript number
 *
 * Neo4j returns numeric values as Integer objects (neo4j-driver Integer type),
 * not JavaScript primitives. This utility safely converts them.
 *
 * @param value - Value from Neo4j query result
 * @returns JavaScript number
 * @throws Error if value cannot be converted to number
 *
 * @example
 * ```typescript
 * const result = await tx.run('RETURN count(*) as count');
 * const count = toNumber(result.records[0].get('count'));
 * console.log(count); // 42 (number, not Integer object)
 * ```
 *
 * @example
 * ```typescript
 * // Handles Neo4j Integer objects
 * const neo4jInt = neo4j.int(42);
 * const jsNumber = toNumber(neo4jInt); // 42
 *
 * // Handles regular numbers
 * toNumber(42); // 42
 *
 * // Handles null/undefined
 * toNumber(null); // 0
 * toNumber(undefined); // 0
 *
 * // Handles string numbers
 * toNumber("123"); // 123
 *
 * // Throws on invalid values
 * toNumber("invalid"); // throws Error
 * ```
 */
export function toNumber(value: unknown): number {
  // Already a number - return as-is
  if (typeof value === "number") {
    return value;
  }

  // Neo4j Integer object (has .toNumber() method)
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as any).toNumber();
  }

  // Null/undefined → 0 (safe default for counts)
  if (value === null || value === undefined) {
    return 0;
  }

  // String → try to parse
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }

  // Cannot convert - throw error
  throw new Error(
    `Cannot convert ${typeof value} to number: ${JSON.stringify(value)}`,
  );
}

/**
 * Convert Neo4j Integer to JavaScript number with default fallback
 *
 * Same as toNumber(), but returns a default value instead of throwing on error.
 * Useful for optional counts or when you want graceful degradation.
 *
 * @param value - Value from Neo4j query result
 * @param defaultValue - Value to return if conversion fails
 * @returns JavaScript number or default value
 *
 * @example
 * ```typescript
 * // Safe count with default
 * const count = toNumberOr(result.records[0]?.get('count'), 0);
 *
 * // Optional reference count
 * const refCount = toNumberOr(record.get('refCount'), 0);
 * if (refCount === 0) {
 *   // Safe to delete - no references
 * }
 *
 * // With fallback for missing data
 * const priority = toNumberOr(record.get('priority'), 50);
 * ```
 */
export function toNumberOr(value: unknown, defaultValue: number): number {
  try {
    return toNumber(value);
  } catch {
    return defaultValue;
  }
}

/**
 * Check if a value is a Neo4j Integer object
 *
 * @param value - Value to check
 * @returns true if value is a Neo4j Integer object
 *
 * @example
 * ```typescript
 * import { int } from 'neo4j-driver';
 *
 * isNeo4jInteger(int(42)); // true
 * isNeo4jInteger(42); // false
 * isNeo4jInteger("42"); // false
 * ```
 */
export function isNeo4jInteger(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof (value as any).toNumber === "function"
  );
}

/**
 * Convert Neo4j Integer to JavaScript number (safe for large integers)
 *
 * Uses .toInt() for integers that fit in JavaScript's safe integer range,
 * otherwise converts to string to avoid precision loss.
 *
 * @param value - Value from Neo4j query result
 * @returns JavaScript number or string (for large integers)
 *
 * @example
 * ```typescript
 * // Safe integer
 * toNumberSafe(neo4j.int(42)); // 42 (number)
 *
 * // Large integer (beyond Number.MAX_SAFE_INTEGER)
 * toNumberSafe(neo4j.int("9007199254740992")); // "9007199254740992" (string)
 * ```
 */
export function toNumberSafe(value: unknown): number | string {
  if (typeof value === "number") {
    return value;
  }

  if (isNeo4jInteger(value)) {
    const neo4jInt = value as any;

    // Try to convert to number - if it fits in safe range, use toInt()
    // Otherwise, use toString() to preserve exact value
    try {
      const asNumber = neo4jInt.toNumber();

      // Check if within JavaScript's safe integer range
      if (
        asNumber >= Number.MIN_SAFE_INTEGER &&
        asNumber <= Number.MAX_SAFE_INTEGER
      ) {
        return neo4jInt.toInt();
      } else {
        // Return as string to avoid precision loss
        return neo4jInt.toString();
      }
    } catch {
      // If toNumber() fails, return as string
      return neo4jInt.toString();
    }
  }

  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }

  throw new Error(
    `Cannot safely convert ${typeof value} to number: ${JSON.stringify(value)}`,
  );
}
