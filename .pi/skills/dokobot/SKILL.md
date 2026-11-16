---
name: dokobot
description: Web search, page reading, and research via host Chrome (JS, auth, locale). Use for general web lookup, JS-heavy/auth pages, or web research.
---

# Dokobot — Web Search & Research

Renders pages via host Chrome bridge (`~/.dokobot`).

## Context-Safe Reading
Never dump raw web pages into stdout. Use `doko-fetch.sh` (pipes full content to `$SOSHO_PERMANENT_DIR` and returns a compact excerpt):

```bash
.pi/skills/dokobot/scripts/doko-fetch.sh 'https://www.google.com/search?q=rust+web+frameworks'
.pi/skills/dokobot/scripts/doko-fetch.sh 'https://duckduckgo.com/?q=latest+ai+trends'
.pi/skills/dokobot/scripts/doko-fetch.sh '<url>' --screens 5 --timeout 90
```

## Rules
- Only use `dokobot read --local` (or `doko-fetch.sh`). Never use `dokobot search` (requires API key).
- Follow SYSTEM.md host Chrome pacing (max 2 concurrent reads, `sleep 1`) and `task_*` progress tracking.
- Never attempt to install or update Chrome or the host bridge.
