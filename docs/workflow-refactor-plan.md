# Workflow Engine and Web Refactor Plan

Purpose: Detailed specification for another agent to condense `packages/engine` and `packages/web`, delete the showcase demo, and repair the 14 defects from first principles.

Read when: You execute the workflow engine and web refactor.

## 1 Invariants

Follow these invariants across every step:

- Keep every file at 1000 lines or fewer and every function at 60 lines or fewer. `bin/check-file-length.py` checks this rule.
- Write zero comments unless `.config/comments-allow.toml` lists the comment. `bin/check-comments.py` checks this rule.
- Pin every dependency to one exact stable version. See `docs/standards/code.md` section 11.
- Do not use `any`, `!`, `@ts-ignore`, `@ts-expect-error`, `# type: ignore`, or `as` casts on external data. See `docs/standards/typescript.md` section 3 and `docs/standards/python.md` section 2.3.
- Run `make fix`, `make test-fast`, and `make web-build` after each phase. Every check must exit with code 0.

## 2 Phase 1: Package Structure and Condensation

### 2.1 Condense `packages/engine/src/sosho_engine/` from 49 files to 19 files

Group the flat modules into five domain subpackages plus top-level entry points. Keep `sosho_engine/__init__.py` and `sosho_engine/__main__.py` at the package root.

1. Root modules in `packages/engine/src/sosho_engine/`:
   - `__init__.py`
   - `__main__.py`
   - `settings.py`
   - `runtime.py`
   - `lifecycle.py`
   - `version.py`
   - `errors.py`
2. Specification and validation in `packages/engine/src/sosho_engine/spec/`:
   - `__init__.py`: Re-export key models and validators.
   - `models.py`: Merge `spec.py`, `spec_nodes.py`, `issues.py`, and `placement.py`.
   - `templating.py`: Merge `templating.py`, `conditions.py`, and `graph.py`.
   - `validation.py`: Merge `validation.py` and `validation_extra.py`.
   - `catalog.py`: Merge `catalog.py`, `tools.py`, `skills.py`, and `memory_bridge.py`.
3. Persistence in `packages/engine/src/sosho_engine/store/`:
   - `__init__.py`: Re-export `Store` and table models.
   - `tables.py`: Move `store_tables.py`.
   - `repository.py`: Move `store.py`.
4. Durable workflow execution in `packages/engine/src/sosho_engine/execution/`:
   - `__init__.py`
   - `scheduler.py`: Merge `scheduler.py`, `budget.py`, `queues.py`, `launch.py`, and `jobs.py`.
   - `runflow.py`: Merge `runflow.py`, `wave.py`, `fanout.py`, `chain.py`, and `events.py`. Keep the `@DBOS.workflow()` function `__qualname__` values `run_workflow`, `scheduled_run`, and `node_workflow` unchanged so DBOS workflow registration and `RUN_WORKFLOW_NAME` in `runs.py` stay identical.
   - `nodes.py`: Merge `nodeflow.py`, `children.py`, `steps.py`, `executors.py`, `human.py`, and `models.py`.
   - `runs.py`: Merge `runs.py`, `run_models.py`, `run_status.py`, `run_delete.py`, and `step_lookup.py`.
5. Host worker and pi sessions in `packages/engine/src/sosho_engine/host/`:
   - `__init__.py`
   - `worker.py`: Merge `worker.py`, `health.py`, and `workdir.py`.
   - `pi.py`: Merge `host_node.py`, `pi_process.py`, and `pi_events.py`.
6. HTTP API and triggers in `packages/engine/src/sosho_engine/api/`:
   - `__init__.py`
   - `app.py`: Merge `api_app.py`, `api_support.py`, `body_limit.py`, and `web_ui.py`.
   - `triggers.py`: Merge `triggers.py`, `reconcile.py`, and `ratelimit.py`.
   - `routes.py`: Merge `routes_workflows.py`, `routes_runs.py`, and `routes_triggers.py`.
7. Update imports across `packages/engine/tests/` and `tests/integration/` to match the new subpackages.

### 2.2 Remove Showcase and Condense `packages/web/src/` from 121 files to 25 files

1. Delete the `/design-ref` showcase demo:
   - Delete all 17 files in `packages/web/src/showcase/`.
   - Delete showcase-only files in `packages/web/src/components/`: `app-shell.tsx`, `command-palette.tsx`, `graph-canvas.tsx`, `graph-edge.tsx`, `graph-layout.ts`, `graph-node.tsx`, `graph-path.ts`, `inbox-request-card.tsx`, `node-kind-badge.tsx`, `run-timeline.tsx`, `runs-table.tsx`, `stat-tile.tsx`, `trigger-row.tsx`, `use-count-tween.ts`, `use-pan-zoom.ts`, `workflow-card.tsx`, and `motion.ts`.
   - Delete `packages/web/src/types.ts` and `packages/web/src/styles/graph.css`.
   - Remove `import "./styles/graph.css";` from `packages/web/src/main.tsx:8`.
   - Remove the `design-ref` route from `packages/web/src/route.ts`, `packages/web/src/route.test.ts`, `packages/web/src/app.tsx`, `packages/engine/src/sosho_engine/web_ui.py:10`, and `packages/engine/tests/test_web_ui.py:19`.
   - Remove showcase-only CSS selectors `.shell*`, `.palette*`, `.stat-*`, `.workflow-card*`, `.data-table*`, `.inbox-*`, `.trigger-row*`, `.run-timeline*`, `.resolve*`, and `.graph-*` from `packages/web/src/styles/layout.css`, `surfaces.css`, `overlays.css`, and `motion.css`.
2. Merge the remaining `packages/web/src/` files into 7 domain folders plus root entry files `main.tsx`, `app.tsx`, `route.ts`, `meta.ts`, and `css-vars.ts`:
   - `src/api/`:
     - `schema.ts`: Zod schemas and `z.infer` types. This file replaces `types.ts` and `guards.ts`.
     - `client.ts`: HTTP requests, `ApiError`, server-sent events from `sse.ts`, and `useFetch` from `use-fetch.ts`.
     - `api.test.ts`: Merge `guards.test.ts` and `use-fetch.test.ts`.
   - `src/state/`:
     - `editor.ts`: Merge `reducer.ts`, `selection.ts`, `use-editor.ts`, and `persist.ts`.
     - `graph.ts`: Merge `graph.ts`, `workflow-ops.ts`, and `clipboard-buffer.ts`.
     - `state.test.ts`: Merge `reducer.test.ts`, `workflow-ops.test.ts`, `clipboard.test.ts`, and `clipboard-buffer.test.ts`.
   - `src/canvas/`:
     - `canvas.tsx`: Merge `canvas.tsx`, `node-layer.tsx`, `node-card.tsx`, `output-handle.tsx`, `link-rules.ts`, `edit-api.ts`, `run-api.ts`, and `select-api.ts`.
     - `edges.tsx`: Merge `edge-group.tsx`, `edge-layer.tsx`, `edge-labels.tsx`, `edge-panel.tsx`, and `edge-path.ts`.
     - `layout.ts`: Merge `layout.ts`, `sizes.ts`, `use-node-sizes.ts`, and `use-canvas-layout.ts`.
     - `camera.ts`: Merge `camera.ts`, `use-camera.ts`, `use-camera-follow.ts`, `use-canvas-controls.ts`, and `zoom-controls.tsx`.
     - `interaction.tsx`: Merge `use-canvas-input.ts`, `use-box-select.ts`, `box-select.ts`, `use-connect-drag.ts`, `shortcuts.ts`, `key-label.ts`, `help-box.tsx`, and `help-rows.ts`.
     - `canvas.test.ts`: Merge `box-select.test.ts`, `camera.test.ts`, `edge-path.test.ts`, `help-rows.test.ts`, `key-label.test.ts`, `layout.test.ts`, `link-rules.test.ts`, and `shortcuts.test.ts`.
   - `src/form/`:
     - `controls.tsx`: Merge `value-controls.tsx`, `select-controls.tsx`, and `issue-list.tsx`.
     - `schema-form.tsx`: Merge `node-form.tsx`, `schema-form.tsx`, `schema-model.ts`, `schema-resolve.ts`, `field-types.ts`, `field-value.ts`, and `choices.ts`.
     - `trigger.tsx`: Merge `kind-forms.tsx`, `trigger-form.tsx`, `trigger-fields.tsx`, `webhook-field.tsx`, `trigger-spec.ts`, `trigger-info.ts`, `cron-text.ts`, and `zone-match.ts`.
     - `form.test.ts`: Merge `schema-model.test.ts`, `trigger-spec.test.ts`, `trigger-info.test.ts`, `cron-text.test.ts`, and `zone-match.test.ts`.
   - `src/run/`:
     - `run-state.ts`: Merge `run-state.ts` and `run-input.ts`.
     - `use-run.ts`: Merge `use-run.ts`, `use-waiting.ts`, `waiting.ts`, and `chime.ts`.
     - `run-views.tsx`: Merge `run-node-body.tsx`, `node-status.tsx`, `human-panel.tsx`, and `trigger-input.tsx`.
     - `run.test.ts`: Merge `run-state.test.ts`, `run-input.test.ts`, and `waiting.test.ts`.
   - `src/workspace/`:
     - `workspace.tsx`: Merge `canvas/workspace.tsx`, `use-actions.ts`, `use-editing.ts`, `use-validation.ts`, `use-run-mode.ts`, `use-trigger-info.ts`, and `use-note.ts`.
     - `panel.tsx`: Merge `workflow-panel.tsx`, `panel-tabs.tsx`, `panel-rail.tsx`, `workflow-tree.tsx`, `workflow-group.tsx`, `runs-tab.tsx`, `use-run-list.ts`, `panel-model.ts`, `panel-state.ts`, `row-menu.tsx`, `rename-input.tsx`, `delete-dialog.tsx`, and `delete-flow.ts`.
     - `hud.tsx`: Merge `hud.tsx`, `hud-name.tsx`, `hud-tools.tsx`, `hud-visibility.ts`, `run-controls.tsx`, and `run-button-model.ts`.
     - `workspace.test.ts`: Merge `hud-visibility.test.ts`, `panel-model.test.ts`, `panel-state.test.ts`, and `run-button-model.test.ts`.
   - `src/ui/`:
     - `primitives.tsx`: Merge `icon.tsx`, `icon-paths.ts`, `icon-tip.tsx`, `callout.tsx`, `empty-state.tsx`, `copy-button.tsx`, `json-viewer.tsx`, `reveal.tsx`, and `run-status-badge.tsx`. Remove `toast` imports from `copy-button.tsx`, `trigger-fields.tsx`, and `webhook-field.tsx`. Use the `icon-swap` check mark or the `notify` quiet note instead.

## 3 Phase 2: First-Principles Defect Repairs

Do not apply surface patches or workarounds. Fix the root architectural cause of each defect below.

### 3.1 Single-Source-of-Truth Editor State

- Root Cause: `packages/web/src/form/use-draft.ts` keeps a separate local `draft` state with a 350 ms timer and a `pending.current` ref. When the user types in a node form and clicks `Save`, `Run`, `Undo`, `Redo`, or another node before blur, `useDraft` drops the edit or overwrites the undone state.
- First-Principles Fix:
  1. Delete `use-draft.ts`. A node form must not own a second delayed copy of the workflow node.
  2. Dispatch `updateNode` directly to the editor reducer on every field change so `state.workflow` is always the single source of truth for `Save`, `Run`, `Undo`, `Redo`, and `useValidation`. `useValidation` already debounces `POST /validate` by 400 ms in `use-validation.ts:5`.
  3. Add history coalescing directly in `packages/web/src/state/reducer.ts` so keystrokes do not create separate undo snapshots:
     - Track `lastEdit: { readonly nodeId: string; readonly at: number } | null` on `EditorState`.
     - When `updateNode` runs for the same `nodeId` within 500 ms of `lastEdit.at`, update `state.workflow` in place without pushing an intermediate entry onto `state.past`.
     - Clear `lastEdit` on any other action such as `select`, `undo`, `redo`, `addNode`, `deleteSelection`, `patchEdge`, or `markSaved`.

### 3.2 Direct SQL Queries and Concurrent Run Status Lookups

- Root Cause:
  1. `Store.get_workflow` in `packages/engine/src/sosho_engine/store.py:76` calls `self.list_workflows()` and scans every workflow in Python.
  2. `Store.finished_triggers` in `store.py:219` calls `self.list_triggers()` and filters in Python.
  3. `runs.list_runs` in `packages/engine/src/sosho_engine/runs.py:94-128` fetches every active run in history and runs sequential `DBOS.get_event_async` queries per run. The web UI polls `GET /runs?status=waiting&limit=200` every 5 seconds.
- First-Principles Fix:
  1. Rewrite `Store.get_workflow` in `store.py:76` to execute a single SQL `SELECT` with `.where(WORKFLOWS.c.id == workflow_id)`.
  2. Rewrite `Store.finished_triggers` in `store.py:219` to execute a SQL `SELECT` with `.where(TRIGGERS.c.mode == "workflow_finished", TRIGGERS.c.ref == source_workflow_id)`.
  3. Delete unused `Store.replace_triggers` in `store.py:148` and use `store.save_binding` in `test_live.py:155` and `test_trigger_lifecycle.py:54`.
  4. In `runs.py:123` and `runs.py:158`, run `_is_waiting` and child `PENDING_EVENT` lookups concurrently with `asyncio.gather`.

### 3.3 Webhook Verification Before Rate Limiting

- Root Cause: `verify_webhook` in `packages/engine/src/sosho_engine/triggers.py:210-221` calls `webhook_limiter.allow` before checking whether the webhook exists in `Store`. `RateLimiter.allow` in `ratelimit.py:15` calls `self._hits.setdefault(key, deque())` and never deletes expired keys. Requests to unknown `/webhooks/{a}/{b}` paths leak memory.
- First-Principles Fix:
  1. In `verify_webhook` at `triggers.py:210`, query `Store` for the webhook row and stored token first, and run `hmac.compare_digest` in constant time before calling `webhook_limiter.allow`. If the webhook does not exist or the token does not match, raise `NotFoundError("webhook not found")`.
  2. Call `webhook_limiter.allow(f"{workflow_id}/{node_id}")` only after the webhook and token pass verification.
  3. In `RateLimiter.allow` at `ratelimit.py:15`, delete any key from `self._hits` whose deque is empty after evicting old timestamps.

### 3.4 Non-Blocking Async File Input and Output

- Root Cause: Async functions in `web_ui.py`, `host_node.py`, and `pi_process.py` call blocking filesystem methods on the event loop. This breaks `docs/standards/python.md` section 4.1.
- First-Principles Fix:
  1. In `web_ui.py:20`, call `await asyncio.to_thread(index.is_file)`.
  2. In `host_node.py:158`, call `await asyncio.to_thread(prepare_workdir, path, settings.skills_path(), skills)`.
  3. In `pi_process.py:73-84` and `pi_process.py:118-142`, run file writes and `_tail(stderr_path)` through `asyncio.to_thread`.

### 3.5 Strict Zod Schemas at the API Boundary

- Root Cause: `packages/web/src/api/types.ts` and `packages/web/src/api/guards.ts` duplicate types by hand and violate `docs/standards/typescript.md` section 5.1. `guards.ts:75` accepts any object in `router.branches`, and `guards.ts:105` accepts any object in `policy`.
- First-Principles Fix:
  1. Add `zod` pinned to an exact stable version in `packages/web/package.json`.
  2. Replace `types.ts` and `guards.ts` with `packages/web/src/api/schema.ts`. Define strict Zod schemas for all 11 node kinds, `Branch`, `Condition`, `RetryPolicy`, `Edge`, `Policy`, `WorkflowDraft`, `Workflow`, `Catalog`, `RunDetail`, `RunEvent`, `TriggerInfo`, and `ValidateResponse`.
  3. Infer all TypeScript types with `z.infer`.
  4. In `client.ts`, validate every response with `schema.safeParse(payload)`.

### 3.6 Schema-Driven Node Seeding for `router` and Arrays

- Root Cause: `seedArray` in `packages/web/src/form/field-value.ts:5-8` evaluates `seedValue` once before `Array.from`, sharing one object reference across array items. For `router.branches`, `seedValue` seeds `{ name: "", when: { path: "", op: "truthy", value: null } }`, which fails `IDENTIFIER` pattern validation and condition path validation.
- First-Principles Fix:
  1. In `seedArray` at `field-value.ts:5-8`, call `seedValue` inside the `Array.from` callback so each element is a fresh object.
  2. In `seedValue` at `field-value.ts:10`, when a required string field has `field.pattern`, seed a valid identifier such as `"branch_1"` instead of `""`. When `field.key === "path"`, seed `"input.value"` instead of `""`.

### 3.7 Version-Aware Subworkflow and Map Reference Validation

- Root Cause:
  1. `POST /validate` in `packages/engine/src/sosho_engine/routes_workflows.py:90` hardcodes version `1`, while `add_version` in `routes_workflows.py:103` uses `(summary.latest_version or 0) + 1`.
  2. `_runs_itself` in `packages/engine/src/sosho_engine/validation.py:219-222` checks `node.workflow_id == spec.id and node.version == spec.version`, which misses cross-version self-recursion.
  3. `check_references` in `packages/engine/src/sosho_engine/api_support.py:91-101` does not check whether the referenced child workflow violates the parent workflow's `policy`.
- First-Principles Fix:
  1. In `validate_draft` at `api_support.py:104`, look up the workflow summary when `workflow_id` exists in `Store` and validate against `(summary.latest_version or 0) + 1`.
  2. In `_runs_itself` at `validation.py:219-222`, forbid any direct self-reference `node.workflow_id == spec.id`.
  3. In `check_references` at `api_support.py:91-101`, run `check_policy` on the referenced child workflow with the effective inherited policy and report `child_policy_denied` issues at validation and save time.

### 3.8 Identity-Matched Trigger Status in `NextRun` and `FollowerLine`

- Root Cause: `NextRun` and `FollowerLine` in `packages/web/src/form/webhook-field.tsx:157-189` read `triggers.info.schedules[0]` and `triggers.info.followers[0]` without matching the node id or checking whether the draft has unsaved changes.
- First-Principles Fix:
  1. Add `node_id: str` to `ScheduleState` and `FollowerState` in `packages/engine/src/sosho_engine/triggers.py:27-43` and populate `node_id=node.id` in `trigger_state` at `triggers.py:178-197`.
  2. Add `node_id: z.string()` to `TriggerScheduleSchema` and `TriggerFollowerSchema` in `packages/web/src/api/schema.ts`.
  3. In `NextRun` and `FollowerLine`, match by `entry.node_id === node.id` and compare the saved cron or follower fields with the current draft. When the draft differs from the saved trigger, display `"Save to schedule this trigger."`.

### 3.9 Read-Only Mode Propagation in `TriggerRunInput` and `EdgePanel`

- Root Cause: `TriggerRunInput` in `packages/web/src/run/trigger-input.tsx:25` and `EdgePanel` in `packages/web/src/canvas/edge-panel.tsx:28,42,53` hardcode `disabled={false}`. Toggling `Loop` on in `EdgePanel` omits `max_iterations`, which leaves the edge invalid.
- First-Principles Fix:
  1. Add `readonly disabled: boolean` to `TriggerRunInputProps`, pass `disabled={disabled}` from `TriggerForm`, and forward `disabled` to `TextControl`.
  2. Add `readonly disabled: boolean` to `EdgePanelProps` and pass `disabled={!editable}`.
  3. When toggling `Loop` on in `EdgePanel`, dispatch `{ loop: true, max_iterations: edge.max_iterations ?? 3, on_limit: edge.on_limit ?? "exit" }`.
  4. Use `Segmented` instead of `SingleSelect` for `on_limit` in `EdgePanel`.

### 3.10 Windowed Runs List Refresh Without Pagination Reset

- Root Cause: `useRunList` in `packages/web/src/workspace/use-run-list.ts:10-58` wipes `more` back to `[]` whenever page 1 refetches, and computes `hasMore` from `firstData.length >= RUN_PAGE` instead of the last page size.
- First-Principles Fix:
  1. Track the loaded window size `limit` in `useRunList`, starting at `RUN_PAGE` with value 50, and increment it on `loadMore`.
  2. When `refetch()` runs, refresh the loaded window in place instead of resetting to page 1.
  3. Compute `hasMore` from whether the latest fetched page returned `RUN_PAGE` items.

### 3.11 Complete Vite Dev Proxy and Vitest Coverage Setup

- Root Cause:
  1. `API_PATHS` in `packages/web/vite.config.ts:5` omits `webhooks`.
  2. `packages/engine/tests/test_finished_chains.py:94` calls the deleted `/live` route.
  3. Root `package.json` and `vitest.config.ts` lack `@vitest/coverage-v8`, required by `docs/standards/testing.md:80`.
- First-Principles Fix:
  1. Add `webhooks` to `API_PATHS` in `packages/web/vite.config.ts:5`.
  2. Delete line 94 from `packages/engine/tests/test_finished_chains.py`.
  3. Add `@vitest/coverage-v8` pinned to `"5.1.1"` in root `package.json`, configure `coverage` in `vitest.config.ts`, and update `docs/standards/testing.md:80`.

## 4 Execution Order

1. Step 1: Condense `packages/engine/src/sosho_engine/` and apply sections 3.2, 3.3, 3.4, 3.7, 3.8, and 3.11.2. Run `make fix && uv run ruff check . && uv run pyright && uv run pytest packages/engine/tests -m "not integration" -q`.
2. Step 2: Remove the `/design-ref` showcase and condense `packages/web/src/`. Run `make fix && pnpm exec tsc -p packages/web/tsconfig.json --noEmit && pnpm exec vitest run`.
3. Step 3: Apply sections 3.1, 3.5, 3.6, 3.8, 3.9, 3.10, and 3.11 to `packages/web`. Add unit tests for every repaired defect.
4. Step 4: Run `make fix && make test-fast && make web-build` and verify exit code 0.
