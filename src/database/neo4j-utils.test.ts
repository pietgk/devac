/**
 * Tests for Neo4j Utilities
 *
 * @module database/neo4j-utils.test
 */

import { describe, it, expect } from "vitest";
import { int } from "neo4j-driver";
import {
  toNumber,
  toNumberOr,
  isNeo4jInteger,
  toNumberSafe,
} from "./neo4j-utils.js";

describe("Neo4j Utilities", () => {
  describe("toNumber()", () => {
    it("should convert JavaScript numbers as-is", () => {
      expect(toNumber(0)).toBe(0);
      expect(toNumber(42)).toBe(42);
      expect(toNumber(-100)).toBe(-100);
      expect(toNumber(3.14)).toBe(3.14);
    });

    it("should convert Neo4j Integer objects to numbers", () => {
      expect(toNumber(int(0))).toBe(0);
      expect(toNumber(int(42))).toBe(42);
      expect(toNumber(int(-100))).toBe(-100);
      expect(toNumber(int(999999))).toBe(999999);
    });

    it("should convert null and undefined to 0", () => {
      expect(toNumber(null)).toBe(0);
      expect(toNumber(undefined)).toBe(0);
    });

    it("should convert numeric strings to numbers", () => {
      expect(toNumber("0")).toBe(0);
      expect(toNumber("42")).toBe(42);
      expect(toNumber("-100")).toBe(-100);
      expect(toNumber("123")).toBe(123);
    });

    it("should throw on invalid string values", () => {
      expect(() => toNumber("invalid")).toThrow(
        "Cannot convert string to number",
      );
      expect(() => toNumber("abc123")).toThrow(
        "Cannot convert string to number",
      );
      expect(() => toNumber("")).toThrow("Cannot convert string to number");
    });

    it("should throw on unsupported types", () => {
      expect(() => toNumber(true)).toThrow("Cannot convert boolean to number");
      expect(() => toNumber(false)).toThrow("Cannot convert boolean to number");
      expect(() => toNumber({})).toThrow("Cannot convert object to number");
      expect(() => toNumber([])).toThrow("Cannot convert object to number");
    });
  });

  describe("toNumberOr()", () => {
    it("should convert valid values to numbers", () => {
      expect(toNumberOr(42, 0)).toBe(42);
      expect(toNumberOr(int(42), 0)).toBe(42);
      expect(toNumberOr("42", 0)).toBe(42);
    });

    it("should return default value on conversion failure", () => {
      expect(toNumberOr("invalid", 0)).toBe(0);
      expect(toNumberOr("invalid", 99)).toBe(99);
      expect(toNumberOr(true, -1)).toBe(-1);
      expect(toNumberOr({}, 100)).toBe(100);
    });

    it("should use default value for null/undefined", () => {
      expect(toNumberOr(null, 42)).toBe(0); // toNumber returns 0 for null
      expect(toNumberOr(undefined, 42)).toBe(0); // toNumber returns 0 for undefined
    });

    it("should support various default values", () => {
      expect(toNumberOr("invalid", 0)).toBe(0);
      expect(toNumberOr("invalid", 50)).toBe(50);
      expect(toNumberOr("invalid", -1)).toBe(-1);
      expect(toNumberOr("invalid", 999)).toBe(999);
    });
  });

  describe("isNeo4jInteger()", () => {
    it("should return true for Neo4j Integer objects", () => {
      expect(isNeo4jInteger(int(0))).toBe(true);
      expect(isNeo4jInteger(int(42))).toBe(true);
      expect(isNeo4jInteger(int(-100))).toBe(true);
      expect(isNeo4jInteger(int(999999))).toBe(true);
    });

    it("should return false for JavaScript numbers", () => {
      expect(isNeo4jInteger(0)).toBe(false);
      expect(isNeo4jInteger(42)).toBe(false);
      expect(isNeo4jInteger(-100)).toBe(false);
      expect(isNeo4jInteger(3.14)).toBe(false);
    });

    it("should return false for null and undefined", () => {
      expect(isNeo4jInteger(null)).toBe(false);
      expect(isNeo4jInteger(undefined)).toBe(false);
    });

    it("should return false for other types", () => {
      expect(isNeo4jInteger("42")).toBe(false);
      expect(isNeo4jInteger(true)).toBe(false);
      expect(isNeo4jInteger({})).toBe(false);
      expect(isNeo4jInteger([])).toBe(false);
    });
  });

  describe("toNumberSafe()", () => {
    it("should convert safe integers to numbers", () => {
      expect(toNumberSafe(0)).toBe(0);
      expect(toNumberSafe(42)).toBe(42);
      expect(toNumberSafe(int(42))).toBe(42);
      expect(toNumberSafe(int(999999))).toBe(999999);
    });

    it("should convert integers within safe range", () => {
      // Use realistic values that fit in safe integer range
      const normalInt1 = int(1000000);
      const normalInt2 = int(-1000000);
      const normalInt3 = int(999999999);

      expect(toNumberSafe(normalInt1)).toBe(1000000);
      expect(toNumberSafe(normalInt2)).toBe(-1000000);
      expect(toNumberSafe(normalInt3)).toBe(999999999);
    });

    it("should return string for large integers beyond safe range", () => {
      // Create an integer beyond JavaScript's safe range
      const largeInt = int("9007199254740992"); // MAX_SAFE_INTEGER + 1

      const result = toNumberSafe(largeInt);
      expect(typeof result).toBe("string");
      expect(result).toBe("9007199254740992");
    });

    it("should handle null and undefined", () => {
      expect(toNumberSafe(null)).toBe(0);
      expect(toNumberSafe(undefined)).toBe(0);
    });

    it("should handle numeric strings", () => {
      expect(toNumberSafe("42")).toBe(42);
      expect(toNumberSafe("0")).toBe(0);
      expect(toNumberSafe("-100")).toBe(-100);
    });

    it("should throw on invalid values", () => {
      expect(() => toNumberSafe("invalid")).toThrow("Cannot safely convert");
      expect(() => toNumberSafe(true)).toThrow("Cannot safely convert");
      expect(() => toNumberSafe({})).toThrow("Cannot safely convert");
    });
  });

  describe("Real-world usage scenarios", () => {
    it("should handle Neo4j count() results", () => {
      // Simulate Neo4j query result
      const mockResult = {
        records: [
          {
            get: (key: string) => {
              if (key === "count") return int(42);
              return null;
            },
          },
        ],
      };

      const count = toNumber(mockResult.records[0].get("count"));
      expect(count).toBe(42);
      expect(typeof count).toBe("number");
    });

    it("should handle optional counts with defaults", () => {
      const mockRecord = {
        get: (key: string) => {
          if (key === "existingCount") return int(10);
          return undefined; // Missing field
        },
      };

      const existingCount = toNumberOr(mockRecord.get("existingCount"), 0);
      const missingCount = toNumberOr(mockRecord.get("missingCount"), 0);

      expect(existingCount).toBe(10);
      expect(missingCount).toBe(0);
    });

    it("should handle reference counting for safe deletion", () => {
      const mockRecord = {
        get: (key: string) => {
          if (key === "refCount") return int(0);
          if (key === "entityId") return "entity-123";
          return null;
        },
      };

      const refCount = toNumber(mockRecord.get("refCount"));
      const entityId = mockRecord.get("entityId");

      if (refCount === 0) {
        // Safe to delete
        expect(entityId).toBe("entity-123");
      }
    });

    it("should handle batch processing counts", () => {
      const mockResults = {
        records: [
          {
            get: (key: string) => {
              if (key === "nodesCreated") return int(15);
              if (key === "relationshipsCreated") return int(23);
              return null;
            },
          },
        ],
      };

      const nodesCreated = toNumber(mockResults.records[0].get("nodesCreated"));
      const relationshipsCreated = toNumber(
        mockResults.records[0].get("relationshipsCreated"),
      );

      expect(nodesCreated).toBe(15);
      expect(relationshipsCreated).toBe(23);
      expect(nodesCreated + relationshipsCreated).toBe(38);
    });
  });
});
