/**
 * Text Component Types
 *
 * Adapted from @mindlercare/mindlerui/Text
 * Typography component with semantic variants.
 */

export type TextVariant =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "body"
  | "bodyLarge"
  | "bodySmall"
  | "caption"
  | "label";

export type TextColor = "default" | "muted" | "primary" | "error" | "success" | "warning";

export type TextAlign = "left" | "center" | "right";

export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  /**
   * Typography variant
   * @default "body"
   */
  variant?: TextVariant;

  /**
   * HTML element to render
   * @default Determined by variant
   */
  as?: keyof JSX.IntrinsicElements;

  /**
   * Text color variant
   * @default "default"
   */
  color?: TextColor;

  /**
   * Text alignment
   */
  align?: TextAlign;

  /**
   * Font weight override
   */
  weight?: "regular" | "medium" | "semibold" | "bold";

  /**
   * Whether text should be truncated with ellipsis
   */
  truncate?: boolean;

  /**
   * Number of lines before truncating (requires truncate=true)
   */
  lines?: number;

  /**
   * Text content
   */
  children: React.ReactNode;

  /**
   * Additional CSS class name
   */
  className?: string;

  /**
   * Test ID for testing
   */
  testID?: string;
}
