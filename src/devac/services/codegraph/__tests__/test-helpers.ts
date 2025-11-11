// src/devac/services/codegraph/__tests__/codegraph-service-test-helpers.ts

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Neo4jClient } from "../../../../database/neo4j-client.js";
import type { ServiceConfig } from "../../../types/index.js";
import type { CodeGraphServiceConfig } from "../codegraph-service.js";

/**
 * Creates a real test project with actual files on the file system.
 *
 * @param dir - Base directory to create files in
 * @param files - Map of relative path to file content
 */
export async function createTestProject(
  dir: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    const dirPath = path.dirname(fullPath);

    // Create directory if needed
    await fs.mkdir(dirPath, { recursive: true });

    // Write file
    await fs.writeFile(fullPath, content, "utf-8");
  }
}

/**
 * Queries Neo4j for all Collections belonging to a service.
 *
 * @param client - Neo4j client
 * @param serviceId - Service ID to query
 * @returns Array of collection nodes
 */
export async function queryCollections(
  client: Neo4jClient,
  serviceId: string,
): Promise<any[]> {
  const result = await client.runTransaction<any>(
    `
    MATCH (s:Service {id: $serviceId})-[:COLLECTED_AT]->(c:Collection)
    RETURN c
    ORDER BY c.timestamp DESC
    `,
    { serviceId },
    "READ",
    "TestQuery",
  );

  return result.records.map((record) => {
    const node = record.get("c");
    return {
      id: node.properties.id,
      serviceId: node.properties.serviceId,
      timestamp: node.properties.timestamp,
      itemsProcessed:
        node.properties.itemsProcessed?.toInt?.() ??
        node.properties.itemsProcessed,
      nodesCreated:
        node.properties.nodesCreated?.toInt?.() ?? node.properties.nodesCreated,
      relationshipsCreated:
        node.properties.relationshipsCreated?.toInt?.() ??
        node.properties.relationshipsCreated,
      duration: node.properties.duration?.toInt?.() ?? node.properties.duration,
      errors: node.properties.errors?.toInt?.() ?? node.properties.errors,
      warnings: node.properties.warnings?.toInt?.() ?? node.properties.warnings,
    };
  });
}

/**
 * Queries Neo4j for a specific Collection by ID.
 *
 * @param client - Neo4j client
 * @param collectionId - Collection ID
 * @returns Collection node or null
 */
export async function queryCollection(
  client: Neo4jClient,
  collectionId: string,
): Promise<any | null> {
  const result = await client.runTransaction<any>(
    `
    MATCH (c:Collection {id: $collectionId})
    RETURN c
    `,
    { collectionId },
    "READ",
    "TestQuery",
  );

  if (result.records.length === 0) {
    return null;
  }

  const node = result.records[0].get("c");
  return {
    id: node.properties.id,
    serviceId: node.properties.serviceId,
    timestamp: node.properties.timestamp,
    itemsProcessed:
      node.properties.itemsProcessed?.toInt?.() ??
      node.properties.itemsProcessed,
    nodesCreated:
      node.properties.nodesCreated?.toInt?.() ?? node.properties.nodesCreated,
    relationshipsCreated:
      node.properties.relationshipsCreated?.toInt?.() ??
      node.properties.relationshipsCreated,
    duration: node.properties.duration?.toInt?.() ?? node.properties.duration,
    errors: node.properties.errors?.toInt?.() ?? node.properties.errors,
    warnings: node.properties.warnings?.toInt?.() ?? node.properties.warnings,
  };
}

/**
 * Queries Neo4j for a Service node.
 *
 * @param client - Neo4j client
 * @param serviceId - Service ID
 * @returns Service node or null
 */
export async function queryServiceNode(
  client: Neo4jClient,
  serviceId: string,
): Promise<any | null> {
  const result = await client.runTransaction<any>(
    `
    MATCH (s:Service {id: $serviceId})
    RETURN s
    `,
    { serviceId },
    "READ",
    "TestQuery",
  );

  if (result.records.length === 0) {
    return null;
  }

  const node = result.records[0].get("s");
  return {
    id: node.properties.id,
    name: node.properties.name,
    type: node.properties.type,
    status: node.properties.status,
    startedAt: node.properties.startedAt,
    stoppedAt: node.properties.stoppedAt,
    version: node.properties.version,
  };
}

/**
 * Queries for log file relationships.
 *
 * @param client - Neo4j client
 * @param collectionId - Collection ID
 * @returns Log file relationship info or null
 */
export async function queryLogFileLink(
  client: Neo4jClient,
  collectionId: string,
): Promise<any | null> {
  const result = await client.runTransaction<any>(
    `
    MATCH (c:Collection {id: $collectionId})-[r:LOGGED_IN]->(log:Resource:LogFile)
    RETURN log, r.startLine AS startLine, r.endLine AS endLine
    `,
    { collectionId },
    "READ",
    "TestQuery",
  );

  if (result.records.length === 0) {
    return null;
  }

  const record = result.records[0];
  const logNode = record.get("log");

  return {
    path: logNode.properties.path,
    type: logNode.properties.type,
    format: logNode.properties.format,
    startLine: record.get("startLine")?.toInt?.() ?? record.get("startLine"),
    endLine: record.get("endLine")?.toInt?.() ?? record.get("endLine"),
  };
}

/**
 * Creates a ServiceConfig for testing CodeGraphService.
 *
 * @param tempDir - Temporary directory for logs/resources
 * @param neo4jClient - Neo4j client instance
 * @param overrides - Optional config overrides
 * @returns ServiceConfig ready for CodeGraphService
 */
export function createServiceConfig(
  tempDir: string,
  neo4jClient: Neo4jClient,
  overrides?: Partial<CodeGraphServiceConfig>,
): ServiceConfig {
  const config: CodeGraphServiceConfig = {
    directories: [tempDir],
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    ignore: ["**/node_modules/**", "**/.git/**"],
    watch: false, // Disabled by default for tests
    logDir: path.join(tempDir, "logs"),
    resourceDir: path.join(tempDir, "resources"),
    maxLogFileSize: 1024 * 1024, // 1MB
    maxLogFiles: 3,
    neo4j: {
      uri: (neo4jClient as any).neo4jConfig.uri,
      username: (neo4jClient as any).neo4jConfig.username,
      password: (neo4jClient as any).neo4jConfig.password,
      database: (neo4jClient as any).neo4jConfig.database,
    },
    ...overrides,
  };

  return {
    id: "test-codegraph",
    name: "Test CodeGraph Service",
    type: "codegraph",
    enabled: true,
    config,
  };
}

/**
 * Creates a temporary directory for testing.
 * Returns cleanup function to remove directory.
 *
 * @param prefix - Prefix for temp directory name
 * @returns Object with tempDir path and cleanup function
 */
export async function createTempDir(
  prefix: string = "codegraph-test-",
): Promise<{ tempDir: string; cleanup: () => Promise<void> }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));

  const cleanup = async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
      console.warn(`Failed to cleanup temp directory ${tempDir}:`, error);
    }
  };

  return { tempDir, cleanup };
}

/**
 * Wait for a condition to be true (useful for async operations like file watching).
 *
 * @param condition - Function that returns true when ready
 * @param timeout - Max time to wait in milliseconds
 * @param interval - Polling interval in milliseconds
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}
