# Neo4j Testing Setup

> **Last Updated:** 2025-11-12  
> **Status:** Active  
> **Audience:** Developers running tests locally or in CI

## Overview

CodeGraph uses Neo4j for graph database operations. The test suite includes unit tests (no Neo4j required) and integration/E2E tests (Neo4j required).

## Test Types

### Unit Tests (No Neo4j Required) ✅

**Location:** Files with `.unit.spec.ts` suffix or specific test files

**Examples:**
- `src/devac/services/codegraph/__tests__/error-manager.unit.spec.ts`
- `src/devac/services/codegraph/__tests__/round-robin-logger.spec.ts`
- `src/devac/services/codegraph/__tests__/resource-manager.spec.ts` (uses mocked Neo4j)
- `src/devac/services/codegraph/__tests__/file-watcher.spec.ts`
- `src/devac/orchestrator/__tests__/orchestrator.spec.ts`
- `src/devac/services/lint/__tests__/code-extractor.spec.ts`
- `src/devac/services/__tests__/service-integration.spec.ts`

**Run Command:**
```bash
npm run test:unit
```

### Integration Tests (Neo4j Required) ⚠️

**Location:** Files with `.integration.spec.ts` suffix

**Examples:**
- `src/devac/services/codegraph/__tests__/codegraph-service.integration.spec.ts`
- `src/devac/services/codegraph/__tests__/resource-manager.integration.spec.ts`
- `src/devac/services/codegraph/__tests__/error-manager.integration.spec.ts`

**Status:** Require Neo4j connection

### E2E Tests (Neo4j Required) ⚠️

**Location:** Files with `.e2e.spec.ts` suffix

**Examples:**
- `src/devac/services/codegraph/__tests__/codegraph-service.e2e.spec.ts`

**Status:** Require Neo4j connection

## Neo4j Setup Strategies

The test suite uses `UniversalDatabaseManager` which automatically tries multiple strategies in priority order:

### 1. Service Strategy (Fastest, Requires Pre-Existing Neo4j)

**Startup Time:** 0ms (connects to existing instance)

**Prerequisites:**
- Neo4j running locally or remotely
- Accessible at configured URI

**Setup Options:**

#### Option A: Neo4j Desktop (Recommended for Developers)

1. **Download Neo4j Desktop:**
   - Visit: https://neo4j.com/download/
   - Install for your platform (macOS/Windows/Linux)

2. **Create a Database:**
   - Open Neo4j Desktop
   - Click "New Project" → "Add Database" → "Create Local Database"
   - Name: `codegraph-dev`
   - Password: `test1234` (or your choice)
   - Version: 5.x (latest stable)

3. **Start the Database:**
   - Click "Start" button
   - Wait for status to show "Active"
   - Note the connection URI (typically `bolt://localhost:7687`)

4. **Configure Tests:**
   ```bash
   export NEO4J_URI="bolt://localhost:7687"
   export NEO4J_USERNAME="neo4j"
   export NEO4J_PASSWORD="test1234"
   export NEO4J_DATABASE="neo4j"
   ```

#### Option B: Docker Container

1. **Run Neo4j in Docker:**
   ```bash
   docker run -d \
     --name neo4j-test \
     -p 7474:7474 \
     -p 7687:7687 \
     -e NEO4J_AUTH=neo4j/test1234 \
     neo4j:5-community
   ```

2. **Verify It's Running:**
   ```bash
   docker ps | grep neo4j-test
   ```

3. **Access Neo4j Browser:**
   - Open: http://localhost:7474
   - Login with neo4j/test1234

4. **Stop When Done:**
   ```bash
   docker stop neo4j-test
   docker rm neo4j-test
   ```

#### Option C: Homebrew (macOS)

1. **Install Neo4j:**
   ```bash
   brew install neo4j
   ```

2. **Start Neo4j:**
   ```bash
   neo4j start
   ```

3. **Set Password:**
   - Visit http://localhost:7474
   - Initial login: neo4j/neo4j
   - Change password to: test1234

4. **Stop When Done:**
   ```bash
   neo4j stop
   ```

### 2. Native Strategy (Portable, Requires Java)

**Startup Time:** 3-7 seconds

**Prerequisites:**
- Java 17+ installed
- `JAVA_HOME` environment variable set

**How It Works:**
- Uses Neo4j Test Harness
- Starts embedded Neo4j in-process
- Automatically downloads required JARs
- No external Neo4j installation needed

**Verification:**
```bash
java -version  # Should show Java 17 or higher
echo $JAVA_HOME  # Should point to Java installation
```

### 3. Container Strategy (Requires Docker)

**Startup Time:** 5-10 seconds

**Prerequisites:**
- Docker installed and running
- Docker daemon accessible

**How It Works:**
- Uses Testcontainers library
- Starts Neo4j in Docker container
- Provides strong isolation between tests
- Automatically cleans up after tests

**Verification:**
```bash
docker --version  # Should show Docker installed
docker ps  # Should run without errors
```

## Running Tests

### Run All Unit Tests (No Neo4j Required)

```bash
npm run test:unit
```

**Expected Output:**
```
Test Files  3 passed (3)
     Tests  48 passed (48)
  Duration  ~7s
```

### Run All Tests (Requires Neo4j)

```bash
npm test
```

**Note:** Integration and E2E tests will attempt to use Neo4j strategies in order:
1. Service (existing Neo4j)
2. Native (Java-based)
3. Container (Docker-based)

If all strategies fail, tests will be skipped.

### Run Specific Test File

```bash
npm test -- src/devac/orchestrator/__tests__/orchestrator.spec.ts
```

### Debug Neo4j Connection

Enable debug logging to see which strategy is being used:

```bash
DEBUG_DB_STRATEGY=true npm test
```

**Expected Output:**
```
[UniversalDatabaseManager] Trying strategy: ServiceStrategy
[ServiceStrategy] Attempting to connect to bolt://localhost:7687
[ServiceStrategy] ✅ Connected successfully
[UniversalDatabaseManager] Using ServiceStrategy (0ms startup)
```

## Environment Variables

### Test Configuration

```bash
# Neo4j Connection (Service Strategy)
export TEST_NEO4J_URI="bolt://localhost:7687"
export TEST_NEO4J_USERNAME="neo4j"
export TEST_NEO4J_PASSWORD="test1234"
export TEST_NEO4J_DATABASE="neo4j"

# Alternative: Use NEO4J_* variables (legacy)
export NEO4J_URI="bolt://localhost:7687"
export NEO4J_USERNAME="neo4j"
export NEO4J_PASSWORD="test1234"
export NEO4J_DATABASE="neo4j"

# Debug Strategy Selection
export DEBUG_DB_STRATEGY="true"
```

### Disable Specific Strategies

```bash
# Disable service strategy (won't try existing Neo4j)
export DISABLE_SERVICE_STRATEGY="true"

# Disable native strategy (won't use Java)
export DISABLE_NATIVE_STRATEGY="true"

# Disable container strategy (won't use Docker)
export DISABLE_CONTAINER_STRATEGY="true"
```

## Troubleshooting

### Problem: "No Neo4j connection available"

**Solution 1:** Install Neo4j Desktop
- Follow "Option A: Neo4j Desktop" above
- Start the database before running tests

**Solution 2:** Use Docker
```bash
docker run -d --name neo4j-test -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/test1234 neo4j:5-community
```

**Solution 3:** Run Only Unit Tests
```bash
npm run test:unit  # Skips Neo4j-dependent tests
```

### Problem: "Connection refused at bolt://localhost:7687"

**Check 1:** Is Neo4j running?
```bash
# For Docker:
docker ps | grep neo4j

# For Neo4j Desktop:
# Check status in Desktop UI

# For Homebrew:
neo4j status
```

**Check 2:** Is the port correct?
- Default Neo4j bolt port is 7687
- Default HTTP port is 7474
- Check your Neo4j configuration

**Check 3:** Firewall blocking connection?
```bash
# Test port accessibility
nc -zv localhost 7687
```

### Problem: "Authentication failed"

**Solution:** Reset Neo4j password
```bash
# For Docker:
docker exec -it neo4j-test cypher-shell -u neo4j -p neo4j
# Then: ALTER USER neo4j SET PASSWORD 'test1234';

# For Neo4j Desktop:
# Stop database → Click "..." → "Reset Password"

# Or update test configuration:
export NEO4J_PASSWORD="your-actual-password"
```

### Problem: Tests timeout waiting for Neo4j

**Solution 1:** Increase timeout
```typescript
// In test file:
describe("My Tests", () => {
  it("should work", async () => {
    // ...
  }, 30000); // 30 second timeout
});
```

**Solution 2:** Check Docker resources
```bash
docker stats  # Check if Docker has enough memory
```

**Solution 3:** Use faster strategy
```bash
# Prefer service strategy (0ms startup)
export DISABLE_NATIVE_STRATEGY="true"
export DISABLE_CONTAINER_STRATEGY="true"
```

### Problem: Java not found for Native Strategy

**Install Java:**
```bash
# macOS:
brew install openjdk@17
export JAVA_HOME=$(/usr/libexec/java_home -v 17)

# Ubuntu/Debian:
sudo apt install openjdk-17-jdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

# Windows:
# Download from https://adoptium.net/
# Set JAVA_HOME in System Environment Variables
```

**Verify Installation:**
```bash
java -version
echo $JAVA_HOME
```

### Problem: Docker not available for Container Strategy

**Install Docker:**
- macOS/Windows: https://www.docker.com/products/docker-desktop
- Linux: Follow your distribution's instructions

**Start Docker:**
```bash
# macOS/Windows: Start Docker Desktop application

# Linux:
sudo systemctl start docker
sudo usermod -aG docker $USER  # Add user to docker group
```

## CI/CD Configuration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      
      - run: npm ci
      - run: npm run test:unit  # No Neo4j required
  
  integration-tests:
    runs-on: ubuntu-latest
    services:
      neo4j:
        image: neo4j:5-community
        env:
          NEO4J_AUTH: neo4j/test1234
        ports:
          - 7687:7687
          - 7474:7474
        options: >-
          --health-cmd "cypher-shell -u neo4j -p test1234 'RETURN 1'"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      
      - run: npm ci
      - run: npm test  # All tests including integration
        env:
          NEO4J_URI: bolt://localhost:7687
          NEO4J_USERNAME: neo4j
          NEO4J_PASSWORD: test1234
          NEO4J_DATABASE: neo4j
```

## Best Practices

### For Development

1. **Use Neo4j Desktop for local development**
   - Easy to start/stop
   - Visual query browser
   - Multiple databases for different projects

2. **Run unit tests frequently**
   ```bash
   npm run test:unit  # Fast, no dependencies
   ```

3. **Run full tests before pushing**
   ```bash
   npm test  # Includes integration tests
   ```

### For Test Writing

1. **Prefer unit tests when possible**
   - Mock Neo4j clients
   - Test business logic independently
   - Faster feedback loop

2. **Clean database between tests**
   ```typescript
   import { cleanTestDatabase } from "test-setup/neo4j-test-utils.js";
   
   beforeEach(async () => {
     await cleanTestDatabase(neo4jClient, "MyTest");
   });
   ```

3. **Use descriptive test database names**
   ```typescript
   await neo4jClient.initializeDriver("MyFeatureTest");
   ```

### For CI/CD

1. **Use Docker services for Neo4j**
   - Consistent across environments
   - Easy to configure in YAML
   - Automatic cleanup

2. **Separate unit and integration tests**
   - Run unit tests on every commit
   - Run integration tests on PR/merge

3. **Cache dependencies**
   ```yaml
   - uses: actions/cache@v4
     with:
       path: ~/.npm
       key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
   ```

## Quick Reference

### Essential Commands

```bash
# Run unit tests only (no Neo4j)
npm run test:unit

# Run all tests (requires Neo4j)
npm test

# Run specific test file
npm test -- path/to/test.spec.ts

# Debug Neo4j strategy selection
DEBUG_DB_STRATEGY=true npm test

# Start Neo4j with Docker
docker run -d --name neo4j-test -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/test1234 neo4j:5-community

# Stop Neo4j Docker container
docker stop neo4j-test && docker rm neo4j-test
```

### Environment Variables

```bash
# Core configuration
export NEO4J_URI="bolt://localhost:7687"
export NEO4J_USERNAME="neo4j"
export NEO4J_PASSWORD="test1234"
export NEO4J_DATABASE="neo4j"

# Debug mode
export DEBUG_DB_STRATEGY="true"
```

## Related Documentation

- **UniversalDatabaseManager:** `test-setup/universal-db-manager.ts`
- **Test Utilities:** `test-setup/neo4j-test-utils.ts`
- **Strategy Implementations:** `test-setup/strategies/`
- **DevAC Spec:** `docs/development/devac-status-spec.md`

---

**Questions or Issues?**
- Check the troubleshooting section above
- Review test-setup/ directory for implementation details
- Create an issue if you encounter a new problem
