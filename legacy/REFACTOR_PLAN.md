# Sosho Refactor Plan

This document defines the phased plan to migrate Sosho onto **LangGraph**, **Langflow**, **LiteLLM Proxy**, and **Langfuse**, while keeping the custom **Sosho Studio** User Interface, or UI, file-based memory, `pi` Command Line Interface, or CLI, `dokobot`, and on-demand **YuE2** services.

## Target Architecture

- **Orchestration:** **LangGraph** executes stateful graphs, cycles, join barriers, and per-node checkpoints.
- **Visual Builder:** **Langflow** provides component definitions and flow APIs behind the custom **Sosho Studio** UI in `apps/studio/`.
- **Model Gateway:** **LiteLLM Proxy** sits in front of `llama-cpp` on `8080`, `llama-decision` on `8081`, `llama-embed` on `8082`, and cloud providers.
- **Telemetry:** **Langfuse** on port `3001` records all traces from LiteLLM, LangGraph, and `pi`.
- **Memory:** `packages/memory/` stays file-based with Markdown records, SQLite FTS5, Central Processing Unit, or CPU, vectors, and secret redaction.
- **Music:** `yue2/gateway/` and `yue2-engine` stay under the `music` Docker profile and load only on demand.

## Phase 1: Documentation, Hygiene, and Quick Fixes

1. Fix port drift in [PRODUCT.md](PRODUCT.md) and [readme.md](readme.md) from `4100` to `3000`.
2. Update the test suite count in [readme.md](readme.md) from seven to ten.
3. Change the default `LANGFUSE_BASE_URL` in [packages/llm/src/index.ts](packages/llm/src/index.ts) from `http://127.0.0.1:3000` to `http://127.0.0.1:3001`.
4. Remove `music` from default `PROFILES` in [Makefile](Makefile) so `make up` loads **YuE2** only through `make music-up`.
5. Move `studio-api.pid`, `studio-api.log`, `studio-ui.pid`, and `studio-ui.log` from `.pi/` to `.pi/run/` and add `.pi/run/` to `.gitignore`.
6. Remove stale port `4100` from `DEFAULT_ALLOWED_ORIGINS` in [apps/studio/server/index.ts](apps/studio/server/index.ts) after `PRODUCT.md` moves to port `3000`.

## Phase 2: LiteLLM Proxy and Model Fallback

1. Add a `litellm` service to [compose.yaml](compose.yaml) with a declarative `litellm.config.yaml` file.
2. Route `main`, `subagent`, `subagent-code`, `decision`, `embed`, and `local-uncensored` tiers through **LiteLLM Proxy**.
3. Configure mid-request Hypertext Transfer Protocol, or HTTP, error fallback, rate-limit cooldowns, and **Langfuse** callbacks inside LiteLLM.
4. Point `.pi/models.json` and `packages/llm/src/index.ts` to the LiteLLM endpoint so both `pi` and workflows share one gateway.

## Phase 3: LangGraph, Langflow, and Studio Adapter

1. Add **LangGraph** and **Langflow** services to [compose.yaml](compose.yaml) on `webui-net`.
2. Expose `packages/memory/`, `yue2/gateway/`, and `pi` as Model Context Protocol, or MCP, servers or HTTP tools for LangGraph and Langflow.
3. Refactor [apps/studio/server/index.ts](apps/studio/server/index.ts) into a thin adapter that proxies Studio canvas runs and Playground chat to LangGraph and Langflow.
4. Preserve timing-safe `SOSHO_STUDIO_TOKEN` bearer authentication, loopback Cross-Origin Resource Sharing, or CORS, and the 1-megabyte body cap on all Studio routes.
5. Retire duplicate execution loops in `packages/workflow-engine/` once LangGraph parity passes all tests.

## Phase 4: `pi` CLI Integration and Execution Targets

1. Populate [.pi/mcp.json](.pi/mcp.json) with MCP servers for `packages/memory/`, **LangGraph**, and **Langflow**.
2. Refactor [bin/pi-launcher.sh](bin/pi-launcher.sh) to support three execution modes: local host, isolated container, and remote Secure Shell, or SSH, server.
3. Remove `network_mode: host` and `pid: host` from the `pi` service in [compose.yaml](compose.yaml) for isolated container mode.
4. Expose only LiteLLM, Langfuse, and MCP endpoints to the isolated `pi` container on `webui-net`.

## Phase 5: Browser Automation Extension

1. Keep `dokobot` with the two-tab host Chrome limit for tasks that require personal browser cookies.
2. Add a headless **Playwright** or **Browser Use** MCP server for parallel clicks, form fills, and web tasks.
3. Benchmark cost per completed task across both browser tools and set the winner as the default headless runner.

## Phase 6: Package Refactor and End-to-End Tests

1. Split [packages/memory/src/store.ts](packages/memory/src/store.ts) into small modules for Markdown file input and output, redaction, FTS5 search, dense vectors, and entity graph logic.
2. Replace relative cross-package imports such as `../../memory/src/store.ts` with workspace package names such as `@sosho/memory` and `@sosho/llm`.
3. Add **Playwright** end-to-end, or E2E, tests in `apps/studio/` for the workflow canvas, Playground, and Memory screens.
4. Update [docs/context/DECISIONS.md](docs/context/DECISIONS.md) and [docs/context/NOW.md](docs/context/NOW.md) after each phase.
5. Run `make check-agents` and `make test` after each phase to verify all invariants.
