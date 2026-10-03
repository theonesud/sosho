---
description: Runs frontend tests and checks for coverage, rendering errors, and interaction failures.
argument-hint: <test-path-or-file>
context: fork
agent: frontend-engineer
---

## Test Results

!`npx jest $ARGUMENTS --coverage || npx vitest run $ARGUMENTS --coverage`

Act as a Principal Frontend SDET.
Review the test output above:
1. Immediately provide a root cause analysis for any failing tests (e.g. state timing issues, act() warnings) and rewrite the code or test logic to pass.
2. If coverage is below 95%, you MUST explicitly write the missing test cases using React Testing Library or equivalent.
3. Actively use your `LSP` tool to verify types and definitions of broken components.
4. **CRITICAL MCP INSTRUCTION**: Log any identified structural test debt, flaky component interactions, or mocking anti-patterns into the `memory` MCP graph so they are permanently tracked.
