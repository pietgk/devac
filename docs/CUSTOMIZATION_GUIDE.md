# Component Customization Guide

**Complete guide to modifying and extending your owned UI components**

Once you've copied a component using `ui-gen`, you own it completely. This guide shows you how to customize components to match your specific needs while maintaining quality and consistency.

---

## Philosophy

**You own this code.** This is the fundamental principle of the "Open Code" approach.

Unlike traditional component libraries where you work around constraints, here you:
- ✅ **Modify freely** - Change anything in the component files
- ✅ **Add features** - Extend props, variants, and functionality
- ✅ **Remove code** - Delete unused variants or features
- ✅ **Refactor** - Restructure however you see fit
- ✅ **Experiment** - Try new patterns without fear

**The only rule**: Make it yours.

---

## Common Customizations

### 1. Adding New Variants

**Example**: Add a "gradient" variant to Button.

#### Step 1: Update the type

```typescript
// Button.tsx
export type ButtonVariant = 
  | "primary" 
  | "secondary" 
  | "outlined" 
  | "tertiary" 
  | "black" 
  | "delete" 
  | "edit"
  | "gradient";  // ← Add new variant
```

#### Step 2: Add styling

```typescript
// Button.styles.ts
export const StyledButton = styled.button<{
  $variant: ButtonVariant;
  // ... other props
}>`
  // ... existing styles

  /* Variant-specific styles */
  ${({ $variant, theme }) => {
    // ... existing variants
    
    if ($variant === "gradient") {
      return css`
        background: linear-gradient(135deg, 
          ${theme.colors.primary} 0%, 
          ${theme.colors.primaryLight} 100%
        );
        color: ${theme.colors.white};
        border: none;
        
        &:hover:not(:disabled) {
          background: linear-gradient(135deg, 
            ${theme.colors.primaryDark} 0%, 
            ${theme.colors.primary} 100%
          );
          transform: translateY(-2px);
          box-shadow: ${theme.shadows.large};
        }
        
        &:active:not(:disabled) {
          transform: translateY(0);
        }
      `;
    }
  }}
`;
```

#### Step 3: Use it

```typescript
<Button variant="gradient" onClick={handleClick}>
  Premium Action
</Button>
```

---

### 2. Adding New Props

**Example**: Add `fullWidth` prop to Button.

#### Step 1: Update type definition

```typescript
// Button.tsx
export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;  // ← Add new prop
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">;
```

#### Step 2: Pass to styled component

```typescript
// Button.tsx
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ 
    variant = "primary",
    size = "m",
    disabled = false,
    loading = false,
    fullWidth = false,  // ← Default value
    leftIcon,
    rightIcon,
    children,
    onClick,
    type = "button",
    ...restProps
  }, ref) => {
    return (
      <StyledButton
        ref={ref}
        $variant={variant}
        $size={size}
        $loading={loading}
        $fullWidth={fullWidth}  // ← Pass as transient prop
        disabled={disabled || loading}
        onClick={onClick}
        type={type}
        {...restProps}
      >
        {/* ... button content */}
      </StyledButton>
    );
  }
);
```

#### Step 3: Update styled component

```typescript
// Button.styles.ts
export const StyledButton = styled.button<{
  $variant: ButtonVariant;
  $size: ButtonSize;
  $loading: boolean;
  $fullWidth: boolean;  // ← Add to type
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  
  /* Full width styling */
  ${({ $fullWidth }) => 
    $fullWidth && css`
      width: 100%;
      display: flex;
    `
  }
  
  /* ... rest of styles */
`;
```

#### Step 4: Use it

```typescript
<Button fullWidth variant="primary" onClick={handleSubmit}>
  Submit Form
</Button>
```

---

### 3. Modifying Existing Styles

**Example**: Make Card hover effect more prominent.

#### Before:
```typescript
// Card.styles.ts
export const StyledCard = styled.div<{
  $variant: CardVariant;
  $interactive: boolean;
}>`
  /* ... base styles */
  
  ${({ $interactive, theme }) =>
    $interactive &&
    css`
      cursor: pointer;
      transition: all ${theme.transition.standard};
      
      &:hover {
        transform: translateY(-2px);
        box-shadow: ${theme.shadows.medium};
      }
    `
  }
`;
```

#### After (more dramatic effect):
```typescript
// Card.styles.ts
export const StyledCard = styled.div<{
  $variant: CardVariant;
  $interactive: boolean;
}>`
  /* ... base styles */
  
  ${({ $interactive, theme }) =>
    $interactive &&
    css`
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      
      &:hover {
        transform: translateY(-8px) scale(1.02);  // ← More dramatic
        box-shadow: ${theme.shadows.extraLarge};   // ← Larger shadow
        border-color: ${theme.colors.primary};     // ← Add border color
      }
      
      &:active {
        transform: translateY(-4px) scale(1.01);   // ← Add active state
      }
    `
  }
`;
```

---

### 4. Extending Component Functionality

**Example**: Add analytics tracking to Button.

#### Step 1: Add tracking prop

```typescript
// Button.tsx
export type ButtonProps = {
  // ... existing props
  trackingId?: string;        // ← Add tracking identifier
  trackingData?: Record<string, unknown>;  // ← Add tracking metadata
};
```

#### Step 2: Implement tracking logic

```typescript
// Button.tsx
import { trackEvent } from "@/utils/analytics";  // Your analytics utility

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ 
    // ... existing props
    trackingId,
    trackingData,
    onClick,
    ...restProps
  }, ref) => {
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      // Track the click if tracking is enabled
      if (trackingId) {
        trackEvent("button_click", {
          buttonId: trackingId,
          variant,
          size,
          ...trackingData,
        });
      }
      
      // Call original onClick
      onClick?.(event);
    };

    return (
      <StyledButton
        ref={ref}
        onClick={handleClick}  // ← Use wrapped handler
        {.../* other props */}
      >
        {/* ... button content */}
      </StyledButton>
    );
  }
);
```

#### Step 3: Use it

```typescript
<Button 
  variant="primary" 
  trackingId="hero_cta"
  trackingData={{ section: "homepage", position: "above-fold" }}
  onClick={handleSignUp}
>
  Sign Up Now
</Button>
```

---

### 5. Removing Unused Features

**Example**: Remove loading state from Button (if you don't need it).

#### Step 1: Remove from types

```typescript
// Button.tsx
export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  // loading?: boolean;  // ← Remove this
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onClick?: () => void;
  // ...
};
```

#### Step 2: Remove from component

```typescript
// Button.tsx
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ 
    variant = "primary",
    size = "m",
    disabled = false,
    // loading = false,  // ← Remove this
    // ...
  }, ref) => {
    return (
      <StyledButton
        ref={ref}
        $variant={variant}
        $size={size}
        // $loading={loading}  // ← Remove this
        disabled={disabled}  // ← Remove "|| loading"
        // ...
      >
        <ButtonContent>  {/* ← Remove $loading prop */}
          {leftIcon && <span className="button-icon">{leftIcon}</span>}
          {children}
          {rightIcon && <span className="button-icon">{rightIcon}</span>}
        </ButtonContent>
        {/* Remove loading spinner conditional */}
      </StyledButton>
    );
  }
);
```

#### Step 3: Clean up styles

```typescript
// Button.styles.ts
export const StyledButton = styled.button<{
  $variant: ButtonVariant;
  $size: ButtonSize;
  // $loading: boolean;  // ← Remove this
}>`
  /* ... styles without loading state */
`;

// Delete ButtonContent styled component if it only handled loading
// Delete LoadingWrapper and LoadingSpinner styled components
```

**Result**: Smaller bundle, simpler code, no unused features.

---

### 6. Creating Composite Components

**Example**: Create a `IconButton` by extending `Button`.

```typescript
// IconButton.tsx
import { Button, type ButtonProps } from "./Button";
import type { ReactNode } from "react";
import styled from "styled-components";

export type IconButtonProps = Omit<ButtonProps, "children"> & {
  icon: ReactNode;
  "aria-label": string;  // Required for accessibility
};

const StyledIconButton = styled(Button)`
  padding: ${({ theme }) => theme.spacing.s}px;
  min-width: 40px;
  border-radius: ${({ theme }) => theme.borderRadius.full}px;
  
  .button-icon {
    margin: 0;
  }
`;

export const IconButton = ({ icon, ...props }: IconButtonProps) => {
  return (
    <StyledIconButton {...props}>
      <span className="button-icon">{icon}</span>
    </StyledIconButton>
  );
};
```

**Usage**:
```typescript
import { IconButton } from "@/components/ui/IconButton";
import { TrashIcon } from "@/icons";

<IconButton 
  icon={<TrashIcon />} 
  variant="delete" 
  aria-label="Delete item"
  onClick={handleDelete}
/>
```

---

## Advanced Patterns

### Pattern 1: Theme-Aware Customization

**Example**: Make Button adapt to dark mode.

```typescript
// Button.styles.ts
export const StyledButton = styled.button<{
  $variant: ButtonVariant;
  // ...
}>`
  /* ... base styles */
  
  ${({ $variant, theme }) => {
    if ($variant === "primary") {
      return css`
        background: ${theme.colors.primary};
        color: ${theme.colors.black};
        
        /* Dark mode adaptation */
        @media (prefers-color-scheme: dark) {
          background: ${theme.colors.primaryLight};
          color: ${theme.colors.black};
          
          &:hover:not(:disabled) {
            background: ${theme.colors.primary};
          }
        }
      `;
    }
  }}
`;
```

Or use theme context:

```typescript
// theme/index.ts
export const darkTheme = {
  ...tokens,
  colors: {
    ...tokens.colors,
    background: tokens.colors.black,
    text: tokens.colors.white,
    // ... overrides
  },
};

// App.tsx
const [isDark, setIsDark] = useState(false);
const theme = isDark ? darkTheme : tokens;

<ThemeProvider theme={theme}>
  <App />
</ThemeProvider>
```

---

### Pattern 2: Responsive Variants

**Example**: Make Button size responsive.

```typescript
// Button.tsx
export type ButtonProps = {
  // ... existing props
  size?: ButtonSize | { base: ButtonSize; md?: ButtonSize; lg?: ButtonSize };
};

// Button.styles.ts
const getResponsiveSize = (
  size: ButtonSize | { base: ButtonSize; md?: ButtonSize; lg?: ButtonSize },
  theme: Theme
) => {
  if (typeof size === "string") {
    return getSizeStyles(size, theme);
  }
  
  return css`
    ${getSizeStyles(size.base, theme)}
    
    ${size.md && theme.mediaQuery.md} {
      ${getSizeStyles(size.md, theme)}
    }
    
    ${size.lg && theme.mediaQuery.lg} {
      ${getSizeStyles(size.lg, theme)}
    }
  `;
};

export const StyledButton = styled.button<{
  $size: ButtonProps["size"];
  // ...
}>`
  ${({ $size, theme }) => getResponsiveSize($size, theme)}
`;
```

**Usage**:
```typescript
<Button size={{ base: "s", md: "m", lg: "l" }} variant="primary">
  Responsive Button
</Button>
```

---

### Pattern 3: Polymorphic Components

**Example**: Make Button render as different HTML elements.

```typescript
// Button.tsx
export type ButtonProps<T extends React.ElementType = "button"> = {
  as?: T;
  variant?: ButtonVariant;
  // ... other props
} & Omit<React.ComponentPropsWithoutRef<T>, "as">;

export const Button = <T extends React.ElementType = "button">({
  as,
  ...props
}: ButtonProps<T>) => {
  const Component = as || "button";
  return <StyledButton as={Component} {...props} />;
};
```

**Usage**:
```typescript
// Render as button (default)
<Button variant="primary" onClick={handleClick}>
  Click Me
</Button>

// Render as link
<Button as="a" href="/signup" variant="primary">
  Sign Up
</Button>

// Render as Next.js Link
<Button as={Link} to="/profile" variant="secondary">
  View Profile
</Button>
```

---

### Pattern 4: Compound Components

**Example**: Card already uses this pattern well. Here's how to add more sub-components.

```typescript
// Card.tsx

// Add new sub-component: CardActions
const StyledCardActions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.s}px;
  padding: ${({ theme }) => theme.spacing.m}px;
  border-top: 1px solid ${({ theme }) => theme.colors.borderLight};
  justify-content: flex-end;
`;

export const CardActions = ({ children }: { children: React.ReactNode }) => {
  return <StyledCardActions>{children}</StyledCardActions>;
};

// Export all sub-components
export { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardDescription, 
  CardContent, 
  CardFooter,
  CardActions  // ← New
};
```

**Usage**:
```typescript
import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardContent, 
  CardActions 
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

<Card>
  <CardHeader>
    <CardTitle>Service Status</CardTitle>
  </CardHeader>
  <CardContent>
    All systems operational
  </CardContent>
  <CardActions>
    <Button variant="outlined" size="s">Details</Button>
    <Button variant="primary" size="s">Refresh</Button>
  </CardActions>
</Card>
```

---

## Best Practices

### ✅ DO

**1. Maintain Type Safety**
```typescript
// Always type your customizations
export type CustomButtonProps = ButtonProps & {
  newFeature: string;
};
```

**2. Use Transient Props for Styling**
```typescript
// Prevent props from reaching DOM
<StyledButton $variant={variant} $size={size}>
```

**3. Document Your Changes**
```typescript
// Add comments for future you
/**
 * Custom gradient variant added for premium CTAs
 * Matches design spec: DESIGN-123
 */
if ($variant === "gradient") { /* ... */ }
```

**4. Test Accessibility**
```typescript
// Maintain ARIA attributes
<Button aria-label="Close dialog" onClick={handleClose}>
  <CloseIcon />
</Button>
```

**5. Keep Theme Consistency**
```typescript
// Use theme tokens, not hardcoded values
color: ${({ theme }) => theme.colors.primary};  // ✅
// color: "#F0AFFA";  // ❌
```

---

### ❌ DON'T

**1. Break Existing APIs Without Reason**
```typescript
// ❌ Don't change prop names arbitrarily
onClick → onButtonClick  // Breaks existing usage

// ✅ Keep existing API, add new features
onClick?: () => void;  // Keep this
trackingId?: string;   // Add this
```

**2. Remove TypeScript Types**
```typescript
// ❌ Don't use any
const handleClick = (event: any) => { /* ... */ };

// ✅ Use proper types
const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => { /* ... */ };
```

**3. Hardcode Values**
```typescript
// ❌ Don't hardcode
padding: 16px;
color: #333;

// ✅ Use theme
padding: ${({ theme }) => theme.spacing.m}px;
color: ${({ theme }) => theme.colors.text};
```

**4. Ignore Accessibility**
```typescript
// ❌ Don't create inaccessible components
<div onClick={handleClick}>Click me</div>

// ✅ Use semantic HTML + ARIA
<button onClick={handleClick} aria-label="Descriptive label">
  <Icon />
</button>
```

**5. Over-Complicate**
```typescript
// ❌ Don't add complexity without reason
const calculateButtonColor = (variant, theme, isHovered, isActive, isDisabled, /* ... 10 more params */) => {
  // 100 lines of logic
};

// ✅ Keep it simple
${({ $variant, theme }) => {
  if ($variant === "primary") return css`background: ${theme.colors.primary};`;
  // ...
}}
```

---

## Customization Checklist

When modifying a component, use this checklist:

- [ ] **Types Updated** - Added/modified TypeScript types
- [ ] **Props Handled** - New props properly passed and used
- [ ] **Styles Applied** - Styled components updated
- [ ] **Transient Props** - Used $ prefix for styling-only props
- [ ] **Theme Tokens** - Used theme instead of hardcoded values
- [ ] **Accessibility** - Maintained/added ARIA attributes
- [ ] **Documentation** - Added comments for complex logic
- [ ] **Exports** - Updated index.ts if needed
- [ ] **Usage Tested** - Verified component works in app
- [ ] **TypeScript** - No type errors
- [ ] **Backwards Compatibility** - Existing usage still works (if applicable)

---

## Migration Strategies

### Strategy 1: Gradual Enhancement

Add new features without breaking existing usage:

```typescript
// v1: Original
<Button variant="primary">Submit</Button>

// v2: Add optional features
<Button variant="primary" fullWidth>Submit</Button>

// v3: Add more optional features
<Button variant="primary" fullWidth trackingId="submit">
  Submit
</Button>
```

---

### Strategy 2: Deprecation Path

When you need to change an API:

```typescript
// Step 1: Mark old prop as deprecated
export type ButtonProps = {
  /** @deprecated Use onClick instead */
  onPress?: () => void;
  onClick?: () => void;
};

// Step 2: Support both temporarily
const handleClick = onClick || onPress;

// Step 3: Add console warning in dev
if (process.env.NODE_ENV === "development" && onPress) {
  console.warn("Button: onPress is deprecated, use onClick");
}

// Step 4: Update all usage over time
// Step 5: Remove deprecated prop in next major version
```

---

### Strategy 3: Feature Flags

Test new features before full rollout:

```typescript
// feature-flags.ts
export const features = {
  buttonGradientVariant: true,
  buttonAnalytics: false,
};

// Button.tsx
import { features } from "@/config/feature-flags";

export type ButtonVariant = 
  | "primary" 
  | "secondary"
  | (typeof features.buttonGradientVariant extends true ? "gradient" : never);
```

---

## Real-World Examples

### Example 1: DevAC Service Status Button

**Requirement**: Button that shows service status with color + icon.

```typescript
// ServiceStatusButton.tsx
import { Button, type ButtonProps } from "@/components/ui/Button";
import { StatusIcon } from "@/components/icons";

type ServiceStatus = "running" | "stopped" | "error" | "starting";

type ServiceStatusButtonProps = Omit<ButtonProps, "variant" | "leftIcon"> & {
  status: ServiceStatus;
  serviceName: string;
};

const statusConfig: Record<ServiceStatus, { variant: ButtonProps["variant"]; icon: string }> = {
  running: { variant: "primary", icon: "✓" },
  stopped: { variant: "outlined", icon: "○" },
  error: { variant: "delete", icon: "✗" },
  starting: { variant: "secondary", icon: "↻" },
};

export const ServiceStatusButton = ({ 
  status, 
  serviceName, 
  ...props 
}: ServiceStatusButtonProps) => {
  const config = statusConfig[status];
  
  return (
    <Button
      variant={config.variant}
      leftIcon={<StatusIcon icon={config.icon} />}
      {...props}
    >
      {serviceName} ({status})
    </Button>
  );
};
```

**Usage**:
```typescript
<ServiceStatusButton 
  status="running" 
  serviceName="API Server"
  onClick={handleViewLogs}
/>
```

---

### Example 2: Card with Loading State

**Requirement**: Card that shows skeleton when loading.

```typescript
// Card.tsx (modified)
export type CardProps = {
  // ... existing props
  loading?: boolean;
};

const SkeletonContent = styled.div`
  width: 100%;
  height: 100px;
  background: linear-gradient(
    90deg,
    ${({ theme }) => theme.colors.backgroundSecondary} 25%,
    ${({ theme }) => theme.colors.borderLight} 50%,
    ${({ theme }) => theme.colors.backgroundSecondary} 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: ${({ theme }) => theme.borderRadius.m}px;
  
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
`;

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ loading = false, children, ...props }, ref) => {
    return (
      <StyledCard ref={ref} {...props}>
        {loading ? <SkeletonContent /> : children}
      </StyledCard>
    );
  }
);
```

**Usage**:
```typescript
<Card loading={isLoadingData}>
  <CardHeader>
    <CardTitle>API Metrics</CardTitle>
  </CardHeader>
  <CardContent>{data}</CardContent>
</Card>
```

---

## Troubleshooting

### Issue: TypeScript errors after customization

**Problem**: `Property 'newProp' does not exist on type 'ButtonProps'`

**Solution**: Ensure type definitions are updated:
```typescript
export type ButtonProps = {
  // Add your new prop here
  newProp?: string;
  // ...
};
```

---

### Issue: Styles not applying

**Problem**: Custom styles aren't showing up.

**Solutions**:

1. **Check transient props**:
```typescript
// ❌ Wrong: prop without $
<StyledButton variant={variant}>

// ✅ Correct: transient prop
<StyledButton $variant={variant}>
```

2. **Check CSS specificity**:
```typescript
// ❌ May be overridden
padding: 16px;

// ✅ Use !important for overrides (sparingly)
padding: 16px !important;

// ✅ Better: increase specificity
&&& { padding: 16px; }
```

3. **Check theme provider**:
```typescript
// Ensure ThemeProvider wraps your app
<ThemeProvider theme={theme}>
  <App />
</ThemeProvider>
```

---

### Issue: Component not re-rendering

**Problem**: Props change but component doesn't update.

**Solution**: Check React.memo and dependencies:
```typescript
// If using memo, ensure proper comparison
export const Button = React.memo(
  React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => {
    // ...
  }),
  (prevProps, nextProps) => {
    // Custom comparison logic
    return prevProps.variant === nextProps.variant &&
           prevProps.children === nextProps.children;
  }
);
```

---

## Next Steps

Once you're comfortable with customization:

1. **Extract patterns** - Create new components from repeated customizations
2. **Build composition** - Combine primitives into complex components
3. **Create variants** - Add design system variants for your brand
4. **Optimize** - Remove unused code and variants
5. **Document** - Keep README files up to date with your changes

---

## Related Documentation

- **[PRIMITIVES_GUIDE.md](./PRIMITIVES_GUIDE.md)** - Extract new components from mindlerui
- **[COMPONENT_OWNERSHIP.md](./COMPONENT_OWNERSHIP.md)** - Philosophy of "Open Code"
- **[UI_GEN_CLI.md](./UI_GEN_CLI.md)** - Using the component generator
- **[UNIVERSAL_ROADMAP.md](./UNIVERSAL_ROADMAP.md)** - Future: web + native

---

## Summary

**You own the code. Make it yours.**

- ✅ Add new variants and props
- ✅ Modify existing styles
- ✅ Remove unused features
- ✅ Create composite components
- ✅ Experiment with patterns
- ✅ Build your design system

**Remember**: These are starting points, not constraints. Customize freely!
