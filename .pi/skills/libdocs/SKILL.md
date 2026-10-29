---
name: libdocs
description: Fetch and index version-pinned library documentation (via llms.txt or Dokobot) to guarantee modern idiomatic syntax for Three.js, Next.js, FastAPI, Pygame, etc.
---

# LibDocs: Version-Pinned Documentation & Idiomatic Patterns

Prevents outdated API hallucinations by pulling accurate, version-specific documentation into `.pi/work/docs/<library>/`.

## Usage

```bash
# 1. Pull standardized llms.txt documentation
.pi/skills/libdocs/scripts/pull-llms-txt.sh "https://fastapi.tiangolo.com" fastapi
.pi/skills/libdocs/scripts/pull-llms-txt.sh "https://docs.anthropic.com" anthropic

# 2. Scrape documentation if llms.txt is unavailable
.pi/skills/libdocs/scripts/scrape-docs.sh "https://threejs.org/docs/" threejs

# 3. Search saved documentation for a specific symbol or method
.pi/skills/libdocs/scripts/find-doc.sh threejs "PerspectiveCamera"
.pi/skills/libdocs/scripts/find-doc.sh fastapi "Depends"
```

## Protocol
1. Before writing code for frameworks with rapid API shifts (Three.js, Next.js App Router, FastAPI/Pydantic v2), check if docs exist in `.pi/work/docs/<library>/`.
2. If missing, pull via `pull-llms-txt.sh` or `scrape-docs.sh`.
3. Search for the exact class, function, or pattern using `find-doc.sh`.
4. Implement using verified modern syntax.
