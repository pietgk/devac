/**
 * Spec Review Templates
 *
 * Prompt templates for multi-model spec review workflow.
 * Each template is a function that receives context and returns a prompt string.
 */

export interface SpecReviewContext {
  specPath: string; // Full path to current spec
  specVersion: string; // e.g., "9.2"
  nextVersion: string; // e.g., "9.3"
  reviewOutputDir: string; // Where to write review files
  specBaseName: string; // e.g., "devac-validate-basics-spec"
}

/**
 * Extract short model name for filenames
 * e.g., "claude-opus-4.5" → "claude", "gpt-5.1-codex-max" → "gpt"
 */
export const getShortModelName = (model: string): string => {
  if (model.startsWith("claude")) return "claude";
  if (model.startsWith("gpt")) return "gpt";
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("grok")) return "grok";
  return model.split("-")[0] ?? model;
};

/**
 * Review prompt - sent to each model to generate a review
 */
export const reviewPrompt = (
  ctx: SpecReviewContext,
  shortModelName: string
): string => `@${ctx.specPath}
Can you do a very thorough review of the spec.
Determine its quality, are there any flaws, bugs, overlaps and or inconsistencies.
You can store your answer in ${ctx.reviewOutputDir}/${ctx.specBaseName}-v${ctx.specVersion}-review-${shortModelName}.md`;

/**
 * Recap prompt - consolidates all reviews into a single recap
 */
export const recapPrompt = (
  ctx: SpecReviewContext,
  reviewFiles: string[]
): string => `we created ${reviewFiles.length} reviews
${reviewFiles.join("\n")}

can you create a recap of all these reviews as file ${ctx.reviewOutputDir}/${ctx.specBaseName}-v${ctx.specVersion}-review-recap.md this to enable me to get an understanding of all the reviews together.
Focus on the most important issues and recommendations for improving the spec.
Make sure to include concrete recommendations for improvements to the spec.
The recap should be concise but thorough.`;

/**
 * Next version prompt - creates new spec version from current + recap
 */
export const nextVersionPrompt = (ctx: SpecReviewContext): string => `use ${ctx.specPath}
and ${ctx.reviewOutputDir}/${ctx.specBaseName}-v${ctx.specVersion}-review-recap.md

follow the recommendations in the review recap
to create the updated spec v${ctx.nextVersion} as file ${ctx.reviewOutputDir}/${ctx.specBaseName}-v${ctx.nextVersion}.md

try to limit references and make it as self contained as possible

Think very hard about the updated spec and make sure to create a very high quality v${ctx.nextVersion} spec
create this updated spec as file ${ctx.reviewOutputDir}/${ctx.specBaseName}-v${ctx.nextVersion}.md`;
