---
name: libdocs
description: Fetch and index version-pinned library documentation (via llms.txt or Dokobot) to guarantee modern idiomatic syntax for Three.js, Next.js, FastAPI, etc.
---

# LibDocs: Version-Pinned Documentation & Idiomatic Patterns

Prevents outdated API hallucinations by pulling accurate documentation into `$SOSHO_PERMANENT_DIR/docs/<library>/`.

## Usage

```bash
# 1. Pull standardized llms.txt documentation
.pi/skills/libdocs/scripts/pull-llms-txt.sh "https://fastapi.tiangolo.com" fastapi
.pi/skills/libdocs/scripts/pull-llms-txt.sh "https://docs.anthropic.com" anthropic

# 2. Scrape documentation if llms.txt is unavailable
.pi/skills/libdocs/scripts/scrape-docs.sh "https://threejs.org/docs/" threejs

# 3. Search saved documentation for symbol or method (<10 lines)
.pi/skills/libdocs/scripts/find-doc.sh threejs "PerspectiveCamera"
.pi/skills/libdocs/scripts/find-doc.sh fastapi "Depends"
```

## Protocol
1. Probe `pull-llms-txt.sh` first; fall back to `scrape-docs.sh` if unavailable.
2. Use `find-doc.sh` to extract exact syntax without dumping full doc pages into context.
3. Follow SYSTEM.md pacing when scraping multi-page documentation.
