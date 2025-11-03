// src/analyzer/parsers/component-analyzer.ts
import { FunctionDeclaration, FunctionExpression, ArrowFunction, VariableDeclaration, Node, ts } from 'ts-morph';
import { createContextLogger } from '../../utils/logger.js';

const { SyntaxKind } = ts;
const logger = createContextLogger('ComponentAnalyzer');

/**
 * Analyzes functions to determine if they are React components or hooks.
 */
export class ComponentAnalyzer {
    /**
     * Determines if a function is a React component
     */
    isReactComponent(func: FunctionDeclaration | FunctionExpression | ArrowFunction): boolean {
        // Check 1: Name starts with uppercase (React convention)
        const name = this.getFunctionName(func);
        if (!name || !/^[A-Z]/.test(name)) {
            return false;
        }

        // Check 2: File is .tsx or .jsx
        const sourceFile = func.getSourceFile();
        const fileName = sourceFile.getBaseName();
        if (!fileName.endsWith('.tsx') && !fileName.endsWith('.jsx')) {
            return false;
        }

        // Check 3: Returns JSX
        if (this.returnsJSX(func)) {
            return true;
        }

        // Check 4: Has JSX in body
        if (this.containsJSX(func)) {
            return true;
        }

        return false;
    }

    /**
     * Determines if a function is a React hook
     */
    isReactHook(func: FunctionDeclaration | FunctionExpression | ArrowFunction): boolean {
        const name = this.getFunctionName(func);
        if (!name) {
            return false;
        }

        // Hook convention: starts with "use" followed by uppercase letter
        return /^use[A-Z]/.test(name);
    }

    /**
     * Finds all components that a component renders
     */
    findRenderedComponents(func: FunctionDeclaration | FunctionExpression | ArrowFunction): string[] {
        const renderedComponents: string[] = [];

        try {
            // Find all JSX elements in the function body
            const jsxElements = func.getDescendantsOfKind(SyntaxKind.JsxElement);
            const jsxSelfClosing = func.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);

            for (const element of [...jsxElements, ...jsxSelfClosing]) {
                const tagName = this.getJSXTagName(element);

                // Only track custom components (start with uppercase)
                if (tagName && /^[A-Z]/.test(tagName)) {
                    renderedComponents.push(tagName);
                }
            }
        } catch (error: any) {
            logger.warn(`Error finding rendered components: ${error.message}`);
        }

        return Array.from(new Set(renderedComponents)); // Remove duplicates
    }

    /**
     * Finds all hooks used by a component
     */
    findUsedHooks(func: FunctionDeclaration | FunctionExpression | ArrowFunction): string[] {
        const usedHooks: string[] = [];

        try {
            // Find all call expressions in the function body
            const calls = func.getDescendantsOfKind(SyntaxKind.CallExpression);

            for (const call of calls) {
                const expression = call.getExpression();
                const callText = expression.getText();

                // Check if it's a hook call (starts with "use")
                if (/^use[A-Z]/.test(callText)) {
                    usedHooks.push(callText);
                }
            }
        } catch (error: any) {
            logger.warn(`Error finding used hooks: ${error.message}`);
        }

        return Array.from(new Set(usedHooks)); // Remove duplicates
    }

    // Private helper methods

    private getFunctionName(func: FunctionDeclaration | FunctionExpression | ArrowFunction): string | undefined {
        // Try to get name from function declaration
        if (Node.isFunctionDeclaration(func)) {
            return func.getName();
        }

        // For expressions/arrows, try to get name from variable declaration
        const varDecl = func.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
        if (varDecl) {
            return varDecl.getName();
        }

        return undefined;
    }

    private returnsJSX(func: FunctionDeclaration | FunctionExpression | ArrowFunction): boolean {
        try {
            const returnType = func.getReturnType();
            const typeText = returnType.getText();

            // Check for common JSX return types
            return (
                typeText.includes('JSX.Element') ||
                typeText.includes('React.ReactElement') ||
                typeText.includes('ReactElement') ||
                typeText.includes('React.ReactNode') ||
                typeText.includes('ReactNode')
            );
        } catch {
            return false;
        }
    }

    private containsJSX(func: FunctionDeclaration | FunctionExpression | ArrowFunction): boolean {
        try {
            const jsxElements = func.getDescendantsOfKind(SyntaxKind.JsxElement);
            const jsxSelfClosing = func.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);
            const jsxFragments = func.getDescendantsOfKind(SyntaxKind.JsxFragment);

            return (
                jsxElements.length > 0 ||
                jsxSelfClosing.length > 0 ||
                jsxFragments.length > 0
            );
        } catch {
            return false;
        }
    }

    private getJSXTagName(element: Node): string | undefined {
        try {
            if (Node.isJsxElement(element)) {
                const openingElement = element.getOpeningElement();
                return openingElement.getTagNameNode().getText();
            } else if (Node.isJsxSelfClosingElement(element)) {
                return element.getTagNameNode().getText();
            }
        } catch {
            // Ignore errors
        }
        return undefined;
    }
}
