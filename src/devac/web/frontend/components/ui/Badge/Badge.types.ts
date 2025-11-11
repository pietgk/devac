/**
 * Badge Component Types
 *
 * Adapted from @mindlercare/mindlerui/Badge
 * For status indicators and labels.
 */

export type BadgeVariant =
  | "default"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "error"
  | "info";

export type BadgeSize = "sm" | "md" | "lg";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /**
   * Visual variant of the badge
   * @default "default"
   */
  variant?: BadgeVariant;

  /**
   * Size of the badge
   * @default "md"
   */
  size?: BadgeSize;

  /**
   * Badge content
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
