// src/analyzer/resolvers/import-relationship-resolver.ts
import { SourceFile } from 'ts-morph';
import { AstNode, RelationshipInfo, ResolverContext, FileNode } from '../types.js';
import { ImportResolver, ResolvedImport } from '../parsers/import-resolver.js';
import { PackageInfo } from '../parsers/package-extractor.js';

/**
 * Resolves import relationships in Pass 2.
 * Creates RESOLVES_TO relationships from Import nodes to their target files/functions.
 * Creates DEPENDS_ON relationships between packages.
 */
export async function resolveImportRelationships(
    sourceFile: SourceFile,
    fileNode: FileNode,
    context: ResolverContext,
    importResolver: ImportResolver
): Promise<void> {
    const { nodeIndex, addRelationship, generateId, generateEntityId, logger, now } = context;

    // Find all Import nodes for this file
    const importNodes = Array.from(nodeIndex.values()).filter(
        node => node.kind === 'Import' && node.filePath === fileNode.filePath
    );

    for (const importNode of importNodes) {
        try {
            const moduleSpecifier = importNode.properties?.moduleSpecifier;
            const importedNames = importNode.properties?.importedNames || [];
            const isTypeOnly = importNode.properties?.isTypeOnly || false;

            if (!moduleSpecifier) {
                continue;
            }

            // Resolve the import
            for (const importedName of importedNames) {
                const resolved = await importResolver.resolve(
                    {
                        name: importedName,
                        importSource: moduleSpecifier,
                        isTypeOnly: isTypeOnly,
                        isDefault: importedName === importNode.properties?.defaultImport
                    },
                    fileNode.filePath
                );

                if (resolved && resolved.resolvedType !== 'external') {
                    // Find the target node (File or specific export)
                    const targetNode = findTargetNode(resolved, nodeIndex, importedName);

                    if (targetNode) {
                        // Create RESOLVES_TO relationship
                        const relEntityId = generateEntityId(
                            'resolves_to',
                            `${importNode.entityId}:${targetNode.entityId}`
                        );

                        const relationship: RelationshipInfo = {
                            id: generateId('resolves_to', `${importNode.id}:${targetNode.id}`),
                            entityId: relEntityId,
                            type: 'RESOLVES_TO',
                            sourceId: importNode.entityId,
                            targetId: targetNode.entityId,
                            properties: {
                                importedName: importedName,
                                resolvedType: resolved.resolvedType
                            },
                            createdAt: now
                        };

                        addRelationship(relationship);
                    }
                }
            }
        } catch (error: any) {
            logger.warn(`Failed to resolve import: ${importNode.name}`, { error: error.message });
        }
    }
}

/**
 * Derives package dependency relationships from resolved imports.
 */
export function derivePackageDependencies(
    allNodes: AstNode[],
    allRelationships: RelationshipInfo[],
    packages: PackageInfo[],
    context: ResolverContext
): RelationshipInfo[] {
    const { generateId, generateEntityId, logger, now } = context;
    const packageDeps = new Map<string, Map<string, number>>(); // fromPkg -> toPkg -> count

    // Build package lookup
    const packageLookup = new Map<string, PackageInfo>();
    for (const pkg of packages) {
        packageLookup.set(pkg.name, pkg);
    }

    // Find all File nodes and their packages
    const fileToPackage = new Map<string, string>();
    for (const node of allNodes) {
        if (node.kind === 'File' && node.properties?.packageName) {
            fileToPackage.set(node.entityId, node.properties.packageName);
        }
    }

    // Analyze RESOLVES_TO relationships
    for (const rel of allRelationships) {
        if (rel.type === 'RESOLVES_TO') {
            // Find source and target files
            const sourceImport = allNodes.find(n => n.entityId === rel.sourceId);
            const targetNode = allNodes.find(n => n.entityId === rel.targetId);

            if (sourceImport && targetNode) {
                const sourceFileId = allNodes.find(
                    n => n.kind === 'File' && n.filePath === sourceImport.filePath
                )?.entityId;

                const targetFileId = targetNode.kind === 'File'
                    ? targetNode.entityId
                    : allNodes.find(n => n.kind === 'File' && n.filePath === targetNode.filePath)?.entityId;

                if (sourceFileId && targetFileId) {
                    const sourcePkg = fileToPackage.get(sourceFileId);
                    const targetPkg = fileToPackage.get(targetFileId);

                    if (sourcePkg && targetPkg && sourcePkg !== targetPkg) {
                        if (!packageDeps.has(sourcePkg)) {
                            packageDeps.set(sourcePkg, new Map());
                        }
                        const deps = packageDeps.get(sourcePkg)!;
                        deps.set(targetPkg, (deps.get(targetPkg) || 0) + 1);
                    }
                }
            }
        }
    }

    // Create DEPENDS_ON relationships
    const relationships: RelationshipInfo[] = [];
    for (const [sourcePkg, deps] of packageDeps.entries()) {
        for (const [targetPkg, weight] of deps.entries()) {
            const sourceNode = allNodes.find(n => n.kind === 'Package' && n.name === sourcePkg);
            const targetNode = allNodes.find(n => n.kind === 'Package' && n.name === targetPkg);

            if (sourceNode && targetNode) {
                const relEntityId = generateEntityId(
                    'depends_on',
                    `${sourceNode.entityId}:${targetNode.entityId}`
                );

                const relationship: RelationshipInfo = {
                    id: generateId('depends_on', `${sourceNode.id}:${targetNode.id}`),
                    entityId: relEntityId,
                    type: 'DEPENDS_ON',
                    sourceId: sourceNode.entityId,
                    targetId: targetNode.entityId,
                    weight: weight,
                    properties: {
                        importCount: weight
                    },
                    createdAt: now
                };

                relationships.push(relationship);
            }
        }
    }

    logger.info(`Created ${relationships.length} package dependency relationships`);
    return relationships;
}

/**
 * Finds the target node for a resolved import.
 */
function findTargetNode(
    resolved: ResolvedImport,
    nodeIndex: Map<string, AstNode>,
    importedName: string
): AstNode | undefined {
    // First try to find the File node
    const normalizedPath = resolved.resolvedPath.replace(/\\/g, '/');

    // Try to find file by path
    for (const node of nodeIndex.values()) {
        if (node.kind === 'File' && node.filePath === normalizedPath) {
            // If we have an exported name, try to find the specific export
            if (resolved.exportedName) {
                // Look for exported function, class, variable, etc.
                const exportedNode = Array.from(nodeIndex.values()).find(
                    n => n.filePath === normalizedPath &&
                         n.name === resolved.exportedName &&
                         n.properties?.isExported === true
                );

                if (exportedNode) {
                    return exportedNode;
                }
            }

            // Return the file node if no specific export found
            return node;
        }
    }

    return undefined;
}
