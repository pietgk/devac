# CPG (Code Property Graph) vs Context Embedding for Documentation

> **Analysis Date**: 2025-01-06
> 
> **Question**: Should we use full CPG (AST + CFG + PDG) or simpler context embedding?
> 
> **Context**: Security tools use CPG extensively - is this overkill or optimal for documentation?

---

## Executive Summary

**TL;DR**: CPG is **massively powerful** but **overkill for most documentation needs**. A **hybrid approach** is optimal:

- **Use CPG techniques** for specific high-value queries (20% of cases)
- **Use context embedding** for general documentation (80% of cases)
- **Build incrementally**: Start with context, add CPG layers on-demand

**Key Insight**: Security analysis and documentation generation have **fundamentally different query patterns**. CPG excels at finding vulnerabilities (needles in haystacks); documentation needs understanding flows (the whole haystack).

---

## What is CPG? (Code Property Graph)

### The Formula

```
CPG = AST + CFG + PDG + Call Graph + Type Hierarchy
```

Where:
- **AST** (Abstract Syntax Tree): Syntactic structure of code
- **CFG** (Control Flow Graph): Execution paths through code
- **PDG** (Program Dependence Graph): Data + control dependencies
- **Call Graph**: Function call relationships
- **Type Hierarchy**: Class inheritance and type relationships

### Visual Comparison

**Simple AST** (What we have now):
```
MethodDeclaration
  ├─ Parameters
  ├─ ReturnType
  └─ Body
      ├─ IfStatement
      ├─ Assignment
      └─ Return
```

**Full CPG** (What security tools use):
```
MethodDeclaration
  ├─ AST: Parameters → Body → Statements
  ├─ CFG: Entry → If(true) → Block1 → Exit
  │                  └(false)→ Block2 ─┘
  ├─ PDG: Data: x depends on param1
  │       Control: Block1 depends on If condition
  ├─ CallGraph: Calls methodB() at line 15
  └─ TypeInfo: Returns UserType, inherits from BaseType
```

---

## CPG Components Deep Dive

### 1. AST (Abstract Syntax Tree)

**What it provides**:
```cypher
(:Method)-[:AST]->(:Block)-[:AST]->(:IfStatement)
                           └[:AST]->(:Assignment)
```

**Example**:
```typescript
function calculate(x: number): number {
  if (x > 0) {
    return x * 2;
  }
  return 0;
}
```

**AST Nodes**:
- `METHOD: calculate`
  - `PARAMETER: x (type: number)`
  - `RETURN_TYPE: number`
  - `BLOCK`
    - `IF_STATEMENT`
      - `CONDITION: x > 0`
      - `TRUE_BLOCK: return x * 2`
    - `RETURN: 0`

**Value for Documentation**: ⭐⭐⭐⭐⭐ (Essential)
- Shows code structure
- Easy to visualize
- Helps understand nesting and scope

---

### 2. CFG (Control Flow Graph)

**What it provides**:
```cypher
(:CFGNode {line: 1})-[:CFG {label: "true"}]->(:CFGNode {line: 3})
                    └[:CFG {label: "false"}]->(:CFGNode {line: 5})
```

**Example** (same function):
```
Entry (line 1)
  ↓
Condition: x > 0 (line 2)
  ↓              ↓
 true          false
  ↓              ↓
return x*2    return 0
(line 3)      (line 5)
  ↓              ↓
Exit ←───────────┘
```

**Value for Documentation**: ⭐⭐⭐⭐ (Very Useful)
- Shows all possible execution paths
- Critical for understanding complex conditionals
- Helps identify unreachable code
- **Use case**: "What are all possible outcomes?"

**BUT**: Most documentation doesn't need THIS level of detail for simple functions.

---

### 3. PDG (Program Dependence Graph)

**What it provides**:

**Data Dependencies**:
```cypher
(:Variable {name: "result"})-[:DATA_DEP]->(:Variable {name: "input"})
```

**Control Dependencies**:
```cypher
(:Statement {line: 10})-[:CONTROL_DEP]->(:Condition {line: 5})
```

**Example**:
```typescript
function process(input: number): number {
  const threshold = 10;           // Line 2
  let result = 0;                 // Line 3
  
  if (input > threshold) {        // Line 5
    result = input * 2;           // Line 6
  } else {
    result = input / 2;           // Line 8
  }
  
  return result + threshold;      // Line 11
}
```

**Data Dependencies**:
- Line 11: `result + threshold` depends on:
  - `result` from line 6 OR line 8
  - `threshold` from line 2
- Line 6: `input * 2` depends on:
  - `input` parameter

**Control Dependencies**:
- Line 6 depends on line 5 (if condition)
- Line 8 depends on line 5 (else branch)

**Value for Documentation**: ⭐⭐⭐ (Useful for complex cases)
- Shows what affects what
- Critical for understanding side effects
- **Use case**: "If I change X, what breaks?"

**BUT**: Most simple functions have obvious dependencies.

---

### 4. Call Graph

**What it provides**:
```cypher
(:Method {name: "handleEvent"})-[:CALLS {line: 175}]->(:Method {name: "sendToJournal"})
                               └[:CALLS {line: 180}]->(:Method {name: "updateStatus"})
```

**Example**:
```typescript
async function handleEvent(data: EventData) {
  const processed = await processData(data);  // Call 1
  
  if (processed.shouldJournal) {
    await sendToJournal(processed);           // Call 2
  }
  
  await updateStatus(processed.id);           // Call 3
}
```

**Call Graph**:
```
handleEvent
  ├─ calls processData (line 2, always)
  ├─ calls sendToJournal (line 5, conditional)
  └─ calls updateStatus (line 8, always)
```

**Value for Documentation**: ⭐⭐⭐⭐⭐ (Essential)
- Shows function interactions
- Critical for tracing flows
- Already proposed in our improvements!
- **Use case**: "What functions does this call?"

---

### 5. Type Hierarchy

**What it provides**:
```cypher
(:Type {name: "AdminUser"})-[:INHERITS_FROM]->(:Type {name: "User"})
(:Type {name: "User"})-[:HAS_METHOD]->(:Method {name: "login"})
```

**Value for Documentation**: ⭐⭐⭐⭐ (Very Useful)
- Shows class relationships
- Critical for OOP understanding
- Already proposed in our improvements!

---

## Security Use Cases vs Documentation Use Cases

### Security Analysis Queries (CPG's Strength)

#### Use Case 1: Taint Tracking
**Query**: "Can user input reach exec() without sanitization?"

```cypher
// Find taint flow from source (user input) to sink (dangerous function)
MATCH path = (source:CALL {name: "req.body.input"})
  -[:REACHING_DEF*]->
  (sink:CALL {name: "exec"})
WHERE NOT exists(
  (source)-[:REACHING_DEF*]->(sanitize:CALL {name: "sanitize"})
  -[:REACHING_DEF*]->(sink)
)
RETURN path
```

**CPG Components Used**:
- ✅ CFG: Trace execution paths
- ✅ PDG: Track data flow
- ✅ Call Graph: Find sanitize() calls
- ❌ AST: Not critical (structural only)

**Would Context Embedding Work?**: ❌ **NO**
- Need to trace data across multiple functions
- Need to prove absence of sanitization
- Need graph traversal algorithms

**Winner**: CPG ✅

---

#### Use Case 2: Find SQL Injection Vulnerabilities
**Query**: "Find string concatenation of user input into SQL queries"

```cypher
MATCH (input:IDENTIFIER)-[:ARGUMENT]->(concat:CALL {name: "+"})
  -[:ARGUMENT]->(sql:CALL)
WHERE sql.name IN ["db.query", "execute"]
  AND NOT exists((input)-[:ARGUMENT]->(escape:CALL))
RETURN input, concat, sql
```

**CPG Components Used**:
- ✅ AST: Find concatenation operations
- ✅ PDG: Track data dependencies
- ✅ Call Graph: Identify db.query calls
- ✅ Type Info: Ensure input is user-controlled

**Would Context Embedding Work?**: ⚠️ **PARTIAL**
- Can see local concatenation
- Can't prove input source across functions
- Can't verify all paths sanitized

**Winner**: CPG ✅

---

#### Use Case 3: Dead Code Detection
**Query**: "Find functions never called"

```cypher
MATCH (m:METHOD)
WHERE NOT exists((caller:METHOD)-[:CALLS]->(m))
  AND NOT m.isEntryPoint
RETURN m.name
```

**CPG Components Used**:
- ✅ Call Graph only

**Would Context Embedding Work?**: ❌ **NO**
- Need complete call graph
- Need whole-program analysis

**Winner**: CPG ✅

---

### Documentation Use Cases (Our Needs)

#### Use Case 1: "How does iCBT scheduling work?"
**What we need**:
- Function signature
- Function body
- Surrounding context
- Comments explaining "why"
- Constants used

**CPG Query**:
```cypher
MATCH (f:METHOD {name: "getICBTSchedulingDate"})
MATCH (f)-[:AST*]->(statements)
MATCH (f)-[:CFG]->(paths)
MATCH (f)-[:USES_CONSTANT]->(c:CONSTANT)
RETURN f, statements, paths, c
```

**Context Embedding Query**:
```cypher
MATCH (f:Function {name: "getICBTSchedulingDate"})
RETURN f.fullSource, f.contextBefore, f.contextAfter, f.comments
```

**Comparison**:

| Aspect | CPG | Context Embedding |
|--------|-----|-------------------|
| Can answer question? | ✅ Yes | ✅ Yes |
| Query complexity | High (traverse AST/CFG) | Low (single property lookup) |
| Build complexity | High (parse + analyze) | Low (extract code) |
| Storage per function | ~20-50 KB (all nodes/edges) | ~5 KB (source + context) |
| Retrieval speed | Slower (graph traversal) | Faster (property access) |

**Winner**: Context Embedding ✅ (simpler, faster, sufficient)

---

#### Use Case 2: "What conditions trigger journaling?"
**What we need**:
- The if statement conditions
- The logic breakdown
- Comments explaining each check

**CPG Query**:
```cypher
MATCH (f:METHOD {name: "handleEvent"})
MATCH (f)-[:AST*]->(if:IF_STATEMENT)
MATCH (if)-[:CONDITION]->(cond:EXPRESSION)
MATCH (if)-[:TRUE_BLOCK]->(block)
MATCH (block)-[:CALLS]->(journal:METHOD {name: "sendToJournal"})
RETURN cond, comments
```

**Context Embedding Query**:
```cypher
MATCH (f:Function {name: "handleEvent"})
RETURN f.fullSource, f.conditions, f.comments
WHERE "sendToJournal" IN f.callsInternal
```

**Comparison**:

| Aspect | CPG | Context Embedding |
|--------|-----|-------------------|
| Can answer question? | ✅ Yes | ✅ Yes |
| Finds all conditions? | ✅ Yes (precise) | ✅ Yes (from source) |
| Shows condition purpose? | ❌ No (need comments separately) | ✅ Yes (inline comments) |
| Query complexity | High | Low |

**Winner**: Context Embedding ✅ (simpler, includes comments)

---

#### Use Case 3: "Trace data flow from DynamoDB to webdoc-hook"
**What we need**:
- How data transforms across 6 files
- What fields are added/removed
- The complete message structure

**CPG Query**:
```cypher
MATCH path = (stream:METHOD {name: "lambdaHandler"})
  -[:CALLS*]->
  (journal:METHOD {name: "sendToJournal"})
MATCH (path)-[:PDG*]->(transformations)
RETURN path, transformations
```

**Context Embedding Query**:
```cypher
// Would need to query each function individually
MATCH (f:Function) WHERE f.name IN [
  "lambdaHandler", 
  "mapMessage", 
  "sendToQueue",
  // ... etc
]
RETURN f.fullSource, f.contextBefore, f.contextAfter
```

**Comparison**:

| Aspect | CPG | Context Embedding |
|--------|-----|-------------------|
| Can trace full flow? | ✅ Yes (automatic traversal) | ⚠️ Partial (manual assembly) |
| Shows transformations? | ✅ Yes (PDG edges) | ⚠️ Partial (need to read each function) |
| Query complexity | Medium | High (multiple queries) |
| Result clarity | ❌ Low (graph of nodes) | ✅ High (readable code) |

**Winner**: ⚠️ **TIE** 
- CPG better for automatic discovery
- Context embedding better for human readability
- **Best solution**: Hybrid (use both)

---

## The Fundamental Difference

### Security Analysis Mindset
**Goal**: Find needles in haystacks

**Questions**:
- "Can attacker input reach dangerous function?"
- "Are there any paths without authentication?"
- "Does ANY code path have this vulnerability?"

**Characteristics**:
- **Exhaustive search** (must check ALL paths)
- **Proof of absence** (prove no vulnerability exists)
- **Cross-function** (vulnerabilities span files)
- **Pattern matching** (find specific anti-patterns)

**CPG Value**: ⭐⭐⭐⭐⭐ (Essential)

---

### Documentation Mindset
**Goal**: Understand the haystack

**Questions**:
- "How does this feature work?"
- "What are the main code paths?"
- "Why was this implemented this way?"

**Characteristics**:
- **Selective reading** (main paths, not all edge cases)
- **Understanding flow** (how it works, not if it's vulnerable)
- **Human-readable** (explain to developers)
- **Context-driven** (comments + code together)

**CPG Value**: ⭐⭐⭐ (Helpful but not essential)

---

## Complexity Analysis

### Building a CPG

**What's Required**:

1. **Parse AST** (Baseline)
   - Complexity: Medium
   - Tools: TypeScript Compiler API, ts-morph
   - Time: ~100ms per file

2. **Build CFG** (Add control flow)
   - Complexity: High
   - Algorithm: Traverse AST, identify branching
   - Time: ~200ms per file
   - **Challenge**: Handle all control structures (if/for/while/switch/try/catch)

3. **Build PDG** (Add data/control dependencies)
   - Complexity: Very High
   - Algorithm: Reaching definitions analysis, dominator trees
   - Time: ~500ms per file
   - **Challenge**: Interprocedural analysis, pointer aliasing

4. **Build Call Graph** (Add function calls)
   - Complexity: Medium-High
   - Algorithm: Resolve call sites, handle dynamic dispatch
   - Time: ~300ms per file
   - **Challenge**: Dynamic calls, callbacks, promises

5. **Merge Graphs** (Combine AST + CFG + PDG)
   - Complexity: High
   - Storage: ~20-50 KB per function
   - **Challenge**: Keep graphs synchronized

**Total Time**: ~1 second per file for full CPG
**Storage**: ~50 KB per function (vs ~5 KB for context)

**Tooling**:
- Joern: C/C++/Java/Python support (complex setup)
- Fraunhofer CPG: Multi-language but limited TS support
- Custom: Build from scratch (months of work)

---

### Building Context Embedding

**What's Required**:

1. **Parse AST** (Baseline - same as CPG)
   - Complexity: Medium
   - Tools: TypeScript Compiler API, ts-morph
   - Time: ~100ms per file

2. **Extract Context** (Add surrounding code)
   - Complexity: Low
   - Algorithm: Read N lines before/after
   - Time: ~10ms per file
   - **Challenge**: None (trivial string operations)

3. **Extract Comments** (Add documentation)
   - Complexity: Low
   - Algorithm: AST provides comments
   - Time: ~5ms per file

4. **Extract Basic Logic** (Conditions, calls)
   - Complexity: Low-Medium
   - Algorithm: Simple AST traversal
   - Time: ~50ms per file

**Total Time**: ~165ms per file (6x faster than CPG)
**Storage**: ~5 KB per function (10x smaller than CPG)

**Tooling**:
- ts-morph: Full TypeScript support (already available)
- No external dependencies needed

---

## Query Performance

### CPG Queries

**Simple Query** (Find function):
```cypher
MATCH (m:METHOD {name: "calculate"})
RETURN m
```
**Performance**: Fast (~1ms)

**Medium Query** (Find calls):
```cypher
MATCH (m:METHOD {name: "handleEvent"})
  -[:CALLS]->(called:METHOD)
RETURN called.name
```
**Performance**: Fast (~5ms)

**Complex Query** (Taint tracking):
```cypher
MATCH path = (source:CALL {name: "userInput"})
  -[:REACHING_DEF*1..10]->
  (sink:CALL {name: "exec"})
WHERE NOT exists(
  (source)-[:REACHING_DEF*]->(sanitize)-[:REACHING_DEF*]->(sink)
)
RETURN path
```
**Performance**: Slow (~100ms-1s for complex paths)

---

### Context Embedding Queries

**Simple Query** (Find function):
```cypher
MATCH (f:Function {name: "calculate"})
RETURN f.fullSource
```
**Performance**: Instant (~1ms)

**Medium Query** (Find calls):
```cypher
MATCH (f:Function {name: "handleEvent"})
RETURN f.callsInternal
```
**Performance**: Instant (~1ms) - pre-extracted

**Complex Query** (Taint tracking):
```cypher
// Not possible - would need to read multiple functions
// and manually trace data flow
```
**Performance**: N/A (requires multiple queries + manual analysis)

---

## ROI Analysis: CPG vs Context Embedding

### For Documentation Generation

| Metric | CPG | Context Embedding | Winner |
|--------|-----|-------------------|--------|
| **Build Time** | 1s/file | 165ms/file | Context (6x faster) |
| **Storage** | 50KB/function | 5KB/function | Context (10x smaller) |
| **Query Simple** | Fast | Instant | Context (simpler) |
| **Query Complex** | Possible | Limited | CPG |
| **Implementation** | Months (complex) | Weeks (simple) | Context |
| **Maintenance** | High (sync graphs) | Low (just code) | Context |
| **Tool Support** | Limited (Joern) | Excellent (ts-morph) | Context |
| **Accuracy** | High (analyzed) | Medium (extracted) | CPG |
| **Readability** | Low (graph) | High (source code) | Context |
| **Cross-function** | Excellent | Poor | CPG |
| **Single-function** | Overkill | Perfect | Context |

**Scoring**:
- Context Embedding: 8/10 metrics better
- CPG: 2/10 metrics better (complex queries, cross-function)

**Conclusion**: Context embedding is better for **80% of documentation needs**.

---

## The Hybrid Approach: Best of Both Worlds

### Core Principle

> Use **context embedding** as the foundation, add **CPG techniques** for specific high-value queries.

### Implementation Strategy

#### Layer 1: Context Embedding (Week 1-2)
Store for every function:
```cypher
CREATE (f:Function {
  name: "calculate",
  fullSource: "...",
  contextBefore: [...],
  contextAfter: [...],
  comments: [...],
  
  // Simple extractions (not full CPG)
  parameters: [{name, type}],
  returnType: "number",
  localVars: ["result", "temp"],
  calls: ["helper", "validate"],
  conditions: [{line, expr}]
})
```

**Coverage**: 80% of documentation queries
**Build time**: 165ms/file
**Storage**: 5KB/function

---

#### Layer 2: Call Graph (Week 3)
Add function call relationships:
```cypher
CREATE (f1:Function)-[:CALLS {
  line: 15,
  isConditional: true,
  args: ["userId", "data"]
}]->(f2:Function)
```

**Coverage**: +10% (cross-function flow)
**Build time**: +100ms/file
**Storage**: +1KB/function

**Value**: Enables "trace flow across files" queries

---

#### Layer 3: Data Flow (Week 4-5) - OPTIONAL
Add data dependencies for critical paths:
```cypher
CREATE (v1:Variable {name: "userInput"})
  -[:FLOWS_TO {through: ["sanitize", "validate"]}]->
  (v2:Variable {name: "dbQuery"})
```

**Coverage**: +5% (security-critical flows)
**Build time**: +300ms/file (expensive!)
**Storage**: +10KB/function

**Value**: Enables "can X reach Y?" queries

**When to use**: Only for security-critical code

---

#### Layer 4: Full CFG/PDG (Month 2+) - RARE
Full CPG for specific modules flagged as security-critical:
```cypher
CREATE (n:CFGNode {line: 5})
  -[:CFG {label: "true"}]->(n2:CFGNode)
CREATE (n3:PDGNode)-[:DATA_DEP]->(n4:PDGNode)
```

**Coverage**: +5% (exhaustive security analysis)
**Build time**: +1s/file (very expensive)
**Storage**: +30KB/function

**Value**: Enables full taint tracking, vulnerability detection

**When to use**: Authentication, payment, SQL query construction

---

## Concrete Recommendation

### Phase 1: Start Simple (2-3 weeks)

**Implement**:
1. Context embedding (function source + surrounding lines)
2. Basic extractions (parameters, return type, calls, conditions)
3. Comments and documentation

**Don't implement**:
- Full CFG
- Full PDG
- Complex data flow analysis

**Result**: Can answer 80% of documentation queries

**Example**: "How does scheduling work?" ✅
```cypher
MATCH (f:Function {name: "getScheduleDate"})
RETURN f.fullSource, f.comments
// Returns readable code with comments - perfect for docs
```

---

### Phase 2: Add Call Graph (Week 4)

**Implement**:
- Function call relationships
- Cross-file import tracking (already planned)

**Result**: Can answer 90% of documentation queries

**Example**: "What calls sendToJournal?" ✅
```cypher
MATCH (caller:Function)-[:CALLS]->(f:Function {name: "sendToJournal"})
RETURN caller.name, caller.file
```

---

### Phase 3: Selective CPG (Month 2+)

**Implement**: Full CPG ONLY for specific modules:
- Authentication flows
- Payment processing
- SQL query construction
- File upload handling

**Why**: These are security-critical and benefit from taint tracking

**Example**: "Can user input reach SQL query?" ✅
```cypher
MATCH path = (input:Variable {source: "user"})
  -[:REACHING_DEF*]->
  (query:Call {name: "db.query"})
WHERE NOT exists((input)-[:REACHING_DEF*]->(sanitize:Call))
RETURN path
```

**For 95% of code**: Don't build full CPG (not worth it)

---

## Real-World Example: iCBT Documentation

Let me show exactly what we'd need for the iCBT documentation we created:

### Query 1: "How does scheduling work?"

**Context Embedding**:
```cypher
MATCH (f:Function {name: "getICBTSchedulingDate"})
RETURN f.fullSource, f.comments
```

**Returns**:
```typescript
// Context before:
export const getIcbtSchedulingInterval = () => {
  return 7; // days
};

// Function:
export function getICBTSchedulingDate(lastScheduledICBT: Date | null): Date {
  if (!lastScheduledICBT) {
    return new Date(); // First iCBT, schedule immediately
  }
  
  const nextDate = new Date(
    lastScheduledICBT.getTime() + daysToMs(getIcbtSchedulingInterval())
  );
  // ... rest of function
}

// Context after:
export function addOneDayIfCollidingVisit(
```

**Can answer question?**: ✅ YES - Clear, readable, has comments

**Would CPG help?**: ❌ NO - Over-engineering

---

### Query 2: "What are all conditions for journaling?"

**Context Embedding**:
```cypher
MATCH (f:Function {name: "handleEvent"})
RETURN f.conditions, f.fullSource
```

**Returns**:
```javascript
{
  conditions: [
    {
      line: 170,
      expression: "completedAt && isFirstCompletion && getUseJournalIntegration()",
      purpose: "Check if should send to journal"
    }
  ],
  fullSource: "..."
}
```

**Can answer question?**: ✅ YES - Shows exact conditions

**Would CPG help?**: ⚠️ MINIMAL - CFG would show paths, but source code is clearer

---

### Query 3: "Trace data from DynamoDB to webdoc-hook"

**Context Embedding**:
```cypher
// Need multiple queries
MATCH (f:Function) WHERE f.name IN [
  "lambdaHandler",
  "mapMessageForJournal", 
  "sendProgramCompleted"
]
RETURN f.fullSource
ORDER BY f.file
```

**Can answer question?**: ⚠️ PARTIAL - Need to manually trace

**Would CPG help?**: ✅ YES - Can automatically trace paths:
```cypher
MATCH path = (start:METHOD {name: "lambdaHandler"})
  -[:CALLS*]->
  (end:METHOD {name: "sendProgramCompleted"})
RETURN path
```

**Verdict**: This is the 20% case where CPG adds value!

---

### Query 4: "What's the value of MAX_DELAY constant?"

**Context Embedding**:
```cypher
MATCH (c:Constant {name: "ICBT_MAX_COMPLETED_AT_DELAY_IN_MILLISECONDS"})
RETURN c.value, c.expression, c.comment
```

**Returns**:
```javascript
{
  value: 1209600000,
  expression: "2 * 7 * 24 * 60 * 60 * 1000",
  comment: "We allow a maximum of 2 weeks delay"
}
```

**Can answer question?**: ✅ YES - Perfect

**Would CPG help?**: ❌ NO - Same result

---

## When to Use Full CPG

Use full CPG (CFG + PDG) for:

### 1. Security Audits
**Query**: "Find all SQL injection vulnerabilities"
**Why**: Need taint tracking across functions
**CPG Components**: PDG (data flow) + Call Graph

### 2. Automated Vulnerability Detection
**Query**: "Find authentication bypasses"
**Why**: Need to prove all paths check auth
**CPG Components**: CFG (all paths) + PDG (data deps)

### 3. Dead Code Elimination
**Query**: "Find unreachable code"
**Why**: Need complete call graph + CFG
**CPG Components**: Call Graph + CFG

### 4. Refactoring Impact Analysis
**Query**: "If I change X, what breaks?"
**Why**: Need data dependency analysis
**CPG Components**: PDG (data dependencies)

### 5. Test Coverage Analysis
**Query**: "Which code paths are untested?"
**Why**: Need CFG to enumerate paths
**CPG Components**: CFG

**Notice**: All these are **analysis/tooling** use cases, not **documentation** use cases!

---

## Final Recommendation: 3-Tier Strategy

### Tier 1: Context Embedding (IMPLEMENT NOW)
**For**: 80% of documentation needs
**Components**:
- Function source + surrounding context
- Comments inline
- Basic extractions (params, returns, calls)
- Constant values

**Build time**: 165ms/file
**Storage**: 5KB/function
**Effort**: 2-3 weeks

**Handles queries like**:
- "How does X work?"
- "What does this function do?"
- "What's the value of constant Y?"

---

### Tier 2: Call Graph (IMPLEMENT WEEK 4)
**For**: +10% of documentation needs
**Components**:
- Function call relationships
- Import tracking

**Build time**: +100ms/file
**Storage**: +1KB/function
**Effort**: +1 week

**Handles queries like**:
- "What calls this function?"
- "Trace flow across files"

---

### Tier 3: Selective CPG (IMPLEMENT AS NEEDED)
**For**: +10% of advanced queries
**Components**:
- Full CFG + PDG for flagged modules
- Mark security-critical code
- Build CPG on-demand

**Build time**: +1s/file (only for flagged files)
**Storage**: +30KB/function (only for flagged files)
**Effort**: +2-3 weeks (one-time implementation)

**Handles queries like**:
- "Can user input reach SQL query?"
- "Find authentication bypasses"
- "Prove no vulnerability exists"

**Mark these modules as security-critical**:
- Authentication flows
- Payment processing
- File upload handling
- SQL query construction
- Command execution

**Don't build CPG for**:
- UI components
- Utility functions
- Configuration files
- Test helpers
- 95% of the codebase

---

## Cost-Benefit Analysis

### Full CPG Everywhere

**Cost**:
- Build time: 1s/file × 1000 files = 16 minutes
- Storage: 50KB/function × 10,000 functions = 500 MB
- Complexity: Very high
- Maintenance: Difficult (keep graphs synchronized)
- Implementation: 2-3 months

**Benefit**:
- Can answer 100% of queries
- Enables advanced security analysis
- Supports complex refactoring

**ROI**: ⚠️ **Low for documentation** (over-engineering)

---

### Context Embedding + Selective CPG

**Cost**:
- Build time: 265ms/file × 1000 files = 4.5 minutes
- Storage: 6KB/function × 10,000 functions = 60 MB (+ 30KB for 5% flagged = 75 MB total)
- Complexity: Low-Medium
- Maintenance: Easy
- Implementation: 4-5 weeks

**Benefit**:
- Can answer 90% of queries immediately
- Can answer 10% of queries with CPG layer
- Much simpler to build and maintain
- Incremental - can add CPG later

**ROI**: ✅ **High for documentation** (optimal balance)

---

## Conclusion

### Your Intuition is Right ✅

CPG from the security world IS powerful and COULD help with documentation. But:

1. **Security and documentation have different needs**
   - Security: Find ALL vulnerabilities (exhaustive)
   - Documentation: Understand main flows (selective)

2. **CPG is overkill for 80% of documentation**
   - Most queries answered by source code + context
   - Full graph traversal rarely needed
   - Comments are as valuable as CFG/PDG

3. **Hybrid approach is optimal**
   - Start with context embedding (simple, fast, sufficient)
   - Add call graph (enables cross-file tracing)
   - Add selective CPG for security-critical code only

### Recommended Path

**Week 1-3**: Build context embedding
- Function source + surrounding lines
- Comments inline
- Basic extractions

**Week 4**: Add call graph
- Function call relationships
- Enables flow tracing

**Month 2**: Add selective CPG
- ONLY for security-critical modules
- Full CFG + PDG for 5% of code
- Leave 95% as context embedding

**Result**:
- 90% query coverage with simple system
- 10% advanced coverage with CPG layer
- 6x faster than full CPG
- 10x less storage than full CPG
- 4 weeks vs 3 months implementation

### Answer to Your Question

**"Should we use CPG?"**

**Answer**: ✅ **Yes, but selectively**

- Use CPG **techniques** (call graphs, data flow) but not full CPG everywhere
- Build full CPG for **5-10% of security-critical code**
- Use **context embedding** for the other 90%

The security world uses CPG because they need to **prove absence of vulnerabilities** (requires exhaustive analysis). Documentation needs to **explain presence of features** (requires selective understanding).

Different goals → Different tools.

**Your error reporting analogy remains the best insight**: Context embedding (like surrounding error lines) solves 80% of problems with 20% of the effort. CPG is the remaining 20% of problems requiring 80% of the effort - use it wisely.
