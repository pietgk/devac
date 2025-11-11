# UI Generator CLI Reference

**Complete guide to the `ui-gen` component generator tool**

The `ui-gen` CLI is a command-line tool that enables the "Open Code" workflow by copying components from `@devac/ui-primitives` into your project. Once copied, you own the code and can customize it freely.

---

## Quick Start

```bash
# List all available components
npm run ui-gen list

# Add a single component
npm run ui-gen add Button

# Add all components
npm run ui-gen add-all
```

---

## Installation

The CLI is already configured in the CodeGraph project. It's defined in `src/devac/ui-gen/cli.ts` and registered in `package.json`:

```json
{
  "scripts": {
    "ui-gen": "tsx src/devac/ui-gen/cli.ts"
  }
}
```

**Dependencies**: The CLI uses `fs-extra` for file operations and `commander` for command parsing.

---

## Commands

### `list` - Show Available Components

Lists all components available in the primitives library.

**Usage**:
```bash
npm run ui-gen list
```

**Output**:
```
📦 Available UI Components:

✨ Button     - Premium button with 7 variants, loading states
✨ Card       - Flexible card with Header, Content, Footer
✨ Badge      - Status badges with 7 semantic colors
✨ Text       - Typography system with 11 semantic variants

💡 Usage:
   npm run ui-gen add <component>     Add a single component
   npm run ui-gen add-all             Add all components
```

**What it shows**:
- Component names
- Brief descriptions
- Usage instructions

---

### `add <component>` - Add Single Component

Copies a single component from the primitives library into your project.

**Usage**:
```bash
npm run ui-gen add <component> [options]
```

**Arguments**:
- `<component>` - Name of the component to add (e.g., `Button`, `Card`, `Badge`, `Text`)

**Options**:
- `-p, --path <path>` - Target directory (default: `./src/devac/web/frontend/components/ui`)
- `-f, --force` - Overwrite existing component without prompting

**Examples**:

```bash
# Add Button component to default location
npm run ui-gen add Button

# Add Card component to custom directory
npm run ui-gen add Card --path ./components/ui

# Force overwrite existing Badge component
npm run ui-gen add Badge --force
```

**What it does**:
1. Checks if component exists in primitives library
2. Checks if component already exists in target directory
3. Prompts for confirmation if component exists (unless `--force`)
4. Copies the entire component folder:
   - `ComponentName.tsx` - Main component file
   - `ComponentName.styles.ts` - Styled components
   - `index.ts` - Public exports
   - `README.md` - Component documentation (if exists)
5. Shows success message with next steps

**Success Output**:
```
✅ Successfully copied Button to src/devac/web/frontend/components/ui/Button

📝 Next steps:
   1. Import: import { Button } from "@/components/ui/Button"
   2. Customize styles in Button.styles.ts if needed
   3. You now own this component! ✨

💡 The component is copied, not linked. Modify it as needed!
```

**Error Handling**:
- If component doesn't exist: Shows error with available components
- If target exists without `--force`: Prompts for confirmation
- If file system errors: Shows detailed error message

---

### `add-all` - Add All Components

Copies all available components from the primitives library into your project.

**Usage**:
```bash
npm run ui-gen add-all [options]
```

**Options**:
- `-p, --path <path>` - Target directory (default: `./src/devac/web/frontend/components/ui`)
- `-f, --force` - Overwrite existing components without prompting

**Examples**:

```bash
# Add all components to default location
npm run ui-gen add-all

# Add all components to custom directory
npm run ui-gen add-all --path ./components/ui

# Force overwrite all existing components
npm run ui-gen add-all --force
```

**What it does**:
1. Reads all folders from `packages/ui-primitives/src/`
2. Filters to only component folders (excludes `theme`, `utils`, etc.)
3. For each component:
   - Checks if it already exists
   - Prompts for confirmation if exists (unless `--force`)
   - Copies the component
4. Shows summary of all copied components

**Success Output**:
```
✅ Successfully copied 4 components:
   - Button
   - Card
   - Badge
   - Text

📝 Next steps:
   1. Import components from @/components/ui/<ComponentName>
   2. Customize any component as needed
   3. You now own all these components! ✨

💡 Components are copied, not linked. Modify them freely!
```

---

## File Structure

After adding components, your project structure will look like:

```
src/devac/web/frontend/components/ui/
├── Button/
│   ├── Button.tsx              # Component implementation
│   ├── Button.styles.ts        # Styled components
│   └── index.ts                # Public exports
├── Card/
│   ├── Card.tsx
│   ├── Card.styles.ts
│   └── index.ts
├── Badge/
│   ├── Badge.tsx
│   ├── Badge.styles.ts
│   └── index.ts
└── Text/
    ├── Text.tsx
    ├── Text.styles.ts
    └── index.ts
```

**Each component folder contains**:
- **`.tsx` file** - React component with full TypeScript types
- **`.styles.ts` file** - styled-components styling (if component uses styles)
- **`index.ts` file** - Public exports (component, types, sub-components)

---

## Import Patterns

After adding components, import them using path aliases:

```typescript
// Import main component
import { Button } from "@/components/ui/Button";

// Import with types
import { Card, type CardProps } from "@/components/ui/Card";

// Import sub-components
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
```

**Path alias setup** (in `tsconfig.json`):
```json
{
  "compilerOptions": {
    "paths": {
      "@/components/*": ["./src/devac/web/frontend/components/*"]
    }
  }
}
```

---

## Common Workflows

### Workflow 1: Starting a New Project

```bash
# 1. Add all components at once
npm run ui-gen add-all

# 2. Start using them immediately
# (They're already integrated with your theme)
```

### Workflow 2: Adding Components as Needed

```bash
# 1. Check what's available
npm run ui-gen list

# 2. Add only what you need
npm run ui-gen add Button
npm run ui-gen add Card

# 3. Customize the copied components
# (Edit the files directly in your project)
```

### Workflow 3: Updating After Customization

```bash
# 1. See what's new in primitives library
# (Check packages/ui-primitives/src/)

# 2. Add new components (won't affect existing)
npm run ui-gen add NewComponent

# 3. Force update a component (overwrites your changes)
npm run ui-gen add Button --force

# ⚠️  Use --force carefully! It will overwrite your customizations
```

### Workflow 4: Updating Component from Primitives

If you want to pull in updates from the primitives library while preserving your customizations:

```bash
# 1. Backup your customizations
cp src/devac/web/frontend/components/ui/Button/Button.tsx Button.backup.tsx

# 2. Force update the component
npm run ui-gen add Button --force

# 3. Manually merge your customizations back
# (Compare Button.backup.tsx with the new Button.tsx)
```

**Better approach**: Use version control to see diffs:

```bash
# 1. Commit your current customizations
git add src/devac/web/frontend/components/ui/Button
git commit -m "feat: customized Button component"

# 2. Update the component
npm run ui-gen add Button --force

# 3. Review changes and merge
git diff src/devac/web/frontend/components/ui/Button
git add -p  # Selectively stage changes

# 4. Keep your customizations + new features
git commit -m "feat: update Button from primitives + keep customizations"
```

---

## Troubleshooting

### Error: "Component not found"

**Problem**: Component doesn't exist in primitives library.

**Solution**:
```bash
# Check available components
npm run ui-gen list

# Use exact component name (case-sensitive)
npm run ui-gen add Button  # ✅ Correct
npm run ui-gen add button  # ❌ Wrong
```

---

### Error: "Component already exists"

**Problem**: Component already exists in target directory.

**Solution 1** - Let CLI prompt you:
```bash
npm run ui-gen add Button
# CLI will ask: "Component already exists. Overwrite? (y/N)"
```

**Solution 2** - Force overwrite:
```bash
npm run ui-gen add Button --force
```

**Solution 3** - Add to different directory:
```bash
npm run ui-gen add Button --path ./other-components/ui
```

---

### Error: "Cannot find package 'fs-extra'"

**Problem**: Missing dependency.

**Solution**:
```bash
npm install --save-dev fs-extra @types/fs-extra --legacy-peer-deps
```

---

### Error: "Permission denied"

**Problem**: No write permissions for target directory.

**Solution**:
```bash
# Check directory permissions
ls -la src/devac/web/frontend/components/

# Fix permissions (if needed)
chmod -R u+w src/devac/web/frontend/components/ui
```

---

### Import errors after adding component

**Problem**: TypeScript can't find the component.

**Solution**: Check path aliases in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/components/*": ["./src/devac/web/frontend/components/*"]
    }
  }
}
```

Then restart your TypeScript server:
- **VS Code**: `Cmd+Shift+P` → "TypeScript: Restart TS Server"
- **Other editors**: Restart the editor

---

### Styled components errors

**Problem**: `styled-components` types or runtime errors.

**Solution**: Ensure styled-components v6 is installed:

```bash
npm install styled-components@^6.1.19
npm install --save-dev @types/styled-components
```

Check theme provider is set up:

```typescript
// App.tsx
import { ThemeProvider } from "styled-components";
import { theme } from "@/theme";

function App() {
  return (
    <ThemeProvider theme={theme}>
      {/* Your app */}
    </ThemeProvider>
  );
}
```

---

## Advanced Usage

### Custom Target Directory

Add components to a different directory:

```bash
npm run ui-gen add Button --path ./lib/ui
npm run ui-gen add-all --path ./shared/components
```

### Selective Component Updates

Update only specific components:

```bash
# Update only Button and Card
npm run ui-gen add Button --force
npm run ui-gen add Card --force

# Badge and Text remain unchanged (with your customizations)
```

### Integration with Build Tools

Add to your build scripts:

```json
{
  "scripts": {
    "setup:ui": "npm run ui-gen add-all",
    "update:ui": "npm run ui-gen add-all --force",
    "dev": "npm run setup:ui && next dev"
  }
}
```

---

## CLI Architecture

Understanding how the CLI works helps with troubleshooting and customization.

### Source Location

```
src/devac/ui-gen/
├── cli.ts              # Main CLI entry point
└── index.ts            # Exports (if needed)
```

### How It Works

1. **Component Discovery**: Reads `packages/ui-primitives/src/` directory
2. **File Copying**: Uses `fs-extra.copy()` for recursive copying
3. **Interactive Prompts**: Uses `commander` for CLI interface
4. **Error Handling**: Validates paths and permissions before copying

### Extending the CLI

Add new commands in `cli.ts`:

```typescript
program
  .command("init")
  .description("Initialize UI components with theme setup")
  .action(async () => {
    // Copy theme files
    // Create ThemeProvider wrapper
    // Generate example page
  });
```

---

## FAQ

**Q: What happens if I modify a component and then run `ui-gen add` again?**

A: The CLI will detect the existing component and prompt you to confirm overwriting. Your changes will be lost if you confirm (or use `--force`). Use version control to preserve customizations.

**Q: Can I use the CLI in CI/CD pipelines?**

A: Yes! Use `--force` to skip prompts:
```bash
npm run ui-gen add-all --force
```

**Q: Do I need to run `ui-gen` every time I start development?**

A: No. Components are copied once. They become part of your project's source code. Only run `ui-gen` when:
- Adding new components
- Updating components from primitives
- Setting up a new development environment

**Q: Can I add the same component to multiple directories?**

A: Yes! Use different `--path` values:
```bash
npm run ui-gen add Button --path ./components/ui
npm run ui-gen add Button --path ./admin/components/ui
```

**Q: How do I know what changed in the primitives library?**

A: Check the git history of `packages/ui-primitives/`:
```bash
cd packages/ui-primitives
git log --oneline -- src/
```

**Q: Can I contribute components back to primitives?**

A: Yes! If you create a new component or improve an existing one:
1. Copy it to `packages/ui-primitives/src/`
2. Follow the extraction guide (see PRIMITIVES_GUIDE.md)
3. Submit a PR with the new component

---

## Related Documentation

- **[PRIMITIVES_GUIDE.md](./PRIMITIVES_GUIDE.md)** - How to extract new components from mindlerui
- **[COMPONENT_OWNERSHIP.md](./COMPONENT_OWNERSHIP.md)** - Philosophy behind "Open Code"
- **[CUSTOMIZATION_GUIDE.md](./CUSTOMIZATION_GUIDE.md)** - How to modify owned components
- **[UNIVERSAL_ROADMAP.md](./UNIVERSAL_ROADMAP.md)** - Future: web + native support

---

## Summary

The `ui-gen` CLI enables the "Open Code" workflow:

1. **Copy**: Components are copied into your project
2. **Own**: You have full control over the code
3. **Customize**: Modify freely without worrying about breaking upstream
4. **Update**: Pull in updates when you want them

**Key Commands**:
```bash
npm run ui-gen list        # See what's available
npm run ui-gen add Button  # Add a component
npm run ui-gen add-all     # Add everything
```

**Remember**: Copied components are yours. Version control your customizations, and merge updates carefully!
