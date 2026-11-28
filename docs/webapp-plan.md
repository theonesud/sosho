# Webapp Plan

Status: approved by the owner on 2026-11-28. docs/handoff-ui.md holds the current state and decisions.

## 1 Principle
- Use the least number of moving parts that can do the most work.
- The workflow graph is the one object. Each view is a view of the graph.
- The app has two parts: a left panel and a canvas. Everything else is part of the canvas.

## 2 Decisions
| Area | Decision |
| :--- | :--- |
| Framework | React 19, Vite, TypeScript strict. |
| UI library | ui-sdk only. Design system "Graphite": packages/web/DESIGN.md. Design reference page: /design-ref. |
| Layout | dagre lays out every graph. Do not drag nodes to place them. The spec stores no positions. |
| Save | Save creates a new numbered version. The button reads "Save as vN". N is the latest version plus 1. Unsaved edits stay in browser storage, one draft for each opened version. There is no engine draft. |
| Versions | Every opened version is editable. Save as vN on an old version works as a restore. There is no separate Restore button. The opened version is the base of the next save. |
| Test input | The input format is JavaScript Object Notation (JSON). The trigger node has a Test input JSON field in every mode. The input is kept in browser storage for each workflow. |
| Waiting runs | Poll GET /runs?status=waiting&limit=200 every 5 seconds. Run mode uses the existing GET /runs/{id}/events stream. |
| Alerts | Show a count badge on the Runs tab. Play one short sound for a new waiting request. |
| Web app delivery | The engine serves the built app on its own port. A loopback HttpOnly cookie replaces the token in the browser. In dev, the Vite proxy adds the token. Run `./run.sh` to start the dev environment. |
| Devices | Desktop only. |
| Tests | Use Vitest for web logic. Use Pytest for engine changes. |
| Editor | Support undo, redo, copy, and paste. Do not add workflow tabs. |
| Data | Use the live engine from the first day. |

## 3 Layout
Left panel. It has two tabs, Workflows and Runs. The two tabs share the full panel width at equal widths.
- The panel is 15 rem wide. A button collapses it to a 3 rem rail. The panel is open on first load. The browser keeps the choice in local storage under a versioned key. A stored value from the old default does not apply.
- The rail shows an expand button. It also shows a small count badge when runs wait.
- The collapse and expand use the motion tokens. They do not move when the user asks for reduced motion.
- The canvas fits the graph again when the panel width changes. It does not fit again while a node is expanded.
- Workflows tab:
  - The header holds the one New button.
  - One group shows each workflow. The group header shows the workflow name. A click on the header opens the latest version.
  - Under the header, one indented row shows each saved version, newest first. A click opens that version.
  - Groups stay open. There is no collapse toggle.
  - The open version row has a thin accent outline on all sides.
  - A three-dot button appears on hover or focus of the group header. Its menu holds Rename, Duplicate, and Delete.
  - Rename opens an input with a tick button in the header. Enter saves. Esc cancels.
  - Delete asks for confirmation in an alert dialog. The dialog names the workflow and says that its runs are deleted too. If the engine returns 409, the dialog shows one sentence: "This workflow has an active run. Cancel the run, then delete the workflow." It does not repeat the engine text.
  - After a delete of the open workflow, the app opens the next workflow. If none is left, it shows the empty state.
  - A version row has a menu with "Duplicate from this version". It copies that version into a new workflow.
- Runs tab:
  - The tab label shows a count badge of the waiting runs.
  - Each row is one run. It shows the workflow name, the version, the start time, and a status badge.
  - Waiting runs come first, newest first. The other runs follow, newest first.
  - A click opens the workflow at the run version in run mode.
  - Load more reads the next page with the limit and offset parameters.

Canvas:
- The heads-up display (HUD) is a floating bar with these controls:
  - Workflow name. It is plain text. A pencil icon shows on hover. A click turns the name into an input with a tick button. Enter or the tick saves it. Esc cancels.
  - Undo and Redo icon buttons with tooltips and shortcuts.
  - A group of icon buttons for Copy, Paste, Duplicate, and Delete selection.
  - Select all, and a Select tool toggle. While the Select tool is on, a plain drag draws a selection box. Hold Space to pan.
  - Thin separators divide the groups. Each button has a tooltip with its shortcut.
- An action icon shows only when the user can use it. Otherwise it is hidden and cannot get focus:
  - Undo shows when the history has a past. Redo shows when the history has a future.
  - Copy and Duplicate show when a node is selected. Delete shows when a node or an edge is selected.
  - Paste shows when the in-app clipboard holds nodes.
  - Select all shows when the graph has nodes and not all nodes are selected.
  - The Select tool toggle always shows in edit mode.
  - In run mode and on a read-only view, the HUD shows no edit icon.
  - A separator shows only between visible groups. A HUD with no visible group shows no separator.
  - An icon enters and leaves with opacity, a small scale, and a width collapse. The motion tokens set the timing. Reduced motion removes the animation.
  - Save as vN.
  - Run. It runs the latest saved version. It changes to Cancel and Edit with the run state.
- The HUD has no version select and no runs select.
- Selecting a run puts the canvas in run mode. Select Edit to leave run mode. The Run button turns into Edit when a run ended.
Nodes are HyperText Markup Language (HTML) elements on a layer that pans and zooms. Edges are Scalable Vector Graphics (SVG) under the nodes.

## 4 Nodes are the inspector
- A node has two sizes:
  - Collapsed. Show the icon, name, and status.
  - Expanded. Show a card with a form.
- A click expands a node. dagre lays out the graph again with the real card size. The other nodes slide aside with animation.
- An expanded node shows a delete button with a trash icon in its header, in edit mode only. It deletes the node through the editor history, so Undo restores it.
- A node added with the plus button on its edge is selected and expanded. The camera follows it.
- The camera zooms to 100% and centers the expanded node. Esc or a click on empty canvas collapses it.
- One schema form builder builds the forms from the JSON schemas of GET /nodes. Main fields show first.
- Put the generic fields in a closed "Advanced" section. The generic fields are these:
  - retry
  - timeout_seconds
  - queue
  - continue_on_error

The trigger node has no Advanced section. Later kinds follow the trigger rules.
- Validation issues from POST /validate show as a mark on the node and as messages in the expanded card. The engine reports the node id only, not the field.
- A click on an edge label opens an input for the edge `when` condition.
- A "+" on a node output opens a list of node kinds. The choice adds the node and the edge in one step.
- A drag from an output to another node connects them. Delete removes the selected nodes or the selected edge.

Selection:
- The selection holds one or more node ids, or one edge id.
- Shift and click on a node adds it to the selection or removes it.
- Shift and drag on empty canvas draws a selection box. A plain drag pans. The box selects each node that it touches.
- Ctrl+A selects all nodes. A click on empty canvas or Esc clears the selection.
- A selected node has a thin outline. Only a single selected node expands. A selection of several nodes keeps all nodes collapsed.
- Shift, the box, and Ctrl+A work in edit mode only.

Clipboard:
- Ctrl+C copies the selected nodes and only the edges between them. The text is JSON. The app writes it to the system clipboard and to local storage under the key `sosho.clipboard`.
- Ctrl+V pastes the nodes with new ids. An id that is taken gets a suffix, for example `fetch_2`. The pasted nodes keep their internal edges.
- Paste never creates an edge to the existing graph. The user connects the pasted nodes by hand.
- dagre places the pasted nodes. The pasted nodes become the selection.
- The Paste button and the node header actions read the local storage buffer. They never read the system clipboard, so the browser shows no permission prompt.
- Ctrl+V uses the paste event and its `clipboardData`. If `clipboardData` holds no nodes, paste uses the local storage buffer.
- Paste works across workflows and same-origin browser tabs. A `storage` event updates the other tabs. If the clipboard holds no valid nodes, paste does nothing and shows a quiet note.
- Ctrl+D duplicates the selection with the same rules as paste.
- Each paste, duplicate, and delete of several nodes is one undo step.
- The keys are ignored when the focus is in a text field, and in run mode. There is no right-click menu.

One trigger:
- A workflow has one trigger node.
- The "+" menu shows `trigger` as disabled when the workflow has one. The tooltip reads "A workflow has one trigger".
- Paste and duplicate skip a trigger node when the workflow has one. They also drop the edges that touch the skipped trigger. A quiet note reads "Trigger skipped: a workflow has one trigger."
- Deleting the only trigger is allowed. Validation shows the problem. The engine validation is the source of truth.

Helper box:
- The popover lists the actions with their keys, in two columns.
- It shows Cmd instead of Ctrl on macOS.
- It is collapsed at each load. A small glass text button with the text "Shortcuts" and no icon shows at the bottom left.
- A click on the button opens the list in a popover that is anchored to the button. A click outside the popover, or Esc, closes it. The app does not keep the open state.
- The popover opens and closes with the motion tokens.
- In run mode, it lists only the actions that apply.

Node content by mode:

| Node | Edit mode | Run mode |
| :--- | :--- | :--- |
| Any | Settings form and validation messages | Status, output, error. The engine does not store node input. |
| trigger | Mode, cron, Test input JSON. The webhook uniform resource locator (URL) and masked token with Show inside the field, Copy, Regenerate, and Copy curl, the next run time, or the source workflow it follows. This data comes from `GET /workflows/{id}/triggers`. | Fire time and input |
| human | Prompt and actions | When it waits, it expands by itself and shows the reply buttons and fields. This replaces an Inbox. |

## 5 State
- One state object holds these items:
  - The workflow JSON.
  - The selection.
  - The mode. The mode is edit or run. Run mode uses a run id.
- Each change makes a new snapshot. Undo and redo move between snapshots.
- Copy and paste use the JSON of the selected nodes and the edges between them.
- URL: /w/{workflow_id}?v={version} and /w/{workflow_id}?v={version}&run={run_id}. Without v, the app opens the latest version. /design-ref keeps the showcase.

Done. See packages/engine/README.md for UI serving, the session cookie, run deletion, triggers that are always live, and webhook tokens.

## 7 Phases
All phases are done.
1. Engine: done. The engine serves the UI, accepts the cookie, and has Pytest tests.
2. Web foundations: done. The API client, the reducer with undo and redo, the URL switch, the Vite proxy, and Vitest tests exist.
3. Canvas rework: done. The HTML node layer, the SVG edges, dagre with measured sizes, and camera follow exist.
4. Left panel and HUD: done. They work against the live engine: two tabs, new, duplicate, rename, Save as vN, and the opened version in the URL.
   - Triggers are always live. There is no Live switch. Each save binds the non-manual triggers of the new version. `GET /workflows/{id}/triggers` gives the webhooks, schedules, and followers of the saved version. A bad cron, a bad time zone, or a trigger cycle refuses the save with 422.
   - Run starts the latest saved version. The button reads Run in edit mode, Cancel while a run is active, and Edit after a run ended. Resume and Fork are icon buttons.
   - The time zone field has no search field. Typing in the open list jumps to the first match. The match covers the full name and the part after a slash.
   - The token field holds the eye button as an end adornment. The icon gap is `--space-1`.
   - An edit clears the stale issues of the node at once.
5. Edit: done. Schema forms, validation, edge conditions, add, connect, delete, undo, redo, copy, and paste exist.
6. Run mode: done. Run, event stream, node status, output, errors, human reply, cancel, resume, and fork exist.
7. Waiting runs: done. A 5 second poll, a count badge on the Runs tab, and a quiet sound with a mute toggle exist.
8. Tests and cleanup: done. `make web-build` and `./run.sh build` exist. `make test` and `make test-fast` run the web checks. Dead code is removed.

## 8 Cuts
These items were in an earlier draft. Do not build them:
- An engine draft table.
- Stored node positions.
- A trigger input schema.
- A feed across workflows.
- A separate inspector panel.
- An Inbox drawer.
- Runs, Versions, and Triggers panels.
- Workflow tabs.
- Toasts for alerts.
- Custom inspector field types.

## 9 Known limits
- Each Save adds a version number.
- The waiting badge can be up to 5 seconds late.
- Run mode shows node output and errors. It does not show node input.

## 10 Known gaps
- Loop arcs overlap.
- The camera does not fit again after an edit that changes only edges.
- A new router node starts invalid.
- Run input shows only for local runs.
- Fork uses occurrence 1.
- Rename does not change old versions.
- The integration tests now delete their workflows. Nobody has run them yet.
