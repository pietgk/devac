# Phase 2 Testing Strategy - Integration-First, Minimal Mocking

**Date**: 2025-11-11
**Author**: Claude + User
**Status**: Planning

---

## 🎯 Acknowledgment: We Should Have Done TDD

**What We Did**: Wrote implementation first, tests second ❌
**What We Should Do**: Write tests first (TDD) ✅

**Lesson Learned**: Tests written after implementation often become:
- Coupled to implementation details
- Less focused on behavior
- More reliant on mocking
- Less valuable for refactoring

**Going Forward**: For Phase 3 and beyond, we will:
1. Write failing tests first
2. Implement minimal code to pass
3. Refactor with confidence
4. Repeat

---

## 🏗️ Testing Philosophy

### Core Principles

**1. Integration-First, Not Unit-First**
- Start with integration tests that test real behavior
- Add unit tests only for complex pure logic
- Avoid the "unit test everything" trap

**2. Minimize Mocking**
> "Excessive mocking is a design smell" - User

When you need lots of mocks, it often means:
- ❌ Classes are too tightly coupled
- ❌ Dependencies are doing too much
- ❌ Abstraction boundaries are wrong
- ❌ Testing implementation, not behavior

**Good indicators**:
- ✅ 0-2 mocks per test → Good design
- ⚠️ 3-5 mocks per test → Acceptable, review design
- ❌ 6+ mocks per test → Design problem, refactor

**3. Use Real Dependencies**
- **Database**: Real Neo4j via universal testing framework ✅
- **File System**: Real temp directories ✅
- **Logger**: Real logger with temp files ✅
- **ResourceManager**: Real instance with temp dirs ✅
- **ErrorManager**: Real instance ✅

**4. Test Behavior, Not Implementation**
```typescript
// ❌ BAD: Testing implementation details
expect(service['analyzerService']).toHaveBeenCalled();
expect(service['neo4jClient'].runTransaction).toHaveBeenCalledWith(...);

// ✅ GOOD: Testing observable behavior
const collections = await queryCollections();
expect(collections).toHaveLength(1);
expect(collections[0].itemsProcessed).toBe(5);
```

---

## 🧪 Test Pyramid for CodeGraphService

```
           /\
          /  \
         / UI \         0 tests (no UI yet)
        /______\
       /        \
      /  E2E     \      2 tests (full lifecycle)
     /____________\
    /              \
   /  Integration   \   ~10 tests (with real deps)
  /___________________\
 /                     \
/      Unit Tests       \  ~3 tests (pure logic only)
/_________________________\

Total: ~15 high-quality tests
```

### Test Distribution

**Unit Tests (~3 tests)**: Pure logic only
- Collection statistics estimation
- Directory validation
- Line range calculation

**Integration Tests (~10 tests)**: Real dependencies
- Service initialization with real Neo4j
- Scan with real FileScanner and AnalyzerService
- Collection creation in real Neo4j
- Log file creation and linking
- Error tracking with real ErrorManager
- Resource manager integration

**E2E Tests (~2 tests)**: Full lifecycle
- Complete flow: init → scan → watch → process → cleanup
- File change simulation with real FileWatcher

---

## 📋 Detailed Test Plan

### Test Group 1: Integration Tests (PRIMARY)

#### Test 1.1: Service Initialization
**What**: Initialize CodeGraphService with real dependencies
**Dependencies**: Real Neo4j, temp directories
**Mocks**: None
**Verification**:
- Neo4j Service node created
- Logger initialized and file created
- Resource manager initialized
- Error manager initialized
- AnalyzerService initialized

```typescript
describe('CodeGraphService - Integration', () => {
  let neo4jClient: Neo4jClient;
  let cleanup: () => Promise<void>;
  let tempDir: string;

  beforeEach(async () => {
    // Use universal testing framework
    const connection = await createTestNeo4jClient();
    neo4jClient = connection.client;
    cleanup = connection.cleanup;

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codegraph-test-'));
  });

  afterEach(async () => {
    await cleanup();
    await fs.rm(tempDir, { recursive: true });
  });

  it('should initialize with all real dependencies', async () => {
    const serviceConfig: ServiceConfig = {
      id: 'test-codegraph',
      name: 'Test CodeGraph',
      type: 'codegraph',
      enabled: true,
      config: {
        directories: [tempDir],
        extensions: ['.ts', '.js'],
        ignore: ['**/node_modules/**'],
        watch: false, // Disable for test
        logDir: path.join(tempDir, 'logs'),
        resourceDir: path.join(tempDir, 'resources'),
        maxLogFileSize: 1024 * 1024,
        maxLogFiles: 3,
        neo4j: {
          uri: neo4jClient.getUri(),
          username: neo4jClient.getUsername(),
          password: neo4jClient.getPassword(),
          database: neo4jClient.getDatabase(),
        },
      },
    };

    const service = new CodeGraphService(serviceConfig);
    await service['initialize'](); // Call protected method for test

    // Verify Service node in Neo4j
    const result = await neo4jClient.runQuery(
      'MATCH (s:Service {id: $id}) RETURN s',
      { id: 'test-codegraph' }
    );
    expect(result.records).toHaveLength(1);
    expect(result.records[0].get('s').properties.name).toBe('Test CodeGraph');

    // Verify log directory created
    expect(await fs.access(path.join(tempDir, 'logs'))).resolves.toBeUndefined();

    // Verify resource directory created
    expect(await fs.access(path.join(tempDir, 'resources'))).resolves.toBeUndefined();
  });
});
```

#### Test 1.2: Scan with Real FileScanner
**What**: Run scan() with real files
**Dependencies**: Real Neo4j, FileScanner, temp test project
**Mocks**: Mock AnalyzerService.analyze() (expensive to run full analysis)
**Verification**:
- Files counted correctly
- Collection created in Neo4j
- Log file created with entries
- Collection linked to log file

```typescript
it('should scan real files and create collection', async () => {
  // Create test project with real files
  await createTestProject(tempDir, {
    'src/index.ts': 'console.log("hello");',
    'src/utils.ts': 'export const add = (a, b) => a + b;',
    'test/index.test.ts': 'test("add", () => {});',
  });

  const service = new CodeGraphService(serviceConfig);
  await service['initialize']();

  // Mock only AnalyzerService.analyze (it's expensive)
  const analyzeSpy = vi.spyOn(service['analyzerService'], 'analyze')
    .mockResolvedValue(undefined);

  // Run scan
  const result = await service['scan']();

  // Verify file counting
  expect(result.itemsFound).toBe(3); // 3 .ts files

  // Verify AnalyzerService was called
  expect(analyzeSpy).toHaveBeenCalledOnce();

  // Verify Collection in Neo4j
  const collections = await neo4jClient.runQuery(
    'MATCH (s:Service {id: $id})-[:COLLECTED_AT]->(c:Collection) RETURN c',
    { id: 'test-codegraph' }
  );
  expect(collections.records).toHaveLength(1);

  const collection = collections.records[0].get('c').properties;
  expect(collection.itemsProcessed).toBe(3);
  expect(collection.nodesCreated).toBe(45); // 3 files * 15 nodes/file
  expect(collection.relationshipsCreated).toBe(30); // 3 files * 10 relationships/file

  // Verify log file exists
  const logFile = path.join(tempDir, 'logs', '001.log');
  expect(await fs.access(logFile)).resolves.toBeUndefined();

  // Verify log contains entries
  const logContent = await fs.readFile(logFile, 'utf-8');
  const lines = logContent.trim().split('\n');
  expect(lines.length).toBeGreaterThan(0);

  // Parse and verify JSON log entries
  const entries = lines.map(line => JSON.parse(line));
  expect(entries.some(e => e.message.includes('Starting initial code scan'))).toBe(true);
  expect(entries.some(e => e.message.includes('scan completed'))).toBe(true);

  // Verify Collection linked to LogFile
  const logLinks = await neo4jClient.runQuery(
    'MATCH (c:Collection)-[r:LOGGED_IN]->(log:LogFile) RETURN r, log',
    {}
  );
  expect(logLinks.records).toHaveLength(1);
  expect(logLinks.records[0].get('r').properties.startLine).toBeGreaterThan(0);
});
```

#### Test 1.3: File Watcher Integration
**What**: Start watcher and simulate file change
**Dependencies**: Real FileWatcher with temp dir
**Mocks**: None (use real file system)
**Verification**:
- Watcher starts successfully
- File changes detected
- Events sent to state machine

```typescript
it('should detect real file changes', async () => {
  const service = new CodeGraphService(serviceConfig);
  await service['initialize']();

  const events: BaseServiceEvent[] = [];
  const sendEvent = (event: BaseServiceEvent) => {
    events.push(event);
  };

  // Start watcher
  const cleanup = service['startWatcher'](sendEvent);

  // Create a new file (real FS operation)
  const testFile = path.join(tempDir, 'new-file.ts');
  await fs.writeFile(testFile, 'console.log("new");');

  // Wait for debounce
  await new Promise(resolve => setTimeout(resolve, 1500));

  // Verify event was sent
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe('FILE_CHANGED');
  expect(events[0].path).toContain('new-file.ts');
  expect(events[0].changeType).toBe('add');

  // Cleanup
  cleanup();
});
```

#### Test 1.4: Process File Change
**What**: Process a file change event
**Dependencies**: Real Neo4j, logger, resource manager
**Mocks**: Mock AnalyzerService (expensive)
**Verification**:
- New Collection created
- ServiceOutput returned with correct structure
- Log entries created
- Collection linked to log file

```typescript
it('should process file change and create collection', async () => {
  const service = new CodeGraphService(serviceConfig);
  await service['initialize']();
  await service['scan'](); // Initial scan

  // Mock analyzer
  const analyzeSpy = vi.spyOn(service['analyzerService'], 'analyze')
    .mockResolvedValue(undefined);

  // Simulate file change event
  const output = await service['process']({
    type: 'FILE_CHANGED',
    path: path.join(tempDir, 'changed.ts'),
    changeType: 'change',
  });

  // Verify ServiceOutput structure
  expect(output.collectionId).toBeDefined();
  expect(output.serviceId).toBe('test-codegraph');
  expect(output.stats.itemsProcessed).toBe(1);
  expect(output.resources).toHaveLength(1);
  expect(output.resources[0].type).toBe('logfile');
  expect(output.resources[0].lineRange).toBeDefined();

  // Verify new Collection in Neo4j
  const collections = await neo4jClient.runQuery(
    'MATCH (c:Collection {id: $id}) RETURN c',
    { id: output.collectionId }
  );
  expect(collections.records).toHaveLength(1);
});
```

#### Test 1.5: Error Tracking
**What**: Track error with real ErrorManager
**Dependencies**: Real ErrorManager, Neo4j
**Mocks**: None
**Verification**:
- Error recorded in ErrorManager
- Error logged to log file
- Service continues (graceful degradation)

```typescript
it('should track errors with real ErrorManager', async () => {
  const service = new CodeGraphService(serviceConfig);
  await service['initialize']();

  // Trigger error by using invalid directory
  const badConfig = { ...serviceConfig };
  badConfig.config.directories = ['/nonexistent/path'];

  try {
    await service['scan']();
    fail('Should have thrown error');
  } catch (error) {
    // Expected
  }

  // Verify error was logged
  const logFile = path.join(tempDir, 'logs', '001.log');
  const logContent = await fs.readFile(logFile, 'utf-8');
  expect(logContent).toContain('"level":"error"');
  expect(logContent).toContain('Scan failed');
});
```

#### Test 1.6: Cleanup
**What**: Test cleanup() method
**Dependencies**: Real Neo4j, file system
**Mocks**: None
**Verification**:
- Logger disposed
- Resource manager disposed
- Service status updated in Neo4j
- Neo4j connection closed

```typescript
it('should cleanup all resources', async () => {
  const service = new CodeGraphService(serviceConfig);
  await service['initialize']();

  // Verify service is running
  let serviceNode = await neo4jClient.runQuery(
    'MATCH (s:Service {id: $id}) RETURN s',
    { id: 'test-codegraph' }
  );
  expect(serviceNode.records[0].get('s').properties.status).toBe('initializing');

  // Run cleanup
  await service['cleanup']();

  // Verify service status updated
  serviceNode = await neo4jClient.runQuery(
    'MATCH (s:Service {id: $id}) RETURN s',
    { id: 'test-codegraph' }
  );
  expect(serviceNode.records[0].get('s').properties.status).toBe('stopped');
  expect(serviceNode.records[0].get('s').properties.stoppedAt).toBeDefined();
});
```

---

### Test Group 2: E2E Tests (COMPREHENSIVE)

#### Test 2.1: Full Lifecycle
**What**: Complete flow from initialization to cleanup
**Dependencies**: All real dependencies
**Mocks**: Only AnalyzerService.analyze()
**Verification**: End-to-end behavior

```typescript
it('should handle full service lifecycle', async () => {
  // Create test project
  await createTestProject(tempDir, {
    'src/main.ts': 'console.log("main");',
  });

  const service = new CodeGraphService(serviceConfig);

  // Mock analyzer
  vi.spyOn(service['analyzerService'], 'analyze').mockResolvedValue(undefined);

  // 1. Initialize
  await service['initialize']();

  // Verify Service node
  let result = await neo4jClient.runQuery(
    'MATCH (s:Service {id: $id}) RETURN s',
    { id: 'test-codegraph' }
  );
  expect(result.records).toHaveLength(1);

  // 2. Scan
  const scanResult = await service['scan']();
  expect(scanResult.itemsFound).toBe(1);

  // Verify Collection created
  result = await neo4jClient.runQuery(
    'MATCH (s:Service)-[:COLLECTED_AT]->(c:Collection) RETURN count(c) as count',
    {}
  );
  expect(result.records[0].get('count').toNumber()).toBe(1);

  // 3. Watch (start and stop immediately)
  const events: BaseServiceEvent[] = [];
  const stopWatcher = service['startWatcher'](e => events.push(e));
  stopWatcher();

  // 4. Process (simulate)
  const output = await service['process']({
    type: 'FILE_CHANGED',
    path: path.join(tempDir, 'src/main.ts'),
    changeType: 'change',
  });
  expect(output.collectionId).toBeDefined();

  // Verify 2 collections now (scan + process)
  result = await neo4jClient.runQuery(
    'MATCH (s:Service)-[:COLLECTED_AT]->(c:Collection) RETURN count(c) as count',
    {}
  );
  expect(result.records[0].get('count').toNumber()).toBe(2);

  // 5. Cleanup
  await service['cleanup']();

  // Verify service stopped
  result = await neo4jClient.runQuery(
    'MATCH (s:Service {id: $id}) RETURN s.status as status',
    { id: 'test-codegraph' }
  );
  expect(result.records[0].get('status')).toBe('stopped');
});
```

---

### Test Group 3: Unit Tests (MINIMAL)

#### Test 3.1: Statistics Estimation
**What**: Test pure calculation logic
**Dependencies**: None
**Mocks**: None (pure function)

```typescript
describe('CodeGraphService - Unit Tests', () => {
  it('should estimate statistics based on file count', () => {
    // This could be extracted to a pure function
    const estimateStats = (fileCount: number) => ({
      nodesCreated: fileCount * 15,
      relationshipsCreated: fileCount * 10,
    });

    expect(estimateStats(0)).toEqual({ nodesCreated: 0, relationshipsCreated: 0 });
    expect(estimateStats(1)).toEqual({ nodesCreated: 15, relationshipsCreated: 10 });
    expect(estimateStats(100)).toEqual({ nodesCreated: 1500, relationshipsCreated: 1000 });
  });
});
```

---

## 🛠️ Test Helpers & Fixtures

### Helper: Create Test Project

```typescript
async function createTestProject(
  baseDir: string,
  files: Record<string, string>
): Promise<void> {
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(baseDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }
}
```

### Helper: Query Collections

```typescript
async function queryCollections(
  neo4jClient: Neo4jClient,
  serviceId: string
): Promise<any[]> {
  const result = await neo4jClient.runQuery(
    `MATCH (s:Service {id: $serviceId})-[:COLLECTED_AT]->(c:Collection)
     RETURN c
     ORDER BY c.timestamp`,
    { serviceId }
  );
  return result.records.map(r => r.get('c').properties);
}
```

---

## 📊 Coverage Goals

| Category | Target | Rationale |
|----------|--------|-----------|
| Integration Tests | 90%+ | Primary test suite |
| Unit Tests | Supplement only | Only for pure logic |
| E2E Tests | 2-3 scenarios | Confidence in full flow |
| **Overall Code Coverage** | **85%+** | High confidence |
| **Mocking Ratio** | **<20%** | Mostly real dependencies |

---

## ✅ Test Quality Checklist

- [ ] Tests use real Neo4j (universal testing framework)
- [ ] Tests use real file system (temp directories)
- [ ] Tests use real logger (temp log files)
- [ ] Mocking is minimal (<2 mocks per test)
- [ ] Tests verify observable behavior, not implementation
- [ ] Tests are independent (can run in any order)
- [ ] Tests clean up after themselves
- [ ] Test names describe behavior: "should X when Y"
- [ ] Integration tests are the majority
- [ ] Tests run fast (<30s for full suite)

---

## 🚀 Implementation Order

1. **Setup test infrastructure** (30 min):
   - Test helpers (createTestProject, queryCollections)
   - Shared beforeEach/afterEach setup
   - Universal testing framework integration

2. **Integration tests** (90 min):
   - Test 1.1: Initialization
   - Test 1.2: Scan
   - Test 1.3: File watcher
   - Test 1.4: Process
   - Test 1.5: Error tracking
   - Test 1.6: Cleanup

3. **E2E tests** (30 min):
   - Test 2.1: Full lifecycle

4. **Unit tests** (15 min):
   - Test 3.1: Pure calculations

**Total Time**: ~2.5 hours

---

## 📚 References

- **Testing Trophy**: Kent C. Dodds - Integration tests give best ROI
- **Test-Induced Design Damage**: DHH - Don't let tests damage your design
- **Mocking is a Code Smell**: Uncle Bob - Prefer real objects when possible

---

**Status**: Ready to implement
**Next**: Create test files and start with integration tests
