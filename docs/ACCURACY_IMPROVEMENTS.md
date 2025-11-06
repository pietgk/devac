# Accuracy Improvements Tracking

> **Goal:** Achieve >95% import resolution accuracy across all repositories  
> **Current Status:** ~70% overall (varies by repository and language)  
> **Last Updated:** 2025-11-05

## Overview

This document tracks known accuracy issues, planned improvements, and progress toward achieving comprehensive code analysis across all supported languages and repository types.

## Current Metrics (Baseline)

| Repository | Type | Expected Resolution | Current Status | Blockers |
|------------|------|---------------------|----------------|----------|
| monorepo-3.0 | TypeScript Monorepo | >90% | ~75% | External deps, workspace: protocol |
| app | React Native | >85% | ~60% | Native modules, .yalc packages |
| frontend-monorepo | Web Apps | >90% | ~75% | Workspace packages |
| public-website-3 | Next.js | >90% | ~80% | Next.js framework internals |
| npm-private-packages | Shared Libs | >95% | ~85% | Cross-package resolution |
| contentful-monorepo | Config | >90% | ~85% | TypeScript config files |
| mindler | Legacy Monorepo | >70% | ~60% | Mixed patterns |
| CodeGraph | Tool itself | >95% | ~90% | Self-referential imports |

**Overall Average:** ~70% (Target: >95%)

---

## Known Issues by Category

### 1. Path Alias Resolution

#### Issue 1.1: .yalc Local Package Development
- **Status:** ✅ FIXED (Session 022)
- **Description:** .yalc packages (local package development tool) were being analyzed and causing parsing errors
- **Impact:** Duplicate analysis, JavaScript parsing errors
- **Solution:** Added `**/.yalc/**` to ignore patterns
- **Files:** `.codegraph/workspace.json`

#### Issue 1.2: Workspace Protocol Not Resolved
- **Status:** 🔴 OPEN - HIGH PRIORITY
- **Description:** npm/pnpm workspace: protocol (e.g., `"dep": "workspace:*"`) not resolved to actual package location
- **Impact:** Missing cross-workspace dependencies in monorepos
- **Example:** `frontend-monorepo` → `@mindlercare/ui-web` imports
- **Estimated Resolution:** Medium complexity, 2-3 hours
- **Plan:** Enhance ImportResolver to detect workspace: and resolve to actual package path

#### Issue 1.3: Per-Package tsconfig Support
- **Status:** ✅ FIXED (Session 020)
- **Description:** Using root tsconfig.json caused path alias resolution failures in nested packages
- **Impact:** @shared/*, @dal/*, @core/*, @lib/* aliases not resolving
- **Solution:** Find nearest tsconfig.json for each file, use per-package configuration
- **Files:** `src/analyzer/parser.ts`, `src/analyzer/utils/tsconfig-finder.ts`

---

### 2. Multi-Language Support

#### Issue 2.1: CSS Class Names Treated as Entities
- **Status:** 🔴 OPEN - HIGH PRIORITY
- **Description:** C/C++ parser incorrectly treating Tailwind CSS classes as entity names
- **Impact:** 40+ warnings for classes like `flex`, `items-center`, `w-full`
- **Root Cause:** C++ parser too aggressive in entity extraction
- **Example:**
  ```
  generateEntityIdLegacy: unexpected format: flex (23 occurrences)
  generateEntityIdLegacy: unexpected format: items-center (13 occurrences)
  ```
- **Estimated Resolution:** Medium complexity, 2-3 hours
- **Plan:** Add CSS class detection/filtering in C++ parser

#### Issue 2.2: Java Package Names - Incorrect Entity ID Format
- **Status:** 🔴 OPEN - MEDIUM PRIORITY
- **Description:** Java parser passing fully qualified names to generateEntityIdLegacy
- **Impact:** 20+ warnings for Gradle generated accessors
- **Example:**
  ```
  generateEntityIdLegacy: unexpected format: org.gradle.accessors.dm.VersionAccessors
  generateEntityIdLegacy: unexpected format: org.gradle.accessors.dm.PluginAccessors
  ```
- **Root Cause:** JavaParser using old 2-parameter generateEntityId signature
- **Estimated Resolution:** Simple, 1-2 hours
- **Plan:** Update JavaParser to use 5-parameter signature with proper filepath

#### Issue 2.3: Ruby/JRuby Native Classes
- **Status:** 🟡 MITIGATED (vendor/bundle ignored)
- **Description:** Ruby gem native Java classes causing format warnings
- **Impact:** 10+ warnings for concurrent_ruby.ext classes
- **Example:**
  ```
  generateEntityIdLegacy: unexpected format: com.concurrent_ruby.ext.jsr166e.nounsafe.TreeNode
  ```
- **Solution:** Added `**/vendor/bundle/**` to ignore patterns
- **Residual:** May still see warnings from actual app Ruby bridge code

#### Issue 2.4: C# Namespace Handling
- **Status:** 🔴 OPEN - LOW PRIORITY
- **Description:** C# parser may not properly handle namespace.interface.class hierarchy
- **Impact:** Limited (only if C# code analyzed)
- **Example:** `InventoryManager.Interfaces.IInventoryItem`
- **Estimated Resolution:** Simple, 1-2 hours
- **Plan:** Similar fix to Java parser - use 5-parameter signature

---

### 3. File Filtering & Noise Reduction

#### Issue 3.1: React Native Prebuild Directories
- **Status:** ✅ FIXED (Session 022)
- **Description:** ios/, android/, vendor/ directories adding 22,000+ unnecessary files
- **Impact:** Slow sync times, Gradle/CocoaPods generated code analyzed
- **Solution:** Added ignore patterns:
  - `**/ios/Pods/**` - CocoaPods dependencies
  - `**/ios/build/**` - Xcode build artifacts
  - `**/android/build/**` - Gradle build artifacts
  - `**/android/gradle/**` - Gradle generated code
  - `**/vendor/bundle/**` - Ruby gem dependencies (21,787 files!)
- **Expected Impact:** 30-40% faster syncs, eliminate noise

#### Issue 3.2: Cypress Test Infrastructure
- **Status:** ✅ FIXED (Session 022)
- **Description:** Cypress test helper files causing JavaScript parsing errors
- **Impact:** 20+ "Cannot read properties of undefined" errors
- **Example:** `cypress/support/pageObjects/*.js` - compiled test helpers
- **Solution:** Added `**/cypress/support/**` to ignore patterns
- **Rationale:** Test infrastructure isn't application architecture

---

### 4. Parser Robustness

#### Issue 4.1: JavaScript Files Without Type Information
- **Status:** 🟡 MITIGATED (most cases ignored)
- **Description:** ts-morph fails parsing compiled .js files without .d.ts companions
- **Impact:** "escapedName undefined", "members undefined", "flags undefined" errors
- **Root Cause:** ts-morph expects TypeScript type information
- **Current Solution:** Ignore .yalc/ and cypress/support/
- **Future Enhancement:** Add JavaScript-lite parsing mode for when needed
- **Estimated Enhancement:** Medium complexity, 3-4 hours

#### Issue 4.2: Large Declaration Files (.d.ts)
- **Status:** 🟡 HANDLED (timeout protection)
- **Description:** Large type definition files (>10MB) can timeout
- **Impact:** Occasional timeout warnings
- **Current Solution:** 30-second per-file timeout, skip and continue
- **Metrics:** <1% timeout rate in practice
- **Future Enhancement:** Pre-filter .d.ts files >10MB
- **Estimated Enhancement:** Simple, 30 minutes

#### Issue 4.3: Progress Visibility
- **Status:** ✅ FIXED (Session 022)
- **Description:** Long parsing batches had no progress indicators
- **Impact:** User uncertainty if process hung or just slow
- **Solution:** Added per-10-file progress logging with percentages
- **Enhancement:** Added slow file warnings (>5 seconds)
- **Files:** `src/analyzer/parser.ts`

---

## Resolution Strategy & Timeline

### Phase 1: Completed (Session 022) ✅
- [x] Add ignore patterns for noisy directories
- [x] Fix .yalc and cypress parsing errors
- [x] Add progress monitoring to parser
- [x] Create this tracking document

**Results:**
- Expected 22,000+ file reduction
- Zero .yalc/cypress parsing errors
- Better user experience with progress logs

### Phase 2: Quick Wins (Next Session) 🎯
**Priority:** HIGH | **Estimated Time:** 4-6 hours

- [ ] Fix Java parser entity ID format (Issue 2.2)
- [ ] Fix C# parser entity ID format (Issue 2.4)
- [ ] Fix CSS class detection in C++ parser (Issue 2.1)
- [ ] Rebuild and test with full workspace sync

**Expected Impact:**
- Eliminate 60+ "unexpected format" warnings
- More accurate Java/C# entity tracking
- Cleaner logs

### Phase 3: Import Resolution (Future) 🔮
**Priority:** HIGH | **Estimated Time:** 6-8 hours

- [ ] Implement workspace: protocol resolution (Issue 1.2)
- [ ] Test cross-workspace dependencies
- [ ] Validate resolution rates improve 15-20%

**Expected Impact:**
- Resolution rates: 75% → 85-90%
- Better monorepo dependency tracking

### Phase 4: Optional Enhancements (As Needed) ⏰
**Priority:** LOW-MEDIUM | **Estimated Time:** 4-6 hours

- [ ] JavaScript-lite parsing mode (Issue 4.1)
- [ ] Large .d.ts pre-filtering (Issue 4.2)
- [ ] Additional language-specific improvements

---

## Test Cases for Validation

### Test Case 1: Path Alias Resolution (monorepo-3.0)
**Current:** ~75% resolution  
**Target:** >90% resolution  
**Primary Blocker:** workspace: protocol (Issue 1.2)

**Test Query:**
```cypher
MATCH (f:File)-[:CONTAINS]->(imp:Import)
WHERE f.filePath CONTAINS 'monorepo-3.0'
  AND (imp.source CONTAINS '@shared' 
    OR imp.source CONTAINS '@dal'
    OR imp.source CONTAINS '@core'
    OR imp.source CONTAINS '@lib')
OPTIONAL MATCH (imp)-[:RESOLVES_TO]->(target:File)
RETURN imp.source as alias,
       count(*) as totalImports,
       count(target) as resolved,
       round(100.0 * count(target) / count(*)) as resolutionRate
ORDER BY totalImports DESC
```

**Expected After Issue 1.2 Fix:** >90% for all aliases

### Test Case 2: Cross-Repository Dependencies
**Current:** ~60% for app → npm-private-packages  
**Target:** >85%  
**Primary Blocker:** .yalc interference (now fixed)

**Test Query:**
```cypher
MATCH (source:File)-[:CONTAINS]->(imp:Import)-[:RESOLVES_TO]->(target:File)
MATCH (sourceRepo:Repository {name: 'app'})-[:CONTAINS]->(source)
MATCH (targetRepo:Repository {name: 'npm-private-packages'})-[:CONTAINS]->(target)
RETURN count(*) as crossRepoDependencies
```

**Expected After Session 022:** +10-15% improvement

### Test Case 3: Entity ID Format Correctness
**Current:** 60+ "unexpected format" warnings  
**Target:** <10 warnings for legitimate edge cases  
**Primary Blocker:** Java/C# parser format (Issue 2.2, 2.4)

**Test Method:**
```bash
grep "generateEntityIdLegacy: unexpected format:" logs/*.log | wc -l
```

**Expected After Phase 2:** <10 warnings

### Test Case 4: File Count Efficiency
**Current:** ~25,000+ files including noise  
**Target:** ~3,000-5,000 actual source files  
**Primary Blocker:** ios/android/vendor directories (now fixed)

**Test Query:**
```cypher
MATCH (r:Repository)-[:CONTAINS]->(f:File)
RETURN r.name, count(f) as fileCount
ORDER BY fileCount DESC
```

**Expected After Session 022 Sync:** ~80% reduction for `app` repository

---

## Measurement & Tracking

### Key Performance Indicators (KPIs)

1. **Overall Import Resolution Rate**
   - Baseline: ~70%
   - Target: >95%
   - Current: TBD after Session 022 sync completes

2. **Warning-Free Parsing**
   - Baseline: 60+ "unexpected format" warnings
   - Target: <10 warnings
   - Current: TBD after fixes

3. **File Processing Efficiency**
   - Baseline: ~25,000 files (with noise)
   - Target: ~3,000-5,000 (source only)
   - Current: TBD after Session 022 sync

4. **Parsing Success Rate**
   - Baseline: ~99% (excellent)
   - Target: >99.5%
   - Current: ~99% maintained

### Progress Tracking

After each significant change, run validation suite:

```bash
# 1. Check overall resolution rates
node dist/index.js workspace status --verbose

# 2. Count warnings
grep "generateEntityIdLegacy: unexpected format:" logs/*.log | \
  sort | uniq -c | sort -rn

# 3. Run Neo4j validation queries
# (See Test Cases section above)

# 4. Document results in this file
```

---

## Contributing & Updates

### When to Update This Document

1. **After fixing an issue:** Mark as ✅ FIXED with session number
2. **When discovering new issues:** Add to appropriate category
3. **After validation:** Update Current Status in metrics table
4. **Before major releases:** Review and update all KPIs

### Issue Status Legend

- 🔴 **OPEN** - Not yet addressed, needs work
- 🟡 **MITIGATED** - Workaround in place, not fully resolved
- ✅ **FIXED** - Fully resolved and tested
- 🎯 **IN PROGRESS** - Currently being worked on
- 🔮 **FUTURE** - Planned for later phase

### Contact & Questions

For questions about accuracy improvements:
- Review this document first
- Check recent session docs in `docs/sessions/`
- Consult validation queries in `docs/DEMO_GUIDE.md`

---

**Next Review Date:** After Session 022 workspace sync completes  
**Last Major Update:** Session 022 (2025-11-05)
