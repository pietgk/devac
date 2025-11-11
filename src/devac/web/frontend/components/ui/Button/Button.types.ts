/**
 * Button Component Types
 *
 * Adapted from @mindlercare/mindlerui/Button
 * Simplified for web with essential variants and features.
 */

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "white"
  | "black"
  | "grey"
  | "transparent"
  | "link";

export type ButtonSize = "xs" | "s" | "m";

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /**
   * Visual variant of the button
   * @default "primary"
   */
  variant?: ButtonVariant;

  /**
   * Size of the button
   * @default "m"
   */
  size?: ButtonSize;

  /**
   * Whether the button is disabled
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether to show loading spinner
   * @default false
   */
  loading?: boolean;

  /**
   * Icon to display before the button text
   */
  leftIcon?: React.ReactNode;

  /**
   * Icon to display after the button text
   */
  rightIcon?: React.ReactNode;

  /**
   * Button content
   */
  children: React.ReactNode;

  /**
   * Click handler
   */
  onClick?: () => void;

  /**
   * HTML button type
   * @default "button"
   */
  type?: "button" | "submit" | "reset";

  /**
   * Test ID for testing
   */
  testID?: string;

  /**
   * Additional CSS class name
   */
  className?: string;
}
