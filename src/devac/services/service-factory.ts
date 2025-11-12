// src/devac/services/service-factory.ts

import { createActor } from "xstate";
import path from "path";
import { CodeGraphService } from "./codegraph/index.js";
import { TypeCheckService } from "./typecheck/typecheck-service.js";
import { LintService } from "./lint/lint-service.js";
import { TestService } from "./test/test-service.js";
import { EventBus } from "../orchestrator/event-bus.js";
import { createContextLogger } from "../../utils/logger.js";
import type { ServiceActorRef } from "./base-service.js";
import type {
  DevACConfig,
  ServiceConfig,
  TypeCheckServiceConfig,
  LintServiceConfig,
  TestServiceConfigV2,
} from "../types/index.js";

const logger = createContextLogger("ServiceFactory");

/**
 * Service factory for creating and configuring service actors
 */
export class ServiceFactory {
  private eventBus: EventBus | null = null;

  constructor(
    private config: DevACConfig,
    private workspaceDir: string = path.resolve(process.cwd(), ".devac"),
  ) {}

  /**
   * Get or create shared EventBus instance
   */
  private getOrCreateEventBus(): EventBus {
    if (!this.eventBus) {
      this.eventBus = new EventBus();
    }
    return this.eventBus;
  }

  /**
   * Create all enabled services from config
   */
  createAllServices(): Array<{
    id: string;
    actor: ServiceActorRef;
    config: ServiceConfig;
  }> {
    const services: Array<{
      id: string;
      actor: ServiceActorRef;
      config: ServiceConfig;
    }> = [];

    // CodeGraph service
    if (this.config.services?.codegraph?.enabled) {
      const service = this.createCodeGraphService();
      if (service) {
        services.push(service);
      }
    }

    // TypeCheck service
    if (this.config.services?.typecheck?.enabled) {
      const service = this.createTypeCheckService();
      if (service) {
        services.push(service);
      }
    }

    // Lint service
    if (this.config.services?.lint?.enabled) {
      const service = this.createLintService();
      if (service) {
        services.push(service);
      }
    }

    // Test service
    if (this.config.services?.test?.enabled) {
      const service = this.createTestService();
      if (service) {
        services.push(service);
      }
    }

    logger.info(`Created ${services.length} services`);
    return services;
  }

  /**
   * Create CodeGraph service
   */
  private createCodeGraphService(): {
    id: string;
    actor: ServiceActorRef;
    config: ServiceConfig;
  } | null {
    try {
      logger.info("Creating CodeGraph service...");

      const serviceConfig: ServiceConfig = {
        id: "codegraph",
        name: "CodeGraph Analyzer",
        type: "codegraph",
        enabled: true,
        config: {
          directories: this.config.services.codegraph!.directories || ["./"],
          extensions: this.config.services.codegraph!.extensions || [
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".py",
          ],
          ignore: this.config.services.codegraph!.ignore || [
            "**/node_modules/**",
            "**/.git/**",
            "**/dist/**",
            "**/build/**",
          ],
          watch: this.config.services.codegraph!.watch ?? true,
          logDir: path.join(this.workspaceDir, "logs", "codegraph"),
          resourceDir: path.join(this.workspaceDir, "resources", "codegraph"),
          maxLogFileSize: 10 * 1024 * 1024, // 10MB
          maxLogFiles: 10,
          neo4j: {
            uri: this.config.neo4j.uri,
            username: this.config.neo4j.username,
            password: this.config.neo4j.password,
            database: this.config.neo4j.database,
          },
        },
      };

      const service = new CodeGraphService(serviceConfig);
      const machine = service.createMachine();
      const actor = createActor(machine, {
        input: { config: serviceConfig },
      });

      actor.start();

      logger.info("CodeGraph service created");
      return { id: "codegraph", actor, config: serviceConfig };
    } catch (error: any) {
      logger.error(`Failed to create CodeGraph service: ${error.message}`);
      return null;
    }
  }

  /**
   * Create TypeCheck service
   */
  private createTypeCheckService(): {
    id: string;
    actor: ServiceActorRef;
    config: ServiceConfig;
  } | null {
    try {
      logger.info("Creating TypeCheck service...");

      const typecheckConfig = this.config.services
        .typecheck as TypeCheckServiceConfig;

      const serviceConfig: ServiceConfig = {
        id: "typecheck",
        name: "TypeScript Type Checker",
        type: "typecheck",
        enabled: true,
        config: {
          repositories: typecheckConfig.repositories,
          logDir: path.join(this.workspaceDir, "logs", "typecheck"),
          maxLogFileSize: 10 * 1024 * 1024, // 10MB
          maxLogFiles: 10,
        },
      };

      // Note: TypeCheckService extends CommandBasedService, not BaseService
      // It doesn't use XState actors - it's a simpler service that runs commands
      // For now, we'll create a minimal actor wrapper
      // TODO: Refactor command-based services to use proper XState architecture
      const service = new TypeCheckService(
        typecheckConfig,
        this.getOrCreateEventBus(),
      ) as any;

      logger.info("TypeCheck service created");
      return { id: "typecheck", actor: service, config: serviceConfig };
    } catch (error: any) {
      logger.error(`Failed to create TypeCheck service: ${error.message}`);
      return null;
    }
  }

  /**
   * Create Lint service
   */
  private createLintService(): {
    id: string;
    actor: ServiceActorRef;
    config: ServiceConfig;
  } | null {
    try {
      logger.info("Creating Lint service...");

      const lintConfig = this.config.services.lint as LintServiceConfig;

      const serviceConfig: ServiceConfig = {
        id: "lint",
        name: "Code Linter",
        type: "lint",
        enabled: true,
        config: {
          repositories: lintConfig.repositories,
          includeSnippets: lintConfig.includeSnippets ?? true,
          logDir: path.join(this.workspaceDir, "logs", "lint"),
          maxLogFileSize: 10 * 1024 * 1024, // 10MB
          maxLogFiles: 10,
        },
      };

      // Note: LintService extends CommandBasedService, not BaseService
      // It doesn't use XState actors - it's a simpler service that runs commands
      // For now, we'll create a minimal actor wrapper
      // TODO: Refactor command-based services to use proper XState architecture
      const service = new LintService(
        lintConfig,
        this.getOrCreateEventBus(),
      ) as any;

      logger.info("Lint service created");
      return { id: "lint", actor: service, config: serviceConfig };
    } catch (error: any) {
      logger.error(`Failed to create Lint service: ${error.message}`);
      return null;
    }
  }

  /**
   * Create Test service
   */
  private createTestService(): {
    id: string;
    actor: ServiceActorRef;
    config: ServiceConfig;
  } | null {
    try {
      logger.info("Creating Test service...");

      const testConfig = this.config.services.test as TestServiceConfigV2;

      const serviceConfig: ServiceConfig = {
        id: "test",
        name: "Test Runner",
        type: "test",
        enabled: true,
        config: {
          repositories: testConfig.repositories,
          logDir: path.join(this.workspaceDir, "logs", "test"),
          maxLogFileSize: 10 * 1024 * 1024, // 10MB
          maxLogFiles: 10,
        },
      };

      // Note: TestService extends CommandBasedService, not BaseService
      // It doesn't use XState actors - it's a simpler service that runs commands
      // For now, we'll create a minimal actor wrapper
      // TODO: Refactor command-based services to use proper XState architecture
      const service = new TestService(
        testConfig,
        this.getOrCreateEventBus(),
      ) as any;

      logger.info("Test service created");
      return { id: "test", actor: service, config: serviceConfig };
    } catch (error: any) {
      logger.error(`Failed to create Test service: ${error.message}`);
      return null;
    }
  }
}
