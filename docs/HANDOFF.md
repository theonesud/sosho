# Handoff

Read this file first. Then read `AGENTS.md` and the standards it lists. This file holds only facts that the code and the standards do not show.

## 1 Goal

The owner rebuilds Sosho as a local-first AI workbench on one GPU workstation.

1. `legacy/` holds old code for reference. The owner deletes it soon.
2. Bring code out of the legacy list only after it passes the standards in `docs/standards/`.
3. Claude Code, pi, OpenCode, and Antigravity must work the same way. `AGENTS.md` is the only rule file.
4. Use few services. Use Haiku subagents for mechanical work.

## 2 State

`make test` passes on `refactor` with the stack up. `make up` starts all services. Ports and services are in `compose.yaml`, `docker/compose.langfuse.yaml`, and the Makefile usage text.

| Area | Fact |
| :--- | :--- |
| Models | One `llama-server` in router mode on port 8080 serves the three local models. LiteLLM on port 4000 maps the 7 roles. |
| Privacy | No local role falls back to a cloud model. The only fallback is `main` to `subagent`. |
| Orchestration | `packages/graph` on port 8123 runs Studio graph JSON on `langgraph`. It replaces `packages/workflow-engine`. |
| Builder | The Studio canvas is the workflow builder. Langflow components join the graph catalog through `lfx`. |
| pi | `pi` runs in the `pi-sandbox:latest` container on `sosho-net`. `pi --raw` runs on the host. |
| Node | Node comes from nvm and `.nvmrc`. The owner's shell can still resolve an older Node. Run `nvm use` first. |

## 3 Open Work

Do these in order unless the owner says otherwise.

1. Point Studio at the graph service. `apps/studio/server/routes/runs.ts` calls `/runs/:id/checkpoint` and `/runs/:id/rollback`. The service has `/runs/{id}/resume` and no rollback. Build the Studio palette from `GET /nodes`.
2. Add `lfx` components to the graph node catalog. Start with Prompt Template, Split Text, Parse JSON, and the OpenAI chat component with the LiteLLM URL. Pin `lfx==1.13.3` and `lfx-openai==0.2.0` together. An old spike may still exist in `/tmp/lfx-spike/`.
3. Port the remaining node kinds to `packages/graph` after the owner decides on each: `tool shell`, `tool http`, `tool yue2`, `skill`, and the `memory` nodes.
4. Migrate Studio to `@xyflow/react` 13. It is held at 12.12.1, because version 13 removes `useStore` and changes the change handler types. Add canvas tests first.
5. Rebuild `pi-sandbox:latest`. `docker/Dockerfile.pi` pins pi 1.6.0, but the local image has pi 1.5.2.
6. Bring legacy directories to the standards one at a time. Then remove each one from the legacy list. Use this order: packages, pi extensions, Studio. Run the safe auto-fixes first.
7. Route all agents through LiteLLM. Start with the `pi` and OpenCode config.

Decisions that wait for the owner:

- Remove Langflow? It saves one service and about 2 GB.
- Allow `LANGFLOW_RESTRICT_LOCAL_FILE_ACCESS=false` and `LANGFLOW_SSRF_ALLOWED_HOSTS` for the `lfx` File and URL components?
- Allow a file limit above 300 lines for UI components?
- Keep the `packages/graph/typings/langgraph/` stubs? `langgraph` ships no type information for `langgraph.graph`.

## 4 Legacy List

`make test` skips the legacy paths. These files hold the list. Change them together:

- `Makefile`: the `LEGACY` variable
- `.config/lefthook.yml`: the `x-legacy` and `x-legacy-docs` anchors
- `pyproject.toml`, `biome.json`, `vitest.config.ts`, `.config/vale/vale.ini`, and `bin/agent-format.sh`

The comment check and the legacy `tsx` tests take their file lists from the Makefile.

## 5 Tests

- Integration tests in `tests/integration/` need `make up`. They skip a service that does not answer. Set `LIVE_STRICT=1` to fail instead.
- `CLOUD=1` adds the cloud role calls. `HEAVY=1` adds the 35B model calls. Both are off by default.
- These items have no automatic test:
  - The Studio UI and its Playwright e2e spec in `apps/studio/e2e/`.
  - An interactive `pi` session.
  - The guard inside pi, OpenCode, and Antigravity.
  - The YuE2 start on demand.

## 6 Traps

- The guard blocks shell commands and edits that contain protected text, such as `cat .env`, a write to `.env`, or the Docker socket path. Read the reason. Do not split the text to get around it.
- The guard blocks edits to `.pi/models.json` and `.pi/model-roles.json`. Write a proposal to `.pi/models.next.json` or `.pi/model-roles.next.json`. The owner moves it into place.
- The post-edit formatter removes unused imports. If you write a file in two parts, add the imports in the last part.
- lefthook 2 ignores a regex `exclude`. Use a list of globs.
- gitleaks reads past a line end in `.env.example`. Mark an empty key line with `# gitleaks:allow`.
- Router presets in `docker/llama-models.ini` cannot read env vars.
- The YuE2 gateway unloads all models on port 8080 before a music job. The CPU models load again on the next request.
- OpenCode 1.15.10 rejects the schema keys `providers` and `permissions`. Keep `provider`, `permission`, and a flat `mcp` map.
- Langfuse v4 runs in events_only mode. `/api/public/traces` returns 404. Read spans from `/api/public/v2/observations`.
- A new Langfuse `SALT` breaks the stored project API key. Delete its `api_keys` row and restart `langfuse-web`. The startup setup creates the key again.
- pnpm 12 reads `saveExact` only from `pnpm-workspace.yaml`. npm reads `save-exact` from the `.npmrc` next to each `package.json`.
- The OpenTelemetry exporter 0.3xx needs SDK 3. `@langfuse/otel` 6 still needs SDK 2, so the pi Langfuse extension stays on exporter 0.223.
- `next dev` writes agent rules into `apps/studio/AGENTS.md` unless `agentRules: false` stays in `apps/studio/next.config.ts`.
- `mise exec -C <dir>` changes the working directory. Do not use it to run a command in a scratch folder.
