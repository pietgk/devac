// src/devac/services/command-based-service.ts

import { exec, type ChildProcess } from "child_process";
import { promisify } from "util";
import { createContextLogger } from "../../utils/logger.js";
import type { RepositoryConfig } from "../types/index.js";

const execAsync = promisify(exec);

/**
 * Base class for services that run shell commands
 * Used by TypeCheck, Lint, and Test services
 */

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
}

export interface CommandError {
  file: string;
  line?: number;
  column?: number;
  message: string;
  severity: "error" | "warning" | "info";
  code?: string;
  snippet?: string; // ±5 lines of code (for lint only)
}

export abstract class CommandBasedService {
  protected logger: ReturnType<typeof createContextLogger>;
  protected runningProcesses: Map<string, ChildProcess> = new Map();

  constructor(protected serviceName: string) {
    this.logger = createContextLogger(serviceName);
  }

  /**
   * Run a command and return the result
   */
  protected async runCommand(
    command: string,
    workingDirectory: string,
    repositoryPath: string,
  ): Promise<CommandResult> {
    const startTime = Date.now();
    this.logger.info(`Running command in ${workingDirectory}`, { command });

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workingDirectory,
        env: { ...process.env },
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      const duration = Date.now() - startTime;

      const result: CommandResult = {
        success: true,
        stdout,
        stderr,
        exitCode: 0,
        duration,
      };

      this.logger.info(`Command completed successfully`, {
        command,
        duration,
      });

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      // exec throws on non-zero exit codes, but we still get stdout/stderr
      const result: CommandResult = {
        success: false,
        stdout: error.stdout || "",
        stderr: error.stderr || error.message,
        exitCode: error.code || null,
        duration,
      };

      this.logger.warn(`Command completed with errors`, {
        command,
        exitCode: result.exitCode,
        duration,
      });

      return result;
    }
  }

  /**
   * Kill all running processes
   */
  protected killAllProcesses(): void {
    for (const [key, process] of this.runningProcesses) {
      this.logger.info(`Killing process: ${key}`);
      process.kill();
    }
    this.runningProcesses.clear();
  }

  /**
   * Parse command output into structured errors
   * Must be implemented by each service
   */
  protected abstract parseErrors(
    result: CommandResult,
    repositoryPath: string,
  ): CommandError[];

  /**
   * Extract code snippet around an error (for lint service)
   */
  protected async extractSnippet(
    filePath: string,
    line: number,
    contextLines: number = 5,
  ): Promise<string | undefined> {
    try {
      const fs = await import("fs/promises");
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      const startLine = Math.max(0, line - contextLines - 1);
      const endLine = Math.min(lines.length, line + contextLines);

      return lines.slice(startLine, endLine).join("\n");
    } catch (error) {
      this.logger.warn(`Failed to extract snippet from ${filePath}`, { error });
      return undefined;
    }
  }

  /**
   * Run command for a repository configuration
   */
  protected async runRepository(
    repoConfig: RepositoryConfig,
  ): Promise<{ errors: CommandError[]; result: CommandResult }> {
    const workingDir = repoConfig.workingDirectory || repoConfig.path;

    // For aggregate/single/turborepo strategies, run the command directly
    if (
      repoConfig.strategy === "aggregate" ||
      repoConfig.strategy === "single" ||
      repoConfig.strategy === "turborepo"
    ) {
      const result = await this.runCommand(
        repoConfig.command,
        workingDir,
        repoConfig.path,
      );
      const errors = this.parseErrors(result, repoConfig.path);
      return { errors, result };
    }

    // For per-package strategy, run each package
    if (repoConfig.strategy === "per-package" && repoConfig.packages) {
      const allErrors: CommandError[] = [];
      let combinedResult: CommandResult = {
        success: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
        duration: 0,
      };

      for (const pkg of repoConfig.packages) {
        if (!pkg.enabled) continue;

        const pkgWorkingDir = pkg.workingDirectory || repoConfig.path;
        const result = await this.runCommand(
          pkg.command,
          pkgWorkingDir,
          repoConfig.path,
        );

        const errors = this.parseErrors(result, repoConfig.path);
        allErrors.push(...errors);

        combinedResult.stdout += `\n[${pkg.name}]\n${result.stdout}`;
        combinedResult.stderr += `\n[${pkg.name}]\n${result.stderr}`;
        combinedResult.duration += result.duration;

        if (!result.success) {
          combinedResult.success = false;
        }
      }

      return { errors: allErrors, result: combinedResult };
    }

    // Should not reach here
    throw new Error(`Unknown strategy: ${repoConfig.strategy}`);
  }
}
