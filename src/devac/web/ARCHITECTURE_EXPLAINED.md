# DevAC Web UI Architecture - Explained

## The Confusion

When you start DevAC and visit `http://localhost:3000/` in your browser, you get:

```json
{"error":"Not found","path":"/"}
```

**Why?** Because port 3000 is running an **API server**, not a website.

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                   │
│  Your Computer                                                    │
│                                                                   │
│  ┌──────────────────────┐        ┌─────────────────────────┐   │
│  │                      │        │                         │   │
│  │  demo.html           │───────>│  Express API Server     │   │
│  │  (file://...)        │  HTTP  │  (localhost:3000)       │   │
│  │                      │<───────│                         │   │
│  │  - Opens in browser  │  JSON  │  Routes:                │   │
│  │  - JavaScript code   │  SSE   │  ✅ /health             │   │
│  │  - Makes API calls   │        │  ✅ /api/services       │   │
│  │                      │        │  ✅ /api/events         │   │
│  └──────────────────────┘        │  ❌ / (404 Not Found)   │   │
│                                   └─────────────────────────┘   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## What's Running Where?

### Port 3000: API Server (Backend)

**What it does:**
- Serves JSON data via REST API
- Streams real-time events via SSE
- Connects to the orchestrator

**What it does NOT do:**
- Serve HTML pages
- Serve a user interface
- Have a homepage

**Available endpoints:**
```bash
curl http://localhost:3000/health           # ✅ Works
curl http://localhost:3000/api/services     # ✅ Works
curl http://localhost:3000/api/events       # ✅ Works (SSE)
curl http://localhost:3000/                 # ❌ 404 Not Found
```

### demo.html: Frontend (Opens Separately)

**What it is:**
- A standalone HTML file
- Contains JavaScript, CSS, and UI code
- Lives in: `src/devac/web/frontend/demo.html`

**How to use it:**
```bash
# Option 1: Open directly
open src/devac/web/frontend/demo.html

# Option 2: Double-click the file in Finder
```

**What it does:**
- Opens in your browser via `file://` protocol
- Connects to `http://localhost:3000` API
- Displays the UI
- Controls services via API calls

## Why This Design?

This is a **common pattern** for API-first applications:

1. **Separation of Concerns**
   - Backend (API) = Port 3000
   - Frontend (UI) = Separate HTML file

2. **Flexibility**
   - Can build different frontends (React, Vue, Angular, plain HTML)
   - Can use API from other tools (curl, Postman, scripts)
   - Can deploy backend and frontend separately

3. **Development Speed**
   - No build step for demo.html
   - Just refresh browser to see changes
   - Backend and frontend can be developed independently

## The Problem

**It's confusing!** Users expect to visit `http://localhost:3000/` and see a UI.

## Solutions

### Option 1: Current (Separate Files) ✅ Current

```bash
# Start backend
npm run devac:dev -- start -p 3000

# Open frontend separately
open src/devac/web/frontend/demo.html
```

**Pros:**
- ✅ No build step needed
- ✅ Simple architecture
- ✅ Easy to develop

**Cons:**
- ❌ Confusing UX (two steps)
- ❌ Can't just visit http://localhost:3000
- ❌ Have to remember to open demo.html

### Option 2: Serve demo.html from Port 3000 (Easy Fix)

Add static file serving to Express:

```typescript
// Serve frontend files
app.use(express.static(path.join(__dirname, "frontend")));

// Now http://localhost:3000/ serves demo.html
// And http://localhost:3000/api/* still works
```

```bash
# Start backend (also serves frontend now)
npm run devac:dev -- start -p 3000

# Visit in browser
open http://localhost:3000/
```

**Pros:**
- ✅ Single step to start everything
- ✅ Visit http://localhost:3000 and it works
- ✅ Still no build step

**Cons:**
- ⚠️ API needs to update BASE_URL in demo.html dynamically
- ⚠️ Slightly more complex server setup

### Option 3: Build a Proper Next.js App (Future)

Create a real Next.js application:

```
frontend-app/
  pages/
    index.tsx           # Command Center
    timeline.tsx        # Timeline View
  components/
    ServiceCard.tsx
  lib/
    api-client.ts
```

**Pros:**
- ✅ Professional setup
- ✅ Server-side rendering
- ✅ Proper routing
- ✅ Production-ready

**Cons:**
- ❌ Requires build step
- ❌ More complex setup
- ❌ Takes more time

## Recommended Immediate Fix

**Add static file serving (Option 2):**

This gives you the best of both worlds:
- Visit `http://localhost:3000/` → See UI ✅
- Visit `http://localhost:3000/api/services` → Get JSON ✅
- Still no build step ✅
- One command to start everything ✅

## Current Usage (Until Fixed)

**Two-step process:**

```bash
# Terminal 1: Start backend API
npm run devac:dev -- start -p 3000

# Terminal 2 or Finder: Open frontend
open src/devac/web/frontend/demo.html
```

**In the demo.html, it connects to localhost:3000:**
```javascript
const BASE_URL = window.TEST_BASE_URL || "http://localhost:3000";
```

## Quick Reference

| What | Where | How to Access |
|------|-------|---------------|
| Backend API | Port 3000 | `curl http://localhost:3000/api/services` |
| Frontend UI | demo.html file | `open src/devac/web/frontend/demo.html` |
| Health Check | `/health` endpoint | `curl http://localhost:3000/health` |
| Service List | `/api/services` endpoint | `curl http://localhost:3000/api/services` |
| SSE Stream | `/api/events` endpoint | `curl -N http://localhost:3000/api/events` |

## Summary

**Current State:**
- Port 3000 = API only (no homepage)
- demo.html = UI (open separately)
- Two separate pieces that talk to each other

**Why the 404:**
- There's no route for `/` 
- Only API routes exist (`/api/*`, `/health`)

**To fix:**
- Add static file serving to Express server
- Serve demo.html at `http://localhost:3000/`
- Still keep all API routes working

Would you like me to implement Option 2 (serve demo.html from port 3000)?
