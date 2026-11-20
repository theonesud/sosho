# LLM and Subagent Scoped Agent Guide

Read root [AGENTS.md](../../AGENTS.md) and [docs/context/DECISIONS.md](../../docs/context/DECISIONS.md) before you edit `packages/llm/`.

## Architecture and Invariants

- **Shared Client (`src/index.ts`):** Load `.env` from the workspace and Sosho root. Resolve roles from `.pi/model-roles.json` and providers from `.pi/models.json`.
- **Resilience:** Cache local health checks for 15 seconds. Fall back automatically from offline local servers (`:8080`, `:8081`, `:8082`) to configured cloud fallbacks. Emit best-effort Langfuse traces when Langfuse keys exist.
- **Native Subagents (`src/subagent-runtime.ts`):** Run isolated `pi --print --no-session` child processes. Enforce `SOSHO_SUBAGENT_DEPTH` with `MAX_DEPTH = 3`. Serialize `local-uncensored` to concurrency `1` globally while cloud tiers run concurrently. Cap `stdout` and `stderr` at 2 megabytes each and propagate `isError: true` on failure.

## Mandatory Verification

Run typecheck and both unit suites after any change:

```bash
(cd packages/llm && npm run typecheck && npx tsx test/llm.test.ts && npx tsx test/subagents.test.ts)
```
