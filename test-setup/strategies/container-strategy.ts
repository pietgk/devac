// test-setup/strategies/container-strategy.ts

import { exec } from 'child_process';
import { promisify } from 'util';
import { Neo4jContainer, type StartedNeo4jContainer } from '@testcontainers/neo4j';
import type {
  DatabaseStrategy,
  DbStrategyConfig,
  DbStrategyResult,
  StrategyLogger,
} from '../types.js';

const execAsync = promisify(exec);

/**
 * Container Strategy - uses Docker/Testcontainers to run database.
 *
 * This strategy provides strong isolation and production parity by running
 * the database in a Docker container. It's the preferred approach for CI/CD
 * environments and local development when Docker is available.
 *
 * Requirements:
 * - Docker daemon running
 * - Network access to pull container images
 * - Sufficient resources (memory, disk)
 *
 * Startup time: ~5-10 seconds (includes container pull on first run)
 * Isolation: Strong (separate container per test run)
 * Portability: Medium (requires Docker)
 *
 * Advantages:
 * - Strong isolation between test runs
 * - High production parity
 * - Version matrix testing capability
 * - Established tooling (Testcontainers)
 *
 * Disadvantages:
 * - Requires Docker runtime
 * - 5-10s startup overhead
 * - Resource intensive
 * - Fails in environments without Docker
 */
export class ContainerStrategy implements DatabaseStrategy {
  name: 'container' = 'container';
  private container: StartedNeo4jContainer | null = null;

  /**
   * Check if Docker is available and running.
   */
  async canUse(): Promise<boolean> {
    try {
      // Try to execute 'docker info' command
      await execAsync('docker info');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Start database container and return connection details.
   */
  async start(
    config: DbStrategyConfig,
    logger: StrategyLogger
  ): Promise<DbStrategyResult> {
    const startTime = Date.now();

    logger.info('Starting Container strategy (Docker/Testcontainers)');

    // Get container configuration
    const image = config.container?.image || 'neo4j';
    const tag = config.container?.tag || config.version || '5';
    const fullImage = `${image}:${tag}`;

    logger.debug('Container configuration', {
      image: fullImage,
      type: config.type,
    });

    try {
      // Start Neo4j container
      logger.debug('Pulling container image (may take time on first run)...');

      this.container = await new Neo4jContainer(fullImage)
        .withReuse() // Reuse container if possible (faster for multiple test runs)
        .start();

      const endTime = Date.now();
      const startupTime = endTime - startTime;

      // Get connection details from started container
      const uri = this.container.getBoltUri();
      const username = 'neo4j'; // Default Neo4j username
      const password = this.container.getPassword();

      logger.info('Container strategy started successfully', {
        startupTime: `${startupTime}ms`,
        uri,
        containerId: this.container.getId().substring(0, 12),
      });

      return {
        uri,
        username,
        password,
        database: 'neo4j', // Default database
        cleanup: async () => await this.stop(),
        strategy: 'container',
        provider: 'testcontainers',
        startupTime,
      };
    } catch (error) {
      logger.error('Failed to start container', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Container strategy failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Stop and remove container.
   */
  async stop(): Promise<void> {
    if (this.container) {
      try {
        await this.container.stop();
        this.container = null;
      } catch (error) {
        // Container may already be stopped
        console.warn(
          'Warning: Failed to stop container:',
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }
}
