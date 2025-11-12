ok lets follow the key recommendations and plan using this review (i copied your answer into file docs/development/devec-status-review-2025-11-12.md)
- the immediate stuff
- and the short term parts focussing on the cli-first approach

Analyze the CodeGraph repository to understand what's needed for:

1. **Code Snippet Extraction for LintService**:
   - Check if `src/devac/services/lint/lint-service.ts` has any snippet extraction
   - Look at how errors are currently stored and formatted
   - Check what the spec says about ±5 line extraction in devac-status-spec.md

2. **Orchestrator Testing Gaps**:
   - Check if `src/devac/orchestrator/__tests__/` directory exists
   - Look at what orchestrator functionality needs testing
   - Review orchestrator.ts to understand critical paths

3. **CLI Command Structure**:
   - Examine existing CLI commands in `src/devac/cli/commands/`
   - Check how they connect to the API/services
   - Look at the CLI registration in `src/devac/cli/index.ts`

4. **Current API Endpoints**:
   - Review `src/devac/web/routes/` to see what exists
   - Check `src/devac/web/server.ts` for route registration
   - Understand what's missing for status aggregation

Provide specific findings about:
- What's already implemented
- What's missing
- File locations and current code structure
- Dependencies between components

Repository: /Users/grop/ws/CodeGraph
