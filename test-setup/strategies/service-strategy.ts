// test-setup/strategies/service-strategy.ts

import net from 'net';
import type { DatabaseStrategy, DbStrategyConfig, DbStrategyResult, StrategyLogger } from '../types.js';

/**
 * Service Strategy - connects to pre-existing database.
 *
 * This is the fastest strategy (0ms startup) as it uses an already-running database.
 * Common use cases:
 * - Developer has Neo4j/PostgreSQL running locally
 * - CI environment has database service container pre-configured
 * - Shared development database
 *
 * Advantages:
 * - Instant startup
 * - No resource allocation needed
 * - Can use production-like configurations
 *
 * Disadvantages:
 * - Shared state between test runs (requires cleanup)
 * - Requires manual setup/maintenance
 * - Not isolated
 */
export class ServiceStrategy implements DatabaseStrategy {
  name: 'service' = 'service';
  private config: DbStrategyConfig | null = null;

  /**
   * Check if a database service is accessible.
   * Uses TCP port connectivity check.
   */
  async canUse(): Promise<boolean> {
    // Check if connection details are provided via environment or config
    const uri =
      process.env[this.getEnvVarName('URL')] ||
      process.env[this.getEnvVarName('URI')];

    if (uri) {
      return true; // If URI is provided, assume service is available
    }

    // Otherwise, check if service is running on default port
    const port = this.getDefaultPort();
    if (!port) return false;

    return await this.checkPort(port);
  }

  /**
   * Connect to existing database service.
   */
  async start(config: DbStrategyConfig, logger: StrategyLogger): Promise<DbStrategyResult> {
    this.config = config;
    const startTime = Date.now();

    logger.debug('Service strategy: Reading connection details...');

    // Get connection details from environment or config
    const uri = this.getUri();
    const username = this.getUsername();
    const password = this.getPassword();
    const database = this.getDatabase();

    logger.debug('Service strategy: Verifying connectivity...');

    // Verify connection is actually available
    if (!(await this.verifyConnection(uri, username, password))) {
      throw new Error(`Cannot connect to ${config.type} service at ${uri}`);
    }

    const endTime = Date.now();

    logger.info(`Service strategy: Connected to existing ${config.type} instance`, {
      database,
    });

    return {
      uri,
      username,
      password,
      database,
      cleanup: async () => {
        logger.debug('Service strategy: No cleanup needed (external service)');
      },
      strategy: 'service',
      provider: 'manual',
      startupTime: endTime - startTime,
    };
  }

  /**
   * Stop strategy (no-op for service strategy).
   */
  async stop(): Promise<void> {
    // Service strategy doesn't start anything, so nothing to stop
  }

  /**
   * Get database URI from environment or config.
   */
  private getUri(): string {
    const envUri =
      process.env[this.getEnvVarName('URL')] ||
      process.env[this.getEnvVarName('URI')];

    if (envUri) return envUri;

    if (this.config?.service?.uri) {
      return this.config.service.uri;
    }

    // Build default URI
    const protocol = this.getProtocol();
    const host = this.config?.service?.port ? 'localhost' : 'localhost';
    const port = this.config?.service?.port || this.getDefaultPort();

    return `${protocol}://${host}:${port}`;
  }

  /**
   * Get database username from environment or config.
   */
  private getUsername(): string {
    return (
      process.env[this.getEnvVarName('USERNAME')] ||
      process.env[this.getEnvVarName('USER')] ||
      this.config?.service?.username ||
      this.getDefaultUsername()
    );
  }

  /**
   * Get database password from environment or config.
   */
  private getPassword(): string {
    return (
      process.env[this.getEnvVarName('PASSWORD')] ||
      this.config?.service?.password ||
      this.getDefaultPassword()
    );
  }

  /**
   * Get database name from environment or config.
   */
  private getDatabase(): string {
    return (
      process.env[this.getEnvVarName('DATABASE')] ||
      this.config?.service?.database ||
      this.getDefaultDatabase()
    );
  }

  /**
   * Get environment variable name for database type.
   * e.g., NEO4J_URL, POSTGRES_URL, MYSQL_URL
   */
  private getEnvVarName(suffix: string): string {
    const dbType = this.config?.type.toUpperCase() || '';
    // Handle aliases
    if (dbType === 'POSTGRESQL') {
      return `POSTGRES_${suffix}`;
    }
    return `${dbType}_${suffix}`;
  }

  /**
   * Get protocol for database type.
   */
  private getProtocol(): string {
    const protocols: Record<string, string> = {
      neo4j: 'bolt',
      postgresql: 'postgresql',
      mysql: 'mysql',
      dynamodb: 'http',
    };
    return protocols[this.config?.type || ''] || 'unknown';
  }

  /**
   * Get default port for database type.
   */
  private getDefaultPort(): number {
    const ports: Record<string, number> = {
      neo4j: 7687,
      postgresql: 5432,
      mysql: 3306,
      dynamodb: 8000,
    };
    return ports[this.config?.type || ''] || 0;
  }

  /**
   * Get default username for database type.
   */
  private getDefaultUsername(): string {
    const usernames: Record<string, string> = {
      neo4j: 'neo4j',
      postgresql: 'postgres',
      mysql: 'root',
      dynamodb: 'local',
    };
    return usernames[this.config?.type || ''] || 'admin';
  }

  /**
   * Get default password for database type.
   */
  private getDefaultPassword(): string {
    const passwords: Record<string, string> = {
      neo4j: 'test1234',
      postgresql: 'postgres',
      mysql: 'root',
      dynamodb: 'local',
    };
    return passwords[this.config?.type || ''] || 'password';
  }

  /**
   * Get default database name for database type.
   */
  private getDefaultDatabase(): string {
    const databases: Record<string, string> = {
      neo4j: 'codegraph_test',
      postgresql: 'test',
      mysql: 'test',
      dynamodb: 'local',
    };
    return databases[this.config?.type || ''] || 'test';
  }

  /**
   * Check if port is accessible.
   */
  private async checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 1000);

      socket.on('connect', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      });

      socket.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });

      socket.connect(port, 'localhost');
    });
  }

  /**
   * Verify actual database connection.
   * This is a lightweight check - actual connection validation
   * happens when tests try to use the database.
   */
  private async verifyConnection(
    uri: string,
    username: string,
    password: string
  ): Promise<boolean> {
    // For now, just verify the port is accessible
    // Database-specific connection verification happens in tests
    try {
      const url = new URL(uri);
      const port = parseInt(url.port || this.getDefaultPort().toString(), 10);
      return await this.checkPort(port);
    } catch {
      return false;
    }
  }
}
