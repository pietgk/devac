// test-setup/types.ts

/**
 * Result returned by any database strategy.
 * Contains connection details and cleanup function.
 */
export interface DbStrategyResult {
  /** Database connection URI */
  uri: string;

  /** Database username */
  username: string;

  /** Database password */
  password: string;

  /** Database name to use */
  database: string;

  /** Cleanup function to call after tests */
  cleanup: () => Promise<void>;

  /** Which strategy was used to provide this connection */
  strategy: 'service' | 'container' | 'native';

  /** Specific provider within the strategy (e.g., 'test-harness', 'docker', 'manual') */
  provider?: string;

  /** Startup time in milliseconds */
  startupTime?: number;
}

/**
 * Configuration for database connection strategies.
 */
export interface DbStrategyConfig {
  /** Database type */
  type: 'neo4j' | 'postgresql' | 'mysql' | 'dynamodb';

  /** Database version (e.g., '5', '14', '8') */
  version?: string;

  /** Service strategy configuration */
  service?: {
    enabled: boolean;
    uri?: string;
    username?: string;
    password?: string;
    database?: string;
    port?: number;
  };

  /** Container strategy configuration */
  container?: {
    enabled: boolean;
    image?: string;
    tag?: string;
  };

  /** Native strategy configuration */
  native?: {
    enabled: boolean;
    provider?: string; // Database-specific (e.g., 'test-harness', 'zonky')
    javaHome?: string;
  };
}

/**
 * Environment detection results.
 */
export interface EnvironmentCapabilities {
  /** Is there a database service already running? */
  hasService: boolean;

  /** Service connection details if detected */
  serviceDetails?: {
    host: string;
    port: number;
  };

  /** Is Docker available? */
  hasDocker: boolean;

  /** Docker version if available */
  dockerVersion?: string;

  /** Is Java available? */
  hasJava: boolean;

  /** Java version if available */
  javaVersion?: string;

  /** Java home path */
  javaHome?: string;
}

/**
 * Logger interface for strategy execution.
 */
export interface StrategyLogger {
  info(message: string, meta?: Record<string, any>): void;
  warn(message: string, meta?: Record<string, any>): void;
  error(message: string, meta?: Record<string, any>): void;
  debug(message: string, meta?: Record<string, any>): void;
}

/**
 * Base interface for database strategies.
 */
export interface DatabaseStrategy {
  /** Strategy name */
  name: 'service' | 'container' | 'native';

  /** Check if this strategy can be used in current environment */
  canUse(): Promise<boolean>;

  /** Start database and return connection details */
  start(config: DbStrategyConfig, logger: StrategyLogger): Promise<DbStrategyResult>;

  /** Stop database and cleanup resources */
  stop(): Promise<void>;
}
