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

## Protocol & Rules
1. **User Target Destination**: If the user requests documentation saved in a specific project file (e.g. `./threejs_docs.md`), write/copy directly to that file.
2. **Strict Pacing & Tab Limits**: When crawling documentation pages with Dokobot, never spawn parallel background subshells. Scrape sequentially or max **2 at a time** with `sleep 1`.
3. **Honest Accounting**: Report exactly which pages or versions were fetched. Do not guess API signatures if doc pages failed to load.
4. **Context Safety**: Use `find-doc.sh` to search for exact functions or symbols, retrieving only the relevant ~10 lines into chat context.
