# DevAC Web UI - Quick Start Guide

**Phase 0: COMPLETE ✅**  
**Ready for:** Phase 1 (Backend) & Phase 2 (Frontend)

---

## 🎯 What You Have Now

### UI Primitives Package
- **Location:** `packages/ui-primitives/`
- **Components:** Button, Card, Badge, Text
- **Theme:** Complete design token system from Figma
- **Quality:** Production-tested from mindlerui

### Component Generator CLI
- **Location:** `src/devac/ui-gen/cli.ts`
- **Purpose:** Copy components into your project (Open Code philosophy)

---

## 🚀 Quick Commands

### List Available Components
```bash
npx tsx src/devac/ui-gen/cli.ts list
```

### Copy a Component
```bash
# Copy Button
npx tsx src/devac/ui-gen/cli.ts add Button

# Copy all components
npx tsx src/devac/ui-gen/cli.ts add-all
```

### Copy to Custom Location
```bash
npx tsx src/devac/ui-gen/cli.ts add Button --path ./my/custom/path
```

### Force Overwrite
```bash
npx tsx src/devac/ui-gen/cli.ts add Button --force
```

---

## 📦 Usage Example

Once you copy components, use them like this:

```typescript
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";

export function ServiceCard({ service }) {
  return (
    <Card variant="elevated">
      <CardHeader>
        <CardTitle>
          <Text variant="h4">{service.name}</Text>
        </CardTitle>
      </CardHeader>
      
      <CardContent>
        <Badge variant={service.status === "running" ? "success" : "default"}>
          {service.status}
        </Badge>
        
        <Text variant="body" color="muted">
          {service.description}
        </Text>
      </CardContent>
      
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Button variant="primary" size="s" onClick={onStart}>
          Start
        </Button>
        <Button variant="secondary" size="s" onClick={onStop}>
          Stop
        </Button>
      </div>
    </Card>
  );
}
```

---

## 🎨 Customization Example

Since you OWN the components, customize them freely:

```typescript
// Edit src/devac/web/frontend/components/ui/Button/Button.styles.ts

// Add a new variant
${({ $variant, theme }) => {
  // ... existing variants ...
  
  if ($variant === "success") {
    return css`
      background: ${theme.colors.success};
      color: white;
      &:hover:not(:disabled) {
        background: #006645; // Darker green
      }
    `;
  }
}}
```

Then use it:
```typescript
<Button variant="success">Success Action</Button>
```

**No forking. No pull requests. Just edit your code.**

---

## 🎯 Next Steps (Phase 1-3)

### Phase 1: Backend (Days 3-4)
Follow `PHASE_3_UI_PLAN_FINAL.md` Section "Task 1: Backend Foundation"

1. Install dependencies
2. Create Express server
3. Implement SSE Manager
4. Add service routes
5. Test health check

### Phase 2: Frontend (Days 4-5)
Follow `PHASE_3_UI_PLAN_FINAL.md` Section "Task 2: Frontend Foundation"

1. Install Next.js + styled-components
2. **Copy UI components:** `npx tsx src/devac/ui-gen/cli.ts add-all`
3. Create DevAC theme (extend primitives)
4. Setup providers (Theme, Query)
5. Create API client

### Phase 3: Dashboard (Week 2)
Follow `PHASE_3_UI_PLAN_FINAL.md` Section "Task 3-4: Dashboard & Components"

1. Build layouts (Command Center, Timeline)
2. Create ServiceCard using owned components
3. Create EventFeed
4. Integration tests

---

## 📚 Documentation

- **Phase 0 Summary:** `PHASE_0_COMPLETE.md`
- **Primitives README:** `packages/ui-primitives/README.md`
- **CLI Guide:** `src/devac/ui-gen/README.md`
- **Full Plan:** `PHASE_3_UI_PLAN_FINAL.md`

---

## 💡 Key Concepts

### "Open Code" Philosophy
- **Don't** `npm install` components
- **Do** copy them into your codebase
- **Result:** Full ownership, zero lock-in

### Why This Matters
1. **Customization:** Edit styles/behavior directly
2. **No Breaking Changes:** You control when to update
3. **AI-Friendly:** Full source visibility
4. **Bundle Size:** Only include what you use
5. **Future-Proof:** Can add React Native variants later

---

## 🎉 You're Ready!

Phase 0 is complete. You have:
- ✅ Production-quality UI primitives
- ✅ Working component generator
- ✅ Complete design system
- ✅ Strategic architecture foundation

**Now:** Start Phase 1 (Backend) or Phase 2 (Frontend)  
**Reference:** `PHASE_3_UI_PLAN_FINAL.md` for step-by-step instructions

---

*Questions? Check `PHASE_0_COMPLETE.md` for detailed explanation.*
