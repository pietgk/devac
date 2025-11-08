// src/devac/cli/commands/init.ts

import { Command } from 'commander';
import { createContextLogger } from '../../../utils/logger.js';
import { DEFAULT_DEVAC_CONFIG } from '../../types/config.js';
import fs from 'fs/promises';
import path from 'path';

const logger = createContextLogger('CLI:Init');

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize DevAC in the current directory')
    .option('--force', 'Overwrite existing configuration')
    .option('-n, --name <name>', 'Workspace name')
    .option('--interactive', 'Interactive configuration')
    .action(async (options: {
      force?: boolean;
      name?: string;
      interactive?: boolean;
    }) => {
      try {
        logger.info('Initializing DevAC workspace...');

        const configDir = '.devac';
        const configPath = path.join(configDir, 'config.json');

        // Check if config already exists
        try {
          await fs.access(configPath);
          if (!options.force) {
            logger.error(`DevAC already initialized in this directory (${configPath})`);
            logger.info('Use --force to overwrite existing configuration');
            process.exit(1);
          }
        } catch {
          // Config doesn't exist, proceed
        }

        // Create .devac directory structure
        await fs.mkdir(configDir, { recursive: true });
        await fs.mkdir(path.join(configDir, 'snapshots'), { recursive: true });

        // Create config
        const config = { ...DEFAULT_DEVAC_CONFIG };

        // Set workspace name if provided
        if (options.name) {
          config.workspace = {
            ...config.workspace,
            name: options.name,
          };
        }

        // TODO: Implement interactive mode
        if (options.interactive) {
          logger.warn('Interactive mode not yet implemented');
          logger.info('Using default configuration');
        }

        // Write config file
        await fs.writeFile(
          configPath,
          JSON.stringify(config, null, 2),
          'utf-8'
        );

        logger.info(`Created DevAC configuration at: ${configPath}`);

        // Create log directories
        await fs.mkdir('logs/codegraph', { recursive: true });
        await fs.mkdir('logs/git', { recursive: true });
        await fs.mkdir('logs/build', { recursive: true });
        await fs.mkdir('logs/test', { recursive: true });

        // Create data directory
        await fs.mkdir('data/collections', { recursive: true });

        logger.info('Created log and data directories');

        // Create .gitignore for .devac if needed
        const gitignorePath = path.join(configDir, '.gitignore');
        await fs.writeFile(
          gitignorePath,
          `# DevAC runtime files
snapshots/
*.log
`,
          'utf-8'
        );

        logger.info('✓ DevAC initialized successfully!');
        logger.info('');
        logger.info('Next steps:');
        logger.info('  1. Edit .devac/config.json to configure services');
        logger.info('  2. Run "devac start" to start the command center');
        logger.info('  3. Open http://localhost:3000 in your browser (when web UI is ready)');

      } catch (error: any) {
        logger.error(`Failed to initialize DevAC: ${error.message}`, {
          stack: error.stack,
        });
        process.exit(1);
      }
    });
}
