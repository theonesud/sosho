# Sosho Engine

The engine runs workflows as durable DBOS Transact workflows. A workflow is a versioned JSON graph. One generic interpreter runs each graph.

## 1 Facts

- Module: `sosho_engine`. Service port: 8123. Command: `python -m sosho_engine`.
- DBOS keeps the state of each run in its system database. A run continues after a crash or a restart.
- A step can run again after a crash. Each tool must be safe to run twice.
- The engine stores workflow definitions and versions in the same database.
- A saved version never changes. A run uses one version for its whole life.
- LiteLLM serves the model roles. Langfuse receives traces when you set its keys.
- DBOS data and engine tables use the Postgres server of Langfuse. The database is `sosho_engine`. The engine creates it at start.

## 2 Node Kinds

Call `GET /nodes` for the JSON schema of each kind. Each node has `id`, `kind`, `retry`, and `continue_on_error`.

| Kind | Purpose | Notes |
| :--- | :--- | :--- |
| `trigger` | Start a run. | Modes: `manual`, `cron`, `webhook`, `workflow_finished`. |
| `llm` | Send one prompt to a model role. | Set `json_output` to parse the answer. |
| `agent` | Run a pydantic-ai agent with registry tools. | Model requests are DBOS steps. A side-effect tool is a step. |
| `tool` | Call a registered Python tool. | Always a step. |
| `router` | Choose one branch. | Each branch has a condition on earlier outputs. |
| `map` | Run a child workflow for each list item. | Set `max_items`. |
| `join` | Wait for parallel branches. | Set `require_all` to fail when a branch has no output. |
| `human` | Wait for `approve`, `reject`, `input`, or `edit`. | A timeout applies `default_action`. |
| `subworkflow` | Run one child workflow version. | |
| `wait` | Sleep for a fixed time. | The sleep survives a restart. |

Rules for a graph:

- The graph needs an `entry` trigger. Each other node needs a path from a trigger.
- An edge with `when` leaves a `router` or a `human` node. The value is a branch name or an action.
- Only a `join` node can have two or more input edges.
- A cycle needs a `loop` edge with `max_iterations`. The cap is 50.
- Only `llm`, `agent`, and `tool` nodes accept `queue` and `timeout_seconds`.

A template reads earlier outputs with `{{nodes.<id>.<field>}}`. It reads the run input with `{{input.<field>}}`. It reads the loop count with `{{loop.iteration}}`.

## 3 Policy

Each version carries a policy. The engine checks it when you save the version and when the run executes.

| Field | Meaning |
| :--- | :--- |
| `allowed_kinds` | Node kinds that the graph can use. |
| `allowed_tools` | Tools that `tool` and `agent` nodes can call. |
| `max_steps` | Maximum node executions in one run. |
| `max_run_seconds` | DBOS workflow timeout for the run. Every start path applies it. |
| `max_llm_calls` | Budget of model requests. An `agent` node uses it as a request limit. |
| `max_depth` | Maximum depth of child runs and chained runs. |

## 4 Queues

| Queue | Limit |
| :--- | :--- |
| `local-gpu` | 1 |
| `cloud-io` | 8 |
| `host-browser` | 2 |

A node with `queue` runs as a child workflow on that queue. An `agent` node uses `cloud-io` when it has no queue.

A `map` node and a `subworkflow` node start their child runs without a queue. A run that only starts and awaits other runs never holds a slot of a queue. This rule prevents a deadlock between parent runs and their queued nodes.

## 5 Run Lifecycle

1. `POST /workflows/{id}/runs` pins one version and starts the `run_workflow` workflow. The run id is the DBOS workflow id.
2. The run loads the version in the `load_spec` step. It marks the entry trigger as done.
3. The interpreter finds the nodes that are ready. It runs them as one wave. Nodes in a wave run in parallel.
4. A node on a branch that was not taken is skipped. A skipped node skips its children.
5. The run writes events to the `log` stream and the `progress` event after each wave.
6. A `human` node runs as a child workflow. It waits for `POST /runs/{id}/input`.
7. The run ends with `SUCCESS` or `ERROR`. It then starts the runs of `workflow_finished` triggers.

Rules for a wave:

- The engine reserves model requests for each node before the wave starts. A wave cannot pass `max_llm_calls`.
- An `llm` node reserves one request for each allowed attempt. An `agent` node reserves `max_requests`.
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

## 6 API

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
| `POST /workflows/{id}/runs` | Start a run. |
| `GET /runs` | List runs. Filters: `status`, `workflow_id`, `limit`, `offset`. The engine keeps an index of runs for the `workflow_id` filter. |
| `GET /runs/{id}` | Read a run, its progress, pending human requests, and steps. |
| `GET /runs/{id}/events` | Stream run events as server-sent events. |
| `POST /runs/{id}/input` | Answer a `human` node. A second answer to the same request returns 409. |
| `POST /runs/{id}/cancel` | Cancel a run. |
| `POST /runs/{id}/resume` | Resume a cancelled run. |
| `POST /runs/{id}/fork` | Fork a run from a node. |
| `POST, DELETE /workflows/{id}/activate` | Bind or remove the triggers of a version. |
| `GET /schedules` | List cron schedules. |
| `POST /schedules/{name}/{pause, resume, trigger}` | Manage a schedule. |
| `DELETE /schedules/{name}` | Delete a schedule. |
| `POST /webhooks/{workflow_id}/{node_id}` | Start a run from a webhook trigger. |

Activation reads the trigger nodes of one version:

- A `cron` trigger creates a DBOS schedule. The name is `wf.<workflow_id>.<node_id>`.
- A `webhook` trigger gets a new token. The response shows the token one time. The engine stores only its hash.
- A `workflow_finished` trigger starts a run when the source workflow ends.
- Activation checks the cron strings and the time zones first. A bad value changes nothing.
- Activation replaces a schedule that has the same name. It removes the schedules of dropped trigger nodes after it saves the new bindings.

A webhook request for an unknown trigger and a request with a wrong token both return 404. A body that is not valid JSON returns 400. Each trigger accepts `SOSHO_ENGINE_WEBHOOK_RATE_PER_MINUTE` requests in one minute. More requests return 429.

The API limits the body size. CORS allows only loopback origins.

## 7 Settings

| Variable | Meaning |
| :--- | :--- |
| `SOSHO_ENGINE_API_TOKEN` | Bearer token for all routes except health and webhook. Required. `make setup` creates it. |
| `SOSHO_ENGINE_DB_URL` | System database URL. SQLite and Postgres work. |
| `SOSHO_ENGINE_APP_VERSION` | DBOS application version. A run recovers only on the same version. |
| `SOSHO_ENGINE_LITELLM_BASE_URL` | Base URL of LiteLLM. |
| `SOSHO_ENGINE_MAX_BODY_BYTES` | Maximum request body size. |
| `SOSHO_ENGINE_WEBHOOK_RATE_PER_MINUTE` | Webhook requests for each trigger in one minute. The default is 60. |
| `SOSHO_ENGINE_PORT` | Host port in `compose.yaml`. The default is 8123. |
| `LITELLM_MASTER_KEY` | Key for LiteLLM. |
| `LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Langfuse tracing. |

## 8 Limits

- DBOS uses its default pickle serializer. The portable JSON serializer fails on pydantic-ai model responses. All workflow arguments and node outputs are JSON values.
- The agent retry policy is the DBOS default for model requests. The node `retry` field does not apply to an agent.
- Fork counts only the start of a child run. A node in a loop has one execution for each pass.
- A `map` node with more items than its budget share gives some child runs a budget of zero.
- A run that started before the run index existed does not appear when you filter by `workflow_id`.
- DBOS stops a timed out run at its next step. A long sleep delays the stop.
- Memory, watchers, a code sandbox, and self improvement are not part of the engine yet.

## 9 Tests

- Run `make test` from the repository root.
- Unit tests in `tests/` use a SQLite database and fake models. They need no network.
- `tests/integration/test_engine.py` needs the running service. Set `SOSHO_ENGINE_URL` when the service is not on port 8123.
