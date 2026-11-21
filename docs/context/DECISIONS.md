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
