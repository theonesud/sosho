---
description: Performs a deep security audit on a specific file or codebase path.
argument-hint: <file-or-path>
context: fork
agent: backend-engineer
---

## Security Audit Target

!`cat $ARGUMENTS`

Perform a rigorous security audit on the provided code as a Principal Security Engineer.
Focus intensely on:
1. Injection flaws (SQLi, NoSQLi, Command Injection).
2. Broken Authentication and Session Management.
3. Insecure Direct Object References (IDOR).
4. Server-Side Request Forgery (SSRF).
5. Data leaks, excessive data exposure, and improper error handling.
6. Race conditions and Time-of-Check to Time-of-Use (TOCTOU) flaws.

Provide a severity rating (Critical/High/Medium/Low) and a rough CVSS v3 score for each finding. Explain the exploit vector in detail, and provide a concrete, secure-by-default code fix.

**CRITICAL MCP INSTRUCTION**: 
1. Use your `github` MCP tool to search the repository for instances of the same anti-pattern in other files.
2. Use your `memory` MCP tool to persist any discovered trust boundaries or vulnerabilities into the knowledge graph to ensure future code doesn't repeat the mistake.
