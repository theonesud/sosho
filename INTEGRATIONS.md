# Sosho integration catalog — Jan · pi · tldraw · llama.cpp

A menu of everything that can be plugged together, ranked by how little work it takes.
Prebuilt things first; custom glue is called out separately.

`llama.cpp` is the shared brain. `pi` is the orchestrator/coder. `tldraw` is the canvas.
`Jan` is the chat/agent front end. The interesting part is the triangle **Jan → pi → tldraw**.

---

## 0. Current state (verified this session)

| Component | State |
|---|---|
| llama.cpp model files | ✅ present: `/mnt/Asteroid/sosho-models/gemma-4-E4B-it-Q4_K_M/` (`gemma-4-E4B-it-Q4_K_M.gguf` 5.0 GB + `mmproj-F16.gguf` 990 MB) |
| llama.cpp server (`:8080`) | ✅ running (container `llama-cpp`), `gemma-4-E4B-it-Q4_K_M` loaded, health `ok` |
| Jan → external llama.cpp | ✅ configured: provider `localllamacpp`, base URL `http://0.0.0.0:8080` |
| Jan built-in llama.cpp | ✅ running separately as pid 19261 on `127.0.0.1:54190` |
| pi → llama.cpp | ✅ configured: `.pi/models.json` custom provider `llama.cpp` → `http://127.0.0.1:8080/v1` (pi runs `--network host`) |
| pi skills | `pi-subagents`, `pi-lens`, `pi-memory` installed |
| tldraw app | ✅ running, API on `127.0.0.1:7236`, token in `~/.config/tldraw/server.json` |
| tldraw → Pi agent skill | ✅ installed to repo `.pi/skills/tldraw-offline/` (container: `/root/.pi/agent/skills`) + `~/skills` and `~/.config/tldraw` mounted read-only |
| pi-tldraw package | ✅ installed v0.2.0 (`npm:pi-tldraw` in `.pi/settings.json`, npm tree includes `ai@^6`/`agents`; the 0.1.1 missing-`ai` bug does not apply). Canvases persist to `.pi/tldraw-canvases/<id>.json` |
| Jan MCP | ⏳ intentionally left manual — see `readme.md` |
| Docker from this shell | ⚠️ `permission denied` on the socket, but `vegeta` **is** in the `docker` group — the running shell predates the group add. New login / `newgrp docker` fixes it |

> Everything below assumes you first fix Docker access and restart the llama.cpp router
> (`./run_llamacpp.sh`), so the shared model answers on `:8080`.

---

## 1. The connection map

```
                    ┌──────────────────────────────┐
                    │  llama.cpp router  :8080      │
                    │  OpenAI + Anthropic APIs      │
                    │  embeddings · rerank · vision │
                    │  tool-calling · MCP client    │
                    └───┬───────────────┬───────────┘
        OpenAI-compat   │               │  OpenAI-compat
              ┌─────────┘               └─────────┐
              ▼                                    ▼
        ┌───────────┐   MCP (stdio/HTTP/SSE)  ┌───────────┐
        │    Jan    │◄───────────────────────►│    pi     │
        │  (chat)   │      Jan → pi → tldraw  │ (Docker)  │
        └─────┬─────┘        bridge           └─────┬─────┘
              │                                     │
     HTTP MCP │ skill = curl/tq            skill   │ pi-tldraw ext
              ▼                           / MCP    ▼
        ┌──────────────────────────────────────────────────┐
        │       tldraw offline desktop  :7236               │
        │  exec · durable board scripts · config.js widgets │
        └──────────────────────────────────────────────────┘
```

Five edges exist: **Jan↔llama**, **pi↔llama**, **Jan↔pi**, **pi↔tldraw**, **Jan↔tldraw**.
Plus a bonus edge: **llama.cpp itself as an MCP agent host**.

---

## 2. Edge-by-edge menu

### Edge A — Jan ↔ llama.cpp  ✅ already wired
Jan's `localllamacpp` provider points at `http://0.0.0.0:8080`.
- Just start the router; Jan picks up models from `/v1/models`.
- Prebuilt alternative: Jan's own managed llama.cpp (`:54190`) already works — no config needed.
- Effort: **none** (config exists). Blocked only by the container being down.

### Edge B — pi ↔ llama.cpp  ✅ already wired
`.pi/models.json` registers a custom OpenAI-compatible provider `llama.cpp` →
`http://127.0.0.1:8080/v1`, model `gemma-4-E4B-it-Q4_K_M`, with vision (`image`) enabled.
- `settings.json` disables the *builtin* llama.cpp extension (`-builtin:llama.cpp`), which is
  fine — the custom provider supplies the model; only the `/llama` router-discovery UI is gone.
- Effort: **none**. Blocked only by the container being down.

### Edge C — Jan ↔ pi (Jan delegates to pi) — *this is the missing piece*
| Option | What it is | Effort | Notes |
|---|---|---|---|
| **C1. `pi-mcp-server` (prebuilt)** | npm MCP server that wraps pi as `pi` / `pi-reply` tools | Medium | ⚠️ built Feb 2026 against the **old** `@mariozechner/pi-coding-agent`; no custom-base-URL env, defaults to Anthropic; runs its own embedded pi, not your Docker pi 1.2.0. Treat as a starting point, not drop-in |
| **C2. `supergateway` (prebuilt transport)** | Converts any stdio MCP server into Streamable HTTP / SSE | Low | Needed because Jan's flatpak has no node/npx; Jan speaks HTTP MCP over the shared host network |
| **C3. Thin host HTTP MCP bridge (glue)** | ~60-line server that shells `docker exec pi-agent pi --mode json -p "<prompt>"` | Low–Medium | The clean way to keep pi in Docker; exposes one `ask_pi` tool + optional `pi_reply` session |
| **C4. Run pi on host instead** | Install Node ≥22.19 on host, drop Docker | Low | Host node is v20.18 (`~/.local/bin/node`); `pi` needs ≥22.19. Loses the sandbox |

Recommended: **C3**, optionally fronted by **C2** if you want to reuse an existing stdio bridge.

### Edge D — pi ↔ tldraw
| Option | What it is | Effort | Reach |
|---|---|---|---|
| **D1. tldraw's own agent skill (prebuilt)** | `~/.pi/agent/skills/tldraw-offline/` — teaches pi the `curl`/`tq` recipes against `:7236` | **Very low** | The real desktop app. Needs network reachability (see blocker below) |
| **D2. `pi-tldraw` (prebuilt pi package)** | `pi install npm:pi-tldraw` — tldraw MCP app + semantic scene tools + snapshots + PNG/SVG export at `127.0.0.1:8787/mcp` | **Very low** | A *separate* agent canvas host, not the desktop app |
| **D3. `er1chi/tldraw-mcp` (prebuilt, best Jan/tldraw bridge)** | Bun+Hono Streamable HTTP MCP wrapping tldraw Desktop: search/exec/lint/screenshot + durable `script/**` workspace | Low | Full desktop control, designed for remote/HTTP clients |
| **D4. `@talhaorak/tldraw-mcp` (prebuilt)** | stdio MCP over `.tldr` files on disk | Low | File-level only; no live editor, no `.tldraw` scripts |

**Blocker for D1/D3 from inside Docker:** tldraw binds `127.0.0.1` only, and the pi container
is on the `webui-net` bridge, so it cannot see the host loopback. Fix with **one of**:
- run the pi container with `--network host` (then `127.0.0.1:7236` works, but the
  `llama-cpp` hostname must become `127.0.0.1:8080`); or
- keep the bridge network and add a tiny host-side TCP proxy `172.x:7236 → 127.0.0.1:7236`.

### Edge E — Jan ↔ tldraw (direct)
| Option | What it is | Effort |
|---|---|---|
| **E1. `er1chi/tldraw-mcp` as Streamable HTTP** | Jan shares the host network → add `http://127.0.0.1:7237/mcp` with bearer token in `mcp_config.json` | **Low** — best prebuilt path |
| **E2. Through pi** | Jan → (C3 bridge) → pi → tldraw (D1) | Medium — this is the "complete bridge through pi" |
| **E3. `mcp-remote` + upstream tldraw MCP app** | `npx -y mcp-remote http://127.0.0.1:8787/mcp` | Low, but a separate canvas host |

### Edge F — llama.cpp as an agent host (bonus, in llama.cpp already)
`llama-server` can consume MCP servers itself:
```bash
--tools all                                   # built-in file/shell tools
--mcp-servers-config /path/to/mcp.json        # Cursor-compatible stdio MCP servers
--agent                                       # CORS proxy + all built-in tools
```
Point `mcp.json` at a tldraw stdio MCP server and the model driving llama.cpp gets canvas tools
with no other runtime. Effort: **Low**. (stdio only; `--cors-origins` auto-locks to localhost.)

### Edge G — Jan as a model provider to others (bonus)
- Built-in Local API Server: OpenAI-compatible at `127.0.0.1:1337/v1`.
- `jan-cli serve <model>` → OpenAI-compatible at `localhost:6767/v1`.
- `jan-cli launch claude|openclaw` pre-wires a local model to an agent via env vars.
- pi can add Jan as a custom provider (same pattern as `.pi/models.json`) to borrow Jan's
  remote/cloud models or its managed local one.

---

## 3. Minimal-effort copy-paste

### 3.1 Restart the shared brain
```bash
newgrp docker            # or log out/in once, to pick up docker-group membership
cd /home/vegeta/sosho && ./run_llamacpp.sh
curl -s http://127.0.0.1:8080/v1/models   # should list gemma-4-E4B-it-Q4_K_M
```

### 3.2 Install the tldraw skill for pi (D1)
In the tldraw app: **Develop → Install Agent Skills**. It now detects `~/.pi` and writes
`~/.pi/agent/skills/tldraw-offline/SKILL.md` (v1.12+ supports Pi as a target).
Because pi runs in Docker with `$WORKSPACE/.pi` mounted at `/root/.pi/agent`, the skill must
live in the **repo's** `.pi/agent/skills/` (or be copied there) to be visible in the container.

### 3.3 Add pi-tldraw (D2)  ✅ installed
Already in `.pi/settings.json` (`npm:pi-tldraw`). Inside the pi session:
```text
/tldraw open main             # opens/restores the canvas host
```
Adds tools: `tldraw_canvas_open`, `tldraw_canvas_scene`, `tldraw_canvas_state`,
`tldraw_canvas_layout`, `tldraw_canvas_exec`, `tldraw_canvas_export`, `tldraw_search`,
`tldraw_diagram_tips`, `tldraw_status`.
> Known issue in 0.1.1: packaged MCP server needs `ai@^6` installed at
> `~/.pi/agent/npm` (`npm i ai@^6 --legacy-peer-deps`). Fixed in a later patch.

### 3.4 Jan → tldraw directly (E1)
Run `er1chi/tldraw-mcp` on the host, then add to
`~/.var/app/ai.jan.Jan/data/Jan/data/mcp_config.json`:
```json
{
  "mcpServers": {
    "tldraw-offline": {
      "url": "http://127.0.0.1:7237/mcp",
      "headers": { "Authorization": "Bearer YOUR_MCP_TOKEN" },
      "active": true
    }
  }
}
```
Enable **Allow All MCP Tool Permissions** in Jan and select a tool-capable model.
(Jan's flatpak shares the host network, so `127.0.0.1` resolves to the host.)

### 3.5 Jan → pi (C1/C3)
Add a stdio MCP entry to Jan's `mcp_config.json`. For the prebuilt server Jan must run it with
`bun` (the only JS runtime in its sandbox):
```json
{
  "mcpServers": {
    "pi": {
      "command": "/app/bin/bun",
      "args": ["x", "pi-mcp-server"],
      "env": { "PI_MCP_PROVIDER": "openai", "PI_MCP_MODEL": "gemma-4-E4B-it-Q4_K_M" },
      "active": true
    }
  }
}
```
⚠️ `pi-mcp-server` targets old pi and has no `OPENAI_BASE_URL` knob; expect to point it at a
host bridge instead. The robust form is **C3**: a host HTTP MCP server exposing `ask_pi`, which
Jan reaches at `http://127.0.0.1:<port>/mcp`.

### 3.6 pi's own MCP ecosystem (connect pi *outward*)
pi 1.x has built-in MCP via Codemode. Prebuilt packages worth knowing:
- `pi-mcp-adapter` — lazy-connect MCP servers, imports Cursor/Claude/Codex/VS Code configs.
- `pi-codemcp` — typed Code Mode over MCP (Python sandbox, stdio/HTTP/SSE/OAuth).
- `@spences10/pi-mcp` — MCP tools with large-response sidecar.
- `@pi-unipi/mcp` — browse/add from a 7,800+ server catalog.
Config lives in `.pi/mcp.json` (project) / `~/.pi/agent/mcp.json` (user).

---

## 4. tldraw "make it real" affordances (what an agent can turn requests into)

The desktop API plus board scripts let a natural-language request become durable, not just a drawing:

| Request shape | Mechanism | Where |
|---|---|---|
| Draw / move / label / style now | `POST /api/doc/:id/exec` | one-off snippet |
| Diagram from structure | `helpers.mermaid(source)` → real bound shapes | exec |
| Connect shapes for real | `helpers.createArrowBetweenShapes(from, to)` | exec |
| New board from scratch | `POST /api/docs/create {"name":...}` | opens + saves a `.tldraw` |
| **Clickable cards / buttons** | board script + `isLocked` control shapes | `script/main.js` |
| **Automations that run on open** | `script/main.js` (runs each load) | durable |
| **Reactive layouts / animations / simulations** | `helpers.onShapeTranslate`, `helpers.renderEphemeral`, `tick` handlers | durable |
| **Custom shapes / widgets / blocks** | `script/config.js` registration (`ShapeUtil`, tools, overlays, components) | durable |
| Comments in context | `/exec` + `@tldraw/commenting` verbs | exec |
| Visual proof | `api.getScreenshot(docId, {mode, size})` | exec |

Board scripts live under `script/**` and are edited via `/api/doc/:id/script-workspace`;
each `.tldraw` file becomes "a little app" that runs its script on load.

---

## 5. What still needs custom glue

1. **The Jan→pi transport.** No maintained prebuilt MCP server exists for *this* pi (1.2.0) that
   (a) runs pi inside Docker and (b) points at the local llama.cpp. A small HTTP MCP shim
   (`ask_pi`, `pi_reply`) is the highest-value build.
2. **Reachability.** tldraw and any host service must be visible from both the Jan flatpak
   (ok — shares host net) and the pi container (needs `--network host` or a host TCP proxy).
3. **tldraw agent skill into the container.** ✅ done — repo `.pi/skills/tldraw-offline/`
   (container: `/root/.pi/agent/skills/`), with `~/skills` and `~/.config/tldraw` mounted
   read-only by `run_pi.sh` and pi running on `--network host`.
4. **One shared router.** Decide whether Jan and pi both use the Docker router (`:8080`) or
   Jan keeps its own managed server; avoid loading the same GGUF twice on an 8 GB GPU.

---

## 6. Suggested order

1. `newgrp docker` + `./run_llamacpp.sh` → one shared model on `:8080` (unblocks A & B).
2. `Develop → Install Agent Skills` → copy skill into repo `.pi/agent/skills/` (unblocks D1).
3. `pi install npm:pi-tldraw` → instant "agent draws" with zero network surgery (D2).
4. Run `er1chi/tldraw-mcp` → add to Jan (E1) → Jan drives the real desktop canvas directly.
5. Build the host HTTP MCP `ask_pi` bridge (C3) → **Jan → pi → tldraw** complete.
6. Optional: llama.cpp `--mcp-servers-config` pointing at a tldraw stdio server (F).
