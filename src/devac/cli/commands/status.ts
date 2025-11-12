// src/devac/cli/commands/status.ts

import { Command } from "commander";
import { DevACClient } from "../api/devac-client.js";
import { createFormatter } from "../formatters/status-formatter.js";
import { createContextLogger } from "../../../utils/logger.js";

const logger = createContextLogger("StatusCommand");

/**
 * Register the status command
 */
export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show DevAC service status")
    .option(
      "-s, --summary",
      "Show summary status (one line)",
      false,
    )
    .option(
      "-a, --attention",
      "Show services requiring attention (errors/warnings)",
      false,
    )
    .option(
      "-d, --detailed",
      "Show detailed status for all services",
      false,
    )
    .option(
      "-j, --json",
      "Output status as JSON",
      false,
    )
    .option(
      "--no-color",
      "Disable colored output",
      false,
    )
    .option(
      "--show-timestamps",
      "Show timestamps for events",
      false,
    )
    .option(
      "--show-ids",
      "Show service IDs alongside names",
      false,
    )
    .option(
      "-u, --url <url>",
      "DevAC server URL",
      "http://localhost:3000",
    )
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      "5000",
    )
    .action(async (options) => {
      try {
        await handleStatusCommand(options);
      } catch (error: any) {
        logger.error(`Status command failed: ${error.message}`);

        if (error.message.includes("Cannot connect")) {
          console.error("\n" + error.message);
          console.error(
            "\nMake sure DevAC is running with: devac start\n",
          );
        } else {
          console.error(`\nError: ${error.message}\n`);
        }

        process.exit(1);
      }
    });
}

/**
 * Handle status command
 */
async function handleStatusCommand(options: {
  summary: boolean;
  attention: boolean;
  detailed: boolean;
  json: boolean;
  color: boolean;
  showTimestamps: boolean;
  showIds: boolean;
  url: string;
  timeout: string;
}): Promise<void> {
  // Create client
  const client = new DevACClient(options.url, parseInt(options.timeout, 10));

  // Check if server is running
  logger.debug(`Checking if DevAC server is running at ${options.url}`);
  const isRunning = await client.isServerRunning();

  if (!isRunning) {
    throw new Error(
      `Cannot connect to DevAC server at ${options.url}. Is it running?`,
    );
  }

  // Fetch system status
  logger.debug("Fetching system status");
  const status = await client.getSystemStatus();

  // Determine formatter type
  let formatterType: "summary" | "attention" | "detailed" | "json";

  if (options.json) {
    formatterType = "json";
  } else if (options.summary) {
    formatterType = "summary";
  } else if (options.attention) {
    formatterType = "attention";
  } else if (options.detailed) {
    formatterType = "detailed";
  } else {
    // Default: show attention if there are problems, otherwise summary
    formatterType = status.hasErrors || status.hasWarnings ? "attention" : "summary";
  }

  // Create formatter
  const formatter = createFormatter(formatterType, {
    color: options.color,
    showTimestamps: options.showTimestamps,
    showIds: options.showIds,
  });

  // Format and output
  const output = formatter.format(status);
  console.log(output);

  // Exit with error code if there are errors
  if (status.hasErrors) {
    process.exitCode = 1;
  }
}
