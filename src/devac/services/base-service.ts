// src/devac/services/base-service.ts

import { setup, assign, fromPromise, fromCallback, type ActorRefFrom } from 'xstate';
import { createContextLogger } from '../../utils/logger.js';
import type {
  ServiceConfig,
  ServiceStatus,
  HealthStatus,
  CollectionStats,
  ServiceOutput,
  ResourceReference,
} from '../types/index.js';

/**
 * Base context for all services
 */
export interface BaseServiceContext {
  config: ServiceConfig;
  status: ServiceStatus;
  health: HealthStatus;
  stats: CollectionStats;
  error?: Error;
  currentCollectionId?: string;
}

/**
 * Base events for all services
 */
export type BaseServiceEvent =
  | { type: 'START' }
  | { type: 'STOP'; graceful?: boolean }
  | { type: 'RETRY' }
  | { type: 'HEALTH_CHECK' }
  | { type: 'FILE_CHANGED'; path: string; changeType: 'add' | 'change' | 'unlink' }
  | { type: 'SCAN_COMPLETE'; itemsFound: number }
  | { type: 'PROCESSING_COMPLETE'; output: ServiceOutput }
  | { type: 'ERROR'; error: Error };

/**
 * Service actor input
 */
export interface ServiceActorInput {
  config: ServiceConfig;
}

/**
 * Abstract base class for implementing services
 * Services extending this must implement the scanner, watcher, and processor
 */
export abstract class BaseService {
  protected logger: ReturnType<typeof createContextLogger>;
  protected config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
    this.logger = createContextLogger(`Service:${config.name}`);
  }

  /**
   * Initialize the service (called once on start)
   */
  protected abstract initialize(): Promise<void>;

  /**
   * Scan for initial items to process
   */
  protected abstract scan(): Promise<{ itemsFound: number }>;

  /**
   * Set up file/change watching
   */
  protected abstract startWatcher(
    sendEvent: (event: BaseServiceEvent) => void
  ): () => void;

  /**
   * Process changes/items
   */
  protected abstract process(input: any): Promise<ServiceOutput>;

  /**
   * Cleanup resources
   */
  protected abstract cleanup(): Promise<void>;

  /**
   * Create the XState machine for this service
   */
  public createMachine() {
    const self = this;

    return setup({
      types: {
        context: {} as BaseServiceContext,
        events: {} as BaseServiceEvent,
        input: {} as ServiceActorInput,
      },
      actors: {
        initializer: fromPromise(async () => {
          await self.initialize();
        }),
        scanner: fromPromise(async () => {
          return await self.scan();
        }),
        watcher: fromCallback(({ sendBack }) => {
          return self.startWatcher((event) => sendBack(event));
        }),
        processor: fromPromise(async ({ input }) => {
          return await self.process(input);
        }),
      },
      actions: {
        logStart: ({ context }) => {
          self.logger.info(`Service ${context.config.name} starting...`);
        },
        logStop: ({ context }) => {
          self.logger.info(`Service ${context.config.name} stopping...`);
        },
        logError: ({ context, event }) => {
          if ('error' in event) {
            self.logger.error(`Service ${context.config.name} error: ${event.error.message}`, {
              stack: event.error.stack,
            });
          }
        },
        updateStats: assign({
          stats: ({ context, event }) => {
            if (event.type === 'PROCESSING_COMPLETE') {
              return event.output.stats;
            }
            return context.stats;
          },
        }),
        setHealthy: assign({
          health: 'healthy',
        }),
        setDegraded: assign({
          health: 'degraded',
        }),
        setError: assign({
          health: 'error',
          error: ({ event }) => ('error' in event ? event.error : undefined),
        }),
      },
    }).createMachine({
      id: `service-${this.config.id}`,
      initial: 'idle',
      context: ({ input }: { input: ServiceActorInput }) => ({
        config: input.config,
        status: 'idle' as ServiceStatus,
        health: 'healthy' as HealthStatus,
        stats: {
          itemsProcessed: 0,
          nodesCreated: 0,
          relationshipsCreated: 0,
          duration: 0,
          errors: 0,
          warnings: 0,
        },
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
            onDone: {
              target: 'scanning',
              actions: 'setHealthy',
            },
            onError: {
              target: 'error',
              actions: ['logError', 'setError'],
            },
          },
        },
        scanning: {
          invoke: {
            src: 'scanner',
            onDone: {
              target: 'watching',
              actions: assign({
                status: 'watching',
              }),
            },
            onError: {
              target: 'degraded',
              actions: ['logError', 'setDegraded'],
            },
          },
        },
        watching: {
          entry: assign({
            status: 'watching',
          }),
          invoke: {
            src: 'watcher',
          },
          on: {
            FILE_CHANGED: {
              target: 'processing',
            },
            STOP: 'stopping',
            HEALTH_CHECK: {
              actions: () => {
                self.logger.debug('Health check OK');
              },
            },
          },
        },
        processing: {
          entry: assign({
            status: 'processing',
          }),
          invoke: {
            src: 'processor',
            input: ({ event }) => event,
            onDone: {
              target: 'watching',
              actions: ['updateStats', 'setHealthy'],
            },
            onError: {
              target: 'degraded',
              actions: ['logError', 'setDegraded'],
            },
          },
        },
        degraded: {
          entry: assign({
            status: 'degraded',
          }),
          on: {
            RETRY: 'watching',
            STOP: 'stopping',
          },
          after: {
            5000: {
              target: 'watching',
              actions: () => {
                self.logger.info('Auto-retrying after degraded state...');
              },
            },
          },
        },
        error: {
          entry: [
            assign({
              status: 'error',
            }),
            'logError',
          ],
          on: {
            RETRY: 'initializing',
            STOP: 'stopping',
          },
        },
        stopping: {
          entry: ['logStop', assign({ status: 'stopping' })],
          invoke: {
            src: fromPromise(async () => {
              await self.cleanup();
            }),
            onDone: 'stopped',
            onError: {
              target: 'stopped',
              actions: 'logError',
            },
          },
        },
        stopped: {
          entry: assign({
            status: 'stopped',
          }),
          type: 'final',
        },
      },
    });
  }
}

/**
 * Service actor reference type
 */
export type ServiceActorRef = ActorRefFrom<ReturnType<BaseService['createMachine']>>;
