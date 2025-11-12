// src/devac/services/typecheck/typecheck-service.ts

import {
  CommandBasedService,
  type CommandResult,
  type CommandError,
} from "../command-based-service.js";
import type { TypeCheckServiceConfig } from "../../types/index.js";
import { EventBus } from "../../orchestrator/event-bus.js";

/**
 * TypeCheck Service
 *
 * Runs TypeScript type checking across configured repositories.
 * Supports workspace-aware execution strategies.
 *
 * Per spec v1.3.0:
 * - Does NOT include code snippets initially (file/line/column only)
 * - Parses TypeScript compiler output
 * - Supports watch mode via tsc --watch
 */
export class TypeCheckService extends CommandBasedService {
  private config: TypeCheckServiceConfig;
  private eventBus: EventBus;
  private watchers: Map<string, any> = new Map();

  constructor(config: TypeCheckServiceConfig, eventBus: EventBus) {
    super("TypeCheckService");
    this.config = config;
    this.eventBus = eventBus;
  }

  /**
   * Start the TypeCheck service
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info("TypeCheck service is disabled");
      return;
    }

    this.logger.info(
      `Starting TypeCheck service with ${this.config.repositories.length} repositories`,
    );

    // Run initial check for all repositories
    for (const repo of this.config.repositories) {
      await this.checkRepository(repo.path);

      // Start watcher if enabled
      if (repo.watch) {
        await this.startWatcher(repo.path);
      }
    }

    this.emitStatus("running", "TypeCheck service is running");
  }

  /**
   * Stop the TypeCheck service
   */
  async stop(): Promise<void> {
    this.logger.info("Stopping TypeCheck service");

    // Stop all watchers
    for (const [repoPath, watcher] of this.watchers) {
      this.logger.info(`Stopping watcher for ${repoPath}`);
      // TODO: Implement watcher stop when we add watch mode
    }
    this.watchers.clear();

    // Kill all running processes
    this.killAllProcesses();

    this.emitStatus("stopped", "TypeCheck service stopped");
  }

  /**
   * Run type check for a specific repository
   */
  async checkRepository(repositoryPath: string): Promise<void> {
    const repoConfig = this.config.repositories.find(
      (r) => r.path === repositoryPath,
    );

    if (!repoConfig) {
      this.logger.warn(
        `No configuration found for repository: ${repositoryPath}`,
      );
      return;
    }

    this.emitStatus("processing", `Type checking ${repositoryPath}`);

    try {
      const { errors, result } = await this.runRepository(repoConfig);

      if (errors.length === 0) {
        this.logger.info(`No type errors in ${repositoryPath}`);
        this.emitTypeCheckSuccess(repositoryPath, result);
      } else {
        this.logger.warn(
          `Found ${errors.length} type errors in ${repositoryPath}`,
        );
        this.emitTypeCheckErrors(repositoryPath, errors, result);
      }
    } catch (error) {
      this.logger.error(`TypeCheck failed for ${repositoryPath}`, { error });
      this.emitStatus("error", `TypeCheck failed: ${error}`);
    }
  }

  /**
   * Start file watcher for a repository
   */
  private async startWatcher(repositoryPath: string): Promise<void> {
    // TODO: Implement watch mode in future iteration
    // For now, just log that watch mode would be enabled
    this.logger.info(
      `Watch mode would be enabled for ${repositoryPath} (not implemented yet)`,
    );
  }

  /**
   * Parse TypeScript compiler errors
   *
   * TypeScript output format:
   * src/file.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
   */
  protected parseErrors(
    result: CommandResult,
    repositoryPath: string,
  ): CommandError[] {
    const errors: CommandError[] = [];
    const output = result.stdout + result.stderr;

    // TypeScript error pattern: path/file.ts(line,col): error TSxxxx: message
    const tsErrorRegex =
      /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm;

    let match;
    while ((match = tsErrorRegex.exec(output)) !== null) {
      if (
        match[1] &&
        match[2] &&
        match[3] &&
        match[4] &&
        match[5] &&
        match[6]
      ) {
        const file = match[1];
        const line = match[2];
        const column = match[3];
        const severity = match[4];
        const code = match[5];
        const message = match[6];

        errors.push({
          file: file.trim(),
          line: parseInt(line, 10),
          column: parseInt(column, 10),
          severity: severity as "error" | "warning",
          code,
          message: message.trim(),
        });
      }
    }

    return errors;
  }

  /**
   * Emit status update event
   */
  private emitStatus(
    status: "idle" | "running" | "processing" | "error" | "stopped",
    message: string,
  ): void {
    this.eventBus.publish(
      {
        type: "SERVICE_STATE_CHANGED",
        service: "typecheck",
        state: status,
        timestamp: new Date().toISOString(),
        metadata: { message },
      },
      "typecheck",
    );
  }

  /**
   * Emit successful typecheck event
   */
  private emitTypeCheckSuccess(
    repositoryPath: string,
    result: CommandResult,
  ): void {
    this.eventBus.publish(
      {
        type: "SERVICE_STATE_CHANGED",
        service: "typecheck",
        state: "running",
        timestamp: new Date().toISOString(),
        metadata: {
          repository: repositoryPath,
          success: true,
          duration: result.duration,
          errorCount: 0,
        },
      },
      "typecheck",
    );
  }

  /**
   * Emit typecheck errors event
   */
  private emitTypeCheckErrors(
    repositoryPath: string,
    errors: CommandError[],
    result: CommandResult,
  ): void {
    this.eventBus.publish(
      {
        type: "SERVICE_STATE_CHANGED",
        service: "typecheck",
        state: "running",
        timestamp: new Date().toISOString(),
        metadata: {
          repository: repositoryPath,
          success: false,
          duration: result.duration,
          errorCount: errors.length,
          errors: errors.map((e) => ({
            file: e.file,
            line: e.line,
            column: e.column,
            severity: e.severity,
            code: e.code,
            message: e.message,
            // No snippet for typecheck per spec v1.3.0
          })),
        },
      },
      "typecheck",
    );
  }
}
