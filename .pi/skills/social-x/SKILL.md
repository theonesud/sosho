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

## Protocol
1. Run `x-harvest.sh` with the target or query.
2. Read the preview from stdout (<25 lines).
3. If deep analysis of specific tweets is needed, use `bin/chunk-read.sh .pi/work/research/x_<target>.md <start> <lines>` or surgical `grep`.
4. Synthesize key insights directly into your answer or append to research notes.
