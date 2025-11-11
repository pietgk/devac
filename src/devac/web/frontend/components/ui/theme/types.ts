import type { Tokens } from "./tokens";

/**
 * Theme Type Definition
 *
 * This type represents the complete theme structure that can be extended
 * by projects (like DevAC) to add project-specific tokens.
 */
export type Theme = Tokens & {
  // Projects can extend this with additional tokens
  // e.g., DevAC adds: code, terminal, graph tokens
  [key: string]: any;
};

/**
 * Styled Components Theme Declaration
 *
 * This augments styled-components' DefaultTheme with our theme structure
 */
declare module "styled-components" {
  export interface DefaultTheme extends Theme {}
}
