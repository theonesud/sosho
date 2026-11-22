# Session Handoff

Date: 2026-11-22. Branch: `refactor`. Last commit: `069bfb8`. The branch matches `origin/refactor`.

Read this file first in a new session. Then read `AGENTS.md`. This file records the state, the decisions, and the open work.

## 1 Goal of the Rebuild

The owner rebuilds Sosho as a local-first AI workbench on one GPU workstation. The rules are:

1. Old, incomplete, or wrong code goes to `legacy/`. `legacy/` is a temporary folder. The owner deletes it soon.
2. Move an item out of `legacy/` only after review. Bring each moved item to the standards in `docs/standards/`.
3. All four agents work the same way: Claude Code, pi, OpenCode, and Antigravity.
4. Use few services. Use Haiku subagents for mechanical work.

## 2 Decisions

| Topic | Decision |
| :--- | :--- |
| Agent rules | `AGENTS.md` is the only rule file. No adapter copies a rule. |
| Skills | One folder: `.agents/skills`. All four agents read it. `.claude/skills` is a symlink to it. |
| Guard | `bin/agent-guard.sh` runs before each read, edit, write, and shell call in every agent. |
| Post-edit | `bin/agent-post-edit.sh` and `bin/agent-format.sh` run after each edit in every agent. |
| MCP | The same servers in all agents: `memory` and `playwright` (pinned `@playwright/mcp@0.0.86`). |
| Model tiers | 7 roles: `main`, `subagent`, `subagent-code`, `decision`, `embed`, `local-uncensored`, `cloud-uncensored`. |
| Privacy | No local role falls back to a cloud model. The only fallback is `main` to `subagent`. Both are cloud models. |
| Local models | One `llama-server` in router mode on port 8080 serves all three local models. |
| Tracing | Keep Langfuse with its 6 containers. Langfuse runs on port 3001. |
| Orchestration | Own Python service `packages/graph` on the open-source `langgraph` library. No key, no license. |
| Checkpoints | SQLite file. |
| Workflow builder | The Studio canvas. Langflow components join the node catalog through `lfx`. |
| YuE2 music | Optional. It starts on demand through `packages/yue2/ensure-up.sh`. |
| pi | No compose service. The `pi` command runs in a container by default. `pi --raw` runs on the host. |
| pi isolation | The container joins the `sosho-net` network. It has no host PID access. |
| Node | Node v26.13.1 from nvm (`.nvmrc`). mise does not manage Node. |
| Full checks | `make test` is the only check command. It runs all checks, unit tests, and integration tests. See section 6. |
| Versions | Pin each dependency to its newest stable exact version. `tests/unit/test_pins.py` enforces exact pins. `make test` warns on outdated ones. |
| Comments | No comments unless necessary. See `docs/standards/code.md` section 7. |
| Langfuse secrets | `make setup` writes `LANGFUSE_NEXTAUTH_SECRET`, `LANGFUSE_SALT`, and `LANGFUSE_ENCRYPTION_KEY` to `.env`. Compose has no default for them. |

## 3 Services and Ports

`make up` starts these services. `make down` stops them, including YuE2.

| Port | Service | Notes |
| :--- | :--- | :--- |
| 3000 | Studio UI | Host dev server from `apps/studio` |
| 4101 | Studio API | Host dev server from `apps/studio` |
| 3001 | Langfuse web | Plus worker, Postgres, Redis, ClickHouse, and MinIO |
| 4000 | LiteLLM | Config in `litellm.config.yaml`. Image `v1.110.2`. |
| 8080 | `llama-cpp` router | Presets in `docker/llama-models.ini` |
| 8123 | `graph` | Own LangGraph service from `packages/graph` |
| 7860 | Langflow | The owner decides if it stays. See section 5. |
| 8021 | YuE2 gateway | Profile `music`, on demand only |

All containers use the Docker network `sosho-net`. Each model downloads to `./models` before first use. The download job skips a file that already exists.

## 4 Repository Map

| Path | Content |
| :--- | :--- |
| `AGENTS.md` | The rule file for all agents |
| `.claude/`, `.pi/`, `.opencode/`, `opencode.json`, `.agents/` | Tool adapters. `AGENTS.md` section 7 lists them. |
| `bin/agent-*.sh` | Shared guard and post-edit scripts, plus the Antigravity hook adapter |
| `bin/check-agent-docs.sh` | Checks that the four agents stay in sync |
| `bin/pi-launcher.sh` | The `pi` command. `make setup` links it to `~/.local/bin/pi`. |
| `bin/pi-container-config.sh`, `bin/pi-model-prep.sh` | Launcher helpers. They rewrite host URLs for the container. |
| `compose.yaml`, `docker/` | The stack. `docker/compose.langfuse.yaml` holds Langfuse. |
| `packages/graph/` | New Python LangGraph service. It passes all strict checks. |
| `packages/llm/`, `packages/memory/` | Model client and memory store. Not yet at the standards. |
| `packages/workflow-engine/` | Old TypeScript engine. `packages/graph` replaces it. |
| `packages/yue2/` | YuE2 music gateway and scripts. Not yet at the standards. |
| `apps/studio/` | Studio UI and API. Not yet at the standards. |
| `workflows/` | Example Studio graphs |
| `legacy/` | Old docs, tests, `doctor.sh`, and `autotune.sh`. Reference only. |

## 5 Open Work

Do these in order unless the owner says otherwise.

0. Finish the security and version work from 2026-11-22:
   - The owner runs `make setup` to write new Langfuse secrets, then recreates Langfuse. The old values are in public git history.
   - Migrate Studio to `@xyflow/react` 13. It is held at 12.12.1. Version 13 removes `useStore` and changes the change handler types.
   - Rebuild `pi-sandbox:latest`. `docker/Dockerfile.pi` pins pi 1.6.0. The local image has pi 1.5.2.
   - Remove the comments that break `docs/standards/code.md` section 7 in all other files.
1. Point Studio at the graph service. `apps/studio/server/routes/runs.ts` calls `/runs/:id/checkpoint` and `/runs/:id/rollback`. The service has `/runs/{id}/resume` and no rollback. Build the Studio palette from `GET /nodes`.
2. Add `lfx` components to the graph node catalog. The spike in `/tmp/lfx-spike/` proved it works. That folder can disappear at a reboot. Start with Prompt Template, Split Text, Parse JSON, and the OpenAI chat component with the LiteLLM URL. Pin `lfx==1.13.3` and `lfx-openai==0.2.0` together.
3. Port the remaining node kinds to `packages/graph`, after the owner decides on each: `tool shell`, `tool http`, `tool yue2`, `skill`, and the `memory` nodes.
4. Bring legacy-quality code to the standards, one directory at a time. Then remove it from the exclusion lists. See section 6.
5. Route all agents through LiteLLM. The estimate is 32 to 36 hours. Start with `pi` and OpenCode config, about 6 hours.

Decisions that wait for the owner:

- Remove Langflow? The Studio canvas is now the builder. Removal saves one service and about 2 GB.
- Approve the two relaxed `lfx` settings for File and URL components: `LANGFLOW_RESTRICT_LOCAL_FILE_ACCESS=false` and `LANGFLOW_SSRF_ALLOWED_HOSTS`.
- Keep the 300-line file limit strict, or allow a larger limit for UI components?
- Keep or relax the `typings/langgraph/` stubs. `langgraph` 1.2.24 ships no type info for `langgraph.graph`.

## 6 Check Coverage

`make test` exits 0 on 2026-11-22 with the stack up. It skips the paths in the legacy list. Four files hold that list. Keep them in sync:

- `Makefile` (`LEGACY`)
- `lefthook.yml` (anchors `x-legacy` and `x-legacy-docs`)
- `pyproject.toml`, `biome.json`, `vitest.config.ts`, `.vale.ini`, and `bin/agent-format.sh`

A measurement of all skipped code found these counts. The estimate is 95 to 110 hours.

| Check | Findings |
| :--- | :--- |
| Biome | 164 errors, 16 warnings |
| `tsc` strict | 454 errors |
| Ruff | 125 errors |
| Pyright strict | 205 errors |
| shellcheck | 13 findings |
| Tests | 11 TypeScript test files use `node:assert`, not Vitest |
| File size | 30 files over 300 lines |

The recommended plan: run the safe auto-fixes first. Then add each directory to the checks when it passes. Use this order: packages, pi extensions, Studio.

## 7 Traps

- lefthook 2.2.2 ignores a regex `exclude`. Use a list of globs.
- The guard blocks agent edits to `.pi/models.json` and `.pi/model-roles.json`. Write a proposal to `.pi/models.next.json` or `.pi/model-roles.next.json`. The owner moves it into place.
- The guard also blocks a shell command that contains the text `cat .env`. Build such test payloads in Python.
- gitleaks reads past a line end in `.env.example`. An empty key followed by another key looks like a secret. Mark the line with `# gitleaks:allow`.
- Router presets in `docker/llama-models.ini` cannot read env vars. The old `LLM_CTX_SIZE` and `*_THREADS` env vars have no effect.
- The YuE2 gateway unloads all models on port 8080 before a music job. The CPU models load again on the next request.
- `@playwright/mcp@0.0.86` depends on an alpha Playwright build. Debian can remove the pinned apt versions in `docker/Dockerfile.pi`.
- OpenCode 1.15.10 rejects the newer schema keys `providers` and `permissions`. Keep `provider`, `permission`, and a flat `mcp` map.
- Langfuse v4 runs in events_only mode. `/api/public/traces` returns 404. Read spans from `/api/public/v2/observations`.
- The LiteLLM image has no `curl`. Its healthcheck uses Python.
- Do not use a `latest` tag. `langflow:latest` moved to 1.13.3 and then required `LANGFLOW_SUPERUSER_PASSWORD`. `test_configs.py` now rejects an unpinned image.
- The guard blocks any edit or command that contains the Docker socket path. Build that path from parts in a test.

## 8 Commands

| Task | Command |
| :--- | :--- |
| First setup on a machine | `make setup` |
| Start the stack | `make up` |
| Run all checks and tests | `make test` |
| Check agent sync | `bin/check-agent-docs.sh` |
| Rebuild the pi image | `docker build --no-cache -t pi-sandbox:latest -f docker/Dockerfile.pi .` |
| Check llama.cpp preset support | `docker run --rm ghcr.io/ggml-org/llama.cpp:server-cuda --help \| grep models-preset` |

## 9 Tests

`make test` runs these suites. Integration tests skip a service that does not answer. `LIVE_STRICT=1` fails instead.

| Suite | Path | Needs |
| :--- | :--- | :--- |
| Graph service unit tests | `packages/graph/tests/` | Nothing |
| Guard and Antigravity hook | `tests/unit/test_guard.py` | Nothing |
| Config consistency | `tests/unit/test_configs.py` | Docker CLI for `compose config` |
| pi launcher arguments | `tests/unit/test_pi_launcher.py` | Nothing. It uses fake `docker` and `pi`. |
| llama router, LiteLLM, graph | `tests/integration/` | `make up` |
| Langfuse, Langflow, Studio API | `tests/integration/test_web_services.py` | `make up` |
| Graph traces in Langfuse | `tests/integration/test_graph_tracing.py` | `make up` |
| memory and playwright MCP | `tests/integration/test_mcp.py` | `npx` |
| pi container on `sosho-net` | `tests/integration/test_pi_container.py` | `make up` and `pi-sandbox:latest` |
| Legacy `tsx` scripts | `packages/*/test/`, `apps/studio/server/` | Nothing |
| YuE2 gateway | `packages/yue2/gateway/test_gateway.py` | Nothing |

`CLOUD=1` adds the cloud role calls. `HEAVY=1` adds the 35B model calls.

## 10 Not Verified Live

These items have no live test yet.

- The Studio UI on port 3000. The Playwright e2e spec in `apps/studio/e2e/` does not run in `make test`.
- A real interactive `pi` session in both modes, and the guard adapters inside pi, OpenCode, and Antigravity.
- The YuE2 start on demand.
- The cloud roles and the 35B model. They need `CLOUD=1` and `HEAVY=1`.
