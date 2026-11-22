---
name: social-x
description: Harvest and analyze X.com posts, timelines, likes, bookmarks, and search queries using host Chrome session.
---

# Social-X: X.com Ingestion & Analysis

Interacts with X.com using host Chrome via Dokobot. Saves full feeds directly to `$SOSHO_PERMANENT_DIR`.

## URLs
| Target | URL |
|--------|-----|
| Timeline | `https://x.com/home` |
| Likes | `https://x.com/i/history/likes` |
| Bookmarks | `https://x.com/i/history` |
| Search | `https://x.com/search?q=...&f=live` |

## Usage

```bash
# Timeline (default 4 screens)
.agents/skills/social-x/scripts/x-harvest.sh timeline

# Liked posts (adjust screens as needed)
.agents/skills/social-x/scripts/x-harvest.sh likes 20

# Bookmarks
.agents/skills/social-x/scripts/x-harvest.sh bookmarks 6

# Search topic / trend
.agents/skills/social-x/scripts/x-harvest.sh "local LLMs" 5

# Direct tweet/thread URL
.agents/skills/social-x/scripts/x-harvest.sh "https://x.com/username/status/123456789"
```

## Iterative Likes Fetching Pattern
Likes accumulate over time. For deep archives:
1. Run `x-harvest.sh likes N` (start with 10–20 screens).
2. Check oldest captured date in output: `grep -oP '\d{1,2}h|\d{1,2}d|\d{1,2}w' "$SOSHO_PERMANENT_DIR/x_likes.md" | sort -u`.
3. If more coverage is needed, increase screens and re-run.
4. Record items in `task_plan` / `task_update` and follow SYSTEM.md pacing.
