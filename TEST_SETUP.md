# DevAC Testing Setup Guide

This guide explains how to set up and run integration tests for DevAC using a local Neo4j instance.

## Prerequisites

### 1. Neo4j Installation

You need Neo4j 5.x running locally. Choose one of these options:

**Option A: Neo4j Desktop (Recommended for Development)**
1. Download from https://neo4j.com/download/
2. Create a new database
3. Set password to `test1234` (or update `TEST_NEO4J_PASSWORD` env var)
4. Start the database

**Option B: Docker**
```bash
docker run -d \
  --name neo4j-test \
  -p 7474:7474 \
  -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/test1234 \
  neo4j:5-community
```

**Option C: System Service (Linux)**
```bash
# Install Neo4j
wget -O - https://debian.neo4j.com/neotechnology.gpg.key | sudo apt-key add -
echo 'deb https://debian.neo4j.com stable latest' | sudo tee /etc/apt/sources.list.d/neo4j.list
sudo apt update
sudo apt install neo4j

# Set initial password
sudo neo4j-admin set-initial-password test1234

# Start service
sudo systemctl start neo4j
```

### 2. Verify Neo4j Connection

```bash
npm run neo4j:verify
```

Expected output:
```
✅ Successfully connected to Neo4j!
📦 Neo4j Version: 5.x.x
📚 Available Databases:
  - neo4j (online) [default]
  - system (online)
✨ Neo4j is ready for testing!
```

## Test Database Setup

### One-Time Setup

Create the dedicated test database:

```bash
npm run neo4j:setup-test-db
```

This will:
1. Create `codegraph_test` database
2. Verify it's accessible
3. Display connection details

**Manual Setup (Alternative)**:
```cypher
// Connect to Neo4j Browser (http://localhost:7474)
// Or use cypher-shell: cypher-shell -u neo4j -p test1234

CREATE DATABASE codegraph_test;
SHOW DATABASES;
```

## Running Tests

### All Tests (Unit + Integration)
```bash
npm test
```

### Unit Tests Only (Fast - No Neo4j Required)
```bash
npm run test:unit
```

This runs tests matching `*.unit.spec.ts` - these use mocked dependencies.

### Integration Tests Only (Requires Neo4j)
```bash
npm run test:integration
```

This runs tests matching `*.integration.spec.ts` - these use real Neo4j database.

### Watch Mode (TDD)
```bash
npm run test:watch
```

### With Coverage
```bash
npm run test:coverage
```

## Test Structure

```
src/devac/services/codegraph/__tests__/
├── error-manager.unit.spec.ts         # Unit tests (mocked)
├── error-manager.integration.spec.ts  # Integration tests (real Neo4j)
├── resource-manager.spec.ts           # Unit tests (mocked)
├── resource-manager.integration.spec.ts # Integration tests (real Neo4j)
├── round-robin-logger.spec.ts         # Unit tests (file system only)
└── file-watcher.spec.ts               # Unit tests (file system only)
```

## Test Isolation Strategy

### Database-Level Isolation

Each test suite:
1. Connects to dedicated `codegraph_test` database
2. Cleans all data before each test (`MATCH (n) DETACH DELETE n`)
3. Creates required nodes/relationships
4. Runs test
5. Cleanup happens automatically before next test

**Advantages**:
- Complete isolation from development data
- Fast cleanup (~50ms)
- Easy to debug (data persists after test if needed)
- No transaction rollback complexity

### Example Test Pattern

```typescript
import { createTestNeo4jClient, cleanTestDatabase } from '../../../../test-setup/neo4j-test-utils.js';

describe('MyComponent - Integration Tests', () => {
  let neo4jClient: Neo4jClient;

  beforeEach(async () => {
    // Connect to test database
    neo4jClient = await createTestNeo4jClient();
    await neo4jClient.initializeDriver('MyComponentIntegration');

    // Clean database (fast, complete isolation)
    await cleanTestDatabase(neo4jClient);
  });

  afterEach(async () => {
    await neo4jClient.closeDriver('MyComponentIntegration');
  });

  it('should do something with real Neo4j', async () => {
    // Test implementation
  });
});
```

## Environment Variables

Override test configuration with environment variables:

```bash
# Test Database Connection
export TEST_NEO4J_URI="bolt://localhost:7687"
export TEST_NEO4J_USERNAME="neo4j"
export TEST_NEO4J_PASSWORD="test1234"
export TEST_NEO4J_DATABASE="codegraph_test"
```

Create `.env.test` file (optional):
```env
TEST_NEO4J_URI=bolt://localhost:7687
TEST_NEO4J_USERNAME=neo4j
TEST_NEO4J_PASSWORD=test1234
TEST_NEO4J_DATABASE=codegraph_test
```

## Test Utilities

The `test-setup/neo4j-test-utils.ts` module provides helpful utilities:

### Connection Management
```typescript
import { createTestNeo4jClient } from '../test-setup/neo4j-test-utils.js';

const client = await createTestNeo4jClient();
```

### Database Cleanup
```typescript
import { cleanTestDatabase } from '../test-setup/neo4j-test-utils.js';

await cleanTestDatabase(client); // Removes all nodes and relationships
```

### Test Data Creation
```typescript
import { createTestCollection } from '../test-setup/neo4j-test-utils.js';

const collectionId = await createTestCollection(client, 'my-collection');
```

### Verification Helpers
```typescript
import { countNodesByLabel, countRelationshipsByType } from '../test-setup/neo4j-test-utils.js';

const errorCount = await countNodesByLabel(client, 'ServiceError');
const relCount = await countRelationshipsByType(client, 'STORED_IN');
```

## Troubleshooting

### "Connection Refused" Error

```
❌ Failed to connect to Neo4j:
   connect ECONNREFUSED 127.0.0.1:7687
```

**Solution**:
1. Verify Neo4j is running: `neo4j status` or check Neo4j Desktop
2. Check port 7687 is open: `netstat -an | grep 7687`
3. Verify URI is correct: `bolt://localhost:7687`

### "Authentication Failed" Error

**Solution**:
1. Check password in Neo4j Desktop settings
2. Update `TEST_NEO4J_PASSWORD` environment variable
3. Reset password: `neo4j-admin set-initial-password test1234`

### "Database Not Found" Error

```
Neo4jError: Unable to get a routing table for database 'codegraph_test'
```

**Solution**:
```bash
# Run setup script
npm run neo4j:setup-test-db

# Or create manually
cypher-shell -u neo4j -p test1234
CREATE DATABASE codegraph_test;
```

### Tests Fail with "Data Already Exists"

**Solution**:
This indicates `cleanTestDatabase()` isn't being called in `beforeEach`. Check test setup:

```typescript
beforeEach(async () => {
  neo4jClient = await createTestNeo4jClient();
  await neo4jClient.initializeDriver('MyTest');
  await cleanTestDatabase(neo4jClient); // ← Make sure this is here
});
```

### Slow Integration Tests

Integration tests are slower than unit tests (~100-500ms vs ~1-10ms) because they:
1. Connect to real database
2. Clean database state
3. Execute real Cypher queries

**Tips**:
- Run `npm run test:unit` during development (fast)
- Run `npm run test:integration` before commits (thorough)
- Use `test:watch` with file filtering for specific components

## Continuous Integration

### GitHub Actions Example

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      neo4j:
        image: neo4j:5-community
        env:
          NEO4J_AUTH: neo4j/test1234
        ports:
          - 7687:7687
        options: >-
          --health-cmd "cypher-shell -u neo4j -p test1234 'RETURN 1'"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - run: npm install
      - run: npm run neo4j:setup-test-db
      - run: npm test
```

## Test Coverage

Current test coverage for DevAC components:

| Component | Unit Tests | Integration Tests | Total |
|-----------|-----------|-------------------|-------|
| ErrorManager | 13 | 10 | 23 |
| RoundRobinLogger | 14 | N/A | 14 |
| ResourceManager | 20 | 15 | 35 |
| FileWatcher | 15 | N/A | 15 |
| **Total** | **62** | **25** | **87** |

**Coverage Goals**:
- Unit Tests: >80% code coverage
- Integration Tests: All Neo4j interactions verified
- E2E Tests: Critical user workflows (future)

## Best Practices

### 1. Test Naming Convention

```typescript
// Unit tests
describe('ComponentName - Unit Tests', () => { ... });

// Integration tests
describe('ComponentName - Integration Tests', () => { ... });
```

### 2. Test Isolation

- ✅ Each test should be independent
- ✅ Use `cleanTestDatabase()` in `beforeEach`
- ✅ Don't rely on test execution order
- ❌ Don't share state between tests

### 3. Assertions

```typescript
// Good: Specific assertions
expect(result.nodeCount).toBe(5);
expect(result.hash).toMatch(/^[a-f0-9]{64}$/);

// Bad: Generic assertions
expect(result).toBeTruthy();
```

### 4. Test Data

```typescript
// Good: Descriptive test data
const collectionId = 'analytics-collection-2024';
const errorMessage = 'Parser timeout for file X';

// Bad: Generic test data
const id = 'test-123';
const msg = 'test';
```

## Next Steps

After setting up tests:

1. ✅ Run `npm run neo4j:verify` to check connection
2. ✅ Run `npm run neo4j:setup-test-db` to create test database
3. ✅ Run `npm run test:unit` to verify unit tests (fast)
4. ✅ Run `npm run test:integration` to verify integration tests
5. ✅ Run `npm test` to run full test suite
6. ✅ Proceed with Tasks 5-7 with confidence!

## Support

For issues or questions:
- Check this document first
- Review test examples in `src/devac/services/codegraph/__tests__/`
- See `test-setup/neo4j-test-utils.ts` for available utilities
- Consult `TESTING_STRATEGY.md` for architecture decisions
