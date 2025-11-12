// src/devac/cli/commands/configure.ts

import { Command } from "commander";
import { createContextLogger } from "../../../utils/logger.js";
import { discoverWorkspace } from "../../discovery/workspace-discovery.js";
import { generateConfiguration } from "../../discovery/llm-config-generator.js";
import type { DevACConfig } from "../../types/index.js";
import type {
  WorkspaceDiscovery,
  ConfigurationRecommendation,
} from "../../types/workspace.js";
import fs from "fs/promises";
import path from "path";

const logger = createContextLogger("ConfigureCommand");

interface ConfigureOptions {
  config?: string;
  directories?: string;
  yes?: boolean; // Auto-accept recommendations
}

export function registerConfigureCommand(program: Command): void {
  program
    .command("configure")
    .description("Discover workspaces and configure DevAC services")
    .option("-c, --config <path>", "Path to config file", ".devac/config.json")
    .option(
      "-d, --directories <paths>",
      "Comma-separated list of directories to discover",
    )
    .option("-y, --yes", "Auto-accept all recommendations", false)
    .action(async (options: ConfigureOptions) => {
      try {
        await runConfigure(options);
      } catch (error: unknown) {
        if (error instanceof Error) {
          logger.error(`Configuration failed: ${error.message}`, {
            stack: error.stack,
          });
        }
        process.exit(1);
      }
    });
}

async function runConfigure(options: ConfigureOptions): Promise<void> {
  console.log("\n🔧 DevAC Configuration Wizard\n");

  // Step 1: Get directories to discover
  const directories = await getDirectories(options);
  console.log(`📂 Discovering ${directories.length} directories...\n`);

  // Step 2: Discover workspaces
  const discoveries: WorkspaceDiscovery[] = [];
  for (const dir of directories) {
    try {
      console.log(`  Analyzing: ${dir}`);
      const discovery = await discoverWorkspace(dir);
      discoveries.push(discovery);
      console.log(
        `    ✓ Found ${discovery.workspaceType} workspace with ${discovery.packages.length} packages`,
      );
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.log(`    ✗ Failed: ${error.message}`);
        logger.warn(`Failed to discover ${dir}`, { error: error.message });
      }
    }
  }

  if (discoveries.length === 0) {
    console.log("\n❌ No valid workspaces found. Exiting.\n");
    return;
  }

  console.log(`\n✓ Successfully discovered ${discoveries.length} repositories`);
  console.log(
    `✓ Total packages: ${discoveries.reduce((sum, d) => sum + d.packages.length, 0)}\n`,
  );

  // Step 3: Generate recommendations with LLM
  console.log("🤖 Analyzing workspaces and generating recommendations...\n");
  const recommendations = await generateConfiguration(discoveries);

  // Step 4: Display recommendations
  displayRecommendations(discoveries, recommendations);

  // Step 5: Confirm with user (unless --yes flag)
  const accepted = options.yes || (await confirmRecommendations());

  if (!accepted) {
    console.log("\n❌ Configuration cancelled.\n");
    return;
  }

  // Step 6: Build and save configuration
  const config = buildDevACConfig(discoveries, recommendations);
  const configPath = path.resolve(options.config || ".devac/config.json");

  await saveConfig(config, configPath);

  console.log(`\n✅ Configuration saved to ${configPath}`);
  console.log("\n🚀 You can now run: npm run devac:dev -- start\n");
}

/**
 * Get directories to discover
 */
async function getDirectories(options: ConfigureOptions): Promise<string[]> {
  if (options.directories) {
    return options.directories.split(",").map((d) => d.trim());
  }

  // Try to load existing config and use its directories
  const configPath = path.resolve(options.config || ".devac/config.json");
  try {
    const configData = await fs.readFile(configPath, "utf-8");
    const config: DevACConfig = JSON.parse(configData);

    if (config.services?.codegraph?.directories) {
      return config.services.codegraph.directories;
    }
  } catch (error) {
    // Config doesn't exist yet or is invalid
  }

  // Default to current directory
  return [process.cwd()];
}

/**
 * Display recommendations to user
 */
function displayRecommendations(
  discoveries: WorkspaceDiscovery[],
  recommendations: Map<string, ConfigurationRecommendation>,
): void {
  console.log("📋 Proposed Configuration:\n");

  for (const discovery of discoveries) {
    const recommendation = recommendations.get(discovery.repository.path);
    if (!recommendation) continue;

    const { repository, workspaceType, buildSystem, packages } = discovery;

    console.log(`Repository: ${repository.name}`);
    console.log(`  Type: ${workspaceType} (${discovery.packageManager})`);
    if (buildSystem && buildSystem !== "none") {
      console.log(`  Build System: ${buildSystem}`);
    }
    console.log(`  Packages: ${packages.length}`);
    console.log("");

    // TypeCheck recommendation
    if (recommendation.recommendations.typecheck) {
      const tc = recommendation.recommendations.typecheck;
      console.log(`  TypeCheck: ${tc.strategy}`);
      console.log(`    Command: ${tc.command}`);
      console.log(`    Reason: ${tc.rationale}`);
      if (tc.packages) {
        console.log(`    Packages: ${tc.packages.length} configured`);
      }
      console.log("");
    }

    // Lint recommendation
    if (recommendation.recommendations.lint) {
      const lint = recommendation.recommendations.lint;
      console.log(`  Lint: ${lint.strategy}`);
      console.log(`    Command: ${lint.command}`);
      console.log(`    Reason: ${lint.rationale}`);
      if (lint.packages) {
        console.log(`    Packages: ${lint.packages.length} configured`);
      }
      console.log("");
    }

    // Test recommendation
    if (recommendation.recommendations.test) {
      const test = recommendation.recommendations.test;
      console.log(`  Test: ${test.strategy}`);
      if (test.strategy === "per-package") {
        console.log(`    Packages: ${test.packages?.length || 0} with tests`);
      } else {
        console.log(`    Command: ${test.command}`);
      }
      console.log(`    Reason: ${test.rationale}`);
      console.log("");
    }

    console.log(`  Overall: ${recommendation.rationale}`);
    console.log("");
  }
}

/**
 * Confirm recommendations with user
 */
async function confirmRecommendations(): Promise<boolean> {
  // For now, simple implementation
  // TODO: Replace with proper interactive prompt (inquirer, prompts, etc.)
  console.log("Accept this configuration? [Y/n]");

  // Simple stdin read (blocking)
  const answer = await new Promise<string>((resolve) => {
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim().toLowerCase());
    });
  });

  return answer === "" || answer === "y" || answer === "yes";
}

/**
 * Build DevAC configuration from recommendations
 */
function buildDevACConfig(
  discoveries: WorkspaceDiscovery[],
  recommendations: Map<string, ConfigurationRecommendation>,
): DevACConfig {
  const config: DevACConfig = {
    version: "1.0.0",
    neo4j: {
      uri: "bolt://localhost:7687",
      username: "neo4j",
      password: "test1234",
      database: "devac",
    },
    web: {
      port: 3000,
      host: "localhost",
      cors: true,
    },
    services: {
      codegraph: {
        enabled: true,
        directories: discoveries.map((d) => d.repository.path),
        extensions: [".ts", ".js", ".py", ".java", ".go"],
        ignore: ["**/node_modules/**", "**/.git/**"],
        watch: true,
      },
      typecheck: {
        enabled: false,
        repositories: [],
      },
      lint: {
        enabled: false,
        repositories: [],
      },
      test: {
        enabled: false,
        repositories: [],
      },
    },
    logging: {
      level: "info",
      maxFileSize: "10MB",
      maxFiles: 10,
    },
    workspace: {
      autoDiscover: true,
    },
  };

  // Build service configurations from recommendations
  for (const discovery of discoveries) {
    const recommendation = recommendations.get(discovery.repository.path);
    if (!recommendation) continue;

    // TypeCheck
    if (recommendation.recommendations.typecheck) {
      const tc = recommendation.recommendations.typecheck;
      config.services.typecheck!.enabled = true;
      config.services.typecheck!.repositories.push({
        path: discovery.repository.path,
        strategy: tc.strategy,
        command: tc.command,
        watch: tc.watch ?? true,
        packages: tc.packages,
      });
    }

    // Lint
    if (recommendation.recommendations.lint) {
      const lint = recommendation.recommendations.lint;
      config.services.lint!.enabled = true;
      config.services.lint!.repositories.push({
        path: discovery.repository.path,
        strategy: lint.strategy,
        command: lint.command,
        watch: lint.watch ?? true,
        packages: lint.packages,
      });
    }

    // Test
    if (recommendation.recommendations.test) {
      const test = recommendation.recommendations.test;
      config.services.test!.enabled = true;
      config.services.test!.repositories.push({
        path: discovery.repository.path,
        strategy: test.strategy,
        command: test.command,
        watch: test.watch ?? true,
        packages: test.packages,
      });
    }
  }

  return config;
}

/**
 * Save configuration to file
 */
async function saveConfig(
  config: DevACConfig,
  configPath: string,
): Promise<void> {
  // Ensure directory exists
  const configDir = path.dirname(configPath);
  await fs.mkdir(configDir, { recursive: true });

  // Write config with pretty formatting
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

  logger.info(`Configuration saved to ${configPath}`);
}
