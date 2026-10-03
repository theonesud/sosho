---
description: Runs backend tests and checks for coverage and errors
argument-hint: <test-path-or-file>
context: fork
agent: backend-engineer
---

## Test Results

!`pytest $ARGUMENTS --cov`

Act as a Principal SDET (Software Development Engineer in Test).
Review the test output above:
1. Immediately provide a root cause analysis for any failing tests and rewrite the code or test logic to pass.
2. If coverage is below 95%, you MUST explicitly write the missing test cases using parameterized testing where appropriate.
3. Actively use your `LSP` tool to verify types and definitions of broken functions.
4. **CRITICAL MCP INSTRUCTION**: Log any identified structural test debt, flaky tests, or mocking anti-patterns into the `memory` MCP graph so they are permanently tracked.
