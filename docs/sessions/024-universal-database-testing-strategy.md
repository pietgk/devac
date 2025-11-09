# Complete Integration Testing Database Strategy Specification

## 1. Problem Statement

Enable integration tests to run across three environments without Docker dependency:
- **Local development** (laptop with Docker available)
- **CI/CD pipelines** (GitHub Actions, GitLab CI)
- **Claude Code web** (no Docker available)

---

## 2. Core Design Principle

**Graceful degradation through automatic strategy selection:**

```
Service (pre-existing) → Container (Docker) → Native (binaries)
```

Each strategy attempts to provide a database connection. If unavailable, fall back to the next strategy automatically.

---

## 3. Three-Strategy Architecture

### Strategy 1: Service (Pre-existing Database)

**Detection Method:** TCP port connectivity check

**Use Case:**
- Developer has PostgreSQL already running locally (port 5432)
- CI environment has database service container pre-configured
- Shared development database exists

**Advantages:**
- Instant (0ms startup)
- No resource allocation needed
- Can use production-like configurations

**Disadvantages:**
- Shared state between test runs
- Requires manual setup/maintenance
- Not isolated

**Implementation:**
```typescript
async function detectService(config: DbConfig): Promise<boolean> {
  try {
    const socket = await net.connect(config.port, config.host);
    socket.end();
    return true;
  } catch {
    return false;
  }
}
```

---

### Strategy 2: Container (Docker/Testcontainers)

**Detection Method:** Docker daemon accessibility check

**Use Case:**
- Local development with Docker Desktop
- CI/CD with Docker-in-Docker or service containers
- Standard integration testing workflow

**Advantages:**
- Strong isolation
- High production parity
- Version matrix testing capability
- Established tooling (Testcontainers)

**Disadvantages:**
- Requires Docker runtime
- 5-10s startup overhead
- Resource intensive
- Fails in Claude Code web

**Implementation:**
```typescript
async function detectDocker(): Promise<boolean> {
  try {
    await exec('docker info');
    return true;
  } catch {
    return false;
  }
}
```

---

### Strategy 3: Native (Embedded/Downloaded Binaries)

**Detection Method:** Always available (last resort)

**Use Case:**
- Claude Code web environment
- Containerless CI runners
- Lightweight testing scenarios
- Developer machines without Docker

**Advantages:**
- No Docker dependency
- Works everywhere
- Moderate isolation (process-level)
- Faster than containers (3-7s startup)

**Disadvantages:**
- Binary download on first run
- Platform-specific implementations
- May differ from production behavior
- Requires runtime management (Java for some DBs)

**Available Runtimes:**
- ✅ Java JDK (multiple versions configurable via `JAVA_HOME`)
- ✅ Node.js (primary development environment)
- ✅ .NET (for specific future development needs)

---

## 4. Runtime Environment Capabilities

### Execution Environments

| Runtime | Availability | Use Cases |
|---------|--------------|-----------|
| **Node.js** | ✅ Primary | Process spawning, lightweight tools, primary integration |
| **Java JDK** | ✅ Configured | Zonky, Test Harness, DynamoDB Local, can use multiple versions |
| **.NET** | ✅ Supported | Future-specific development needs |

**Key Insight:** Choose best tool for job regardless of runtime. Node.js can easily spawn Java processes when Java-based tools are superior.

---

## 5. Database-Specific Native Strategies

### PostgreSQL

| Priority | Strategy | Technology | Notes |
|----------|----------|------------|-------|
| **1** | **Zonky Embedded** | Java | Most mature, automatic port/cleanup, battle-tested |
| **2** | **PGlite** | JavaScript/WASM | Pure JS, fast startup, may lack extensions |
| **3** | **Official Tarball** | Binary | Production parity, manual lifecycle |

**Recommendation:** **Zonky (Java wrapper)** - Most elegant with Java available

```typescript
// Node.js spawning Java-based Zonky
class ZonkyPostgresProvider {
  async start(config: DbConfig): Promise<DbInstance> {
    const process = spawn('java', [
      '-jar', 'postgres-zonky-wrapper.jar',
      '--version', config.version,
      '--port', config.port || 'auto'
    ]);

    const connectionString = await this.waitForReady(process);
    return { connectionString, stop: () => process.kill() };
  }
}
```

---

### MySQL

| Priority | Strategy | Technology | Notes |
|----------|----------|------------|-------|
| **1** | **Official Tarball** | Binary | Standard MySQL distribution |
| **2** | **MariaDB Binary** | Binary | MySQL-compatible, easier licensing |
| **3** | ~~Wix Embedded MySQL~~ | ~~Java~~ | ❌ Deprecated, not recommended |

**Recommendation:** **Official MySQL tarball** - Direct binary approach

```typescript
async function startNativeMySQL(config: DbConfig): Promise<DbInstance> {
  // 1. Download/cache MySQL binary
  const mysqlBinary = await downloadMySQL(config.version);

  // 2. Initialize data directory
  await exec(`${mysqlBinary}/bin/mysqld --initialize-insecure`);

  // 3. Start MySQL process
  const process = spawn(`${mysqlBinary}/bin/mysqld`, [
    `--datadir=${tempDir}/data`,
    `--port=${config.port || 3306}`,
    '--skip-grant-tables'
  ]);

  return {
    connectionString: `mysql://localhost:${config.port}`,
    stop: () => process.kill()
  };
}
```

---

### Neo4j

| Priority | Strategy | Technology | Notes |
|----------|----------|------------|-------|
| **1** | **Neo4j Test Harness** | Java | Official testing framework |
| **2** | **Official Tarball** | Binary | Manual setup, production-like |

**Recommendation:** **Test Harness (Java)** - Official and integrated

**Note:** Neo4j requires Java runtime regardless of approach.

---

### DynamoDB

| Priority | Strategy | Technology | Notes |
|----------|----------|------------|-------|
| **1** | **DynamoDB Local JAR** | Java | Official AWS testing tool |
| **2** | **Dynalite** | JavaScript | Lightweight clone, pure Node.js |

**Recommendation:** **DynamoDB Local JAR (Java)** - Official and feature-complete

```typescript
async function startDynamoDBLocal(config: DbConfig): Promise<DbInstance> {
  const process = spawn('java', [
    '-jar', 'DynamoDBLocal.jar',
    '-inMemory',
    '-port', config.port || '8000'
  ]);

  return {
    connectionString: `http://localhost:${config.port}`,
    stop: () => process.kill()
  };
}
```

---

## 6. Selection Algorithm

```typescript
async function getDatabaseConnection(config: DbConfig): Promise<Connection> {
  // 1. Detect environment capabilities
  const hasService = await detectService(config);
  const hasDocker = await detectDocker();
  const hasJava = await detectJava();

  // 2. Try Service strategy
  if (hasService && config.strategies.service.enabled) {
    return await connectToService(config);
  }

  // 3. Try Container strategy
  if (hasDocker && config.strategies.container.enabled) {
    return await startContainer(config);
  }

  // 4. Fall back to Native strategy
  if (config.strategies.native.enabled) {
    return await startNative(config, hasJava);
  }

  // 5. No strategy available - fail gracefully
  throw new Error(
    `Cannot start ${config.database_type}. ` +
    `Enable Docker or configure a pre-existing service.`
  );
}
```

---

## 7. Configuration Schema

```yaml
database_type: postgresql | neo4j | mysql | dynamodb
version: string

strategies:
  service:
    connection_url: string  # Env var expandable: ${POSTGRES_URL}
    enabled: boolean        # Default: true

  container:
    image: string          # e.g., postgres:14
    enabled: boolean       # Default: true

  native:
    strategy: string       # Database-specific (zonky | tarball | pglite)
    version: string
    java_home: string      # ${JAVA_HOME} - auto-detected
    enabled: boolean       # Default: true
```

---

## 8. Environment Variable Convention

**Detection:**
- `{DB_NAME}_URL` → Pre-existing service detected
- `CONTAINER_RUNTIME_DISABLED=true` → Skip container strategy
- `FORCE_STRATEGY={service|container|native}` → Override selection
- `JAVA_HOME` → Java runtime path (auto-detected)

**Examples:**
```bash
# Use existing service
POSTGRES_URL=postgresql://localhost:5432/test

# Skip containers
CONTAINER_RUNTIME_DISABLED=true

# Force specific strategy
FORCE_STRATEGY=native

# Configure Java (if multiple versions)
JAVA_HOME=/usr/lib/jvm/java-17-openjdk
```

---

## 9. Database-Specific Implementation Matrix

| Database | Service Detection | Container Image | Native Primary | Native Fallback |
|----------|-------------------|-----------------|----------------|-----------------|
| **PostgreSQL** | Port 5432 | `postgres:{ver}` | Zonky (Java) | Official tarball → PGlite |
| **Neo4j** | Port 7687 | `neo4j:{ver}` | Test Harness (Java) | Official tarball |
| **MySQL** | Port 3306 | `mysql:{ver}` | Official tarball | MariaDB binary |
| **DynamoDB** | Port 8000 | `amazon/dynamodb-local` | Local JAR (Java) | Dynalite (Node) |

---

## 10. Performance Characteristics

| Strategy | Startup Time | Isolation | Production Parity | Resource Usage | Docker Required |
|----------|--------------|-----------|-------------------|----------------|-----------------|
| **Service** | 0s (pre-started) | Shared | High | Shared | No |
| **Container** | 5-10s | Strong | High | Medium | Yes |
| **Native** | 3-7s | Process-level | Medium-High | Low | No |

---

## 11. Logging Requirements

Every test run must log:
```
[INFO] Database: {database_type}
[INFO] Runtime Available: Node.js=✓ Java=✓ .NET=✓
[INFO] Strategy Selected: {SERVICE|CONTAINER|NATIVE}
[INFO] Native Provider: {zonky|tarball|pglite|test-harness|local-jar|dynalite}
[INFO] Startup Time: {duration}
[INFO] Connection: {sanitized_url}
```

---

## 12. Success Criteria

- ✅ Single test class runs unmodified in all 3 environments
- ✅ Strategy automatically selected based on availability
- ✅ Zero manual configuration for standard cases
- ✅ Explicit override capability for testing/debugging
- ✅ Clear logging of selected strategy and provider
- ✅ Graceful failure with actionable error messages
- ✅ Support for multiple runtime environments (Java, Node, .NET)
- ✅ Optimal tool selection regardless of runtime

---

## 13. Native Strategy Decision Tree

```
For each database, select Native strategy:

PostgreSQL:
├─ Java available?
│  ├─ YES → Use Zonky (primary) - most mature
│  └─ NO → Use PGlite (JS) or tarball
└─ Need specific PG version/extension?
   └─ YES → Use official tarball

MySQL:
├─ Use official MySQL tarball (primary)
└─ Fallback: MariaDB binary if licensing concerns

Neo4j:
├─ Java available?
│  ├─ YES → Use Test Harness (only real option)
│  └─ NO → Use official tarball (manual setup)
└─ Note: Neo4j requires Java regardless

DynamoDB:
├─ Java available?
│  ├─ YES → Use DynamoDB Local JAR (official)
│  └─ NO → Use Dynalite (Node, lightweight)
└─ Need full AWS DynamoDB API?
   └─ YES → Use Local JAR
```

---

## 14. Trade-offs Accepted

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Startup Time Variation** | 0-10s range | Acceptable for integration tests |
| **Strategy Complexity** | 3 strategies | Minimal set covering all environments |
| **Native Binary Downloads** | First-run overhead | Cached for subsequent runs |
| **Service Detection** | TCP-based only | Simple, reliable, no false positives |
| **Runtime Dependencies** | Java + Node + .NET | Best tool for job > runtime purity |
| **MySQL Native** | Tarball approach | No embedded library, but viable |
| **Process Spawning** | Cross-runtime | Node can spawn Java processes easily |

---

## 15. Implementation Priorities

### Phase 1: Core Framework
1. Strategy detection and selection algorithm
2. Service strategy (simplest - just connection)
3. Container strategy (leverage existing Testcontainers)

### Phase 2: Native Strategies (Priority Order)
1. **PostgreSQL** - Zonky (Java wrapper)
2. **DynamoDB** - Local JAR (Java)
3. **Neo4j** - Test Harness (Java)
4. **MySQL** - Official tarball

### Phase 3: Fallbacks
1. PGlite for PostgreSQL (pure JS)
2. Dynalite for DynamoDB (pure JS)
3. Tarball approaches for all databases

---

## 16. Key Architectural Insights

1. **Runtime-agnostic design** - Use best tool regardless of runtime (Java, Node, .NET)
2. **Process spawning is cheap** - Node.js spawning Java processes is simple and effective
3. **Zonky is highly relevant** - Most mature PostgreSQL embedded solution with Java available
4. **MySQL native is viable** - Tarball/binary approach works fine, just lacks convenient wrapper
5. **All databases support native strategy** - No database is excluded from the fallback chain
6. **Elegant trumps pure** - Zonky (Java) via Node wrapper is more elegant than pure JS solutions for PostgreSQL

---

## 17. Example: Complete Strategy Execution

```typescript
// High-level test framework integration
@DatabaseTest({
  type: 'postgresql',
  version: '14'
})
class MyIntegrationTest {
  // Framework handles strategy selection automatically

  @Test
  async testUserCreation() {
    // Connection provided by strategy framework
    const user = await db.createUser({ name: 'test' });
    expect(user.id).toBeDefined();
  }
}

// Behind the scenes:
// 1. Check POSTGRES_URL env var → Not found
// 2. Check Docker → Not available (Claude Code web)
// 3. Use Native → Zonky (Java) selected
// 4. Spawn: java -jar zonky-wrapper.jar --version 14
// 5. Provide connection to test
// 6. Cleanup on test completion
```

---

## 18. Recommended Default Configuration

```yaml
# config/database-test.yml
databases:
  postgresql:
    strategies:
      service: { enabled: true }
      container: { enabled: true, image: "postgres:14" }
      native:
        enabled: true
        strategy: zonky  # zonky (preferred) | pglite | tarball
        java_home: ${JAVA_HOME}

  mysql:
    strategies:
      service: { enabled: true }
      container: { enabled: true, image: "mysql:8" }
      native:
        enabled: true
        strategy: tarball  # tarball | mariadb

  neo4j:
    strategies:
      service: { enabled: true }
      container: { enabled: true, image: "neo4j:5" }
      native:
        enabled: true
        strategy: test-harness  # Requires Java
        java_home: ${JAVA_HOME}

  dynamodb:
    strategies:
      service: { enabled: true }
      container: { enabled: true, image: "amazon/dynamodb-local" }
      native:
        enabled: true
        strategy: local-jar  # local-jar (preferred) | dynalite
        java_home: ${JAVA_HOME}
```

---

**End of Specification**

This specification provides a complete, elegant, and runtime-agnostic approach to database integration testing that works across local development, CI/CD, and constrained environments like Claude Code web.
