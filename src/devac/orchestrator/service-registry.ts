// src/devac/orchestrator/service-registry.ts

import type { ServiceActorRef } from '../services/base-service.js';
import type { ServiceConfig, ServiceMetadata } from '../types/index.js';
import { createContextLogger } from '../../utils/logger.js';

const logger = createContextLogger('ServiceRegistry');

/**
 * Registry for managing service actors
 */
export class ServiceRegistry {
  private services: Map<string, ServiceActorRef> = new Map();
  private configs: Map<string, ServiceConfig> = new Map();

  /**
   * Register a service actor
   */
  register(serviceId: string, actor: ServiceActorRef, config: ServiceConfig): void {
    if (this.services.has(serviceId)) {
      throw new Error(`Service ${serviceId} is already registered`);
    }

    this.services.set(serviceId, actor);
    this.configs.set(serviceId, config);
    logger.info(`Registered service: ${serviceId} (${config.type})`);
  }

  /**
   * Unregister a service actor
   */
  unregister(serviceId: string): void {
    this.services.delete(serviceId);
    this.configs.delete(serviceId);
    logger.info(`Unregistered service: ${serviceId}`);
  }

  /**
   * Get a service actor by ID
   */
  get(serviceId: string): ServiceActorRef | undefined {
    return this.services.get(serviceId);
  }

  /**
   * Get service configuration
   */
  getConfig(serviceId: string): ServiceConfig | undefined {
    return this.configs.get(serviceId);
  }

  /**
   * Check if service exists
   */
  has(serviceId: string): boolean {
    return this.services.has(serviceId);
  }

  /**
   * Get all service IDs
   */
  getServiceIds(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Get all services
   */
  getAll(): Map<string, ServiceActorRef> {
    return new Map(this.services);
  }

  /**
   * Get service metadata (status, health, stats)
   */
  getMetadata(serviceId: string): ServiceMetadata | undefined {
    const actor = this.services.get(serviceId);
    const config = this.configs.get(serviceId);

    if (!actor || !config) {
      return undefined;
    }

    const snapshot = actor.getSnapshot();

    return {
      config,
      status: snapshot.context.status,
      health: snapshot.context.health,
      stats: snapshot.context.stats,
      lastError: snapshot.context.error
        ? {
            message: snapshot.context.error.message,
            timestamp: new Date().toISOString(),
            stack: snapshot.context.error.stack,
          }
        : undefined,
      version: '1.0.0', // TODO: Get from service
    };
  }

  /**
   * Get metadata for all services
   */
  getAllMetadata(): Map<string, ServiceMetadata> {
    const metadata = new Map<string, ServiceMetadata>();

    for (const serviceId of this.services.keys()) {
      const meta = this.getMetadata(serviceId);
      if (meta) {
        metadata.set(serviceId, meta);
      }
    }

    return metadata;
  }

  /**
   * Get services by type
   */
  getByType(type: string): ServiceActorRef[] {
    const services: ServiceActorRef[] = [];

    for (const [id, config] of this.configs.entries()) {
      if (config.type === type) {
        const actor = this.services.get(id);
        if (actor) {
          services.push(actor);
        }
      }
    }

    return services;
  }

  /**
   * Clear all services
   */
  clear(): void {
    this.services.clear();
    this.configs.clear();
    logger.info('Registry cleared');
  }

  /**
   * Get count of registered services
   */
  count(): number {
    return this.services.size;
  }
}
