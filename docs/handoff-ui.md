# UI Handoff

Status on 2026-11-28. Read this file first when you start a new session on the webapp. Then read `docs/webapp-plan.md` and `packages/web/DESIGN.md`.

## 1 State

- Nothing from the webapp work is committed. All work is on branch `refactor`, in the working tree. Ask the owner before you commit. Use Conventional Commits. Split the work into these commits:
  - engine
  - web
  - tool setup
- The checks pass. `make test-fast` exits 0. There are 107 web vitest tests and 493 python tests that are not integration tests.
- The integration tests in `tests/integration/` were changed to delete what they create. Nobody has run them. They need the live stack and models. When the owner agrees, run `make test` once.
- Webapp phases 1 to 8 of `docs/webapp-plan.md` are done. Since then, the owner refined the user interface (UI) in many rounds. The trigger node is the first node kind with full per-kind treatment.

## 2 How to run

- Run `./run.sh start`. The script checks the engine. It gets the token from the environment or from the engine container. It starts Vite on http://127.0.0.1:5173/. The Vite server uses an application programming interface (API) proxy that adds the token.
- Use these other commands:
  - `./run.sh stop`
  - `./run.sh status`
  - `./run.sh logs`
  - `./run.sh build`
- Run `make web-build` to build `packages/web/dist`. The engine serves it on http://127.0.0.1:8123/. The engine uses a loopback HttpOnly cookie. No token goes to the browser.
- To rebuild only the engine container, run `docker compose -p sosho up -d --build engine`. Do not use `make up` for this rebuild. It starts all services and the graphics processing unit (GPU) service.
- The `/design-ref` page shows the design system showcase.

## 3 Owner preferences

Work style:

- The main session only coordinates.
- Send code work to a subagent with model `sonnet`.
- Send these tasks to a subagent with model `haiku`:
  - Read files.
  - Search for code or text.
  - Edit docs.
- Use `opus` only when the owner asks.
- Ask questions only when the owner must decide. Otherwise, choose a sensible default. State the default that you chose.
- The owner tests the UI live. The owner gives short feedback lists. For each item:
  - Implement the item.
  - Check it in a browser.
  - Report briefly. Include the exit codes.
- Do not stop the dev server on 5173. The owner watches it.
- Use only test workflows named `ui-test-*`. Delete them after the checks. Never touch the owner's workflows. Cancel the active runs before you delete a workflow.
- Do not run workflows with `llm`, `agent`, or `skill` nodes in checks. These nodes call models and the GPU. Use these nodes in checks:
  - `trigger`
  - `tool`, with `echo` or `text_join`
  - `human`
  - `router`
  - `wait`
- Ask before any destructive action on the owner's data.

Product and design:

- Use the fewest moving parts that do the most work. Do not add extra libraries.
- ui-sdk is the only UI library.
- `@dagrejs/dagre` is the only other runtime dependency.
- Do not use icon packages or font packages. Draw icons as inline scalable vector graphics (SVG) in `src/components/icon-paths.ts`.
- The style is:
  - dark
  - sleek
  - modern
  - minimal
- The design system is "Graphite". Use glass only on floating layers.
- Give every interaction and state change a short, smooth animation from the motion tokens. Respect reduced motion. Text and item sizes must not jump on a state change.
- Show a control only when you can use it. Otherwise, hide it with an animation.
- Use icon buttons with tooltips for actions. Do not use text buttons where an icon is clear.
- The app has one left panel and one canvas. Everything else is part of the canvas.
- Do not show internal identifiers (ids) to the owner. Show names.
- Prefer behavior that works by itself over switches and modes. For example, the owner removed the "Live" switch. Triggers are always live.

## 4 Layout and behavior decisions

- Left panel:
  - It is open by default. It can collapse to a rail. Its width is `--panel-width`.
  - It has two full-width tabs: Workflows and Runs.
  - Workflows tab:
    - There is one group for each workflow. Its versions appear under it, newest first.
    - The group header has a three-dot menu with these items:
      - Rename
      - Duplicate
      - Delete
    - Delete asks for confirmation. It also deletes the runs.
    - A version row has "Duplicate from this version".
  - Runs tab:
    - It shows all runs, newest first.
    - A dot marks a waiting run.
    - A quiet sound plays for a new waiting run. A mute toggle exists.
  - The selected row has a thin 1px outline on all sides.
  - There is only one "New" button. It is in the Workflows tab.
- HUD (heads-up display), a floating bar on the canvas:
  - The name is plain text. A pencil appears on hover. Then an input appears, with a tick.
  - The icons appear in these groups, in this order:
    - Undo and Redo.
    - Copy, Paste, Duplicate, and Delete.
    - Select all and the Select tool.
  - Each icon shows only when it can act. Paste shows only after a copy.
  - "Save as vN" creates the next version. Every opened version is editable. Save on an old version works as a restore.
  - The Run button runs the latest saved version. It does not show a prompt. It becomes Cancel while a run is active. It becomes Edit after the run ends.
  - The bar sizes itself. When space is short, it does these steps in order:
    - It tightens the gaps.
    - It truncates the name.
    - It hides labels.
  - Save and Run never hide.
- Canvas:
  - dagre lays out every graph, from left to right. Positions are not stored.
  - A click expands a node into its form. The graph slides aside. The camera centers the node at zoom 1.
  - For a tall node, the camera puts the node top 72 px under the canvas top.
  - The expanded node does not scroll. It grows to fit its content. A wheel over it pans the canvas.
  - Select several nodes in one of these ways:
    - Shift + click.
    - Shift + drag box.
    - Ctrl+A.
    - The Select tool.
  - Use these clipboard shortcuts:
    - Ctrl+C
    - Ctrl+V
    - Ctrl+D
  - Paste never creates edges to the existing graph. Copy also stores the nodes in localStorage under `sosho.clipboard`. So the Paste button needs no browser permission.
  - A workflow has only one trigger.
  - Shortcuts: a "Shortcuts" text button at the bottom left opens a popover. A click outside the popover closes it.
  - Errors:
    - A closed node with issues gets a thin red outline.
    - An open node marks only the field with the error.
    - There is no list of errors at the top of the card.
- Run mode is on the same canvas. A waiting human node expands by itself and shows its reply form.

## 5 Trigger node, done

- The node has a green tint. Its token is `--kind-trigger`.
- The id is internal.
- The name defaults by mode:
  - Manual
  - Schedule
  - Webhook
  - After workflow
- Mode is a segmented control. It is never empty. Each mode shows only its own fields.
- Required fields have " *".
- There is no Advanced section. These fields do not show:
  - `queue`
  - `retry`
  - `timeout_seconds`
  - `continue_on_error`
- Schedule:
  - Cron uses 5 fields in the UI. The app adds "0 " for seconds, because the engine needs 6 fields.
  - A preview shows the plan in words. "Next run" shows the next fire time.
  - The time zone is a Select with typeahead. It defaults to the browser zone and is stored.
- Webhook:
  - The real URL appears with Copy and Copy curl icons.
  - The token is masked. It has these controls:
    - An eye icon inside the field.
    - A Copy icon.
    - A Regenerate icon. It asks for confirmation.
- After workflow: a source workflow Select and an on_status segmented control.
- Every mode has a "Test input" JSON field. Run starts any trigger mode with that input.
- The "+" menu on a trigger shows all kinds except `trigger`.
- The per-kind mechanism is in these files. Reuse it for the next kinds:
  - `src/form/kind-forms.tsx`
  - `src/form/trigger-*.ts*`
  - `src/canvas/link-rules.ts`

## 6 Engine changes made for the UI

- The engine serves the UI from `web_ui.py`. Set `web_dist` and the environment variable `SOSHO_ENGINE_WEB_DIST`.
- The engine uses cookie authentication. The cookie is named `sosho_session`. Its value is a hash-based message authentication code (HMAC) of the token. The engine accepts it for client hosts in `SOSHO_ENGINE_SESSION_CLIENT_HOSTS`.
  - In compose, that list includes the Docker gateway `172.19.0.1` of `sosho-net`.
  - The gateway is not pinned. If Docker recreates the network with a new subnet, update the IP.
- Run deletion:
  - `DELETE /runs/{id}` deletes a run.
  - `DELETE /workflows/{id}` also deletes the workflow's runs. It returns 409 if a run is active.
  - This uses `DBOS.delete_workflows_async(..., delete_children=True)`.
- `POST /workflows/{id}/runs` starts a trigger of any mode.
- Triggers are always live:
  - Each save binds the non-manual triggers of the new version.
  - The engine refuses the save with 422 when one of these problems exists:
    - A bad cron.
    - A bad time zone.
    - A cycle. The cycle code is `trigger_cycle`.
  - A startup reconcile in `reconcile.py` repairs the bindings.
  - `GET /workflows/{id}/triggers` returns these items:
    - The schedules.
    - The webhooks, with URL and token.
    - The followers.
  - `POST /workflows/{id}/webhooks/{node_id}/token` regenerates a token.
  - Tokens are stable across saves. They are stored in plain text, by owner decision.
  - The option `public_url` builds the webhook URL. The environment variable for it is `SOSHO_ENGINE_PUBLIC_URL`.
- The `engine_live` table is dropped at startup. The column `engine_triggers.secret_hash` is unused, but it still exists.
- `docker/Dockerfile.engine` has COPY lines for `packages/memory-graph`.

## 7 Open items and next steps

- Next node kind: `llm`. Build these items with it:
  - Placeholder validation for unknown roots, such as `{{trigger.x}}`, and for unknown node ids.
  - A variable picker. It opens when you type `{{`.
- Apply the trigger rules to the other kinds:
  - No Advanced section.
  - Only the relevant fields.
  - Required marks.
  - Field-level errors.
  - A default name.
  - Valid "+" targets.
- The 422 console error from `/validate` is not resolved. It occurs while a required trigger field is empty. A proposed fix is to skip the server validation while a client required check fails. The owner has not decided.
- The time zone typeahead sends a synthetic pointermove to move the ui-sdk highlight. An update of ui-sdk can break it.
- Not verified:
  - The contrast of the option highlight `--surface-3`.
  - The contrast of `--kind-trigger`.
- Old browser storage keys are unused:
  - `sosho.panel.collapsed`
  - `sosho.help.open`
- The browser zone name `Asia/Calcutta` is an alias. The engine accepted it in the check.
- Loop arcs can overlap. The camera does not refit after an edge-only edit.

## 8 Learnings

- The guard hook blocks commands that name the `.env` file. It also blocks recursive `grep`. Use `rg`.
- The permission check blocks a destructive action by a subagent when the approval came only from the coordinator. Get the owner's approval in the main session.
- The Playwright MCP browser is sometimes locked. In that case, subagents drive headless Chrome (`/opt/google/chrome/chrome`) with `playwright-core`.
  - The scripts are in `/tmp/sosho-web/`.
  - Playwright MCP writes screenshots only inside the repo, under `.playwright-mcp/`. That path is in `.gitignore`.
  - Copy the screenshots to `/tmp/sosho-web/`.
- If Vite shows "does not provide an export" after edits, `touch` the changed files.
- pnpm 12 blocks new packages. By owner decision, `pnpm-workspace.yaml` excludes `@ui-sdk/*`. `docs/standards/code.md` notes the exception.
- `make test-fast` checks these items:
  - Comments. Only the comments listed in `.config/comments-allow.toml` are allowed.
  - Function length. At most 60 lines.
  - Biome format.
  When two agents edit at the same time, run `make test-fast` again after both finish.
- Before you use a component, read the ui-sdk docs:
  - The `ui-sdk` skill.
  - `packages/web/node_modules/@ui-sdk/react/docs/llms.txt`
- The engine `/runs` limit is at most 200. Page through the results with `offset`.
