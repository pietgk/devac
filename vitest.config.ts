import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Load env file
  const env = loadEnv(mode, process.cwd(), "");

  return {
    resolve: {
      alias: {
        // Help resolve test-setup imports
        "@test-setup": "/test-setup",
      },
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
    test: {
      // Inject environment variables into test environment
      env,
      // Test file patterns
      include: ["src/**/*.{spec,test}.ts", "src/**/__tests__/**/*.ts"],

      // Global test settings
      globals: true,
      environment: "node",

      // Timeout settings
      testTimeout: 10000, // 10s for integration tests
      hookTimeout: 10000, // 10s for setup/teardown

      // Coverage configuration
      coverage: {
        provider: "v8",
        reporter: ["text", "json", "html"],
        exclude: [
          "node_modules/",
          "dist/",
          "**/*.spec.ts",
          "**/*.test.ts",
          "test-setup/",
          "scripts/",
        ],
      },

      // Test categorization via file naming
      // Unit tests: *.unit.spec.ts
      // Integration tests: *.integration.spec.ts
      // E2E tests: *.e2e.spec.ts

      // Reporters
      reporters: ["verbose"],

      // Fail fast in CI
      bail: process.env.CI ? 1 : 0,

      // Parallel execution configuration
      // Integration tests (*.integration.spec.ts) run sequentially to avoid database conflicts
      // Unit tests (*.spec.ts, *.test.ts) can run in parallel for speed
      poolOptions: {
        threads: {
          singleThread: true, // Sequential execution prevents database race conditions
          isolate: true,
        },
      },

      // Control test execution order
      sequence: {
        shuffle: false, // Predictable test execution order
      },

      // Force one test file at a time for integration tests
      // Note: This applies to all tests when using singleThread mode
      // For better performance, consider splitting test:unit and test:integration scripts
      fileParallelism: false,
      maxConcurrency: 1,
    },
  };
});
