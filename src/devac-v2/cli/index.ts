#!/usr/bin/env node

/**
 * DevAC v2.0 CLI Entry Point
 *
 * Command-line interface for analyzing TypeScript packages
 * and querying seed data.
 *
 * Based on spec Section 11: CLI Interface
 */

import { Command } from "commander";
import * as path from "path";
import {
  analyzeCommand,
  queryCommand,
  verifyCommand,
  cleanCommand,
} from "./commands/index.js";

const program = new Command();

program
  .name("devac-v2")
  .description("DevAC v2.0 - TypeScript code analysis with DuckDB + Parquet")
  .version("2.0.0");

// ─────────────────────────────────────────────────────────────────────────────
// ANALYZE COMMAND
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("analyze")
  .description("Analyze TypeScript package and generate seed files")
  .option("-p, --package <path>", "Package path to analyze", process.cwd())
  .option("-r, --repo <name>", "Repository name", "repo")
  .option("-b, --branch <name>", "Git branch name", "main")
  .option("--if-changed", "Only analyze if source files changed")
  .option("--force", "Force full reanalysis")
  .option("--all", "Analyze all packages in repository")
  .action(async (options) => {
    const result = await analyzeCommand({
      packagePath: path.resolve(options.package),
      repoName: options.repo,
      branch: options.branch,
      ifChanged: options.ifChanged,
      force: options.force,
      all: options.all,
    });

    if (result.success) {
      if (result.skipped) {
        console.log("No changes detected - skipped analysis");
      } else {
        console.log(`✓ Analyzed ${result.filesAnalyzed} files in ${result.timeMs}ms`);
        console.log(`  Nodes: ${result.nodesCreated}`);
        console.log(`  Edges: ${result.edgesCreated}`);
        console.log(`  External refs: ${result.refsCreated}`);
      }
    } else {
      console.error(`✗ Analysis failed: ${result.error}`);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// QUERY COMMAND
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("query <sql>")
  .description("Execute SQL query against seed files")
  .option("-p, --package <path>", "Package path", process.cwd())
  .option("-f, --format <type>", "Output format (json, csv, table)", "json")
  .action(async (sql, options) => {
    const result = await queryCommand({
      sql,
      packagePath: path.resolve(options.package),
      format: options.format,
    });

    if (result.success) {
      switch (options.format) {
        case "csv":
          console.log(result.csv);
          break;
        case "table":
          console.log(result.table);
          break;
        case "json":
        default:
          console.log(JSON.stringify(result.rows, null, 2));
      }

      if (result.timeMs !== undefined) {
        console.error(`\n(${result.rowCount} rows, ${result.timeMs}ms)`);
      }
    } else {
      console.error(`✗ Query failed: ${result.error}`);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY COMMAND
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("verify")
  .description("Verify seed file integrity")
  .option("-p, --package <path>", "Package path to verify", process.cwd())
  .option("-b, --branch <name>", "Git branch name", "base")
  .action(async (options) => {
    const result = await verifyCommand({
      packagePath: path.resolve(options.package),
      branch: options.branch,
    });

    if (result.valid) {
      console.log("✓ Seeds verified successfully");

      if (result.stats) {
        console.log(`  Nodes: ${result.stats.nodeCount}`);
        console.log(`  Edges: ${result.stats.edgeCount}`);
        console.log(`  External refs: ${result.stats.refCount}`);
        console.log(`  Files: ${result.stats.fileCount}`);

        if (result.stats.unresolvedRefs > 0) {
          console.log(`  Unresolved refs: ${result.stats.unresolvedRefs}`);
        }
        if (result.stats.orphanedEdges > 0) {
          console.log(`  Orphaned edges: ${result.stats.orphanedEdges}`);
        }
      }

      if (result.warnings.length > 0) {
        console.log("\nWarnings:");
        for (const warning of result.warnings) {
          console.log(`  ⚠ ${warning}`);
        }
      }
    } else {
      console.error("✗ Verification failed:");
      for (const error of result.errors) {
        console.error(`  • ${error}`);
      }
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// CLEAN COMMAND
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("clean")
  .description("Remove seed files (forces regeneration)")
  .option("-p, --package <path>", "Package path to clean", process.cwd())
  .option("--config", "Also remove .devac configuration")
  .action(async (options) => {
    const result = await cleanCommand({
      packagePath: path.resolve(options.package),
      cleanConfig: options.config,
    });

    if (result.success) {
      if (result.filesRemoved > 0) {
        const sizeKb = Math.round(result.bytesFreed / 1024);
        console.log(`✓ Cleaned ${result.filesRemoved} files (${sizeKb} KB)`);
      } else {
        console.log("✓ Nothing to clean");
      }
    } else {
      console.error(`✗ Clean failed: ${result.error}`);
      process.exit(1);
    }
  });

// Parse and run
program.parse();
