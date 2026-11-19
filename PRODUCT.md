# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js App Router on port 4100 with React 19, strict TypeScript, Tailwind CSS, Radix UI, shadcn/ui, `@xyflow/react`, Zustand, TanStack Query, `cmdk`, and Biome. Dedicated Hono TypeScript API server on port 4101 with Zod validation and OpenAPI docs.

## Users

Solo and local-first Artificial Intelligence, or AI, developers who operate Sosho on a single Graphics Processing Unit, or GPU, workstation. They build, test, and debug multi-agent workflows, hybrid memory stores, local models, and offline music pipelines.

## Product Purpose

Sosho Studio provides one unified developer workbench to control every capability in the Sosho codebase with minimum clicks and familiar patterns. Success means a developer can build, run, pause, inspect, and debug complex local-first AI workflows without terminal guesswork.

## Positioning

Sosho Studio exposes local-first GPU and Video Random Access Memory, or VRAM, coordination, six-tier hybrid Large Language Model, or LLM, routes, durable SQLite Write-Ahead Log, or WAL, parallel workflow waves, hybrid vector and entity-graph memory, and offline YuE2 music synthesis in one cohesive interface.

## Operating Context

Developers run Studio locally at `http://127.0.0.1:4100` against the Studio API at `http://127.0.0.1:4101`. Infrastructure services run via Docker Compose (`llama-cpp`, `llama-decision`, `llama-embed`, `yue2-engine`, `yue2-gateway`, and `langfuse`). Desktop viewports of 1280 pixels and wider are the primary target.

## Capabilities and Constraints

- Open `/` directly on the Workflows and Runs canvas.
- Keep `.pi/model-roles.json`, `.pi/models.json`, and `.env` strictly read-only in the UI.
- Preserve ports `4100` and `4101`, loopback Cross-Origin Resource Sharing, or CORS, and Bearer token authentication on write routes.
- Build in sequence: Phase 1 Architecture and Workflows, Phase 2 Playground, Phase 3 Memory, Audio, and System.

## Brand Commitments

Name: Sosho Studio. Voice: concise, direct, technical, and free of filler.

## Evidence on Hand

- Core packages: `packages/llm`, `packages/memory`, `packages/workflow-engine`.
- Reference workflow: `workflows/example-research.graph.json`.
- Music gateway: `yue2/gateway/app.py`.
- Operations scripts: `bin/doctor.sh`, `bin/autotune.sh`, `tests/run_tests.sh`.

## Product Principles

- Earn trust through familiar developer patterns from Visual Studio Code, Linear, and n8n.
- Show three primary controls first and place advanced engine knobs inside progressive disclosure drawers.
- Render live run state, parallel waves, and Human-in-the-Loop, or HITL, actions directly on the canvas.
- Keep route state in Uniform Resource Locators, or URLs, and preserve unsaved work across navigation.
- Prefer inline controls over modal dialogs.
