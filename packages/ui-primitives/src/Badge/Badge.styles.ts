/**
 * Badge Styled Components
 *
 * Ported from @mindlercare/mindlerui/Badge patterns
 * Adapted for web with styled-components v6
 */

import styled, { css } from "styled-components";
import type { BadgeVariant, BadgeSize } from "./Badge.types";

export const StyledBadge = styled.span<{
  $variant: BadgeVariant;
  $size: BadgeSize;
}>`
  /* Base styles */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: ${({ theme }) => theme.font.family.body};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  border-radius: ${({ theme }) => theme.borderRadius.full}px;
  white-space: nowrap;
  line-height: 1;
  transition: all ${({ theme }) => theme.transition.fast};

  /* Size variants */
  ${({ $size, theme }) => {
    switch ($size) {
      case "sm":
        return css`
          padding: 4px 8px;
          font-size: ${theme.font.size.xxs};
          height: 20px;
        `;
      case "lg":
        return css`
          padding: 8px 16px;
          font-size: ${theme.font.size.small};
          height: 32px;
        `;
      case "md":
      default:
        return css`
          padding: 6px 12px;
          font-size: ${theme.font.size.xs};
          height: 24px;
        `;
    }
  }}

  /* Color variants - semantic colors for status */
  ${({ $variant, theme }) => {
    switch ($variant) {
      case "primary":
        return css`
          background: ${theme.colors.primaryLight};
          color: ${theme.colors.primaryDark};
          border: 1px solid ${theme.colors.primary};
        `;

      case "secondary":
        return css`
          background: ${theme.colors.grayXLight};
          color: ${theme.colors.grayDark};
          border: 1px solid ${theme.colors.grayMedium};
        `;

      case "success":
        return css`
          background: rgba(0, 128, 94, 0.1);
          color: ${theme.colors.success};
          border: 1px solid ${theme.colors.success};
        `;

      case "warning":
        return css`
          background: rgba(254, 194, 41, 0.1);
          color: #b8890a;
          border: 1px solid ${theme.colors.warning};
        `;

      case "error":
        return css`
          background: rgba(177, 21, 0, 0.1);
          color: ${theme.colors.error};
          border: 1px solid ${theme.colors.error};
        `;

      case "info":
        return css`
          background: rgba(66, 152, 247, 0.1);
          color: ${theme.colors.info};
          border: 1px solid ${theme.colors.info};
        `;

      case "default":
      default:
        return css`
          background: ${theme.colors.grayLight};
          color: ${theme.colors.black};
          border: 1px solid ${theme.colors.grayMedium};
        `;
    }
  }}
`;
