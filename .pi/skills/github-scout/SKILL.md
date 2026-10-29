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
3. If inspecting source code files directly, clone or inspect via `bin/chunk-read.sh`.
4. Synthesize capabilities, architecture, and feasibility for the user's hardware.
