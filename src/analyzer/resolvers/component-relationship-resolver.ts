// src/analyzer/resolvers/component-relationship-resolver.ts
import { SourceFile } from 'ts-morph';
import { AstNode, RelationshipInfo, ResolverContext, FileNode } from '../types.js';
import { ComponentAnalyzer } from '../parsers/component-analyzer.js';
import { FunctionDeclaration, FunctionExpression, ArrowFunction, Node, ts } from 'ts-morph';

const { SyntaxKind } = ts;

/**
 * Resolves React component relationships in Pass 2.
 * Creates RENDERS_COMPONENT and USES_HOOK relationships.
 */
export function resolveComponentRelationships(
    sourceFile: SourceFile,
    fileNode: FileNode,
    context: ResolverContext
): void {
    const { nodeIndex, addRelationship, generateId, generateEntityId, logger, now } = context;

    const componentAnalyzer = new ComponentAnalyzer();

    // Find all Function nodes in this file that are React components
    const componentNodes = Array.from(nodeIndex.values()).filter(
        node =>
            node.kind === 'Function' &&
            node.filePath === fileNode.filePath &&
            node.properties?.isReactComponent === true
    );

    for (const componentNode of componentNodes) {
        try {
            // Find the actual function declaration in the source file
            const funcDecl = findFunctionInSourceFile(sourceFile, componentNode);
            if (!funcDecl) {
                continue;
            }

            // Find rendered components
            const renderedComponents = componentAnalyzer.findRenderedComponents(funcDecl);
            for (const renderedName of renderedComponents) {
                const targetComponent = findComponentByName(renderedName, nodeIndex, fileNode.filePath);

                if (targetComponent) {
                    const relEntityId = generateEntityId(
                        'renders_component',
                        `${componentNode.entityId}:${targetComponent.entityId}`
                    );

                    const relationship: RelationshipInfo = {
                        id: generateId('renders_component', `${componentNode.id}:${targetComponent.id}`),
                        entityId: relEntityId,
                        type: 'RENDERS_COMPONENT',
                        sourceId: componentNode.entityId,
                        targetId: targetComponent.entityId,
                        properties: {
                            componentName: renderedName
                        },
                        createdAt: now
                    };

                    addRelationship(relationship);
                }
            }

            // Find used hooks
            const usedHooks = componentAnalyzer.findUsedHooks(funcDecl);
            for (const hookName of usedHooks) {
                const targetHook = findHookByName(hookName, nodeIndex, fileNode.filePath);

                if (targetHook) {
                    const relEntityId = generateEntityId(
                        'uses_hook',
                        `${componentNode.entityId}:${targetHook.entityId}`
                    );

                    const relationship: RelationshipInfo = {
                        id: generateId('uses_hook', `${componentNode.id}:${targetHook.id}`),
                        entityId: relEntityId,
                        type: 'USES_HOOK',
                        sourceId: componentNode.entityId,
                        targetId: targetHook.entityId,
                        properties: {
                            hookName: hookName
                        },
                        createdAt: now
                    };

                    addRelationship(relationship);
                }
            }
        } catch (error: any) {
            logger.warn(`Failed to resolve component relationships for ${componentNode.name}`, {
                error: error.message
            });
        }
    }
}

/**
 * Finds a function declaration in the source file by matching line numbers
 */
function findFunctionInSourceFile(
    sourceFile: SourceFile,
    functionNode: AstNode
): FunctionDeclaration | FunctionExpression | ArrowFunction | undefined {
    const functions = [
        ...sourceFile.getFunctions(),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction)
    ];

    return functions.find(
        func => func.getStartLineNumber() === functionNode.startLine &&
                func.getEndLineNumber() === functionNode.endLine
    );
}

/**
 * Finds a component by name in the node index
 */
function findComponentByName(
    componentName: string,
    nodeIndex: Map<string, AstNode>,
    currentFilePath: string
): AstNode | undefined {
    // First try to find in the same file
    for (const node of nodeIndex.values()) {
        if (
            node.kind === 'Function' &&
            node.name === componentName &&
            node.properties?.isReactComponent === true
        ) {
            // Prefer same file
            if (node.filePath === currentFilePath) {
                return node;
            }
        }
    }

    // If not found in same file, look in imported files
    // This would require checking imports, which we'll handle via RESOLVES_TO relationships
    return undefined;
}

/**
 * Finds a hook by name in the node index
 */
function findHookByName(
    hookName: string,
    nodeIndex: Map<string, AstNode>,
    currentFilePath: string
): AstNode | undefined {
    // First try to find in the same file
    for (const node of nodeIndex.values()) {
        if (
            node.kind === 'Function' &&
            node.name === hookName &&
            node.properties?.isHook === true
        ) {
            // Prefer same file
            if (node.filePath === currentFilePath) {
                return node;
            }
        }
    }

    return undefined;
}
