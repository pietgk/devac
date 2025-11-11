// src/devac/cli/demo-services.ts

import { createActor, setup, assign } from "xstate";
import type { ServiceActorRef } from "../services/base-service.js";
import type { ServiceConfig } from "../types/index.js";

/**
 * Create a mock demo service for testing the web UI
 */
export function createDemoService(
  serviceId: string,
  serviceName: string,
  serviceType: string,
) {
  const machine = setup({
    types: {
      context: {} as {
        status:
          | "idle"
          | "starting"
          | "running"
          | "stopping"
          | "stopped"
          | "error";
        health: "healthy" | "unhealthy" | "unknown";
        stats: {
          uptime: number;
          requestCount: number;
        };
        error?: Error;
        startTime?: number;
      },
      events: {} as
        | { type: "START" }
        | { type: "STOP"; graceful?: boolean }
        | { type: "HEALTH_CHECK" }
        | { type: "ERROR"; error: Error },
    },
  }).createMachine({
    id: serviceId,
    initial: "stopped",
    context: {
      status: "stopped",
      health: "unknown",
      stats: {
        uptime: 0,
        requestCount: 0,
      },
    },
    states: {
      stopped: {
        entry: assign({
          status: "stopped",
          health: "unknown",
          stats: { uptime: 0, requestCount: 0 },
        }),
        on: {
          START: {
            target: "starting",
          },
        },
      },
      starting: {
        entry: assign({
          status: "starting",
          health: "unknown",
        }),
        after: {
          1000: {
            target: "running",
          },
        },
      },
      running: {
        entry: assign({
          status: "running",
          health: "healthy",
          startTime: () => Date.now(),
        }),
        on: {
          STOP: {
            target: "stopping",
          },
          HEALTH_CHECK: {
            actions: assign({
              stats: ({ context }) => ({
                uptime: context.startTime ? Date.now() - context.startTime : 0,
                requestCount: context.stats.requestCount + 1,
              }),
            }),
          },
        },
      },
      stopping: {
        entry: assign({
          status: "stopping",
        }),
        after: {
          500: {
            target: "stopped",
          },
        },
      },
    },
  });

  const actor = createActor(machine);
  actor.start();

  return actor as unknown as ServiceActorRef;
}

/**
 * Register demo services with the orchestrator
 */
export function registerDemoServices(orchestrator: any) {
  const demoServices = [
    {
      id: "demo-api",
      name: "Demo API Service",
      type: "api",
    },
    {
      id: "demo-database",
      name: "Demo Database",
      type: "database",
    },
    {
      id: "demo-cache",
      name: "Demo Cache Service",
      type: "cache",
    },
  ];

  for (const service of demoServices) {
    const actor = createDemoService(service.id, service.name, service.type);

    const config: ServiceConfig = {
      id: service.id,
      name: service.name,
      type: service.type as any,
      enabled: true,
      config: {},
    };

    orchestrator.registerService(service.id, actor, config);
  }
}
