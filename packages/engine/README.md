# Sosho Engine

The engine runs workflows as durable DBOS Transact workflows. A workflow is a versioned JSON graph. One generic interpreter runs each graph.

## 1 Facts

- Module: `sosho_engine`. Service port: 8123. Command: `python -m sosho_engine`.
- DBOS keeps the state of each run in its system database. A run continues after a crash or a restart.
- A step can run again after a crash. Each tool must be safe to run twice.
- The engine stores workflow definitions and versions in the same database.
- A saved version never changes. A run uses one version for its whole life.
- LiteLLM serves the model roles. Phoenix receives the traces of LiteLLM and of pi. LiteLLM sends its spans with the callback `arize_phoenix`. The pi extension `phoenix` sends the pi spans.
- DBOS data and engine tables use the `postgres` service in `compose.yaml`. The database is `sosho_engine`. The engine creates it at start. Phoenix uses the separate database `phoenix` on the same server.

## 2 Node Kinds

Call `GET /nodes` for the JSON schema of each kind. Each node has `id`, `kind`, `name`, `queue`, `retry`, `timeout_seconds`, and `continue_on_error`.

| Kind | Purpose | Notes |
| :--- | :--- | :--- |
| `trigger` | Start a run. | Modes: `manual`, `cron`, `webhook`, `workflow_finished`. |
| `llm` | Send one prompt to a model role. | Set `json_output` to parse the answer. Set `thinking` for a pi session. A direct role rejects `thinking`. A pi session runs it, except for a role in `SOSHO_ENGINE_DIRECT_ROLES`. See section 4.3. |
| `agent` | Run a pi session on the host worker. | Fields: `role`, `prompt`, `instructions`, `skills`, `max_turns`, `thinking`. `timeout_seconds` kills the session. |
| `skill` | Run a pi session that uses one skill. | Fields: `skill`, `task`, `role`, `max_turns`, `thinking`. It runs on the host worker. |
| `tool` | Call a registered Python tool. | Always a step. |
| `router` | Choose one branch. | Each branch has a condition on earlier outputs. The condition `value` is a template. |
| `map` | Run a child workflow for each list item. | Set `max_items`. |
| `join` | Wait for parallel branches. | Set `require_all` to fail the join when it runs and an input edge was not taken. A join with no taken input is skipped and does not fail. |
| `human` | Wait for `approve`, `reject`, `input`, or `edit`. | A timeout applies `default_action`. |
| `subworkflow` | Run one child workflow version. | |
| `wait` | Sleep for a fixed time. | The sleep survives a restart. |

Rules for a graph:

- The graph needs an `entry` trigger. Each other node needs a path from a trigger.
- An edge with `when` leaves a `router` or a `human` node. The value is a branch name or an action.
- Only a `join` node can have two or more input edges.
- A cycle needs a `loop` edge with `max_iterations`. The cap is 50.
- A loop edge has `on_limit`. See section 2.1.
- A condition path must name a known node that is upstream of the router. The path must start with `input`, `nodes`, or `loop`.
- A cron trigger needs a valid cron string and a known time zone. The save of the version checks them.
- Only `llm`, `agent`, `skill`, and `tool` nodes accept `queue` and `timeout_seconds`.
- A node that runs on the host worker accepts only the queue `host`. These are `agent` nodes, `skill` nodes, and `llm` nodes with a role that is not direct. No other node accepts `host`. The issue is `host_queue`.
- The queue `local-gpu` does not exist. A node with `queue` set to `local-gpu` is refused with the message `queue local-gpu does not exist`. The save returns status 422.
- Only `llm`, `agent`, `skill`, `tool`, `router`, and `join` nodes accept `retry`. The other kinds give the issue `retry_kind`.
- The `role` of an `agent` node or a `skill` node must be `main`, `subagent`, `subagent-code`, `local-uncensored`, or `cloud-uncensored`. The `decision` role cannot run pi. Its context is 4096 tokens and the pi prompt has about 11400 tokens. The issue is `role_unsupported`.
- Each skill name must be in the skill catalog. The issue is `unknown_skill`. See section 4.1.

A template reads earlier outputs with `{{nodes.<id>.<field>}}`. It reads the run input with `{{input.<field>}}`. It reads the execution count with `{{loop.iteration}}`.

`{{loop.iteration}}` is the number of finished executions of the node that renders it. It is 0 at the first execution. It is not the pass count of one loop edge.

A condition `value` is rendered like other fields. A value that is exactly one placeholder keeps its type. A value with other text becomes text. Placeholders must name a known upstream node.

### 2.1 Loop edges

- A loop edge fires each time its source finishes and `when` matches. Each firing is one pass.
- `on_limit` is `exit` by default. The loop edge is not taken after `max_iterations` passes. The run continues on the other edges of the source.
- A router skips the loop branch at the cap. It chooses another branch that matches, or the default. If none is left, the router fails with `matched no branch`.
- A human node offers only its other actions at the cap. A reply with the blocked action is refused with status 409.
- The save needs another branch or action for each `exit` loop edge with `when`. The issue is `loop_no_exit`.
- With `on_limit` set to `fail`, the pass after the cap fails the run with `loop {source} to {target} passed {max_iterations}`. `continue_on_error` does not catch it.
- On a loop pass, the nodes after the loop target run again. Their earlier outputs stay readable until they run again.

## 3 Policy

Each version carries a policy. The engine checks it when you save the version and when the run executes.

| Field | Meaning |
| :--- | :--- |
| `allowed_kinds` | Node kinds that the graph can use. |
| `allowed_tools` | Tools that `tool` nodes can call. |
| `allowed_skills` | Skills that `agent` and `skill` nodes can use. The issue is `skill_denied`. |
| `max_steps` | Maximum node executions in one run. |
| `max_run_seconds` | DBOS workflow timeout for the run. Every start path applies it. |
| `max_llm_calls` | Budget of model requests. An `agent` or `skill` node counts one request for each pi turn. |
| `max_depth` | Maximum depth of child runs and chained runs. |

## 4 Queues

| Queue | Limit |
| :--- | :--- |
| `cloud-io` | 8 |
| `host-browser` | 2 |
| `host` | 4 |

A node with `queue` runs as a child workflow on that queue. An `agent` node, a `skill` node, and an `llm` node with a role that is not direct always run on `host`.

The engine does not listen to `host`. Only the host worker listens to it. See section 4.2.

A `map` node and a `subworkflow` node start their child runs without a queue. A run that only starts and awaits other runs never holds a slot of a queue. This rule prevents a deadlock between parent runs and their queued nodes.

### 4.1 Skill catalog

The engine container cannot see the host files. The host worker scans `.agents/skills/` for directories that hold a `SKILL.md` file. It writes the names to the table `engine_skills` at start and again when the list changes. The scan runs at each heartbeat.

- The engine reads the catalog when you save or validate a version. `GET /nodes` lists it in `skills`.
- A skill name that is not in the catalog gives the issue `unknown_skill`.
- The catalog is empty until the worker runs once. Until then every skill name is refused.

### 4.2 Host worker

The host worker is a process of the same package. Command: `python -m sosho_engine worker`. It runs on the host and connects to the Postgres database through `127.0.0.1`. It listens only to the queue `host`.

- Each process has its own DBOS executor id. The engine uses `engine`. The worker uses `host-worker`. With the shared default `local`, the worker can take a pending run of the engine.
- Both processes must have the same application version. If not, host work stays enqueued. The default version is a hash of the `.py` files of the package. Set `SOSHO_ENGINE_APP_VERSION` to override it for both.
- The worker writes a heartbeat to the table `engine_workers`. `GET /health` shows `worker.alive`, `worker.version`, and `worker.version_mismatch`. `alive` is true when a worker with the same version sent a heartbeat in the last 30 seconds.
- Enqueued host work waits while the worker is down. It runs when the worker starts. A restarted worker recovers its own pending work.
- DBOS also lets any process with the same version take a run from the internal queue. This happens after a recovery, a resume, a fork, or a cron start. For this reason the worker carries the full runtime. It can run any workflow.
- The worker runs each node as `bin/pi-launcher.sh --raw -p --no-session --mode json --provider litellm --model <role> <prompt>`. The environment has `PI_SKIP_WARMUP=1` and `SOSHO_ROOT=<repo>`. The extensions `guard` and `phoenix` of the repository load with `-e`. `instructions` go in the first user message under the heading `Instructions:`, before the heading `Task:`.
- The working directory is `<runs_dir>/<run_id>/<node_id>`. The default `runs_dir` is `~/.sosho/runs`. The worker deletes and creates the directory again at each step run. A second run of the step after a crash gives the same result.
- The worker links each needed skill as `<workdir>/.agents/skills/<name>`. The pi flag `--skill` did not load skills in a test. The directory did.
- The directory keeps `events.jsonl` with every JSON event line and `stderr.log`.
- The node output is `text`, `role`, `skill` or `skills`, `usage`, `tool_calls`, `duration_ms`, and `workdir`. `text` has at most 20000 characters. `truncated` shows a cut. `tool_calls` has at most 200 entries.
- The step fails when pi exits with a code other than 0. It also fails when the last assistant message has `stopReason` `error`. In JSON mode pi exits with 0 in that case. A line that is not JSON is skipped.
- The worker kills the pi process group at `timeout_seconds`. The default is 900 seconds. It also kills it when the run is cancelled, when the output is above 20 MiB, and when the session needs more than `max_turns` turns.
- `retry` runs pi again. A failed attempt counts as `max_turns` requests.
- The environment has `SOSHO_TRACE_PARENT_TRACE_ID`, `SOSHO_TRACE_PARENT_SPAN_ID`, and `SOSHO_TRACE_PARENT_SESSION_ID`. The trace id is a hash of the run id. The engine writes no span for the run. The span `pi session` of the node uses that trace id. Its parent span id is a hash of the run id and node id. No span exists for that parent. Not verified in Phoenix.

GPU limit: the worker lets one pi session at a time use a role in `gpu_roles`. The default is `local-uncensored`. A session on another role runs in parallel. The queue `host` has 4 slots. A waiting local session holds one slot. Every `llm` node with a role that is not direct uses the same gate. The gate is the only GPU limit. A direct `llm` node does not use the gate.

Service commands:

| Command | Purpose |
| :--- | :--- |
| `make worker` | Run the worker in the foreground. |
| `make worker-install` | Write `~/.config/systemd/user/sosho-worker.service`. Enable and start it. |
| `make worker-uninstall` | Stop, disable, and remove the unit. |
| `make worker-logs` | Follow the journal of the unit. |
| `make up` | Starts the containers, then restarts the unit when it is active. |

The unit holds no secret. It has `EnvironmentFile=` that points to the repository secrets file. Systemd reads the file at each start. The unit restarts on failure, and it starts at login. Run `loginctl enable-linger` to start it at boot. The worker builds its database URL from `SOSHO_PG_USER`, `SOSHO_PG_PASSWORD`, and `SOSHO_POSTGRES_PORT`.

### 4.3 LLM nodes

- An `llm` node runs as a pi session on the host worker, on the queue `host`. The command has `--no-tools`, `--no-skills`, and `--no-context-files`. The node prompt is the task. The node `role` is the model. `system` goes in the first user message under the heading `Instructions:`, before the heading `Task:`.
- The pi flag `--no-tools` was run once on the host. The pi system prompt then shows `(none)` for tools.
- The optional field `thinking` takes `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. When it is set, the worker passes `--thinking <level>` to pi. When it is not set, the worker passes no flag. A direct `llm` node with `thinking` fails validation with the code `thinking_direct`.
- The node output has the same keys on both paths: `text`, `role`, and `data` when `json_output` is set. The pi path gives the full text. The pi path ignores `temperature` and `max_tokens`.
- An `llm` node counts one request for each attempt on both paths. A session that needs more than one turn is stopped.
- The roles in `SOSHO_ENGINE_DIRECT_ROLES` skip pi. The default is `decision`. Its model has 4096 tokens in each slot and the pi system prompt has about 11400 tokens. An `llm` node with such a role calls LiteLLM in the engine. It needs no queue. It can use the queue `cloud-io`.
- Embedding calls are direct LiteLLM calls. They do not use pi.
- Set `SOSHO_ENGINE_DIRECT_ROLES` the same way for the engine and the worker.

## 5 Run Lifecycle

1. `POST /workflows/{id}/runs` pins one version and starts the `run_workflow` workflow. The run id is the DBOS workflow id.
2. The run loads the version in the `load_spec` step. It marks the entry trigger as done.
3. The interpreter finds the nodes that are ready. It runs them as one wave. Nodes in a wave run in parallel.
4. A node on a branch that was not taken is skipped. A skipped node skips its children.
5. The run writes events to the `log` stream and the `progress` event after each wave.
6. A `human` node runs as a child workflow. It waits for `POST /runs/{id}/input`.
7. The run ends with `succeeded` or `failed`. It then starts the runs of `workflow_finished` triggers.

Rules for a wave:

- The engine reserves model requests for each node before the wave starts. A wave cannot pass `max_llm_calls`.
- An `llm` node reserves one request for each allowed attempt. An `agent` node or a `skill` node reserves `max_turns` for each allowed attempt.
- A `map` node or a `subworkflow` node gets an equal share of the rest. A `map` node splits its share between its items.
- A failed node uses its reserved requests. A retry counts as one request.
- If a node fails and has no `continue_on_error`, the run fails at once. The engine cancels the other child runs of the run.
- A failed run also cancels all its child runs that are still active.

Rules for child runs of `map` and `subworkflow`:

- A child run gets the budget share, the remaining time, and the depth of its parent.
- The policy of a child run is the intersection of its own policy and the policy of its parent. This covers `allowed_tools`, `allowed_kinds`, `max_llm_calls`, and `max_depth`.
- A child run with a node that the parent policy denies fails with `policy denies`.
- The time limit of a child run is the smaller value of the time left in the parent and its own `max_run_seconds`.
- Child runs do not start `workflow_finished` triggers. Only a top-level run, or a run that a `workflow_finished` trigger started, does this.

Rules for chained runs:

- A run that a `workflow_finished` trigger starts has the depth of the source run plus one.
- The engine does not start a run when its depth is above its `max_depth`.
- A workflow cannot use its own end as a trigger. The save of the version fails with `finished_self`.
- Activation fails with status 409 when the new trigger makes a cycle between active workflows.

Control a run:

- Cancel stops the run and its child workflows.
- Resume starts a cancelled run again. The steps that finished keep their results.
- Fork starts a new run from an execution of a node. Set `occurrence` to choose the execution. The run replays the earlier steps from the record.
- For a `map` node, set `item` to fork from the child run of that item index. Items before it keep their results. `occurrence` counts executions of the node.

## 6 API

A run has one status name in every response, event, and filter: `pending`, `running`, `waiting`, `succeeded`, `failed`, or `cancelled`. `waiting` means a human node waits for an answer. The run summary also has `dbos_status` with the raw DBOS status. `GET /runs?status=` accepts only these names. Another value returns 400. A function in `run_status.py` maps the DBOS status to the name.

Each route needs the header `Authorization: Bearer <SOSHO_ENGINE_API_TOKEN>`. Two routes are open: `GET /health` and the webhook route. The webhook route needs `X-Sosho-Token`.

| Route | Purpose |
| :--- | :--- |
| `GET /health` | Report the state of the engine. |
| `GET /nodes` | List node kinds, tools, and queues. |
| `GET, POST /workflows` | List or create workflows. |
| `GET, PATCH, DELETE /workflows/{id}` | Read, rename, or delete one workflow. Delete first removes the triggers and schedules. |
| `GET, POST /workflows/{id}/versions` | List versions or save a new immutable version. |
| `GET /workflows/{id}/versions/{n}` | Read one version. |
| `POST /validate` | Return the issues of a draft. |
| `POST /workflows/{id}/runs` | Start a run from a `manual` trigger. A trigger of another mode returns 409. |
| `GET /runs` | List runs. Filters: `status`, `workflow_id`, `limit`, `offset`. The engine keeps an index of runs for the `workflow_id` filter. |
| `GET /runs/{id}` | Read a run, its progress, pending human requests, and steps. |
| `GET /runs/{id}/events` | Stream run events as server-sent events. |
| `POST /runs/{id}/input` | Answer a `human` node. A second answer to the same request returns 409. |
| `POST /runs/{id}/cancel` | Cancel a run. |
| `POST /runs/{id}/resume` | Resume a cancelled run. |
| `POST /runs/{id}/fork` | Fork a run from a node. |
| `POST, DELETE /workflows/{id}/activate` | Bind or remove the triggers of a version. `POST` needs a JSON object body. Use `{}` for the latest version. |
| `GET /schedules` | List cron schedules. |
| `POST /schedules/{name}/{pause, resume, trigger, delete}` | Manage a schedule. Another action returns 404. |
| `DELETE /schedules/{name}` | Delete a schedule. |
| `POST /webhooks/{workflow_id}/{node_id}` | Start a run from a `webhook` trigger. The header `X-Sosho-Token` is required. |

Activation reads the trigger nodes of one version:

- A `cron` trigger creates a DBOS schedule. The name is `wf.<workflow_id>.<node_id>`. A cron run starts only from its schedule.
- A `webhook` trigger gets a new token. The response shows the token one time. The engine stores only its hash.
- A `workflow_finished` trigger starts a run when the source workflow ends and its `on_status` matches. The run input is `source_run_id`, `status`, and `output`. These runs start only from the chain.
- Activation checks the cron strings and the time zones first. A bad value changes nothing.
- Activation replaces a schedule that has the same name. It removes the schedules of dropped trigger nodes after it saves the new bindings.

A webhook run starts only from the webhook route. A webhook request without the header `X-Sosho-Token` returns 422. A webhook request for an unknown trigger and a request with a wrong token both return 404. A body that is not valid JSON returns 400. Each trigger accepts `SOSHO_ENGINE_WEBHOOK_RATE_PER_MINUTE` requests in one minute. More requests return 429.

The API limits the body size. CORS allows only loopback origins.

## 7 Settings

| Variable | Meaning |
| :--- | :--- |
| `SOSHO_ENGINE_API_TOKEN` | Bearer token for all routes except health and webhook. Required. It needs at least 16 characters. `make setup` creates it. |
| `SOSHO_ENGINE_DB_URL` | System database URL. SQLite and Postgres work. |
| `SOSHO_ENGINE_APP_VERSION` | DBOS application version. A run recovers only on the same version. The default is a hash of the package source. |
| `SOSHO_ENGINE_EXECUTOR_ID` | DBOS executor id. The default is `engine`. The worker uses `host-worker`. |
| `SOSHO_POSTGRES_PORT` | Host port of Postgres, on `127.0.0.1` only. The default is 5432. |
| `SOSHO_ENGINE_RUNS_DIR` | Worker root for session directories. The default is `~/.sosho/runs`. |
| `SOSHO_ENGINE_SKILLS_DIR` | Worker skills directory. The default is `<repo>/.agents/skills`. |
| `SOSHO_ENGINE_PI_COMMAND` | Worker pi command. The default is `<repo>/bin/pi-launcher.sh`. |
| `SOSHO_ENGINE_PI_DEFAULT_TIMEOUT_SECONDS`, `SOSHO_ENGINE_PI_STDOUT_CAP_BYTES`, `SOSHO_ENGINE_PI_LINE_CAP_BYTES` | Default session time limit, total output cap, and cap for one output line. |
| `SOSHO_ENGINE_GPU_ROLES`, `SOSHO_ENGINE_PI_EXTENSIONS` | JSON lists. Roles with one session at a time, and the pi extensions to load. |
| `SOSHO_ENGINE_DIRECT_ROLES` | JSON list. Roles whose `llm` nodes call LiteLLM in the engine. The default is `["decision"]`. |
| `SOSHO_ENGINE_LITELLM_BASE_URL` | Base URL of LiteLLM. |
| `SOSHO_ENGINE_MAX_BODY_BYTES` | Maximum request body size. |
| `SOSHO_ENGINE_WEBHOOK_RATE_PER_MINUTE` | Webhook requests for each trigger in one minute. The default is 60. |
| `SOSHO_ENGINE_PORT` | Host port in `compose.yaml`. The default is 8123. |
| `LITELLM_MASTER_KEY` | Key for LiteLLM. |

## 8 Limits

- DBOS uses its default pickle serializer. The portable JSON serializer fails on pydantic-ai model responses. All workflow arguments and node outputs are JSON values.
- A direct `llm` node uses pydantic-ai for a model call through LiteLLM.
- The node `retry` field of an `agent` or a `skill` runs pi again as a DBOS step retry. A failed attempt counts as `max_turns` requests, because the worker cannot read its real usage.
- A pi session can run any tool of the host that pi offers. The `guard` extension blocks secret files. An orphan pi process can stay after a SIGKILL of a foreground worker. The systemd unit kills the control group at stop.
- A new application version leaves the pending runs of the old version unrecovered. The default version changes with each code change. Restart the worker and the engine together, with `make up`.
- Saved versions with the old `agent` fields `tools` and `max_requests` are not valid any more.
- The worker takes the pi version from the host `pi` binary. If none exists, it uses `npx`, which is slow at the first start.
- Fork counts only the start of a child run. A node in a loop has one execution for each pass.
- A run that was cancelled by a timeout has the status `cancelled`.
- A `map` node with more items than its budget share gives some child runs a budget of zero.
- A run that started before the run index existed does not appear when you filter by `workflow_id`.
- DBOS stops a timed out run at its next step. A long sleep delays the stop.
- Memory, watchers, a code sandbox, and self improvement are not part of the engine yet.

## 9 Tests

- Run `make test` from the repository root.
- Every run prints the duration of each test and a table of tests sorted by duration.
- Add `--cov` to a pytest command, or run `make cov`, to see coverage. The table then shows the lines that each test covers and the lines that only this test covers. Use it to find slow tests and tests that add no coverage.
- Coverage also measures the child processes of the tests. Their lines are in the file report but not in the per-test columns.
- Tests call only local models. No test uses a fake pi, a fake model, or a cloud role.
  - A pi session runs the real pi through `bin/pi-launcher.sh --raw` on the role `local-uncensored`. The GPU has one slot, so pi sessions run one at a time.
  - A direct `llm` call runs on the role `decision`. The tests set `SOSHO_ENGINE_DIRECT_ROLES` to `["decision"]`.
  - A test that needs a failure uses a real source. Examples are the role `no-such-role`, `timeout_seconds: 1` with a long answer, `max_turns: 1` with a tool task, and a low `SOSHO_ENGINE_PI_STDOUT_CAP_BYTES`.
- Tests assert structure and behavior, not exact model text. Exceptions are a JSON task with a checkable field and a short word that the prompt names.
- Engine tests use a SQLite database for the engine process and start a second process, the host worker, from `tests/worker_main.py`. The worker runs the real launcher.
- `tests/fault_proxy.py` is an HTTP proxy that fails the first requests and forwards the rest to the real LiteLLM. A test that needs a retry points the engine, or the worker through `SOSHO_ENGINE_REPO_ROOT` and a copy of `.pi/models.json`, at the proxy. The model stays real.
- A test that needs the live stack uses the fixture `live_api` or `live_host_api`. The fixture `live_stack` marks the test `integration`. The test skips when LiteLLM does not answer. Set `LIVE_STRICT=1` to fail instead.
- Tests that check the pi command line call `build_argv` and `build_env` in `tests/test_pi_command.py`. They start no pi.
- `tests/integration/test_engine.py` needs the running service. Set `SOSHO_ENGINE_URL` when the service is not on port 8123.
- `tests/integration/test_engine_worker.py` needs `make up` and the Postgres port. It runs the real pi on `local-uncensored`. It uses the unit `sosho-worker` when the unit is active.
- The engine tests are 258 of the 502 tests that pytest collects. Most of their time is pi sessions of about 15 seconds each. The test `test_nested_subworkflow_with_agent_nodes_does_not_deadlock` runs 2 sessions with 1 host slot (`SOSHO_TEST_HOST_SLOTS=1`). It needs 35 to 70 seconds. The test `test_limits_stop_the_node_and_count_calls_on_both_paths` needs about 80 seconds. Full run time of the engine tests: not verified.
