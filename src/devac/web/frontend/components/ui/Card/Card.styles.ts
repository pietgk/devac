/**
 * Card Styled Components
 *
 * Ported from @mindlercare/mindlerui/Card patterns
 * Adapted for web with styled-components v6
 */

import styled, { css } from "styled-components";
import type { CardVariant } from "./Card.types";

export const StyledCard = styled.div<{
  $variant: CardVariant;
  $interactive: boolean;
}>`
  /* Base styles */
  display: flex;
  flex-direction: column;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  padding: ${({ theme }) => theme.spacing.m}px;
  transition: all ${({ theme }) => theme.transition.standard};
  position: relative;

  /* Variant styles */
  ${({ $variant, theme }) => {
    switch ($variant) {
      case "default":
        return css`
          background: ${theme.colors.warmLight};
          border: 1px solid transparent;
        `;

      case "elevated":
        return css`
          background: ${theme.colors.white};
          box-shadow: ${theme.shadow.card};
          border: 1px solid transparent;
        `;

      case "outlined":
        return css`
          background: ${theme.colors.white};
          border: 1px solid ${theme.colors.grayMedium};
        `;

      default:
        return css``;
    }
  }}

  /* Interactive styles */
  ${({ $interactive, theme }) =>
    $interactive &&
    css`
      cursor: pointer;
      user-select: none;

      &:hover {
        transform: translateY(-2px);
        box-shadow: ${theme.shadow.elevated};
      }

      &:active {
        transform: translateY(0);
      }

      &:focus-visible {
        outline: none;
        box-shadow: ${theme.shadow.focus};
      }
    `}
`;

export const CardHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs}px;
  margin-bottom: ${({ theme }) => theme.spacing.m}px;
`;

export const CardTitle = styled.h3`
  margin: 0;
  font-size: ${({ theme }) => theme.font.size.large};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.black};
  line-height: ${({ theme }) => theme.font.lineHeight.snug};
`;

export const CardDescription = styled.p`
  margin: 0;
  font-size: ${({ theme }) => theme.font.size.small};
  color: ${({ theme }) => theme.colors.gray};
  line-height: ${({ theme }) => theme.font.lineHeight.normal};
`;

export const CardContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.s}px;
`;

export const CardFooter = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.s}px;
  margin-top: ${({ theme }) => theme.spacing.m}px;
  padding-top: ${({ theme }) => theme.spacing.m}px;
  border-top: 1px solid ${({ theme }) => theme.colors.grayLight};
`;
