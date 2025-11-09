// test-setup/strategy-logger.ts

import type { StrategyLogger } from './types.js';

/**
 * Console-based logger for database strategies.
 * Prefixes all messages with [DB-STRATEGY] for easy identification.
 */
export class ConsoleStrategyLogger implements StrategyLogger {
  private readonly prefix = '[DB-STRATEGY]';
  private readonly verbose: boolean;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
  }

  info(message: string, meta?: Record<string, any>): void {
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    console.log(`${this.prefix} [INFO] ${message}${metaStr}`);
  }

  warn(message: string, meta?: Record<string, any>): void {
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    console.warn(`${this.prefix} [WARN] ${message}${metaStr}`);
  }

  error(message: string, meta?: Record<string, any>): void {
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    console.error(`${this.prefix} [ERROR] ${message}${metaStr}`);
  }

  debug(message: string, meta?: Record<string, any>): void {
    if (!this.verbose) return;

    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    console.log(`${this.prefix} [DEBUG] ${message}${metaStr}`);
  }
}

/**
 * Silent logger for tests that don't want output.
 */
export class SilentStrategyLogger implements StrategyLogger {
  info(): void {}
  warn(): void {}
  error(): void {}
  debug(): void {}
}
