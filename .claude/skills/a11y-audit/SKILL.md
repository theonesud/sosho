---
description: Performs a deep accessibility (a11y) audit on a component or page.
argument-hint: <url-or-component-file>
context: fork
agent: frontend-engineer
---

## A11y Target

!`cat $ARGUMENTS`

Act as a Principal Accessibility Engineer.
Review the provided component or page for a11y compliance:
1. Identify missing ARIA labels, roles, and states.
2. Check for proper semantic HTML (e.g., using `<button>` instead of `<div onClick>`).
3. Point out keyboard navigation issues (focus trapping, missing `tabindex`, invisible focus rings).
4. Verify color contrast ratios (aiming for WCAG AA or AAA).

**CRITICAL MCP INSTRUCTION**:
1. If testing a live URL, explicitly use your `puppeteer` MCP to launch a headless browser, evaluate the DOM structure, and run automated axe-core checks if possible.
2. Use your `memory` MCP tool to persist any discovered a11y regressions into the knowledge graph to ensure future components adhere to the standard.
