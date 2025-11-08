// src/devac/types/config.ts

import { ServiceType } from './service.js';

/**
 * DevAC configuration structure
 */
export interface DevACConfig {
  /** Configuration version */
  version: string;
  /** Neo4j connection settings */
  neo4j: Neo4jConfig;
  /** Web server settings */
  web: WebConfig;
  /** Services configuration */
  services: ServicesConfig;
  /** Logging configuration */
  logging: LoggingConfig;
  /** Workspace settings */
  workspace?: WorkspaceSettings;
}

/**
 * Neo4j configuration
 */
export interface Neo4jConfig {
  /** Neo4j connection URI */
  uri: string;
  /** Neo4j username */
  username: string;
  /** Neo4j password */
  password: string;
  /** Default database name (will be overridden by workspace-specific databases) */
  database: string;
}

/**
 * Web server configuration
 */
export interface WebConfig {
  /** Server port */
  port: number;
  /** Server host */
  host: string;
  /** Enable CORS */
  cors: boolean;
  /** Static files directory */
  staticDir?: string;
}

/**
 * Services configuration
 */
export interface ServicesConfig {
  /** CodeGraph service config */
  codegraph?: CodeGraphServiceConfig;
  /** Git service config */
  git?: GitServiceConfig;
  /** Build service config */
  build?: BuildServiceConfig;
  /** Test service config */
  test?: TestServiceConfig;
  /** Custom services */
  custom?: Record<string, CustomServiceConfig>;
}

/**
 * Base service configuration
 */
export interface BaseServiceConfig {
  /** Whether service is enabled */
  enabled: boolean;
}

/**
 * CodeGraph service configuration
 */
export interface CodeGraphServiceConfig extends BaseServiceConfig {
  /** Directories to analyze */
  directories?: string[];
  /** File extensions to include */
  extensions?: string[];
  /** Patterns to ignore */
  ignore?: string[];
  /** Watch for changes */
  watch?: boolean;
}

/**
 * Git service configuration
 */
export interface GitServiceConfig extends BaseServiceConfig {
  /** Repository paths */
  repositories?: string[];
  /** Watch for git changes */
  watch?: boolean;
  /** Include commit history depth */
  historyDepth?: number;
}

/**
 * Build service configuration
 */
export interface BuildServiceConfig extends BaseServiceConfig {
  /** Build tool type (npm, maven, gradle, etc.) */
  buildTool?: string;
  /** Build output patterns */
  outputPatterns?: string[];
  /** Watch build outputs */
  watch?: boolean;
}

/**
 * Test service configuration
 */
export interface TestServiceConfig extends BaseServiceConfig {
  /** Test framework (jest, junit, pytest, etc.) */
  framework?: string;
  /** Test result file patterns */
  resultPatterns?: string[];
  /** Watch test results */
  watch?: boolean;
}

/**
 * Custom service configuration
 */
export interface CustomServiceConfig extends BaseServiceConfig {
  /** Service type */
  type: string;
  /** Custom configuration */
  config: Record<string, any>;
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  /** Log level */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** Maximum log file size (in bytes or human-readable like "10MB") */
  maxFileSize: string;
  /** Maximum number of log files to keep */
  maxFiles: number;
}

/**
 * Workspace settings
 */
export interface WorkspaceSettings {
  /** Auto-discover repositories */
  autoDiscover?: boolean;
  /** Workspace name */
  name?: string;
  /** Workspace metadata */
  metadata?: {
    branch?: string;
    stage?: string;
    tags?: string[];
  };
}

/**
 * Default DevAC configuration
 */
export const DEFAULT_DEVAC_CONFIG: DevACConfig = {
  version: '1.0.0',
  neo4j: {
    uri: 'bolt://localhost:7687',
    username: 'neo4j',
    password: 'password',
    database: 'devac',
  },
  web: {
    port: 3000,
    host: 'localhost',
    cors: true,
  },
  services: {
    codegraph: {
      enabled: false,
      extensions: ['.ts', '.js', '.py', '.java', '.go'],
      ignore: ['**/node_modules/**', '**/.git/**'],
      watch: true,
    },
    git: {
      enabled: false,
      watch: true,
      historyDepth: 100,
    },
    build: {
      enabled: false,
      watch: true,
    },
    test: {
      enabled: false,
      watch: true,
    },
  },
  logging: {
    level: 'info',
    maxFileSize: '10MB',
    maxFiles: 10,
  },
  workspace: {
    autoDiscover: true,
  },
};
