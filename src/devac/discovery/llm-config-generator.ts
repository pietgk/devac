// src/devac/discovery/llm-config-generator.ts

import { createContextLogger } from "../../utils/logger.js";
import type {
  WorkspaceDiscovery,
  ConfigurationRecommendation,
  ServiceRecommendation,
} from "../types/workspace.js";

const logger = createContextLogger("LLMConfigGenerator");

/**
 * Generate configuration recommendations using LLM analysis
 *
 * NOTE: This is a placeholder implementation that uses rule-based logic.
 * In production, this would call an LLM API (OpenAI, Anthropic, etc.)
 * with the workspace discovery data as context.
 */
export async function generateConfiguration(
  discoveries: WorkspaceDiscovery[],
): Promise<Map<string, ConfigurationRecommendation>> {
  logger.info(
    `Generating configuration for ${discoveries.length} repositories`,
  );

  const recommendations = new Map<string, ConfigurationRecommendation>();

  for (const discovery of discoveries) {
    const recommendation = await generateConfigurationForRepo(discovery);
    recommendations.set(discovery.repository.path, recommendation);
  }

  return recommendations;
}

/**
 * Generate configuration for a single repository
 */
async function generateConfigurationForRepo(
  discovery: WorkspaceDiscovery,
): Promise<ConfigurationRecommendation> {
  const { repository, workspaceType, buildSystem, packages, rootPackage } =
    discovery;

  logger.info(`Generating config for ${repository.name}`);

  // Prepare LLM prompt (in production, this would be sent to LLM API)
  const prompt = buildLLMPrompt(discovery);

  // TODO: Replace with actual LLM API call
  // const llmResponse = await callLLMAPI(prompt);

  // For now, use rule-based logic that mimics LLM decision-making
  const recommendation = generateRuleBasedRecommendation(discovery);

  logger.info(
    `Generated recommendation for ${repository.name}: ${recommendation.rationale}`,
  );

  return recommendation;
}

/**
 * Build prompt for LLM (for future LLM integration)
 */
function buildLLMPrompt(discovery: WorkspaceDiscovery): string {
  return `You are configuring DevAC services for a codebase. Based on the workspace discovery below,
propose optimal configurations for TypeCheck, Lint, and Test services.

WORKSPACE DISCOVERY:
${JSON.stringify(discovery, null, 2)}

REQUIREMENTS:
1. Determine which services can run at repo level vs package level
2. For monorepos, decide granularity: run per-package or aggregate at root
3. Propose specific commands to run for each service
4. Consider performance: parallel execution, watch mode, caching
5. Handle special cases (Expo, Next.js, TypeScript projects, Turborepo, etc.)

OUTPUT FORMAT (JSON):
{
  "recommendations": {
    "typecheck": {
      "strategy": "aggregate" | "per-package" | "turborepo" | "single",
      "command": "npm run typecheck --workspaces --if-present",
      "workingDirectory": "/path/to/repo",
      "rationale": "Explanation",
      "watch": true
    },
    "lint": { ... },
    "test": { ... }
  },
  "rationale": "Overall explanation of decisions"
}`;
}

/**
 * Rule-based recommendation (placeholder for LLM)
 *
 * This mimics intelligent decision-making based on workspace structure.
 * In production, replace with actual LLM API call.
 */
function generateRuleBasedRecommendation(
  discovery: WorkspaceDiscovery,
): ConfigurationRecommendation {
  const { repository, workspaceType, buildSystem, packages, rootPackage } =
    discovery;

  const recommendation: ConfigurationRecommendation = {
    recommendations: {},
    rationale: "",
  };

  // Single package repository
  if (workspaceType === "single") {
    const typecheckConfig = generateSinglePackageConfig(discovery, "typecheck");
    const lintConfig = generateSinglePackageConfig(discovery, "lint");
    const testConfig = generateSinglePackageConfig(discovery, "test");

    if (typecheckConfig)
      recommendation.recommendations.typecheck = typecheckConfig;
    if (lintConfig) recommendation.recommendations.lint = lintConfig;
    if (testConfig) recommendation.recommendations.test = testConfig;

    recommendation.rationale = `Single package repository with standard npm scripts. No workspace complexity.`;
    return recommendation;
  }

  // Turborepo/Lerna/Nx - leverage build system
  if (buildSystem && buildSystem !== "none") {
    recommendation.recommendations.typecheck = {
      strategy: "turborepo",
      command: `${discovery.packageManager} run ${rootPackage.scripts["check-types"] ? "check-types" : "typecheck"}`,
      workingDirectory: repository.path,
      rationale: `${buildSystem} handles workspace orchestration with caching`,
      watch: true,
    };
    recommendation.recommendations.lint = {
      strategy: "turborepo",
      command: `${discovery.packageManager} run lint`,
      workingDirectory: repository.path,
      rationale: `${buildSystem} aggregates lint across all workspaces with caching`,
      watch: true,
    };
    recommendation.recommendations.test = {
      strategy: "turborepo",
      command: `${discovery.packageManager} run test`,
      workingDirectory: repository.path,
      rationale: `${buildSystem} orchestrates parallel test execution across workspaces`,
      watch: true,
    };
    recommendation.rationale = `This workspace uses ${buildSystem} which provides efficient caching and parallel execution. Leverage ${buildSystem}'s built-in orchestration rather than managing packages individually.`;
    return recommendation;
  }

  // Large monorepo - aggregate TypeCheck/Lint, per-package Test
  if (packages.length > 5) {
    // TypeCheck: aggregate
    const hasTypeCheckScript =
      "typecheck" in rootPackage.scripts || "type-check" in rootPackage.scripts;
    if (hasTypeCheckScript) {
      recommendation.recommendations.typecheck = {
        strategy: "aggregate",
        command: generateWorkspaceCommand(
          discovery.packageManager,
          workspaceType,
          "typecheck",
        ),
        workingDirectory: repository.path,
        rationale: `Root-level typecheck aggregates all workspace type errors efficiently`,
        watch: true,
      };
    }

    // Lint: aggregate
    const hasLintScript = "lint" in rootPackage.scripts;
    if (hasLintScript) {
      recommendation.recommendations.lint = {
        strategy: "aggregate",
        command: generateWorkspaceCommand(
          discovery.packageManager,
          workspaceType,
          "lint",
        ),
        workingDirectory: repository.path,
        rationale: `Root-level lint can check all workspaces at once`,
        watch: true,
      };
    }

    // Test: per-package for granularity
    const packagesWithTests = packages.filter((pkg) => pkg.hasTests);
    if (packagesWithTests.length > 0) {
      recommendation.recommendations.test = {
        strategy: "per-package",
        command: "", // Not used for per-package
        workingDirectory: repository.path,
        rationale: `Per-package testing provides granular pass/fail visibility and faster watch mode`,
        watch: true,
        packages: packagesWithTests.map((pkg) => ({
          name: pkg.name,
          command: generatePerPackageCommand(
            discovery.packageManager,
            workspaceType,
            "test",
            pkg.name,
          ),
          workingDirectory: repository.path,
          enabled: true,
          watch: true,
        })),
      };
    }

    recommendation.rationale = `This monorepo uses ${discovery.packageManager} workspaces with ${packages.length} packages. TypeCheck and Lint can aggregate at root for efficiency. Tests should run per-package to provide detailed feedback and enable parallel execution.`;
    return recommendation;
  }

  // Small monorepo - aggregate all services
  recommendation.recommendations.typecheck = {
    strategy: "aggregate",
    command: generateWorkspaceCommand(
      discovery.packageManager,
      workspaceType,
      "typecheck",
    ),
    workingDirectory: repository.path,
    rationale: `Small workspace can aggregate efficiently`,
    watch: true,
  };
  recommendation.recommendations.lint = {
    strategy: "aggregate",
    command: generateWorkspaceCommand(
      discovery.packageManager,
      workspaceType,
      "lint",
    ),
    workingDirectory: repository.path,
    rationale: `Small workspace can aggregate efficiently`,
    watch: true,
  };
  recommendation.recommendations.test = {
    strategy: "aggregate",
    command: generateWorkspaceCommand(
      discovery.packageManager,
      workspaceType,
      "test",
    ),
    workingDirectory: repository.path,
    rationale: `Small workspace can aggregate efficiently`,
    watch: true,
  };
  recommendation.rationale = `Small monorepo with ${packages.length} packages. All services can run efficiently at the root level.`;

  return recommendation;
}

/**
 * Generate single package configuration
 * Returns undefined if the service script is not found
 */
function generateSinglePackageConfig(
  discovery: WorkspaceDiscovery,
  service: "typecheck" | "lint" | "test",
): ServiceRecommendation | undefined {
  const { repository, rootPackage, packageManager } = discovery;

  const scriptMap = {
    typecheck: ["typecheck", "type-check", "tsc"],
    lint: ["lint"],
    test: ["test"],
  };

  const scriptNames = scriptMap[service];
  const scriptName = scriptNames.find((name) => name in rootPackage.scripts);

  if (!scriptName) {
    return undefined; // Service not available
  }

  return {
    strategy: "single",
    command: `${packageManager} run ${scriptName}`,
    workingDirectory: repository.path,
    rationale: `Single package with ${scriptName} script`,
    watch: true,
  };
}

/**
 * Generate workspace command (for aggregate strategy)
 */
function generateWorkspaceCommand(
  packageManager: string,
  workspaceType: string,
  script: string,
): string {
  if (packageManager === "npm") {
    return `npm run ${script} --workspaces --if-present`;
  } else if (packageManager === "pnpm") {
    return `pnpm run -r ${script}`;
  } else if (packageManager === "yarn") {
    return `yarn workspaces run ${script}`;
  }

  return `${packageManager} run ${script}`;
}

/**
 * Generate per-package command
 */
function generatePerPackageCommand(
  packageManager: string,
  workspaceType: string,
  script: string,
  packageName: string,
): string {
  if (packageManager === "npm") {
    return `npm run ${script} -w ${packageName}`;
  } else if (packageManager === "pnpm") {
    return `pnpm -F "${packageName}" run ${script}`;
  } else if (packageManager === "yarn") {
    return `yarn workspace ${packageName} run ${script}`;
  }

  return `${packageManager} run ${script}`;
}

/**
 * TODO: Call actual LLM API
 *
 * Example implementation with OpenAI/Anthropic:
 *
 * async function callLLMAPI(prompt: string): Promise<ConfigurationRecommendation> {
 *   const response = await openai.chat.completions.create({
 *     model: "gpt-4",
 *     messages: [{ role: "user", content: prompt }],
 *     response_format: { type: "json_object" }
 *   });
 *   return JSON.parse(response.choices[0].message.content);
 * }
 */
