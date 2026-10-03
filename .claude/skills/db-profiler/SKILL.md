---
description: Analyzes database schema and queries for advanced optimization opportunities.
argument-hint: <query-or-schema-file>
context: fork
agent: backend-engineer
---

## Database Target

!`cat $ARGUMENTS`

Act as an elite Database Administrator and Performance Engineer.
Review the provided schema or query for performance bottlenecks:
1. Identify missing, redundant, or unused indexes (e.g., compound index ordering).
2. Point out potential N+1 query patterns or inefficient joins.
3. Check for proper data types, constraints, and normal forms.
4. Analyze lock contention risks and transaction isolation level issues.
5. Provide the optimized SQL or ORM code to drastically improve performance and scalability.

**CRITICAL MCP INSTRUCTION**: Do NOT just guess! Use your `postgres` or `sqlite` MCP tools to connect to the database, run `EXPLAIN ANALYZE` on the target queries, check existing table statistics, and base your optimizations on actual execution plans.
