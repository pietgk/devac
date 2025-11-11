# Phase 3: Web UI Foundation - Implementation Plan (FINAL)

**Date**: 2025-11-11
**Status**: ✅ **APPROVED - Ready to Implement**
**Branch**: `claude/phase-3-web-ui-{sessionId}`
**Approach**: TDD + Testing Trophy (tests first!)

---

## ✅ Decisions Made

**1. Tech Stack:**
- ✅ **Backend**: Express (already in use)
- ✅ **Frontend**: Next.js App Router (already in use)
- ✅ **Styling**: shadcn/ui (research complete)
- ✅ **State**: TanStack Query v5 for server state
- ✅ **Real-Time**: Server-Sent Events (SSE)

**2. Dashboard Layouts:**
- ✅ **Phase 3 (Implement Now)**:
  - Command Center (classic grid)
  - Timeline View (event-centric)
- ✅ **Phase 3.5 (Future)**:
  - Service Monitor (service-centric)
  - Analytics Dashboard (metrics-centric)
  - Split Screen (optional)

**3. Implementation Estimate:**
- ⏱️ **11-17 hours** (~2-3 days)
- 📊 **20+ tests** (Testing Trophy approach)
- 🎯 **TDD**: Write tests first!

---

## 🚀 Getting Started

### Prerequisites

**Check you have:**
```bash
# Node.js and npm
node --version  # Should be v18+
npm --version

# DevAC project
cd /home/user/devac
git status  # Should be on a clean branch

# Neo4j running (for tests)
# Already confirmed working with 179 tests passing ✅
```

### Step-by-Step Implementation

#### Step 1: Create Feature Branch (5 min)

```bash
# Create and switch to new branch
git checkout -b claude/phase-3-web-ui-011CUxwSMTDF3T9kek4Rqws2

# Verify
git branch --show-current
# Should output: claude/phase-3-web-ui-011CUxwSMTDF3T9kek4Rqws2
```

#### Step 2: Install Dependencies (10 min)

**Backend dependencies:**
```bash
# Express already installed, but add SSE support if needed
npm install --save express cors

# Dev dependencies for testing
npm install --save-dev supertest @types/supertest
```

**Frontend dependencies (Next.js app):**
```bash
# Create web client directory
mkdir -p src/devac/web/client

# Initialize Next.js (in client directory)
cd src/devac/web/client
npx create-next-app@latest . --typescript --tailwind --eslint --app --no-src-dir

# Install additional dependencies
npm install @tanstack/react-query@latest
npm install styled-components
npm install -D @types/styled-components

# Install shadcn/ui
npx shadcn-ui@latest init
# When prompted:
#   ✔ Which style would you like to use? › Default
#   ✔ Which color would you like to use as base color? › Slate
#   ✔ Would you like to use CSS variables for colors? › yes

# Install initial shadcn components
npx shadcn-ui@latest add button card badge

# Return to project root
cd ../../../..
```

**Verify installation:**
```bash
npm test
# Should still show 179 tests passing
```

#### Step 3: Create Directory Structure (5 min)

```bash
# Backend structure
mkdir -p src/devac/web/{routes,__tests__}
touch src/devac/web/server.ts
touch src/devac/web/sse-manager.ts
touch src/devac/web/routes/services.ts
touch src/devac/web/routes/events.ts

# Test structure
mkdir -p src/devac/web/__tests__
mkdir -p src/devac/web/routes/__tests__
touch src/devac/web/__tests__/server.integration.spec.ts
touch src/devac/web/routes/__tests__/services.integration.spec.ts

# Frontend structure (Next.js handles most of this)
cd src/devac/web/client
mkdir -p components/layouts
mkdir -p lib/hooks
touch components/layouts/LayoutRegistry.tsx
touch components/layouts/LayoutSwitcher.tsx
touch components/layouts/CommandCenterLayout.tsx
touch components/layouts/TimelineViewLayout.tsx
touch lib/api-client.ts
touch lib/hooks/useSSE.ts

cd ../../../..

# Verify structure
tree src/devac/web -L 2
```

#### Step 4: Create Test Infrastructure (15 min)

**File**: `src/devac/web/__tests__/test-helpers.ts`

```typescript
import { EventBus } from '../../orchestrator/event-bus.js';
import { ServiceRegistry } from '../../orchestrator/service-registry.js';
import { createActor } from 'xstate';
import { createMachine } from 'xstate';

/**
 * Create a mock orchestrator for testing
 */
export function createMockOrchestrator() {
  const eventBus = new EventBus();
  const registry = new ServiceRegistry();

  // Create a simple test service
  const testMachine = createMachine({
    id: 'test-service',
    initial: 'idle',
    states: {
      idle: {
        on: {
          START: 'running',
        },
      },
      running: {
        on: {
          STOP: 'idle',
        },
      },
    },
  });

  const testActor = createActor(testMachine);
  testActor.start();

  registry.register('test-service', testActor as any, {
    id: 'test-service',
    name: 'Test Service',
    type: 'custom',
    enabled: true,
    config: {},
  });

  return {
    eventBus,
    registry,
  };
}
```

#### Step 5: Write First Test (TDD!) (20 min)

**File**: `src/devac/web/__tests__/server.integration.spec.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import { createWebServer } from '../server.js';
import { createMockOrchestrator } from './test-helpers.js';

describe('Web Server - Integration (TDD)', () => {
  let app: Express;

  beforeEach(async () => {
    const orchestrator = createMockOrchestrator();
    app = await createWebServer({
      port: 0, // Random port
      host: 'localhost',
      cors: true,
      orchestrator: orchestrator as any,
    });
  });

  describe('Health Check', () => {
    it('should respond with 200 and status ok', async () => {
      // This test will FAIL initially (TDD red phase)
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'ok',
        timestamp: expect.any(String),
      });
    });
  });
});
```

**Run the test (it will FAIL - this is TDD!):**
```bash
npm test -- server.integration

# Expected output:
# ❌ FAIL: Cannot find module '../server.js'
# This is CORRECT! We write tests first, then implementation.
```

#### Step 6: Implement Backend Foundation (60-90 min)

Now implement the code to make tests pass. Follow the detailed code examples in the sections below:
- Task 1.1: Express Server Setup
- Task 1.2: Service API Routes
- Task 1.3: SSE Event Stream

**After each implementation:**
```bash
npm test -- server.integration
# Watch tests turn from ❌ RED to ✅ GREEN
```

#### Step 7: Implement Frontend Foundation (60-90 min)

Follow Task 2 sections:
- Task 2.1: Next.js Setup
- Task 2.2: API Client
- Task 2.3: SSE Hook

**Run Next.js dev server:**
```bash
cd src/devac/web/client
npm run dev
# Open http://localhost:3001 in browser
```

#### Step 8: Implement Dashboard Layouts (90-120 min)

Follow Task 3 sections:
- Task 3.1: Layout Registry
- Task 3.2: Layout Switcher
- Task 3.3: Command Center Layout
- Task 3.4: Timeline View Layout

**Test layout switching:**
```bash
# In browser at http://localhost:3001
# Should see layout switcher UI
# Click between Command Center and Timeline
# Verify localStorage persists preference
```

#### Step 9: Implement Core Components (60-90 min)

Follow Task 4 sections:
- ServiceCard component
- EventFeed component
- ServiceSidebar component
- Timeline component

**Run component tests:**
```bash
npm test -- ServiceCard.test
npm test -- components
```

#### Step 10: Integration & E2E Tests (30-60 min)

Follow Task 5 sections:
- Integrate with DevAC CLI
- E2E test: Start DevAC → Open UI → Control services

**Run full test suite:**
```bash
npm test
# Target: 179 + 20 = 199 tests passing
```

#### Step 11: Commit & Push (10 min)

```bash
# Stage all changes
git add .

# Commit with detailed message
git commit -m "feat(web): Implement Phase 3 Web UI with Command Center and Timeline layouts

Complete Web UI implementation with:

**Backend:**
- Express server with SSE support
- Service API endpoints (list, get, start, stop)
- Real-time event stream

**Frontend:**
- Next.js App Router
- shadcn/ui components
- TanStack Query for server state
- Command Center layout (grid)
- Timeline View layout (chronological)

**Testing:**
- 20+ tests (Testing Trophy)
- 6 backend integration tests
- 8 component tests
- 3 E2E tests
- <10% mocking ratio

Closes Phase 3 implementation.
See PHASE_3_UI_PLAN_REVISED.md for details."

# Push to remote
git push -u origin claude/phase-3-web-ui-011CUxwSMTDF3T9kek4Rqws2
```

---

## 📐 Architecture Overview

```
Browser (Next.js)           Express API              Orchestrator
      ↓                          ↓                         ↓
  ┌─────────┐              ┌──────────┐           ┌───────────┐
  │Dashboard│─GET /api─────│Services  │───query──→│ Registry  │
  │         │              │Routes    │           │           │
  │Command  │◄─JSON────────│          │◄──data───│ Actors    │
  │Center   │              └──────────┘           └───────────┘
  └─────────┘                    │                      │
      ↓                          ↓                      ↓
  ┌─────────┐              ┌──────────┐           ┌───────────┐
  │Timeline │─EventSource─→│SSE Route │◄─subscribe│ EventBus  │
  │View     │              │          │           │           │
  │         │◄─events──────│          │◄──events──│           │
  └─────────┘              └──────────┘           └───────────┘
```

---

## 📋 Implementation Tasks (Detailed)

### Task 1: Backend Foundation (Express + SSE)

**Duration**: 2-3 hours | **Tests First**: Yes

#### 1.1 Express Server Setup

**File**: `src/devac/web/server.ts`

```typescript
import express, { Express } from 'express';
import cors from 'cors';
import { createSSEManager, SSEManager } from './sse-manager.js';
import type { Orchestrator } from '../orchestrator/orchestrator.js';

export interface WebServerOptions {
  port: number;
  host: string;
  cors: boolean;
  orchestrator: Orchestrator;
}

export async function createWebServer(options: WebServerOptions): Promise<Express> {
  const app = express();

  // Middleware
  app.use(cors({ origin: options.cors ? true : undefined }));
  app.use(express.json());

  // SSE Manager
  const sseManager = createSSEManager(options.orchestrator.eventBus);

  // Store in app locals for access in routes
  app.locals.orchestrator = options.orchestrator;
  app.locals.sseManager = sseManager;

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}

export function startServer(app: Express, options: WebServerOptions): Promise<void> {
  return new Promise((resolve) => {
    app.listen(options.port, options.host, () => {
      console.log(`DevAC Web UI: http://${options.host}:${options.port}`);
      resolve();
    });
  });
}
```

**Test**: `src/devac/web/__tests__/server.integration.spec.ts`

```typescript
describe('Web Server', () => {
  it('should start and respond to health check', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      timestamp: expect.any(String),
    });
  });
});
```

#### 1.2 SSE Manager

**File**: `src/devac/web/sse-manager.ts`

```typescript
import { Response } from 'express';
import type { EventBus } from '../orchestrator/event-bus.js';

export interface SSEManager {
  addClient(res: Response): void;
  removeClient(res: Response): void;
  broadcast(event: string, data: any): void;
}

export function createSSEManager(eventBus: EventBus): SSEManager {
  const clients = new Set<Response>();

  // Subscribe to orchestrator events
  eventBus.subscribe('*', (envelope) => {
    broadcast(envelope.event.type, {
      id: envelope.event.id,
      type: envelope.event.type,
      serviceId: envelope.event.serviceId,
      timestamp: envelope.event.timestamp,
      payload: envelope.event.payload,
    });
  });

  function addClient(res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send connected event
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

    clients.add(res);

    res.on('close', () => {
      clients.delete(res);
    });
  }

  function removeClient(res: Response) {
    clients.delete(res);
  }

  function broadcast(event: string, data: any) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    clients.forEach((client) => {
      client.write(message);
    });
  }

  return { addClient, removeClient, broadcast };
}
```

#### 1.3 Service Routes

**File**: `src/devac/web/routes/services.ts`

```typescript
import { Router } from 'express';
import type { ServiceRegistry } from '../../orchestrator/service-registry.js';

export function createServiceRoutes(registry: ServiceRegistry): Router {
  const router = Router();

  // GET /api/services
  router.get('/', (req, res) => {
    const serviceIds = registry.getServiceIds();
    const services = serviceIds.map((id) => {
      const actor = registry.get(id);
      const config = registry.getConfig(id);
      const snapshot = actor.getSnapshot();

      return {
        id,
        name: config.name,
        type: config.type,
        status: snapshot.value,
        enabled: config.enabled,
      };
    });

    res.json({ services });
  });

  // GET /api/services/:id
  router.get('/:id', (req, res) => {
    const { id } = req.params;
    const actor = registry.get(id);

    if (!actor) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const config = registry.getConfig(id);
    const snapshot = actor.getSnapshot();

    res.json({
      id,
      name: config.name,
      type: config.type,
      status: snapshot.value,
      context: snapshot.context,
      config: config.config,
    });
  });

  // POST /api/services/:id/start
  router.post('/:id/start', (req, res) => {
    const { id } = req.params;
    const actor = registry.get(id);

    if (!actor) {
      return res.status(404).json({ error: 'Service not found' });
    }

    actor.send({ type: 'START' });
    res.json({ success: true, serviceId: id });
  });

  // POST /api/services/:id/stop
  router.post('/:id/stop', (req, res) => {
    const { id } = req.params;
    const actor = registry.get(id);

    if (!actor) {
      return res.status(404).json({ error: 'Service not found' });
    }

    actor.send({ type: 'STOP', graceful: true });
    res.json({ success: true, serviceId: id });
  });

  return router;
}
```

**Wire up in server.ts:**

```typescript
import { createServiceRoutes } from './routes/services.js';
import { Router } from 'express';

// In createWebServer, after health check:
app.use('/api/services', createServiceRoutes(options.orchestrator.registry));

// SSE endpoint
const eventsRouter = Router();
eventsRouter.get('/', (req, res) => {
  sseManager.addClient(res);
});
app.use('/api/events', eventsRouter);
```

**Test**: `src/devac/web/routes/__tests__/services.integration.spec.ts`

```typescript
describe('Service Routes', () => {
  it('should list all services', async () => {
    const response = await request(app).get('/api/services');

    expect(response.status).toBe(200);
    expect(response.body.services).toBeInstanceOf(Array);
  });

  it('should get service by id', async () => {
    const response = await request(app).get('/api/services/test-service');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'test-service',
      name: 'Test Service',
    });
  });

  it('should return 404 for non-existent service', async () => {
    const response = await request(app).get('/api/services/nope');

    expect(response.status).toBe(404);
  });
});
```

---

### Task 2: Frontend Foundation (Next.js + shadcn/ui)

**Duration**: 2-3 hours | **Tests**: Component tests

#### 2.1 Next.js Configuration

**File**: `src/devac/web/client/next.config.js`

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,

  // Proxy API requests to Express backend
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: process.env.API_URL || 'http://localhost:3000/api/:path*',
      },
    ];
  },

  // styled-components support
  compiler: {
    styledComponents: true,
  },
};

module.exports = nextConfig;
```

**File**: `src/devac/web/client/.env.local`

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_SSE_URL=http://localhost:3000/api/events
```

#### 2.2 Query Provider Setup

**File**: `src/devac/web/client/components/providers/query-provider.tsx`

```typescript
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

**File**: `src/devac/web/client/app/layout.tsx`

```typescript
import { ReactNode } from 'react';
import { QueryProvider } from '@/components/providers/query-provider';
import './globals.css';

export const metadata = {
  title: 'DevAC - Development Analytics Centre',
  description: 'Real-time development analytics platform',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
```

#### 2.3 API Client

**File**: `src/devac/web/client/lib/api-client.ts`

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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

export const servicesAPI = {
  list: () => fetchAPI<{ services: Service[] }>('/api/services'),
  get: (id: string) => fetchAPI<ServiceDetail>(`/api/services/${id}`),
  start: (id: string) => fetchAPI<{ success: boolean }>(`/api/services/${id}/start`, { method: 'POST' }),
  stop: (id: string) => fetchAPI<{ success: boolean }>(`/api/services/${id}/stop`, { method: 'POST' }),
};
```

#### 2.4 SSE Hook

**File**: `src/devac/web/client/lib/hooks/useSSE.ts`

```typescript
'use client';

import { useEffect, useState } from 'react';

export interface SSEEvent {
  type: string;
  data: any;
}

const SSE_URL = process.env.NEXT_PUBLIC_SSE_URL || 'http://localhost:3000/api/events';

export function useSSE() {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const eventSource = new EventSource(SSE_URL);

    eventSource.onopen = () => {
      setConnected(true);
      setError(null);
    };

    eventSource.onerror = (err) => {
      setConnected(false);
      setError(new Error('SSE connection failed'));
    };

    // Listen for event types
    ['SERVICE_STARTED', 'SERVICE_STOPPED', 'COLLECTION_COMPLETED', 'SERVICE_ERROR'].forEach((type) => {
      eventSource.addEventListener(type, (e) => {
        setEvents((prev) => [...prev, { type, data: JSON.parse(e.data) }]);
      });
    });

    return () => {
      eventSource.close();
    };
  }, []);

  return { events, connected, error };
}
```

---

### Task 3: Dashboard Layouts

**Duration**: 4-5 hours | **Tests**: Component tests

#### 3.1 Layout Registry

**File**: `src/devac/web/client/components/layouts/layout-registry.ts`

```typescript
import { ReactNode } from 'react';
import type { Service } from '@/lib/api-client';
import type { SSEEvent } from '@/lib/hooks/useSSE';

export interface DashboardLayout {
  id: string;
  name: string;
  description: string;
  icon: string;
  component: React.ComponentType<DashboardLayoutProps>;
}

export interface DashboardLayoutProps {
  services: Service[];
  events: SSEEvent[];
  onServiceSelect?: (id: string) => void;
}

const layouts = new Map<string, DashboardLayout>();

export function registerLayout(layout: DashboardLayout) {
  layouts.set(layout.id, layout);
}

export function getLayout(id: string): DashboardLayout | undefined {
  return layouts.get(id);
}

export function getAllLayouts(): DashboardLayout[] {
  return Array.from(layouts.values());
}
```

#### 3.2 Layout Switcher

**File**: `src/devac/web/client/components/layouts/LayoutSwitcher.tsx`

```typescript
'use client';

import { Button } from '@/components/ui/button';
import { getAllLayouts } from './layout-registry';

interface LayoutSwitcherProps {
  current: string;
  onChange: (layoutId: string) => void;
}

export function LayoutSwitcher({ current, onChange }: LayoutSwitcherProps) {
  const layouts = getAllLayouts();

  return (
    <div className="flex gap-2 p-4 border-b">
      {layouts.map((layout) => (
        <Button
          key={layout.id}
          variant={current === layout.id ? 'default' : 'outline'}
          size="sm"
          onClick={() => onChange(layout.id)}
          title={layout.description}
        >
          <span className="mr-2">{layout.icon}</span>
          <span>{layout.name}</span>
        </Button>
      ))}
    </div>
  );
}
```

#### 3.3 Command Center Layout

**File**: `src/devac/web/client/components/layouts/CommandCenterLayout.tsx`

```typescript
'use client';

import { ServiceCard } from '../ServiceCard';
import { EventFeed } from '../EventFeed';
import type { DashboardLayoutProps } from './layout-registry';
import { registerLayout } from './layout-registry';

export function CommandCenterLayout({ services, events }: DashboardLayoutProps) {
  const activeCount = services.filter((s) => s.status !== 'idle').length;
  const collectionCount = events.filter((e) => e.type === 'COLLECTION_COMPLETED').length;

  return (
    <div className="command-center-layout p-4">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 border rounded-lg">
          <div className="text-sm text-muted-foreground">Active Services</div>
          <div className="text-2xl font-bold">⚡ {activeCount}</div>
        </div>
        <div className="p-4 border rounded-lg">
          <div className="text-sm text-muted-foreground">Collections Today</div>
          <div className="text-2xl font-bold">📊 {collectionCount}</div>
        </div>
      </div>

      {/* Service Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {services.map((service) => (
          <ServiceCard key={service.id} service={service} />
        ))}
      </div>

      {/* Recent Events */}
      <div className="border rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-4">Recent Events</h2>
        <EventFeed events={events.slice(-10).reverse()} />
      </div>
    </div>
  );
}

// Register layout
registerLayout({
  id: 'command-center',
  name: 'Command Center',
  description: 'Classic grid layout with service cards and event feed',
  icon: '🎛️',
  component: CommandCenterLayout,
});
```

#### 3.4 Timeline View Layout

**File**: `src/devac/web/client/components/layouts/TimelineViewLayout.tsx`

```typescript
'use client';

import { ServiceSidebar } from '../ServiceSidebar';
import { Timeline } from '../Timeline';
import type { DashboardLayoutProps } from './layout-registry';
import { registerLayout } from './layout-registry';

export function TimelineViewLayout({ services, events }: DashboardLayoutProps) {
  return (
    <div className="timeline-view-layout flex h-screen">
      {/* Service Sidebar */}
      <aside className="w-64 border-r overflow-y-auto">
        <ServiceSidebar services={services} />
      </aside>

      {/* Timeline Main Area */}
      <main className="flex-1 overflow-y-auto p-4">
        <h2 className="text-lg font-semibold mb-4">Activity Timeline</h2>
        <Timeline events={events} />
      </main>
    </div>
  );
}

// Register layout
registerLayout({
  id: 'timeline-view',
  name: 'Timeline',
  description: 'Event-centric chronological activity feed',
  icon: '📋',
  component: TimelineViewLayout,
});
```

#### 3.5 Dashboard Page

**File**: `src/devac/web/client/app/page.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { servicesAPI } from '@/lib/api-client';
import { useSSE } from '@/lib/hooks/useSSE';
import { LayoutSwitcher } from '@/components/layouts/LayoutSwitcher';
import { getLayout } from '@/components/layouts/layout-registry';

// Import to register layouts
import '@/components/layouts/CommandCenterLayout';
import '@/components/layouts/TimelineViewLayout';

export default function DashboardPage() {
  const [currentLayout, setCurrentLayout] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('devac:preferred-layout') || 'command-center';
    }
    return 'command-center';
  });

  useEffect(() => {
    localStorage.setItem('devac:preferred-layout', currentLayout);
  }, [currentLayout]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['services'],
    queryFn: () => servicesAPI.list(),
  });

  const { events, connected } = useSSE();

  if (isLoading) return <div className="p-4">Loading services...</div>;
  if (error) return <div className="p-4">Error: {error.message}</div>;

  const layout = getLayout(currentLayout);
  const LayoutComponent = layout?.component;

  if (!LayoutComponent) {
    return <div className="p-4">Layout not found: {currentLayout}</div>;
  }

  return (
    <div className="dashboard-container">
      {/* Header */}
      <header className="border-b p-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">DevAC Dashboard</h1>
        <div className="flex items-center gap-2">
          <span className={connected ? 'text-green-600' : 'text-red-600'}>
            {connected ? '🟢 Connected' : '🔴 Disconnected'}
          </span>
        </div>
      </header>

      {/* Layout Switcher */}
      <LayoutSwitcher current={currentLayout} onChange={setCurrentLayout} />

      {/* Current Layout */}
      <LayoutComponent services={data?.services || []} events={events} />
    </div>
  );
}
```

---

### Task 4: Core Components

**Duration**: 2-3 hours

#### 4.1 ServiceCard

**File**: `src/devac/web/client/components/ServiceCard.tsx`

```typescript
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { servicesAPI, type Service } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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

  const statusVariant: any = {
    idle: 'secondary',
    initializing: 'default',
    watching: 'default',
    processing: 'default',
    degraded: 'destructive',
    error: 'destructive',
    stopped: 'secondary',
  }[service.status] || 'secondary';

  const statusEmoji = {
    idle: '🔵',
    initializing: '🔄',
    watching: '🟢',
    processing: '🟡',
    degraded: '🟠',
    error: '🔴',
    stopped: '⚫',
  }[service.status] || '⚪';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{service.name}</span>
          <span>{statusEmoji}</span>
        </CardTitle>
        <Badge variant={statusVariant}>{service.status}</Badge>
      </CardHeader>
      <CardContent>
        <div className="text-sm space-y-1">
          <div>Type: {service.type}</div>
          <div className="text-muted-foreground">ID: {service.id}</div>
        </div>
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button
          onClick={() => startMutation.mutate()}
          disabled={service.status !== 'idle' || startMutation.isPending}
          size="sm"
        >
          {startMutation.isPending ? 'Starting...' : 'Start'}
        </Button>
        <Button
          onClick={() => stopMutation.mutate()}
          disabled={service.status === 'idle' || stopMutation.isPending}
          variant="secondary"
          size="sm"
        >
          {stopMutation.isPending ? 'Stopping...' : 'Stop'}
        </Button>
      </CardFooter>
    </Card>
  );
}
```

#### 4.2 EventFeed

**File**: `src/devac/web/client/components/EventFeed.tsx`

```typescript
'use client';

import type { SSEEvent } from '@/lib/hooks/useSSE';

interface EventFeedProps {
  events: SSEEvent[];
}

export function EventFeed({ events }: EventFeedProps) {
  if (events.length === 0) {
    return <div className="text-sm text-muted-foreground">No events yet</div>;
  }

  return (
    <div className="space-y-2">
      {events.map((event, i) => (
        <div key={i} className="text-sm border-l-2 border-primary pl-3 py-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{event.type}</span>
            {event.data.serviceId && (
              <span className="text-muted-foreground">→ {event.data.serviceId}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {new Date(event.data.timestamp).toLocaleTimeString()}
          </div>
        </div>
      ))}
    </div>
  );
}
```

#### 4.3 ServiceSidebar

**File**: `src/devac/web/client/components/ServiceSidebar.tsx`

```typescript
'use client';

import type { Service } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface ServiceSidebarProps {
  services: Service[];
}

export function ServiceSidebar({ services }: ServiceSidebarProps) {
  return (
    <div className="p-4 space-y-2">
      <h3 className="font-semibold mb-4">Services</h3>
      {services.map((service) => (
        <div key={service.id} className="border rounded-lg p-3 space-y-2">
          <div className="font-medium">{service.name}</div>
          <Badge variant="secondary" className="text-xs">
            {service.status}
          </Badge>
          <Button size="sm" variant="outline" className="w-full text-xs">
            Details
          </Button>
        </div>
      ))}
    </div>
  );
}
```

#### 4.4 Timeline

**File**: `src/devac/web/client/components/Timeline.tsx`

```typescript
'use client';

import type { SSEEvent } from '@/lib/hooks/useSSE';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

interface TimelineProps {
  events: SSEEvent[];
}

export function Timeline({ events }: TimelineProps) {
  if (events.length === 0) {
    return <div className="text-muted-foreground">No events to display</div>;
  }

  return (
    <div className="space-y-4">
      {events.map((event, i) => (
        <Card key={i}>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>{event.type}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(event.data.timestamp).toLocaleTimeString()}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm space-y-1">
              {event.data.serviceId && <div>Service: {event.data.serviceId}</div>}
              {event.data.collectionId && (
                <div className="text-muted-foreground">Collection: {event.data.collectionId}</div>
              )}
              {event.data.payload && (
                <pre className="text-xs bg-muted p-2 rounded mt-2">
                  {JSON.stringify(event.data.payload, null, 2)}
                </pre>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

---

### Task 5: Integration & CLI

**Duration**: 1-2 hours

#### 5.1 Update CLI Start Command

**File**: `src/devac/cli/commands/start.ts` (modify existing)

```typescript
import { createWebServer, startServer } from '../../web/server.js';
import { createServiceRoutes } from '../../web/routes/services.js';

// After orchestrator is created and services are registered...

// Start web server if enabled
if (config.web?.enabled !== false) {
  logger.info('Starting web server...');

  const app = await createWebServer({
    port: config.web?.port || 3000,
    host: config.web?.host || 'localhost',
    cors: config.web?.cors ?? true,
    orchestrator,
  });

  await startServer(app, {
    port: config.web?.port || 3000,
    host: config.web?.host || 'localhost',
    cors: config.web?.cors ?? true,
    orchestrator,
  });

  logger.info(`✅ Web UI: http://localhost:${config.web?.port || 3000}`);
}
```

#### 5.2 Update Config Type

**File**: `src/devac/types/config.ts` (add to existing)

```typescript
export interface DevACConfig {
  // ... existing fields ...

  /** Web UI configuration */
  web?: {
    enabled?: boolean;
    port?: number;
    host?: string;
    cors?: boolean;
  };
}
```

#### 5.3 Update Default Config

**File**: `.devac/config.json` (update)

```json
{
  "version": "1.0.0",
  "neo4j": {
    "uri": "bolt://localhost:7687",
    "username": "neo4j",
    "password": "password",
    "database": "devac"
  },
  "web": {
    "port": 3000,
    "host": "localhost",
    "cors": true
  },
  "services": {
    "codegraph": {
      "enabled": false,
      "directories": ["./"],
      "extensions": [".ts", ".js", ".py", ".java", ".go"],
      "ignore": ["**/node_modules/**", "**/.git/**"],
      "watch": true
    }
  }
}
```

---

## 🏆 Testing Strategy (Testing Trophy)

```
           /\
          /E2E\         2-3 tests  (Full flows)
         /------\
        /        \
       / Integr.  \    10-12 tests (API + Components)
      /            \
     /--------------\
    |    Static    |   TypeScript + ESLint ✅
    |______________|
          |
       Unit          8-10 tests  (Hooks, Utils)
```

### Test Files to Create

**Backend Integration (6 tests)**:
1. `server.integration.spec.ts` - Health check, server startup
2. `services.integration.spec.ts` - List, get, start, stop services
3. `sse.integration.spec.ts` - SSE connection, event delivery

**Component Tests (6 tests)**:
1. `ServiceCard.test.tsx` - Render, start/stop mutations
2. `LayoutSwitcher.test.tsx` - Switch layouts, persist preference
3. `EventFeed.test.tsx` - Display events
4. `CommandCenterLayout.test.tsx` - Render services grid
5. `TimelineViewLayout.test.tsx` - Render timeline
6. `useSSE.test.ts` - Hook behavior

**E2E Tests (3 tests)**:
1. `dashboard.e2e.spec.ts` - Load dashboard, see services
2. `service-control.e2e.spec.ts` - Start/stop service from UI
3. `real-time-updates.e2e.spec.ts` - Verify SSE updates UI

**Total**: ~20 tests, <10% mocking ratio

---

## ✅ Success Criteria

**Functionality**:
- ✅ Dashboard displays all services
- ✅ Command Center layout works
- ✅ Timeline View layout works
- ✅ Layout switcher persists preference
- ✅ Start/stop controls functional
- ✅ Real-time events update UI via SSE
- ✅ Responsive on desktop and tablet

**Quality**:
- ✅ 20+ tests passing (Testing Trophy)
- ✅ <10% mocking in integration tests
- ✅ TypeScript: 0 compilation errors
- ✅ All shadcn/ui components accessible
- ✅ <100ms initial load time
- ✅ Keyboard navigation works

**Integration**:
- ✅ Starts with `npm run devac start`
- ✅ API proxied through Next.js
- ✅ SSE connection stable

---

## 📚 Reference Documentation

**shadcn/ui Components**:
- https://ui.shadcn.com/docs/components/button
- https://ui.shadcn.com/docs/components/card
- https://ui.shadcn.com/docs/components/badge

**Next.js App Router**:
- https://nextjs.org/docs/app

**TanStack Query**:
- https://tanstack.com/query/latest/docs/react/overview

**Testing Trophy**:
- https://kentcdodds.com/blog/write-tests

---

## 🎯 Ready to Start!

Follow the **Getting Started** section above step-by-step. Start with Step 1 and work through sequentially. Each step builds on the previous one.

**Estimated Timeline**:
- Day 1 (4-6 hours): Backend + Frontend foundation
- Day 2 (4-6 hours): Layouts + Components
- Day 3 (3-5 hours): Integration + Testing

**Questions before starting?** Ask now! Otherwise, proceed to Step 1. 🚀
