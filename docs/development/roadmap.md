# Universal UI Roadmap: Web + Native

**Strategic plan for achieving true universal (web + React Native) UI components**

This document outlines the path to evolving our "Open Code" UI system from web-only to universal components that work seamlessly across web and React Native.

---

## Vision

Build a **universal UI system** where:

✅ **Single Source of Truth** - One component, two platforms  
✅ **Platform-Optimized** - Native feel on each platform  
✅ **Shared Business Logic** - Write once, style per platform  
✅ **Progressive Enhancement** - Start web, add native incrementally  
✅ **Developer Experience** - Simple, intuitive, AI-friendly  

**Inspiration**: The best of Tamagui, Solito, and mindlerui patterns.

---

## Current State (Phase 0-3)

### What We Have

**✅ Web-First Foundation (styled-components v6)**
- Theme system with design tokens
- 4 production-ready web components (Button, Card, Badge, Text)
- Component generator CLI (`ui-gen`)
- "Open Code" philosophy (copy, don't install)

**✅ Production Mobile Library (mindlerui)**
- 153+ battle-tested React Native components
- styled-components v5
- 2+ years of production use
- Superior quality and polish

**✅ Strategic Position**
- DevAC web interface (Phase 1-3) validates web architecture
- mindlerui provides proven component patterns
- Team expertise in both web and React Native

---

### What We Don't Have Yet

❌ Unified component API across platforms  
❌ Platform-specific file extensions (`.native.tsx`)  
❌ Shared component logic with platform-specific styles  
❌ Universal navigation patterns  
❌ Cross-platform form handling  
❌ Platform-aware build tooling  

---

## Strategic Approach

### Phase 0-3: Web Foundation ✅ (Current)

**Goal**: Prove the "Open Code" concept on web.

**Deliverables**:
- DevAC web interface with Express + Next.js + SSE
- Web-optimized components (Button, Card, Badge, Text)
- Theme system and design tokens
- Component generator CLI

**Status**: ✅ Complete

**Learnings**:
- "Open Code" enables rapid customization
- styled-components v6 works great for web
- Theme tokens provide consistency
- CLI simplifies component adoption

---

### Phase 4: Universal Architecture (Next - 3-4 weeks)

**Goal**: Add React Native support to existing components without breaking web.

#### 4.1 Platform Detection System (Week 1)

**Create unified platform detection**:

```typescript
// packages/ui-primitives/src/platform/index.ts
import { Platform as RNPlatform } from "react-native";

export const Platform = {
  OS: typeof window !== "undefined" ? "web" : RNPlatform.OS,
  select: <T>(specifics: { web?: T; native?: T; ios?: T; android?: T }): T => {
    if (typeof window !== "undefined") {
      return specifics.web ?? specifics.native;
    }
    return RNPlatform.select(specifics);
  },
};
```

**Usage**:
```typescript
const fontSize = Platform.select({
  web: 16,
  ios: 17,
  android: 16,
});
```

---

#### 4.2 Universal Component Pattern (Week 1-2)

**Introduce `.native.tsx` file extension pattern**:

```
Button/
├── Button.tsx              # Web implementation
├── Button.native.tsx       # React Native implementation
├── Button.styles.ts        # Web styles (styled-components v6)
├── Button.styles.native.ts # Native styles (styled-components v5)
├── Button.types.ts         # Shared types
├── Button.logic.ts         # Shared business logic (hooks)
└── index.ts                # Platform-aware exports
```

**Example: Universal Button**

**Shared Types** (`Button.types.ts`):
```typescript
export type ButtonVariant = "primary" | "secondary" | "outlined" | "tertiary";
export type ButtonSize = "xs" | "s" | "m" | "l" | "xl";

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  onPress?: () => void;  // Universal prop name
  children: React.ReactNode;
};
```

**Shared Logic** (`Button.logic.ts`):
```typescript
import { useState } from "react";
import type { ButtonProps } from "./Button.types";

export const useButton = (props: ButtonProps) => {
  const [isPressed, setIsPressed] = useState(false);
  
  const handlePress = () => {
    if (props.disabled || props.loading) return;
    props.onPress?.();
  };
  
  return {
    isPressed,
    setIsPressed,
    handlePress,
    isDisabled: props.disabled || props.loading,
  };
};
```

**Web Implementation** (`Button.tsx`):
```typescript
import React from "react";
import type { ButtonProps } from "./Button.types";
import { useButton } from "./Button.logic";
import { StyledButton, ButtonContent } from "./Button.styles";

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "m", children, ...props }, ref) => {
    const { handlePress, isDisabled } = useButton(props);
    
    return (
      <StyledButton
        ref={ref}
        $variant={variant}
        $size={size}
        disabled={isDisabled}
        onClick={handlePress}  // Web: onClick
      >
        <ButtonContent>{children}</ButtonContent>
      </StyledButton>
    );
  }
);
```

**Native Implementation** (`Button.native.tsx`):
```typescript
import React from "react";
import type { ButtonProps } from "./Button.types";
import { useButton } from "./Button.logic";
import { StyledButton, ButtonContent } from "./Button.styles.native";

export const Button = React.forwardRef<any, ButtonProps>(
  ({ variant = "primary", size = "m", children, ...props }, ref) => {
    const { handlePress, isDisabled } = useButton(props);
    
    return (
      <StyledButton
        ref={ref}
        variant={variant}
        size={size}
        disabled={isDisabled}
        onPress={handlePress}  // Native: onPress
      >
        <ButtonContent>{children}</ButtonContent>
      </StyledButton>
    );
  }
);
```

**Platform-Aware Exports** (`index.ts`):
```typescript
export { Button } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button.types";
```

**Metro/Webpack Configuration**: Automatically resolves `.native.tsx` on React Native, `.tsx` on web.

---

#### 4.3 Universal Styling Approach (Week 2)

**Web Styles** (`Button.styles.ts` - styled-components v6):
```typescript
import styled, { css } from "styled-components";

export const StyledButton = styled.button<{
  $variant: ButtonVariant;
  $size: ButtonSize;
}>`
  display: inline-flex;
  padding: ${({ $size, theme }) => {
    if ($size === "s") return "14px 20px";
    return "17px 24px";
  }};
  background: ${({ $variant, theme }) => {
    if ($variant === "primary") return theme.colors.primary;
    return "transparent";
  }};
  border-radius: ${({ theme }) => theme.borderRadius.full}px;
  /* ... full web styles */
`;
```

**Native Styles** (`Button.styles.native.ts` - styled-components v5):
```typescript
import styled from "styled-components/native";
import { TouchableOpacity, Text } from "react-native";

export const StyledButton = styled(TouchableOpacity)<{
  variant: ButtonVariant;
  size: ButtonSize;
}>`
  padding: ${({ size }) => {
    if (size === "s") return "14px 20px";
    return "17px 24px";
  }};
  background-color: ${({ variant, theme }) => {
    if (variant === "primary") return theme.colors.primary;
    return "transparent";
  }};
  border-radius: ${({ theme }) => theme.borderRadius.full}px;
  /* ... full native styles */
`;

export const ButtonContent = styled(Text)<{ variant: ButtonVariant }>`
  color: ${({ variant, theme }) => {
    if (variant === "primary") return theme.colors.black;
    return theme.colors.text;
  }};
  font-family: ${({ theme }) => theme.font.family.body};
  /* ... typography styles */
`;
```

**Key Differences**:
- Web: Uses `button` element, transient props (`$variant`)
- Native: Uses `TouchableOpacity`, standard props
- Web: CSS units (`px`, `%`)
- Native: No units (numbers are density-independent pixels)

---

#### 4.4 Theme System Updates (Week 2)

**Universal Theme Tokens** (already done in Phase 0, minor tweaks):

```typescript
// packages/ui-primitives/src/theme/tokens.ts
export const tokens = {
  colors: {
    primary: "#F0AFFA",        // Works on both platforms
    black: "#1D1B1B",
    white: "#FFFFFF",
    // ...
  },
  spacing: {
    xs: 4,                     // Unitless (px on web, dp on native)
    s: 8,
    m: 16,
    // ...
  },
  font: {
    family: {
      body: Platform.select({
        web: "Inter, -apple-system, sans-serif",
        ios: "System",         // San Francisco
        android: "Roboto",
      }),
    },
    size: {
      s: 14,
      m: 16,
      l: 18,
    },
  },
};
```

**Platform-Specific Theme Providers**:

```typescript
// Web (styled-components v6)
import { ThemeProvider } from "styled-components";
import { theme } from "@devac/ui-primitives/theme";

<ThemeProvider theme={theme}>
  <App />
</ThemeProvider>

// Native (styled-components v5)
import { ThemeProvider } from "styled-components/native";
import { theme } from "@devac/ui-primitives/theme";

<ThemeProvider theme={theme}>
  <App />
</ThemeProvider>
```

---

#### 4.5 Build Configuration (Week 3)

**Metro Configuration** (React Native):

```javascript
// metro.config.js
module.exports = {
  resolver: {
    sourceExts: ["jsx", "js", "ts", "tsx", "json"],
    platforms: ["ios", "android", "native"],  // Resolve .native.tsx
  },
  transformer: {
    babelTransformerPath: require.resolve("react-native-svg-transformer"),
  },
};
```

**Next.js Configuration** (Web):

```javascript
// next.config.js
module.exports = {
  webpack: (config) => {
    config.resolve.extensions = [".web.tsx", ".web.ts", ".tsx", ".ts", ".js"];
    return config;
  },
};
```

**Expo Configuration** (Recommended for Universal Apps):

```json
// app.json
{
  "expo": {
    "web": {
      "bundler": "metro"
    },
    "plugins": [
      "expo-router"
    ]
  }
}
```

---

#### 4.6 Testing Strategy (Week 3-4)

**Web Testing** (Existing - Vitest + React Testing Library):
```typescript
// Button.test.tsx
import { render, screen } from "@testing-library/react";
import { Button } from "./Button";

test("renders button", () => {
  render(<Button>Click me</Button>);
  expect(screen.getByText("Click me")).toBeInTheDocument();
});
```

**Native Testing** (React Native Testing Library):
```typescript
// Button.test.native.tsx
import { render, fireEvent } from "@testing-library/react-native";
import { Button } from "./Button";

test("handles press", () => {
  const onPress = jest.fn();
  const { getByText } = render(<Button onPress={onPress}>Press me</Button>);
  
  fireEvent.press(getByText("Press me"));
  expect(onPress).toHaveBeenCalled();
});
```

**Visual Testing** (Storybook supports both platforms):
```typescript
// Button.stories.tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "Primitives/Button",
  component: Button,
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: {
    variant: "primary",
    children: "Primary Button",
  },
};
```

---

### Phase 5: Navigation & Routing (4-6 weeks after Phase 4)

**Goal**: Universal navigation that works on web and native.

#### 5.1 Solito Integration

**Why Solito?**
- Built on top of React Navigation (native) and Next.js (web)
- Shared navigation logic
- Type-safe routing
- File-based routing on both platforms

**Installation**:
```bash
npm install solito
npm install @react-navigation/native @react-navigation/native-stack
```

**Universal Link Component**:
```typescript
// components/ui/Link.tsx
import { Link as SolitoLink } from "solito/link";

export type LinkProps = {
  href: string;
  children: React.ReactNode;
};

export const Link = ({ href, children }: LinkProps) => {
  return <SolitoLink href={href}>{children}</SolitoLink>;
};
```

**Usage** (same on web and native):
```typescript
<Link href="/services">View Services</Link>
<Link href="/services/123">Service Details</Link>
```

---

#### 5.2 Navigation Patterns

**Stack Navigation**:
```typescript
// app/(tabs)/services/index.tsx
export default function ServicesScreen() {
  const router = useRouter();
  
  return (
    <View>
      <Button onPress={() => router.push("/services/123")}>
        View Service
      </Button>
    </View>
  );
}
```

**Tab Navigation**:
```typescript
// app/(tabs)/_layout.tsx
import { Tabs } from "expo-router";

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="services" options={{ title: "Services" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
```

---

### Phase 6: Forms & Input (6-8 weeks after Phase 5)

**Goal**: Universal form handling with validation.

#### 6.1 Universal Input Component

```typescript
// Input.types.ts
export type InputProps = {
  value: string;
  onChangeText: (text: string) => void;  // Universal prop name
  placeholder?: string;
  disabled?: boolean;
  error?: string;
};

// Input.tsx (Web)
export const Input = ({ value, onChangeText, ...props }: InputProps) => {
  return (
    <StyledInput
      value={value}
      onChange={(e) => onChangeText(e.target.value)}  // Web adapter
      {...props}
    />
  );
};

// Input.native.tsx (Native)
export const Input = ({ value, onChangeText, ...props }: InputProps) => {
  return (
    <StyledInput
      value={value}
      onChangeText={onChangeText}  // Direct prop
      {...props}
    />
  );
};
```

#### 6.2 Form Library Integration

**React Hook Form** (works on both platforms):
```typescript
import { useForm } from "react-hook-form";

const { control, handleSubmit } = useForm();

<Controller
  control={control}
  name="serviceName"
  render={({ field }) => (
    <Input
      value={field.value}
      onChangeText={field.onChange}
      placeholder="Service name"
    />
  )}
/>
```

---

### Phase 7: Advanced Patterns (8-12 weeks after Phase 6)

#### 7.1 Animations

**Web**: Framer Motion
```typescript
import { motion } from "framer-motion";

<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
>
  <Card>Content</Card>
</motion.div>
```

**Native**: React Native Reanimated
```typescript
import Animated, { FadeIn } from "react-native-reanimated";

<Animated.View entering={FadeIn}>
  <Card>Content</Card>
</Animated.View>
```

**Universal Animation Wrapper**:
```typescript
// Animate.tsx
export const Animate = Platform.select({
  web: ({ children }) => (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {children}
    </motion.div>
  ),
  native: ({ children }) => (
    <Animated.View entering={FadeIn}>
      {children}
    </Animated.View>
  ),
});
```

---

#### 7.2 Gesture Handling

**Web**: Mouse/touch events
```typescript
<Button onClick={handleClick}>Click</Button>
```

**Native**: React Native Gesture Handler
```typescript
import { GestureDetector, Gesture } from "react-native-gesture-handler";

const tap = Gesture.Tap().onEnd(() => handlePress());

<GestureDetector gesture={tap}>
  <Button>Tap</Button>
</GestureDetector>
```

---

#### 7.3 Platform-Specific Features

**Example: File Upload**

```typescript
// FileUpload.tsx (Web)
export const FileUpload = ({ onUpload }: Props) => {
  return (
    <input
      type="file"
      onChange={(e) => onUpload(e.target.files[0])}
    />
  );
};

// FileUpload.native.tsx (Native)
import * as DocumentPicker from "expo-document-picker";

export const FileUpload = ({ onUpload }: Props) => {
  const handlePress = async () => {
    const result = await DocumentPicker.getDocumentAsync();
    if (result.type === "success") {
      onUpload(result);
    }
  };
  
  return <Button onPress={handlePress}>Upload File</Button>;
};
```

---

## Component Extraction Priority

When adding universal support, prioritize in this order:

### Tier 1: Core Primitives (Phase 4)
1. ✅ **Button** - Most used component
2. ✅ **Text** - Typography system
3. ✅ **Card** - Layout container
4. ✅ **Badge** - Status indicators

### Tier 2: Layout & Structure (Phase 5)
5. **Stack** - Vertical/horizontal layout
6. **Grid** - Grid layout
7. **Spacer** - Consistent spacing
8. **Divider** - Section separation

### Tier 3: Input & Forms (Phase 6)
9. **Input** - Text input
10. **Select** - Dropdown selection
11. **Checkbox** - Boolean input
12. **Radio** - Single choice
13. **Switch** - Toggle

### Tier 4: Feedback (Phase 7)
14. **Modal** - Dialogs and overlays
15. **Toast** - Notifications
16. **Loading** - Spinners and skeletons
17. **Alert** - Important messages

### Tier 5: Complex Components (Phase 8+)
18. **Table** - Data tables (web-focused)
19. **Chart** - Data visualization
20. **DatePicker** - Date selection
21. **Tabs** - Tab navigation

---

## Migration Strategy

### For Existing Web Projects

**Step 1**: Add `.native.tsx` files alongside existing `.tsx` files
**Step 2**: Extract shared logic to `.logic.ts` files
**Step 3**: Split styles into `.styles.ts` (web) and `.styles.native.ts` (native)
**Step 4**: Update imports to be platform-aware
**Step 5**: Test on both platforms

**Example**:
```bash
# Before
Button/
├── Button.tsx
└── Button.styles.ts

# After
Button/
├── Button.tsx              # Web
├── Button.native.tsx       # Native (new)
├── Button.styles.ts        # Web styles
├── Button.styles.native.ts # Native styles (new)
├── Button.types.ts         # Shared types (new)
├── Button.logic.ts         # Shared logic (new)
└── index.ts                # Platform-aware exports
```

---

### For Existing React Native Projects (mindlerui)

**Step 1**: Copy existing component as `.native.tsx`
**Step 2**: Create new `.tsx` version for web
**Step 3**: Extract shared logic
**Step 4**: Adapt styles for web (styled-components v6)
**Step 5**: Test on both platforms

**Example** (extracting from mindlerui):
```bash
# Source: app/node_modules/@mindlercare/mindlerui/src/Button.tsx
# Target: packages/ui-primitives/src/Button/

# 1. Copy to Button.native.tsx
cp Button.tsx packages/ui-primitives/src/Button/Button.native.tsx

# 2. Create Button.tsx for web (manually)

# 3. Extract shared types and logic

# 4. Update styles for each platform

# 5. Test both
```

---

## Technical Considerations

### Bundle Size

**Web**:
- Tree-shaking works well with platform-specific imports
- Only web code is bundled for web builds
- Styled-components v6 has smaller runtime than v5

**Native**:
- Metro bundler automatically excludes `.tsx` files
- Only `.native.tsx` files are bundled
- Hermes engine optimizes bundle size

**Shared Logic**:
- Business logic (`.logic.ts`) is shared (< 5KB per component typically)
- Types (`.types.ts`) are compile-time only (0KB runtime)

---

### Performance

**Web**:
- Use React.memo for expensive components
- Use React.lazy for code-splitting
- Optimize images with Next.js Image

**Native**:
- Use React.memo for list items
- Use FlatList for long lists
- Optimize images with Fast Image

**Shared**:
- Keep shared logic lightweight
- Avoid platform checks in hot paths
- Use useMemo/useCallback judiciously

---

### Developer Experience

**Pros**:
- ✅ Write business logic once
- ✅ Type safety across platforms
- ✅ Easy to understand (`.native.tsx` is clear)
- ✅ IDE support (auto-complete works)
- ✅ AI-friendly (clear file structure)

**Cons**:
- ❌ More files per component
- ❌ Requires discipline in code organization
- ❌ Learning curve for team

**Mitigation**:
- Use component generator to scaffold structure
- Create clear templates and examples
- Document patterns in this guide

---

## Alternative Approaches Considered

### 1. Tamagui (Considered but not chosen)

**Pros**:
- True universal styling (one style definition)
- Excellent performance
- Great DX

**Cons**:
- New styling paradigm (learning curve)
- Doesn't leverage existing mindlerui components
- Requires significant rewrite
- Less "Open Code" (more framework)

**Decision**: Our approach gives us ownership and gradual migration.

---

### 2. React Native Web (Considered but not chosen)

**Pros**:
- Use React Native components on web
- Single codebase

**Cons**:
- Web feels less web-like
- Bundle size overhead
- CSS-in-JS performance on web
- Doesn't match existing patterns

**Decision**: We prefer web-first with native adaptation.

---

### 3. Separate Codebases (Rejected)

**Pros**:
- Maximum platform optimization
- No compromises

**Cons**:
- Duplicate business logic
- Maintenance nightmare
- Inconsistent UX

**Decision**: Universal approach is worth the structure investment.

---

## Success Metrics

### Phase 4 Success Criteria:
- [ ] All 4 core components work on web and native
- [ ] Shared business logic < 10% duplication
- [ ] Bundle size increase < 5KB per component
- [ ] Type safety maintained
- [ ] Tests pass on both platforms

### Phase 5 Success Criteria:
- [ ] Navigation works identically on web and native
- [ ] Deep linking works
- [ ] Type-safe routing
- [ ] Browser back button works (web)
- [ ] Android back button works (native)

### Phase 6 Success Criteria:
- [ ] Forms work identically
- [ ] Validation works
- [ ] Accessibility maintained
- [ ] Performance acceptable

---

## Timeline

**Phase 4**: Universal Architecture (3-4 weeks)
- Week 1: Platform detection + build config
- Week 2: Button + Card universal
- Week 3: Badge + Text universal + testing
- Week 4: Documentation + examples

**Phase 5**: Navigation (4-6 weeks after Phase 4)
- Week 1-2: Solito setup + basic routing
- Week 3-4: Tab navigation + stack navigation
- Week 5-6: Deep linking + testing

**Phase 6**: Forms (6-8 weeks after Phase 5)
- Week 1-2: Input + Select components
- Week 3-4: Checkbox + Radio + Switch
- Week 5-6: Form validation + testing
- Week 7-8: Complex forms + examples

**Phase 7+**: Advanced features (ongoing)

**Total to Universal Parity**: ~6-8 months

---

## Getting Started (When Ready)

### Prerequisites:
1. ✅ Complete Phase 0-3 (web foundation)
2. ✅ Validate web architecture with DevAC
3. ✅ Team alignment on universal approach

### Next Steps:
1. **Set up React Native project** (Expo recommended)
2. **Install dependencies** (styled-components v5, react-navigation)
3. **Configure build tools** (Metro + Next.js)
4. **Start with Button** (easiest to make universal)
5. **Document learnings** (update this guide)

---

## Related Documentation

- **[PRIMITIVES_GUIDE.md](./PRIMITIVES_GUIDE.md)** - Extract components from mindlerui
- **[COMPONENT_OWNERSHIP.md](./COMPONENT_OWNERSHIP.md)** - "Open Code" philosophy
- **[UI_GEN_CLI.md](./UI_GEN_CLI.md)** - Component generator CLI
- **[CUSTOMIZATION_GUIDE.md](./CUSTOMIZATION_GUIDE.md)** - Modify components

---

## Conclusion

**The path to universal UI is clear**:

1. ✅ **Phase 0-3**: Prove "Open Code" on web (DONE)
2. 🎯 **Phase 4**: Add universal support (NEXT)
3. 🎯 **Phase 5-7**: Navigation, forms, advanced features

**Key Principles**:
- **Progressive Enhancement** - Add platforms incrementally
- **Platform Optimization** - Native feel on each platform
- **Shared Logic** - Write business logic once
- **Component Ownership** - You control the code

**Start small. Button first. Then expand.**

The universal future is within reach. 🚀
