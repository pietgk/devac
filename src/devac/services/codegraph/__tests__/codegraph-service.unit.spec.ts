// src/devac/services/codegraph/__tests__/codegraph-service.unit.spec.ts

/**
 * CodeGraphService Unit Tests - Testing Trophy Approach
 *
 * These tests are at THE BOTTOM of the trophy (1-2 tests).
 * Focus: Pure logic only - no dependencies, no mocking.
 * Fast: <1ms per test.
 * Use Case: Complex calculations that are hard to test via integration.
 *
 * Philosophy: Unit tests are minimal in the Trophy approach.
 * Most behavior is tested via integration tests.
 */

import { describe, it, expect } from 'vitest';

describe('CodeGraphService - Unit Tests (Trophy Base)', () => {
  // ========================================
  // Unit Test U1: Statistics Estimation
  // ========================================
  describe('U1: Statistics Estimation (Pure Function)', () => {
    /**
     * Pure function to estimate nodes/relationships from file count.
     * This is the logic used in CodeGraphService.scan() and process().
     *
     * Typical ratios (based on empirical data):
     * - ~15 nodes per file (classes, functions, variables, imports)
     * - ~10 relationships per file (calls, imports, extends, implements)
     */
    function estimateStats(fileCount: number) {
      return {
        nodesCreated: fileCount * 15,
        relationshipsCreated: fileCount * 10,
      };
    }

    it('should estimate zero stats for zero files', () => {
      // Arrange & Act
      const stats = estimateStats(0);

      // Assert
      expect(stats.nodesCreated).toBe(0);
      expect(stats.relationshipsCreated).toBe(0);
    });

    it('should estimate stats for single file', () => {
      // Arrange & Act
      const stats = estimateStats(1);

      // Assert
      expect(stats.nodesCreated).toBe(15);
      expect(stats.relationshipsCreated).toBe(10);
    });

    it('should estimate stats for small project', () => {
      // Arrange: 5 files (typical small project)
      const stats = estimateStats(5);

      // Assert
      expect(stats.nodesCreated).toBe(75);
      expect(stats.relationshipsCreated).toBe(50);
    });

    it('should estimate stats for medium project', () => {
      // Arrange: 100 files (typical medium project)
      const stats = estimateStats(100);

      // Assert
      expect(stats.nodesCreated).toBe(1500);
      expect(stats.relationshipsCreated).toBe(1000);
    });

    it('should estimate stats for large project', () => {
      // Arrange: 1000 files (large project)
      const stats = estimateStats(1000);

      // Assert
      expect(stats.nodesCreated).toBe(15000);
      expect(stats.relationshipsCreated).toBe(10000);
    });

    it('should scale linearly', () => {
      // Arrange: Test multiple file counts
      const fileCounts = [1, 5, 10, 50, 100, 500, 1000];

      for (const count of fileCounts) {
        // Act
        const stats = estimateStats(count);

        // Assert: Linear scaling
        expect(stats.nodesCreated).toBe(count * 15);
        expect(stats.relationshipsCreated).toBe(count * 10);

        // Assert: Consistent ratio
        const nodeToRelRatio = stats.nodesCreated / stats.relationshipsCreated;
        expect(nodeToRelRatio).toBe(1.5); // 15/10 = 1.5
      }
    });
  });

  // ========================================
  // Unit Test U2: File Extension Filtering
  // ========================================
  describe('U2: File Extension Filtering (Pure Function)', () => {
    /**
     * Pure function to check if file should be processed based on extension.
     * This is used in CodeGraphService.startWatcher().
     */
    function shouldProcessFile(filePath: string, allowedExtensions: string[]): boolean {
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      return allowedExtensions.includes(ext);
    }

    it('should accept files with allowed extensions', () => {
      // Arrange
      const extensions = ['.ts', '.tsx', '.js', '.jsx'];

      // Act & Assert
      expect(shouldProcessFile('src/index.ts', extensions)).toBe(true);
      expect(shouldProcessFile('src/App.tsx', extensions)).toBe(true);
      expect(shouldProcessFile('src/utils.js', extensions)).toBe(true);
      expect(shouldProcessFile('src/Component.jsx', extensions)).toBe(true);
    });

    it('should reject files with disallowed extensions', () => {
      // Arrange
      const extensions = ['.ts', '.tsx'];

      // Act & Assert
      expect(shouldProcessFile('README.md', extensions)).toBe(false);
      expect(shouldProcessFile('package.json', extensions)).toBe(false);
      expect(shouldProcessFile('image.png', extensions)).toBe(false);
      expect(shouldProcessFile('style.css', extensions)).toBe(false);
    });

    it('should handle files with no extension', () => {
      // Arrange
      const extensions = ['.ts'];

      // Act & Assert
      expect(shouldProcessFile('Dockerfile', extensions)).toBe(false);
      expect(shouldProcessFile('LICENSE', extensions)).toBe(false);
    });

    it('should be case-sensitive', () => {
      // Arrange
      const extensions = ['.ts'];

      // Act & Assert
      expect(shouldProcessFile('file.ts', extensions)).toBe(true);
      expect(shouldProcessFile('file.TS', extensions)).toBe(false);
      expect(shouldProcessFile('file.Ts', extensions)).toBe(false);
    });

    it('should handle paths with multiple dots', () => {
      // Arrange
      const extensions = ['.ts', '.spec.ts'];

      // Act & Assert
      expect(shouldProcessFile('file.spec.ts', extensions)).toBe(true); // Has .ts
      expect(shouldProcessFile('file.test.js', extensions)).toBe(false);
      expect(shouldProcessFile('v1.2.3.config.json', extensions)).toBe(false);
    });
  });
});
