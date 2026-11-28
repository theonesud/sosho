# Web Application Guide

Purpose: Product specification, layout rules, and current state of `packages/web`.

Read when: You edit code in `packages/web`. Also read `packages/web/DESIGN.md` and `packages/web/node_modules/@ui-sdk/react/docs/llms.txt`.

## 1 State and Commands

- Date of this state: 2026-11-28. Branch: `refactor`.
- Commit `ca6a7aa` holds the initial web application and the engine user interface support. The abbreviation UI means user interface in this guide.
- The fast checks pass. `make test-fast` exits 0 with 107 Vitest tests and 493 Python tests.
- The trigger node is the only node kind that has full per-kind form treatment and owner verification. All other node kinds wait for per-kind forms.
- Read [docs/workflow-refactor-plan.md](workflow-refactor-plan.md) for the structural condensation and defect repair plan.

Use these commands to run or build the web application:

- `./run.sh start`: Check the engine, read the token, and start Vite on `http://127.0.0.1:5173/`. The Vite proxy adds the bearer token. Do not stop the dev server on port 5173 while the owner watches it.
- `./run.sh stop`, `./run.sh status`, `./run.sh logs`, `./run.sh build`: Control the dev server.
- `make web-build`: Build `packages/web/dist`. The engine serves it on `http://127.0.0.1:8123/` with an HttpOnly session cookie named `sosho_session`.
- `docker compose -p sosho up -d --build engine`: Rebuild only the engine container. Do not use `make up` for an engine-only rebuild. `make up` starts every service and the graphics processing unit service.

## 2 Owner Rules for UI Work

- Use the fewest moving parts that do the most work.
- `ui-sdk` is the only UI component library. `@dagrejs/dagre` is the only layout library. Use Zod for boundary validation.
- Do not use icon packages or font packages. Draw icons as inline scalable vector graphics in `src/components/icon-paths.ts`.
- Follow the "Graphite" design system in `packages/web/DESIGN.md`. Use glass only on floating layers.
- Give each interaction and state change a short transition from the motion tokens. Respect reduced motion. Text and item sizes must not jump on a state change.
- Show a control only when the user can use it. Otherwise hide it and set `inert`.
- Use icon buttons with tooltips for actions.
- Do not show internal identifiers to the owner. Show names.
- Use only test workflows named `ui-test-*` during browser checks. Cancel active runs and delete `ui-test-*` workflows after the check. Never touch the owner's workflows.
- Do not run workflows with `llm`, `agent`, or `skill` nodes in UI checks. Use `trigger`, `tool` with `echo` or `text_join`, `human`, `router`, and `wait`.

## 3 Layout and Behavior Specification

The app has two parts: one left panel and one canvas. Everything else is part of the canvas.

### 3.1 Left Panel

- The panel is 15 rem wide, from token `--panel-width`. It collapses to a 3 rem rail, from token `--panel-rail-width`. It is open on first load. Local storage keeps the choice under `sosho.panel.collapsed.v2`.
- The rail shows an expand button and a waiting-color count badge when runs wait.
- It has two full-width tabs at equal widths: Workflows and Runs.
- Workflows tab:
  - The header holds the one New button.
  - One group shows each workflow. The group header shows the workflow name. A click opens the latest version.
  - Under the header, one indented row shows each saved version, newest first. A click opens that version.
  - Groups stay open. There is no collapse toggle.
  - The open row has a 1 px accent outline on all sides.
  - The group header has a three-dot menu on hover or focus with Rename, Duplicate, and Delete.
  - Rename opens an input with a tick button in the header. Enter saves. Esc cancels.
  - Delete asks for confirmation in an alert dialog. It deletes the workflow, its versions, and its runs. If the engine returns 409, the dialog shows: "This workflow has an active run. Cancel the run, then delete the workflow."
  - A version row has a menu with "Duplicate from this version".
- Runs tab:
  - The tab label shows a count badge of waiting runs. The app polls `GET /runs?status=waiting&limit=200` every 5 seconds.
  - A quiet sound plays for a new waiting run. A mute toggle sits in the panel footer.
  - Waiting runs come first, newest first. Other runs follow, newest first.
  - A click opens the workflow at the run version in run mode.

### 3.2 Heads-Up Display

The heads-up display is a floating bar at the top center of the canvas:

- Workflow name: plain text. A pencil icon appears on hover. A click opens an input with a tick button.
- Group 1: Undo and Redo.
- Group 2: Copy, Paste, Duplicate, and Delete selection.
- Group 3: Select all and the Select tool toggle.
- Save button: reads `Save as vN`, where `N` is the latest version plus 1. Every opened version is editable. Save on an old version works as a restore. Unsaved edits stay in browser storage per workflow and base version.
- Run button: runs the latest saved version in edit mode, becomes Cancel while a run is active, and becomes Edit after a run ends. Resume and Fork appear as icon buttons when available.
- Each edit icon shows only when it can act. Separators show only between visible groups. In run mode, edit icons hide.

### 3.3 Canvas and Nodes

- `dagre` lays out every graph from left to right. Node positions are not stored.
- Nodes have two states:
  - Collapsed: shows icon, name, and status.
  - Expanded: shows a 24 rem card with the node form in edit mode, or status, output, error, and human reply controls in run mode.
- A click on a single node expands it. The graph slides aside. The camera centers the node at zoom 1. For a tall card, the camera places the top 72 px below the canvas top.
- An expanded card grows to fit its content and never scrolls. A wheel over the card pans the canvas vertically.
- Selection supports Shift+click, Shift+drag box, `Ctrl+A`, and the Select tool toggle. Only a single selected node expands.
- Clipboard supports `Ctrl+C`, `Ctrl+V`, and `Ctrl+D`. Copy writes to the system clipboard and to `localStorage` under `sosho.clipboard`. Paste assigns fresh node ids, preserves internal edges, and never creates edges to the existing graph.
- A workflow has only one trigger node. Paste and duplicate skip a trigger node when the workflow already has one.
- A "Shortcuts" glass text button at the bottom left opens the keyboard shortcut popover.
- Errors:
  - A closed node with issues gets a thin red outline and a warning icon.
  - An open node marks only the field with the error. There is no list of errors at the top of the card.

## 4 Trigger Node Specification

- Tint token: `--kind-trigger`.
- The node id is internal and hidden.
- The name defaults by mode: `Manual`, `Schedule`, `Webhook`, or `After workflow`.
- Mode is a segmented control. Each mode shows only its own fields. Required fields end with ` *`.
- There is no Advanced section. `queue`, `retry`, `timeout_seconds`, and `continue_on_error` do not appear.
- Schedule mode uses `cron`:
  - The UI edits a 5-field cron string and prepends `0 ` for seconds when it writes the 6-field engine cron string.
  - A preview describes the schedule in words. "Next run" shows the next fire time from `GET /workflows/{id}/triggers`.
  - The time zone is a Select with keyboard typeahead. It defaults to the browser zone.
- Webhook mode uses `webhook`:
  - Shows the webhook URL with Copy and Copy curl buttons.
  - Shows a masked token with Show or Hide, Copy, and Regenerate with a confirmation dialog.
- After workflow mode uses `workflow_finished`:
  - Shows a source workflow Select and an `on_status` segmented control with `Succeeded`, `Failed`, and `Any`.
- Every mode has a "Test input" JSON field stored in browser storage per workflow.
- The `+` menu on a trigger node lists all node kinds except `trigger`.

## 5 Engine Support for the UI

- `web_ui.py` serves `packages/web/dist` and sets the `sosho_session` cookie for client hosts in `SOSHO_ENGINE_SESSION_CLIENT_HOSTS`. The cookie value is a hash-based message authentication code of `SOSHO_ENGINE_API_TOKEN`.
- `DELETE /runs/{id}` deletes a finished run. `DELETE /workflows/{id}` deletes a workflow and its runs, or returns 409 if a run is active.
- Triggers are always live. Each save validates and binds the non-manual triggers of the new version. Startup reconciliation in `reconcile.py` repairs bindings.
- `GET /workflows/{id}/triggers` returns schedules, webhooks with URL and plain-text token, and followers of the latest version.
- `POST /workflows/{id}/webhooks/{node_id}/token` rotates a webhook token.
