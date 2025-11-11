/**
 * Card Component Types
 *
 * Adapted from @mindlercare/mindlerui/Card
 * Simplified for web with essential features.
 */

export type CardVariant = "default" | "elevated" | "outlined";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Visual variant of the card
   * @default "default"
   */
  variant?: CardVariant;

  /**
   * Whether the card is interactive (clickable)
   * @default false
   */
  interactive?: boolean;

  /**
   * Click handler (only works if interactive is true)
   */
  onClick?: () => void;

  /**
   * Card content
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
