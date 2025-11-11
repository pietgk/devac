/**
 * Card Component
 *
 * Flexible card component extracted from @mindlercare/mindlerui
 * Adapted for web with full accessibility support.
 *
 * @example
 * ```tsx
 * <Card variant="elevated">
 *   <CardHeader>
 *     <CardTitle>Service Name</CardTitle>
 *     <CardDescription>Service description</CardDescription>
 *   </CardHeader>
 *   <CardContent>
 *     Content goes here
 *   </CardContent>
 *   <CardFooter>
 *     <Button>Action</Button>
 *   </CardFooter>
 * </Card>
 *
 * <Card interactive onClick={handleClick}>
 *   Clickable card
 * </Card>
 * ```
 */

import React from "react";
import { StyledCard } from "./Card.styles";
import type { CardProps } from "./Card.types";

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      variant = "default",
      interactive = false,
      onClick,
      children,
      className,
      testID,
      ...restProps
    },
    ref
  ) => {
    const handleClick = () => {
      if (interactive && onClick) {
        onClick();
      }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (interactive && onClick && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        onClick();
      }
    };

    return (
      <StyledCard
        ref={ref}
        $variant={variant}
        $interactive={interactive}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        data-testid={testID}
        className={className}
        {...restProps}
      >
        {children}
      </StyledCard>
    );
  }
);

Card.displayName = "Card";

// Re-export sub-components for convenience
export {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./Card.styles";
