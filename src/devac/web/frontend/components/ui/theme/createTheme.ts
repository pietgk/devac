import { tokens } from "./tokens";
import type { Theme } from "./types";

/**
 * Create Theme Function
 *
 * Factory function to create a theme with optional overrides.
 * Projects can use this to extend the base tokens with their own.
 *
 * @example
 * ```typescript
 * const devacTheme = createTheme({
 *   colors: {
 *     ...tokens.colors,
 *     terminal: { bg: "#1e1e1e", text: "#d4d4d4" },
 *   },
 *   code: {
 *     fontFamily: "Monaco, monospace",
 *   },
 * });
 * ```
 */
export function createTheme(overrides?: Partial<Theme>): Theme {
  return {
    ...tokens,
    ...overrides,
    // Deep merge colors if provided
    ...(overrides?.colors && {
      colors: {
        ...tokens.colors,
        ...overrides.colors,
      },
    }),
  };
}

/**
 * Default Theme Export
 *
 * Use this as the base theme without any customizations.
 */
export const defaultTheme = createTheme();
