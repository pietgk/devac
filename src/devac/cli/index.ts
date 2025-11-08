#!/usr/bin/env node

// src/devac/cli/index.ts

import { Command } from 'commander';
import { registerStartCommand } from './commands/start.js';
import { registerStopCommand } from './commands/stop.js';
import { createServiceCommand } from './commands/service.js';
import { registerInitCommand } from './commands/init.js';
import { createContextLogger } from '../../utils/logger.js';
import { AppError } from '../../utils/errors.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const logger = createContextLogger('DevAC');

// Function to read and parse package.json
function getPackageVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const distDir = path.dirname(__filename);
    const pkgPath = path.resolve(distDir, '../../../package.json');
    const pkgData = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgData);
    return pkg.version || '0.0.0';
  } catch (error) {
    logger.warn('Could not read package.json for version.', { error });
    return '0.0.0';
  }
}

async function main() {
  logger.info('Starting DevAC CLI...');

  const program = new Command();

  program
    .name('devac')
    .version(getPackageVersion(), '-v, --version', 'Output the current version')
    .description('DevAC - Development Analytics Centre');

  // Register commands
  registerInitCommand(program);
  registerStartCommand(program);
  registerStopCommand(program);
  program.addCommand(createServiceCommand());

  // Handle invalid commands
  program.on('command:*', () => {
    logger.error(`Invalid command: ${program.args.join(' ')}`);
    logger.info('Run "devac --help" for a list of available commands.');
    process.exit(1);
  });

  try {
    await program.parseAsync(process.argv);
    logger.info('DevAC CLI finished.');
  } catch (error: unknown) {
    if (error instanceof AppError) {
      logger.error(`Command failed: ${error.message}`, {
        name: error.name,
        context: error.context,
        code: error.code,
      });
    } else if (error instanceof Error) {
      logger.error(`An unexpected error occurred: ${error.message}`, {
        stack: error.stack,
      });
    } else {
      logger.error('An unexpected non-error exception occurred.', { error });
    }
    process.exitCode = 1;
  }
}

main();
