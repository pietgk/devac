// src/devac/orchestrator/orchestrator.ts

import { setup, assign, fromPromise, createActor, type ActorRefFrom } from 'xstate';
import { ServiceRegistry } from './service-registry.js';
import { EventBus } from './event-bus.js';
import { createContextLogger } from '../../utils/logger.js';
import type { DevACConfig, WorkspaceConfig } from '../types/index.js';
import type { ServiceActorRef } from '../services/base-service.js';

const logger = createContextLogger('Orchestrator');

/**
 * Orchestrator context
 */
export interface OrchestratorContext {
  config: DevACConfig;
  workspace?: WorkspaceConfig;
  registry: ServiceRegistry;
  eventBus: EventBus;
  startedAt?: string;
  error?: Error;
}

/**
 * Orchestrator events
 */
export type OrchestratorEvent =
  | { type: 'START' }
  | { type: 'STOP'; graceful?: boolean }
  | { type: 'LOAD_WORKSPACE'; workspace: WorkspaceConfig }
  | { type: 'START_SERVICE'; serviceId: string }
  | { type: 'STOP_SERVICE'; serviceId: string }
  | { type: 'RESTART_SERVICE'; serviceId: string }
  | { type: 'SERVICE_FAILED'; serviceId: string; error: Error }
  | { type: 'ERROR'; error: Error };

/**
 * Orchestrator actor input
 */
export interface OrchestratorInput {
  config: DevACConfig;
  workspace?: WorkspaceConfig;
}

/**
 * Create the orchestrator machine
 */
export function createOrchestratorMachine() {
  return setup({
    types: {
      context: {} as OrchestratorContext,
      events: {} as OrchestratorEvent,
      input: {} as OrchestratorInput,
    },
    actors: {
      initializer: fromPromise(async ({ input }: { input: OrchestratorContext }) => {
        logger.info('Initializing orchestrator...');

        // Set up event bus subscriptions
        input.eventBus.subscribe('*', (envelope) => {
          logger.debug(`Event received: ${envelope.event.type}`, {
            source: envelope.source,
            target: envelope.target,
          });
        });

        logger.info('Orchestrator initialized');
        return input;
      }),
      serviceStarter: fromPromise(async ({ input }: { input: { serviceId: string; registry: ServiceRegistry } }) => {
        const { serviceId, registry } = input;
        const service = registry.get(serviceId);

        if (!service) {
          throw new Error(`Service ${serviceId} not found in registry`);
        }

        logger.info(`Starting service: ${serviceId}`);
        service.send({ type: 'START' });

        return { serviceId };
      }),
      serviceStopper: fromPromise(async ({ input }: { input: { serviceId: string; registry: ServiceRegistry; graceful?: boolean } }) => {
        const { serviceId, registry, graceful = true } = input;
        const service = registry.get(serviceId);

        if (!service) {
          throw new Error(`Service ${serviceId} not found in registry`);
        }

        logger.info(`Stopping service: ${serviceId}${graceful ? ' (graceful)' : ''}`);
        service.send({ type: 'STOP', graceful });

        return { serviceId };
      }),
      cleanup: fromPromise(async ({ input }: { input: OrchestratorContext }) => {
        logger.info('Cleaning up orchestrator...');

        // Stop all services
        const serviceIds = input.registry.getServiceIds();

        for (const serviceId of serviceIds) {
          const service = input.registry.get(serviceId);
          if (service) {
            try {
              logger.debug(`Stopping service: ${serviceId}`);
              service.send({ type: 'STOP', graceful: true });

              // Wait a bit for graceful shutdown
              await new Promise((resolve) => setTimeout(resolve, 1000));
            } catch (error: any) {
              logger.error(`Error stopping service ${serviceId}: ${error.message}`);
            }
          }
        }

        // Clear registry
        input.registry.clear();

        // Clear event bus
        input.eventBus.removeAllListeners();
        input.eventBus.clearHistory();

        logger.info('Orchestrator cleanup complete');
      }),
    },
    actions: {
      logStart: () => {
        logger.info('Orchestrator starting...');
      },
      logStop: () => {
        logger.info('Orchestrator stopping...');
      },
      logError: ({ event }) => {
        if ('error' in event) {
          logger.error(`Orchestrator error: ${event.error.message}`, {
            stack: event.error.stack,
          });
        }
      },
      publishEvent: ({ context, event }) => {
        context.eventBus.publish(event as any, 'orchestrator');
      },
    },
  }).createMachine({
    id: 'orchestrator',
    initial: 'idle',
    context: ({ input }: { input: OrchestratorInput }) => ({
      config: input.config,
      workspace: input.workspace,
      registry: new ServiceRegistry(),
      eventBus: new EventBus(),
    }),
    states: {
      idle: {
        on: {
          START: 'initializing',
        },
      },
      initializing: {
        entry: 'logStart',
        invoke: {
          src: 'initializer',
          input: ({ context }) => context,
          onDone: {
            target: 'running',
            actions: assign({
              startedAt: () => new Date().toISOString(),
            }),
          },
          onError: {
            target: 'error',
            actions: ['logError', assign({ error: ({ event }) => event.error })],
          },
        },
      },
      running: {
        on: {
          STOP: 'stopping',
          LOAD_WORKSPACE: {
            actions: assign({
              workspace: ({ event }) => event.workspace,
            }),
          },
          START_SERVICE: {
            actions: ({ context, event }) => {
              context.eventBus.publish(
                { type: 'START_SERVICE', serviceId: event.serviceId },
                'orchestrator'
              );
            },
          },
          STOP_SERVICE: {
            actions: ({ context, event }) => {
              context.eventBus.publish(
                { type: 'STOP_SERVICE', serviceId: event.serviceId, graceful: true },
                'orchestrator'
              );
            },
          },
          RESTART_SERVICE: {
            actions: ({ context, event }) => {
              context.eventBus.publish(
                { type: 'RESTART_SERVICE', serviceId: event.serviceId },
                'orchestrator'
              );
            },
          },
          SERVICE_FAILED: {
            actions: ['logError', 'publishEvent'],
          },
          ERROR: {
            target: 'error',
            actions: ['logError', assign({ error: ({ event }) => event.error })],
          },
        },
      },
      error: {
        on: {
          START: 'initializing',
          STOP: 'stopping',
        },
      },
      stopping: {
        entry: 'logStop',
        invoke: {
          src: 'cleanup',
          input: ({ context }) => context,
          onDone: 'stopped',
          onError: {
            target: 'stopped',
            actions: 'logError',
          },
        },
      },
      stopped: {
        type: 'final',
      },
    },
  });
}

/**
 * Orchestrator class providing high-level API
 */
export class Orchestrator {
  private actor: ActorRefFrom<ReturnType<typeof createOrchestratorMachine>> | null = null;
  private logger = createContextLogger('Orchestrator');

  constructor(
    private config: DevACConfig,
    private workspace?: WorkspaceConfig
  ) {}

  /**
   * Start the orchestrator
   */
  start(): void {
    if (this.actor) {
      this.logger.warn('Orchestrator already started');
      return;
    }

    this.logger.info('Creating orchestrator actor...');

    const machine = createOrchestratorMachine();

    this.actor = createActor(machine, {
      input: {
        config: this.config,
        workspace: this.workspace,
      },
    });

    this.actor.start();
    this.actor.send({ type: 'START' });

    this.logger.info('Orchestrator started');
  }

  /**
   * Stop the orchestrator
   */
  async stop(graceful = true): Promise<void> {
    if (!this.actor) {
      this.logger.warn('Orchestrator not started');
      return;
    }

    this.logger.info(`Stopping orchestrator${graceful ? ' (graceful)' : ''}...`);
    this.actor.send({ type: 'STOP', graceful });

    // Wait for stopped state
    await new Promise<void>((resolve) => {
      const subscription = this.actor!.subscribe((snapshot) => {
        if (snapshot.matches('stopped')) {
          subscription.unsubscribe();
          resolve();
        }
      });
    });

    this.actor.stop();
    this.actor = null;

    this.logger.info('Orchestrator stopped');
  }

  /**
   * Get the service registry
   */
  getRegistry(): ServiceRegistry | undefined {
    return this.actor?.getSnapshot().context.registry;
  }

  /**
   * Get the event bus
   */
  getEventBus(): EventBus | undefined {
    return this.actor?.getSnapshot().context.eventBus;
  }

  /**
   * Check if orchestrator is running
   */
  isRunning(): boolean {
    return this.actor?.getSnapshot().matches('running') ?? false;
  }

  /**
   * Get orchestrator status
   */
  getStatus(): {
    status: string;
    startedAt?: string;
    serviceCount: number;
    error?: { message: string; stack?: string };
  } {
    if (!this.actor) {
      return {
        status: 'not_started',
        serviceCount: 0,
      };
    }

    const snapshot = this.actor.getSnapshot();

    return {
      status: snapshot.value as string,
      startedAt: snapshot.context.startedAt,
      serviceCount: snapshot.context.registry.count(),
      error: snapshot.context.error
        ? {
            message: snapshot.context.error.message,
            stack: snapshot.context.error.stack,
          }
        : undefined,
    };
  }

  /**
   * Register a service actor
   */
  registerService(serviceId: string, actor: ServiceActorRef, config: any): void {
    const registry = this.getRegistry();
    if (!registry) {
      throw new Error('Orchestrator not started');
    }

    registry.register(serviceId, actor, config);

    this.logger.info(`Service registered: ${serviceId}`);
  }

  /**
   * Start a service
   */
  startService(serviceId: string): void {
    if (!this.actor) {
      throw new Error('Orchestrator not started');
    }

    this.actor.send({ type: 'START_SERVICE', serviceId });
  }

  /**
   * Stop a service
   */
  stopService(serviceId: string): void {
    if (!this.actor) {
      throw new Error('Orchestrator not started');
    }

    this.actor.send({ type: 'STOP_SERVICE', serviceId });
  }

  /**
   * Restart a service
   */
  restartService(serviceId: string): void {
    if (!this.actor) {
      throw new Error('Orchestrator not started');
    }

    this.actor.send({ type: 'RESTART_SERVICE', serviceId });
  }
}
