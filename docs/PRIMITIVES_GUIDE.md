# Primitives Guide: Extracting Components from mindlerui

**Purpose:** Step-by-step guide for extracting additional components from `@mindlercare/mindlerui` and adapting them for web use in DevAC.

**Audience:** Developers adding new components to `@devac/ui-primitives`

---

## Overview

This guide explains how to extract React Native components from mindlerui and adapt them for web (React + styled-components).

### Source Location
```
/Users/grop/ws/app/mindlerui/
├── Button/
├── Card/
├── Badge/
├── Text/
├── ... (153 components total)
```

### Target Location
```
/Users/grop/ws/CodeGraph/packages/ui-primitives/src/
├── Button/      ✅ Already extracted
├── Card/        ✅ Already extracted
├── Badge/       ✅ Already extracted
├── Text/        ✅ Already extracted
├── [NewComponent]/  ← Add new components here
```

---

## Step-by-Step Extraction Process

### Step 1: Choose a Component to Extract

**Good candidates:**
- ✅ Input fields (TextInput, Select, Checkbox, Radio)
- ✅ Feedback components (Alert, Toast, Spinner)
- ✅ Layout components (Stack, Container, Grid)
- ✅ Navigation (Tabs, Breadcrumb)
- ✅ Data display (Table, List, Avatar)

**Components to skip (for now):**
- ❌ Platform-specific (Camera, LocationPicker, etc.)
- ❌ Heavily React Native dependent (FlatList, ScrollView)
- ❌ Animation-heavy (better to rebuild for web)

### Step 2: Analyze the Source Component

Read the mindlerui component to understand:

```bash
# Example: Extracting Input component
cd /Users/grop/ws/app/mindlerui
ls -la Input/
```

**What to look for:**
1. **Props interface** - What options does it accept?
2. **Variants** - Different visual styles?
3. **States** - Disabled, focused, error, etc.?
4. **Accessibility** - ARIA attributes, keyboard handling?
5. **Theme usage** - Which tokens does it use?
6. **React Native specifics** - What needs web adaptation?

**Example analysis (Input):**
```typescript
// From mindlerui/Input/Input.tsx
interface InputProps {
  value: string;
  onChangeText: (text: string) => void;  // ← RN-specific
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  leftIcon?: IconName;
  rightIcon?: IconName;
  // ... more props
}
```

### Step 3: Create Component Directory Structure

```bash
cd /Users/grop/ws/CodeGraph/packages/ui-primitives/src
mkdir -p NewComponent
cd NewComponent

# Create the three core files
touch NewComponent.types.ts
touch NewComponent.styles.ts
touch NewComponent.tsx
touch index.ts
```

### Step 4: Port Types (React Native → Web)

Create `NewComponent.types.ts`:

**Key adaptations:**
- Change `onChangeText` → `onChange` (web convention)
- Remove RN-specific props (`accessibilityLabel` → use ARIA directly)
- Extend web HTML element types

**Example (Input):**
```typescript
/**
 * Input Component Types
 * 
 * Adapted from @mindlercare/mindlerui/Input
 * Converted for web with HTML input attributes.
 */

export interface InputProps 
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /**
   * Input value
   */
  value: string;

  /**
   * Change handler (web convention)
   */
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;

  /**
   * Error state
   */
  error?: boolean;

  /**
   * Error message to display
   */
  errorMessage?: string;

  /**
   * Size variant
   */
  size?: "sm" | "md" | "lg";

  /**
   * Left icon element
   */
  leftIcon?: React.ReactNode;

  /**
   * Right icon element
   */
  rightIcon?: React.ReactNode;

  // ... other web-specific props
}
```

### Step 5: Port Styles (React Native → styled-components)

Create `NewComponent.styles.ts`:

**Key adaptations:**

| React Native | styled-components Web |
|--------------|----------------------|
| `paddingHorizontal` | `padding-left` + `padding-right` |
| `paddingVertical` | `padding-top` + `padding-bottom` |
| `flexDirection: "row"` | `flex-direction: row` |
| `{ fontSize: 16 }` | `font-size: 16px` |
| No units needed | Must specify `px`, `rem`, etc. |

**Pattern to follow:**
```typescript
import styled, { css } from "styled-components";

export const StyledInput = styled.input<{
  $error?: boolean;
  $size: "sm" | "md" | "lg";
}>`
  /* Base styles */
  font-family: ${({ theme }) => theme.font.family.body};
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  transition: all ${({ theme }) => theme.transition.standard};
  
  /* Size variants */
  ${({ $size, theme }) => {
    if ($size === "sm") return css`
      padding: ${theme.spacing.xs}px ${theme.spacing.s}px;
      font-size: ${theme.font.size.xs};
      height: 36px;
    `;
    // ... other sizes
  }}

  /* State variants */
  ${({ $error, theme }) =>
    $error &&
    css`
      border-color: ${theme.colors.error};
    `}
`;
```

**Theme token mapping (mindlerui → web):**
```typescript
// mindlerui (React Native)
theme.spacing.m              // → theme.spacing.m + "px"
theme.colors.primary         // → Same
theme.borderRadius.medium    // → theme.borderRadius.medium + "px"
scale(16)                    // → Remove (web doesn't need scaling)
```

### Step 6: Port Component Logic

Create `NewComponent.tsx`:

**Key adaptations:**

1. **Event handlers:**
```typescript
// mindlerui (React Native)
onChangeText={(text) => setValue(text)}

// Web
onChange={(e) => setValue(e.target.value)}
```

2. **Refs:**
```typescript
// Same pattern works
const inputRef = useRef<HTMLInputElement>(null);
```

3. **Accessibility:**
```typescript
// mindlerui uses RN props
<TextInput
  accessibilityLabel="Email input"
  accessibilityHint="Enter your email"
/>

// Web uses ARIA
<input
  aria-label="Email input"
  aria-describedby="email-hint"
  aria-invalid={error}
/>
```

**Full example:**
```typescript
/**
 * Input Component
 * 
 * Text input extracted from @mindlercare/mindlerui
 * Adapted for web with full accessibility.
 */

import React from "react";
import { StyledInput, InputWrapper, ErrorMessage } from "./Input.styles";
import type { InputProps } from "./Input.types";

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      error = false,
      errorMessage,
      size = "md",
      leftIcon,
      rightIcon,
      onChange,
      ...restProps
    },
    ref
  ) => {
    return (
      <InputWrapper>
        {leftIcon && <span className="left-icon">{leftIcon}</span>}
        
        <StyledInput
          ref={ref}
          $error={error}
          $size={size}
          onChange={onChange}
          aria-invalid={error}
          aria-describedby={error ? "error-message" : undefined}
          {...restProps}
        />
        
        {rightIcon && <span className="right-icon">{rightIcon}</span>}
        
        {error && errorMessage && (
          <ErrorMessage id="error-message" role="alert">
            {errorMessage}
          </ErrorMessage>
        )}
      </InputWrapper>
    );
  }
);

Input.displayName = "Input";
```

### Step 7: Create Index Exports

Create `index.ts`:
```typescript
export { Input } from "./Input";
export type { InputProps } from "./Input.types";
```

### Step 8: Add to Package Exports

Edit `packages/ui-primitives/src/index.ts`:
```typescript
// Add your new component
export { Input } from "./Input";
export type { InputProps } from "./Input.types";
```

### Step 9: Update CLI Component List

Edit `src/devac/ui-gen/cli.ts`:
```typescript
const AVAILABLE_COMPONENTS = [
  "Button",
  "Card",
  "Badge",
  "Text",
  "Input",  // ← Add new component
  "theme"
];
```

### Step 10: Test the Component

```bash
# Test CLI can list it
npx tsx src/devac/ui-gen/cli.ts list

# Test copying it
npx tsx src/devac/ui-gen/cli.ts add Input --path /tmp/test

# Check copied files
ls -la /tmp/test/Input/
```

---

## Common Patterns & Solutions

### Pattern 1: Icon Props

**mindlerui uses IconName enum:**
```typescript
// mindlerui
leftIcon?: IconName;  // e.g., "MagnifyingGlass"
<Icon.MagnifyingGlass />
```

**Web: Accept React nodes:**
```typescript
// web
leftIcon?: React.ReactNode;
<Icon size={20} />  // Any icon library
```

### Pattern 2: Theme Access

**Same pattern works:**
```typescript
const theme = useTheme();  // Works in both RN and web
```

### Pattern 3: Conditional Rendering

**Same JSX patterns:**
```typescript
{error && <ErrorMessage>{message}</ErrorMessage>}
{isLoading ? <Spinner /> : <Content />}
```

### Pattern 4: Responsive Scaling

**mindlerui has `scale()` function for responsive sizing:**
```typescript
// mindlerui (RN)
import { scale } from "../scale";
padding: scale(16)  // Scales based on screen size
```

**Web: Use media queries:**
```typescript
// web
padding: ${({ theme }) => theme.spacing.m}px;

@media (min-width: ${({ theme }) => theme.breakpoints.tablet}) {
  padding: ${({ theme }) => theme.spacing.l}px;
}
```

---

## Checklist for New Components

Before considering a component "done":

- [ ] Types ported with web conventions (onChange vs onChangeText)
- [ ] Styles ported with proper CSS units (px, rem)
- [ ] All variants working (size, color, state)
- [ ] Accessibility attributes added (ARIA)
- [ ] Keyboard navigation working (tab, enter, escape)
- [ ] Focus styles defined
- [ ] Theme tokens used (no hardcoded values)
- [ ] forwardRef implemented (for ref passing)
- [ ] displayName set
- [ ] TypeScript strict mode passes
- [ ] Added to package exports
- [ ] Added to CLI component list
- [ ] Documentation comments added

---

## Quick Reference: RN → Web Mappings

### Props
```typescript
// RN → Web
onChangeText → onChange
onPress → onClick
accessibilityLabel → aria-label
accessibilityHint → aria-describedby
testID → data-testid
```

### Styles
```typescript
// RN → Web
paddingHorizontal: 16 → padding: 0 16px
paddingVertical: 8 → padding: 8px 0
fontSize: 16 → font-size: 16px
flexDirection: "row" → flex-direction: row
```

### Elements
```typescript
// RN → Web
<View> → <div>
<Text> → <span> or semantic HTML
<TouchableOpacity> → <button>
<TextInput> → <input>
<ScrollView> → <div> with overflow-y: auto
```

---

## Examples from Existing Extractions

### Simple Component (Badge)
- **Complexity:** Low
- **Time:** 20-30 minutes
- **Files:** 4 (types, styles, component, index)
- **Lines:** ~165 total

### Medium Component (Button)
- **Complexity:** Medium
- **Time:** 30-45 minutes
- **Features:** Multiple variants, loading state, icons
- **Lines:** ~325 total

### Complex Component (Card)
- **Complexity:** Medium-High
- **Time:** 45-60 minutes
- **Features:** Sub-components, interactive mode, composition
- **Lines:** ~225 total

---

## Tips & Best Practices

### 1. Start Simple
Extract simpler components first to learn the patterns:
- Badge (easiest)
- Button
- Text
- Then move to complex ones (Input, Select, etc.)

### 2. Keep Mobile Patterns
If a pattern works well in mindlerui, keep it:
- Variant system
- Size system
- Theme integration
- Prop naming (unless web-specific)

### 3. Use transient props ($)
Prefix styling props with `$` to prevent DOM warnings:
```typescript
<StyledButton $variant="primary">  // $ prevents passing to DOM
```

### 4. Maintain Accessibility
mindlerui has excellent a11y - preserve it:
- Keep ARIA attributes
- Maintain keyboard navigation
- Preserve focus management
- Add role attributes where needed

### 5. Document as You Go
Add comments explaining:
- Source component
- Adaptations made
- Usage examples
- Known limitations

---

## Need Help?

**Resources:**
- mindlerui source: `/Users/grop/ws/app/mindlerui/`
- Existing extractions: `packages/ui-primitives/src/`
- styled-components docs: https://styled-components.com
- React patterns: `app/mindlerui/` (153 component examples)

**Questions to ask:**
1. Does this component exist in mindlerui?
2. How complex is it (simple badge vs complex table)?
3. What RN-specific features does it use?
4. Can those features be adapted to web?
5. What web-specific features should be added?

---

*This guide will evolve as we extract more components. Update it with lessons learned!*
