# DevAC Web UI - Testing Guide

This guide provides step-by-step instructions for testing the DevAC Web UI integration with the backend.

## Prerequisites

- Backend server built and ready to run
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Node.js installed

## Quick Start

### 1. Start the Backend Server

First, build the project if you haven't already:

```bash
npm run build
```

Then start the DevAC server with web UI enabled:

```bash
# Start DevAC with web server on port 3000
npm run devac:dev -- start -p 3000

# Or use the built version
npm run devac -- start -p 3000
```

Expected output:
```
[CLI:Start] info: Starting DevAC...
[Orchestrator] info: Orchestrator started
[CLI:Start] info: Starting web server...
[WebServer] info: Creating web server...
[SSEManager] info: Starting SSE Manager...
[WebServer] info: Web server listening on http://localhost:3000
[CLI:Start] info: Web UI available at http://localhost:3000
[CLI:Start] info: Open the demo: open src/devac/web/frontend/demo.html
[CLI:Start] info: DevAC is running. Press Ctrl+C to stop.
```

### 2. Test with HTML Demo

Open the demo page in your browser:

```bash
# On macOS
open src/devac/web/frontend/demo.html

# On Linux
xdg-open src/devac/web/frontend/demo.html

# On Windows
start src/devac/web/frontend/demo.html
```

**What to verify:**

✅ **Page loads without errors**
- Title shows "DevAC Command Center"
- No console errors in browser DevTools

✅ **Backend connection works**
- Service count shows "2 services" (or actual count)
- Service cards appear in the grid
- Each card shows service name, type, status, and health

✅ **SSE connection establishes**
- SSE status badge shows "Live" (green)
- Recent events section shows connection event
- Events appear in the list

✅ **Service controls work**
- Click "Start" on a stopped service → status changes to "starting" or "running"
- Click "Stop" on a running service → status changes to "stopping" or "stopped"  
- Click "Restart" on a running service → service restarts

✅ **Real-time updates**
- When you start/stop a service, events appear in the events list
- Service card updates automatically
- Heartbeat events appear every 30 seconds

### 3. Test API Endpoints Directly

You can also test the API endpoints using curl or a tool like Postman:

```bash
# Health check
curl http://localhost:3000/health

# List all services
curl http://localhost:3000/api/services

# Get specific service
curl http://localhost:3000/api/services/test-service-1

# Start a service
curl -X POST http://localhost:3000/api/services/test-service-1/start

# Stop a service (graceful)
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"graceful": true}' \
  http://localhost:3000/api/services/test-service-1/stop

# Restart a service
curl -X POST http://localhost:3000/api/services/test-service-1/restart

# Get service health
curl http://localhost:3000/api/services/test-service-1/health

# Get SSE stats
curl http://localhost:3000/api/events/stats
```

### 4. Test SSE Connection

Test the SSE stream using curl:

```bash
curl -N http://localhost:3000/api/events
```

You should see:
```
event: connection
data: {"clientId":"...","timestamp":"...","message":"Connected"}

event: heartbeat
data: {"timestamp":"...","connectedClients":1}
```

Press Ctrl+C to disconnect.

## Testing Checklist

### Backend API Tests

- [ ] Health endpoint returns `{"status":"ok",...}`
- [ ] Services list returns array of services
- [ ] Service details include id, name, type, status, health, stats
- [ ] Start command returns success message
- [ ] Stop command returns success message
- [ ] Restart command returns success message
- [ ] Health check returns service health status
- [ ] SSE stats endpoint returns connection info
- [ ] 404 error for non-existent service

### SSE Connection Tests

- [ ] SSE connection establishes successfully
- [ ] Connection event received on connect
- [ ] Heartbeat events received every 30 seconds
- [ ] Service events received when services change
- [ ] Multiple clients can connect simultaneously
- [ ] Disconnection is handled gracefully
- [ ] Reconnection works after server restart

### Frontend Integration Tests

- [ ] Page loads without JavaScript errors
- [ ] Services are fetched and displayed on load
- [ ] Service cards show correct information
- [ ] Status badges show correct colors
- [ ] Health badges show correct colors
- [ ] Start button appears for stopped services
- [ ] Stop button appears for running services
- [ ] Restart button appears for running services
- [ ] Button clicks trigger API calls
- [ ] Service status updates after actions
- [ ] SSE connection status shows "Live" when connected
- [ ] SSE connection status shows "Disconnected" when offline
- [ ] Events appear in the events list
- [ ] Events list shows timestamps
- [ ] Events list scrolls correctly
- [ ] Auto-refresh works (every 30 seconds)
- [ ] Error messages display when actions fail

### Edge Cases

- [ ] Server not running → "Disconnected" badge, no services
- [ ] Network interruption → SSE reconnects automatically
- [ ] Rapid button clicks → loading state prevents double actions
- [ ] Service errors → error message displays in card
- [ ] Long uptime → formatted correctly (e.g., "2h 15m")
- [ ] Zero requests → shows "0" not error
- [ ] Multiple browser tabs → each gets own SSE connection

## Troubleshooting

### Services not loading

**Problem**: Service cards don't appear, console shows fetch errors

**Solution**:
1. Check backend server is running: `curl http://localhost:3000/health`
2. Check CORS is enabled in server config
3. Verify demo.html `BASE_URL` is correct (should be `http://localhost:3000`)

### SSE not connecting

**Problem**: SSE status shows "Disconnected", no events appear

**Solution**:
1. Test SSE endpoint directly: `curl -N http://localhost:3000/api/events`
2. Check browser console for SSE connection errors
3. Verify server logs show SSE manager started
4. Try closing other tabs that might have SSE connections

### Service actions don't work

**Problem**: Clicking start/stop buttons does nothing

**Solution**:
1. Check browser console for errors
2. Verify API endpoints work: `curl -X POST http://localhost:3000/api/services/test-service-1/start`
3. Check server logs for action processing
4. Verify service is in correct state (can't start a running service)

### CORS errors

**Problem**: Browser console shows CORS policy errors

**Solution**:
1. Ensure server started with `cors: true` option
2. Check server logs confirm CORS middleware loaded
3. If using custom origin, verify it's allowed in CORS config

## Performance Benchmarks

Expected performance for a healthy system:

- **API Response Time**: < 50ms for service list
- **SSE Connection**: < 100ms to establish
- **Service Action**: < 200ms to process start/stop
- **Event Delivery**: < 10ms from trigger to client
- **Page Load**: < 1s for initial render
- **Auto-refresh**: < 100ms to update 10 services

## Browser Compatibility

Tested and working in:

- ✅ Chrome 120+
- ✅ Firefox 120+
- ✅ Safari 17+
- ✅ Edge 120+

**Note**: Internet Explorer is not supported (no EventSource API)

## Next Steps

After verifying the demo works:

1. **Build React Components**: Use the React components in `src/devac/web/frontend/components/`
2. **Set up Next.js**: Create a proper Next.js app for production
3. **Add Authentication**: Implement auth for production use
4. **Add More Layouts**: Service Monitor, Analytics Dashboard, etc.
5. **E2E Tests**: Add Playwright tests for automated testing

## Additional Resources

- Backend API docs: See Phase 1 completion document
- SSE specification: https://html.spec.whatwg.org/multipage/server-sent-events.html
- Express CORS: https://expressjs.com/en/resources/middleware/cors.html
