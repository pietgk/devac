import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import fs from "fs/promises";
import { ImportResolver, ImportNode } from "./import-resolver.js";
import { PackageExtractor, PackageInfo } from "./package-extractor.js";

describe("ImportResolver", () => {
  const testWorkspacePath = path.resolve(
    process.cwd(),
    "test_fixtures/import-test-workspace",
  );
  let packages: PackageInfo[];
  let resolver: ImportResolver;

  beforeAll(async () => {
    // Create test workspace
    await fs.mkdir(testWorkspacePath, { recursive: true });

    // Create pnpm-workspace.yaml
    await fs.writeFile(
      path.join(testWorkspacePath, "pnpm-workspace.yaml"),
      `packages:
  - "packages/*"
`,
    );

    // Create package 1: ui-components
    const uiDir = path.join(testWorkspacePath, "packages/ui-components");
    await fs.mkdir(path.join(uiDir, "src"), { recursive: true });

    await fs.writeFile(
      path.join(uiDir, "package.json"),
      JSON.stringify({
        name: "@test/ui-components",
        version: "1.0.0",
        main: "src/index.ts",
      }),
    );

    await fs.writeFile(
      path.join(uiDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "ui/*": ["src/components/*"],
            "hooks/*": ["src/hooks/*"],
          },
        },
      }),
    );

    await fs.writeFile(
      path.join(uiDir, "src/index.ts"),
      "export { Button } from './components/Button';",
    );

    await fs.mkdir(path.join(uiDir, "src/components"), { recursive: true });
    await fs.writeFile(
      path.join(uiDir, "src/components/Button.tsx"),
      "export const Button = () => null;",
    );

    await fs.mkdir(path.join(uiDir, "src/hooks"), { recursive: true });
    await fs.writeFile(
      path.join(uiDir, "src/hooks/useToggle.ts"),
      "export const useToggle = () => {};",
    );

    // Create package 2: app
    const appDir = path.join(testWorkspacePath, "packages/app");
    await fs.mkdir(path.join(appDir, "src"), { recursive: true });

    await fs.writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify({
        name: "@test/app",
        version: "1.0.0",
        main: "src/index.ts",
      }),
    );

    await fs.writeFile(
      path.join(appDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "core/*": ["src/core/*"],
            "@/*": ["src/*"],
          },
        },
      }),
    );

    await fs.mkdir(path.join(appDir, "src/core"), { recursive: true });
    await fs.writeFile(
      path.join(appDir, "src/core/constants.ts"),
      "export const APP_NAME = 'Test';",
    );

    await fs.writeFile(
      path.join(appDir, "src/App.tsx"),
      "export const App = () => null;",
    );

    // Extract packages and create resolver
    const extractor = new PackageExtractor(testWorkspacePath);
    packages = await extractor.discoverPackages();

    // Workspace-level paths
    const workspacePaths = {
      "@/*": ["packages/*/src/*"],
    };

    resolver = new ImportResolver(packages, testWorkspacePath, workspacePaths);
  });

  describe("Workspace Package Imports", () => {
    it("should resolve workspace package import", async () => {
      const importNode: ImportNode = {
        name: "Button",
        importSource: "@test/ui-components",
        isTypeOnly: false,
        isDefault: false,
      };

      const fromFile = path.join(testWorkspacePath, "packages/app/src/App.tsx");
      const resolved = await resolver.resolve(importNode, fromFile);

      expect(resolved).toBeDefined();
      expect(resolved?.resolvedType).toBe("package");
      expect(resolved?.resolvedPath).toContain("ui-components");
      expect(resolved?.resolvedPath).toContain("index.ts");
    });

    it("should resolve workspace package with subpath", async () => {
      const importNode: ImportNode = {
        name: "Button",
        importSource: "@test/ui-components/src/components/Button",
        isTypeOnly: false,
        isDefault: false,
      };

      const fromFile = path.join(testWorkspacePath, "packages/app/src/App.tsx");
      const resolved = await resolver.resolve(importNode, fromFile);

      expect(resolved).toBeDefined();
      expect(resolved?.resolvedType).toBe("package");
      expect(resolved?.resolvedPath).toContain("Button.tsx");
    });
  });

  describe("Relative Imports", () => {
    it("should resolve relative import with extension", async () => {
      const importNode: ImportNode = {
        name: "Button",
        importSource: "./components/Button",
        isTypeOnly: false,
        isDefault: false,
      };

      const fromFile = path.join(
        testWorkspacePath,
        "packages/ui-components/src/index.ts",
      );
      const resolved = await resolver.resolve(importNode, fromFile);

      expect(resolved).toBeDefined();
      expect(resolved?.resolvedType).toBe("file");
      expect(resolved?.resolvedPath).toContain("Button.tsx");
    });

    it("should resolve parent directory import", async () => {
      const importNode: ImportNode = {
        name: "useToggle",
        importSource: "../hooks/useToggle",
        isTypeOnly: false,
        isDefault: false,
      };

      const fromFile = path.join(
        testWorkspacePath,
        "packages/ui-components/src/components/Button.tsx",
      );
      const resolved = await resolver.resolve(importNode, fromFile);

      expect(resolved).toBeDefined();
      expect(resolved?.resolvedType).toBe("file");
      expect(resolved?.resolvedPath).toContain("useToggle.ts");
    });
  });

  describe("Per-Package Path Aliases", () => {
    it("should resolve per-package path alias in ui-components", async () => {
      const importNode: ImportNode = {
        name: "Button",
        importSource: "ui/Button",
        isTypeOnly: false,
        isDefault: false,
      };

      const fromFile = path.join(
        testWorkspacePath,
        "packages/ui-components/src/index.ts",
      );
      const resolved = await resolver.resolve(importNode, fromFile);

      expect(resolved).toBeDefined();
      expect(resolved?.resolvedType).toBe("file");
      expect(resolved?.resolvedPath).toContain("components/Button.tsx");
    });

    it("should resolve per-package path alias in app", async () => {
      const importNode: ImportNode = {
        name: "APP_NAME",
        importSource: "core/constants",
        isTypeOnly: false,
        isDefault: false,
      };

      const fromFile = path.join(testWorkspacePath, "packages/app/src/App.tsx");
      const resolved = await resolver.resolve(importNode, fromFile);

      expect(resolved).toBeDefined();
      expect(resolved?.resolvedType).toBe("file");
      expect(resolved?.resolvedPath).toContain("core/constants.ts");
    });

    it("should handle @ alias with baseUrl", async () => {
      const importNode: ImportNode = {
        name: "App",
        importSource: "@/App",
        isTypeOnly: false,
        isDefault: false,
      };

      const fromFile = path.join(
        testWorkspacePath,
        "packages/app/src/core/constants.ts",
      );
      const resolved = await resolver.resolve(importNode, fromFile);

      expect(resolved).toBeDefined();
      expect(resolved?.resolvedType).toBe("file");
      expect(resolved?.resolvedPath).toContain("App.tsx");
    });
  });

  describe("External Package Imports", () => {
    it("should mark external npm packages as external", async () => {
      const importNode: ImportNode = {
        name: "useState",
        importSource: "react",
        isTypeOnly: false,
        isDefault: false,
      };

      const fromFile = path.join(testWorkspacePath, "packages/app/src/App.tsx");
      const resolved = await resolver.resolve(importNode, fromFile);

      expect(resolved).toBeDefined();
      expect(resolved?.resolvedType).toBe("external");
      expect(resolved?.resolvedPath).toBe("react");
    });

    it("should mark scoped external packages as external", async () => {
      const importNode: ImportNode = {
        name: "styled",
        importSource: "@emotion/styled",
        isTypeOnly: false,
        isDefault: false,
      };

      const fromFile = path.join(testWorkspacePath, "packages/app/src/App.tsx");
      const resolved = await resolver.resolve(importNode, fromFile);

      expect(resolved).toBeDefined();
      expect(resolved?.resolvedType).toBe("external");
      expect(resolved?.resolvedPath).toBe("@emotion/styled");
    });
  });
});
