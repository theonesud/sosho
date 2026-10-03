---
description: Reviews API endpoints for best practices, REST/GraphQL standards, and backward compatibility.
argument-hint: <api-file>
context: fork
agent: backend-engineer
---

## API Target

!`cat $ARGUMENTS`

Review the API design as a Staff API Architect. Evaluate against:
1. RESTful semantics (proper HTTP verbs, correct status codes, hierarchical resource naming).
2. Idempotency (crucial for PUT/DELETE/POST where applicable).
3. Pagination, filtering, caching (ETag/Cache-Control), and sorting standards.
4. Rate limiting, payload size constraints, and DoS protection considerations.
5. Backward compatibility and versioning strategies.

Identify any anti-patterns and rewrite the endpoint signature or implementation logic to align with industry-leading API standards.

**CRITICAL MCP INSTRUCTION**: Once you finalize major structural decisions about the API contracts, use your `memory` MCP tool to save these architectural decisions into the knowledge graph so they are remembered across all future sessions!
