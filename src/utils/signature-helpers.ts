import {
  Node,
  FunctionDeclaration,
  MethodDeclaration,
  ArrowFunction,
  FunctionExpression,
  MethodSignature,
  ParameterDeclaration,
  SyntaxKind,
} from "ts-morph";

/**
 * Type alias for function-like nodes that can have parameters
 */
export type FunctionLike =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression
  | MethodSignature;

/**
 * Extracts parameter type signature from a function-like node.
 * Returns a string representation of parameter types suitable for entity ID generation.
 *
 * @param node - The function-like node to extract signature from
 * @returns Parameter signature string (e.g., "(string, number)" or "(string, number?)" or "")
 *
 * @example
 * // For: function process(name: string, count: number) {}
 * // Returns: "(string,number)"
 *
 * // For: function optional(name?: string) {}
 * // Returns: "(string?)"
 *
 * // For: function rest(...args: string[]) {}
 * // Returns: "(...string[])"
 */
export function getParameterSignature(node: FunctionLike): string {
  try {
    const parameters = node.getParameters();

    if (parameters.length === 0) {
      return "";
    }

    const paramTypes = parameters.map((param: ParameterDeclaration) => {
      let typeStr = "";

      // Check if rest parameter
      if (param.isRestParameter()) {
        typeStr = "...";
      }

      // Get parameter type
      try {
        const paramType = param.getType().getText();
        // Simplify complex types for readability
        typeStr += simplifyType(paramType);
      } catch (e) {
        typeStr += "any";
      }

      // Add optional marker
      if (param.hasQuestionToken()) {
        typeStr += "?";
      }

      return typeStr;
    });

    return `(${paramTypes.join(",")})`;
  } catch (error) {
    // If extraction fails, return empty string
    return "";
  }
}

/**
 * Extracts an abbreviated signature hint suitable for human-readable entity IDs.
 * Limits the signature to a maximum length for readability.
 *
 * @param node - The function-like node
 * @param maxLength - Maximum length of the signature hint (default: 50)
 * @returns Abbreviated signature string
 *
 * @example
 * // For: function complex(a: string, b: number, c: VeryLongTypeName) {}
 * // Returns: "(string,number,...)" if full signature exceeds maxLength
 */
export function getSignatureHint(
  node: Node,
  maxLength: number = 50,
): string {
  if (
    !Node.isFunctionDeclaration(node) &&
    !Node.isMethodDeclaration(node) &&
    !Node.isArrowFunction(node) &&
    !Node.isFunctionExpression(node) &&
    !Node.isMethodSignature(node)
  ) {
    return "";
  }

  const fullSignature = getParameterSignature(node);

  if (fullSignature.length === 0) {
    return "";
  }

  // If signature is short enough, return as-is
  if (fullSignature.length <= maxLength) {
    return fullSignature;
  }

  // Truncate and add ellipsis
  const truncated = fullSignature.substring(0, maxLength - 4);
  const lastComma = truncated.lastIndexOf(",");

  if (lastComma > 0) {
    // Truncate at last complete parameter
    return truncated.substring(0, lastComma) + ",...)";
  } else {
    // Just truncate
    return truncated + "...)";
  }
}

/**
 * Simplifies complex TypeScript types for signature readability.
 * Removes module paths, simplifies generic types, etc.
 *
 * @param typeStr - The full type string from TypeScript
 * @returns Simplified type string
 *
 * @example
 * // "import(\"/path/to/module\").User" -> "User"
 * // "Array<string>" -> "Array<string>" (kept as-is)
 * // "Promise<Result<Data, Error>>" -> "Promise<...>" (simplified nested generics)
 */
function simplifyType(typeStr: string): string {
  // Remove import statements
  typeStr = typeStr.replace(/import\([^)]+\)\./g, "");

  // Simplify deeply nested generics (more than 2 levels)
  const genericDepth = (typeStr.match(/</g) || []).length;
  if (genericDepth > 2) {
    // Find first generic and replace nested content
    const firstGeneric = typeStr.indexOf("<");
    if (firstGeneric > 0) {
      const baseName = typeStr.substring(0, firstGeneric);
      return `${baseName}<...>`;
    }
  }

  // Limit total length
  if (typeStr.length > 30) {
    return typeStr.substring(0, 27) + "...";
  }

  return typeStr;
}

/**
 * Gets the full method signature including method name and parameters.
 * Used for methods in classes/interfaces.
 *
 * @param node - Method declaration or method signature
 * @returns Full method signature string
 *
 * @example
 * // For: getUser(id: string): User
 * // Returns: "getUser(string)"
 */
export function getMethodSignature(
  node: MethodDeclaration | MethodSignature,
): string {
  const name = node.getName();
  const paramSignature = getParameterSignature(node);
  return `${name}${paramSignature}`;
}

/**
 * Checks if a node is a function-like node that can have a signature.
 *
 * @param node - The node to check
 * @returns True if the node is function-like
 */
export function isFunctionLike(node: Node): node is FunctionLike {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isMethodSignature(node)
  );
}
