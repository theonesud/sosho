# Sosho

## How to run

Start llama cpp server
```bash
./run_llamacpp.sh
```

Start pi
```bash
./run_pi.sh
```

Add skills and mcps to your liking

### TODO:
- Add Dokobot for websearch: https://dokobot.ai/
- ~~Connect tldraw and Jan to this~~ — tldraw is wired in (agent skill + `pi-tldraw`);
  Jan is intentionally manual (see "Jan ↔ everything" below)
- https://deepinfra.com/XiaomiMiMo/MiMo-V2.6-Pro/api?example=openai-http
- opencode go 10$ instead of antigravity and pi
---

## What's already wired

- **llama.cpp** is the shared model server on `http://127.0.0.1:8080`
  (OpenAI-compatible, model `gemma-4-E4B-it-Q4_K_M`, vision via the mmproj).
- **pi → llama.cpp**: `.pi/models.json` registers a custom OpenAI-compatible
  provider `llama.cpp` pointing at `http://127.0.0.1:8080/v1`.
- **pi runs on the host network** (`run_pi.sh` uses `--network host`) so it can
  reach services bound to `127.0.0.1`, especially the tldraw agent API on `:7236`.
- **tldraw agent skill for pi**: copied to `.agents/skills/tldraw-offline/`
  (resolves in the container at `/workspace/.agents/skills/tldraw-offline`).
  `run_pi.sh` also mounts `~/.config/tldraw` read-only and `~/skills` read-only
  so the skill's `server.json` lookup and `tq` helper resolve inside the container.
- **pi-tldraw**: installed as a pi package in `.pi/settings.json`
  (`npm:pi-tldraw`) — the agent gets canvas tools (`tldraw_canvas_*`) backed by a
  local MCP canvas host. Use `/tldraw open <name>` inside pi.
- Jan is intentionally left to configure by hand — see below.

## Jan ↔ everything (manual setup)

Jan runs as a Flatpak (`ai.jan.Jan`). Its sandbox has **no node/npx and no home
directory access**, but it **shares the host network** and does have `bun`, `uv`
and `python3`. So:
- prefer **HTTP / Streamable HTTP MCP** servers listening on `127.0.0.1`;
- stdio servers must be runnable with `bun x …` or `uvx …`.

Config file:
```
~/.var/app/ai.jan.Jan/data/Jan/data/mcp_config.json
```
In Jan: **Settings → MCP Servers**, and turn on **Allow All MCP Tool Permissions**.
Use a **tool-capable model**.

### 1. Jan → llama.cpp (local model)

Jan already has a provider for this — `localllamacpp` with base URL
`http://0.0.0.0:8080`. Make sure your llama.cpp server is the external router on
`:8080` (not Jan's own managed server on `:54190`) if you want Jan and pi to share
one loaded model.

### 2. Jan → tldraw (recommended, no pi needed)

tldraw's API binds `127.0.0.1:7236` and speaks HTTP, not MCP. Bridge it with a
Streamable HTTP MCP server, e.g. `er1chi/tldraw-mcp`:

```bash
git clone https://github.com/er1chi/tldraw-mcp.git
cd tldraw-mcp && bun install
export TLDRAW_MCP_TOKEN="$(bun run --silent token)"
bun run start        # serves Streamable HTTP on http://127.0.0.1:7237/mcp
```

Then add to Jan's `mcp_config.json`:

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

### 3. Jan → pi (optional bridge; read the caveats)

There is no maintained prebuilt MCP server for *this* pi (1.2.0) that also runs
it in Docker and points at your local llama.cpp. Options:

- Run pi in Jan via the old `pi-mcp-server` (`bun x pi-mcp-server`). It targets the
  pre-1.0 pi package, defaults to Anthropic, and has no custom base URL, so treat
  it as a starting point.
- Put a small host HTTP MCP in front of `docker exec pi-agent pi …` and point Jan
  at `http://127.0.0.1:<port>/mcp`.

```jsonc
// example only
{
  "mcpServers": {
    "pi": {
      "command": "/app/bin/bun",
      "args": ["x", "pi-mcp-server"],
      "env": { "PI_MCP_PROVIDER": "anthropic", "PI_MCP_MODEL": "claude-sonnet-4-20250514" },
      "active": false
    }
  }
}
```

### Is the Jan → pi → tldraw bridge necessary?

No. It is only needed if you specifically want **Jan as the chat front end** to
delegate work to pi and have pi edit the canvas. Other routes give the same result:
- **Jan → tldraw directly** (section 2) — easiest, fully prebuilt.
- **you → pi → tldraw** — pi already has the tldraw skill and pi-tldraw tools.
- **llama.cpp as the agent host** — `llama-server` can consume stdio MCP servers
  itself: `--tools all --mcp-servers-config /path/to/mcp.json`.

## Gotchas

- **Root-owned files in `.pi/`.** The pi container runs as `root`, so the first run
  creates `root:root` entries inside the bind-mounted `.pi/` (`npm/`, `sessions/`,
  `bin/`, `auth.json`, `models-store.json`, `pi-subagents/`). They are git-ignored,
  but your host user cannot rewrite them. Fix once with:
  ```bash
  sudo chown -R "$USER:$USER" /home/vegeta/sosho/.pi
  ```
  Docker may **not** be usable from a shell that predates the `docker` group add;
  use `sg docker -c './run_pi.sh'` or log out/in.
- **Disk space.** `/home` is a ~136 GB partition that has been close to full. Model
  files live on `/mnt/Asteroid/sosho-models` (see `run_llamacpp.sh`); the pi npm tree
  (`.pi/npm/node_modules`, ~460 MB) is regenerable with `pi install`.
- **Verify tldraw from inside pi**: run `./run_pi.sh`, then `/tldraw open main`
  (starts the local MCP canvas host on `127.0.0.1:8787`) and `/tldraw status`.
