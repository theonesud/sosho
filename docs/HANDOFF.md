# Handoff

Read this file first. Then read `AGENTS.md` and the standards it lists. This file holds only facts that the code and the standards do not show.

## 1 Goal

Sosho is an AI workbench that runs on one GPU workstation. One human owner and agents use it. `docs/usecases.md` lists the use cases.

The workflow backend is `packages/engine`, module `sosho_engine`. It is a JSON graph interpreter on DBOS Transact 3.7.0, written in Python. Workflows are versioned JSON. Agents write them now. The owner writes them on a canvas later. Build the backend first. Build the UI after the backend.

Every model call goes through the LiteLLM proxy. Do not add direct provider or llama.cpp access. Claude Code is the exception. It calls Anthropic directly. The llama.cpp port has no host port.

`agent` and `skill` nodes run pi sessions on a host worker. `llm` nodes are plain model calls in the engine.

Claude Code acts as coordinator only. Sonnet subagents write code. Haiku subagents do other work. See `.claude/CLAUDE.md` item 6.

## 2 State

Date of this state: 2026-11-25. Branch `refactor`. Commits up to `61506af`. Nothing is pushed.

- `make test` exits 0 with the stack up. The result is 429 passed and 7 skipped.
- `compose.yaml` services: `model-download`, `llama-cpp`, `litellm`, and `engine`. The `music` profile adds the `yue2-*` services. The Langfuse stack in `docker/compose.langfuse.yaml` adds `postgres`.
- The engine listens on `127.0.0.1:8123`. Every route needs the bearer token `SOSHO_ENGINE_API_TOKEN`, except `GET /health` and the webhook route.
- The DBOS system database `sosho_engine` lives on the `postgres` service. The host worker reaches it on `127.0.0.1:${SOSHO_POSTGRES_PORT:-5432}`.
- The host worker runs as the systemd user service `sosho-worker`.
- In Langfuse, the pi spans and the LiteLLM generations share one trace. LiteLLM records no cost for these calls. The session id appears only on the pi spans.

## 3 Engine summary

Read `packages/engine/README.md` for the API and the run rules. This section lists the facts that the next session needs first.

- A saved version never changes. Each run pins one version.
- Node kinds:
  - `trigger`, with modes `manual`, `cron`, `webhook`, and `workflow_finished`.
  - `llm`, `agent`, `skill`, and `tool`.
  - `router`, `map`, `join`, `human`, `subworkflow`, and `wait`.
- Tools: only `echo` and `text_join`. Source: `packages/engine/src/sosho_engine/tools.py`.
- Queues and slots:
  - `local-gpu`: 1.
  - `cloud-io`: 8.
  - `host-browser`: 2.
  - `host`: 4. Only the host worker listens to `host`.
- An `agent` or `skill` node runs `bin/pi-launcher.sh --raw -p --no-session --mode json --provider litellm --model <role>` on the host worker. The worker loads the extensions `guard` and `langfuse` with `-e`.
- A version has a policy. The fields are `allowed_kinds`, `allowed_tools`, `allowed_skills`, `max_steps`, `max_run_seconds`, `max_llm_calls`, and `max_depth`.
- The worker lets one pi session at a time use each role in `SOSHO_ENGINE_GPU_ROLES`. The default is `local-uncensored`.

## 4 Open Work

Do these in order unless the owner says otherwise.

1. Build the test workflow "daily research digest" on role `local-uncensored`. First add the engine tools `web_search`, `fetch_url`, and `write_file`. Or use the `dokobot` skill through skill nodes. The workflow must use every node kind and every trigger mode:
   - A cron trigger and a webhook trigger.
   - A `map` over topics into a research subworkflow. Its `agent` or `skill` nodes search the web.
   - A `router` quality check with a loop that revises weak sections.
   - A `join`.
   - A `human` approval.
   - A `wait` before publication.
   - A `workflow_finished` trigger that publishes.
   Web search through dokobot needs host Chrome with the Dokobot extension running. On 2026-11-25, `~/.dokobot/bridges.json` is 2 bytes long. Its content is not verified.
2. Verify these items. They are not verified yet:
   - A cron schedule fires by itself.
   - Crash recovery on Postgres.
   - SIGKILL of the worker during a live pi session. Check for an orphan pi process.
   - The `sosho-worker` service starts at boot. This needs `loginctl enable-linger`.
   - OpenCode through LiteLLM.
   - Container-mode pi.
3. Share the GPU limit between `llm` nodes on queue `local-gpu` and pi sessions on `local-uncensored`.
4. Add cost for local and cloud models in LiteLLM, so that Langfuse shows cost. Put the session id on the LiteLLM records.
5. Rebuild `pi-sandbox:latest`. `docker/Dockerfile.pi` pins pi 1.6.0. The host has no pi binary, so `--raw` runs pi through `npx` at each start. Consider a pinned host install.
6. Find the cause of two pi probe runs that hung with no output. The cause is not verified.
7. Bring the remaining legacy paths to the standards, or delete them. See section 6.
8. Fix `lefthook validate`. On 2026-11-25 it exits 1 with `x-legacy: Value is array but should be object`. The same error appears for `x-legacy-docs`.

## 5 Decisions that wait for the owner

Do not start these without the owner:

- The memory layer: run state, workflow memory, and global memory. Start it after the basics are verified.
- Self-improvement. Reflection proposes a new version as a diff. The owner approves it.
- The UI. The stack is Vite, React, React Flow 13, Tailwind, Radix with shadcn, TanStack Query, and ELK. The screens are Workflows, Editor, Run view, Inbox for human input, Triggers, and Versions. The UI talks only to the engine API.

Open decisions:

- Turn on the Claude Code sandbox? It needs `bubblewrap` and `socat` on Linux. It is not tested on this machine. `.claude/settings.json` has no sandbox setting now.
- Allow a file limit above 300 lines for UI components?
- Remove the orphan containers `sosho-embed-model-download-1` and `sosho-decision-model-download-1`. Both exited two days ago. The owner decides when to remove them.

## 6 Legacy List

`make test` skips the legacy paths. The `LEGACY` variable in `Makefile` lists them:

- `legacy`, which holds the retired graph service, the workflow engine, and Studio. Commit `bf66cd6` moved them.
- `packages/memory`
- `packages/yue2`
- `docker/Dockerfile.yue2-gateway`
- `.pi`
- `.agents/skills`
- `models`

When the list changes, edit every file that names these paths. See `Makefile`, `.config/lefthook.yml`, `biome.json`, `pyproject.toml`, `vitest.config.ts`, `.config/vale/vale.ini`, and `bin/agent-format.sh`.

## 7 Tests

- `make test` runs all checks and tests. It changes no files. Vale prints warnings only. Exit code 0 is required.
- Engine unit tests are in `packages/engine/tests`. They use SQLite and fake models. A test starts a second process, the host worker, with `packages/engine/tests/fake_pi.py`.
- Integration tests are in `tests/integration/`. They need `make up`. A test skips a service that does not answer. Set `LIVE_STRICT=1` to fail instead.
- `CLOUD=1` adds the cloud role calls. `HEAVY=1` adds the calls to the 35B model. Both are off by default.
- `tests/integration/test_engine_worker.py` stops `sosho-worker` during its run. It starts the unit again at the end.
- No automatic test covers these items:
  - An interactive pi session.
  - The systemd unit at login or at boot.
  - The guard inside pi, OpenCode, or Antigravity. The guard tests cover only the script.
  - The YuE2 start on demand.

## 8 Traps

- Each engine code change changes the app version. The version is a hash of the package source unless `SOSHO_ENGINE_APP_VERSION` is set. Pending runs of the old version do not recover. After a change, run `make up`. It restarts the worker.
- The worker can take any workflow from the DBOS internal queue. This happens after a recovery, a resume, a fork, or a cron start. The worker is not only for host work.
- Saved versions with the old `agent` fields `tools` and `max_requests` do not load. The node models reject extra fields.
- In pi JSON mode, a model error exits 0 with `stopReason` `error`. The worker fails the node. See `packages/engine/src/sosho_engine/host_node.py:101`.
- The `decision` role cannot run pi. Its model Qwen3-1.7B runs with `ctx-size` 16384 and `parallel` 4. Each slot has 4096 tokens. The pi system prompt is about 11400 tokens. This size is not verified in this session.
- A `map` or `subworkflow` child run starts without a queue. Do not put it on a queue. A queued parent blocks its own queued children.
- pi loads skills from `.agents/skills/` in its working directory. The `--skill` flag did not load them in a test. The worker links each skill into `<workdir>/.agents/skills/`.
- The guard blocks each shell command whose text names a secret file. This includes quoted text and commit messages. Do not split the text to pass the guard. Write the commit message to a file and run `git commit -F <file>`.
- The guard blocks some search and compose commands. The full list is in `bin/agent-guard.py`. Use `rg` or `git grep`.
- The guard blocks edits to `.pi/models.json` and `.pi/model-roles.json`. Write a proposal as `.pi/models.next.json` or `.pi/model-roles.next.json`. Ask the owner to move it into place.
- In a `!` shell line, a leading `!` negates the command in bash. Give the owner commands without a second `!`.
- `make test` skips the engine integration tests if another service answers on port 8123. Set `SOSHO_ENGINE_URL`, or set `LIVE_STRICT=1` to fail instead.
- lefthook 2 ignores a regex `exclude`. Use a list of globs.
- gitleaks reads past the end of a line in `.env.example`. Mark an empty key line with `# gitleaks:allow`. See `docs/standards/code.md`.
- Biome 2.6.8 does not read `.config/biome.json`. Keep `biome.json` at the root.
- `mise exec -C <dir>` changes the working directory. Do not use it to run a command in a scratch folder.
- pnpm 12 reads `saveExact` only from `pnpm-workspace.yaml`. npm reads `save-exact` from the `.npmrc` beside each `package.json`. Both files set it.
- The pi Langfuse extension pins `@langfuse/otel` 6.1.1, `@opentelemetry/exporter-trace-otlp-http` 0.223.2, and `@opentelemetry/sdk-trace-node` 2.12.0. See `.pi/extensions/langfuse/package.json`. Do not change one version alone.
- Langfuse v4 runs in events-only mode. `/api/public/traces` returns 404. Read spans from `/api/public/v2/observations`. This is not verified in the repository code.
- A new Langfuse `SALT` breaks the stored project API key. Delete its `api_keys` row and restart `langfuse-web`. The startup setup creates the key again.
- Router presets in `docker/llama-models.ini` cannot read environment variables.
