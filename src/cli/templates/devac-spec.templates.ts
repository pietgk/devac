/**
 * DevAC Spec Review Templates
 *
 * Tailored prompts for architecture/integration spec reviews.
 * Focused on feasibility, component boundaries, and implementation phases.
 */

export interface DevacSpecReviewContext {
  specPath: string; // Full path to current spec
  specVersion: string; // e.g., "1.0"
  nextVersion: string; // e.g., "1.1"
  reviewOutputDir: string; // Where to write review files
  specBaseName: string; // "devac-spec"
}

/**
 * Extract short model name for filenames
 * e.g., "claude-opus-4.5" → "claude", "gpt-5.1-codex-max" → "gpt"
 */
export const getShortModelName = (model: string): string => {
  if (model.startsWith("claude")) return "claude";
  if (model.startsWith("gpt")) return "gpt";
  if (model.startsWith("gemini")) return "gemini";
  return model.split("-")[0] ?? model;
};

/**
 * Review prompt - tailored for architecture/integration specs
 */
export const reviewPrompt = (
  ctx: DevacSpecReviewContext,
  shortModelName: string,
): string => `@${ctx.specPath}

Review this architecture/integration spec thoroughly. Focus on:

1. **Feasibility**: Are the working components correctly identified? Are "broken" components correctly categorized?
2. **Architecture**: Is the two-phase parsing design sound? Are component boundaries clear?
3. **Implementation Phases**: Is the phase ordering correct? Are dependencies between phases identified?
4. **Performance Targets**: Are the <200ms/<100ms targets realistic given the described components?
5. **Missing Pieces**: What's not addressed? Error handling? Rollback scenarios? Failure modes?
6. **Integration Points**: Are FileWatcher→LanguageRouter→Parser→StorageManager connections well-defined?

Think very hard about practical implementation challenges.
Store your review in ${ctx.reviewOutputDir}/${ctx.specBaseName}-v${ctx.specVersion}-review-${shortModelName}.md

IMPORTANT: You MUST write your review to the file specified above. Do not just describe what you would write - actually create the file.`;

/**
 * Recap prompt - synthesize architectural consensus from multiple reviews
 */
export const recapPrompt = (
  ctx: DevacSpecReviewContext,
  reviewFiles: string[],
): string => `We created ${reviewFiles.length} architecture reviews:
${reviewFiles.map((f) => `@${f}`).join("\n")}

Create a consolidated recap that:
1. Identifies where all reviewers AGREE on architectural concerns
2. Highlights where reviewers DISAGREE (these need resolution)
3. Summarizes feasibility assessment consensus
4. Lists prioritized action items for v${ctx.nextVersion}
5. Provides a clear GO/NO-GO recommendation for implementation

Store the recap in ${ctx.reviewOutputDir}/${ctx.specBaseName}-v${ctx.specVersion}-review-recap.md
Think critically about what must be fixed vs nice-to-have improvements.

After finishing the review recap have a very thorough look at the current code and the
just created by you ${ctx.reviewOutputDir}/${ctx.specBaseName}-v${ctx.specVersion}-review-recap.md
and create a comprehensive ${ctx.reviewOutputDir}/${ctx.specBaseName}-v${ctx.specVersion}-review-doc.md with the full simple
comprehensive high quality documentation on how it will work with and without having the CRITICAl, HIGH and MEDIUM fixes applied with diagrams (sequence,
flow, state) needed to make it understandable for me while reviewing it.
This documentation should make the review and its impact understandable and enable me to be able to make the decision needed for the next version of the spec or implementation.

be thorough

IMPORTANT: You MUST write the recap to the file specified above. Do not just describe what you would write - actually create the file.`;

/**
 * Next version prompt - create improved spec from current + recap
 */
export const nextVersionPrompt = (
  ctx: DevacSpecReviewContext,
  reviewFiles: string[],
): string => `Use @${ctx.specPath}
And @${ctx.reviewOutputDir}/${ctx.specBaseName}-v${ctx.specVersion}-review-recap.md

Create v${ctx.nextVersion} of this architecture spec that:
1. Addresses all CRITICAL issues from the recap
2. Clarifies any ambiguous component interfaces
3. Updates implementation phases based on reviewer feedback
4. Keeps the spec self-contained (limit external references)
5. Maintains the practical, concise style of the original

use ${reviewFiles.map((f) => `@${f}`).join("\n")} for the details to address the recap issue that need addressing.

be thorough.

Focus on making the spec implementation-ready.
Store as ${ctx.reviewOutputDir}/${ctx.specBaseName}-v${ctx.nextVersion}.md

IMPORTANT: You MUST write the new spec to the file specified above. Do not just describe what you would write - actually create the file.`;
