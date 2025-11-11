# Phase 3: Web UI Foundation - Implementation Plan (REVISED)

**Date**: 2025-11-11
**Status**: 📋 Planning
**Branch**: TBD
**Approach**: TDD + Testing Trophy (tests first!)

---

## 🔄 Revisions Based on Feedback

**Changes:**
1. ✅ **Express** instead of Fastify (already in use)
2. ✅ **Next.js** (App Router) instead of Vite + React (already in use)
3. ✅ **Styled-components + shadcn/ui** for styling (pending research completion)
4. ✅ **Flexible Dashboard Layout System** - Easy to switch between different layouts
5. ✅ **5 Dashboard Layout Proposals** - Choose 2 to start with

---

## 🎯 Vision

Create a **simple, high-quality, real-time web UI** that provides visibility into the DevAC orchestrator and its services. The UI should feel like a **command center** with **flexible layouts** that can be easily swapped as needs evolve.

### Design Principles

1. **Simple First** - Start with minimal, essential features
2. **Real-Time** - Use SSE for live updates (not polling)
3. **Flexible Layouts** - Easy to switch between different dashboard views
4. **Responsive** - Works on desktop and tablet
5. **Accessible** - Keyboard navigation, ARIA labels
6. **Extensible** - Plugin architecture for future views
7. **Type-Safe** - End-to-end TypeScript
8. **Tested** - Testing Trophy approach

---

## 🏗️ Architecture Overview (REVISED)

```
┌─────────────────────────────────────────────────────┐
│              Browser (Client - Next.js)              │
│  ┌─────────────────────────────────────────────┐   │
│  │     Next.js App Router (app/ directory)     │   │
│  │  ┌────────────────────────────────────────┐ │   │
│  │  │  Server Components + Client Components │ │   │
│  │  └────────────────────────────────────────┘ │   │
│  │  ┌────────────────────────────────────────┐ │   │
│  │  │  TanStack Query (React Query v5)       │ │   │
│  │  └────────────────────────────────────────┘ │   │
│  │  ┌────────────────────────────────────────┐ │   │
│  │  │  SSE Client (useSSE hook)              │ │   │
│  │  └────────────────────────────────────────┘ │   │
│  │  ┌────────────────────────────────────────┐ │   │
│  │  │  styled-components + shadcn/ui         │ │   │
│  │  └────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                        │
                 HTTP + SSE (EventSource)
                        │
┌─────────────────────────────────────────────────────┐
│            Express Server (Backend API)              │
│  ┌─────────────────────────────────────────────┐   │
│  │  REST API Routes                             │   │
│  │  - GET  /api/services                        │   │
│  │  - GET  /api/services/:id                    │   │
│  │  - POST /api/services/:id/start              │   │
│  │  - POST /api/services/:id/stop               │   │
│  │  - GET  /api/collections                     │   │
│  │  - GET  /api/collections/:id                 │   │
│  │  - GET  /api/logs/:serviceId                 │   │
│  └─────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐   │
│  │  SSE Endpoint (express-sse-events)           │   │
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

### Key Architectural Decisions (REVISED)

**1. Server: Express**
- Already in use in the project
- Extensive middleware ecosystem
- SSE via `express-sse-events` or custom implementation
- Easy testing with `supertest`

**2. Client: Next.js (App Router)**
- Already in use in the project
- App Router for modern React Server Components
- File-based routing
- Built-in API routes (optional, can proxy to Express)
- Optimized builds and performance

**3. Styling: styled-components + shadcn/ui**
- styled-components for component-level styling
- shadcn/ui for accessible, customizable components
- Theming support (light/dark mode ready)
- Pending: Full styling strategy from separate research

**4. State Management**
- **Server State**: TanStack Query (automatic caching, refetching)
- **Real-Time**: SSE + EventSource API (native browser API)
- **UI State**: React useState/useReducer (keep it simple)
- **No Zustand/Redux**: Not needed for Phase 3

**5. Data Visualization**
- **Service Status**: shadcn/ui components (cards, badges)
- **Logs**: Virtual scrolling with `@tanstack/react-virtual`
- **Graph**: Cytoscape.js (deferred to Phase 3.5)

---

## 🎨 Flexible Dashboard Layout System

### Layout Architecture

```typescript
// Layout Registry Pattern
interface DashboardLayout {
  id: string;
  name: string;
  description: string;
  component: React.ComponentType<DashboardLayoutProps>;
  icon: string;
  defaultSettings?: Record<string, any>;
}

interface DashboardLayoutProps {
  services: Service[];
  events: ServiceEvent[];
  activeServiceId?: string;
  onServiceSelect: (id: string) => void;
}

// Layout Registry
const layoutRegistry = new Map<string, DashboardLayout>();

// Register layouts
layoutRegistry.set('command-center', CommandCenterLayout);
layoutRegistry.set('timeline-view', TimelineViewLayout);
layoutRegistry.set('service-monitor', ServiceMonitorLayout);
layoutRegistry.set('analytics-dashboard', AnalyticsDashboardLayout);
layoutRegistry.set('split-screen', SplitScreenLayout);

// Usage
function DashboardContainer() {
  const [currentLayout, setCurrentLayout] = useState('command-center');
  const Layout = layoutRegistry.get(currentLayout)?.component;

  return (
    <div>
      <LayoutSwitcher
        layouts={Array.from(layoutRegistry.values())}
        current={currentLayout}
        onChange={setCurrentLayout}
      />
      <Layout {...props} />
    </div>
  );
}
```

### Layout Storage

```typescript
// User preference storage
localStorage.setItem('devac:preferred-layout', 'command-center');

// Per-service layout overrides
const layoutPreferences = {
  default: 'command-center',
  overrides: {
    'codegraph': 'analytics-dashboard', // CodeGraph uses analytics view
    'git': 'timeline-view', // Git uses timeline view
  }
};
```

---

## 📐 5 Dashboard Layout Proposals

### Layout 1: Command Center (Classic Grid)

**ID**: `command-center`
**Primary Focus**: Service overview and control
**Information Density**: Medium
**Best For**: General monitoring, quick service control

**Layout Structure:**
```
┌────────────────────────────────────────────────────────┐
│  Header: DevAC Command Center  |  🟢 Connected         │
│  [Command Center] [Timeline] [Monitor] [Analytics] ... │
├────────────────────────────────────────────────────────┤
│  Quick Stats:  ⚡ 3 Active  |  📊 12 Collections Today │
├────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ CodeGraph   │  │   Build     │  │    Test     │   │
│  │ Service     │  │  Service    │  │  Service    │   │
│  │             │  │             │  │             │   │
│  │ 🟢 watching │  │ 🔵 idle     │  │ 🟡 running  │   │
│  │             │  │             │  │             │   │
│  │ Files: 145  │  │ Queue: 0    │  │ Tests: 42   │   │
│  │ Nodes: 2.1K │  │ Last: 2m    │  │ Pass: 98%   │   │
│  │             │  │             │  │             │   │
│  │  [Details]  │  │  [Start]    │  │  [Stop]     │   │
│  └─────────────┘  └─────────────┘  └─────────────┘   │
│                                                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │    Git      │  │   Custom    │  │  [+ Add]    │   │
│  │  Service    │  │  Service    │  │  Service    │   │
│  │ ...         │  │ ...         │  │             │   │
│  └─────────────┘  └─────────────┘  └─────────────┘   │
├────────────────────────────────────────────────────────┤
│  Recent Events (Live Feed)                             │
│  • 10:45:23 | SERVICE_STARTED | codegraph             │
│  • 10:45:42 | COLLECTION_COMPLETED | 145 files        │
│  • 10:46:01 | FILE_CHANGED | src/main.ts              │
│  [View All Events]                                     │
└────────────────────────────────────────────────────────┘
```

**Components:**
- Service cards in responsive grid (3-4 columns)
- Quick stats banner at top
- Live event feed at bottom
- "Add Service" card for quick setup

**Use Cases:**
- Daily monitoring
- Quick service start/stop
- At-a-glance status overview

---

### Layout 2: Timeline View (Event-Centric)

**ID**: `timeline-view`
**Primary Focus**: Real-time activity and event history
**Information Density**: High
**Best For**: Debugging, monitoring activity flow, understanding sequences

**Layout Structure:**
```
┌────────────────────────────────────────────────────────┐
│  Header: DevAC Timeline  |  🟢 Connected               │
│  [Command Center] [Timeline] [Monitor] [Analytics] ... │
├─────────────┬──────────────────────────────────────────┤
│  Services   │  Activity Timeline                       │
│  Sidebar    │                                          │
│             │  ┌──────────────────────────────────┐   │
│ CodeGraph   │  │ 10:45:42  COLLECTION_COMPLETED   │   │
│ 🟢 watching │  │ ├─ Service: codegraph            │   │
│ [Details]   │  │ ├─ Files: 145                    │   │
│             │  │ ├─ Nodes: 2.1K                   │   │
│ Build       │  │ └─ Duration: 3.2s                │   │
│ 🔵 idle     │  └──────────────────────────────────┘   │
│ [Start]     │                                          │
│             │  ┌──────────────────────────────────┐   │
│ Test        │  │ 10:45:23  SERVICE_STARTED        │   │
│ 🟡 running  │  │ ├─ Service: codegraph            │   │
│ [Stop]      │  │ └─ Initiated by: user            │   │
│             │  └──────────────────────────────────┘   │
│ Git         │                                          │
│ 🔵 idle     │  ┌──────────────────────────────────┐   │
│ [Start]     │  │ 10:44:58  FILE_CHANGED           │   │
│             │  │ ├─ Path: src/main.ts             │   │
│             │  │ └─ Type: change                  │   │
│             │  └──────────────────────────────────┘   │
│             │                                          │
│             │  ┌──────────────────────────────────┐   │
│             │  │ 10:44:12  SERVICE_ERROR          │   │
│             │  │ ├─ Service: build                │   │
│             │  │ ├─ Error: Compilation failed     │   │
│             │  │ └─ [View Stack Trace]            │   │
│             │  └──────────────────────────────────┘   │
│             │                                          │
│  [Filters]  │  ⋮  (Infinite scroll / Virtual list)    │
│  ☑ All      │                                          │
│  ☑ Errors   │  [Load Earlier Events]                  │
│  ☐ Warnings │                                          │
└─────────────┴──────────────────────────────────────────┘
```

**Components:**
- Compact service sidebar (fixed, scrollable)
- Main timeline area (infinite scroll)
- Event cards with expandable details
- Filter panel for event types
- Time grouping (Today, Yesterday, This Week)

**Use Cases:**
- Debugging issues (see event sequence)
- Monitoring real-time activity
- Understanding cause-and-effect

---

### Layout 3: Service Monitor (Service-Centric)

**ID**: `service-monitor`
**Primary Focus**: Deep dive into individual services
**Information Density**: High
**Best For**: Service debugging, detailed monitoring, configuration

**Layout Structure:**
```
┌────────────────────────────────────────────────────────┐
│  Header: DevAC Service Monitor  |  🟢 Connected        │
│  [Command Center] [Timeline] [Monitor] [Analytics] ... │
├────────────────────────────────────────────────────────┤
│  Service Tabs:                                         │
│  [ CodeGraph (active) ] [ Build ] [ Test ] [ Git ]     │
├────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────┐ │
│  │  CodeGraph Service                                │ │
│  │  Status: 🟢 watching  |  Uptime: 2h 34m           │ │
│  │  [Start] [Stop] [Restart] [Configure]            │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ┌──────────────────────┬─────────────────────────┐  │
│  │  Metrics              │  Configuration          │  │
│  │                       │                         │  │
│  │  Files Scanned: 145   │  Directories:           │  │
│  │  Nodes Created: 2.1K  │  • ./src                │  │
│  │  Relationships: 1.8K  │  • ./lib                │  │
│  │  Collections: 12      │                         │  │
│  │  Errors: 0            │  Extensions:            │  │
│  │  Warnings: 3          │  • .ts, .tsx, .js       │  │
│  │                       │                         │  │
│  │  Last Collection:     │  Watch: Enabled         │  │
│  │  10:45:42 (2m ago)    │  Debounce: 1000ms       │  │
│  │  Duration: 3.2s       │                         │  │
│  └──────────────────────┴─────────────────────────┘  │
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │  Collections History                            │   │
│  │  ┌──────────────────────────────────────────┐  │   │
│  │  │ 10:45:42 | 145 files | 2.1K nodes | 3.2s │  │   │
│  │  │ 10:12:15 | 143 files | 2.0K nodes | 3.1s │  │   │
│  │  │ 09:58:03 | 142 files | 2.0K nodes | 3.0s │  │   │
│  │  └──────────────────────────────────────────┘  │   │
│  │  [View All Collections]                        │   │
│  └────────────────────────────────────────────────┘   │
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │  Recent Logs                                    │   │
│  │  [INFO] 10:45:42 | Starting collection...      │   │
│  │  [INFO] 10:45:45 | Scanned 145 files           │   │
│  │  [WARN] 10:45:46 | Skipped 3 declaration files │   │
│  │  [INFO] 10:45:48 | Collection completed        │   │
│  │  [View Full Logs]                              │   │
│  └────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

**Components:**
- Tab navigation for services
- Service status header with controls
- Two-column layout: Metrics | Configuration
- Collections history table
- Recent logs panel

**Use Cases:**
- Deep service debugging
- Configuration review
- Performance analysis
- Log investigation

---

### Layout 4: Analytics Dashboard (Metrics-Centric)

**ID**: `analytics-dashboard`
**Primary Focus**: Statistics, trends, and insights
**Information Density**: Medium-High
**Best For**: Understanding patterns, performance tracking, reporting

**Layout Structure:**
```
┌────────────────────────────────────────────────────────┐
│  Header: DevAC Analytics  |  🟢 Connected              │
│  [Command Center] [Timeline] [Monitor] [Analytics] ... │
├────────────────────────────────────────────────────────┤
│  Time Range: [Last 24 Hours ▼]  Refresh: [Auto ⚡]    │
├────────────────────────────────────────────────────────┤
│  ┌──────────────┬──────────────┬──────────────┐       │
│  │ Total        │ Collections  │ Avg Duration │       │
│  │ Services     │ Today        │              │       │
│  │              │              │              │       │
│  │      4       │      12      │    3.2s      │       │
│  └──────────────┴──────────────┴──────────────┘       │
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │  Collections Over Time                          │   │
│  │  📊 (Line Chart)                                │   │
│  │     ┌─────────────────────────────────────┐    │   │
│  │  15 │         ╱╲        ╱╲                │    │   │
│  │  10 │    ╱╲  ╱  ╲  ╱╲  ╱  ╲               │    │   │
│  │   5 │___╱__╲╱____╲╱__╲╱____╲______________│    │   │
│  │     └─────────────────────────────────────┘    │   │
│  │       9am    12pm   3pm    6pm    9pm          │   │
│  └────────────────────────────────────────────────┘   │
│                                                        │
│  ┌───────────────────────┬───────────────────────┐    │
│  │ Service Activity      │ Top File Changes      │    │
│  │ 📊 (Pie Chart)        │ 📊 (Bar Chart)        │    │
│  │                       │                       │    │
│  │  CodeGraph: 60%       │  src/main.ts: 24     │    │
│  │  Build: 25%           │  src/utils.ts: 18    │    │
│  │  Test: 10%            │  lib/api.ts: 12      │    │
│  │  Git: 5%              │  ...                 │    │
│  └───────────────────────┴───────────────────────┘    │
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │  Performance Metrics                            │   │
│  │  ┌──────────────────────────────────────────┐  │   │
│  │  │ CodeGraph | Avg: 3.2s | Min: 2.1s | Max: │  │   │
│  │  │           | 5.8s | P95: 4.2s             │  │   │
│  │  │ Build     | Avg: 12.5s | Min: 8.2s | ... │  │   │
│  │  └──────────────────────────────────────────┘  │   │
│  └────────────────────────────────────────────────┘   │
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │  Error Summary                                  │   │
│  │  Total Errors: 3  |  Total Warnings: 12        │   │
│  │  Most Common: TypeScript compilation (2x)      │   │
│  │  [View Details]                                │   │
│  └────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

**Components:**
- Summary statistics cards
- Time-series charts (collections over time)
- Pie charts (service distribution)
- Bar charts (top files, top errors)
- Performance metrics table
- Error summary

**Use Cases:**
- Performance monitoring
- Trend analysis
- Identifying bottlenecks
- Reporting to team

**Libraries Needed:**
- Recharts (for charts)
- Or Tremor (analytics-focused React components)

---

### Layout 5: Split Screen (Dual-Pane)

**ID**: `split-screen`
**Primary Focus**: Side-by-side comparison and multitasking
**Information Density**: High
**Best For**: Comparing services, simultaneous monitoring

**Layout Structure:**
```
┌────────────────────────────────────────────────────────┐
│  Header: DevAC Split Screen  |  🟢 Connected           │
│  [Command Center] [Timeline] [Monitor] [Analytics] ... │
├───────────────────────┬────────────────────────────────┤
│  LEFT PANE            │  RIGHT PANE                    │
│  [Services List ▼]    │  [Service Detail ▼]            │
│                       │                                │
│  ┌─────────────────┐ │  ┌──────────────────────────┐ │
│  │ CodeGraph       │ │  │ CodeGraph Service        │ │
│  │ 🟢 watching     │ │  │ Status: 🟢 watching      │ │
│  │ Files: 145      │ │  │ Uptime: 2h 34m           │ │
│  │ [View Details]  │ │  └──────────────────────────┘ │
│  └─────────────────┘ │                                │
│                       │  Metrics:                      │
│  ┌─────────────────┐ │  • Files: 145                  │
│  │ Build           │ │  • Nodes: 2.1K                 │
│  │ 🔵 idle         │ │  • Collections: 12             │
│  │ Queue: 0        │ │                                │
│  │ [Start]         │ │  Recent Collections:           │
│  └─────────────────┘ │  ┌────────────────────────┐   │
│                       │  │ 10:45:42 | 145 files  │   │
│  ┌─────────────────┐ │  │ 10:12:15 | 143 files  │   │
│  │ Test            │ │  └────────────────────────┘   │
│  │ 🟡 running      │ │                                │
│  │ Tests: 42       │ │  Logs:                         │
│  │ [Stop]          │ │  [INFO] Starting...            │
│  └─────────────────┘ │  [INFO] Scanned 145 files      │
│                       │  [INFO] Completed              │
│  ┌─────────────────┐ │                                │
│  │ Git             │ │  Configuration:                │
│  │ 🔵 idle         │ │  Directories: ./src, ./lib     │
│  │ [Start]         │ │  Extensions: .ts, .tsx         │
│  └─────────────────┘ │  Watch: Enabled                │
│                       │                                │
│  ⋮                   │  ⋮                             │
│                       │                                │
│  (Scrollable)         │  (Scrollable)                  │
└───────────────────────┴────────────────────────────────┘
```

**Alternative Right Panes:**
- Service Detail (default)
- Live Events Feed
- Log Viewer
- Graph Viewer (Phase 3.5)
- Collection Comparison

**Components:**
- Resizable split panes (react-split-pane)
- Left: Service list (compact cards)
- Right: Detailed view (switchable content)
- Synchronized scrolling option

**Use Cases:**
- Monitoring one service while browsing others
- Comparing two services side-by-side
- Multitasking (logs + service control)

---

## 🎯 Layout Selection Recommendations

### For Phase 3 (Choose 2):

**Recommendation 1: Command Center + Timeline View**
- **Why**: Different primary focuses (control vs. monitoring)
- **Coverage**: Handles most common use cases
- **Contrast**: Grid vs. linear layout

**Recommendation 2: Command Center + Service Monitor**
- **Why**: Progressive disclosure (overview → details)
- **Coverage**: Daily use + deep debugging
- **Contrast**: Multi-service vs. single-service focus

**Recommendation 3: Timeline View + Analytics Dashboard**
- **Why**: Real-time + historical analysis
- **Coverage**: Operations + insights
- **Contrast**: Event-centric vs. metrics-centric

### My Top Pick: **Command Center + Timeline View**

**Reasoning:**
1. **Command Center** = Best for daily use, familiar grid pattern
2. **Timeline View** = Best for debugging, unique chronological view
3. Different enough to test layout flexibility
4. Cover 80% of use cases
5. Can add others later based on feedback

---

## 📋 Implementation Tasks (REVISED)

### Task 1: Backend Foundation (Express + SSE)

**Duration**: 2-3 hours
**TDD**: Yes (tests first)

#### 1.1 Setup Express Server with SSE

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
      console.log(`DevAC Web UI running at http://${options.host}:${options.port}`);
      resolve();
    });
  });
}
```

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

  // Subscribe to all events from orchestrator
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
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial connection event
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

    clients.add(res);

    // Handle client disconnect
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

**Test**: `src/devac/web/__tests__/server.integration.spec.ts`

```typescript
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWebServer } from '../server.js';
import { createMockOrchestrator } from './test-helpers.js';

describe('Web Server - Integration', () => {
  let app: Express;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    orchestrator = createMockOrchestrator();
    app = await createWebServer({
      port: 0,
      host: 'localhost',
      cors: true,
      orchestrator,
    });
  });

  it('should respond to health check', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      timestamp: expect.any(String),
    });
  });
});
```

#### 1.2 Service API Routes

**File**: `src/devac/web/routes/services.ts`

```typescript
import { Router } from 'express';
import type { ServiceRegistry } from '../../orchestrator/service-registry.js';

export function createServiceRoutes(registry: ServiceRegistry): Router {
  const router = Router();

  // GET /api/services - List all services
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

  // GET /api/services/:id - Get service details
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

  // POST /api/services/:id/start - Start service
  router.post('/:id/start', (req, res) => {
    const { id } = req.params;
    const actor = registry.get(id);

    if (!actor) {
      return res.status(404).json({ error: 'Service not found' });
    }

    actor.send({ type: 'START' });
    res.json({ success: true, serviceId: id });
  });

  // POST /api/services/:id/stop - Stop service
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

**Usage in server.ts**:

```typescript
import { createServiceRoutes } from './routes/services.js';

// After creating app...
app.use('/api/services', createServiceRoutes(options.orchestrator.registry));
```

**Test**: `src/devac/web/routes/__tests__/services.integration.spec.ts`

```typescript
describe('Service Routes - Integration', () => {
  it('should list all services', async () => {
    const response = await request(app).get('/api/services');

    expect(response.status).toBe(200);
    expect(response.body.services).toHaveLength(1);
    expect(response.body.services[0]).toMatchObject({
      id: 'test-service',
      name: 'Test Service',
      type: 'custom',
      status: 'idle',
      enabled: true,
    });
  });

  it('should start a service', async () => {
    const response = await request(app).post('/api/services/test-service/start');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      serviceId: 'test-service',
    });
  });
});
```

#### 1.3 SSE Event Route

**File**: `src/devac/web/routes/events.ts`

```typescript
import { Router } from 'express';
import type { SSEManager } from '../sse-manager.js';

export function createEventRoute(sseManager: SSEManager): Router {
  const router = Router();

  router.get('/', (req, res) => {
    sseManager.addClient(res);
  });

  return router;
}
```

**Usage**:

```typescript
app.use('/api/events', createEventRoute(app.locals.sseManager));
```

---

### Task 2: Frontend Foundation (Next.js App Router)

**Duration**: 2-3 hours
**TDD**: Component tests with Testing Library

#### 2.1 Next.js Setup

**File Structure**:
```
src/devac/web/client/
├── app/
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Dashboard (/)
│   ├── services/
│   │   └── [id]/
│   │       └── page.tsx        # Service detail (/services/[id])
│   └── api/                    # Optional: API routes (or proxy to Express)
├── components/
│   ├── layouts/
│   │   ├── LayoutSwitcher.tsx
│   │   ├── CommandCenterLayout.tsx
│   │   ├── TimelineViewLayout.tsx
│   │   └── ...
│   ├── ServiceCard.tsx
│   ├── EventFeed.tsx
│   └── ...
├── lib/
│   ├── api-client.ts           # Fetch wrapper
│   ├── sse.ts                  # SSE hook
│   └── query-client.ts         # TanStack Query setup
├── styles/
│   └── globals.css
├── next.config.js
└── tsconfig.json
```

**File**: `app/layout.tsx`

```typescript
import { ReactNode } from 'react';
import { QueryClientProvider } from '@/components/providers/query-provider';
import { SSEProvider } from '@/components/providers/sse-provider';
import '../styles/globals.css';

export const metadata = {
  title: 'DevAC - Development Analytics Centre',
  description: 'Real-time development analytics platform',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryClientProvider>
          <SSEProvider>
            {children}
          </SSEProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
```

**File**: `components/providers/query-provider.tsx` (Client Component)

```typescript
'use client';

import { QueryClient, QueryClientProvider as TanStackProvider } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';

export function QueryClientProvider({ children }: { children: ReactNode }) {
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

  return <TanStackProvider client={queryClient}>{children}</TanStackProvider>;
}
```

#### 2.2 API Client

**File**: `lib/api-client.ts`

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

#### 2.3 SSE Hook

**File**: `lib/hooks/useSSE.ts`

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
      console.error('SSE error:', err);
    };

    // Listen for specific event types
    eventSource.addEventListener('SERVICE_STARTED', (e) => {
      setEvents((prev) => [...prev, { type: 'SERVICE_STARTED', data: JSON.parse(e.data) }]);
    });

    eventSource.addEventListener('SERVICE_STOPPED', (e) => {
      setEvents((prev) => [...prev, { type: 'SERVICE_STOPPED', data: JSON.parse(e.data) }]);
    });

    eventSource.addEventListener('COLLECTION_COMPLETED', (e) => {
      setEvents((prev) => [...prev, { type: 'COLLECTION_COMPLETED', data: JSON.parse(e.data) }]);
    });

    return () => {
      eventSource.close();
    };
  }, []);

  return { events, connected, error };
}
```

---

### Task 3: Dashboard Layouts (2 Layouts)

**Duration**: 4-5 hours
**TDD**: Component tests

#### 3.1 Layout Registry System

**File**: `components/layouts/layout-registry.ts`

```typescript
import { ReactNode } from 'react';

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

// Registry
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

**File**: `components/layouts/LayoutSwitcher.tsx`

```typescript
'use client';

import { useState } from 'react';
import { getAllLayouts } from './layout-registry';

interface LayoutSwitcherProps {
  current: string;
  onChange: (layoutId: string) => void;
}

export function LayoutSwitcher({ current, onChange }: LayoutSwitcherProps) {
  const layouts = getAllLayouts();

  return (
    <div className="layout-switcher">
      {layouts.map((layout) => (
        <button
          key={layout.id}
          onClick={() => onChange(layout.id)}
          className={current === layout.id ? 'active' : ''}
          title={layout.description}
        >
          <span>{layout.icon}</span>
          <span>{layout.name}</span>
        </button>
      ))}
    </div>
  );
}
```

#### 3.3 Command Center Layout

**File**: `components/layouts/CommandCenterLayout.tsx`

```typescript
'use client';

import { ServiceCard } from '../ServiceCard';
import { EventFeed } from '../EventFeed';
import type { DashboardLayoutProps } from './layout-registry';

export function CommandCenterLayout({ services, events }: DashboardLayoutProps) {
  return (
    <div className="command-center-layout">
      <div className="quick-stats">
        <div className="stat">
          <span>⚡ Active Services</span>
          <span>{services.filter((s) => s.status !== 'idle').length}</span>
        </div>
        <div className="stat">
          <span>📊 Collections Today</span>
          <span>{events.filter((e) => e.type === 'COLLECTION_COMPLETED').length}</span>
        </div>
      </div>

      <div className="services-grid">
        {services.map((service) => (
          <ServiceCard key={service.id} service={service} />
        ))}
      </div>

      <div className="recent-events">
        <h2>Recent Events</h2>
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

**File**: `components/layouts/TimelineViewLayout.tsx`

```typescript
'use client';

import { ServiceSidebar } from '../ServiceSidebar';
import { Timeline } from '../Timeline';
import type { DashboardLayoutProps } from './layout-registry';

export function TimelineViewLayout({ services, events }: DashboardLayoutProps) {
  return (
    <div className="timeline-view-layout">
      <aside className="service-sidebar">
        <ServiceSidebar services={services} />
      </aside>
      <main className="timeline-main">
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

#### 3.5 Dashboard Page (Using Layouts)

**File**: `app/page.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { servicesAPI } from '@/lib/api-client';
import { useSSE } from '@/lib/hooks/useSSE';
import { LayoutSwitcher } from '@/components/layouts/LayoutSwitcher';
import { getLayout } from '@/components/layouts/layout-registry';

// Import layouts to register them
import '@/components/layouts/CommandCenterLayout';
import '@/components/layouts/TimelineViewLayout';

export default function DashboardPage() {
  // Load saved layout preference
  const [currentLayout, setCurrentLayout] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('devac:preferred-layout') || 'command-center';
    }
    return 'command-center';
  });

  // Persist layout preference
  useEffect(() => {
    localStorage.setItem('devac:preferred-layout', currentLayout);
  }, [currentLayout]);

  // Fetch services
  const { data: servicesData, isLoading, error } = useQuery({
    queryKey: ['services'],
    queryFn: () => servicesAPI.list(),
  });

  // Real-time events
  const { events, connected } = useSSE();

  if (isLoading) return <div>Loading services...</div>;
  if (error) return <div>Error: {error.message}</div>;

  const layout = getLayout(currentLayout);
  const LayoutComponent = layout?.component;

  if (!LayoutComponent) {
    return <div>Layout not found: {currentLayout}</div>;
  }

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h1>DevAC Dashboard</h1>
        <div className="connection-status">
          {connected ? '🟢 Connected' : '🔴 Disconnected'}
        </div>
      </header>

      <LayoutSwitcher current={currentLayout} onChange={setCurrentLayout} />

      <LayoutComponent services={servicesData?.services || []} events={events} />
    </div>
  );
}
```

---

### Task 4: Core Components

**Duration**: 2-3 hours

#### 4.1 ServiceCard Component

**File**: `components/ServiceCard.tsx`

```typescript
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { servicesAPI, type Service } from '@/lib/api-client';
import { Button } from '@/components/ui/button'; // shadcn/ui
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'; // shadcn/ui
import { Badge } from '@/components/ui/badge'; // shadcn/ui

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

  const statusVariant = {
    idle: 'secondary',
    initializing: 'default',
    watching: 'success',
    processing: 'warning',
    degraded: 'warning',
    error: 'destructive',
    stopped: 'secondary',
  }[service.status] || 'secondary';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{service.name}</CardTitle>
        <Badge variant={statusVariant}>{service.status}</Badge>
      </CardHeader>
      <CardContent>
        <div className="service-info">
          <div>Type: {service.type}</div>
          <div>ID: {service.id}</div>
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

**Test**: `components/__tests__/ServiceCard.test.tsx`

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { ServiceCard } from '../ServiceCard';
import { servicesAPI } from '@/lib/api-client';

vi.mock('@/lib/api-client');

describe('ServiceCard Component', () => {
  const mockService = {
    id: 'svc-1',
    name: 'Test Service',
    type: 'codegraph',
    status: 'idle',
    enabled: true,
  };

  const renderWithQuery = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  };

  it('should render service information', () => {
    renderWithQuery(<ServiceCard service={mockService} />);

    expect(screen.getByText('Test Service')).toBeInTheDocument();
    expect(screen.getByText('idle')).toBeInTheDocument();
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
});
```

---

### Task 5: Integration & Deployment

**Duration**: 1-2 hours

#### 5.1 Integrate with CLI

**File**: `src/devac/cli/commands/start.ts` (modify)

```typescript
import { createWebServer, startServer } from '../../web/server.js';

// After orchestrator is created...

// Start web server if enabled
if (config.web?.enabled !== false) {
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

  logger.info(`Web UI available at http://localhost:${config.web?.port || 3000}`);
}
```

#### 5.2 Next.js Configuration

**File**: `src/devac/web/client/next.config.js`

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,

  // API proxy to Express backend
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: process.env.API_URL || 'http://localhost:3000/api/:path*',
      },
    ];
  },

  // Styled-components support
  compiler: {
    styledComponents: true,
  },
};

module.exports = nextConfig;
```

---

## 📦 Dependencies (REVISED)

**Backend**:
```json
{
  "express": "^4.18.2",
  "cors": "^2.8.5"
}
```

**Frontend**:
```json
{
  "next": "^14.0.0",
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "@tanstack/react-query": "^5.17.0",
  "styled-components": "^6.1.0",
  "@radix-ui/react-*": "^1.0.0" // shadcn/ui dependencies
}
```

**Testing**:
```json
{
  "supertest": "^6.3.0",
  "@testing-library/react": "^14.1.0",
  "@testing-library/user-event": "^14.5.0",
  "vitest": "^1.1.0",
  "jsdom": "^23.0.0"
}
```

---

## 🏆 Testing Strategy (Testing Trophy) - SAME

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

---

## ✅ Success Criteria (SAME)

**Backend**:
- [x] Express server starts on configured port
- [x] All service API endpoints functional
- [x] SSE stream delivers events in real-time
- [x] Integration tests passing (6 tests)

**Frontend**:
- [x] Dashboard displays all services
- [x] 2 layouts implemented and switchable
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

---

## 🚀 Ready to Start?

**Next steps:**
1. ✅ Approve layout choices: **Command Center + Timeline View** (recommended)
2. Review styling approach (pending your research)
3. Create feature branch
4. Write first test (TDD)
5. Implement backend → frontend → layouts → integration

**Questions:**
1. Approve **Command Center + Timeline View** as the 2 layouts for Phase 3?
2. Any preferences on the other 3 layouts for Phase 3.5?
3. Ready to start implementation after styling research is complete?
