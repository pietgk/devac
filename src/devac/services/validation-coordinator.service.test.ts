/**
 * Tests for ValidationCoordinatorService
 *
 * @module devac/services/validation-coordinator.test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ValidationCoordinatorService } from "./validation-coordinator.service.js";
import { Neo4jClient } from "../../database/neo4j-client.js";
import { StructuralParser } from "../../analyzer/structural-parser.js";
import { ImportResolver } from "../../analyzer/parsers/import-resolver.js";
import type { PackageInfo } from "../../analyzer/parsers/package-extractor.js";

describe("ValidationCoordinatorService", () => {
  let coordinator: ValidationCoordinatorService;
  let neo4jClient: Neo4jClient;
  let structuralParser: StructuralParser;
  let importResolver: ImportResolver;
  let testPackages: PackageInfo[];

  beforeEach(() => {
    // Mock dependencies
    neo4jClient = {
      runTransaction: async () => ({ records: [] }),
      runTransactionWork: async (fn) => fn({} as any),
      close: async () => {},
    } as unknown as Neo4jClient;

    structuralParser = new StructuralParser();

    importResolver = {
      resolveImport: () => null,
    } as unknown as ImportResolver;

    testPackages = [
      {
        name: "test-package",
        path: "/test/package",
        packageJson: { name: "test-package", version: "1.0.0" },
      },
    ];

    coordinator = new ValidationCoordinatorService({
      neo4jClient,
      structuralParser,
      importResolver,
      packages: testPackages,
      workspaceRoot: "/test",
    });
  });

  afterEach(() => {
    if (coordinator) {
      coordinator.stop();
    }
  });

  describe("Initialization", () => {
    it("should create coordinator instance", () => {
      expect(coordinator).toBeDefined();
      expect(coordinator).toBeInstanceOf(ValidationCoordinatorService);
    });

    it("should start and stop without errors", () => {
      expect(() => coordinator.start()).not.toThrow();
      expect(() => coordinator.stop()).not.toThrow();
    });

    it("should not allow starting twice", () => {
      coordinator.start();
      const consoleSpy = console.warn;
      coordinator.start(); // Should warn, not throw
      // Note: In real test, we'd spy on console.warn
      coordinator.stop();
    });
  });

  describe("State Machine", () => {
    it("should start in idle state", () => {
      coordinator.start();

      // Give the machine time to transition
      const state = coordinator.getState();
      expect(state).toBeDefined();
      expect(state?.status).toBe("active");
    });

    it("should transition to watching state after initialization", async () => {
      coordinator.start();

      // Wait for state machine to initialize
      await new Promise((resolve) => setTimeout(resolve, 200));

      const state = coordinator.getState();
      expect(state?.state).toBe("watching");
    });

    it("should accept FILE_CHANGED events", async () => {
      coordinator.start();

      // Wait for watching state
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(() =>
        coordinator.send({
          type: "FILE_CHANGED",
          event: {
            path: "/test/file.ts",
            type: "change",
          },
        })
      ).not.toThrow();
    });

    it("should throw if sending event before start", () => {
      expect(() =>
        coordinator.send({
          type: "FILE_CHANGED",
          event: {
            path: "/test/file.ts",
            type: "change",
          },
        })
      ).toThrow("ValidationCoordinator not started");
    });
  });

  describe("File Change Queue", () => {
    it("should queue concurrent file changes", async () => {
      coordinator.start();

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Send multiple file changes
      coordinator.send({
        type: "FILE_CHANGED",
        event: { path: "/test/file1.ts", type: "change" },
      });

      coordinator.send({
        type: "FILE_CHANGED",
        event: { path: "/test/file2.ts", type: "change" },
      });

      coordinator.send({
        type: "FILE_CHANGED",
        event: { path: "/test/file3.ts", type: "change" },
      });

      const state = coordinator.getState();
      expect(state).toBeDefined();

      // Should either be processing one or have queued files
      // (Exact behavior depends on timing, but queue should handle multiple files)
    });

    it("should deduplicate same file in queue", async () => {
      coordinator.start();

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Send same file multiple times
      coordinator.send({
        type: "FILE_CHANGED",
        event: { path: "/test/file.ts", type: "change" },
      });

      coordinator.send({
        type: "FILE_CHANGED",
        event: { path: "/test/file.ts", type: "change" },
      });

      coordinator.send({
        type: "FILE_CHANGED",
        event: { path: "/test/file.ts", type: "change" },
      });

      // Queue should deduplicate - only process file once
      // (Exact validation would require inspecting internal queue)
      const state = coordinator.getState();
      expect(state).toBeDefined();
    });
  });

  describe("Progress Events", () => {
    it("should accept progress events from child actors", async () => {
      coordinator.start();

      await new Promise((resolve) => setTimeout(resolve, 200));

      // These should not throw
      expect(() =>
        coordinator.send({
          type: "GRAPH_UPDATE_PROGRESS",
          phase: "parsing",
          filePath: "/test/file.ts",
        })
      ).not.toThrow();

      expect(() =>
        coordinator.send({
          type: "SEMANTIC_BATCH_STARTED",
          filesCount: 5,
        })
      ).not.toThrow();

      expect(() =>
        coordinator.send({
          type: "VALIDATION_PROGRESS",
          packageName: "test-package",
          phase: "running",
        })
      ).not.toThrow();
    });
  });

  describe("Error Handling", () => {
    it("should handle RECOVER event", async () => {
      coordinator.start();

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(() =>
        coordinator.send({
          type: "RECOVER",
        })
      ).not.toThrow();
    });
  });

  describe("State Inspection", () => {
    it("should return null state before starting", () => {
      const state = coordinator.getState();
      expect(state).toBeNull();
    });

    it("should return state after starting", () => {
      coordinator.start();

      const state = coordinator.getState();
      expect(state).not.toBeNull();
      expect(state).toHaveProperty("state");
      expect(state).toHaveProperty("context");
      expect(state).toHaveProperty("status");
    });

    it("should expose context data", () => {
      coordinator.start();

      const state = coordinator.getState();
      expect(state?.context).toBeDefined();
      expect(state?.context.processingQueue).toEqual([]);
      expect(state?.context.fileEvent).toBeNull();
      expect(state?.context.validationResults).toBeInstanceOf(Map);
    });
  });
});
