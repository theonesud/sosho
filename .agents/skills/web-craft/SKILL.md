---
name: web-craft
description: Build interactive website presentations (Reveal.js / HTML decks) and fullstack webapps using Next.js and FastAPI, with background dev server runners and endpoint testing.
---

# Web Craft: Presentations, Next.js & FastAPI Webapps

Workflow for webapps, REST/FastAPI services, and interactive HTML presentations.

## Usage

```bash
# 1. Start dev server in background
.agents/skills/web-craft/scripts/dev.sh next ./my-next-app 3001
.agents/skills/web-craft/scripts/dev.sh fastapi ./my-api 8001
.agents/skills/web-craft/scripts/dev.sh presentation ./deck 8005

# 2. Test an API endpoint with compact JSON formatting
.agents/skills/web-craft/scripts/test-api.sh "http://127.0.0.1:8001/items" GET
.agents/skills/web-craft/scripts/test-api.sh "http://127.0.0.1:8001/items" POST '{"name": "test"}'

# 3. Stop running servers
.agents/skills/web-craft/scripts/stop.sh 8001
```

## Protocol
1. Consult `libdocs` for modern Next.js/FastAPI idioms when needed.
2. Verify endpoints with `test-api.sh`.
3. Background server logs and PIDs are maintained in `$SOSHO_PERMANENT_DIR`.
