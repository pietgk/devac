# Phase 3: Web UI Foundation - Implementation Plan

**Date**: 2025-11-11
**Status**: 📋 Planning
**Branch**: TBD
**Approach**: TDD + Testing Trophy (tests first!)

---

## 🎯 Vision

Create a **simple, high-quality, real-time web UI** that provides visibility into the DevAC orchestrator and its services. The UI should feel like a **command center** - showing what's happening, allowing control, and adapting to future needs.

### Design Principles

1. **Simple First** - Start with minimal, essential features
2. **Real-Time** - Use SSE for live updates (not polling)
3. **Responsive** - Works on desktop and tablet
4. **Accessible** - Keyboard navigation, ARIA labels
5. **Extensible** - Plugin architecture for future views
6. **Type-Safe** - End-to-end TypeScript
7. **Tested** - Testing Trophy approach

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   Browser (Client)                   │
│  ┌─────────────────────────────────────────────┐   │
│  │         React App (Vite + TypeScript)        │   │
│  │  ┌────────────────────────────────────────┐ │   │
│  │  │  TanStack Router (file-based routing)  │ │   │
│  │  └────────────────────────────────────────┘ │   │
│  │  ┌────────────────────────────────────────┐ │   │
│  │  │  TanStack Query (server state)         │ │   │
│  │  └────────────────────────────────────────┘ │   │
│  │  ┌────────────────────────────────────────┐ │   │
│  │  │  SSE Client (real-time events)         │ │   │
│  │  └────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                        │
                 HTTP + SSE (EventSource)
                        │
┌─────────────────────────────────────────────────────┐
│              Fastify Server (Backend)                │
│  ┌─────────────────────────────────────────────┐   │
│  │  REST API Endpoints                          │   │
│  │  - GET  /api/services                        │   │
│  │  - GET  /api/services/:id                    │   │
│  │  - POST /api/services/:id/start              │   │
│  │  - POST /api/services/:id/stop               │   │
│  │  - GET  /api/collections                     │   │
│  │  - GET  /api/collections/:id                 │   │
│  │  - GET  /api/logs/:serviceId                 │   │
│  └─────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐   │
│  │  SSE Endpoint                                 │   │
│  │  - GET /api/events (Server-Sent Events)      │   │
│  └─────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐   │
│  │  Orchestrator Bridge                          │   │
│  │  - Subscribes to EventBus                     │   │
│  │  - Broadcasts to SSE clients                  │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                        │
                 Direct access
                        │
┌─────────────────────────────────────────────────────┐
│         Existing DevAC Orchestrator (XState)        │
│  - ServiceRegistry                                   │
│  - EventBus                                          │
│  - Service Actors (CodeGraph, etc.)                 │
└─────────────────────────────────────────────────────┘
                        │
                      Neo4j
```

### Key Architectural Decisions

**1. Server: Fastify**
- Fast, low-overhead HTTP server
- Native TypeScript support
- Built-in SSE support via `@fastify/sse`
- Easy testing with `fastify.inject()`

**2. Client: React + Vite**
- React 18 with concurrent features
- Vite for fast dev/build
- TypeScript strict mode
- No CSS framework initially (plain CSS modules)

**3. State Management**
- **Server State**: TanStack Query (automatic caching, refetching)
- **Real-Time**: SSE + EventSource API (native browser API)
- **UI State**: React useState/useReducer (keep it simple)
- **No Zustand/Redux**: Not needed for Phase 3

**4. Routing: TanStack Router**
- File-based routing (like Next.js)
- Type-safe routes
- Built-in loading states
- Code splitting

**5. Data Visualization**
- **Service Status**: Custom React components (cards, badges)
- **Logs**: Virtual scrolling with `@tanstack/react-virtual`
- **Graph**: Cytoscape.js (deferred to Phase 3.5)

---

## 📋 Implementation Tasks

### Task 1: Backend Foundation (Fastify Server)

**Duration**: 2-3 hours
**TDD**: Yes (tests first)

#### 1.1 Setup Fastify Server

**File**: `src/devac/web/server.ts`

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import sse from '@fastify/sse';
import type { Orchestrator } from '../orchestrator/orchestrator.js';

export interface WebServerOptions {
  port: number;
  host: string;
  cors: boolean;
  orchestrator: Orchestrator; // Reference to orchestrator
}

export async function createWebServer(options: WebServerOptions) {
  const server = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
      },
    },
  });

  // Plugins
  await server.register(cors, {
    origin: options.cors ? true : false,
  });
  await server.register(sse);

  // Health check
  server.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  return server;
}
```

**Test**: `src/devac/web/__tests__/server.integration.spec.ts`

```typescript
describe('Web Server - Integration', () => {
  it('should start server and respond to health check', async () => {
    const server = await createWebServer({
      port: 0, // Random port
      host: 'localhost',
      cors: true,
      orchestrator: mockOrchestrator,
    });

    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      timestamp: expect.any(String),
    });

    await server.close();
  });
});
```

#### 1.2 Service API Endpoints

**File**: `src/devac/web/routes/services.ts`

```typescript
import type { FastifyInstance } from 'fastify';
import type { ServiceRegistry } from '../../orchestrator/service-registry.js';

export async function registerServiceRoutes(
  server: FastifyInstance,
  registry: ServiceRegistry
) {
  // GET /api/services - List all services
  server.get('/api/services', async (request, reply) => {
    const serviceIds = registry.getServiceIds();
    const services = serviceIds.map(id => {
      const actor = registry.get(id);
      const config = registry.getConfig(id);
      const snapshot = actor.getSnapshot();

      return {
        id,
        name: config.name,
        type: config.type,
        status: snapshot.value, // XState state
        enabled: config.enabled,
      };
    });

    return { services };
  });

  // GET /api/services/:id - Get service details
  server.get<{ Params: { id: string } }>(
    '/api/services/:id',
    async (request, reply) => {
      const { id } = request.params;
      const actor = registry.get(id);

      if (!actor) {
        return reply.status(404).send({ error: 'Service not found' });
      }

      const config = registry.getConfig(id);
      const snapshot = actor.getSnapshot();

      return {
        id,
        name: config.name,
        type: config.type,
        status: snapshot.value,
        context: snapshot.context, // Full context
        config: config.config,
      };
    }
  );

  // POST /api/services/:id/start - Start service
  server.post<{ Params: { id: string } }>(
    '/api/services/:id/start',
    async (request, reply) => {
      const { id } = request.params;
      const actor = registry.get(id);

      if (!actor) {
        return reply.status(404).send({ error: 'Service not found' });
      }

      actor.send({ type: 'START' });

      return { success: true, serviceId: id };
    }
  );

  // POST /api/services/:id/stop - Stop service
  server.post<{ Params: { id: string } }>(
    '/api/services/:id/stop',
    async (request, reply) => {
      const { id } = request.params;
      const actor = registry.get(id);

      if (!actor) {
        return reply.status(404).send({ error: 'Service not found' });
      }

      actor.send({ type: 'STOP', graceful: true });

      return { success: true, serviceId: id };
    }
  );
}
```

**Test**: `src/devac/web/routes/__tests__/services.integration.spec.ts`

```typescript
describe('Service Routes - Integration', () => {
  let server: FastifyInstance;
  let registry: ServiceRegistry;

  beforeEach(async () => {
    registry = new ServiceRegistry();
    // Register test service
    const testService = createTestServiceActor();
    registry.register('test-service', testService, testConfig);

    server = await createWebServer({
      port: 0,
      host: 'localhost',
      cors: true,
      orchestrator: mockOrchestratorWithRegistry(registry),
    });
    await registerServiceRoutes(server, registry);
  });

  afterEach(async () => {
    await server.close();
  });

  it('should list all services', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/services',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.services).toHaveLength(1);
    expect(body.services[0]).toMatchObject({
      id: 'test-service',
      name: 'Test Service',
      type: 'custom',
      status: 'idle',
      enabled: true,
    });
  });

  it('should start a service', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/services/test-service/start',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      serviceId: 'test-service',
    });

    // Verify service received START event
    const actor = registry.get('test-service');
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).not.toBe('idle');
  });

  it('should return 404 for non-existent service', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/services/non-existent',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: 'Service not found',
    });
  });
});
```

#### 1.3 SSE Event Stream

**File**: `src/devac/web/routes/events.ts`

```typescript
import type { FastifyInstance } from 'fastify';
import type { EventBus } from '../../orchestrator/event-bus.js';

export async function registerEventStream(
  server: FastifyInstance,
  eventBus: EventBus
) {
  server.get('/api/events', async (request, reply) => {
    // Enable SSE
    reply.sse({ event: 'connected', data: JSON.stringify({ timestamp: new Date().toISOString() }) });

    // Subscribe to all events from event bus
    const unsubscribe = eventBus.subscribe('*', (envelope) => {
      // Send event to client
      reply.sse({
        event: envelope.event.type,
        data: JSON.stringify({
          id: envelope.event.id,
          type: envelope.event.type,
          serviceId: envelope.event.serviceId,
          timestamp: envelope.event.timestamp,
          payload: envelope.event.payload,
        }),
      });
    });

    // Cleanup on connection close
    request.raw.on('close', () => {
      unsubscribe();
    });
  });
}
```

**Test**: `src/devac/web/routes/__tests__/events.integration.spec.ts`

```typescript
describe('SSE Event Stream - Integration', () => {
  it('should stream events from event bus to client', async () => {
    // This requires a more complex test setup with EventSource client
    // Can use a test helper or mock EventSource

    const server = await createWebServer({ /* ... */ });
    await registerEventStream(server, eventBus);

    // Connect SSE client (test helper)
    const events: any[] = [];
    const client = await connectSSE(`http://localhost:${port}/api/events`);

    client.on('SERVICE_STARTED', (data) => {
      events.push(JSON.parse(data));
    });

    // Trigger event
    eventBus.publish({
      source: 'test',
      target: '*',
      event: {
        id: 'evt-1',
        type: 'SERVICE_STARTED',
        serviceId: 'test-service',
        timestamp: new Date().toISOString(),
        payload: {},
      },
    });

    // Wait for event
    await waitFor(() => events.length > 0);

    expect(events[0]).toMatchObject({
      type: 'SERVICE_STARTED',
      serviceId: 'test-service',
    });

    client.close();
    await server.close();
  });
});
```

---

### Task 2: Frontend Foundation (React + Vite)

**Duration**: 2-3 hours
**TDD**: Component tests with Testing Library

#### 2.1 Vite + React Setup

**File**: `src/devac/web/client/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3001, // Dev server port
    proxy: {
      '/api': {
        target: 'http://localhost:3000', // Fastify backend
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

**File**: `src/devac/web/client/src/main.tsx`

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen'; // Auto-generated

// Create query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000, // 5 seconds
      refetchOnWindowFocus: false,
    },
  },
});

// Create router
const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
});

// Type-safe router
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// Render app
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
```

#### 2.2 API Client

**File**: `src/devac/web/client/src/api/client.ts`

```typescript
export interface Service {
  id: string;
  name: string;
  type: string;
  status: string;
  enabled: boolean;
}

export interface ServiceDetail extends Service {
  context: any;
  config: any;
}

// Base API client
class APIClient {
  private baseURL = '/api';

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseURL}${path}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async post<T>(path: string, body?: any): Promise<T> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }
}

const apiClient = new APIClient();

// Service API
export const servicesAPI = {
  list: () => apiClient.get<{ services: Service[] }>('/services'),

  get: (id: string) => apiClient.get<ServiceDetail>(`/services/${id}`),

  start: (id: string) => apiClient.post<{ success: boolean }>(`/services/${id}/start`),

  stop: (id: string) => apiClient.post<{ success: boolean }>(`/services/${id}/stop`),
};
```

**Test**: `src/devac/web/client/src/api/__tests__/client.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { servicesAPI } from '../client';

describe('API Client', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('should fetch services list', async () => {
    const mockServices = {
      services: [
        { id: 'svc-1', name: 'Service 1', type: 'codegraph', status: 'idle', enabled: true },
      ],
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockServices,
    });

    const result = await servicesAPI.list();

    expect(global.fetch).toHaveBeenCalledWith('/api/services');
    expect(result).toEqual(mockServices);
  });

  it('should start a service', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const result = await servicesAPI.start('svc-1');

    expect(global.fetch).toHaveBeenCalledWith('/api/services/svc-1/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(result).toEqual({ success: true });
  });

  it('should throw error on HTTP failure', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(servicesAPI.get('non-existent')).rejects.toThrow('HTTP 404: Not Found');
  });
});
```

#### 2.3 SSE Hook

**File**: `src/devac/web/client/src/hooks/useSSE.ts`

```typescript
import { useEffect, useState } from 'react';

export interface SSEEvent {
  type: string;
  data: any;
}

export function useSSE(url: string) {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      setConnected(true);
      setError(null);
    };

    eventSource.onerror = (err) => {
      setConnected(false);
      setError(new Error('SSE connection failed'));
      console.error('SSE error:', err);
    };

    // Listen for all event types
    eventSource.addEventListener('SERVICE_STARTED', (e) => {
      setEvents((prev) => [...prev, { type: 'SERVICE_STARTED', data: JSON.parse(e.data) }]);
    });

    eventSource.addEventListener('SERVICE_STOPPED', (e) => {
      setEvents((prev) => [...prev, { type: 'SERVICE_STOPPED', data: JSON.parse(e.data) }]);
    });

    eventSource.addEventListener('COLLECTION_COMPLETED', (e) => {
      setEvents((prev) => [...prev, { type: 'COLLECTION_COMPLETED', data: JSON.parse(e.data) }]);
    });

    // Cleanup
    return () => {
      eventSource.close();
    };
  }, [url]);

  return { events, connected, error };
}
```

**Test**: `src/devac/web/client/src/hooks/__tests__/useSSE.test.tsx`

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useSSE } from '../useSSE';

// Mock EventSource
class MockEventSource {
  url: string;
  onopen: (() => void) | null = null;
  onerror: ((err: any) => void) | null = null;
  listeners: Map<string, (e: MessageEvent) => void> = new Map();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: (e: MessageEvent) => void) {
    this.listeners.set(type, listener);
  }

  close() {}
}

describe('useSSE Hook', () => {
  beforeEach(() => {
    (global as any).EventSource = MockEventSource;
  });

  it('should connect to SSE endpoint', async () => {
    const { result } = renderHook(() => useSSE('/api/events'));

    expect(result.current.connected).toBe(false);

    // Simulate connection
    const eventSource = (global as any).EventSource.mock.instances[0];
    eventSource.onopen?.();

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });
  });

  it('should receive events', async () => {
    const { result } = renderHook(() => useSSE('/api/events'));

    const eventSource = (global as any).EventSource.mock.instances[0];
    eventSource.onopen?.();

    // Simulate event
    const listener = eventSource.listeners.get('SERVICE_STARTED');
    listener?.({
      data: JSON.stringify({ serviceId: 'svc-1', timestamp: '2025-11-11T10:00:00Z' }),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0]).toMatchObject({
        type: 'SERVICE_STARTED',
        data: { serviceId: 'svc-1' },
      });
    });
  });
});
```

---

### Task 3: Dashboard UI

**Duration**: 3-4 hours
**TDD**: Component tests with Testing Library

#### 3.1 Dashboard Route

**File**: `src/devac/web/client/src/routes/index.tsx`

```typescript
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { servicesAPI } from '../api/client';
import { ServiceCard } from '../components/ServiceCard';
import { useSSE } from '../hooks/useSSE';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

function Dashboard() {
  // Fetch services
  const { data, isLoading, error } = useQuery({
    queryKey: ['services'],
    queryFn: () => servicesAPI.list(),
  });

  // Real-time updates
  const { events, connected } = useSSE('/api/events');

  if (isLoading) return <div>Loading services...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div className="dashboard">
      <header>
        <h1>DevAC Dashboard</h1>
        <div className="connection-status">
          {connected ? '🟢 Connected' : '🔴 Disconnected'}
        </div>
      </header>

      <div className="services-grid">
        {data?.services.map((service) => (
          <ServiceCard key={service.id} service={service} />
        ))}
      </div>

      <div className="recent-events">
        <h2>Recent Events</h2>
        <ul>
          {events.slice(-10).reverse().map((event, i) => (
            <li key={i}>
              <span className="event-type">{event.type}</span>
              <span className="event-time">{event.data.timestamp}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

#### 3.2 Service Card Component

**File**: `src/devac/web/client/src/components/ServiceCard.tsx`

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { servicesAPI, type Service } from '../api/client';

interface ServiceCardProps {
  service: Service;
}

export function ServiceCard({ service }: ServiceCardProps) {
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: () => servicesAPI.start(service.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => servicesAPI.stop(service.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });

  const statusColor = {
    idle: 'gray',
    initializing: 'blue',
    watching: 'green',
    processing: 'yellow',
    degraded: 'orange',
    error: 'red',
    stopped: 'gray',
  }[service.status as string] || 'gray';

  return (
    <div className="service-card">
      <div className="service-header">
        <h3>{service.name}</h3>
        <span className={`status-badge status-${statusColor}`}>
          {service.status}
        </span>
      </div>

      <div className="service-info">
        <div>Type: {service.type}</div>
        <div>ID: {service.id}</div>
      </div>

      <div className="service-actions">
        <button
          onClick={() => startMutation.mutate()}
          disabled={service.status !== 'idle' || startMutation.isPending}
        >
          {startMutation.isPending ? 'Starting...' : 'Start'}
        </button>
        <button
          onClick={() => stopMutation.mutate()}
          disabled={service.status === 'idle' || stopMutation.isPending}
        >
          {stopMutation.isPending ? 'Stopping...' : 'Stop'}
        </button>
      </div>
    </div>
  );
}
```

**Test**: `src/devac/web/client/src/components/__tests__/ServiceCard.test.tsx`

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { ServiceCard } from '../ServiceCard';
import { servicesAPI } from '../../api/client';

vi.mock('../../api/client');

describe('ServiceCard Component', () => {
  const mockService = {
    id: 'svc-1',
    name: 'Test Service',
    type: 'codegraph',
    status: 'idle',
    enabled: true,
  };

  const renderWithQuery = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    );
  };

  it('should render service information', () => {
    renderWithQuery(<ServiceCard service={mockService} />);

    expect(screen.getByText('Test Service')).toBeInTheDocument();
    expect(screen.getByText('idle')).toBeInTheDocument();
    expect(screen.getByText(/Type: codegraph/)).toBeInTheDocument();
  });

  it('should call start service API when start button clicked', async () => {
    (servicesAPI.start as any).mockResolvedValue({ success: true });

    renderWithQuery(<ServiceCard service={mockService} />);

    const startButton = screen.getByText('Start');
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(servicesAPI.start).toHaveBeenCalledWith('svc-1');
    });
  });

  it('should disable start button when service is not idle', () => {
    const runningService = { ...mockService, status: 'watching' };
    renderWithQuery(<ServiceCard service={runningService} />);

    const startButton = screen.getByText('Start');
    expect(startButton).toBeDisabled();
  });

  it('should show loading state during mutation', async () => {
    (servicesAPI.start as any).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100))
    );

    renderWithQuery(<ServiceCard service={mockService} />);

    const startButton = screen.getByText('Start');
    fireEvent.click(startButton);

    expect(screen.getByText('Starting...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Start')).toBeInTheDocument();
    });
  });
});
```

---

### Task 4: Service Detail View

**Duration**: 2-3 hours

#### 4.1 Service Detail Route

**File**: `src/devac/web/client/src/routes/services/$serviceId.tsx`

```typescript
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { servicesAPI } from '../../api/client';

export const Route = createFileRoute('/services/$serviceId')({
  component: ServiceDetail,
});

function ServiceDetail() {
  const { serviceId } = Route.useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ['services', serviceId],
    queryFn: () => servicesAPI.get(serviceId),
    refetchInterval: 2000, // Poll every 2 seconds
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  if (!data) return <div>Service not found</div>;

  return (
    <div className="service-detail">
      <header>
        <h1>{data.name}</h1>
        <span className={`status-badge status-${data.status}`}>
          {data.status}
        </span>
      </header>

      <section className="service-config">
        <h2>Configuration</h2>
        <pre>{JSON.stringify(data.config, null, 2)}</pre>
      </section>

      <section className="service-context">
        <h2>Runtime Context</h2>
        <pre>{JSON.stringify(data.context, null, 2)}</pre>
      </section>
    </div>
  );
}
```

---

### Task 5: Integration & Deployment

**Duration**: 1-2 hours

#### 5.1 Integrate Web Server with CLI

**File**: `src/devac/cli/commands/start.ts` (modify existing)

```typescript
import { createWebServer } from '../../web/server.js';
import { registerServiceRoutes } from '../../web/routes/services.js';
import { registerEventStream } from '../../web/routes/events.js';

// After orchestrator is created...

// Start web server if enabled
if (config.web?.enabled !== false) {
  const webServer = await createWebServer({
    port: config.web?.port || 3000,
    host: config.web?.host || 'localhost',
    cors: config.web?.cors ?? true,
    orchestrator,
  });

  await registerServiceRoutes(webServer, orchestrator.registry);
  await registerEventStream(webServer, orchestrator.eventBus);

  await webServer.listen({
    port: config.web?.port || 3000,
    host: config.web?.host || 'localhost',
  });

  logger.info(`Web UI available at http://localhost:${config.web?.port || 3000}`);
}
```

#### 5.2 Build Process

**File**: `package.json` (add scripts)

```json
{
  "scripts": {
    "web:dev": "cd src/devac/web/client && vite",
    "web:build": "cd src/devac/web/client && vite build",
    "web:preview": "cd src/devac/web/client && vite preview",
    "devac:start:web": "npm run build && npm run web:build && node dist/devac/cli/index.js start --web"
  }
}
```

---

## 🏆 Testing Strategy (Testing Trophy)

```
           /\
          /E2E\         2-3 tests  (Full user flows)
         /------\
        /        \
       / Integr.  \    10-12 tests (API + Components)
      /            \
     /--------------\
    |    Static    |   TypeScript + ESLint
    |______________|
          |
       Unit          8-10 tests  (Hooks, Utils)
```

### Unit Tests (8-10 tests)

**Pure logic, no dependencies:**
- API client functions (mocked fetch)
- useSSE hook (mocked EventSource)
- Utility functions (date formatting, status colors)

### Integration Tests (10-12 tests) - THE BULK

**Real dependencies (Fastify, React, TanStack Query):**

**Backend Integration** (6 tests):
1. Server health check
2. List all services
3. Get service detail
4. Start/stop service
5. SSE connection
6. SSE event delivery

**Component Integration** (6 tests):
1. ServiceCard renders with data
2. ServiceCard start/stop mutations
3. Dashboard loads services
4. Dashboard displays events
5. Service detail route
6. Navigation between routes

### E2E Tests (2-3 tests)

**Full system with real orchestrator:**
1. Start DevAC → Open UI → See dashboard → Start service → Verify status
2. Create file change → See collection event in UI
3. Stop service → Verify UI updates

---

## 📦 Dependencies

**Backend**:
```json
{
  "fastify": "^4.25.0",
  "@fastify/cors": "^9.0.0",
  "@fastify/sse": "^5.0.0",
  "pino-pretty": "^10.3.0"
}
```

**Frontend**:
```json
{
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "@tanstack/react-router": "^1.87.0",
  "@tanstack/react-query": "^5.17.0",
  "@tanstack/react-virtual": "^3.0.1",
  "vite": "^5.0.0",
  "@vitejs/plugin-react": "^4.2.0"
}
```

**Testing**:
```json
{
  "@testing-library/react": "^14.1.0",
  "@testing-library/user-event": "^14.5.0",
  "vitest": "^1.1.0",
  "jsdom": "^23.0.0"
}
```

---

## 🎨 UI Design Principles

### Layout

```
┌────────────────────────────────────────┐
│  Header: DevAC | 🟢 Connected          │
├────────────────────────────────────────┤
│  Nav: Dashboard | Services | Logs      │
├────────────────────────────────────────┤
│                                        │
│  Main Content Area                     │
│  (Dashboard, Service Detail, etc.)     │
│                                        │
│                                        │
└────────────────────────────────────────┘
```

### Color Scheme (Simple)

- **Background**: `#ffffff` (light), `#1a1a1a` (dark mode)
- **Text**: `#333333` (light), `#e0e0e0` (dark mode)
- **Primary**: `#0066cc` (blue for actions)
- **Status Colors**:
  - Idle: `#6b7280` (gray)
  - Running: `#10b981` (green)
  - Warning: `#f59e0b` (orange)
  - Error: `#ef4444` (red)

### Typography

- **Font Family**: System font stack
  ```css
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
  ```
- **Scale**: 12px, 14px, 16px (body), 18px, 24px, 32px

### Accessibility

- ✅ Keyboard navigation (Tab, Enter, Escape)
- ✅ ARIA labels for interactive elements
- ✅ Focus indicators
- ✅ Color contrast >= 4.5:1
- ✅ Screen reader support

---

## 🔮 Future Extensibility (Phase 3.5+)

### Plugin System

```typescript
interface DashboardPlugin {
  id: string;
  name: string;
  component: React.ComponentType;
  route?: string;
}

// Register plugins
dashboardRegistry.register({
  id: 'graph-viewer',
  name: 'Code Graph Viewer',
  component: GraphViewer,
  route: '/graph',
});
```

### Views to Add Later

1. **Graph Viewer** (Cytoscape.js)
   - Visualize code graph from Neo4j
   - Interactive node exploration
   - Query builder UI

2. **Log Viewer**
   - Virtual scrolling for performance
   - Real-time log streaming
   - Filter and search

3. **Collections Browser**
   - List all collections
   - View collection details
   - Compare collections

4. **Analytics Dashboard**
   - Charts and metrics
   - Trends over time
   - Custom queries

---

## ✅ Success Criteria

**Backend**:
- [x] Fastify server starts on configured port
- [x] All service API endpoints functional
- [x] SSE stream delivers events in real-time
- [x] Integration tests passing (6 tests)

**Frontend**:
- [x] Dashboard displays all services
- [x] Service cards show status and controls
- [x] Start/stop actions work correctly
- [x] Real-time events update UI
- [x] Component tests passing (6 tests)
- [x] Responsive layout (desktop + tablet)

**Integration**:
- [x] Web server starts with `devac start`
- [x] E2E tests passing (2-3 tests)
- [x] Build process generates production bundle
- [x] TypeScript compilation: 0 errors

**Quality**:
- [x] Testing Trophy structure maintained
- [x] <10% mocking in integration tests
- [x] Accessible (keyboard + screen reader)
- [x] Fast (<100ms initial load, <50ms interactions)

---

## 📝 Implementation Order

1. **TDD Preparation** (30 min)
   - Set up test infrastructure
   - Create test helpers
   - Write first failing test

2. **Backend Core** (2-3 hours)
   - Fastify server + health check
   - Service API endpoints
   - SSE event stream
   - Integration tests

3. **Frontend Foundation** (2-3 hours)
   - Vite + React setup
   - API client + hooks
   - useSSE implementation
   - Unit tests

4. **Dashboard UI** (3-4 hours)
   - Dashboard route
   - ServiceCard component
   - Real-time updates
   - Component tests

5. **Service Detail** (2-3 hours)
   - Detail route
   - Context/config display
   - Navigation

6. **Integration** (1-2 hours)
   - CLI integration
   - Build process
   - E2E tests

**Total Estimate**: 11-17 hours (~2-3 days)

---

## 🚀 Phase 3.5: Future Enhancements

**Not in scope for Phase 3, but designed to be easy to add:**

1. **Graph Visualization** (Cytoscape.js)
   - Neo4j query → Graph data
   - Interactive node exploration
   - Layout algorithms

2. **Log Viewer** (Virtual scrolling)
   - Real-time log streaming
   - Filter by level/service
   - Search functionality

3. **Collections Browser**
   - Timeline view
   - Collection comparison
   - Statistics charts

4. **Dark Mode**
   - CSS variables for theming
   - User preference storage
   - System preference detection

5. **Custom Queries**
   - Cypher query builder UI
   - Save favorite queries
   - Query history

---

## 📚 References

**Kent C. Dodds - Testing Trophy**:
- https://kentcdodds.com/blog/write-tests
- https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications

**TanStack Ecosystem**:
- https://tanstack.com/router
- https://tanstack.com/query

**Fastify**:
- https://fastify.dev/
- https://github.com/fastify/fastify-sse-v2

**React Testing Library**:
- https://testing-library.com/react

---

## 🎯 Ready to Start?

**Next steps:**
1. Review and approve this plan
2. Create feature branch: `claude/phase-3-web-ui-{sessionId}`
3. Write first test (TDD approach)
4. Implement backend foundation
5. Build frontend components
6. Integrate and test end-to-end

**Question for you**: Does this plan match your vision for a simple, high-quality, flexible UI? Any changes or additions you'd like?
