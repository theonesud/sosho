---
name: dokobot
description: Web search, page reading, and multi-source research through the user's real Chrome browser. Use for any web lookup, JS-heavy/logged-in pages, or in-depth research with citations.
---

# Dokobot — web search, reading & research

`dokobot read --local '<url>'` renders a page in the user's real Chrome (JS, login state, locale) and returns clean text.

## Rules

- **Always use `dokobot read --local`.** Nothing else.
- **Never use `dokobot search`** — it has no `--local` flag and needs an API key we don't have. Search by reading a search-engine URL instead.
- **Never run `dokobot install-bridge`, `config`, or `update`, and never install Chrome.** Chrome and the bridge run on the host; you are inside a container that shares the bridge via `~/.dokobot`.
- If you get `No local bridge running`: run `dokobot doko list` once. If still empty, stop and ask the user to open Chrome with the Dokobot extension enabled. Don't keep retrying.
- Max 5 concurrent reads.

## Search

Build a search URL (URL-encode, spaces → `+`), read it, then read the actual result URLs. Never guess URLs.

```bash
dokobot read --local 'https://www.google.com/search?q=rust+web+frameworks'
dokobot read --local 'https://www.google.com/search?q=%22exact+phrase%22+site%3Agithub.com+-foo'
dokobot read --local 'https://www.google.com/search?q=llm+benchmarks&tbs=qdr:y'   # past year (qdr:m month, qdr:w week)
```

Other engines if Google gives a CAPTCHA or poor results (space out rapid searches to avoid CAPTCHAs):

| Engine | URL |
|---|---|
| Bing | `https://www.bing.com/search?q=...` |
| DuckDuckGo | `https://duckduckgo.com/?q=...` |
| X / Twitter | `https://x.com/search?q=...&src=typed_query` |
| Baidu (Chinese) | `https://www.baidu.com/s?wd=...` |
| Yandex | `https://yandex.com/search/?text=...` |

Search in the target language for non-English topics (e.g. Baidu for Chinese, `google.co.jp` for Japanese).

For platform searches (X, Reddit, YouTube, LinkedIn…) use the platform's own search URL first, and fall back to `site:x.com query` on Google only if that fails. Say in your answer whether results came from the platform or a fallback. A blank/sparse platform page can mean logged out, rate-limited, or not yet rendered — continue the session (below) before giving up.

## Long or dynamic pages

If output includes `Session: <id>`, continue the same page instead of re-reading:

```bash
dokobot read --local '<url>' --screens 5 --timeout 90
dokobot read --local '<url>' --session-id <SESSION_ID> --screens 5 --timeout 90
dokobot doko close <SESSION_ID>   # close the session/tab when done
```

On a timeout, retry once with a larger `--timeout`. Check `dokobot read --help` for exact flags.

## Images

Download images from a page (handles lazy-loaded and logged-in images):

```bash
dokobot download images --local '<url>'
```

Check `dokobot download images --help` for output dir and filters.

## Research (when one search isn't enough)

1. **Scope:** split the question into 2–5 sub-questions.
2. **Iterate:** for each one, search → read the 2–3 best results → refine based on what you learned. Read each round's results before planning the next — don't shotgun queries. Aim for 10–20 sources total and stop when new sources only repeat old ones.
3. **Report:**

```markdown
## <Topic>
### Key findings
- Claim [1][2]
### Comparison (if relevant)
| Criterion | A | B |
### Risks / gaps
### Recommendation
### Sources
1. [Title](url) — what it contributed
```

Cite every claim. Distinguish benchmarks/official docs from opinions/anecdotes. Flag outdated sources. Say so when you couldn't find something instead of guessing.
