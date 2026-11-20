# Sosho Agent Governance Standard

This document is the canonical engineering standard for all Artificial Intelligence, or AI, agents in this repository.
Pi, Claude Code, Antigravity, and OpenCode must follow every rule in this file without exception.

## 1. Mandatory Output Style

Follow ASD-STE100 Simplified Technical English Issue 8 for all prose.
This rule covers chat replies, plans, reports, commit messages, and documentation.
Read the exact style rules in [.pi/APPEND_SYSTEM.md](.pi/APPEND_SYSTEM.md).
Code, identifiers, commands, file paths, and quoted text are exempt.

## 2. Zero-Trust Governance Rules

Do not rely on memory or assumptions.
Verify every fact against disk files and command output.

1. **Ground-Truth First:** Read actual source files before you state ports, routes, schemas, types, or dependencies.
2. **Evidence Before Claim:** Never claim that a build, lint check, or test passes unless you run that command in the current turn and observe exit code 0.
3. **No Silent Shortcuts:** Never skip tests, weaken assertions, or add `@ts-ignore`, `@ts-expect-error`, or `as any` to silence errors.
4. **No Stubbed Fixes:** Diagnose root causes and deliver complete, production-ready code.
5. **Protected Configurations:** Keep `.env`, `.pi/model-roles.json`, and `.pi/models.json` strictly read-only in the User Interface, or UI. Never commit secrets or edit `.env` unless the user asks explicitly.
6. **Hardware and Security Boundaries:**
   - Never mount `/var/run/docker.sock` into any container.
   - Never bypass `SOSHO_STUDIO_TOKEN` bearer authentication on `POST`, `PUT`, or `DELETE` routes in the Studio Application Programming Interface, or API.
   - Never widen Studio Cross-Origin Resource Sharing, or CORS, beyond loopback origins.
   - Respect concurrency caps: `local-gpu` is `1`, `host-browser` is `2`, and `cloud-io` is `8`.
   - Enforce secret redaction in both `global` and `project` memory scopes.
7. **Mandatory Ledger Updates:** Update [docs/context/NOW.md](docs/context/NOW.md) when you finish a task, change a phase, or discover drift. Record architectural changes in [docs/context/DECISIONS.md](docs/context/DECISIONS.md) in the same commit.

## 3. Repository Architecture

| Path | Ownership | Scoped Guide |
| :--- | :--- | :--- |
| `apps/studio/` | Next.js App Router UI (`:3000`) and Hono API (`:4101`) | [apps/studio/AGENTS.md](apps/studio/AGENTS.md) |
| `packages/workflow-engine/` | Zod graph validation, edge middleware, and SQLite Write-Ahead Log, or WAL, workflow engine | [packages/workflow-engine/AGENTS.md](packages/workflow-engine/AGENTS.md) |
| `packages/memory/` | Two-tier Markdown memory, SQLite FTS5, local vectors, and entity graph | [packages/memory/AGENTS.md](packages/memory/AGENTS.md) |
| `packages/llm/` | Shared `@sosho/llm` client, role routing, Langfuse tracing, and Pi subagent runtime | [packages/llm/AGENTS.md](packages/llm/AGENTS.md) |
| `yue2/` | FastAPI async music gateway (`:8021`) and single-GPU handoff | [yue2/AGENTS.md](yue2/AGENTS.md) |
| `.pi/` | Pi harness config, model roles, extensions, and sandbox skills | [.pi/SYSTEM.md](.pi/SYSTEM.md) |
| `.agents/` | Cross-agent skills such as `impeccable` | [.agents/skills/impeccable/SKILL.md](.agents/skills/impeccable/SKILL.md) |
| `bin/` | Launchers, diagnostics, hardware autotune, and governance checks | [Makefile](Makefile) |
| `docker/` | Sandbox image, Langfuse stack, and ClickHouse memory caps | [compose.yaml](compose.yaml) |
| `workflows/` | Versioned `*.graph.json` workflow definitions | [workflows/example-research.graph.json](workflows/example-research.graph.json) |

## 4. Verified Service Ports

| Port | Service | Source of Truth |
| :--- | :--- | :--- |
| `3000` | Sosho Studio UI (Next.js App Router) | `apps/studio/package.json` |
| `3001` | Langfuse v4 UI and telemetry | `docker/compose.langfuse.yaml` |
| `4101` | Sosho Studio API, SQLite DAG engine, and SSE server | `apps/studio/server/index.ts` |
| `8021` | YuE2 async music gateway | `compose.yaml` |
| `8080` | `llama-cpp` local GPU model (`Qwen3.6-35B-A3B`) | `compose.yaml` |
| `8081` | `llama-decision` local CPU router (`Qwen3-1.7B`) | `compose.yaml` |
| `8082` | `llama-embed` local CPU embeddings (`embeddinggemma-300M`) | `compose.yaml` |
| `9090` | Langfuse MinIO storage | `docker/compose.langfuse.yaml` |

## 5. Mandatory AI Workflow Loop

Follow this six-step loop for every non-trivial task:

1. **Orient:** Read [docs/context/NOW.md](docs/context/NOW.md) and the scoped `AGENTS.md` for each subsystem you plan to touch.
2. **Check Decisions:** Read [docs/context/DECISIONS.md](docs/context/DECISIONS.md) before you change architecture, ports, schemas, or security rules.
3. **Plan:** Define exact files to change, invariants to preserve, and verification commands to run.
4. **Implement:** Make small, typed, modular edits. Keep diffs focused on the task.
5. **Verify:** Run targeted tests first. Then run `make check-agents` and `make test` (or report any blocked Docker suite explicitly).
6. **Govern:** Update [docs/context/NOW.md](docs/context/NOW.md) or [docs/context/DECISIONS.md](docs/context/DECISIONS.md) if state or architecture changed.

## 6. Verification Commands

Run these commands to verify changes:

```bash
# Governance and documentation sync gate
make check-agents

# Full automated verification suite (all 10 suites)
make test

# Targeted package suites
(cd packages/llm && npm run typecheck && npx tsx test/llm.test.ts && npx tsx test/subagents.test.ts)
(cd packages/memory && npm run typecheck && npx tsx test/memory.test.ts && npx tsx test/capture.test.ts)
(cd packages/workflow-engine && npm run typecheck && npx tsx test/schema.test.ts && npx tsx test/max-steps.test.ts && npx tsx test/activities.test.ts && npx tsx test/engine.test.ts)
(cd apps/studio && npm run typecheck && npm run lint && npm run build && npx tsx server/server.test.ts)
(cd yue2/gateway && pytest -q test_gateway.py)
```

## 7. Project Context and Reference Index

Read these documents on demand to keep context lean:

- **Present state and active tasks:** [docs/context/NOW.md](docs/context/NOW.md)
- **Architecture decisions:** [docs/context/DECISIONS.md](docs/context/DECISIONS.md)
- **Past milestones:** [docs/context/HISTORY.md](docs/context/HISTORY.md)
- **Future roadmap:** [docs/context/ROADMAP.md](docs/context/ROADMAP.md)
- **Product specification:** [PRODUCT.md](PRODUCT.md)
- **Studio design system:** [DESIGN.md](DESIGN.md)
- **Full repository overview:** [readme.md](readme.md)
