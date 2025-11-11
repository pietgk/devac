// src/devac/cli/commands/start.ts

import path from "path";
import { Command } from "commander";
import { createActor } from "xstate";
import { createContextLogger } from "../../../utils/logger.js";
import { Orchestrator } from "../../orchestrator/orchestrator.js";
import { loadDevACConfig } from "../config.js";
import { CodeGraphService } from "../../services/codegraph/index.js";
import { createWebServer } from "../../web/server.js";
import type { DevACConfig, ServiceConfig } from "../../types/index.js";
import type { Server } from "http";

const logger = createContextLogger("CLI:Start");

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Start the DevAC command center")
    .option(
      "-c, --config <path>",
      "Path to DevAC config file",
      ".devac/config.json",
    )
    .option("-p, --port <number>", "Web server port", "3000")
    .option("--no-web", "Start without web server")
    .option("-w, --workspace <name>", "Workspace name")
    .action(
      async (options: {
        config: string;
        port: string;
        web: boolean;
        workspace?: string;
      }) => {
        try {
          logger.info("Starting DevAC...");

          // Load configuration
          const config: DevACConfig = await loadDevACConfig(options.config);

          // Override port if specified
          if (options.port) {
            config.web.port = parseInt(options.port, 10);
          }

          // Create and start orchestrator
          const orchestrator = new Orchestrator(config);
          orchestrator.start();

          logger.info("DevAC orchestrator started");

          // Register and start CodeGraph service if enabled
          if (config.services?.codegraph?.enabled) {
            logger.info("Registering CodeGraph service...");

            const workspaceDir = path.resolve(process.cwd(), ".devac");

            const serviceConfig: ServiceConfig = {
              id: "codegraph",
              name: "CodeGraph Analyzer",
              type: "codegraph",
              enabled: true,
              config: {
                directories: config.services.codegraph.directories || ["./"],
                extensions: config.services.codegraph.extensions || [
                  ".ts",
                  ".tsx",
                  ".js",
                  ".jsx",
                  ".py",
                ],
                ignore: config.services.codegraph.ignore || [
                  "**/node_modules/**",
                  "**/.git/**",
                  "**/dist/**",
                  "**/build/**",
                ],
                watch: config.services.codegraph.watch ?? true,
                logDir: path.join(workspaceDir, "logs", "codegraph"),
                resourceDir: path.join(workspaceDir, "resources", "codegraph"),
                maxLogFileSize: 10 * 1024 * 1024, // 10MB
                maxLogFiles: 10,
                neo4j: {
                  uri: config.neo4j.uri,
                  username: config.neo4j.username,
                  password: config.neo4j.password,
                  database: config.neo4j.database,
                },
              },
            };

            const service = new CodeGraphService(serviceConfig);
            const machine = service.createMachine();
            const actor = createActor(machine, {
              input: { config: serviceConfig },
            });

            actor.start();

            orchestrator.registerService("codegraph", actor, serviceConfig);
            orchestrator.startService("codegraph");

            logger.info("CodeGraph service registered and started");
          }

          // Start web server if enabled
          let webServer: Server | undefined;
          if (options.web) {
            logger.info("Starting web server...");
            const result = await createWebServer({
              port: config.web.port,
              host: config.web.host,
              cors: config.web.cors,
              orchestrator,
            });

            webServer = result.server;
            logger.info(
              `🌐 Web UI available at http://${config.web.host}:${config.web.port}`,
            );
            logger.info(
              `💡 Open in browser: http://${config.web.host}:${config.web.port}`,
            );
          }

          // Handle graceful shutdown
          const shutdown = async () => {
            logger.info("Shutting down DevAC...");

            // Stop web server
            if (webServer) {
              await new Promise<void>((resolve) => {
                webServer!.close(() => resolve());
              });
            }

            // Stop orchestrator
            await orchestrator.stop(true);
            process.exit(0);
          };

          process.on("SIGINT", shutdown);
          process.on("SIGTERM", shutdown);

          // Keep process alive
          logger.info("DevAC is running. Press Ctrl+C to stop.");
        } catch (error: any) {
          logger.error(`Failed to start DevAC: ${error.message}`, {
            stack: error.stack,
          });
          process.exit(1);
        }
      },
    );
}
