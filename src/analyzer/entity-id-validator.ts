/**
 * Entity ID Validation and Parsing Utilities
 *
 * This module provides utilities for validating and parsing hybrid entity IDs.
 *
 * Entity ID Format: {prefix}:{filepath}:{name}:{signature_hint}#{hash}
 *
 * Examples:
 *   - function:/src/utils.ts:process:(string)#a7f3e9c2
 *   - class:/src/User.ts:UserService#c9f5e1d4
 *   - method:/src/User.ts:UserService.getUser:(string)#e1b7f3a5
 */

/**
 * Represents a parsed entity ID with its components
 */
export interface ParsedEntityId {
    /** Full entity ID string */
    fullId: string;
    /** Entity type prefix (function, class, method, etc.) */
    prefix: string;
    /** Human-readable part (filepath:name:signature) */
    readablePart: string;
    /** Unique hash suffix (8 hex characters) */
    hash: string;
    /** Filepath extracted from readable part */
    filepath?: string;
    /** Entity name extracted from readable part */
    name?: string;
    /** Signature hint extracted from readable part (if present) */
    signature?: string;
}

/**
 * Validates that an entity ID follows the hybrid format.
 *
 * Valid format: {prefix}:{readable}#{hash}
 * Where:
 *   - prefix: lowercase letters only
 *   - readable: any characters except #
 *   - hash: exactly 8 hexadecimal characters (lowercase)
 *
 * @param id - The entity ID to validate
 * @returns True if the ID follows the hybrid format
 *
 * @example
 * validateEntityId("function:/src/utils.ts:process:(string)#a7f3e9c2") // true
 * validateEntityId("function:/src/utils.ts:process:123")              // false (no hash)
 * validateEntityId("function:/src/utils.ts:process#xyz")              // false (hash not hex)
 */
export function validateEntityId(id: string): boolean {
    if (!id || typeof id !== "string") {
        return false;
    }

    // Pattern: prefix:readable#hash
    // prefix: lowercase letters
    // readable: anything except #
    // hash: exactly 8 hex characters
    const pattern = /^[a-z]+:[^#]+#[a-f0-9]{8}$/;
    return pattern.test(id);
}

/**
 * Parses a hybrid entity ID into its component parts.
 *
 * @param id - The entity ID to parse
 * @returns Parsed entity ID components, or null if invalid
 *
 * @example
 * parseEntityId("function:/src/utils.ts:process:(string)#a7f3e9c2")
 * // Returns:
 * // {
 * //   fullId: "function:/src/utils.ts:process:(string)#a7f3e9c2",
 * //   prefix: "function",
 * //   readablePart: "/src/utils.ts:process:(string)",
 * //   hash: "a7f3e9c2",
 * //   filepath: "/src/utils.ts",
 * //   name: "process",
 * //   signature: "(string)"
 * // }
 */
export function parseEntityId(id: string): ParsedEntityId | null {
    if (!validateEntityId(id)) {
        return null;
    }

    // Split on # to get readable part and hash
    const hashIndex = id.lastIndexOf("#");
    const hash = id.substring(hashIndex + 1);
    const beforeHash = id.substring(0, hashIndex);

    // Split on first : to get prefix and readable part
    const firstColon = beforeHash.indexOf(":");
    const prefix = beforeHash.substring(0, firstColon);
    const readablePart = beforeHash.substring(firstColon + 1);

    // Try to extract filepath, name, and signature from readable part
    // Format: filepath:name or filepath:name:signature
    const parts = readablePart.split(":");

    let filepath: string | undefined;
    let name: string | undefined;
    let signature: string | undefined;

    if (parts.length >= 2) {
        filepath = parts[0];
        name = parts[1];

        // If there are more parts, the last one might be a signature (starts with '(')
        if (parts.length > 2) {
            const lastPart = parts[parts.length - 1];
            if (lastPart.startsWith("(")) {
                signature = lastPart;
                // Reconstruct name from middle parts
                name = parts.slice(1, parts.length - 1).join(":");
            } else {
                // All middle parts are part of the name (e.g., Class.method)
                name = parts.slice(1).join(":");
            }
        }
    }

    return {
        fullId: id,
        prefix,
        readablePart,
        hash,
        filepath,
        name,
        signature,
    };
}

/**
 * Extracts just the entity name from an entity ID.
 * Useful for display and search purposes.
 *
 * @param id - The entity ID
 * @returns The entity name, or null if parsing fails
 *
 * @example
 * getEntityName("function:/src/utils.ts:process:(string)#a7f3e9c2") // "process"
 * getEntityName("method:/src/User.ts:UserService.getUser#c9f5") // "UserService.getUser"
 */
export function getEntityName(id: string): string | null {
    const parsed = parseEntityId(id);
    return parsed?.name || null;
}

/**
 * Extracts just the file path from an entity ID.
 * Useful for filtering and grouping entities by file.
 *
 * @param id - The entity ID
 * @returns The file path, or null if parsing fails
 *
 * @example
 * getEntityFilePath("function:/src/utils.ts:process#a7f3e9c2") // "/src/utils.ts"
 */
export function getEntityFilePath(id: string): string | null {
    const parsed = parseEntityId(id);
    return parsed?.filepath || null;
}

/**
 * Checks if two entity IDs refer to the same entity (same hash).
 * Even if readable parts differ slightly, same hash means same entity.
 *
 * @param id1 - First entity ID
 * @param id2 - Second entity ID
 * @returns True if both IDs have the same hash
 */
export function areEntityIdsSame(id1: string, id2: string): boolean {
    const parsed1 = parseEntityId(id1);
    const parsed2 = parseEntityId(id2);

    if (!parsed1 || !parsed2) {
        return false;
    }

    return parsed1.hash === parsed2.hash && parsed1.prefix === parsed2.prefix;
}

/**
 * Checks if an entity ID represents a function overload by detecting signature in the ID.
 *
 * @param id - The entity ID
 * @returns True if the ID contains a signature hint
 */
export function hasSignature(id: string): boolean {
    const parsed = parseEntityId(id);
    return parsed?.signature !== undefined;
}

/**
 * Migration helper: Detects if an ID uses the legacy format (no hash suffix)
 *
 * @param id - The entity ID to check
 * @returns True if the ID appears to be in legacy format
 */
export function isLegacyFormat(id: string): boolean {
    // Legacy format doesn't have # separator
    return !id.includes("#");
}
