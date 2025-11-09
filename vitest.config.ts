import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns
    include: ['src/**/*.{spec,test}.ts', 'src/**/__tests__/**/*.ts'],

    // Global test settings
    globals: true,
    environment: 'node',

    // Timeout settings
    testTimeout: 10000, // 10s for integration tests
    hookTimeout: 10000, // 10s for setup/teardown

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.spec.ts',
        '**/*.test.ts',
        'test-setup/',
        'scripts/',
      ],
    },

    // Test categorization via file naming
    // Unit tests: *.unit.spec.ts
    // Integration tests: *.integration.spec.ts
    // E2E tests: *.e2e.spec.ts

    // Reporters
    reporters: ['verbose'],

    // Fail fast in CI
    bail: process.env.CI ? 1 : 0,

    // Parallel execution
    // Run integration tests sequentially to avoid database conflicts
    poolOptions: {
      threads: {
        singleThread: false,
        isolate: true,
      },
    },

    // Separate pools for unit vs integration tests
    sequence: {
      shuffle: false,
    },
  },
});
