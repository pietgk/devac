# UI Generator CLI

**Mindler Open Code** component generator for DevAC.

## Philosophy: "Open Code"

Instead of npm installing UI components as packages, you **copy them into your codebase** and own them completely. This gives you:

- ✅ Full customization without fighting abstractions
- ✅ No breaking changes from library updates
- ✅ Zero dependency hell
- ✅ AI-readable source code
- ✅ Complete control over your UI

## Usage

### List Available Components

```bash
npx tsx src/devac/ui-gen/cli.ts list
```

### Copy a Single Component

```bash
npx tsx src/devac/ui-gen/cli.ts add Button
npx tsx src/devac/ui-gen/cli.ts add Card
npx tsx src/devac/ui-gen/cli.ts add Badge
```

### Copy All Components

```bash
npx tsx src/devac/ui-gen/cli.ts add-all
```

### Options

- `--path <path>` - Specify target directory (default: `./src/devac/web/frontend/components/ui`)
- `--force` - Overwrite existing components

## What Gets Copied

Each component includes:
- `ComponentName.tsx` - React component
- `ComponentName.styles.ts` - Styled components
- `ComponentName.types.ts` - TypeScript types
- `index.ts` - Public exports

Plus the complete `theme/` system with design tokens.

## After Copying

1. **Import** the component:
   ```typescript
   import { Button } from "@/components/ui/Button";
   ```

2. **Customize** freely:
   - Modify styles in `.styles.ts`
   - Add new variants
   - Change behavior
   - No limitations!

3. **Own it**: This is YOUR code now. Update it however you need.

## Example Workflow

```bash
# 1. Copy Button component
npx tsx src/devac/ui-gen/cli.ts add Button

# 2. Use it in your code
# src/devac/web/frontend/components/ServiceCard.tsx
import { Button } from "@/components/ui/Button";

export function ServiceCard() {
  return <Button variant="primary">Start Service</Button>;
}

# 3. Customize it (optional)
# Edit src/devac/web/frontend/components/ui/Button/Button.styles.ts
# Add your own variants, colors, whatever you need!
```

## Benefits Over npm Packages

| Traditional Package | Open Code |
|---------------------|-----------|
| `npm install ui-lib` | `npx tsx ui-gen add Button` |
| Fight with theme config | Edit styles directly |
| Breaking changes on upgrade | Never breaks (you own it) |
| Bundle entire library | Only what you use |
| Black box for AI | Full source visibility |

## Components Available

- **Button** - Premium button with variants, sizes, loading
- **Card** - Flexible card with header, content, footer
- **Badge** - Status badges with semantic colors
- **Text** - Typography with semantic variants
- **theme** - Complete design token system

## Source

Components are extracted from `@mindlercare/mindlerui` (production mobile app) and adapted for web with styled-components v6.

Quality: Production-proven, accessibility-tested, design-token driven.
