/**
 * @devac/ui-primitives
 *
 * Mindler Open Code UI Primitives
 * Extracted from @mindlercare/mindlerui for web applications
 *
 * Philosophy: "Open Code" - Copy components into your project, own them completely
 *
 * Usage:
 * ```bash
 * npx tsx src/devac/ui-gen/cli.ts add Button
 * ```
 */

// Theme System
export { tokens, createTheme, defaultTheme } from "./theme";
export type { Theme, Tokens } from "./theme/types";

// Components
export { Button } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./Card";
export type { CardProps, CardVariant } from "./Card";

export { Badge } from "./Badge";
export type { BadgeProps, BadgeVariant, BadgeSize } from "./Badge";

export { Text } from "./Text";
export type { TextProps, TextVariant, TextColor, TextAlign } from "./Text";
