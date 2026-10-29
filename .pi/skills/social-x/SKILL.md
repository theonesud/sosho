---
name: social-x
description: Harvest and analyze X.com posts, timelines, likes, bookmarks, and search queries using the user's authenticated host Chrome session.
---

# Social-X: X.com Ingestion & Analysis

Interacts with X.com using the user's real logged-in Chrome session via Dokobot. Saves full feeds directly to `.pi/work/research/` to protect the context window.

## Usage

```bash
# Harvest home timeline (default 4 screens)
.pi/skills/social-x/scripts/x-harvest.sh timeline

# Harvest bookmarks or liked posts
.pi/skills/social-x/scripts/x-harvest.sh bookmarks 6
.pi/skills/social-x/scripts/x-harvest.sh likes 6

# Search for a topic or trend on X
.pi/skills/social-x/scripts/x-harvest.sh "local LLMs" 5

# Direct tweet/thread URL
.pi/skills/social-x/scripts/x-harvest.sh "https://x.com/username/status/123456789"
```

## Protocol & Rules
1. **User Target Destination**: If the user requests output in a specific file or folder (e.g. `./tweets.md`, "in this folder"), ALWAYS write to or copy the final result to that exact path.
2. **Strict Pacing & Tab Limits**: Dokobot controls the host Chrome browser. Never launch parallel background scraping jobs. Maximum **2 concurrent reads**; pause with `sleep 1` between batch requests.
3. **Strict Protocol Compliance**: If the user specifies an order (e.g. account-by-account, query-by-query), follow that exact sequence without jumping ahead.
4. **Honest Accounting**: Report the exact count of captured tweets/threads without exaggeration. Track pending items in `.pi/work/state.json`.
5. **Context Safety**: Read the preview from stdout (<25 lines). Use `bin/chunk-read.sh` for deeper inspection without token blowup.
