---
name: dokobot
description: Web search, page reading, and multi-source research via host Chrome (JS, auth, locale). Use for web lookup, JS-heavy/auth pages, or research.
---

# Dokobot — Web Search & Research

Renders pages via host Chrome bridge (`~/.dokobot`).

## Rules
- **Only use `dokobot read --local`**. Never use `dokobot search` (needs API key).
- **Never install/update Chrome or bridge** (runs on host).
- If `No local bridge running`: run `dokobot doko list` once. If empty, ask user to open Chrome with Dokobot extension enabled.
- Max 5 concurrent reads.

## Search
Read search engine URLs directly (URL-encode query, spaces → `+`).
```bash
dokobot read --local 'https://www.google.com/search?q=rust+web+frameworks'
dokobot read --local 'https://www.google.com/search?q=%22exact+phrase%22+site%3Agithub.com+-foo'
dokobot read --local 'https://www.google.com/search?q=llm+benchmarks&tbs=qdr:y' # qdr:m month, qdr:w week
```
Alternatives:
- Bing: `https://www.bing.com/search?q=...`
- DuckDuckGo: `https://duckduckgo.com/?q=...`
- X: `https://x.com/search?q=...&src=typed_query`
- Baidu: `https://www.baidu.com/s?wd=...` | Yandex: `https://yandex.com/search/?text=...`

*Platform searches*: Query platform directly first; fall back to Google `site:` if needed.

## Dynamic & Long Pages
```bash
dokobot read --local '<url>' --screens 5 --timeout 90
dokobot read --local '<url>' --session-id <ID> --screens 5 --timeout 90 # continue session
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
