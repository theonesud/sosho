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
| Orchestration | The owner retired graph, workflow-engine, Studio, and Langflow. Their code is in `legacy/`. The `graph` and `langflow` services are not in `compose.yaml`. |
| Engine | `packages/engine` is the DBOS workflow engine. The `engine` service in `compose.yaml` serves the API on port 8123. Read `packages/engine/README.md`. |
| Next | A new UI follows the engine. |
| pi | `pi` runs in the `pi-sandbox:latest` container on `sosho-net`. `pi --raw` runs on the host. |
| Node | Node comes from nvm and `.nvmrc`. The owner's shell can still resolve an older Node. Run `nvm use` first. |
| Config | Tool configs that can leave the root are in `.config/`: mise, lefthook, Vale, and the comment allow list. LiteLLM reads `docker/litellm.yaml`. |
| Guard | All four agents call `bin/agent-guard.py` before each tool call. It runs with the system `python3`, which must be 3.12 or later. It uses only the standard library. |
| Secrets | The guard blocks secret files: env files, SSH keys, `.pem`, `.key`, `.netrc`, and cloud credentials. `.env.example` stays readable. A text guard cannot see a file name that a command builds at run time. |

## 3 Open Work

Do these in order unless the owner says otherwise.

1. Build a new UI on the engine API. Use `GET /nodes` for the palette.
2. Add engine features that are not built: memory, watchers, a code sandbox, and self improvement.
3. Rebuild `pi-sandbox:latest`. `docker/Dockerfile.pi` pins pi 1.6.0, but the local image has pi 1.5.2.
4. Bring legacy directories to the standards one at a time. Then remove each one from the legacy list. Use this order: packages, pi extensions.
5. Route all agents through LiteLLM. Start with the `pi` and OpenCode config.
6. Fix `lefthook validate`. It fails with `x-legacy: Value is array but should be object`. The hooks still run.
7. Stop the old `sosho-graph` and `langflow` containers. Remove the `sosho_graph-data` and `sosho_langflow-data` volumes. The owner decides when. `sosho-graph` holds host port 8123 until then. Set `SOSHO_ENGINE_PORT=8124` and `SOSHO_ENGINE_URL=http://127.0.0.1:8124` to run the engine beside it.

Decisions that wait for the owner:

- Turn on the Claude Code sandbox? It blocks secret reads at the OS level, also for scripts and built file names. It needs `bubblewrap` and `socat` on Linux. It also limits network and writes. Not tested on this machine.
- Allow a file limit above 300 lines for UI components?

## 4 Legacy List

`make test` skips the legacy paths. These files hold the list. Change them together:

- `Makefile`: the `LEGACY` variable
- `.config/lefthook.yml`: the `x-legacy` and `x-legacy-docs` anchors
- `pyproject.toml`, `biome.json`, `vitest.config.ts`, `.config/vale/vale.ini`, and `bin/agent-format.sh`

The comment check and the legacy `tsx` tests take their file lists from the Makefile.

## 5 Tests

- Engine unit tests are in `packages/engine/tests`. They use SQLite and fake models.
- Integration tests in `tests/integration/` need `make up`. They skip a service that does not answer. Set `LIVE_STRICT=1` to fail instead.
- `CLOUD=1` adds the cloud role calls. `HEAVY=1` adds the 35B model calls. Both are off by default.
- These items have no automatic test:
  - An interactive `pi` session.
  - The guard inside pi, OpenCode, and Antigravity. `tests/unit/test_guard.py` and `tests/unit/test_guard_bypass.py` test only the guard script.
  - The YuE2 start on demand.

## 6 Traps

- The engine uses the default DBOS pickle serializer. The portable JSON serializer fails on pydantic-ai model responses. Keep workflow arguments and node outputs as JSON values.
- Steps run again after a crash. Write each tool so that two runs give the same effect.
- The engine API needs the bearer token on every route except `GET /health` and the webhook route.
- A `map` or `subworkflow` run starts its child runs without a queue. Do not put them on a worker queue. A queued parent would wait for its own queued nodes and block the queue.
- Child runs inherit budget, deadline, and policy from the parent. Child runs do not start `workflow_finished` triggers.
- A `workflow_finished` chain stops at `max_depth`. Activation refuses a cycle.
- The `GET /runs` filter `workflow_id` reads the table `engine_runs`. Runs from before this table do not appear in that filter.
- A new `SOSHO_ENGINE_APP_VERSION` leaves pending runs of the old version unrecovered. Change it only when no run waits for recovery.
- The guard blocks each shell command whose text names a secret file, also in quotes or a commit message. Read the reason. Do not split the text to get around it. Write a commit message to a file and run `git commit -F <file>`.
- The guard blocks `grep -r`, `rg -u`, `rg --no-ignore`, and `docker compose config`. Use `rg` or `git grep`.
- Claude Code reads its hook settings when a session starts. After a change to the hooks or to a hook script path, restart Claude Code.
- One commit got an unstaged file during the pre-commit hook. The cause is not verified. Run `git show --stat HEAD` before each push.
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
- Biome 2.6.8 does not read `.config/biome.json`. Keep `biome.json` at the root.
- `mise exec -C <dir>` changes the working directory. Do not use it to run a command in a scratch folder.
