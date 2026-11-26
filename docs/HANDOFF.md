# Handoff

Read this file first. Then read `AGENTS.md` and the standards it lists. This file holds only facts that the code and the standards do not show.

## 1 Goal

Sosho is an AI workbench that runs on one GPU workstation. One human owner and agents use it. `docs/usecases.md` lists the use cases.

The workflow backend is `packages/engine`, module `sosho_engine`. It is a JSON graph interpreter on DBOS Transact 3.7.0, written in Python. Workflows are versioned JSON. Agents write them now. The owner writes them on a canvas later. Build the backend first. Build the UI after the backend.

Every model call goes through the LiteLLM proxy. Do not add direct provider, llama.cpp, or RustingStrata access. Claude Code is the exception. It calls Anthropic directly. The llama.cpp and `strata` ports have no host port.

`agent`, `skill`, and `llm` nodes run pi sessions on the host worker. Only `llm` nodes whose role is in `SOSHO_ENGINE_DIRECT_ROLES` are plain model calls in the engine. The default value is `decision`. Calls for embeddings stay direct LiteLLM calls.

Work method: Claude Code acts as coordinator only. Sonnet subagents write code. Haiku subagents do other work. See `.claude/CLAUDE.md` item 6. The owner rules are in `AGENTS.md` section 8.

## 2 State

- Date of this state: 2026-11-26. Branch `refactor`. Last commit `6315ff7`. Nothing is pushed.
- The work of 2026-11-25 and 2026-11-26 is in commits `b197c69` to `6315ff7`. Commit `728fcdc` holds the unfinished prompt order change (section 4, item 0). Ask the owner before the next commit or a push.
- Nothing is pushed.
- Last full run: `make test COV=1` exit code 2, in 10 minutes 35 seconds. Pytest result: 501 passed, 1 failed. Coverage: 96 percent.
- The failure: `test_limits_stop_the_node_and_count_calls_on_both_paths`. The per-line cap tripped before the total cap.
- A fix is in commit `728fcdc`. It sets `SOSHO_ENGINE_PI_LINE_CAP_BYTES` high in that test. It also adds a separate line-cap case. The fix is not run yet.
- `make test-fast` exited 0 in 77 seconds. This run came before the latest changes. It is not rerun after them.
- The previous full run, before the test reduction, took 18 minutes 45 seconds. It had 493 tests and 88 percent coverage.
- `compose.yaml` services: `model-download`, `llama-cpp`, `strata`, `litellm`, and `engine`. The `music` profile adds the `yue2-*` services. The Langfuse stack in `docker/compose.langfuse.yaml` adds `postgres`.
- The engine listens on `127.0.0.1:8123`. Every route needs the bearer token `SOSHO_ENGINE_API_TOKEN`, except `GET /health` and the webhook route.
- The DBOS system database `sosho_engine` lives on the `postgres` service. The host worker reaches it on `127.0.0.1:${SOSHO_POSTGRES_PORT:-5432}`.
- The host worker runs as the systemd user service `sosho-worker`.
- The DBOS executor id of the engine is `engine`. The id of the worker is `host-worker`. Source: `packages/engine/src/sosho_engine/settings.py:9`.
- Each process needs its own executor id. With a shared id, one process can take over the pending runs of the other.
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
  - `cloud-io`: 8.
  - `host-browser`: 2.
  - `host`: 4. Only the host worker listens to `host`.
  - A node with `queue: local-gpu` is rejected.
  - A non-direct `llm` node runs on `host` with the pi flags `--no-tools --no-skills --no-context-files` and one turn.
  - A direct `llm` node runs with no queue or on `cloud-io`.
- An `agent` or `skill` node runs `bin/pi-launcher.sh --raw -p --no-session --mode json --provider litellm --model <role>` on the host worker. The worker loads the extensions `guard` and `langfuse` with `-e`.
- The optional field `thinking` of a pi node sets the pi flag `--thinking`. The values are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. An unset field passes no flag. A direct `llm` node with `thinking` fails validation. The issue code is `thinking_direct`.
- A version has a policy. The fields are `allowed_kinds`, `allowed_tools`, `allowed_skills`, `max_steps`, `max_run_seconds`, `max_llm_calls`, and `max_depth`.
- The worker gate covers every pi session whose role is in `SOSHO_ENGINE_GPU_ROLES`. This includes `agent`, `skill`, and `llm` nodes. The gate is the only GPU limit. The default value is `local-uncensored`. All chat calls run as pi sessions on the host worker behind this gate.

## 4 Open Work

### 0 Unfinished work from 2026-11-26

Do these first.

a) Prompt order change is half done.
   - `packages/engine/src/sosho_engine/host_node.py` sends node instructions in the first user message. The heading is `Instructions:`, from the constant `INSTRUCTIONS_HEADING` at `host_node.py:25`.
   - Before this change, the instructions went in `--append-system-prompt`.
   - These files may not match the change: `packages/engine/tests/test_pi_command.py`, `packages/engine/tests/pi_support.py`, the merged normal-run test, and `packages/engine/README.md`. Not verified.
   - Run `make up`.
   - Run `uv run pytest packages/engine/tests/test_pi_command.py packages/engine/tests/test_host_nodes.py -q`.
   - Fix the failures. Then run `make test` once.
b) Checkpoint experiment. No gain. Cause not found.
   - Old llama.cpp result. The Qwen3.6 preset had `checkpoint-min-step = 1024` and `ctx-checkpoints = 32`. The preset is removed. `strata` now serves `local-uncensored`. The result below does not apply to `strata`. Not verified on `strata`.
   - Measurements. Logs `/tmp/llama_step2.log`, `/tmp/llama_step3.log`, and `/tmp/llama_step4.log` may be gone after a reboot.
   - The first request of each new pi session still evaluates the full prompt.
   - Baseline, no checkpoints: 35 to 44 seconds for 8656 to 8772 tokens. The prefix match is 0.80 to 0.87.
   - With checkpoints: 34 to 36 seconds.
   - With the new prompt order: 35 to 40 seconds for 9170 to 9370 tokens.
   - No checkpoint lines appear in the log.
   - Within one session, later turns reuse the cache. About 90 tokens are evaluated.
   - Ask the owner whether to keep or remove these: the two keys and the prompt order change.
   - Next ideas. Not verified:
     - Raise the llama.cpp log verbosity to see checkpoint events.
     - Check the llama.cpp issues for prefix reuse on the hybrid `qwen35moe` model.
     - Test `--swa-full`.
     - Test `--cache-reuse`.
c) Facts found about the Qwen3.6 model.
   - GGUF architecture `qwen35moe`. 40 layers. `full_attention_interval = 4`. SSM keys are present. The model is hybrid. The count of 10 attention layers is an inference. Not verified.
   - Prefill speed: about 200 to 250 tokens per second.
   - First request of an engine agent session: about 8700 to 9400 tokens.
   - First request of a pi `llm` node: about 750 tokens.
   - The old figure of 11400 tokens is wrong.
d) Review the 155 tests outside the coverage set.
   - These tests take 494 seconds in total. The list is in `/tmp/full_cov_summary2.txt`. The file may be gone after a reboot.
   - The coverage set does not see work in child processes. 221 tests have no per-test data.
   - Check each test before you delete it.
   - The owner wants maximum coverage in minimum time.
e) Owner question, still open. No answer yet.
   - The agent docs checker limits were raised to 1000 lines. This applies to `.claude/CLAUDE.md`, which was 25 non-empty lines, and to each `.agents/rules/*.md`, which was 15 lines. The change follows the decision "all files 1000 lines".
   - The coordinator suggests restoring 25 and 15.
   - Ask the owner which limit to use.

### 1 Daily research digest workflow

The owner chose skill nodes with the `dokobot` skill for web search.

Build the test workflow "daily research digest" on role `local-uncensored`. The workflow must use every node kind and every trigger mode:

- A cron trigger and a webhook trigger.
- A `map` over topics into a research subworkflow. Its `agent` or `skill` nodes search the web.
- A `router` quality check with a loop that revises weak sections.
- A `join`.
- A `human` approval.
- A `wait` before publication.
- A `workflow_finished` trigger that publishes.

The owner must start host Chrome with the Dokobot extension first. The file `~/.dokobot/bridges.json` held `[]` on 2026-11-25. Not verified on 2026-11-26.

### 2 Verification items. Not verified yet

- A cron schedule fires by itself.
- Crash recovery on Postgres.
- SIGKILL of the worker during a live pi session. Check for an orphan pi process.
- The `sosho-worker` service starts at boot. This needs `loginctl enable-linger`.
- OpenCode through LiteLLM.
- Container-mode pi.

### 3 Cost and session id

- Add cost for local and cloud models in LiteLLM, so that Langfuse shows cost.
- Put the session id on the LiteLLM records.

### 4 Legacy paths

- Bring the remaining legacy paths to the standards, or delete them. See section 6.

### 5 Lefthook validation

- Fix `lefthook validate`. On 2026-11-25 it exits 1 with `x-legacy: Value is array but should be object`. The same error appears for `x-legacy-docs`.

## 5 Decisions that wait for the owner

Do not start these without the owner:

- The memory layer: run state, workflow memory, and global memory. Start it after the basics are verified.
- Self-improvement. Reflection proposes a new version as a diff. The owner approves it.
- The UI. The stack is Vite, React, React Flow 13, Tailwind, Radix with shadcn, TanStack Query, and ELK. The screens are Workflows, Editor, Run view, Inbox for human input, Triggers, and Versions. The UI talks only to the engine API.

Decisions made by the owner on 2026-11-25 and 2026-11-26. Most rules are now in `AGENTS.md` section 8:

- The sandbox stays off.
- One file limit of 1000 lines. One function limit of 60 lines. The checker is `bin/check-file-length.py`.
- Unused Docker items are removed.
- `local-uncensored` runs on the `strata` service: RustingStrata built from the fork `theonesud/RustingStrata`, commit `c33b153a08bbc53ababf578eecb33ed6a0fec33e`, with the model Qwen3.6-35B-A3B Heretic Q4_K_M. Keep the tuned flags in `compose.yaml`. The tuning record is `/home/sud/local-inference-tuning/campaigns/qwen36-35b-a3b-heretic-q4km__rustingstrata__beast/PLAN.md`. It lives outside this repository.
- `strata` has no host port. It serves the model alias `Qwen3.6-35B-A3B`. It has sampling defaults `temp` 0.6, `top-p` 0.95, `top-k` 20, `min-p` 0, because pi sends no sampling values. It unloads the model after 900 idle seconds. `/health` answers 200 while unloaded.
- The image is built for the CPU of this host with `target-cpu=native`.
- `decision` and `embed` run on the CPU only. They use `device = none` and `sleep-idle-seconds = 900`.
- Qwen sampling for precise coding: `temp` 0.6, `top-p` 0.95, `top-k` 20, `min-p` 0.0, `presence-penalty` 0.0, `repeat-penalty` 1.0. The prompt has no "reason in English" line.
- All chat model calls run through pi. The exception is the roles in `SOSHO_ENGINE_DIRECT_ROLES`. The default is `decision`. Embeddings are direct.
- The optional node field `thinking` sets the pi `--thinking` level. Direct `llm` nodes reject it.
- Tests use real pi and local models only. No cloud tests.
- Two test levels exist. See section 7.
- Test speed prints by default. Coverage runs with `--cov`, with `make cov`, or with `make test COV=1`. A set cover summary is printed.
- pi and the pi extensions always use the latest version.
- Launcher state. The launcher uses the root `.pi` inside the repository. Outside the repository, it uses its own `.pi`. `SOSHO_PI_STATE=root` forces the root state. The host worker sets it.
- Ask the owner before you run a benchmark.
- Make no commits until the owner asks.

## 6 Legacy List

`make test` skips the legacy paths. The `LEGACY` variable in `Makefile:13` lists them:

- `legacy`, which holds the retired graph service, the workflow engine, and Studio. Commit `bf66cd6` moved them.
- `packages/memory`
- `packages/yue2`
- `docker/Dockerfile.yue2-gateway`
- `.pi`
- `.agents/skills`
- `models`

When the list changes, edit every file that names these paths. See `Makefile`, `.config/lefthook.yml`, `biome.json`, `pyproject.toml`, `vitest.config.ts`, `.config/vale/vale.ini`, and `bin/agent-format.sh`.

## 7 Tests

- Two test levels exist.
  - `make test` is the full level. It runs all checks and all tests, live tests included. It takes about 10 to 11 minutes.
  - `make test-fast` is the fast level. It runs the same checks and `pytest -m "not integration"`. It needs no model, no GPU, and no live stack. It takes about 77 seconds.
  - The pre-push hook runs `make test-fast`.
  - Run `make test` before you report a finished batch.
  - Vale prints warnings only. Exit code 0 is required.
- Coverage: `make cov` runs only the pytest tests with coverage. `make test COV=1` adds coverage to the full run.
- The marker `integration` marks each test that needs the live stack. The `live_stack` fixture adds the marker by itself.
- A test that needs the live stack uses `live_api` or `live_host_api`. It skips when LiteLLM does not answer. Set `LIVE_STRICT=1` to fail instead.
- Engine tests are in `packages/engine/tests`. The engine uses SQLite. A second process, the host worker, runs the real pi through `bin/pi-launcher.sh --raw`. There is no fake pi and no fake model.
- All tests call only local models. Pi sessions use `local-uncensored`. Direct `llm` calls use `decision`. No test uses a cloud role.
- The tests assert structure and behavior, not exact model text. Failures come from real sources: the role `no-such-role`, `timeout_seconds: 1`, `max_turns: 1`, a low stdout cap, and `PI_VERSION` with a version that does not exist.
- The fault proxy is `packages/engine/tests/fault_proxy.py`. It returns status 400 for the first N requests. It forwards the rest to the real LiteLLM. For pi, the test sets `SOSHO_ENGINE_REPO_ROOT` to a temporary root. The root holds a copy of `.pi/models.json` that names the proxy.
- The merged pi tests cover the normal run, the errors, and the limits. They run the real pi.
- The fan-out test uses 2 items and 1 host slot. It sets `SOSHO_TEST_HOST_SLOTS`.
- Integration tests are in `tests/integration/`. They need `make up`. A test skips a service that does not answer. Set `LIVE_STRICT=1` to fail instead.
- `tests/integration/test_pi_launcher.py` runs the real launcher, the real pi, and the image `pi-sandbox:latest`. Each run sets `PI_SKIP_WARMUP=1` and a fresh stamp file in a temporary workspace. No test starts the daily image rebuild.
- `tests/integration/test_engine_worker.py` runs the real pi on `local-uncensored`. It uses the unit `sosho-worker` when the unit is active.
- The GPU has one slot for `local-uncensored`. Pi sessions run one at a time.
- Run times:
  - A live pi session takes about 15 to 40 seconds.
  - The full suite takes about 10 to 11 minutes.
- No automatic test covers these items:
  - An interactive pi session.
  - The systemd unit at login or at boot.
  - The guard inside pi, OpenCode, or Antigravity. The guard tests cover only the script.
  - The YuE2 start on demand.

## 8 Traps

- Each engine code change changes the app version. The version is a hash of the package source unless `SOSHO_ENGINE_APP_VERSION` is set. Pending runs of the old version do not recover. After each engine code change, run `make up`. It restarts the worker.
- Run every pi probe with `</dev/null`. `pi -p` reads stdin when stdin is a pipe that stays open. It prints nothing until stdin closes. This is the probable cause of the two hung probes from 2026-11-25. Not verified for those runs. The engine uses `DEVNULL`.
- The worker can take any workflow from the DBOS internal queue. This happens after a recovery, a resume, a fork, or a cron start. The worker is not only for host work.
- Saved versions with the old `agent` fields `tools` and `max_requests` do not load. The node models reject extra fields.
- In pi JSON mode, a model error exits 0 with `stopReason` `error`. The worker fails the node. See `packages/engine/src/sosho_engine/host_node.py:101`.
- `decision` is a direct role set by `SOSHO_ENGINE_DIRECT_ROLES`. The engine and the worker must read the same value of `SOSHO_ENGINE_DIRECT_ROLES`. Its model Qwen3-1.7B runs with `ctx-size` 16384 and `parallel` 4. Each slot has 4096 tokens.
- The worker sets `SOSHO_PI_STATE=root` in the pi environment. The launcher then uses the root `.pi` state and the root npm cache for a work folder outside the repository. Without it, each work folder gets its own `.pi/.cache/npm`. The pi docs path in the system prompt then differs for each session, and the llama.cpp prompt prefix does not match.
- The memory and scratchpad extensions still create `.pi/memory` and `.pi/scratchpad` in the session folder.
- Inside the repository, the launcher skips `sync_llama_context` and `sync_compaction`. So `LLM_CTX_SIZE` in `.env` has no effect there.
- The per-test coverage table cannot see child processes. Check each test by hand before you delete it.
- A `map` or `subworkflow` child run starts without a queue. Do not put it on a queue. A queued parent blocks its own queued children.
- pi loads skills from `.agents/skills/` in its working directory. The `--skill` flag did not load them in a test. The worker links each skill into `<workdir>/.agents/skills/`.
- The guard blocks each shell command whose text names a secret file. This includes quoted text and commit messages. Do not split the text to pass the guard. Write the commit message to a file and run `git commit -F <file>`.
- The guard blocks some search and compose commands. The full list is in `bin/agent-guard.py`. Use `rg` or `git grep`.
- The guard blocks edits to `.pi/models.json` and `.pi/model-roles.json`. Write a proposal as `.pi/models.next.json` or `.pi/model-roles.next.json`. Ask the owner to move it into place.
- The launcher and the pi state follow these rules:
  - Inside the repository, the root `.pi` is used.
  - Outside the repository, the work folder `.pi` is used.
  - `SOSHO_PI_STATE=root` forces the root `.pi`.
- The GPU has one slot for `local-uncensored`. Parallel test runs and an interactive pi session slow each other.
- In a `!` shell line, a leading `!` negates the command in bash. Give the owner commands without a second `!`.
- `make test` skips the engine integration tests if another service answers on port 8123. Set `SOSHO_ENGINE_URL`, or set `LIVE_STRICT=1` to fail instead.
- `shellcheck` needs `-x` for `bin/pi-launcher.sh`. Without `-x`, it prints SC1091 as info.
- lefthook 2 ignores a regex `exclude`. Use a list of globs.
- gitleaks reads past the end of a line in `.env.example`. Mark an empty key line with `# gitleaks:allow`. See `docs/standards/code.md`.
- Biome 2.6.8 does not read `.config/biome.json`. Keep `biome.json` at the root.
- `mise exec -C <dir>` changes the working directory. Do not use it to run a command in a scratch folder.
- pnpm 12 reads `saveExact` only from `pnpm-workspace.yaml`. npm reads `save-exact` from the `.npmrc` beside each `package.json`. Both files set it.
- The pi Langfuse extension pins `@langfuse/otel` 6.1.1, `@opentelemetry/exporter-trace-otlp-http` 0.223.2, and `@opentelemetry/sdk-trace-node` 2.12.0. See `.pi/extensions/langfuse/package.json`. Do not change one version alone.
- Langfuse v4 runs in events-only mode. `/api/public/traces` returns 404. Read spans from `/api/public/v2/observations`. This is not verified in the repository code.
- A new Langfuse `SALT` breaks the stored project API key. Delete its `api_keys` row and restart `langfuse-web`. The startup setup creates the key again.
- Router presets in `docker/llama-models.ini` cannot read environment variables.
- In `docker/llama-models.ini`, `decision` and `embed` have `device = none` and `n-gpu-layers = 0`. `n-gpu-layers = 0` alone still reserved VRAM. The `embed` model failed with `cudaMalloc failed: out of memory` while Qwen3.6 was loaded. With `device = none`, neither process holds VRAM. `llama-cpp` has no GPU reservation now.
- In `docker/llama-models.ini`, both presets have `sleep-idle-seconds = 900`.
- Claude Code reads its hook settings when a session starts. After a change to the hooks or a hook script path, restart Claude Code.
- OpenCode rejects the schema keys `providers` and `permissions`. Use `provider`, `permission`, and a flat `mcp` map. See `opencode.json`.
- RustingStrata has no unload call. Before a music job, the YuE2 gateway waits until `GET http://strata:8080/health` shows `"unloaded": true`. That state follows 900 idle seconds. The wait ends after `YUE2_LLAMA_UNLOAD_TIMEOUT_SECONDS`, default 960. Then the job runs. A chat request during a music job loads the model again and can fail for lack of VRAM. Not verified with a live music job.
- The pi `llm` path ignores `temperature` and `max_tokens`.
- The OpenAI client retries a status 5xx by itself. The fault proxy answers status 400, so each engine attempt makes one request.
- A direct `llm` node in the same wave as a slow node waits for that node. Put it in an earlier wave when a test needs its result first.
- `bin/check-agent-docs.sh` is a wrapper for `bin/check-agent-docs.py` and the package `bin/agent_docs/`.
