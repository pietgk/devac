# Demo Mode - Quick Start Guide

## The Issue You Found

When you visited `http://localhost:3000/`, the UI loaded but showed:

```
Command Center
0 services registered
```

**Why?** Because by default, no services are registered. The UI was working perfectly - it just had nothing to show!

## Solution: Demo Mode

Start DevAC with the `--demo` flag to see 3 mock services:

```bash
npm run devac:dev -- start -p 3000 --demo
```

**Output:**
```
[CLI:Start] info: Registering demo services...
[ServiceRegistry] info: Registered service: demo-api (api)
[ServiceRegistry] info: Registered service: demo-database (database)
[ServiceRegistry] info: Registered service: demo-cache (cache)
[CLI:Start] info: Demo services registered (3 services)
[CLI:Start] info: 🌐 Web UI available at http://localhost:3000
[CLI:Start] info: 💡 Open in browser: http://localhost:3000
```

Now visit `http://localhost:3000/` and you'll see:

```
Command Center
3 services

┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Demo API        │  │ Demo Database   │  │ Demo Cache      │
│ Type: api       │  │ Type: database  │  │ Type: cache     │
│ Status: stopped │  │ Status: stopped │  │ Status: stopped │
│ Health: unknown │  │ Health: unknown │  │ Health: unknown │
│ [Start]         │  │ [Start]         │  │ [Start]         │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## How to Use Demo Mode

### 1. Start with Demo Services

```bash
# Make sure no other instance is running on port 3000
npm run devac:dev -- start -p 3000 --demo
```

### 2. Open Browser

```bash
open http://localhost:3000/
```

### 3. Interact with Services

- Click **"Start"** on any service → Status changes to "starting" → "running"
- Click **"Stop"** on running service → Status changes to "stopping" → "stopped"
- Click **"Restart"** on running service → Service restarts
- Watch the **Timeline** view for real-time events

### 4. Test Features

**Command Center View:**
- Service cards with status/health
- Start/stop/restart buttons
- Live SSE connection indicator
- Auto-refresh every 30 seconds

**Timeline View:**
- Click "Timeline" button (top-right)
- See chronological event stream
- Real-time SSE events appear
- Auto-scroll to new events

## Demo Services

The `--demo` flag creates 3 mock services:

| Service ID | Name | Type |
|-----------|------|------|
| demo-api | Demo API Service | api |
| demo-database | Demo Database | database |
| demo-cache | Demo Cache Service | cache |

### Service Behavior

Each demo service simulates a real service:

1. **Start**: Takes 1 second to transition from "stopped" → "starting" → "running"
2. **Stop**: Takes 0.5 seconds to transition from "running" → "stopping" → "stopped"
3. **Health**: Shows "healthy" when running, "unknown" otherwise
4. **Stats**: Tracks uptime and request count (simulated)

## Without Demo Mode

If you start without `--demo`:

```bash
npm run devac:dev -- start -p 3000
```

You'll see **"0 services registered"** because:

- No services are enabled in `.devac/config.json`
- CodeGraph service: `"enabled": false`
- Git service: `"enabled": false`
- Build service: `"enabled": false`
- Test service: `"enabled": false`

**To enable real services**, edit `.devac/config.json`:

```json
{
  "services": {
    "codegraph": {
      "enabled": true,  // Change from false
      ...
    }
  }
}
```

## Command Reference

```bash
# Start with demo services (recommended for testing UI)
npm run devac:dev -- start -p 3000 --demo

# Start without demo (shows real configured services only)
npm run devac:dev -- start -p 3000

# Start with custom config
npm run devac:dev -- start -c my-config.json --demo

# Start without web UI (API only)
npm run devac:dev -- start --no-web --demo

# Get help
npm run devac:dev -- start --help
```

## CLI Options

```
Options:
  -c, --config <path>     Path to DevAC config file (default: ".devac/config.json")
  -p, --port <number>     Web server port (default: "3000")
  --no-web                Start without web server
  -w, --workspace <name>  Workspace name
  --demo                  Start with demo services for testing the UI
  -h, --help              display help for command
```

## Troubleshooting

### "0 services registered"

**Solution**: Add the `--demo` flag:
```bash
npm run devac:dev -- start -p 3000 --demo
```

### "EADDRINUSE: address already in use"

**Problem**: Another process is using port 3000

**Solutions**:
```bash
# Option 1: Stop the other process
# Find the process
lsof -i :3000
# Kill it
kill -9 <PID>

# Option 2: Use a different port
npm run devac:dev -- start -p 4000 --demo
```

### Services don't appear in UI

**Check**:
1. Is the server running? (`npm run devac:dev -- start --demo`)
2. Did you use the `--demo` flag?
3. Open browser DevTools console - any errors?
4. Visit `http://localhost:3000/api/services` - what does it return?

## Testing the Full Flow

```bash
# 1. Start with demo services
npm run devac:dev -- start -p 3000 --demo

# 2. In another terminal, test the API
curl http://localhost:3000/api/services | jq .

# Expected output:
# [
#   {
#     "id": "demo-api",
#     "name": "Demo API Service",
#     "type": "api",
#     "status": "stopped",
#     ...
#   },
#   ... (2 more services)
# ]

# 3. Open browser
open http://localhost:3000/

# 4. Click "Start" on a service

# 5. Check API again
curl http://localhost:3000/api/services | jq '.[0].status'
# Expected: "running" or "starting"
```

## Summary

**Problem**: UI showed "0 services registered"  
**Cause**: No services configured by default  
**Solution**: Use `--demo` flag for testing  

```bash
npm run devac:dev -- start -p 3000 --demo
```

Now you have 3 interactive services to test the UI! 🎉
