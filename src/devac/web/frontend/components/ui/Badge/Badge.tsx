/**
 * Badge Component
 *
 * Status badge component extracted from @mindlercare/mindlerui
 * For labeling and status indicators.
 *
 * @example
 * ```tsx
 * <Badge variant="success">Active</Badge>
 * <Badge variant="error">Failed</Badge>
 * <Badge variant="warning" size="sm">Pending</Badge>
 * <Badge variant="info">Processing</Badge>
 * ```
 */

import React from "react";
import { StyledBadge } from "./Badge.styles";
import type { BadgeProps } from "./Badge.types";

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      variant = "default",
      size = "md",
      children,
      className,
      testID,
      ...restProps
    },
    ref
  ) => {
    return (
      <StyledBadge
        ref={ref}
        $variant={variant}
        $size={size}
        data-testid={testID}
        className={className}
        {...restProps}
      >
        {children}
      </StyledBadge>
    );
  }
);

Badge.displayName = "Badge";
