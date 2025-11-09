// test-setup/universal-db-manager.ts

import type { DbStrategyConfig, DbStrategyResult, DatabaseStrategy, StrategyLogger } from './types.js';
import { EnvironmentDetector } from './environment-detector.js';
import { ConsoleStrategyLogger } from './strategy-logger.js';

/**
 * Universal Database Manager
 *
 * Orchestrates database connection using a three-strategy approach:
 * 1. Service (pre-existing database) - fastest, 0ms startup
 * 2. Container (Docker) - strong isolation, 5-10s startup
 * 3. Native (embedded/binaries) - works everywhere, 3-7s startup
 *
 * Automatically selects the best available strategy based on environment capabilities.
 */
export class UniversalDatabaseManager {
  private strategies: DatabaseStrategy[] = [];
  private currentStrategy: DatabaseStrategy | null = null;
  private currentConnection: DbStrategyResult | null = null;
  private readonly logger: StrategyLogger;
  private readonly detector: EnvironmentDetector;

  constructor(logger?: StrategyLogger) {
    this.logger = logger || new ConsoleStrategyLogger(process.env.DEBUG_DB_STRATEGY === 'true');
    this.detector = new EnvironmentDetector();
  }

  /**
   * Register a strategy for use.
   * Strategies are tried in the order they are registered.
   */
  registerStrategy(strategy: DatabaseStrategy): void {
    this.strategies.push(strategy);
  }

  /**
   * Get a database connection using the best available strategy.
   *
   * @param config - Database configuration
   * @returns Connection details and cleanup function
   * @throws Error if no strategy can provide a connection
   */
  async getConnection(config: DbStrategyConfig): Promise<DbStrategyResult> {
    const startTime = Date.now();

    // Check for forced strategy via environment variable
    const forcedStrategy = process.env.FORCE_STRATEGY as 'service' | 'container' | 'native' | undefined;
    if (forcedStrategy) {
      this.logger.info(`Strategy forced via FORCE_STRATEGY: ${forcedStrategy}`);
    }

    // Detect environment capabilities
    this.logger.debug('Detecting environment capabilities...');
    const capabilities = await this.detector.detect(
      config.type,
      config.service?.port
    );

    this.logger.info('Environment capabilities detected', {
      hasService: capabilities.hasService,
      hasDocker: capabilities.hasDocker,
      hasJava: capabilities.hasJava,
      javaVersion: capabilities.javaVersion,
    });

    // Try each strategy in order
    for (const strategy of this.strategies) {
      // Skip if strategy is disabled in config
      const strategyConfig = this.getStrategyConfig(config, strategy.name);
      if (strategyConfig && strategyConfig.enabled === false) {
        this.logger.debug(`Strategy ${strategy.name} is disabled in config, skipping`);
        continue;
      }

      // Skip if forced strategy doesn't match
      if (forcedStrategy && strategy.name !== forcedStrategy) {
        continue;
      }

      // Check if strategy can be used
      this.logger.debug(`Checking if strategy ${strategy.name} can be used...`);
      const canUse = await strategy.canUse();

      if (!canUse) {
        this.logger.debug(`Strategy ${strategy.name} cannot be used, trying next...`);
        continue;
      }

      // Try to start database with this strategy
      try {
        this.logger.info(`Attempting strategy: ${strategy.name.toUpperCase()}`);

        const connection = await strategy.start(config, this.logger);
        const totalTime = Date.now() - startTime;

        this.currentStrategy = strategy;
        this.currentConnection = {
          ...connection,
          startupTime: connection.startupTime || totalTime,
        };

        // Log success
        this.logger.info(`✓ Strategy successful: ${strategy.name.toUpperCase()}`, {
          provider: connection.provider,
          database: connection.database,
          startupTime: `${this.currentConnection.startupTime}ms`,
        });

        // Log sanitized connection string
        const sanitizedUri = this.sanitizeUri(connection.uri);
        this.logger.info(`Connection: ${sanitizedUri}`);

        return this.currentConnection;
      } catch (error: any) {
        this.logger.warn(`Strategy ${strategy.name} failed: ${error.message}`);
        // Try next strategy
        continue;
      }
    }

    // No strategy worked
    const availableStrategies = this.strategies.map((s) => s.name).join(', ');
    throw new Error(
      `Cannot start ${config.type} database. ` +
        `Tried strategies: ${availableStrategies}. ` +
        `Environment: Docker=${capabilities.hasDocker}, ` +
        `Java=${capabilities.hasJava}, ` +
        `Service=${capabilities.hasService}. ` +
        `Enable Docker, configure a pre-existing service, or ensure Java is installed.`
    );
  }

  /**
   * Cleanup current connection and stop database.
   */
  async cleanup(): Promise<void> {
    if (this.currentConnection) {
      this.logger.debug('Cleaning up database connection...');
      try {
        await this.currentConnection.cleanup();
        this.logger.debug('Cleanup successful');
      } catch (error: any) {
        this.logger.warn(`Cleanup failed: ${error.message}`);
      }
    }

    if (this.currentStrategy) {
      try {
        await this.currentStrategy.stop();
      } catch (error: any) {
        this.logger.warn(`Strategy stop failed: ${error.message}`);
      }
    }

    this.currentStrategy = null;
    this.currentConnection = null;
  }

  /**
   * Get current connection details if available.
   */
  getCurrentConnection(): DbStrategyResult | null {
    return this.currentConnection;
  }

  /**
   * Get environment capabilities.
   * Useful for debugging or conditional test logic.
   */
  async getEnvironmentCapabilities(databaseType: string): Promise<any> {
    return await this.detector.detect(databaseType);
  }

  /**
   * Get strategy-specific config from overall config.
   */
  private getStrategyConfig(
    config: DbStrategyConfig,
    strategyName: string
  ): { enabled: boolean } | undefined {
    if (strategyName === 'service') return config.service;
    if (strategyName === 'container') return config.container;
    if (strategyName === 'native') return config.native;
    return undefined;
  }

  /**
   * Sanitize URI for logging (remove password).
   */
  private sanitizeUri(uri: string): string {
    try {
      const url = new URL(uri);
      if (url.password) {
        url.password = '***';
      }
      return url.toString();
    } catch {
      // If URI parsing fails, do simple replacement
      return uri.replace(/:([^:@]+)@/, ':***@');
    }
  }
}
