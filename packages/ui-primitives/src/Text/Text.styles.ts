/**
 * Text Styled Components
 *
 * Ported from @mindlercare/mindlerui/Text patterns
 * Adapted for web with styled-components v6
 */

import styled, { css } from "styled-components";
import type { TextVariant, TextColor, TextAlign } from "./Text.types";

export const StyledText = styled.span<{
  $variant: TextVariant;
  $color: TextColor;
  $align?: TextAlign;
  $weight?: string;
  $truncate?: boolean;
  $lines?: number;
}>`
  /* Base styles */
  margin: 0;
  font-family: ${({ theme }) => theme.font.family.body};
  color: ${({ theme }) => theme.colors.black};
  line-height: ${({ theme }) => theme.font.lineHeight.normal};

  /* Variant styles */
  ${({ $variant, theme }) => {
    switch ($variant) {
      case "h1":
        return css`
          font-size: ${theme.font.size.xxxl};
          font-weight: ${theme.font.weight.bold};
          line-height: ${theme.font.lineHeight.tight};
          font-family: ${theme.font.family.headers};
        `;
      case "h2":
        return css`
          font-size: ${theme.font.size.xxl};
          font-weight: ${theme.font.weight.bold};
          line-height: ${theme.font.lineHeight.tight};
          font-family: ${theme.font.family.headers};
        `;
      case "h3":
        return css`
          font-size: ${theme.font.size.xl};
          font-weight: ${theme.font.weight.semibold};
          line-height: ${theme.font.lineHeight.snug};
          font-family: ${theme.font.family.headers};
        `;
      case "h4":
        return css`
          font-size: ${theme.font.size.large};
          font-weight: ${theme.font.weight.semibold};
          line-height: ${theme.font.lineHeight.snug};
        `;
      case "h5":
        return css`
          font-size: ${theme.font.size.medium};
          font-weight: ${theme.font.weight.semibold};
          line-height: ${theme.font.lineHeight.snug};
        `;
      case "h6":
        return css`
          font-size: ${theme.font.size.small};
          font-weight: ${theme.font.weight.semibold};
          line-height: ${theme.font.lineHeight.snug};
        `;
      case "bodyLarge":
        return css`
          font-size: ${theme.font.size.medium};
          font-weight: ${theme.font.weight.regular};
        `;
      case "bodySmall":
        return css`
          font-size: ${theme.font.size.xs};
          font-weight: ${theme.font.weight.regular};
        `;
      case "caption":
        return css`
          font-size: ${theme.font.size.xxs};
          font-weight: ${theme.font.weight.regular};
          color: ${theme.colors.gray};
        `;
      case "label":
        return css`
          font-size: ${theme.font.size.xs};
          font-weight: ${theme.font.weight.medium};
          text-transform: uppercase;
          letter-spacing: 0.05em;
        `;
      case "body":
      default:
        return css`
          font-size: ${theme.font.size.small};
          font-weight: ${theme.font.weight.regular};
        `;
    }
  }}

  /* Color variants */
  ${({ $color, theme }) => {
    switch ($color) {
      case "muted":
        return css`
          color: ${theme.colors.gray};
        `;
      case "primary":
        return css`
          color: ${theme.colors.primary};
        `;
      case "error":
        return css`
          color: ${theme.colors.error};
        `;
      case "success":
        return css`
          color: ${theme.colors.success};
        `;
      case "warning":
        return css`
          color: ${theme.colors.warning};
        `;
      case "default":
      default:
        return css``;
    }
  }}

  /* Text alignment */
  ${({ $align }) =>
    $align &&
    css`
      text-align: ${$align};
    `}

  /* Font weight override */
  ${({ $weight, theme }) =>
    $weight &&
    css`
      font-weight: ${theme.font.weight[$weight as keyof typeof theme.font.weight]};
    `}

  /* Truncation */
  ${({ $truncate, $lines }) => {
    if ($truncate && $lines && $lines > 1) {
      return css`
        display: -webkit-box;
        -webkit-line-clamp: ${$lines};
        -webkit-box-orient: vertical;
        overflow: hidden;
      `;
    }
    if ($truncate) {
      return css`
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `;
    }
    return css``;
  }}
`;
