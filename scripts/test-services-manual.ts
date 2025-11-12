#!/usr/bin/env tsx
// scripts/test-services-manual.ts

import { TypeCheckService } from "../src/devac/services/typecheck/typecheck-service.js";
import { LintService } from "../src/devac/services/lint/lint-service.js";
import { TestService } from "../src/devac/services/test/test-service.js";
import { EventBus } from "../src/devac/orchestrator/event-bus.js";
import type {
  TypeCheckServiceConfig,
  LintServiceConfig,
  TestServiceConfigV2,
} from "../src/devac/types/config.js";

console.log("=".repeat(60));
console.log("Testing Command-Based Services");
console.log("=".repeat(60));

const eventBus = new EventBus();
const capturedEvents: any[] = [];

// Capture all events
eventBus.subscribe("*", (envelope) => {
  capturedEvents.push({
    type: envelope.event.type,
    source: envelope.source,
    timestamp: envelope.timestamp,
    event: envelope.event,
  });
  console.log(`📡 Event: ${envelope.event.type} from ${envelope.source}`);
});

async function testTypeCheckService() {
  console.log("\n" + "=".repeat(60));
  console.log("Testing TypeCheckService");
  console.log("=".repeat(60));

  const config: TypeCheckServiceConfig = {
    enabled: true,
    repositories: [
      {
        path: "/Users/grop/ws/CodeGraph",
        strategy: "single",
        command: "npx tsc --noEmit",
        watch: false,
      },
    ],
  };

  const service = new TypeCheckService(config, eventBus);

  console.log("✓ TypeCheckService instantiated");

  await service.start();
  console.log("✓ TypeCheckService started");

  await service.checkRepository("/Users/grop/ws/CodeGraph");
  console.log("✓ TypeCheckService ran type checking");

  await service.stop();
  console.log("✓ TypeCheckService stopped");

  const typeCheckEvents = capturedEvents.filter(
    (e) => e.source === "typecheck",
  );
  console.log(`\n📊 TypeCheck Events Captured: ${typeCheckEvents.length}`);
  typeCheckEvents.forEach((e) => {
    console.log(`  - ${e.type}: ${e.event.state || "N/A"}`);
  });

  return typeCheckEvents.length > 0;
}

async function testLintService() {
  console.log("\n" + "=".repeat(60));
  console.log("Testing LintService");
  console.log("=".repeat(60));

  // Clear previous events
  capturedEvents.length = 0;

  const config: LintServiceConfig = {
    enabled: true,
    repositories: [
      {
        path: "/Users/grop/ws/CodeGraph",
        strategy: "single",
        command: "npm run lint",
        watch: false,
      },
    ],
    includeSnippets: true,
  };

  const service = new LintService(config, eventBus);

  console.log("✓ LintService instantiated");

  await service.start();
  console.log("✓ LintService started");

  await service.lintRepository("/Users/grop/ws/CodeGraph");
  console.log("✓ LintService ran linting");

  await service.stop();
  console.log("✓ LintService stopped");

  const lintEvents = capturedEvents.filter((e) => e.source === "lint");
  console.log(`\n📊 Lint Events Captured: ${lintEvents.length}`);
  lintEvents.forEach((e) => {
    console.log(`  - ${e.type}: ${e.event.state || "N/A"}`);
  });

  return lintEvents.length > 0;
}

async function testTestService() {
  console.log("\n" + "=".repeat(60));
  console.log("Testing TestService");
  console.log("=".repeat(60));

  // Clear previous events
  capturedEvents.length = 0;

  const config: TestServiceConfigV2 = {
    enabled: true,
    repositories: [
      {
        path: "/Users/grop/ws/CodeGraph",
        strategy: "single",
        // Use a simple, fast test instead of full suite
        command:
          "echo 'PASS src/example.test.ts' && echo 'Test Suites: 1 passed, 1 total'",
        watch: false,
      },
    ],
  };

  const service = new TestService(config, eventBus);

  console.log("✓ TestService instantiated");

  await service.start();
  console.log("✓ TestService started");

  await service.testRepository("/Users/grop/ws/CodeGraph");
  console.log("✓ TestService ran tests");

  await service.stop();
  console.log("✓ TestService stopped");

  const testEvents = capturedEvents.filter((e) => e.source === "test");
  console.log(`\n📊 Test Events Captured: ${testEvents.length}`);
  testEvents.forEach((e) => {
    console.log(`  - ${e.type}: ${e.event.state || "N/A"}`);
  });

  return testEvents.length > 0;
}

async function main() {
  try {
    const typeCheckPassed = await testTypeCheckService();
    const lintPassed = await testLintService();
    const testPassed = await testTestService();

    console.log("\n" + "=".repeat(60));
    console.log("Test Results Summary");
    console.log("=".repeat(60));
    console.log(
      `TypeCheck Service: ${typeCheckPassed ? "✅ PASS" : "❌ FAIL"}`,
    );
    console.log(`Lint Service:      ${lintPassed ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`Test Service:      ${testPassed ? "✅ PASS" : "❌ FAIL"}`);

    const allPassed = typeCheckPassed && lintPassed && testPassed;
    console.log("\n" + "=".repeat(60));
    console.log(allPassed ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED");
    console.log("=".repeat(60));

    process.exit(allPassed ? 0 : 1);
  } catch (error: any) {
    console.error("\n❌ Test failed with error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
