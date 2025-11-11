# @devac/ui-primitives

Mindler Open Code UI primitives for DevAC.

## Philosophy: "Open Code" - You Own Your Components

This package follows the **shadcn/ui philosophy**: components are **copied into your project**, not installed as npm dependencies. You own the code and can customize it freely.

## Components

Extracted from `@mindlercare/mindlerui` and adapted for web:

- **Button** - Premium button with variants, sizes, loading states
- **Card** - Flexible card component with variants
- **Badge** - Status badges with semantic colors
- **Text** - Typography component with semantic variants

## Usage

Use the `ui-gen` CLI to copy components into your project:

```bash
npx tsx src/devac/ui-gen/cli.ts add Button
```

This copies the component source into your `src/devac/web/frontend/components/ui/` directory.

## Design Tokens

All styling is driven by design tokens extracted from mindlerui's Figma-based design system:

- Colors from `@mindlercare/mindlerui-style`
- Spacing, typography, and other tokens
- Fully customizable via theme provider

## Architecture

```
packages/ui-primitives/
├── src/
│   ├── Button/
│   │   ├── Button.tsx         # Component logic
│   │   ├── Button.styles.ts   # Styled components
│   │   ├── Button.types.ts    # TypeScript types
│   │   └── index.ts           # Public exports
│   ├── theme/
│   │   ├── tokens.ts          # Design tokens
│   │   ├── createTheme.ts     # Theme factory
│   │   └── types.ts           # Theme types
│   └── index.ts               # Package exports
```

## Future: Universal (Web + Native)

This architecture is designed to support React Native in the future by adding `.native.tsx` variants alongside `.tsx` files.
