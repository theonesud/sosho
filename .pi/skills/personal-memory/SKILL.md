---
name: personal-memory
description: Recall, record, and update the user's personal memory (life history, personality, preferences, future plans) for non-coding personal assistant conversations.
---

# Personal Memory: Life History, Preferences & Personality

Maintains organic, long-term personal memory about the user in `.pi/work/memory/`.

## Usage

```bash
# 1. Search personal memory for facts or past topics
.pi/skills/personal-memory/scripts/recall.sh "plans for November"
.pi/skills/personal-memory/scripts/recall.sh "favorite stack"

# 2. List all memory files
.pi/skills/personal-memory/scripts/recall.sh
```

## Protocol
1. For personal assistant or conversational turns, check relevant memory files (e.g. `profile.md`, `preferences.md`, `plans.md`) using `recall.sh` or targeted file reads.
2. When the user shares new personal details, life milestones, preferences, or changes in plans, create or append to the appropriate file in `.pi/work/memory/`.
3. Keep memory entries clean, factual, and chronological.
