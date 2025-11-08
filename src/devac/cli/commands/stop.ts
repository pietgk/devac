// src/devac/cli/commands/stop.ts

import { Command } from 'commander';
import { createContextLogger } from '../../../utils/logger.js';

const logger = createContextLogger('CLI:Stop');

export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop the DevAC command center')
    .option('--force', 'Force stop without graceful shutdown')
    .action(async (options: { force?: boolean }) => {
      try {
        logger.info('Stopping DevAC...');

        // TODO: Implement IPC or PID file to communicate with running instance
        // For now, this is a placeholder

        logger.warn('Stop command not yet implemented');
        logger.info('Use Ctrl+C in the terminal where DevAC is running to stop it gracefully');

      } catch (error: any) {
        logger.error(`Failed to stop DevAC: ${error.message}`, {
          stack: error.stack,
        });
        process.exit(1);
      }
    });
}
