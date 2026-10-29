---
name: dokobot
description: Web search, page reading, and multi-source research via host Chrome (JS, auth, locale). Use for general web lookup, JS-heavy/auth pages, or research.
---

# Dokobot — Web Search & Research

Renders pages via host Chrome bridge (`~/.dokobot`).

## Rules
- **Context-Safe Reading (Mandatory)**: NEVER dump raw web pages or search results directly into stdout.
  - **Preferred**: Use `.pi/skills/dokobot/scripts/doko-fetch.sh '<url>'` (automatically pipes raw page to `.pi/work/research/` or scratch and returns only a compact excerpt).
  - **Manual Redirection**: `dokobot read --local '<url>' > .pi/work/research/page.md`, then inspect with `grep -i`, `head -n 40`, or python.
- **Strict Pacing & Tab Limits (CRITICAL)**:
  - Never spawn unbounded parallel subshells (`&`) with dokobot.
  - Maximum **2 concurrent reads** at any time.
  - When looping over multiple items, run sequentially or in pairs with a `sleep 1` pause to prevent flooding host Chrome with dozens of tabs.
- **Strict Protocol Compliance**:
  - Follow the user's requested execution order (e.g., page-by-page, link-by-link). Never skip ahead or batch across multiple pages without explicit permission.
- **User Destination Rule**:
  - If the user requests output in a specific file or folder (e.g. `./summary.md`, "in this folder"), ALWAYS write to or copy the final result to that exact path.
- **Honest Accounting**:
  - Maintain queue and progress in `.pi/work/state.json`. Report exact counts of processed vs pending items truthfully.
- **Only use `dokobot read --local`**. Never use `dokobot search` (needs API key).
- **Never install/update Chrome or bridge** (runs on host).

## Context-Safe Search & Reading
```bash
.pi/skills/dokobot/scripts/doko-fetch.sh 'https://www.google.com/search?q=rust+web+frameworks'
.pi/skills/dokobot/scripts/doko-fetch.sh 'https://duckduckgo.com/?q=latest+ai+trends'
.pi/skills/dokobot/scripts/doko-fetch.sh '<url>' --screens 5 --timeout 90
```
