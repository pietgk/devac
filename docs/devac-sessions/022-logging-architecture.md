# Logging Architecture Options

## Current State: The Confusion

We currently have **two separate logging systems** that don't talk to each other:

1. **Winston Logger** (global) - writes to `logs/combined.log` and `logs/error.log`
2. **Round-Robin Logger** (service-specific) - writes to numbered files `001.log`, `002.log`, etc.

This creates confusion and duplication. Let's visualize options to unify this.

---

## Option 1: File-Based Architecture (Recommended)

**Principle**: Files are the source of truth. Everything reads from files.

```mermaid
graph TB
    subgraph "Service Layer"
        S1[Service 1: CodeGraph]
        S2[Service 2: Future Service]
    end
    
    subgraph "Logging Layer"
        S1 -->|log.info/error| WL[Winston Logger]
        S2 -->|log.info/error| WL
        
        WL -->|writes| CF[logs/combined.log]
        WL -->|writes| EF[logs/error.log]
        WL -->|warn/error only| EB[Event Bus]
    end
    
    subgraph "Storage Layer"
        CF -->|rotating files| F1[combined.1.log]
        CF -->|rotating files| F2[combined.2.log]
        EF -->|rotating files| E1[error.1.log]
    end
    
    subgraph "Access Layer"
        API["/api/logs endpoint"]
        API -->|reads| CF
        API -->|reads| EF
        API -->|filters & returns| JSON[JSON Response]
    end
    
    subgraph "Real-Time Layer"
        EB -->|publishes| SSE[SSE /api/logs/stream]
        SSE -->|streams to| UI[Web UI]
        JSON -->|fetched by| UI
    end
    
    subgraph "UI Layer"
        UI -->|displays| LV[Log Viewer Component]
        LV -->|shows| LOGS[Filterable Log List]
        LV -->|search| SEARCH[Search & Filter]
    end

    style WL fill:#4CAF50
    style CF fill:#2196F3
    style EB fill:#FF9800
    style UI fill:#9C27B0
```

**Pros:**
- ✅ Single source of truth (files)
- ✅ Logs persist across restarts
- ✅ Can use standard tools (tail, grep) on log files
- ✅ No duplication - Winston handles all file writing
- ✅ EventBus only for real-time updates (not storage)

**Cons:**
- ⚠️ API needs to read/parse log files (I/O overhead)
- ⚠️ Need to implement file reading & filtering logic

---

## Option 2: EventBus-First Architecture

**Principle**: EventBus is the source of truth. Files are just a backup.

```mermaid
graph TB
    subgraph "Service Layer"
        S1[Service 1: CodeGraph]
        S2[Service 2: Future Service]
    end
    
    subgraph "Logging Layer"
        S1 -->|log.info/error| WL[Winston Logger]
        S2 -->|log.info/error| WL
        
        WL -->|all levels| EB[Event Bus]
        EB -->|stores in memory| LH[Log History Array<br/>last 1000 entries]
    end
    
    subgraph "Backup Storage"
        EB -->|async write| CF[logs/combined.log]
        EB -->|async write| EF[logs/error.log]
    end
    
    subgraph "Access Layer"
        API["/api/logs endpoint"]
        API -->|reads from| LH
        API -->|filters & returns| JSON[JSON Response]
        
        SSE[SSE /api/logs/stream]
        EB -->|subscribes| SSE
    end
    
    subgraph "UI Layer"
        JSON -->|fetched by| UI[Web UI]
        SSE -->|streams to| UI
        UI -->|displays| LV[Log Viewer Component]
    end

    style EB fill:#FF9800
    style LH fill:#4CAF50
    style UI fill:#9C27B0
```

**Pros:**
- ✅ Fast API responses (in-memory)
- ✅ No file I/O on API requests
- ✅ Real-time updates trivial (EventBus subscription)
- ✅ Unified architecture (one system)

**Cons:**
- ❌ Logs lost on restart (only last 1000 in memory)
- ❌ Can't view historical logs beyond memory limit
- ❌ Higher memory usage
- ❌ Files become "second class" backups

---

## Option 3: Hybrid Architecture (Best of Both)

**Principle**: EventBus for real-time, files for history. Smart caching.

```mermaid
graph TB
    subgraph "Service Layer"
        S1[Service 1: CodeGraph]
        S2[Service 2: Future Service]
    end
    
    subgraph "Logging Core"
        S1 -->|log.info/error| WL[Winston Logger]
        S2 -->|log.info/error| WL
        
        WL -->|all levels| CF[logs/combined.log<br/>rotating files]
        WL -->|errors only| EF[logs/error.log<br/>rotating files]
        WL -->|warn/error| EB[Event Bus<br/>last 500 entries]
    end
    
    subgraph "API Layer"
        API["/api/logs endpoint"]
        
        API -->|query type| ROUTER{Query Type?}
        
        ROUTER -->|recent logs<br/>last 10min| EB
        ROUTER -->|historical<br/>older logs| READER[File Reader]
        READER -->|parses & filters| CF
        READER -->|parses & filters| EF
        
        EB -->|fast| JSON1[JSON Response]
        READER -->|slower| JSON2[JSON Response]
    end
    
    subgraph "Real-Time Layer"
        SSE[SSE /api/logs/stream]
        EB -->|publishes| SSE
        SSE -->|streams to| UI[Web UI]
    end
    
    subgraph "UI Layer"
        JSON1 -->|displays| UI
        JSON2 -->|displays| UI
        UI -->|shows| LV[Log Viewer Component]
        LV -->|auto-detects| MODE{Time Range?}
        MODE -->|recent| FAST[Use SSE + EventBus]
        MODE -->|historical| SLOW[Use API + Files]
    end

    style WL fill:#4CAF50
    style EB fill:#FF9800
    style READER fill:#2196F3
    style UI fill:#9C27B0
```

**Pros:**
- ✅ Fast for recent logs (EventBus)
- ✅ Complete history available (files)
- ✅ Real-time updates work (SSE)
- ✅ Survives restarts
- ✅ Flexible - UI chooses source based on query

**Cons:**
- ⚠️ More complex implementation
- ⚠️ Need to implement file parsing logic
- ⚠️ UI needs logic to choose data source

---

## Detailed Component Breakdown

### Winston Logger Configuration

```mermaid
graph LR
    WL[Winston Logger] --> T1[Console Transport<br/>colorized, formatted]
    WL --> T2[File Transport<br/>combined.log<br/>JSON format]
    WL --> T3[File Transport<br/>error.log<br/>JSON format]
    WL --> T4[Custom Transport<br/>EventBus Publisher<br/>warn/error only]
    
    T2 --> ROT1[Winston Rotating<br/>5MB x 5 files]
    T3 --> ROT2[Winston Rotating<br/>5MB x 3 files]
    
    style T4 fill:#FF9800
```

### EventBus Log Management

```mermaid
graph TB
    EB[Event Bus]
    
    EB -->|maintains| LH["logHistory: LogEntry[]"]
    EB -->|provides| M1[getLogHistory<br/>filters: level, service, time]
    EB -->|provides| M2[subscribe to LOG_ENTRY]
    EB -->|limits| MAX[Max 500-1000 entries<br/>FIFO queue]
    
    LH -->|structure| ENTRY[LogEntry:<br/>- level<br/>- message<br/>- timestamp<br/>- service<br/>- metadata<br/>- stack?]
```

### API Endpoints Design

```mermaid
graph TB
    subgraph "REST API"
        GET[GET /api/logs]
        GET -->|query params| Q1[?level=error,warn]
        GET -->|query params| Q2[?service=codegraph]
        GET -->|query params| Q3[?since=timestamp]
        GET -->|query params| Q4[?limit=100]
        GET -->|query params| Q5[?search=text]
        
        GET -->|returns| RES["JSON Array:<br/>LogEntry[]"]
    end
    
    subgraph "SSE Stream"
        SSE[GET /api/logs/stream]
        SSE -->|query params| S1[?level=error,warn]
        SSE -->|query params| S2[?service=codegraph]
        
        SSE -->|streams| EVENTS[Server-Sent Events:<br/>event: log<br/>data: LogEntry JSON]
    end
    
    subgraph "Backend Logic"
        GET --> ROUTER{Source?}
        ROUTER -->|recent| EB[EventBus.getLogHistory]
        ROUTER -->|historical| FR[FileReader.readLogs]
        
        SSE --> SUB[EventBus.subscribe<br/>LOG_ENTRY]
    end
```

---

## Recommendation: Option 3 (Hybrid)

### Why Hybrid is Best

1. **Practical for your use case**:
   - You want to see errors immediately → EventBus + SSE
   - I need to access historical logs → File reading
   - Services restart → Files persist data

2. **Performance where it matters**:
   - Real-time monitoring is fast (no file I/O)
   - Historical analysis is available (reads files when needed)

3. **No duplication**:
   - Remove round-robin logger entirely
   - Winston handles all file writing
   - EventBus only stores recent logs for real-time

4. **Clean separation of concerns**:
   - Winston = log writing & formatting
   - EventBus = real-time pub/sub
   - API = intelligent routing
   - UI = displays regardless of source

### Implementation Steps (Hybrid)

1. **Remove Round-Robin Logger**
   - Delete `round-robin-logger.ts`
   - Services use only Winston contextLogger

2. **Enhance Winston**
   - Add custom EventBus transport
   - Only publishes warn/error to EventBus
   - Keeps all levels in files

3. **Enhance EventBus**
   - Add `logHistory` array (separate from events)
   - Add `getLogHistory(filters)` method
   - Limit to 500 entries (FIFO)

4. **Create API Endpoints**
   - `/api/logs` - GET with filters
   - `/api/logs/stream` - SSE endpoint
   - Logic: recent = EventBus, old = files

5. **Create File Reader**
   - Parses JSON log files
   - Filters by level, service, time, search
   - Returns as LogEntry array

6. **Update UI**
   - Add log viewer section
   - Subscribe to SSE for real-time
   - Fetch API for initial load
   - Add filters & search

---

## Questions for Clarification

1. **EventBus log history size**: 500 or 1000 entries?
2. **File reading frequency**: Should API cache parsed logs or read on every request?
3. **Log levels to stream**: Just warn/error, or include info?
4. **Service-specific log files**: Keep them or use Winston tags/context only?

---

## Next Steps

Once you approve Option 3 (Hybrid), I'll create detailed implementation tasks with code examples for each component.
