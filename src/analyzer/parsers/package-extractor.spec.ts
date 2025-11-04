import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import fs from "fs/promises";
import { PackageExtractor } from "./package-extractor.js";

describe("PackageExtractor", () => {
  const testWorkspacePath = path.resolve(
    process.cwd(),
    "test_fixtures/test-workspace",
  );

  beforeAll(async () => {
    // Create test workspace structure
    await fs.mkdir(testWorkspacePath, { recursive: true });
    await fs.mkdir(path.join(testWorkspacePath, "packages"), {
      recursive: true,
    });
    await fs.mkdir(path.join(testWorkspacePath, "apps"), { recursive: true });

    // Create pnpm-workspace.yaml
    await fs.writeFile(
      path.join(testWorkspacePath, "pnpm-workspace.yaml"),
      `packages:
  - "packages/*"
  - "apps/*"
`,
    );

    // Create package 1 with package.json
    const pkg1Dir = path.join(testWorkspacePath, "packages", "ui-lib");
    await fs.mkdir(pkg1Dir, { recursive: true });
    await fs.writeFile(
      path.join(pkg1Dir, "package.json"),
      JSON.stringify({
        name: "@test/ui-lib",
        version: "1.0.0",
        main: "src/index.ts",
      }),
    );

    // Create package 2 with package.json
    const pkg2Dir = path.join(testWorkspacePath, "apps", "web-app");
    await fs.mkdir(pkg2Dir, { recursive: true });
    await fs.writeFile(
      path.join(pkg2Dir, "package.json"),
      JSON.stringify({
        name: "@test/web-app",
        version: "1.0.0",
        main: "src/index.ts",
      }),
    );

    // Create a non-package directory (no package.json)
    await fs.mkdir(path.join(testWorkspacePath, "docs"), { recursive: true });
  });

  it("should discover packages from pnpm-workspace.yaml", async () => {
    const extractor = new PackageExtractor(testWorkspacePath);
    const packages = await extractor.discoverPackages();

    expect(packages.length).toBe(2);

    const packageNames = packages.map((p) => p.name).sort();
    expect(packageNames).toEqual(["@test/ui-lib", "@test/web-app"]);
  });

  it("should extract correct package paths", async () => {
    const extractor = new PackageExtractor(testWorkspacePath);
    const packages = await extractor.discoverPackages();

    const uiLib = packages.find((p) => p.name === "@test/ui-lib");
    expect(uiLib).toBeDefined();
    expect(uiLib?.path).toContain("packages/ui-lib");

    const webApp = packages.find((p) => p.name === "@test/web-app");
    expect(webApp).toBeDefined();
    expect(webApp?.path).toContain("apps/web-app");
  });

  it("should extract entry points from package.json", async () => {
    const extractor = new PackageExtractor(testWorkspacePath);
    const packages = await extractor.discoverPackages();

    for (const pkg of packages) {
      expect(pkg.entryPoint).toBeDefined();
      expect(pkg.entryPoint).toContain("src/index.ts");
    }
  });

  it("should map files to their respective packages", async () => {
    const extractor = new PackageExtractor(testWorkspacePath);
    const packages = await extractor.discoverPackages();

    // Create test files
    const uiLibFile = path.join(
      testWorkspacePath,
      "packages/ui-lib/src/Button.tsx",
    );
    const webAppFile = path.join(testWorkspacePath, "apps/web-app/src/App.tsx");

    await fs.mkdir(path.dirname(uiLibFile), { recursive: true });
    await fs.writeFile(uiLibFile, "export const Button = () => null;");

    await fs.mkdir(path.dirname(webAppFile), { recursive: true });
    await fs.writeFile(webAppFile, "export const App = () => null;");

    // Test file-to-package mapping
    const uiLibPkg = packages.find((p) => p.name === "@test/ui-lib");
    const webAppPkg = packages.find((p) => p.name === "@test/web-app");

    expect(uiLibPkg).toBeDefined();
    expect(webAppPkg).toBeDefined();

    // Check that file paths fall within package paths
    const normalizedUiLibFile = path.normalize(uiLibFile).replace(/\\/g, "/");
    const normalizedUiLibPkg = path
      .normalize(uiLibPkg!.path)
      .replace(/\\/g, "/");
    expect(normalizedUiLibFile.startsWith(normalizedUiLibPkg)).toBe(true);

    const normalizedWebAppFile = path.normalize(webAppFile).replace(/\\/g, "/");
    const normalizedWebAppPkg = path
      .normalize(webAppPkg!.path)
      .replace(/\\/g, "/");
    expect(normalizedWebAppFile.startsWith(normalizedWebAppPkg)).toBe(true);
  });

  it("should handle monorepo without workspace file", async () => {
    const noWorkspacePath = path.join(testWorkspacePath, "no-workspace");
    await fs.mkdir(noWorkspacePath, { recursive: true });

    const extractor = new PackageExtractor(noWorkspacePath);
    const packages = await extractor.discoverPackages();

    // Should return empty array or handle gracefully
    expect(Array.isArray(packages)).toBe(true);
  });
});
