// src/devac/cli/commands/start.ts

import { Command } from 'commander';
import { createContextLogger } from '../../../utils/logger.js';
import { Orchestrator } from '../../orchestrator/orchestrator.js';
import { loadDevACConfig } from '../config.js';
import type { DevACConfig } from '../../types/index.js';

const logger = createContextLogger('CLI:Start');

export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start the DevAC command center')
    .option('-c, --config <path>', 'Path to DevAC config file', '.devac/config.json')
    .option('-p, --port <number>', 'Web server port', '3000')
    .option('--no-web', 'Start without web server')
    .option('-w, --workspace <name>', 'Workspace name')
    .action(async (options: {
      config: string;
      port: string;
      web: boolean;
      workspace?: string;
    }) => {
      try {
        logger.info('Starting DevAC...');

        // Load configuration
        const config: DevACConfig = await loadDevACConfig(options.config);

        // Override port if specified
        if (options.port) {
          config.web.port = parseInt(options.port, 10);
        }

        // Create and start orchestrator
        const orchestrator = new Orchestrator(config);
        orchestrator.start();

        logger.info('DevAC orchestrator started');

        // TODO: Start web server if enabled
        if (options.web) {
          logger.info(`Web UI will be available at http://${config.web.host}:${config.web.port}`);
          logger.info('(Web server implementation coming in next phase)');
        }

        // Handle graceful shutdown
        const shutdown = async () => {
          logger.info('Shutting down DevAC...');
          await orchestrator.stop(true);
          process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        // Keep process alive
        logger.info('DevAC is running. Press Ctrl+C to stop.');

      } catch (error: any) {
        logger.error(`Failed to start DevAC: ${error.message}`, {
          stack: error.stack,
        });
        process.exit(1);
      }
    });
}
