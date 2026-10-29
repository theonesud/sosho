---
name: dokobot
description: Web search, page reading, and multi-source research via host Chrome (JS, auth, locale). Use for web lookup, JS-heavy/auth pages, or research.
---

# Dokobot — Web Search & Research

Renders pages via host Chrome bridge (`~/.dokobot`).

## Rules
- **Context-Safe Reading (Mandatory)**: NEVER dump raw web pages, search results, or GitHub repos directly into stdout. It exhausts the 64K context window and triggers auto-compaction amnesia.
  - **Preferred**: Use `bin/doko-fetch.sh '<url>'` (automatically pipes raw page to `.pi/work/scratch/` and returns only a compact excerpt).
  - **Manual Redirection**: `dokobot read --local '<url>' > .pi/work/scratch/page.md`, then inspect with `grep -i`, `head -n 40`, or python.
- **Incremental State & Append**:
  - Maintain queue and progress in `.pi/work/state.json`.
  - Append findings to target markdown files immediately after each item (never buffer multi-item batches in memory).
- **Only use `dokobot read --local`**. Never use `dokobot search` (needs API key).
- **Never install/update Chrome or bridge** (runs on host).
- If `No local bridge running`: run `dokobot doko list` once. If empty, ask user to open Chrome with Dokobot extension enabled.
- Max 5 concurrent reads.

## Context-Safe Search & Reading
Fetch and pipe to disk automatically:
```bash
bin/doko-fetch.sh 'https://www.google.com/search?q=rust+web+frameworks'
bin/doko-fetch.sh 'https://github.com/orgs/myorg/repositories' --max-lines 50
bin/doko-fetch.sh 'https://github.com/myorg/myrepo' --grep 'description'
```
Alternatives:
- Bing: `https://www.bing.com/search?q=...`
- DuckDuckGo: `https://duckduckgo.com/?q=...`
- X: `https://x.com/search?q=...&src=typed_query`
- Baidu: `https://www.baidu.com/s?wd=...` | Yandex: `https://yandex.com/search/?text=...`

*Platform searches*: Query platform directly first; fall back to Google `site:` if needed.

## Dynamic & Long Pages
```bash
bin/doko-fetch.sh '<url>' --screens 5 --timeout 90
dokobot doko close <ID>                                                # close tab when done
```

## Images
```bash
dokobot download images --local '<url>'
```

## Research Workflow
1. **Deconstruct**: 2–5 sub-questions.
2. **Iterate**: Search → read top 2–3 results → refine (aim for 10–20 sources total; stop when saturated).
3. **Report**: Synthesize key findings, comparative tables, risks/gaps, and recommendations. Cite all sources `[Title](url)`. Disclose missing/unfound items.
4. **Large Batches & Multi-Page Crawls**: If tasks involve >5 pages/repos, write a lightweight Python script in `.pi/work/scratch/` (using curl, python-requests, or dokobot) to batch fetch, extract, and append findings in one shot instead of manually crawling turn-by-turn.
