i Piet updated CodeGraph/docs/development/devac-spec-v2.0-review-recap.md containing the recap of the review 
of CodeGraph/docs/development/devac-spec-v2.0.md.

the details of these reviews are in 
CodeGraph/docs/development/devac-spec-v2.0-review-claude.md
CodeGraph/docs/development/devac-spec-v2.0-review-gpt.md
CodeGraph/docs/development/devac-spec-v2.0-review-gemini.md
with human understandable docs in CodeGraph/docs/development/devac-spec-v2.0-review-doc.md

lets update the spec with the critical issues C1..C4 resolved first by updating 
CodeGraph/docs/development/devac-spec-v2.0.md as using the git history and diff features feel nicer that crreating new spec files.

be thorough and use the specific reviews to make sure the issues are resolved properly.






i Piet updated CodeGraph/docs/development/devac-spec-v2.0-review-recap.md containing the recap of the review 
of CodeGraph/docs/development/devac-spec-v2.0.md.

the details of these reviews are in 
CodeGraph/docs/development/devac-spec-v2.0-review-claude.md
CodeGraph/docs/development/devac-spec-v2.0-review-gpt.md
CodeGraph/docs/development/devac-spec-v2.0-review-gemini.md
with human understandable docs in CodeGraph/docs/development/devac-spec-v2.0-review-doc.md

i want to have a more thorough understanding why and how we should handle 
the 4.3 HIGH Fixes Summary:

| Fix | Problem | Solution |
|-----|---------|----------|
| **H1: Pass 2 trigger** | When does semantic resolution run? | Debounced background (5s settle) |
| **H2: Lock file format** | Concurrent writes corrupt data | Lock file with PID + timestamp |
| **H3: Parallel parsing** | Batch changes too slow | Parse up to 4 files concurrently |
| **H4: Windows retry** | `fs.rename` fails if file locked | Retry with exponential backoff |
| **H5: Base branch behavior** | Write amplification unclear | Document 300-500ms acceptable |
| **H6: Interface unification** | Spec vs code mismatch | Align `StructuralParseResult` |


for each issue i want to understand the why and how and any alternatives with pros and cons to consider?
This to understand if i agree with the proposed solution and if we really need to do this

make sure to include looking at the already addressed critical issues as for example H1 has overlap with C1

lets plan this first as a research task where we gather the needed information to make an informed decision.