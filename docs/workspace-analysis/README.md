# Workspace Analysis Examples

This directory contains **example analyses** of real-world codebases using CodeGraph. These documents demonstrate CodeGraph's capabilities by analyzing the Mindler healthcare platform's microservices architecture.

## ⚠️ Important Note

These documents are **examples of CodeGraph output**, not CodeGraph core documentation. They showcase:
- How CodeGraph analyzes production codebases
- The types of insights CodeGraph can extract
- Real-world architectural patterns discovered through graph queries
- Documentation generation capabilities

## Example Analyses

### [B2B Membership: Netherlands Pending Flow](./b2b-membership-nl-pending.md)
**Corporate membership provisioning system**

Demonstrates CodeGraph's ability to:
- Trace data flows across microservices (S3 → Lambda → DynamoDB)
- Map event-driven architectures (EventBridge, SQS)
- Document business logic from code
- Generate architecture diagrams

**Technologies analyzed:** AWS Lambda, S3, EventBridge, DynamoDB, TypeScript

---

### [iCBT Journaling Flow](./icbt-journaling-flow.md)
**Internet-based Cognitive Behavioral Therapy integration**

Demonstrates CodeGraph's ability to:
- Trace multi-service workflows (3 microservices)
- Map event streaming patterns (DynamoDB Streams → SQS)
- Document external API integrations (Webdoc)
- Identify data transformation points

**Technologies analyzed:** DynamoDB Streams, SQS, Lambda, External HTTP APIs, TypeScript

---

### [Automatic Questionnaire Frequency](./automatic-questionnaire-frequency.md)
**Clinical questionnaire automation system**

Demonstrates CodeGraph's ability to:
- Extract business rules from code (14-day frequency limits)
- Document scheduling logic (EventBridge cron patterns)
- Map health profile assignments
- Trace therapy session triggers

**Technologies analyzed:** EventBridge Scheduler, DynamoDB, Lambda, TypeScript

---

### [Questionnaire Catalog](./questionnaire-details.md)
**Clinical questionnaire types and details**

Demonstrates CodeGraph's ability to:
- Catalog domain entities from code
- Extract metadata and properties
- Document relationships between entities
- Generate reference documentation

**Technologies analyzed:** DynamoDB schemas, TypeScript types, Domain models

---

## Use Cases

These examples illustrate CodeGraph's value for:

### 1. **Onboarding New Developers**
Quickly understand complex system architectures without manually reading thousands of lines of code.

### 2. **Documentation Generation**
Automatically generate up-to-date architecture documentation from source code.

### 3. **Impact Analysis**
Trace how changes in one service affect downstream systems.

### 4. **Technical Debt Assessment**
Identify architectural patterns, dependencies, and potential issues.

### 5. **Compliance & Audit**
Document data flows for regulatory requirements (HIPAA, GDPR, etc.).

## How These Were Created

1. **Codebase Analysis** - CodeGraph parsed the Mindler monorepo
2. **Graph Queries** - Neo4j Cypher queries extracted relevant patterns
3. **AI-Assisted Documentation** - AI agents used graph data to write documentation
4. **Validation** - Verified against actual source code and system behavior

## Applying to Your Codebase

To generate similar documentation for your codebase:

1. **Run CodeGraph** on your repository
   ```bash
   npm run analyze /path/to/your/code
   ```

2. **Query the graph** using examples from [API Documentation](../api/example-queries.md)

3. **Use AI agents** to generate documentation from query results

4. **Customize queries** for your specific architecture patterns

## Related Documentation

- **[Quick Start Guide](../guides/quick-start.md)** - Get started with CodeGraph
- **[Example Queries](../api/example-queries.md)** - Neo4j query patterns
- **[Architecture](../architecture/)** - CodeGraph system design
- **[Research](../research/)** - Analysis approaches and optimizations

## Questions?

These analyses serve as **reference examples**. For:
- **Learning CodeGraph** → Start with [Quick Start](../guides/quick-start.md)
- **Writing queries** → See [API Documentation](../api/)
- **Understanding architecture** → Read [Architecture Docs](../architecture/)

---

*These examples analyze the Mindler healthcare platform, a production system built on AWS microservices. They demonstrate CodeGraph's real-world applicability to complex, multi-repository codebases.*
