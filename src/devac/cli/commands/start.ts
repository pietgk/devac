// src/devac/cli/commands/start.ts

import path from "path";
import { Command } from "commander";
import { createContextLogger } from "../../../utils/logger.js";
import { Orchestrator } from "../../orchestrator/orchestrator.js";
import { loadDevACConfig } from "../config.js";
import { createWebServer } from "../../web/server.js";
import { registerDemoServices } from "../demo-services.js";
import { ServiceFactory } from "../../services/service-factory.js";
import type { DevACConfig } from "../../types/index.js";
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
    .option("--demo", "Start with demo services for testing the UI")
    .action(
      async (options: {
        config: string;
        port: string;
        web: boolean;
        workspace?: string;
        demo?: boolean;
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

          // Register demo services if --demo flag is set
          if (options.demo) {
            logger.info("Registering demo services...");
            registerDemoServices(orchestrator);
            logger.info("Demo services registered (3 services)");
          }

          // Create and register all enabled services using the factory
          const workspaceDir = path.resolve(process.cwd(), ".devac");
          const serviceFactory = new ServiceFactory(config, workspaceDir);
          const services = serviceFactory.createAllServices();

          // Register all services with the orchestrator
          for (const { id, actor, config: serviceConfig } of services) {
            orchestrator.registerService(id, actor, serviceConfig);
            orchestrator.startService(id);
            logger.info(`Service registered and started: ${id}`);
          }

          if (services.length > 0) {
            logger.info(`Total services running: ${services.length}`);
          } else if (!options.demo) {
            logger.warn(
              "No services enabled. Enable services in .devac/config.json or use --demo flag",
            );
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
