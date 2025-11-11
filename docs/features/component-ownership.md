# Component Ownership: Philosophy and Practices

**The "Open Code" Manifesto for DevAC**

---

## Core Philosophy

> **"You don't npm install components. You copy them into your codebase and own them completely."**

This document explains why we chose the "Open Code" approach (inspired by shadcn/ui) and how to practice it effectively.

---

## Why "Open Code"?

### The Traditional Problem

**Traditional component libraries (Material-UI, Chakra, etc.):**

```bash
npm install ui-library
```

**What you get:**
- ❌ Black box in node_modules
- ❌ Limited customization via theme config
- ❌ Breaking changes on updates
- ❌ Entire library bundled (bloat)
- ❌ Fight with abstractions
- ❌ AI can't see the source

**Example frustration:**
```typescript
// You want to add a new button variant
// But the library only supports 3 variants
// Your options:
// 1. Fork the entire library (nightmare)
// 2. Create wrapper components (hacky)
// 3. Give up and use what they provide (limiting)
```

### The Open Code Solution

**Our approach:**

```bash
npx tsx src/devac/ui-gen/cli.ts add Button
```

**What you get:**
- ✅ Full source code in your repo
- ✅ Infinite customization
- ✅ Never breaks (you control updates)
- ✅ Only what you use (optimal bundle)
- ✅ Edit directly (no wrappers)
- ✅ AI can read and modify

**Example freedom:**
```typescript
// Want a new variant? Just add it!
// Edit: src/devac/web/frontend/components/ui/Button/Button.styles.ts

${({ $variant, theme }) => {
  if ($variant === "success") {
    return css`
      background: green;
      color: white;
    `;
  }
}}
```

**Done. No pull request. No waiting. No fighting with maintainers.**

---

## The Three Principles

### 1. Copy, Don't Install

**Traditional:**
```json
{
  "dependencies": {
    "ui-library": "^2.0.0"  // Hope it doesn't break
  }
}
```

**Open Code:**
```
src/devac/web/frontend/components/ui/
├── Button/
│   ├── Button.tsx         ← YOUR CODE
│   ├── Button.styles.ts   ← YOUR STYLES
│   └── Button.types.ts    ← YOUR TYPES
```

**Benefit:** You own every line. No external dependencies.

### 2. Customize Freely

**Traditional:**
```typescript
// Limited to theme API
<Button 
  sx={{ 
    backgroundColor: 'blue',  // Fighting the system
    '&:hover': { ... }        // Hacky overrides
  }}
/>
```

**Open Code:**
```typescript
// Edit Button.styles.ts directly
export const StyledButton = styled.button`
  background: blue;  // Just CSS
  &:hover {
    background: darkblue;
  }
`;
```

**Benefit:** Direct access. No limitations. Clean code.

### 3. Update on Your Terms

**Traditional:**
```bash
npm update ui-library
# 💥 Breaking changes!
# 💥 Your app breaks!
# 💥 Hours debugging!
```

**Open Code:**
```bash
# Components never break (you don't update them automatically)
# Want new features? Copy updated component selectively
npx tsx ui-gen/cli.ts add Button --force
# Review diff, merge what you want
```

**Benefit:** Control. Stability. No surprises.

---

## Ownership Practices

### Practice 1: Treat Components as Your Code

**Do:**
- ✅ Edit styles directly
- ✅ Add new props
- ✅ Remove unused features
- ✅ Refactor for your needs
- ✅ Optimize for your use case

**Don't:**
- ❌ Treat as "library code" you can't touch
- ❌ Create wrapper components to avoid editing
- ❌ Keep unused code "just in case"

**Example - Adding Custom Prop:**
```typescript
// Edit Button.types.ts
export interface ButtonProps {
  // ... existing props
  dataLayer?: string;  // Add custom analytics prop
}

// Edit Button.tsx
<StyledButton
  data-analytics={dataLayer}  // Use it
  {...restProps}
>
```

**No permission needed. It's YOUR code.**

### Practice 2: Document Your Changes

When you customize a component, document why:

```typescript
// Button.styles.ts

// CUSTOMIZATION: Added 'gradient' variant for hero CTAs
// Date: 2025-11-11
// Author: DevAC Team
${({ $variant }) => {
  if ($variant === "gradient") {
    return css`
      background: linear-gradient(45deg, purple, pink);
      // Custom variant for marketing pages
    `;
  }
}}
```

**Why:** Future you (or team members) will thank you.

### Practice 3: Selective Updates

When primitives package updates:

```bash
# 1. Check what changed
git diff packages/ui-primitives/src/Button/

# 2. If you want the update:
npx tsx ui-gen/cli.ts add Button --force

# 3. Review diff in your project
git diff src/devac/web/frontend/components/ui/Button/

# 4. Merge or reject changes
git checkout -- Button.styles.ts  # Keep your custom styles
# OR
git add Button.tsx  # Accept new features
```

**You control what changes. Always.**

### Practice 4: Share Patterns, Not Packages

**Traditional:** Publish internal package, force everyone to use same version

**Open Code:** Share extraction patterns and let teams own

```bash
# Team A wants Button
npx tsx ui-gen/cli.ts add Button
# They customize for their needs

# Team B wants Button  
npx tsx ui-gen/cli.ts add Button
# They customize differently

# Both are happy. No conflicts.
```

---

## Real-World Scenarios

### Scenario 1: Need a New Variant

**Requirement:** "We need a destructive button variant for delete actions"

**Traditional Approach (40 minutes):**
1. Check if library supports it (5 min)
2. Realize it doesn't (frustrated)
3. Search docs for customization (10 min)
4. Try theme overrides (fails)
5. Create wrapper component (15 min)
6. Write hacky CSS (10 min)
7. Result: Messy code, not ideal

**Open Code Approach (5 minutes):**
1. Edit `Button.styles.ts`
2. Add variant case:
```typescript
if ($variant === "destructive") {
  return css`
    background: ${theme.colors.error};
    color: white;
    &:hover {
      background: #a01300;
    }
  `;
}
```
3. Done. Clean code. Perfect result.

### Scenario 2: Breaking Change in Library

**Situation:** Library updates and breaks your app

**Traditional (3 hours debugging):**
- Library changed Button API
- Your app has 50 Button uses
- Must update all callsites
- Or stay on old version (miss new features)
- Or write migration script
- Pain.

**Open Code (0 minutes):**
- Your Button never changes unless YOU change it
- Library updates don't affect you
- If you want new features, review and selectively adopt
- Zero breakage. Ever.

### Scenario 3: AI Assistance

**Task:** "AI, make all buttons slightly larger"

**Traditional:**
```
AI: "I cannot modify the button component as it's in node_modules"
You: "Okay, how do I override with theme?"
AI: "Try theme.components.Button.sizes... but it's complex"
You: "This is frustrating"
```

**Open Code:**
```
AI: "I'll edit Button.styles.ts for you"
[AI modifies your source file directly]
You: "Perfect, thank you!"
```

**Why it works:** AI can see and modify YOUR source code, not black box packages.

---

## Ownership Anti-Patterns

### ❌ Anti-Pattern 1: Not Customizing

```typescript
// Bad: Keeping component exactly as copied
// You're missing the point of ownership!
import { Button } from "@/components/ui/Button";

// Just use it without any customization
<Button variant="primary">Click</Button>
```

**Why it's bad:** You're not leveraging ownership. You could've just used an npm package.

**Better:**
```typescript
// Good: Customize for your needs
// Edit Button.styles.ts to add DevAC-specific styling
// Add analytics attributes
// Optimize for your use case
```

### ❌ Anti-Pattern 2: Creating Wrappers

```typescript
// Bad: Wrapping instead of editing
export const DevACButton = ({ children, ...props }) => {
  return (
    <Button
      {...props}
      style={{ ...hackyStyling }}  // Don't do this!
    >
      {children}
    </Button>
  );
};
```

**Why it's bad:** You own Button! Just edit Button.tsx directly.

**Better:**
```typescript
// Good: Edit Button.tsx to add DevAC-specific props
export interface ButtonProps {
  devacAnalytics?: string;  // Add directly
}
```

### ❌ Anti-Pattern 3: Treating as Read-Only

```typescript
// Bad mindset
"I shouldn't modify Button.tsx because it came from primitives"
```

**Why it's bad:** You OWN it now. It's YOUR code.

**Better mindset:**
```
"Button.tsx is mine. I'll make it perfect for DevAC's needs."
```

---

## FAQ

### Q: What if I want updates from primitives?

**A:** Selectively copy updated components and merge changes:
```bash
# See what changed in primitives
git diff packages/ui-primitives/src/Button/

# Copy new version
npx tsx ui-gen/cli.ts add Button --force

# Review your customizations
git diff src/devac/web/frontend/components/ui/Button/

# Keep what you want, merge what's useful
```

You control the update process. Always.

### Q: Isn't this code duplication?

**A:** Yes, and that's the point!

**Duplication is not always bad:**
- ✅ Enables independent evolution
- ✅ Prevents coupling
- ✅ Gives full control
- ✅ Optimizes for specific use cases

**Real duplication problem:** Copying logic bugs across projects  
**This isn't that:** You're copying **starting points**, then diverging based on needs.

### Q: What about consistency across projects?

**A:** Consistency comes from shared design tokens, not identical components.

**Shared:** Theme tokens, colors, spacing, typography  
**Divergent:** Component implementation details

**Example:**
- DevAC's Button optimized for dev tools (compact, dark mode)
- Marketing site's Button optimized for conversion (large, colorful)
- Both use same theme tokens (consistent brand)
- Both have different implementations (optimized for context)

### Q: Won't this make maintenance harder?

**A:** Actually, it makes it easier!

**Traditional (hard):**
```
Library has bug → Can't fix (no control)
                → Wait for maintainer
                → Or write workaround
                → Pain
```

**Open Code (easy):**
```
Your component has bug → Edit file
                      → Fixed in 5 min
                      → Done
```

You're in control. That's easier, not harder.

### Q: What if I need the same fix in multiple components?

**A:** You have options:

1. **Fix each individually** (if they've diverged)
2. **Extract shared utility** (if logic is truly identical)
3. **Update primitives + re-copy** (if components haven't diverged yet)

**The key:** You choose based on situation, not forced into one approach.

---

## Success Metrics

You're doing "Open Code" right when:

- ✅ You edit components directly (not create wrappers)
- ✅ Components are optimized for your specific use cases
- ✅ You're not afraid to modify "library" code
- ✅ AI can help you customize components
- ✅ Your app never breaks from external updates
- ✅ Team feels empowered to improve components

You're doing it wrong when:

- ❌ Components are exact copies, never modified
- ❌ You're creating wrapper components to avoid editing
- ❌ You're treating components as "untouchable library code"
- ❌ You're waiting for "upstream" to add features
- ❌ You're frustrated by limitations

---

## The Bottom Line

**Traditional Approach:**
```
You: "Can the library do X?"
Library: "No."
You: "Can I make it do X?"
Library: "Fork it or use theme API"
You: "That's hard..."
Result: Compromise
```

**Open Code Approach:**
```
You: "Can my component do X?"
You: "Yes, I'll add it."
[Edits file]
You: "Done."
Result: Exactly what you need
```

---

## Further Reading

- **shadcn/ui philosophy:** https://ui.shadcn.com/docs
- **"Colocation":** Kent C. Dodds on keeping related code close
- **"Boring Technology":** Choose proven, customizable solutions

---

*Remember: These components are not from a library. They ARE your library. Own them.*
