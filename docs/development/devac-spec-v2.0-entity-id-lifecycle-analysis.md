# Entity ID Lifecycle Analysis: Branch-Aware Scenarios

**Date:** 2025-12-13  
**Purpose:** Thorough analysis of entity ID behavior across all branch and file change scenarios  
**Status:** DRAFT - Needs Resolution  
**Criticality:** HIGH - Core design decision affecting nodes, edges, and external_refs

---

## Executive Summary

The current entity ID format proposal:
```
{repo}:{branch}:{package_path}:{kind}:{content_hash}
```

Where `content_hash = sha256(filePath + name + startLine + kind)`

This document analyzes **all scenarios** where entity IDs interact with branch operations and file changes to ensure the design is sound and handles edge cases elegantly.

---

## 1. The Core Problem

### 1.1 Entity ID Components

Current proposal:
```
entity_id = {repo}:{branch}:{package_path}:{kind}:{content_hash}
content_hash = sha256(filePath + ":" + name + ":" + startLine + ":" + kind).slice(0, 8)
```

**The content_hash includes `startLine`**, which means:
- If a function moves down 5 lines → **different content_hash → different entity_id**
- Same logical function, different ID

### 1.2 Why This Matters

Edges reference entities by `entity_id`. If entity IDs change unexpectedly:
- Edges become **dangling references**
- Historical tracking breaks
- Cross-branch comparisons fail
- "Who calls this function?" queries return incomplete results

---

## 2. Scenario Categories

### Category A: Single Branch Scenarios
- A1: File unchanged
- A2: Function body modified (no signature change)
- A3: Function renamed
- A4: Function moved within file (lines shift)
- A5: Function deleted
- A6: New function added
- A7: File renamed
- A8: File moved to different directory
- A9: Code above function changes (function shifts down)

### Category B: Multi-Branch Scenarios
- B1: Create feature branch (no changes yet)
- B2: Modify function on feature branch
- B3: Same function modified differently on two branches
- B4: Function exists on main, deleted on feature
- B5: New function added only on feature branch
- B6: Merge feature → main
- B7: Rebase feature onto updated main

### Category C: Edge Reference Scenarios
- C1: Edge within same file
- C2: Edge across files in same package
- C3: Edge across packages in same repo
- C4: Edge across repos
- C5: Edge to external dependency (npm package)
- C6: Edge target moves/renames

### Category D: External Reference Scenarios
- D1: Import from same package
- D2: Import from different package
- D3: Import from external npm package
- D4: Import target renamed
- D5: Import path changes due to refactor

---

## 3. Detailed Scenario Analysis

### Category A: Single Branch Scenarios

#### A1: File Unchanged
```
State: src/auth.ts not modified since last analysis
Expected: All entity_ids remain identical
Result: ✅ No issues
```

#### A2: Function Body Modified (No Signature Change)
```typescript
// Before
function handleLogin(user: string) {
  console.log("login");
}

// After  
function handleLogin(user: string) {
  console.log("login");
  trackEvent("login"); // Added line
}
```

```
entity_id components:
- filePath: src/auth.ts (unchanged)
- name: handleLogin (unchanged)
- startLine: 10 (unchanged)
- kind: function (unchanged)

Result: ✅ entity_id unchanged - CORRECT
```

#### A3: Function Renamed
```typescript
// Before
function handleLogin(user: string) { }

// After
function processLogin(user: string) { }
```

```
entity_id components:
- name: handleLogin → processLogin (CHANGED)

Result: NEW entity_id created
Old entity_id: repo:main:pkg:function:abc123
New entity_id: repo:main:pkg:function:def456

Question: What happens to edges pointing to old entity_id?
```

**ISSUE IDENTIFIED:** Edges referencing `handleLogin` now point to non-existent entity.

#### A4: Function Moved Within File
```typescript
// Before (line 10)
function handleLogin() { }

// After (line 25) - moved down due to new code above
function handleLogin() { }
```

```
entity_id components:
- startLine: 10 → 25 (CHANGED)

Result: NEW entity_id even though function is logically the same!
```

**ISSUE IDENTIFIED:** Line number changes break entity ID stability.

#### A5: Function Deleted
```
Before: function handleLogin exists
After: function handleLogin removed

Result: entity_id no longer exists in new analysis
Edges pointing to it: DANGLING
```

**ISSUE IDENTIFIED:** Need strategy for dangling edge references.

#### A6: New Function Added
```
Before: function not present
After: function handleLogin added at line 10

Result: New entity_id created
Edges: None yet (new function)
```
**Result: ✅ No issues**

#### A7: File Renamed
```
Before: src/auth.ts
After: src/authentication.ts
```

```
entity_id components:
- filePath: src/auth.ts → src/authentication.ts (CHANGED)

Result: ALL entities in file get NEW entity_ids
```

**ISSUE IDENTIFIED:** File rename = mass entity ID changes = mass dangling edges.

#### A8: File Moved to Different Directory
```
Before: src/auth.ts
After: src/services/auth.ts
```

Same as A7 - all entity IDs change.

**ISSUE IDENTIFIED:** Directory restructuring breaks all references.

#### A9: Code Above Function Changes (Function Shifts Down)
```typescript
// Before
import { x } from "y";

function handleLogin() { } // Line 3

// After
import { x } from "y";
import { a } from "b"; // New import

function handleLogin() { } // Line 4 (shifted)
```

```
entity_id components:
- startLine: 3 → 4 (CHANGED)

Result: entity_id changes even though function itself unchanged!
```

**ISSUE IDENTIFIED:** This is the most common scenario and it breaks entity IDs constantly.

---

### Category B: Multi-Branch Scenarios

#### B1: Create Feature Branch (No Changes Yet)
```
main: function handleLogin at line 10
feature: (just created from main)

main entity_id: repo:main:pkg:function:abc123
feature entity_id: repo:feature:pkg:function:abc123

Note: content_hash is SAME because file content is identical
Only branch differs in entity_id
```

**Question:** Is this correct? Same logical function has different entity_id on different branches.

**Answer:** Yes, current entityId proposal has this implicit effect - they're different "instances" in different branch contexts. THe effect implies that creating a branch creates a new set of entityIds even if content is identical. This is not practicle and not desired.

#### B2: Modify Function on Feature Branch
```
main: handleLogin unchanged
feature: handleLogin body modified (no line change)

main entity_id: repo:main:pkg:function:abc123
feature entity_id: repo:feature:pkg:function:abc123

content_hash: SAME (based on location, not content)
```

**Result: ✅** Both branches have their own entity_id, content_hash happens to be same.

#### B3: Same Function Modified Differently on Two Branches
```
main: handleLogin at line 10, version A
feature: handleLogin at line 10, version B

main entity_id: repo:main:pkg:function:abc123
feature entity_id: repo:feature:pkg:function:abc123
```

**Result: ✅** Each branch tracks its own version independently.

#### B4: Function Exists on Main, Deleted on Feature
```
main: handleLogin exists
feature: handleLogin deleted

main entity_id: repo:main:pkg:function:abc123
feature entity_id: (does not exist)

Edges on feature branch pointing to handleLogin: DANGLING
```

**ISSUE:** On feature branch, any edge that called handleLogin is now broken.

#### B5: New Function Added Only on Feature Branch
```
main: processPayment does not exist
feature: processPayment added at line 50

main entity_id: (does not exist)
feature entity_id: repo:feature:pkg:function:xyz789
```

**Result: ✅** New function exists only on feature branch.

#### B6: Merge Feature → Main
```
Before merge:
  main: handleLogin (version A)
  feature: handleLogin (version B, modified)

After merge:
  main: handleLogin (version B)
  
entity_id on main: repo:main:pkg:function:abc123
```

**Question:** The entity_id remains the same (repo:main:...) but content changed. Is this correct?

**Answer:** Yes - the entity_id identifies the "slot" (this function at this location), not the content.

**But wait:** What if merge changes line numbers due to conflict resolution?

```
Before merge: handleLogin at line 10
After merge: handleLogin at line 15 (shifted due to merge)

entity_id CHANGES: repo:main:pkg:function:abc123 → repo:main:pkg:function:def456
```

**ISSUE IDENTIFIED:** Merge can change line numbers, breaking entity IDs.

#### B7: Rebase Feature onto Updated Main
```
Before rebase:
  main: new code added at top
  feature: based on old main

After rebase:
  feature: all line numbers shifted

All entity_ids on feature branch CHANGE
All edges on feature branch: DANGLING
```

**ISSUE IDENTIFIED:** Rebase is destructive to entity ID stability.

---

### Category C: Edge Reference Scenarios

#### C1: Edge Within Same File
```typescript
// src/auth.ts
function validateUser() { }      // entity: repo:main:pkg:function:aaa
function handleLogin() {         // entity: repo:main:pkg:function:bbb
  validateUser();                // edge: bbb → aaa
}
```

```
Edge stored:
{
  source_entity_id: "repo:main:pkg:function:bbb",
  target_entity_id: "repo:main:pkg:function:aaa",
  edge_type: "CALLS"
}
```

**If validateUser moves down 5 lines:**
- validateUser gets NEW entity_id: `repo:main:pkg:function:ccc`
- Edge still points to `aaa` → **DANGLING**

#### C2: Edge Across Files in Same Package
```typescript
// src/auth.ts
import { hashPassword } from "./crypto";
function handleLogin() {
  hashPassword(pwd);  // edge: handleLogin → hashPassword
}

// src/crypto.ts
export function hashPassword() { }
```

Same issues as C1, but now we also have external_ref to consider.

#### C3: Edge Across Packages
```typescript
// packages/web/src/login.ts
import { validateUser } from "@myorg/auth";
validateUser();  // edge: login.handleSubmit → auth.validateUser
```

**If @myorg/auth refactors and validateUser moves:**
- Edge target entity_id changes
- Edge becomes DANGLING
- Need cross-package resolution strategy

#### C4: Edge Across Repos
```typescript
// repo-web: 
import { User } from "@myorg/shared-types";
// edge: repo-web component → repo-shared User type
```

**Questions:**
- When is this edge resolved?
- What if shared-types repo not analyzed yet?
- What if shared-types updates independently?

#### C5: Edge to External Dependency
```typescript
import { useState } from "react";
// edge: MyComponent → react.useState
```

**Question:** Do we create entity_ids for external packages?

**Options:**
1. Don't track edges to external packages (external_ref only)
2. Create synthetic entity_ids for externals
3. Track as unresolved references

#### C6: Edge Target Moves/Renames
```
Before: edge A → B
After: B renamed to C, or B moved

edge A → B is now DANGLING
```

**ISSUE:** Need orphan detection and cleanup strategy.

---

### Category D: External Reference Scenarios

#### D1: Import from Same Package
```typescript
// src/auth.ts
import { hashPassword } from "./crypto";
```

```
external_ref:
{
  source_entity_id: "repo:main:pkg:function:abc",
  module_specifier: "./crypto",
  imported_symbol: "hashPassword",
  resolved_entity_id: "repo:main:pkg:function:xyz"  // After resolution
}
```

**If crypto.ts refactors:**
- `resolved_entity_id` becomes invalid
- Need re-resolution

#### D2: Import from Different Package
```typescript
// packages/web/src/login.ts
import { validateUser } from "@myorg/auth";
```

```
external_ref:
{
  source_entity_id: "repo:main:packages/web:function:abc",
  module_specifier: "@myorg/auth",
  imported_symbol: "validateUser",
  resolved_entity_id: "repo:main:packages/auth:function:xyz"
}
```

**Cross-package resolution complexity.**

#### D3: Import from External npm Package
```typescript
import { useState } from "react";
```

```
external_ref:
{
  source_entity_id: "repo:main:pkg:function:abc",
  module_specifier: "react",
  imported_symbol: "useState",
  resolved_entity_id: null,  // External - cannot resolve
  is_external: true
}
```

**Decision:** External deps don't get entity_ids - mark as external.

#### D4: Import Target Renamed
```
Before: import { oldName } from "./utils"
After: utils.ts renames oldName → newName

external_ref resolved_entity_id: INVALID
```

#### D5: Import Path Changes Due to Refactor
```
Before: import { x } from "./utils"
After: import { x } from "./helpers/utils"

Same function, different import path
external_ref needs re-resolution
```

---

## 4. Identified Issues Summary

| Issue ID | Scenario | Problem | Severity |
|----------|----------|---------|----------|
| **I1** | A4, A9 | Line number changes break entity_id | CRITICAL |
| **I2** | A3 | Function rename = new entity_id = dangling edges | HIGH |
| **I3** | A7, A8 | File rename/move = all entity_ids change | HIGH |
| **I4** | A5, B4 | Deleted entities leave dangling edges | MEDIUM |
| **I5** | B6, B7 | Merge/rebase can shift lines = entity_id changes | HIGH |
| **I6** | C1-C4 | Edge targets can become invalid | HIGH |
| **I7** | D1-D5 | External refs need re-resolution on changes | MEDIUM |

---

## 5. Potential Solutions

### Solution 1: Remove Line Number from Content Hash

**Current:**
```
content_hash = sha256(filePath + name + startLine + kind)
```

**Proposed:**
```
content_hash = sha256(filePath + name + kind)
```

**Pros:**
- Entity ID stable when code above changes
- Entity ID stable through merge/rebase

**Cons:**
- **COLLISION:** Two functions with same name in same file get same ID!
```typescript
// src/utils.ts
function helper() { }  // line 10
function helper() { }  // line 20 - SAME entity_id!
```

**Verdict:** ❌ Not viable without additional disambiguation.

### Solution 2: Use Qualified Name Instead of Line Number

**Proposed:**
```
content_hash = sha256(filePath + qualifiedName + kind)
```

Where `qualifiedName` includes parent scope:
- `handleLogin` → `handleLogin`
- `UserService.handleLogin` → `UserService.handleLogin`
- `module.exports.helper` → `module.exports.helper`

**Pros:**
- Stable through line changes
- Naturally disambiguates methods in different classes

**Cons:**
- Anonymous functions still problematic
- Nested functions need special handling
- Overloaded functions (same name, different signatures)

**Verdict:** 🟡 Promising, but needs refinement.

### Solution 3: Content-Based Hashing (Hash Function Body)

**Proposed:**
```
content_hash = sha256(filePath + name + normalizedBody)
```

Where `normalizedBody` = function body with whitespace/comments stripped.

**Pros:**
- Same function = same ID regardless of location
- Detects actual code changes

**Cons:**
- Any code change = new entity_id (opposite problem!)
- Refactoring that doesn't change behavior still changes ID
- Computationally expensive

**Verdict:** ❌ Too volatile - changes too often.

### Solution 4: Hybrid - Qualified Name + Signature Hash

**Proposed:**
```
content_hash = sha256(filePath + qualifiedName + kind + signatureHash)
```

Where `signatureHash` = hash of parameter types and return type.

**Pros:**
- Stable through body changes
- Disambiguates overloads
- Survives line number changes

**Cons:**
- Parameter type changes = new ID (but this might be correct?)
- Anonymous functions still need handling

**Example:**
```typescript
class UserService {
  handleLogin(user: string): boolean { }
  handleLogin(userId: number): boolean { }  // Different signature = different ID
}
```

**Verdict:** 🟡 Good candidate.

### Solution 5: Stable ID with Version Tracking

**Proposed:**
```
entity_id = sha256(filePath + qualifiedName + kind)  // Stable base
version_hash = sha256(startLine + signature + bodyHash)  // Changes tracked separately
```

Schema:
```sql
CREATE TABLE nodes (
  entity_id VARCHAR NOT NULL,       -- Stable identifier
  version_hash VARCHAR NOT NULL,    -- Current version snapshot
  ...
);
```

**Pros:**
- Entity ID is maximally stable
- Version changes tracked separately
- Edges always valid (target stable ID)

**Cons:**
- Two functions with same name in same file still collide
- More complex schema

**Verdict:** 🟡 Interesting, but collision issue remains.

### Solution 6: Parent-Scoped Disambiguation

**Proposed:**
```
For top-level: content_hash = sha256(filePath + name + kind)
For nested: content_hash = sha256(filePath + parentChain + name + kind)
```

Where `parentChain` = `ClassName.methodName` or `outerFunction.innerFunction`

**Example:**
```typescript
// Top-level functions - disambiguated by name only
function handleLogin() { }  // filePath:handleLogin:function

// Class methods - include class name
class AuthService {
  handleLogin() { }  // filePath:AuthService.handleLogin:method
}

class PaymentService {
  handleLogin() { }  // filePath:PaymentService.handleLogin:method
}

// Nested functions - include parent chain
function outer() {
  function inner() { }  // filePath:outer.inner:function
}
```

**Pros:**
- Stable through line changes
- Natural disambiguation via scope
- Matches how developers think about code

**Cons:**
- Multiple anonymous functions at same scope level
- Arrow functions assigned to variables

**Handling anonymous functions:**
```typescript
const handlers = [
  () => console.log("a"),  // filePath:handlers[0]:arrow
  () => console.log("b"),  // filePath:handlers[1]:arrow
];
```

Use array index or sequential number within parent scope.

**Verdict:** ✅ Best candidate so far.

### Solution 7: First-Class Rename/Move Tracking

Instead of trying to keep IDs stable, explicitly track renames:

```sql
CREATE TABLE entity_history (
  current_entity_id VARCHAR NOT NULL,
  previous_entity_id VARCHAR NOT NULL,
  change_type VARCHAR NOT NULL,  -- 'rename', 'move', 'refactor'
  changed_at TIMESTAMP
);
```

**Pros:**
- Full history tracking
- Can trace entity through renames
- Edges can be migrated

**Cons:**
- Complex to maintain
- Requires git-level tracking to detect renames
- History grows unbounded

**Verdict:** 🟡 Useful addition, but doesn't solve core problem.

---

## 6. Recommended Approach

### Primary: Solution 6 (Parent-Scoped Disambiguation)

**Entity ID Format:**
```
{repo}:{branch}:{package}:{kind}:{scope_hash}
```

Where `scope_hash = sha256(filePath + scopedName + kind)`

And `scopedName` is built from:
1. **File-level declarations:** `functionName` or `className`
2. **Class members:** `ClassName.memberName`
3. **Nested functions:** `parentFunction.childFunction`
4. **Anonymous functions:** `parentScope.$anon_N` (where N is index)
5. **Arrow functions in variables:** `variableName` (treated as named)

### Examples:

```typescript
// src/auth.ts

// Top-level function
export function handleLogin() { }
// scopedName: "handleLogin"
// entity_id: repo:main:pkg:function:sha256("src/auth.ts:handleLogin:function")

// Class with methods
class AuthService {
  login() { }
  // scopedName: "AuthService.login"
  // entity_id: repo:main:pkg:method:sha256("src/auth.ts:AuthService.login:method")
  
  logout() { }
  // scopedName: "AuthService.logout"
  // entity_id: repo:main:pkg:method:sha256("src/auth.ts:AuthService.logout:method")
}

// Nested function
function processUser() {
  function validate() { }
  // scopedName: "processUser.validate"
  // entity_id: repo:main:pkg:function:sha256("src/auth.ts:processUser.validate:function")
}

// Arrow function assigned to const
const fetchUser = async () => { };
// scopedName: "fetchUser"
// entity_id: repo:main:pkg:function:sha256("src/auth.ts:fetchUser:function")

// Anonymous functions (callbacks)
users.map((user) => user.name);
// scopedName: "users.map.$anon_0"  (or use parent function scope)
// entity_id: repo:main:pkg:arrow:sha256("src/auth.ts:users.map.$anon_0:arrow")

// Multiple anonymous at same call site
Promise.all([
  () => fetch("/a"),  // $anon_0
  () => fetch("/b"),  // $anon_1
]);
```

### Handling Remaining Edge Cases

#### Same-named functions at file level (rare but possible)
```typescript
// This is invalid TypeScript - duplicate identifier error
function helper() { }
function helper() { }  // Compiler error!
```
**Resolution:** TypeScript/most languages prevent this. Not an issue.

#### Function overloads (TypeScript)
```typescript
function process(x: string): string;
function process(x: number): number;
function process(x: any): any { }
```
**Resolution:** Overload signatures share the implementation's entity_id. Track overloads as properties.

#### Renamed functions
```typescript
// Before
function oldName() { }

// After
function newName() { }
```
**Resolution:** This IS a new entity. The old one no longer exists. Edges to old name become dangling. This is **correct behavior** - the function was renamed, callers need to update.

#### File renamed
```
Before: src/auth.ts
After: src/authentication.ts
```
**Resolution:** All entities get new IDs. This is correct - file path is part of identity. Use git rename detection + history table (Solution 7) to track.

---

## 7. Updated Schema

### Node Schema
```sql
CREATE TABLE nodes (
  -- Identity
  entity_id VARCHAR NOT NULL,        -- {repo}:{branch}:{pkg}:{kind}:{scope_hash}
  logical_id VARCHAR NOT NULL,       -- {repo}:{pkg}:{kind}:{scope_hash} (no branch)
  branch VARCHAR NOT NULL,
  
  -- Scope information (for debugging/display)
  scoped_name VARCHAR NOT NULL,      -- "AuthService.login", "processUser.validate"
  
  -- Location (informational, NOT part of ID)
  file_path VARCHAR NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  
  -- Rest of schema...
);
```

### Edge Schema
```sql
CREATE TABLE edges (
  id VARCHAR NOT NULL,
  source_entity_id VARCHAR NOT NULL,
  target_entity_id VARCHAR NOT NULL,
  
  -- Logical IDs for cross-branch analysis
  source_logical_id VARCHAR NOT NULL,
  target_logical_id VARCHAR NOT NULL,
  
  edge_type VARCHAR NOT NULL,
  
  -- Resolution tracking
  is_resolved BOOLEAN DEFAULT FALSE,
  resolution_status VARCHAR,  -- 'resolved', 'dangling', 'external'
  
  properties JSON
);
```

### Entity History (Optional - for rename tracking)
```sql
CREATE TABLE entity_history (
  id VARCHAR NOT NULL,
  branch VARCHAR NOT NULL,
  
  current_entity_id VARCHAR NOT NULL,
  previous_entity_id VARCHAR,
  
  change_type VARCHAR NOT NULL,  -- 'created', 'modified', 'renamed', 'moved', 'deleted'
  
  -- For renames/moves
  old_scoped_name VARCHAR,
  new_scoped_name VARCHAR,
  old_file_path VARCHAR,
  new_file_path VARCHAR,
  
  detected_at TIMESTAMP,
  git_commit VARCHAR
);
```

---

## 8. Edge Resolution Strategy

### On Analysis (Structural Pass)
1. Generate entity_ids using scoped names (stable)
2. Store edges with `is_resolved = false`
3. External refs stored with `module_specifier` and `imported_symbol`

### On Resolution (Semantic Pass)
1. For each unresolved edge:
   - Look up target by `scoped_name` in target file's nodes
   - If found: set `target_entity_id`, `is_resolved = true`
   - If not found: set `resolution_status = 'dangling'`

2. For each external_ref:
   - Resolve module specifier to file path
   - Look up exported symbol in target package
   - If found: set `resolved_entity_id`
   - If external package: set `is_external = true`

### On Re-analysis (File Changed)
1. Re-parse changed file, generate new nodes
2. For edges WHERE source is in changed file:
   - Re-resolve targets (they may have new entity_ids)
3. For edges WHERE target is in changed file:
   - Check if target entity_id still exists
   - If not: mark as `dangling`

### Dangling Edge Cleanup
Options:
1. **Keep dangling edges** with status - useful for "what broke?" analysis
2. **Delete dangling edges** - cleaner but loses information
3. **Archive dangling edges** to history table

**Recommendation:** Keep with status, periodic cleanup of old dangling edges.

---

## 9. Validation Checklist

For the proposed solution to be accepted, verify:

- [ ] Entity ID stable when code above function changes (no line number in hash)
- [ ] Entity ID stable through merge/rebase (scoped name doesn't change)
- [ ] Two functions with same name in different classes get different IDs
- [ ] Nested functions get unique IDs
- [ ] Anonymous functions get deterministic IDs
- [ ] File rename = new entity IDs (correct behavior)
- [ ] Function rename = new entity ID (correct behavior)
- [ ] Edges can be resolved across files
- [ ] Edges can be resolved across packages
- [ ] Dangling edges are detected and tracked
- [ ] Cross-branch queries work with logical_id

---

## 10. Open Questions - Research Findings

### Research Sources

The following industry tools and protocols were analyzed:
- **[SCIP (Sourcegraph Code Intelligence Protocol)](https://github.com/sourcegraph/scip)** - Modern code indexing format
- **[Kythe (Google)](https://kythe.io/docs/schema/)** - Semantic code graph system
- **[TypeScript Compiler API](https://github.com/microsoft/TypeScript/issues/55433)** - Symbol handling for anonymous entities
- **[Language Server Protocol (LSP)](https://microsoft.github.io/language-server-protocol/)** - IDE symbol resolution

---

### Question 1: Anonymous Function Indexing

**Original Question:** Should index be based on AST order or source order? What if refactoring reorders them?

**Research Findings:**

**SCIP Approach:**
SCIP uses "local symbols" for entities that are local to a document and cannot be accessed from outside. Format: `local <simple-identifier>`. The key insight from SCIP:
> "The decision between local and global symbols depends exclusively on accessibility outside the document."

**Kythe Approach:**
Kythe uses VNames with a signature field. For indexed entities, they use patterns like `"foo#0"` meaning "the zeroth binding of foo." Key principle:
> "VNames should be generated without reference to source locations when possible."
> "Indexing the same compilation unit twice should always produce the same data."

**TypeScript Compiler Insight:**
From [TypeScript Issue #55433](https://github.com/microsoft/TypeScript/issues/55433):
> "For anonymous nodes there doesn't seem to be a way to get Symbol... My current workaround is `ts.getTypeAtLocation(node).symbol`"

**Recommendation for DevAC:**

Anonymous functions are **always assigned to something**:
1. Variable: `const fn = () => {}`
2. Function argument: `array.map(() => {})`
3. Object property: `{ onClick: () => {} }`
4. Array element: `[() => {}, () => {}]`

**Strategy: Use the assignment target as the identifier**

```typescript
// Variable assignment - use variable name
const fetchUser = () => {};
// scopedName: "fetchUser"

// Function argument - use function.parameter pattern
users.map((user) => user.name);
// scopedName: "users.map.$callback" or "users.map.$arg0"

// Object property - use property name
const handlers = {
  onClick: () => console.log("click"),
  onHover: () => console.log("hover")
};
// scopedName: "handlers.onClick", "handlers.onHover"

// Array element - use index
const callbacks = [
  () => fetch("/a"),  // scopedName: "callbacks.$0"
  () => fetch("/b"),  // scopedName: "callbacks.$1"
];

// Nested anonymous - chain the context
Promise.all([
  fetch("/a").then(() => parse()),  // scopedName: "Promise.all.$0.then.$callback"
]);
```

**Key Decision: AST Order, Not Source Order**

Use AST traversal order (depth-first) for indexing, not source line order. This ensures:
- Deterministic across re-parses
- Stable through whitespace/comment changes
- Consistent with how compilers see the code

**Edge Case: IIFE (Immediately Invoked Function Expression)**
```typescript
(function() { console.log("init"); })();
// scopedName: "$iife_0" (index of IIFE in file)
```

---

### Question 2: Variable Reassignment

**Original Question:** Do both functions get same entity_id?
```typescript
let handler = () => {};
handler = () => {};  // Same variable, different function
```

**Research Findings:**

**Key Insight from SCIP:**
> "Local symbols MUST only be used for entities which are local to a Document."

Each function expression is a distinct entity at the AST level.

**Recommendation:**

**Each assignment creates a distinct entity.** The variable name alone is insufficient.

Use **assignment index** to disambiguate:

```typescript
let handler = () => {};        // scopedName: "handler$0"
handler = () => {};            // scopedName: "handler$1"
handler = function named() {}; // scopedName: "named" (has explicit name)
```

**Rationale:**
1. Each arrow function is a distinct closure with potentially different behavior
2. Static analysis tools need to track which version is being called
3. Edges should point to specific function instances, not "whichever is currently assigned"

**Alternative Considered (Rejected):**
Using only `"handler"` would mean edges can't distinguish between versions, losing precision for call graph analysis.

---

### Question 3: Computed Property Names

**Original Question:** What scopedName for `[key]()` methods?
```typescript
const key = "dynamic";
class Foo {
  [key]() { }  // scopedName = ???
}
```

**Research Findings:**

**TypeScript Constraints:**
From [TypeScript documentation](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-9.html):
> "A computed property name in a class property declaration must have a simple literal type or a 'unique symbol' type."

TypeScript **cannot statically resolve** computed property names at compile time if they depend on runtime values.

**Recommendation:**

**Use the syntactic form, not the resolved value:**

```typescript
const key = "dynamic";
class Foo {
  [key]() { }  // scopedName: "Foo.[key]"
}

// With Symbol
const sym = Symbol("myMethod");
class Bar {
  [sym]() { }  // scopedName: "Bar.[sym]"
}

// With literal (can be resolved)
class Baz {
  ["literalName"]() { }  // scopedName: "Baz.literalName"
}
```

**Rationale:**
1. We're doing static analysis - we see `[key]`, not `"dynamic"`
2. Using the variable name `[key]` is deterministic and stable
3. String literals in brackets CAN be resolved: `["foo"]` → `"foo"`
4. The value of `key` might change between runs; the syntax won't

**Edge Case: Complex Expressions**
```typescript
class Complex {
  [getKey()]() { }      // scopedName: "Complex.[getKey()]"
  [a + b]() { }         // scopedName: "Complex.[a + b]" or "Complex.$computed_0"
}
```

For complex expressions, either preserve the expression text (if short) or use indexed placeholder.

---

### Question 4: Decorator-Modified Functions

**Original Question:** Does decorator affect identity?
```typescript
@memoize
function expensiveCalc() { }
```

**Research Findings:**

**Python Best Practice:**
Python's `functools.wraps` explicitly exists to **preserve function identity** through decoration:
> "`functools.wraps` preserves the original function's metadata, such as its name and docstring."

**TypeScript 5.0 Decorators:**
From [TypeScript documentation](https://www.typescriptlang.org/docs/handbook/decorators.html):
> "Decorators provide a way to add both annotations and a meta-programming syntax for class declarations and members."
> "Method decorators... run when the method is defined, not when it's called."

**Key Insight:**
Decorators **wrap** the function but don't change its **identity**. The decorated function is still `expensiveCalc`, just with added behavior.

**Recommendation:**

**Decorators do NOT affect entity_id.**

```typescript
@memoize
@log
function expensiveCalc() { }
// scopedName: "expensiveCalc" (unchanged)

class Service {
  @cached
  getData() { }
  // scopedName: "Service.getData" (unchanged)
}
```

**Rationale:**
1. Decorators are metadata/wrappers, not new entities
2. `expensiveCalc` is still called `expensiveCalc`
3. Callers reference the name, not the decorator
4. Following Python's explicit design choice to preserve identity

**Store decorators as properties:**
```sql
-- In nodes table
properties: {
  "decorators": ["memoize", "log"],
  "isDecorated": true
}
```

---

### Question 5: Re-exported Functions

**Original Question:** Which name is canonical?
```typescript
export { handleLogin as login } from "./auth";
```

**Research Findings:**

**Module Resolution Pattern:**
From JavaScript module semantics, re-exports create **aliases**, not new entities.

**SCIP's Symbol Format:**
SCIP uses fully-qualified names that trace back to the original definition. Re-exports are references, not definitions.

**Recommendation:**

**The original definition is canonical. Re-exports are references/aliases.**

```typescript
// auth.ts
export function handleLogin() { }
// entity_id: repo:main:pkg:function:hash("auth.ts:handleLogin:function")
// This is the CANONICAL entity

// index.ts (barrel file)
export { handleLogin as login } from "./auth";
// This creates:
// 1. An external_ref pointing to auth.ts:handleLogin
// 2. Optionally: an Export node for "login" that references the canonical entity
```

**Schema Representation:**

```sql
-- The canonical function (in auth.ts)
INSERT INTO nodes (entity_id, scoped_name, kind, ...)
VALUES ('repo:main:pkg:function:abc', 'handleLogin', 'function', ...);

-- The re-export (in index.ts) - NOT a new entity, but a reference
INSERT INTO external_refs (
  source_file,
  module_specifier,
  imported_symbol,
  export_alias,
  resolved_entity_id,
  is_reexport
) VALUES (
  'index.ts',
  './auth',
  'handleLogin',
  'login',           -- The alias
  'repo:main:pkg:function:abc',  -- Points to canonical
  true
);
```

**Query: "What names can access handleLogin?"**
```sql
SELECT 
  n.scoped_name as canonical_name,
  r.export_alias as alias
FROM nodes n
LEFT JOIN external_refs r ON r.resolved_entity_id = n.entity_id
WHERE n.entity_id = 'repo:main:pkg:function:abc'
  AND r.is_reexport = true;

-- Result:
-- canonical_name | alias
-- handleLogin    | login
```

**Rationale:**
1. One entity, multiple names (like filesystem hard links)
2. Callers of `login` and `handleLogin` call the same function
3. "Find all usages" should find both
4. Edges should point to the canonical entity_id

---

### Question 6 (NEW): Branch in Entity ID - Practical Implications

**Issue Raised in B1:**
> "Creating a branch creates a new set of entityIds even if content is identical. This is not practical and not desired."

**Research Findings:**

**Git's Content-Addressable Storage:**
From [Git internals](https://medium.com/@SK9712/unpacking-git-how-your-codes-history-is-stored-and-tracked-98fd8f022452):
> "Git is fundamentally a content-addressable data storage system based on hashing... Git doesn't care about names or locations — just content."
> "A branch in Git is nothing more than a lightweight pointer to a specific commit."

The same file content has the **same blob hash** regardless of which branch it's on.

**Key Insight:**
If we include branch in entity_id, then:
- `repo:main:pkg:function:abc123` and `repo:feature:pkg:function:abc123` are **different entities**
- But they represent the **exact same code** (same scope_hash)
- This is wasteful and confusing

**Revised Recommendation:**

**Remove branch from entity_id. Use branch ONLY as a storage partition key.**

```
entity_id = {repo}:{package}:{kind}:{scope_hash}
```

NOT:
```
entity_id = {repo}:{branch}:{package}:{kind}:{scope_hash}
```

**How This Works:**

1. **Same entity on multiple branches:**
   - `handleLogin` on `main` → entity_id: `repo:pkg:function:abc123`
   - `handleLogin` on `feature` → entity_id: `repo:pkg:function:abc123` (SAME!)
   - Both stored in branch-specific Parquet files
   - Query specific branch: filter by partition
   - Query all branches: may return duplicates (dedupe by entity_id)

2. **Modified entity on feature branch:**
   - `handleLogin` on `main` (original) → entity_id: `repo:pkg:function:abc123`
   - `handleLogin` on `feature` (renamed to `processLogin`) → entity_id: `repo:pkg:function:def456` (DIFFERENT - name changed)

3. **Cross-branch queries:**
   ```sql
   -- Find all versions of an entity across branches
   SELECT DISTINCT entity_id, branch, scoped_name
   FROM read_parquet('.devac/seed/branch=*/nodes.parquet', hive_partitioning=true)
   WHERE entity_id = 'repo:pkg:function:abc123';
   
   -- Result shows which branches have this entity
   ```

**Schema Update:**

```sql
CREATE TABLE nodes (
  entity_id VARCHAR NOT NULL,       -- NO branch: {repo}:{pkg}:{kind}:{scope_hash}
  branch VARCHAR NOT NULL,          -- Branch is metadata, not identity
  scoped_name VARCHAR NOT NULL,
  file_path VARCHAR NOT NULL,
  ...
  
  -- Composite key for uniqueness within storage
  PRIMARY KEY (entity_id, branch)
);
```

**Rationale:**
1. Aligns with Git's content-addressable philosophy
2. Same code = same entity, regardless of branch
3. Simplifies cross-branch comparison (compare by entity_id)
4. Reduces storage duplication conceptually
5. Branch is a **context**, not part of **identity**

---

## 11. Next Steps

1. **Decide** on Solution 6 (Parent-Scoped) or alternative
==> parent scoping seems to be the best approach based on the analysis
2. **Define** exact scoped name generation rules for each language
==> we already triggered some 'lets research this using' for the typescript context for this that can help with getting there.
3. **Update** research document with final entity ID format
4. **Update** v2.0 spec with new entity ID section
5. **Create** test cases for all scenarios
6. **Implement** scope-based entity ID generation

---

*End of Analysis*
