// test-setup/neo4j-test-utils.ts

import { Neo4jClient } from '../src/database/neo4j-client.js';
import { UniversalDatabaseManager } from './universal-db-manager.js';
import { ServiceStrategy, NativeStrategy } from './strategies/index.js';
import { SilentStrategyLogger } from './strategy-logger.js';
import type { DbStrategyResult } from './types.js';

/**
 * Global database manager instance (singleton for test session)
 */
let dbManager: UniversalDatabaseManager | null = null;
let currentConnection: DbStrategyResult | null = null;

/**
 * Get or create database manager instance.
 */
function getDatabaseManager(): UniversalDatabaseManager {
  if (!dbManager) {
    // Use silent logger by default for tests (set DEBUG_DB_STRATEGY=true to enable logging)
    const logger = process.env.DEBUG_DB_STRATEGY === 'true'
      ? undefined // Will use ConsoleStrategyLogger
      : new SilentStrategyLogger();

    dbManager = new UniversalDatabaseManager(logger);

    // Register strategies in priority order
    // 1. Service (Phase 2) - Fastest, requires pre-existing Neo4j
    // 2. Native (Phase 4) - Portable, works everywhere with Java
    // 3. Container (Phase 3 - TODO) - Strong isolation, requires Docker
    dbManager.registerStrategy(new ServiceStrategy());
    dbManager.registerStrategy(new NativeStrategy());
  }
  return dbManager;
}

/**
 * Configuration for test Neo4j connection (legacy - for backward compatibility)
 */
export const TEST_NEO4J_CONFIG = {
  uri: process.env.TEST_NEO4J_URI || process.env.NEO4J_URI || 'bolt://localhost:7687',
  username: process.env.TEST_NEO4J_USERNAME || process.env.NEO4J_USERNAME || 'neo4j',
  password: process.env.TEST_NEO4J_PASSWORD || process.env.NEO4J_PASSWORD || 'test1234',
  database: process.env.TEST_NEO4J_DATABASE || process.env.NEO4J_DATABASE || 'codegraph_test',
};

/**
 * Creates a Neo4j client configured for testing.
 * Uses universal database manager with automatic strategy selection:
 * 1. Service (pre-existing Neo4j) - 0ms startup
 * 2. Native (Test Harness via Java) - 3-7s startup ✅ Phase 4
 * 3. Container (Docker) - 5-10s startup (TODO: Phase 3)
 *
 * @returns Neo4j client ready for testing
 */
export async function createTestNeo4jClient(): Promise<Neo4jClient> {
  const manager = getDatabaseManager();

  // Get connection using universal strategy
  const connection = await manager.getConnection({
    type: 'neo4j',
    service: {
      enabled: true,
      uri: TEST_NEO4J_CONFIG.uri,
      username: TEST_NEO4J_CONFIG.username,
      password: TEST_NEO4J_CONFIG.password,
      database: TEST_NEO4J_CONFIG.database,
    },
    container: {
      enabled: false, // TODO: Phase 3
    },
    native: {
      enabled: true, // ✅ Phase 4: Native strategy via Neo4j Test Harness
    },
  });

  // Store connection for cleanup
  currentConnection = connection;

  // Create Neo4j client with connection details
  const client = new Neo4jClient({
    uri: connection.uri,
    username: connection.username,
    password: connection.password,
    database: connection.database,
  });

  return client;
}

/**
 * Cleanup database manager after all tests.
 * Call this in global afterAll or test teardown.
 */
export async function cleanupDatabaseManager(): Promise<void> {
  if (dbManager) {
    await dbManager.cleanup();
    dbManager = null;
    currentConnection = null;
  }
}

/**
 * Cleans all data from the test database.
 * This is fast (typically <100ms) and provides complete isolation.
 *
 * @param client - The Neo4j client connected to test database
 * @param context - Optional context for logging
 */
export async function cleanTestDatabase(
  client: Neo4jClient,
  context: string = 'TestCleanup'
): Promise<void> {
  try {
    // Delete all nodes and relationships
    await client.runTransaction(
      'MATCH (n) DETACH DELETE n',
      {},
      'WRITE',
      context
    );
  } catch (error: any) {
    // If database is already empty, that's fine
    if (!error.message.includes('not found')) {
      throw error;
    }
  }
}

/**
 * Verifies that test database is empty.
 * Useful for debugging test isolation issues.
 *
 * @param client - The Neo4j client
 * @returns Object with node and relationship counts
 */
export async function verifyDatabaseEmpty(
  client: Neo4jClient
): Promise<{ nodeCount: number; relationshipCount: number }> {
  const result = await client.runTransaction<any>(
    `
    MATCH (n)
    OPTIONAL MATCH ()-[r]->()
    RETURN count(DISTINCT n) AS nodeCount, count(DISTINCT r) AS relCount
    `,
    {},
    'READ',
    'TestVerification'
  );

  const record = result.records[0];
  return {
    nodeCount: record.get('nodeCount').toInt(),
    relationshipCount: record.get('relCount').toInt(),
  };
}

/**
 * Creates a Collection node for testing relationships.
 * Many tests need collections to link errors/resources to.
 *
 * @param client - The Neo4j client
 * @param collectionId - ID for the collection
 * @returns The created collection ID
 */
export async function createTestCollection(
  client: Neo4jClient,
  collectionId: string = 'test-collection'
): Promise<string> {
  await client.runTransaction(
    `
    CREATE (c:Collection {
      id: $id,
      name: 'Test Collection',
      createdAt: timestamp()
    })
    `,
    { id: collectionId },
    'WRITE',
    'TestSetup'
  );
  return collectionId;
}

/**
 * Helper to count nodes by label.
 *
 * @param client - The Neo4j client
 * @param label - Node label to count
 * @returns Number of nodes with that label
 */
export async function countNodesByLabel(
  client: Neo4jClient,
  label: string
): Promise<number> {
  const result = await client.runTransaction<any>(
    `MATCH (n:${label}) RETURN count(n) AS count`,
    {},
    'READ',
    'TestVerification'
  );
  return result.records[0].get('count').toInt();
}

/**
 * Helper to count relationships by type.
 *
 * @param client - The Neo4j client
 * @param type - Relationship type to count
 * @returns Number of relationships of that type
 */
export async function countRelationshipsByType(
  client: Neo4jClient,
  type: string
): Promise<number> {
  const result = await client.runTransaction<any>(
    `MATCH ()-[r:${type}]->() RETURN count(r) AS count`,
    {},
    'READ',
    'TestVerification'
  );
  return result.records[0].get('count').toInt();
}

/**
 * Skips test if Neo4j is not available.
 * Useful for local development when Neo4j might not be running.
 *
 * @param client - The Neo4j client to check
 * @returns true if Neo4j is available, false otherwise
 */
export async function isNeo4jAvailable(client: Neo4jClient): Promise<boolean> {
  try {
    await client.initializeDriver('AvailabilityCheck');
    const healthy = await client.isConnectionHealthy('AvailabilityCheck');
    await client.closeDriver('AvailabilityCheck');
    return healthy;
  } catch (error) {
    return false;
  }
}

/**
 * Gets the Neo4j version for version-specific test logic.
 *
 * @param client - The Neo4j client
 * @returns Version string (e.g., "5.13.0")
 */
export async function getNeo4jVersion(client: Neo4jClient): Promise<string> {
  const result = await client.runTransaction<any>(
    'CALL dbms.components() YIELD versions RETURN versions[0] AS version',
    {},
    'READ',
    'TestSetup'
  );
  return result.records[0].get('version');
}
