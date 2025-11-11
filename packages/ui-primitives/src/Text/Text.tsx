/**
 * Text Component
 *
 * Typography component extracted from @mindlercare/mindlerui
 * Semantic text variants with full customization.
 *
 * @example
 * ```tsx
 * <Text variant="h1">Heading 1</Text>
 * <Text variant="body" color="muted">Body text</Text>
 * <Text variant="caption" truncate>Long caption text...</Text>
 * <Text variant="label">Label Text</Text>
 * ```
 */

import React from "react";
import { StyledText } from "./Text.styles";
import type { TextProps } from "./Text.types";

// Map variants to default HTML elements
const getDefaultElement = (variant: TextProps["variant"]): keyof JSX.IntrinsicElements => {
  switch (variant) {
    case "h1":
      return "h1";
    case "h2":
      return "h2";
    case "h3":
      return "h3";
    case "h4":
      return "h4";
    case "h5":
      return "h5";
    case "h6":
      return "h6";
    case "body":
    case "bodyLarge":
    case "bodySmall":
      return "p";
    case "caption":
    case "label":
      return "span";
    default:
      return "span";
  }
};

export const Text = React.forwardRef<HTMLElement, TextProps>(
  (
    {
      variant = "body",
      as,
      color = "default",
      align,
      weight,
      truncate = false,
      lines,
      children,
      className,
      testID,
      ...restProps
    },
    ref
  ) => {
    const element = as || getDefaultElement(variant);

    return (
      <StyledText
        ref={ref as any}
        as={element}
        $variant={variant}
        $color={color}
        $align={align}
        $weight={weight}
        $truncate={truncate}
        $lines={lines}
        data-testid={testID}
        className={className}
        {...restProps}
      >
        {children}
      </StyledText>
    );
  }
);

Text.displayName = "Text";
