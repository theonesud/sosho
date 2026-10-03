---
description: Reviews React components for performance, re-renders, and structural best practices.
argument-hint: <component-file>
context: fork
agent: frontend-engineer
---

## Component Target

!`cat $ARGUMENTS`

Act as a Principal Frontend Architect.
Review the React component for performance and architectural bottlenecks:
1. Identify unnecessary re-renders (missing `useMemo`/`useCallback` or passing inline objects to child components).
2. Check for overly complex `useEffect` dependency arrays that could cause infinite loops.
3. Point out prop-drilling anti-patterns and suggest Context or state-management alternatives.
4. Verify that state is collocated as close as possible to where it is used.

**CRITICAL MCP INSTRUCTION**:
1. Use your `github` MCP tool to search the repository for similar component implementations to ensure consistency.
2. Once you finalize major architectural decisions (e.g. global state boundaries), use your `memory` MCP tool to save these patterns into the knowledge graph.
