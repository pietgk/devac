/**
 * Design Tokens - Extracted from @mindlercare/mindlerui-style
 * Source: app/mindlerui-style/style/purple-theme-constants.ts
 *
 * These tokens are auto-generated from Figma via token-transformer + style-dictionary
 * and represent Mindler's production design system.
 */

export const tokens = {
  colors: {
    // Primary brand colors
    primary: "#F0AFFA",
    primaryLight: "#F8CBFF",
    primaryXLight: "#FDEBFF",
    primaryDark: "#49125c",

    // Secondary colors
    orange: "#FFC77D",
    orangeDark: "#FAA746",
    yellow: "#FFEC64",
    blue: "#BBECFF",

    // Neutral colors
    black: "#1D1B1B",
    white: "#FFFFFF",

    // Gray scale
    grayBlack: "#1D1B1B",
    grayDark: "#373737",
    gray: "#656565",
    grayMedium: "#C7C7C7",
    grayLight: "#E6E6E6",
    grayXLight: "#F5F3F3",
    grayWhite: "#FFFFFF",

    // Warm neutrals
    warmLight: "#F2F0E9",
    warm: "#EDE9E1",

    // Semantic colors
    error: "#B11500",
    success: "#00805E",
    warning: "#FEC229",
    info: "#4298F7",

    // Card shadow
    cardShadow: "#76747226",
  },

  spacing: {
    xxs: 2,
    xs: 4,
    s: 8,
    m: 16,
    l: 24,
    xl: 32,
    xxl: 48,
  },

  borderRadius: {
    small: 4,
    medium: 8,
    large: 12,
    xlarge: 16,
    full: 9999,
  },

  font: {
    family: {
      body: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      headers: "InterDisplay, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      mono: "Monaco, Menlo, 'Courier New', monospace",
    },
    size: {
      xxs: "0.75rem",    // 12px
      xs: "0.875rem",     // 14px
      small: "1rem",      // 16px
      standard: "1.0625rem", // 17px
      medium: "1.125rem", // 18px
      large: "1.25rem",   // 20px
      xl: "1.5rem",       // 24px
      xxl: "1.75rem",     // 28px
      xxxl: "2rem",       // 32px
    },
    weight: {
      regular: "400",
      medium: "500",
      semibold: "600",
      bold: "700",
    },
    lineHeight: {
      tight: 1.15,
      snug: 1.25,
      normal: 1.4,
      relaxed: 1.6,
    },
  },

  breakpoints: {
    mobile: "480px",
    tablet: "768px",
    desktop: "1024px",
    wide: "1440px",
  },

  shadow: {
    card: "0 2px 12px 0 rgba(118, 116, 114, 0.15)",
    elevated: "0 4px 24px 0 rgba(118, 116, 114, 0.2)",
    focus: "0 0 0 3px rgba(240, 175, 250, 0.3)",
  },

  transition: {
    fast: "0.15s ease-in-out",
    standard: "0.2s ease-in-out",
    slow: "0.3s ease-in-out",
  },

  zIndex: {
    base: 0,
    dropdown: 1000,
    sticky: 1020,
    fixed: 1030,
    modal: 1040,
    popover: 1050,
    tooltip: 1060,
  },
} as const;

export type Tokens = typeof tokens;
