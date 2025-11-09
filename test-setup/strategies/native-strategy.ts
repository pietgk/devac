// test-setup/strategies/native-strategy.ts

import { spawn, ChildProcess } from 'child_process';
import { access } from 'fs/promises';
import path from 'path';
import type {
  DatabaseStrategy,
  DbStrategyResult,
  DbStrategyConfig,
  StrategyLogger,
} from '../types.js';

/**
 * Native strategy using Neo4j Test Harness via Java subprocess.
 *
 * This strategy spawns a Java process running test-harness-wrapper.jar,
 * which starts an embedded Neo4j instance using Neo4j Test Harness.
 *
 * Requirements:
 * - Java 21+ installed
 * - test-harness-wrapper.jar built and available
 *
 * Startup time: ~3-7 seconds
 * Isolation: Strong (separate process)
 * Portability: Works everywhere (no Docker needed)
 */
export class NativeStrategy implements DatabaseStrategy {
  name: 'native' = 'native';
  private javaProcess: ChildProcess | null = null;
  private jarPath: string;

  constructor() {
    // Default JAR location (can be overridden via config)
    this.jarPath = path.join(
      process.cwd(),
      'test-harness-wrapper/target/test-harness-wrapper.jar'
    );
  }

  async canUse(): Promise<boolean> {
    try {
      // Check 1: Java available
      const javaAvailable = await this.checkJavaAvailable();
      if (!javaAvailable) {
        return false;
      }

      // Check 2: JAR file exists
      const jarExists = await this.checkJarExists();
      if (!jarExists) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  async start(
    config: DbStrategyConfig,
    logger: StrategyLogger
  ): Promise<DbStrategyResult> {
    const startTime = Date.now();

    logger.info('Starting Native strategy (Neo4j Test Harness)');
    logger.debug('JAR path', { jarPath: this.jarPath });

    // Override JAR path if specified in config
    if (config.native?.provider) {
      this.jarPath = config.native.provider;
    }

    // Start Java process
    const connectionDetails = await this.startJavaProcess(logger);

    const endTime = Date.now();
    const startupTime = endTime - startTime;

    logger.info('Native strategy started successfully', {
      startupTime: `${startupTime}ms`,
      uri: connectionDetails.uri,
    });

    return {
      uri: connectionDetails.uri,
      username: connectionDetails.username,
      password: connectionDetails.password,
      database: connectionDetails.database,
      cleanup: async () => await this.stop(),
      strategy: 'native',
      provider: 'neo4j-test-harness',
      startupTime,
    };
  }

  async stop(): Promise<void> {
    if (this.javaProcess) {
      return new Promise<void>((resolve) => {
        if (!this.javaProcess) {
          resolve();
          return;
        }

        // Set up timeout in case process doesn't terminate
        const timeout = setTimeout(() => {
          if (this.javaProcess) {
            this.javaProcess.kill('SIGKILL'); // Force kill
          }
          resolve();
        }, 5000); // 5 second timeout

        this.javaProcess.once('exit', () => {
          clearTimeout(timeout);
          this.javaProcess = null;
          resolve();
        });

        // Send termination signal
        this.javaProcess.kill('SIGTERM');
      });
    }
  }

  /**
   * Check if Java is available and meets version requirements.
   */
  private async checkJavaAvailable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const java = spawn('java', ['-version']);

      let versionOutput = '';
      java.stderr.on('data', (data) => {
        versionOutput += data.toString();
      });

      java.on('close', (code) => {
        if (code !== 0) {
          resolve(false);
          return;
        }

        // Check if Java 21+ (required for Neo4j Test Harness)
        const match = versionOutput.match(/version "(\d+)/);
        if (match && match[1]) {
          const majorVersion = parseInt(match[1], 10);
          resolve(majorVersion >= 21);
        } else {
          resolve(false);
        }
      });

      java.on('error', () => {
        resolve(false);
      });

      // Timeout after 2 seconds
      setTimeout(() => {
        java.kill();
        resolve(false);
      }, 2000);
    });
  }

  /**
   * Check if the test harness JAR file exists.
   */
  private async checkJarExists(): Promise<boolean> {
    try {
      await access(this.jarPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start the Java process and wait for it to be ready.
   * Returns connection details parsed from stdout.
   */
  private async startJavaProcess(
    logger: StrategyLogger
  ): Promise<{
    uri: string;
    username: string;
    password: string;
    database: string;
  }> {
    return new Promise((resolve, reject) => {
      // Spawn Java process with test harness wrapper
      logger.debug('Spawning Java process', {
        command: 'java',
        args: ['-jar', this.jarPath, '--port', 'auto'],
      });

      this.javaProcess = spawn('java', ['-jar', this.jarPath, '--port', 'auto'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const connectionDetails: {
        uri?: string;
        username?: string;
        password?: string;
        database?: string;
      } = {};

      let ready = false;
      let stdoutBuffer = '';
      let stderrBuffer = '';

      // Parse stdout for connection details
      this.javaProcess.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Parse connection details
          if (trimmed.startsWith('READY:')) {
            connectionDetails.uri = trimmed.substring(6).trim();
            ready = true;
          } else if (trimmed.startsWith('USERNAME:')) {
            connectionDetails.username = trimmed.substring(9).trim();
          } else if (trimmed.startsWith('PASSWORD:')) {
            connectionDetails.password = trimmed.substring(9).trim();
          } else if (trimmed.startsWith('DATABASE:')) {
            connectionDetails.database = trimmed.substring(9).trim();
          }

          // If all details received, resolve
          if (
            ready &&
            connectionDetails.uri &&
            connectionDetails.username &&
            connectionDetails.password &&
            connectionDetails.database
          ) {
            logger.info('Test Harness ready', {
              uri: connectionDetails.uri,
            });
            resolve({
              uri: connectionDetails.uri,
              username: connectionDetails.username,
              password: connectionDetails.password,
              database: connectionDetails.database,
            });
          }
        }
      });

      // Log stderr for debugging
      this.javaProcess.stderr?.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        if (message) {
          logger.debug('Test Harness stderr', { message });
          stderrBuffer += message + '\n';
        }
      });

      // Handle process errors
      this.javaProcess.on('error', (error) => {
        logger.error('Failed to start Java process', { error: error.message });
        reject(
          new Error(`Failed to start Neo4j Test Harness: ${error.message}`)
        );
      });

      // Handle unexpected process exit
      this.javaProcess.on('exit', (code, signal) => {
        if (!ready) {
          logger.error('Java process exited before ready', { code, signal });
          reject(
            new Error(
              `Neo4j Test Harness exited prematurely (code: ${code}, signal: ${signal})\n` +
                `stderr: ${stderrBuffer}`
            )
          );
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!ready) {
          logger.error('Timeout waiting for Test Harness');
          this.javaProcess?.kill();
          reject(
            new Error(
              'Timeout waiting for Neo4j Test Harness to start (30s)\n' +
                `stdout: ${stdoutBuffer}\n` +
                `stderr: ${stderrBuffer}`
            )
          );
        }
      }, 30000);
    });
  }
}
