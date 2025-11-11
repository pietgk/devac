#!/usr/bin/env tsx

/**
 * Mindler Open Code UI Generator CLI
 *
 * This CLI copies UI primitive components into your project,
 * giving you full ownership and customization ability.
 *
 * Philosophy: You don't npm install components, you copy and own them.
 *
 * Usage:
 *   npx tsx src/devac/ui-gen/cli.ts add Button
 *   npx tsx src/devac/ui-gen/cli.ts add Card
 *   npx tsx src/devac/ui-gen/cli.ts list
 */

import { Command } from "commander";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Available components
const AVAILABLE_COMPONENTS = ["Button", "Card", "Badge", "Text", "theme"];

const program = new Command();

program
  .name("ui-gen")
  .description("Mindler Open Code UI component generator")
  .version("0.1.0");

program
  .command("list")
  .description("List all available components")
  .action(() => {
    console.log("\n📦 Available components:\n");
    AVAILABLE_COMPONENTS.forEach((component) => {
      console.log(`  • ${component}`);
    });
    console.log("\n💡 Usage: npx tsx src/devac/ui-gen/cli.ts add <component>\n");
  });

program
  .command("add <component>")
  .description("Copy a component from primitives to your project")
  .option(
    "-p, --path <path>",
    "Target directory",
    "./src/devac/web/frontend/components/ui"
  )
  .option("-f, --force", "Overwrite existing component", false)
  .action(async (componentName: string, options) => {
    try {
      // Validate component exists
      if (!AVAILABLE_COMPONENTS.includes(componentName)) {
        console.error(
          `\n❌ Component "${componentName}" not found in primitives\n`
        );
        console.log("📦 Available components:");
        AVAILABLE_COMPONENTS.forEach((c) => console.log(`   • ${c}`));
        console.log("");
        process.exit(1);
      }

      // Paths
      const rootDir = path.join(__dirname, "../../..");
      const sourcePath = path.join(
        rootDir,
        `packages/ui-primitives/src/${componentName}`
      );
      const targetPath = path.join(
        process.cwd(),
        options.path,
        componentName
      );

      // Check source exists
      if (!fs.existsSync(sourcePath)) {
        console.error(
          `\n❌ Source component not found at: ${sourcePath}\n`
        );
        process.exit(1);
      }

      // Check if target already exists
      if (fs.existsSync(targetPath) && !options.force) {
        console.warn(
          `\n⚠️  Component "${componentName}" already exists at ${targetPath}\n`
        );
        console.log("💡 Use --force to overwrite\n");
        process.exit(1);
      }

      // Create target directory
      await fs.ensureDir(path.dirname(targetPath));

      // Copy component
      await fs.copy(sourcePath, targetPath, {
        overwrite: options.force,
        errorOnExist: false,
      });

      console.log(`\n✅ Successfully copied ${componentName}\n`);
      console.log(`📁 Location: ${path.relative(process.cwd(), targetPath)}\n`);
      console.log("📝 Next steps:");
      console.log(
        `   1. Import: import { ${componentName} } from "@/components/ui/${componentName}"`
      );
      console.log(
        `   2. Customize styles in ${componentName}.styles.ts if needed`
      );
      console.log("   3. You now own this component! ✨\n");
    } catch (error) {
      console.error("\n❌ Error copying component:", error);
      process.exit(1);
    }
  });

program
  .command("add-all")
  .description("Copy all components to your project")
  .option(
    "-p, --path <path>",
    "Target directory",
    "./src/devac/web/frontend/components/ui"
  )
  .option("-f, --force", "Overwrite existing components", false)
  .action(async (options) => {
    console.log("\n📦 Copying all components...\n");

    for (const component of AVAILABLE_COMPONENTS) {
      try {
        const rootDir = path.join(__dirname, "../../..");
        const sourcePath = path.join(
          rootDir,
          `packages/ui-primitives/src/${component}`
        );
        const targetPath = path.join(
          process.cwd(),
          options.path,
          component
        );

        if (!fs.existsSync(sourcePath)) {
          console.warn(`⚠️  Skipping ${component} (source not found)`);
          continue;
        }

        if (fs.existsSync(targetPath) && !options.force) {
          console.log(`⏭️  Skipping ${component} (already exists)`);
          continue;
        }

        await fs.ensureDir(path.dirname(targetPath));
        await fs.copy(sourcePath, targetPath, {
          overwrite: options.force,
        });

        console.log(`✅ Copied ${component}`);
      } catch (error) {
        console.error(`❌ Failed to copy ${component}:`, error);
      }
    }

    console.log("\n🎉 All components copied successfully!\n");
  });

program.parse();
