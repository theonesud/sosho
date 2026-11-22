---
name: github-scout
description: Search GitHub, browse starred repositories, and analyze repos for capabilities, dependencies, and local run feasibility.
---

# GitHub Scout: Discovery & Repo Analysis

Scouts GitHub using the user's host Chrome session via Dokobot.

## Usage

```bash
# Browse starred repositories (page N)
.agents/skills/github-scout/scripts/gh-stars.sh 1

# Analyze repo capabilities and architecture
.agents/skills/github-scout/scripts/gh-analyze.sh "ggerganov/llama.cpp"
.agents/skills/github-scout/scripts/gh-analyze.sh "https://github.com/astral-sh/uv"

# Search GitHub natively
dokobot read --local "https://github.com/search?q=local+voice+agent&type=repositories" > "$SOSHO_PERMANENT_DIR/gh_search.md"
```

## Protocol
1. Review brief from stdout (<25 lines); inspect generated markdown in `$SOSHO_PERMANENT_DIR` if needed.
2. Follow SYSTEM.md pacing (max 2 concurrent reads, `sleep 1`) and record progress with `task_*`.
