# Sosho Architecture Decision Records

Read this ledger before you modify architecture, ports, schemas, storage, or security rules.
Add a new Architecture Decision Record, or ADR, whenever you introduce a lasting design choice.

## ADR-001: SQLite Write-Ahead Log In-Process Workflow Engine

- **Status:** Accepted.
- **Decision:** Run the Directed Acyclic Graph, or DAG, workflow engine inside the Studio Application Programming Interface, or API, server using SQLite Write-Ahead Log, or WAL, at `.pi/workflows/runs.sqlite`.
- **Rationale:** Solo single-GPU workstations do not need an external workflow broker such as Temporal or Redis.
- **Invariants:** Validate graphs with Zod before save and run start. Recover interrupted runs at startup. Fail cyclic runs with `max_steps_exceeded`. Enforce queue semaphores `cloud-io: 8`, `local-gpu: 1`, and `host-browser: 2`.

## ADR-002: Two-Tier Markdown Memory with Rebuildable SQLite Index

- **Status:** Accepted.
- **Decision:** Store durable memories as Markdown files in `~/.sosho/memory/` and `<repo>/.pi/memory/`, and maintain a disposable `index.sqlite` with FTS5, local `embeddinggemma` dense vectors, and an entity graph.
- **Rationale:** Human-readable Markdown prevents vendor lock-in while SQLite FTS5 and local CPU embeddings give fast hybrid recall with zero Graphics Processing Unit, or GPU, memory cost.
- **Invariants:** Use temporary file, `fsync`, and atomic rename for all writes. Drain `inbox/events.jsonl` via atomic batch rename with SHA-256 deduplication. Redact secrets in both `global` and `project` scopes.

## ADR-003: Six-Tier Hybrid Model Routing via `@sosho/llm`

- **Status:** Accepted.
- **Decision:** Route all interactive agents and workflow nodes through one shared client in `packages/llm/` backed by `.pi/model-roles.json` and `.pi/models.json`.
- **Rationale:** One client prevents duplicate provider code, enforces local health caching, and gives automatic fallback when local models are offline.
- **Invariants:** Cache local health checks for 15 seconds. Keep `.pi/model-roles.json` and `.pi/models.json` read-only in Studio UI. Emit Langfuse traces when Langfuse keys exist.

## ADR-004: Zero-Docker-Socket Single-GPU Handoff for YuE2

- **Status:** Accepted.
- **Decision:** Unload `llama-cpp` models via `POST http://llama-cpp:8080/models/unload` before `yue2-engine` runs, instead of mounting `/var/run/docker.sock`.
- **Rationale:** Docker socket mounts grant root-equivalent host privileges. Unprivileged HTTP unload protects an 8-gigabyte Video Random Access Memory, or VRAM, budget safely.
- **Invariants:** Never mount `/var/run/docker.sock`. Keep `llama-cpp` unloaded across consecutive queued music jobs until the queue empties. Run `ffmpeg` conversion off the FastAPI event loop via `asyncio.to_thread`.

## ADR-005: Studio Stack and Security Boundary

- **Status:** Accepted.
- **Decision:** Run Sosho Studio UI on Next.js App Router at `127.0.0.1:3000` and the Hono TypeScript API at `127.0.0.1:4101`, with Langfuse on `127.0.0.1:3001`.
- **Rationale:** Next.js App Router with React 19, Tailwind CSS, Radix UI, `@xyflow/react`, and Biome gives a strict, fast local developer workbench.
- **Invariants:** Restrict Cross-Origin Resource Sharing, or CORS, to loopback origins (`:3000`). Require timing-safe `SOSHO_STUDIO_TOKEN` bearer authentication on all `POST`, `PUT`, and `DELETE` routes. Cap request bodies at 1 megabyte and block path traversal in workflow identifiers.

## ADR-006: Cross-Agent Governance and ASD-STE100 Standard

- **Status:** Accepted.
- **Decision:** Use root [AGENTS.md](../../AGENTS.md) as the canonical standard for Pi, Claude Code, Antigravity, and OpenCode, enforce ASD-STE100 Issue 8 across all four agents, and verify compliance via `bin/check-agent-docs.sh` inside [tests/run_tests.sh](../../tests/run_tests.sh).
- **Rationale:** Separate tool-specific files drift fast. Mechanical verification catches broken links, port drift, and style divergence automatically.
- **Invariants:** Keep `.pi/SYSTEM.md` generic for external repositories because `bin/pi-launcher.sh` copies it. Keep `GEMINI.md` synced with `.pi/APPEND_SYSTEM.md`. Import `@AGENTS.md` and `@.pi/APPEND_SYSTEM.md` in `CLAUDE.md`. Include `AGENTS.md`, `.pi/APPEND_SYSTEM.md`, and `docs/context/NOW.md` in `opencode.json`.

## ADR-007: LiteLLM Proxy Gateway

- **Status:** Accepted.
- **Decision:** Run **LiteLLM Proxy** on port `4000` in [compose.yaml](../../compose.yaml) configured by [litellm.config.yaml](../../litellm.config.yaml) for `main`, `subagent`, `subagent-code`, `decision`, `embed`, and `local-uncensored`.
- **Rationale:** One OpenAI-compatible gateway centralizes mid-request fallbacks, rate-limit cooldowns, and Langfuse callbacks for both `pi` and `@sosho/llm`.
- **Invariants:** Route `.pi/models.json` and `@sosho/llm` through `litellm` when configured. Keep `DEEPINFRA_API_KEY`, `LITELLM_MASTER_KEY`, and Langfuse keys in `.env`.

## ADR-008: LangGraph, Langflow, and Studio Adapter

- **Status:** Accepted.
- **Decision:** Run **LangGraph** on port `8123` and **Langflow** on port `7860` on `webui-net`, expose `packages/memory/`, `yue2/gateway/`, and `pi` via MCP (`packages/memory/src/mcp.ts`) and `/api/tools/*`, and proxy Studio runs and Playground chat when `LANGGRAPH_URL` or `LANGFLOW_URL` are set.
- **Rationale:** Separating orchestration and visual flow building from the Studio UI gateway keeps token auth, loopback CORS, and 1-megabyte body caps enforced in one place.
- **Invariants:** Keep `packages/workflow-engine/src/engine.ts` as fallback until live LangGraph parity passes all tests. Keep `SOSHO_STUDIO_TOKEN` and loopback CORS on all Studio routes.

## ADR-009: Isolated `pi` Execution Targets and MCP

- **Status:** Accepted.
- **Decision:** Populate [.pi/mcp.json](../../.pi/mcp.json) with `memory`, `langgraph`, and `langflow` MCP servers, isolate the `pi` service on `webui-net` without `network_mode: host` or `pid: host`, and support `local`, `container`, and `ssh` targets in [bin/pi-launcher.sh](../../bin/pi-launcher.sh).
- **Rationale:** Removing host network and PID sharing limits container blast radius to LiteLLM, Langfuse, and MCP endpoints while preserving local and remote SSH workflows.
- **Invariants:** Expose only LiteLLM, Langfuse, and MCP endpoints to the isolated `pi` container on `webui-net`.

## ADR-010: Headless Playwright MCP Default and Dokobot Boundary

- **Status:** Accepted.
- **Decision:** Keep `dokobot` with its two-tab host Chrome limit for authenticated personal-cookie tasks, and add headless `@playwright/mcp` to [.pi/mcp.json](../../.pi/mcp.json) as the default headless runner for parallel clicks and form fills.
- **Rationale:** Deterministic accessibility-tree snapshots in Playwright MCP avoid per-step screenshot token costs compared to vision-heavy loops. Live cost-per-task benchmark against Browser Use is not verified offline.
- **Invariants:** Keep `host-browser` semaphore at `2` for `dokobot`. Route unauthenticated parallel web tasks through headless `playwright` MCP.

## ADR-011: Modular Memory Package and Workspace Imports

- **Status:** Accepted.
- **Decision:** Split [packages/memory/src/store.ts](../../packages/memory/src/store.ts) into `types.ts`, `redaction.ts`, `markdown.ts`, `vectors.ts`, `fts.ts`, and `entities.ts`, replace relative cross-package imports with `@sosho/memory`, `@sosho/llm`, and `@sosho/workflow-engine`, and add Playwright E2E specs in [apps/studio/e2e/studio.spec.ts](../../apps/studio/e2e/studio.spec.ts).
- **Rationale:** Small single-responsibility modules and workspace package aliases prevent brittle deep relative paths and enforce clean package boundaries.
- **Invariants:** Keep `packages/memory/src/store.ts` as the stable public facade for all existing callers.
