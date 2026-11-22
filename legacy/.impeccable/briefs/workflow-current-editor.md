# Workflow Current Editor — Design Brief

**Status:** Confirmed
**Surface:** `/` Workflows & Runs, Sosho Studio
**Mode:** Operate
**Date:** 2026-11-20

## 1. Job and audience

Solo local-first AI developers on one GPU workstation. They arrive with a saved workflow or a past run and need one precise surface to edit, run, and inspect it. Today editing is scattered across the sidebar list, the canvas header, and anchored popovers; nodes have no typed contract; memory and checkpointing are fully manual.

## 2. Outcome and proof

- One **Current** editor surface is the only place a graph is edited or run.
- A saved workflow or a history run loads into Current; source items stay read-only.
- Every node declares typed inputs and outputs; connections show compatibility and run a standard middleware pipeline.
- `+` starts a workflow from Agent / Skill / Tool.
- Memory recall and run-summary save are automatic and visible; important steps checkpoint automatically; mistakes roll back.

**Proof of success:** load a saved graph, add a typed node, connect it with a green compatibility ring, run, see the middleware mapping and memory recall in the node log, and roll back cleanly.

## 3. Selected direction

- **Current-first editor.** Current replaces the Saved Workflows / Runs list as the editor surface. Saved workflows and runs live in a slim source drawer that loads into Current. Current is always active; loading replaces its contents; dirty state and Run/Save controls live in Current's header.
- **Typed node contracts + edge middleware.** Node types derive default ports; an edge carries an ordered pipeline (`validate → map → cast → redact → trace → deliver`) and defaults to today's `outputKey` passthrough.
- **Tactile canvas.** Proximity ports, endpoint rewire, branch ports on decision nodes, pan/zoom, validation strip.
- **Durable run policy.** Graph-level policy for memory recall/save, synthetic checkpoints, autosave versions, and decision/audit logs.

## 4. Scope and boundaries

**In scope:** Current tab model; starter picker; exact-model catalog with tags; node I/O contracts; edge compatibility + middleware; first/last node; proximity ports; disconnect/reconnect; decision branch ports; pan/zoom; validation strip; graph policy UI; autosave/version history; decision logs.

**Out of scope:** replacing the obsidian design system; modal dialogs; multi-user collaboration; editing `.pi/model-roles.json`, `.pi/models.json`, or `.env` (read-only in the UI).

**Removed from the canvas header:** the **Arrange** and **Add Node** buttons. Add Node moves to the `+` ports and the empty state. Arrange is removed entirely; the flow layout handles arrangement.

**Untouched:** ports 4100/4101, loopback CORS, bearer auth, existing node activities, queue lanes, and the Langfuse/YuE2 integrations.

## 5. States and ranges

- **Current tab:** empty (plus + three starters), dirty, saving, saved, running, waiting_checkpoint, failed, read-only run view.
- **Graph size:** 1–200 nodes typical; 0–8 ports per node; 0–4 edges per node.
- **Model catalog:** 6+ models across 5 providers, tagged `large`, `small`, `emb`, `decision`, `music gen`, `code`, `vision`, `reasoning`, `local`, `cloud`, `uncensored`.
- **Compatibility:** compatible / cast / incompatible; strict mode optional.
- **Rollback:** undo/redo depth 40; autosaved graph versions; run resume from the last checkpoint or completed step, keeping history.

## 6. Interaction and layout

- **Source drawer → Current.** The source drawer lists saved workflows and runs. Clicking a saved workflow loads it editable; clicking a run loads it read-only with an Edit/Fork action. Only Current has Run/Save.
- **Starter picker.** `+` opens Agent / Skill / Tool as primary, Decision / Memory / Checkpoint as secondary. Picking one creates the first node and opens its editor.
- **Node editor.** Anchored popover: label, model picker (exact model id + tags), input type, prompt/template, collapsible Inputs and Outputs port sections, connections, advanced accordion. Output visibility controls: preview length, include in final output, redact.
- **Connecting.** Drag from a node port; the hovered target shows a compatibility ring; release connects. Edge end handles rewire; midpoint `×` deletes; `Esc` cancels and restores.
- **Decision nodes.** One labeled branch port per branch on the rim, branch-colored edges, branch dropdown in the edge editor.
- **Policy panel.** Graph settings: memory recall before (default `decision`), save run summary, auto-checkpoint before (GPU / YuE2 / tool), strict compatibility.
- **Feedback.** Ripple and spring on connect; skeleton on load; validation strip; decision log in the run detail.

## 7. Constraints and open decisions

**Constraints:** obsidian tokens, Inter / JetBrains Mono fixed scale, 150–250ms motion, no modals, Radix portals for overlays, skeleton loading, loopback-only, bearer auth on writes.

**Confirmed decisions:**
1. Current **replaces** the Saved Workflows / Runs list; sources live in a slim drawer.
2. Arrange is **removed entirely**; Add Node moves to the `+` ports and empty state.
3. Run rollback is **resume from the last checkpoint or completed step**, keeping history.
4. Phase-1 middleware is the **full set**: `validate`, `map`, `cast`, `redact`, `trace`, with mapping UI and compatibility checks.
