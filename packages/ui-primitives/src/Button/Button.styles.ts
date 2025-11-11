/**
 * Button Styled Components
 *
 * Ported from @mindlercare/mindlerui/Button patterns
 * Adapted for web with styled-components v6
 */

import styled, { css, keyframes } from "styled-components";
import type { ButtonVariant, ButtonSize } from "./Button.types";

const spin = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`;

export const StyledButton = styled.button<{
  $variant: ButtonVariant;
  $size: ButtonSize;
  $loading: boolean;
}>`
  /* Reset */
  border: none;
  outline: none;
  background: none;
  padding: 0;
  margin: 0;
  font: inherit;
  cursor: pointer;

  /* Base styles */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.s}px;
  font-family: ${({ theme }) => theme.font.family.body};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  border-radius: ${({ theme }) => theme.borderRadius.full}px;
  transition: all ${({ theme }) => theme.transition.standard};
  position: relative;
  white-space: nowrap;
  user-select: none;
  border: 1px solid transparent;

  /* Size variants */
  ${({ $size, theme }) => {
    if ($size === "xs") {
      return css`
        padding: 10px 16px;
        font-size: ${theme.font.size.xs};
        height: 36px;
      `;
    }
    if ($size === "s") {
      return css`
        padding: 14px 20px;
        font-size: ${theme.font.size.small};
        height: 40px;
      `;
    }
    // medium (default)
    return css`
      padding: 17px 24px;
      font-size: ${theme.font.size.standard};
      height: 48px;
    `;
  }}

  /* Color variants - from mindlerui production patterns */
  ${({ $variant, theme }) => {
    switch ($variant) {
      case "primary":
        return css`
          background: ${theme.colors.primary};
          color: ${theme.colors.black};

          &:hover:not(:disabled) {
            background: ${theme.colors.primaryDark};
          }

          &:active:not(:disabled) {
            transform: scale(0.98);
          }
        `;

      case "secondary":
        return css`
          background: ${theme.colors.white};
          color: ${theme.colors.black};
          border-color: ${theme.colors.grayMedium};

          &:hover:not(:disabled) {
            border-color: ${theme.colors.gray};
            background: ${theme.colors.grayXLight};
          }
        `;

      case "white":
        return css`
          background: ${theme.colors.white};
          color: ${theme.colors.black};
          border-color: ${theme.colors.grayMedium};

          &:hover:not(:disabled) {
            background: ${theme.colors.grayXLight};
          }
        `;

      case "black":
        return css`
          background: ${theme.colors.black};
          color: ${theme.colors.white};

          &:hover:not(:disabled) {
            background: ${theme.colors.grayDark};
          }
        `;

      case "grey":
        return css`
          background: ${theme.colors.grayXLight};
          color: ${theme.colors.black};

          &:hover:not(:disabled) {
            background: ${theme.colors.grayLight};
          }
        `;

      case "transparent":
        return css`
          background: transparent;
          color: ${theme.colors.black};
          border-color: ${theme.colors.black};

          &:hover:not(:disabled) {
            background: rgba(29, 27, 27, 0.04);
          }
        `;

      case "link":
        return css`
          background: transparent;
          color: ${theme.colors.black};
          text-decoration: underline;
          padding: 0;
          height: auto;

          &:hover:not(:disabled) {
            color: ${theme.colors.grayDark};
          }
        `;

      default:
        return css``;
    }
  }}

  /* Disabled state */
  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* Loading state */
  ${({ $loading }) =>
    $loading &&
    css`
      cursor: wait;
      opacity: 0.7;
    `}

  /* Focus styles */
  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadow.focus};
  }

  /* Icon spacing */
  .button-icon {
    display: inline-flex;
    align-items: center;
  }
`;

export const LoadingSpinner = styled.div`
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ${spin} 0.6s linear infinite;
`;

export const ButtonContent = styled.span<{ $loading: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs}px;

  ${({ $loading }) =>
    $loading &&
    css`
      opacity: 0;
    `}
`;

export const LoadingWrapper = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
`;
