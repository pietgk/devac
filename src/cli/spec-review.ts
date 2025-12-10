import { Command } from "commander";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { createContextLogger } from "../utils/logger.js";
import {
  SpecReviewContext,
  reviewPrompt as validateReviewPrompt,
  recapPrompt as validateRecapPrompt,
  nextVersionPrompt as validateNextVersionPrompt,
  getShortModelName,
} from "./templates/spec-review.templates.js";
import {
  DevacSpecReviewContext,
  reviewPrompt as devacReviewPrompt,
  recapPrompt as devacRecapPrompt,
  nextVersionPrompt as devacNextVersionPrompt,
} from "./templates/devac-spec.templates.js";

const logger = createContextLogger("SpecReview");

interface SpecReviewOptions {
  from: string;
  to: string;
  template: string;
  specPattern?: string;
  reviewsOnly: boolean;
  models: string;
  recapModel: string;
  docsDir: string;
}

type TemplateType = "devac-validate-basics-spec" | "devac-spec";

const TEMPLATE_DEFAULTS: Record<TemplateType, string> = {
  "devac-validate-basics-spec": "devac-validate-basics-spec",
  "devac-spec": "devac-spec",
};

/**
 * Verify that an expected file was created after copilot execution.
 * Logs warning with prompt for manual retry if file is missing.
 */
function verifyFileCreated(
  filePath: string,
  prompt: string,
  context: string
): boolean {
  if (existsSync(filePath)) {
    logger.info(`✓ ${context}: File created successfully`);
    return true;
  }
  logger.warn(`⚠️ ${context}: Expected file was NOT created: ${filePath}`);
  logger.warn("The model may have hallucinated the file write.");
  logger.warn("");
  logger.warn("=== PROMPT FOR MANUAL RETRY ===");
  console.log(prompt);
  logger.warn("================================");
  logger.warn("");
  return false;
}

/**
 * Execute copilot CLI with prompt via stdin
 * Equivalent to: echo "prompt" | copilot --model <model>
 */
async function runCopilot(prompt: string, model: string): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.debug(
      `Spawning copilot --model ${model} --allow-all-tools --allow-all-paths`,
    );

    const proc = spawn(
      "copilot",
      ["--model", model, "--allow-all-tools", "--allow-all-paths"],
      {
        stdio: ["pipe", "inherit", "inherit"],
        shell: false,
      },
    );

    proc.stdin.write(prompt);
    proc.stdin.end();

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn copilot: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`copilot --model ${model} exited with code ${code}`));
      }
    });
  });
}

export function registerSpecReviewCommand(program: Command): void {
  program
    .command("spec-review")
    .description("Automate multi-model spec review workflow")
    .requiredOption("--from <version>", "Current spec version (e.g., 9.2)")
    .requiredOption("--to <version>", "Target spec version (e.g., 9.3)")
    .option(
      "--template <type>",
      "Template type: devac-spec or devac-validate-basics-spec",
      "devac-spec",
    )
    .option(
      "--spec-pattern <pattern>",
      "Spec file base name (defaults to template name)",
    )
    .option(
      "--reviews-only",
      "Generate reviews and recap only, skip next version",
      false,
    )
    .option(
      "--models <models>",
      "Comma-separated models for reviews",
      "claude-opus-4.5,gpt-5.1-codex-max,gemini-3-pro-preview",
    )
    .option(
      "--recap-model <model>",
      "Model for recap generation",
      "claude-opus-4.5",
    )
    .option("--docs-dir <dir>", "Docs directory", "docs/development")
    .action(async (options: SpecReviewOptions) => {
      const {
        from,
        to,
        template,
        specPattern,
        reviewsOnly,
        models,
        recapModel,
        docsDir,
      } = options;

      // Derive spec pattern from template if not specified
      const templateType = template as TemplateType;
      const effectiveSpecPattern =
        specPattern ?? TEMPLATE_DEFAULTS[templateType] ?? template;

      const ctx: SpecReviewContext | DevacSpecReviewContext = {
        specPath: `${docsDir}/${effectiveSpecPattern}-v${from}.md`,
        specVersion: from,
        nextVersion: to,
        reviewOutputDir: docsDir,
        specBaseName: effectiveSpecPattern,
      };

      // Select prompts based on template type
      const isDevacSpec = templateType === "devac-spec";
      const reviewPrompt = isDevacSpec ? devacReviewPrompt : validateReviewPrompt;
      const recapPrompt = isDevacSpec ? devacRecapPrompt : validateRecapPrompt;
      const nextVersionPrompt = isDevacSpec
        ? devacNextVersionPrompt
        : validateNextVersionPrompt;

      const reviewModels = models.split(",").map((m: string) => m.trim());

      logger.info(`Starting spec review workflow: v${from} → v${to}`);
      logger.info(`Template: ${templateType}`);
      logger.info(`Spec: ${ctx.specPath}`);
      logger.info(`Review models: ${reviewModels.join(", ")}`);

      // Step 1: Generate reviews (sequential to avoid conflicts)
      logger.info(
        `Generating ${reviewModels.length} reviews for spec v${from}...`,
      );
      for (const model of reviewModels) {
        const shortName = getShortModelName(model);
        const prompt = reviewPrompt(ctx, shortName);
        const reviewFilePath = `${docsDir}/${effectiveSpecPattern}-v${from}-review-${shortName}.md`;
        logger.info(
          `Running review with ${model} (output: *-review-${shortName}.md)...`,
        );
        await runCopilot(prompt, model);
        verifyFileCreated(reviewFilePath, prompt, `Review (${model})`);
      }

      // Step 2: Generate recap
      const reviewFiles = reviewModels.map(
        (m: string) =>
          `${docsDir}/${effectiveSpecPattern}-v${from}-review-${getShortModelName(m)}.md`,
      );
      const recapFilePath = `${docsDir}/${effectiveSpecPattern}-v${from}-review-recap.md`;
      const recapPromptText = recapPrompt(ctx, reviewFiles);
      logger.info(`Generating review recap with ${recapModel}...`);
      await runCopilot(recapPromptText, recapModel);
      verifyFileCreated(recapFilePath, recapPromptText, "Recap");

      if (reviewsOnly) {
        logger.info("Reviews and recap complete (--reviews-only specified)");
        logger.info("");
        logger.info("=== PROMPT TO CREATE NEXT VERSION ===");
        logger.info("Copy the following prompt to create the next version when ready:");
        logger.info("");
        console.log(nextVersionPrompt(ctx));
        logger.info("");
        logger.info("======================================");
        return;
      }

      // Step 3: Generate next version
      const nextVersionFilePath = `${docsDir}/${effectiveSpecPattern}-v${to}.md`;
      const nextVersionPromptText = nextVersionPrompt(ctx);
      logger.info(`Generating spec v${to} with ${recapModel}...`);
      await runCopilot(nextVersionPromptText, recapModel);
      verifyFileCreated(nextVersionFilePath, nextVersionPromptText, "Next Version");

      logger.info(`Spec review workflow complete: v${from} → v${to}`);
    });
}
