// src/devac/services/codegraph/resource-manager.ts

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { Neo4jClient } from '../../../database/neo4j-client.js';

export type ResourceType = 'log' | 'snapshot' | 'error-log' | 'file-content';

export interface ResourceMetadata {
  [key: string]: any;
}

export interface StoreResourceOptions {
  type: ResourceType;
  content: string;
  metadata?: ResourceMetadata;
  collectionId?: string;
  errorId?: string;
  persistToGraph?: boolean;
}

export interface Resource {
  id: string;
  type: ResourceType;
  size: number;
  hash: string;
  path: string;
  metadata?: ResourceMetadata;
  createdAt: number;
}

export interface ResourceStatistics {
  totalCount: number;
  totalSize: number;
  byType: Record<ResourceType, number>;
}

export interface ResourceManagerOptions {
  resourceDir: string;
}

/**
 * ResourceManager handles storage and retrieval of large data resources.
 * Resources are stored on disk and referenced in Neo4j graph.
 * Implements Disposable pattern for use with TypeScript 'using' keyword.
 */
export class ResourceManager implements Disposable {
  private readonly resourceDir: string;
  private readonly neo4jClient: Neo4jClient;
  private disposed: boolean = false;
  private resourceIndex: Map<string, Resource> = new Map();

  constructor(neo4jClient: Neo4jClient, options: ResourceManagerOptions) {
    this.neo4jClient = neo4jClient;
    this.resourceDir = options.resourceDir;
  }

  /**
   * Initialize the resource manager by creating the resource directory.
   */
  async initialize(): Promise<void> {
    this.checkDisposed();
    await fs.mkdir(this.resourceDir, { recursive: true });
    await this.loadResourceIndex();
  }

  /**
   * Store a resource on disk and optionally in Neo4j graph.
   */
  async storeResource(options: StoreResourceOptions): Promise<string> {
    this.checkDisposed();

    const resourceId = randomUUID();
    const hash = this.calculateHash(options.content);
    const size = Buffer.byteLength(options.content, 'utf-8');
    const createdAt = Date.now();

    // Create type subdirectory
    const typeDir = path.join(this.resourceDir, options.type);
    await fs.mkdir(typeDir, { recursive: true });

    // Store content to disk
    const resourcePath = path.join(typeDir, `${resourceId}.txt`);
    await fs.writeFile(resourcePath, options.content, 'utf-8');

    // Create resource object
    const resource: Resource = {
      id: resourceId,
      type: options.type,
      size,
      hash,
      path: resourcePath,
      metadata: options.metadata,
      createdAt,
    };

    // Store in index
    this.resourceIndex.set(resourceId, resource);

    // Persist metadata to disk
    await this.saveResourceMetadata(resourceId, resource);

    // Create Neo4j node if requested
    if (options.persistToGraph) {
      await this.persistToGraph(resource, options.collectionId, options.errorId);
    }

    return resourceId;
  }

  /**
   * Retrieve resource metadata by ID.
   */
  async getResource(resourceId: string): Promise<Resource | null> {
    this.checkDisposed();

    // Check in-memory index first
    const resource = this.resourceIndex.get(resourceId);
    if (resource) {
      return resource;
    }

    // Try loading from disk
    return await this.loadResourceMetadata(resourceId);
  }

  /**
   * Read resource content from disk.
   */
  async readResourceContent(resourceId: string): Promise<string | null> {
    this.checkDisposed();

    const resource = await this.getResource(resourceId);
    if (!resource) {
      return null;
    }

    try {
      const content = await fs.readFile(resource.path, 'utf-8');
      return content;
    } catch (error) {
      return null;
    }
  }

  /**
   * Find resources that are not referenced in the Neo4j graph.
   */
  async findOrphanedResources(): Promise<string[]> {
    this.checkDisposed();

    // Get all resource IDs from disk
    const allResourceIds = Array.from(this.resourceIndex.keys());

    // Query Neo4j for resource IDs that exist in graph
    const result = await this.neo4jClient.runTransaction<any>(
      `
      MATCH (r:Resource)
      RETURN r.id AS id
      `,
      {},
      'READ',
      'ResourceManager'
    );

    const graphResourceIds = new Set(
      result.records.map((record: any) => record.get('id'))
    );

    // Find resources that are on disk but not in graph
    const orphanedIds = allResourceIds.filter(
      (id) => !graphResourceIds.has(id)
    );

    return orphanedIds;
  }

  /**
   * Delete a resource from disk and index.
   */
  async deleteResource(resourceId: string): Promise<void> {
    this.checkDisposed();

    const resource = await this.getResource(resourceId);
    if (!resource) {
      return;
    }

    // Delete content file
    try {
      await fs.unlink(resource.path);
    } catch (error) {
      // Ignore if already deleted
    }

    // Delete metadata file
    const metadataPath = this.getMetadataPath(resourceId, resource.type);
    try {
      await fs.unlink(metadataPath);
    } catch (error) {
      // Ignore if already deleted
    }

    // Remove from index
    this.resourceIndex.delete(resourceId);
  }

  /**
   * Cleanup all orphaned resources.
   */
  async cleanupOrphans(): Promise<number> {
    this.checkDisposed();

    const orphans = await this.findOrphanedResources();

    for (const orphanId of orphans) {
      await this.deleteResource(orphanId);
    }

    return orphans.length;
  }

  /**
   * Get resource storage statistics.
   */
  async getStatistics(): Promise<ResourceStatistics> {
    this.checkDisposed();

    const stats: ResourceStatistics = {
      totalCount: 0,
      totalSize: 0,
      byType: {
        log: 0,
        snapshot: 0,
        'error-log': 0,
        'file-content': 0,
      },
    };

    for (const resource of this.resourceIndex.values()) {
      stats.totalCount++;
      stats.totalSize += resource.size;
      stats.byType[resource.type] = (stats.byType[resource.type] || 0) + 1;
    }

    return stats;
  }

  /**
   * Dispose of resources (implements Disposable pattern).
   */
  [Symbol.dispose](): void {
    this.disposed = true;
    this.resourceIndex.clear();
  }

  /**
   * Calculate SHA-256 hash of content.
   */
  private calculateHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Persist resource to Neo4j graph.
   */
  private async persistToGraph(
    resource: Resource,
    collectionId?: string,
    errorId?: string
  ): Promise<void> {
    // Create Resource node
    await this.neo4jClient.runTransaction(
      `
      CREATE (r:Resource {
        id: $id,
        type: $type,
        size: $size,
        hash: $hash,
        path: $path,
        createdAt: $createdAt
      })
      `,
      {
        id: resource.id,
        type: resource.type,
        size: resource.size,
        hash: resource.hash,
        path: resource.path,
        createdAt: resource.createdAt,
      },
      'WRITE',
      'ResourceManager'
    );

    // Link to collection if provided
    if (collectionId) {
      await this.neo4jClient.runTransaction(
        `
        MATCH (r:Resource {id: $id})
        MATCH (c:Collection {id: $collectionId})
        CREATE (r)-[:STORED_IN]->(c)
        `,
        { id: resource.id, collectionId },
        'WRITE',
        'ResourceManager'
      );
    }

    // Link to error if provided
    if (errorId) {
      await this.neo4jClient.runTransaction(
        `
        MATCH (r:Resource {id: $id})
        MATCH (e:ServiceError {id: $errorId})
        CREATE (r)-[:ATTACHED_TO]->(e)
        `,
        { id: resource.id, errorId },
        'WRITE',
        'ResourceManager'
      );
    }
  }

  /**
   * Save resource metadata to disk as JSON.
   */
  private async saveResourceMetadata(
    resourceId: string,
    resource: Resource
  ): Promise<void> {
    const metadataPath = this.getMetadataPath(resourceId, resource.type);
    await fs.writeFile(metadataPath, JSON.stringify(resource, null, 2), 'utf-8');
  }

  /**
   * Load resource metadata from disk.
   */
  private async loadResourceMetadata(
    resourceId: string
  ): Promise<Resource | null> {
    // Try to find metadata file in any type directory
    const types: ResourceType[] = ['log', 'snapshot', 'error-log', 'file-content'];

    for (const type of types) {
      const metadataPath = this.getMetadataPath(resourceId, type);
      try {
        const content = await fs.readFile(metadataPath, 'utf-8');
        const resource = JSON.parse(content) as Resource;
        this.resourceIndex.set(resourceId, resource);
        return resource;
      } catch (error) {
        // Try next type
        continue;
      }
    }

    return null;
  }

  /**
   * Load all resource metadata into index.
   */
  private async loadResourceIndex(): Promise<void> {
    const types: ResourceType[] = ['log', 'snapshot', 'error-log', 'file-content'];

    for (const type of types) {
      const typeDir = path.join(this.resourceDir, type);

      try {
        const files = await fs.readdir(typeDir);
        const metadataFiles = files.filter((f) => f.endsWith('.meta.json'));

        for (const metadataFile of metadataFiles) {
          const metadataPath = path.join(typeDir, metadataFile);
          try {
            const content = await fs.readFile(metadataPath, 'utf-8');
            const resource = JSON.parse(content) as Resource;
            this.resourceIndex.set(resource.id, resource);
          } catch (error) {
            // Skip invalid metadata files
            continue;
          }
        }
      } catch (error) {
        // Type directory doesn't exist yet, skip
        continue;
      }
    }
  }

  /**
   * Get metadata file path for a resource.
   */
  private getMetadataPath(resourceId: string, type: ResourceType): string {
    return path.join(this.resourceDir, type, `${resourceId}.meta.json`);
  }

  /**
   * Check if manager is disposed and throw if so.
   */
  private checkDisposed(): void {
    if (this.disposed) {
      throw new Error('ResourceManager has been disposed');
    }
  }
}
