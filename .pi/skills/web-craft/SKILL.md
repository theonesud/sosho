---
name: web-craft
description: Build interactive website presentations (Reveal.js / HTML decks) and small fullstack webapps using Next.js and FastAPI, with background dev server runners and endpoint testing.
---

# Web Craft: Presentations, Next.js & FastAPI Webapps

Dedicated workflow for serious webapps, REST/FastAPI microservices, and interactive website presentations.

## Usage

```bash
# 1. Start a dev server in background
.pi/skills/web-craft/scripts/dev.sh next ./my-next-app 3001
.pi/skills/web-craft/scripts/dev.sh fastapi ./my-api 8001
.pi/skills/web-craft/scripts/dev.sh presentation ./deck 8005

# 2. Test an API endpoint with compact JSON formatting
.pi/skills/web-craft/scripts/test-api.sh "http://127.0.0.1:8001/items" GET
.pi/skills/web-craft/scripts/test-api.sh "http://127.0.0.1:8001/items" POST '{"name": "test"}'

# 3. Stop running servers
.pi/skills/web-craft/scripts/stop.sh 8001
```

## Protocol
1. For Next.js (App router vs Pages router) or FastAPI (Pydantic v2), consult `libdocs` first to verify correct idioms.
2. Develop modular components; use `test-api.sh` to verify endpoints.
3. Keep server logs in `.pi/work/scratch/` and inspect errors via `bin/chunk-read.sh`.
