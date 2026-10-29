---
name: github-scout
description: Search GitHub, browse starred repositories, and analyze repos for capabilities, dependencies, and local run feasibility.
---

# GitHub Scout: Discovery & Repo Analysis

Scouts GitHub using the user's authenticated host Chrome session via Dokobot. Writes reports directly to `.pi/work/research/`.

## Usage

```bash
# Browse user's starred repositories
.pi/skills/github-scout/scripts/gh-stars.sh 1

# Analyze a repository's capabilities and architecture
.pi/skills/github-scout/scripts/gh-analyze.sh "ggerganov/llama.cpp"
.pi/skills/github-scout/scripts/gh-analyze.sh "https://github.com/astral-sh/uv"

# Search GitHub natively
dokobot read --local "https://github.com/search?q=local+voice+agent&type=repositories" > .pi/work/scratch/gh_search.md
```

## Protocol
1. Run `gh-stars.sh` or `gh-analyze.sh`.
2. Review the brief from stdout (<25 lines).
3. **Sequential & Paced Execution**: When analyzing multiple repos or orgs, follow the user's exact sequencing (e.g. page-by-page, repo-by-repo). Never launch unbounded parallel reads (max 2 concurrent; pace with `sleep 1`).
4. **Honest Accounting**: Record exact progress in `.pi/work/state.json`. Never claim all items are analyzed when only a subset was checked.
5. If the user requested output in a specific file (e.g. `./growtharc-repos.md`), write/copy directly to that file.
