/**
 * Button Component
 *
 * Premium button component extracted from @mindlercare/mindlerui
 * Adapted for web with full accessibility support.
 *
 * @example
 * ```tsx
 * <Button variant="primary" onClick={handleClick}>
 *   Click me
 * </Button>
 *
 * <Button variant="secondary" size="s" loading>
 *   Loading...
 * </Button>
 *
 * <Button variant="primary" leftIcon={<Icon />}>
 *   With Icon
 * </Button>
 * ```
 */

import React from "react";
import {
  StyledButton,
  LoadingSpinner,
  ButtonContent,
  LoadingWrapper,
} from "./Button.styles";
import type { ButtonProps } from "./Button.types";

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "m",
      disabled = false,
      loading = false,
      leftIcon,
      rightIcon,
      children,
      onClick,
      type = "button",
      testID,
      className,
      ...restProps
    },
    ref
  ) => {
    const handleClick = () => {
      if (!disabled && !loading && onClick) {
        onClick();
      }
    };

    return (
      <StyledButton
        ref={ref}
        $variant={variant}
        $size={size}
        $loading={loading}
        disabled={disabled || loading}
        onClick={handleClick}
        type={type}
        data-testid={testID}
        className={className}
        aria-busy={loading}
        aria-disabled={disabled || loading}
        {...restProps}
      >
        <ButtonContent $loading={loading}>
          {leftIcon && <span className="button-icon">{leftIcon}</span>}
          {children}
          {rightIcon && <span className="button-icon">{rightIcon}</span>}
        </ButtonContent>

        {loading && (
          <LoadingWrapper>
            <LoadingSpinner aria-label="Loading" />
          </LoadingWrapper>
        )}
      </StyledButton>
    );
  }
);

Button.displayName = "Button";
