# DevAC Testing Strategy Research & Plan

**Date**: 2025-11-09
**Status**: Research Complete - Awaiting Approval

## Current State Analysis

### Phase 1 & 2: What We Have

#### ✅ **Task 1: ErrorManager**
- **Unit Tests**: 13 passing (mocked Neo4j)
- **Integration Tests**: Written but NOT running (requires Docker/testcontainers)
- **Status**: ⚠️ **Incomplete** - No verification against real Neo4j

#### ✅ **Task 2: RoundRobinLogger**
- **Unit Tests**: 14 passing (file system only)
- **Integration Tests**: Not applicable (no Neo4j interaction)
- **Status**: ✅ **Complete** - Pure file operations

#### ✅ **Task 3: ResourceManager**
- **Unit Tests**: 20 passing (mocked Neo4j)
- **Integration Tests**: NOT written
- **Status**: ⚠️ **Incomplete** - No verification against real Neo4j

#### ✅ **Task 4: FileWatcher**
- **Unit Tests**: 15 passing (file system only)
- **Integration Tests**: Not applicable (no Neo4j interaction)
- **Status**: ✅ **Complete** - Pure watcher operations

### Critical Gaps Identified

1. **No Real Neo4j Testing**: Tasks 1 & 3 use mocked Neo4j - never tested against actual database
2. **Integration Tests Blocked**: Wrote integration tests assuming Docker/testcontainers required
3. **False Completion**: Unit tests passing ≠ Components working with real Neo4j
4. **Future Risk**: Tasks 5-7 will build on untested Neo4j integrations

---

## Local Neo4j Testing Strategy

### Discovery: Existing Infrastructure

✅ **Local Neo4j Already Available**
```bash
# Found in /home/user/CodeGraph/run_neo4j_server.sh
NEO4J_URI="bolt://localhost:7687"
NEO4J_USERNAME="neo4j"
NEO4J_PASSWORD="test1234"
NEO4J_DATABASE="codegraph"
```

### Recommended Approach: Dedicated Test Database

#### Why Not Docker/Testcontainers?
- ❌ Requires Docker daemon (not available in current environment)
- ❌ Slow startup/teardown (adds 5-10s per test suite)
- ❌ Complexity overhead for simple Node.js tests

#### ✅ Why Dedicated Test Database?
- ✅ Fast: No container startup
- ✅ Simple: Just connect to local Neo4j
- ✅ Isolated: Separate database for tests
- ✅ Reliable: Same database engine as production

---

## Implementation Plan

### 1. Test Database Configuration

**Create Two Databases**:
```cypher
// In Neo4j Browser or cypher-shell
CREATE DATABASE codegraph;        // Production/development
CREATE DATABASE codegraph_test;   // Integration tests
```

**Environment-Based Config**:
```typescript
// Test environment config
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=test1234
NEO4J_DATABASE=codegraph_test  // Different database for tests
```

### 2. Test Setup Pattern (Vitest)

```typescript
// test-setup/neo4j-test-utils.ts

import { Neo4jClient } from '../database/neo4j-client.js';

export async function createTestNeo4jClient(): Promise<Neo4jClient> {
  return new Neo4jClient({
    uri: 'bolt://localhost:7687',
    username: 'neo4j',
    password: 'test1234',
    database: 'codegraph_test', // Dedicated test database
  });
}

export async function cleanTestDatabase(client: Neo4jClient): Promise<void> {
  // Delete all nodes and relationships
  await client.runTransaction(
    'MATCH (n) DETACH DELETE n',
    {},
    'WRITE',
    'TestCleanup'
  );
}
```

### 3. Integration Test Pattern

```typescript
// __tests__/error-manager.integration.spec.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ErrorManager } from '../error-manager.js';
import { createTestNeo4jClient, cleanTestDatabase } from '../../test-setup/neo4j-test-utils.js';

describe('ErrorManager - Integration Tests', () => {
  let neo4jClient: Neo4jClient;
  let errorManager: ErrorManager;

  beforeEach(async () => {
    // Connect to test database
    neo4jClient = await createTestNeo4jClient();
    await neo4jClient.initializeDriver('ErrorManagerIntegration');

    // Clean database before each test
    await cleanTestDatabase(neo4jClient);

    errorManager = new ErrorManager(neo4jClient, {
      serviceId: 'test-service',
      errorThreshold: 3,
    });
  });

  afterEach(async () => {
    // Cleanup
    await neo4jClient.closeDriver('ErrorManagerIntegration');
  });

  it('should persist errors to real Neo4j database', async () => {
    // Test implementation
  });
});
```

### 4. Vitest Configuration

```typescript
// vitest.config.ts

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Separate test types
    include: ['src/**/*.{spec,test}.ts'],

    // Test categories
    globals: true,
    environment: 'node',

    // Setup files
    setupFiles: ['./test-setup/global-setup.ts'],

    // Timeout for integration tests (Neo4j operations)
    testTimeout: 10000,
  },
});
```

### 5. npm Scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run --grep=\"Unit Tests\"",
    "test:integration": "vitest run --grep=\"Integration Tests\"",
    "test:coverage": "vitest run --coverage",
    "neo4j:setup-test-db": "node scripts/setup-test-database.mjs"
  }
}
```

---

## Test Database Isolation Strategies

### Strategy 1: Database-Level Isolation (Recommended)

**Pros**:
- ✅ Complete isolation from development data
- ✅ Fast cleanup (`MATCH (n) DETACH DELETE n`)
- ✅ No transaction rollback complexity
- ✅ Can run tests in parallel

**Cons**:
- ⚠️ Requires creating test database once
- ⚠️ Must clean between tests

**Implementation**:
```typescript
beforeEach(async () => {
  await cleanTestDatabase(client); // Fast: ~50ms
});
```

### Strategy 2: Transaction Rollback

**Pros**:
- ✅ No cleanup needed (auto-rollback)
- ✅ Database returns to pristine state

**Cons**:
- ❌ Complex setup with Neo4j driver
- ❌ Can't test committed transaction behavior
- ❌ Harder to debug (data never persists)

**Verdict**: Strategy 1 (Database-Level) is simpler and more reliable for our use case.

---

## Migration Path: Fixing Tasks 1-4

### Phase A: Setup Infrastructure (30 min)

1. **Create Test Database**
   ```bash
   # Connect to Neo4j
   cypher-shell -u neo4j -p test1234
   CREATE DATABASE codegraph_test;
   ```

2. **Create Test Utilities**
   ```bash
   mkdir -p test-setup
   # Create neo4j-test-utils.ts (as shown above)
   ```

3. **Create vitest.config.ts**
   ```bash
   # Configuration as shown above
   ```

### Phase B: Task 1 - ErrorManager Integration Tests (1 hour)

1. ✅ Already have integration test file (`error-manager.integration.spec.ts`)
2. 🔄 Modify to use local Neo4j instead of testcontainers
3. ✅ Run and verify all tests pass

**Expected Tests** (from existing integration file):
- ✅ Store errors in Neo4j
- ✅ Link errors to collections
- ✅ Batch error persistence
- ✅ Error querying and retrieval

### Phase C: Task 3 - ResourceManager Integration Tests (1.5 hours)

1. 📝 Write new integration tests (none exist yet)
2. ✅ Test Neo4j Resource node creation
3. ✅ Test STORED_IN relationships
4. ✅ Test ATTACHED_TO relationships
5. ✅ Test orphan detection with real graph queries

**New Tests to Write**:
```typescript
describe('ResourceManager - Integration Tests', () => {
  it('should create Resource nodes in Neo4j');
  it('should link resources to collections with STORED_IN relationship');
  it('should link resources to errors with ATTACHED_TO relationship');
  it('should find orphaned resources by querying graph');
  it('should handle resource metadata persistence');
});
```

### Phase D: Verification & Documentation (30 min)

1. ✅ Run all tests: `npm test`
2. ✅ Run only integration: `npm run test:integration`
3. ✅ Run only unit: `npm run test:unit`
4. ✅ Update CLAUDE.md with testing instructions
5. ✅ Document test database setup in README

---

## Quality Checklist

### Before Moving to Tasks 5-7

- [ ] Local Neo4j instance verified running
- [ ] `codegraph_test` database created
- [ ] Test utilities created and working
- [ ] Task 1 integration tests running (13+ tests)
- [ ] Task 3 integration tests written and running (15+ tests)
- [ ] All unit tests still passing (62 tests)
- [ ] All integration tests passing (28+ tests)
- [ ] npm scripts documented and tested
- [ ] CLAUDE.md updated with testing strategy
- [ ] No reliance on Docker/testcontainers

---

## Timeline Estimate

| Phase | Task | Time | Status |
|-------|------|------|--------|
| A | Setup test infrastructure | 30m | Pending |
| B1 | Modify Task 1 integration tests | 30m | Pending |
| B2 | Verify Task 1 tests pass | 30m | Pending |
| C1 | Write Task 3 integration tests | 1h | Pending |
| C2 | Verify Task 3 tests pass | 30m | Pending |
| D | Documentation & verification | 30m | Pending |
| **Total** | **End-to-End** | **~4 hours** | **Not Started** |

---

## Success Criteria

### Must Have
1. ✅ Local Neo4j integration tests running without Docker
2. ✅ Task 1 (ErrorManager): 13 unit + 10 integration tests passing
3. ✅ Task 3 (ResourceManager): 20 unit + 15 integration tests passing
4. ✅ Clean database isolation between test runs
5. ✅ Fast test execution (<30s for full suite)

### Nice to Have
1. Test coverage report (vitest --coverage)
2. Pre-commit hook running tests
3. CI/CD integration (if applicable)

---

## Open Questions

1. **Neo4j Availability**: Is local Neo4j instance currently running?
   ```bash
   # Test connection
   node check-neo4j.mjs
   ```

2. **Database Creation**: Do we have permissions to create `codegraph_test` database?
   ```cypher
   // Requires admin/neo4j role
   CREATE DATABASE codegraph_test;
   ```

3. **Parallel Testing**: Should integration tests run sequentially or in parallel?
   - **Recommendation**: Sequential for simplicity (same test database)

---

## Next Steps (Pending Approval)

1. **Approve this strategy** ✋ (User decision point)
2. **Verify Neo4j connectivity** (Test local instance)
3. **Create test database** (One-time setup)
4. **Implement Phase A** (Infrastructure)
5. **Implement Phase B** (Task 1 tests)
6. **Implement Phase C** (Task 3 tests)
7. **Phase D verification** (All tests green)
8. **Move to Tasks 5-7 with confidence** 🚀

---

## References

- **Neo4j Driver**: https://neo4j.com/docs/javascript-manual/current/
- **Vitest Docs**: https://vitest.dev/guide/
- **Neo4j Testing Best Practices**: https://neo4j.com/blog/testing-your-neo4j-based-java-application-34bef487cc3c
- **Transaction Patterns**: https://neo4j.com/docs/javascript-manual/current/transactions/

---

**Prepared by**: Claude (AI Assistant)
**Review Required**: User approval before proceeding
**Estimated Impact**: High - Ensures quality foundation for remaining phases
