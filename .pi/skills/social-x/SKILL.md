---
name: social-x
description: Harvest and analyze X.com posts, timelines, likes, bookmarks, and search queries using the user's host Chrome session.
---

# Social-X: X.com Ingestion & Analysis

Interacts with X.com using the user's real logged-in Chrome session via Dokobot. Saves full feeds directly to the session's permanent `research/` directory to protect the context window.

## URLs
| Target | URL |
|--------|-----|
| Timeline | `https://x.com/home` |
| **Likes** | **`https://x.com/i/history/likes`** |
| Bookmarks | `https://x.com/i/bookmarks` |
| Search | `https://x.com/search?q=...&f=live` |
| Direct tweet | `https://x.com/username/status/123456789` |

## Usage

```bash
# Harvest home timeline (default 4 screens)
.pi/skills/social-x/scripts/x-harvest.sh timeline

# Harvest liked posts (adjust screens as needed)
.pi/skills/social-x/scripts/x-harvest.sh likes 20

# Harvest bookmarks
.pi/skills/social-x/scripts/x-harvest.sh bookmarks 6

# Search for a topic or trend on X
.pi/skills/social-x/scripts/x-harvest.sh "local LLMs" 5

# Direct tweet/thread URL
.pi/skills/social-x/scripts/x-harvest.sh "https://x.com/username/status/123456789"
```

## Iterative Likes Fetching Pattern
Likes accumulate over years. Use this pattern for full coverage:
1. Run `x-harvest.sh likes N` with a moderate N (10-20)
2. Check dates in output: `grep -oP '\d{1,2}h|\d{1,2}d|\d{1,2}w' file.md | sort -u`
3. If oldest date is still recent, increase N and re-run
4. Track progress via `task_plan` and `task_update`
5. Stop when oldest date covers your target range

## Protocol & Rules
1. **User Target Destination**: If the user requests output in a specific file or folder (e.g. `./tweets.md`, "in this folder"), ALWAYS write to or copy the final result to that exact path.
2. **Strict Pacing & Tab Limits**: Dokobot controls the host Chrome browser. Never launch parallel background scraping jobs. Maximum **2 concurrent reads**; pause with `sleep 1` between batch requests.
3. **Strict Protocol Compliance**: If the user specifies an order (e.g. account-by-account, query-by-query), follow that exact sequence without jumping ahead.
4. **Honest Accounting & Self-Verification**: Report the exact count of captured tweets/threads without exaggeration. Track pending items via `task_plan` / `task_update`. Proactively verify the captured count matches the requested scope before calling `task_finish`.
5. **Context Safety**: Read the preview from stdout (<25 lines). Use `bin/chunk-read.sh` for deeper inspection without token blowup.
