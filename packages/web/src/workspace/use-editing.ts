import { useEffect, useMemo, useRef } from "react";
import { isNode } from "../api/guards";
import type { Catalog, WorkflowSummary } from "../api/types";
import type { EditApi, TriggerApi } from "../canvas/edit-api";
import {
  clipboardAllowed,
  isFormTarget,
  isTypingTarget,
  resolveShortcut,
  type ShortcutContext,
} from "../canvas/shortcuts";
import { nodeFromSchema } from "../form/field-value";
import { normalizeTrigger } from "../form/trigger-spec";
import type { RunInputApi } from "../run/trigger-input";
import { readBuffer, useClipboardBuffer, writeBuffer } from "../state/clipboard-buffer";
import { copySelection, hasTrigger, parseClipboard, planPaste } from "../state/graph";
import type { EditorAction, EditorState } from "../state/reducer";
import { selectedIds } from "../state/selection";

export const TRIGGER_SKIPPED = "Trigger skipped: a workflow has one trigger.";
export const NOTHING_TO_PASTE = "Nothing to paste. The clipboard holds no nodes.";

interface EditingOptions {
  readonly state: EditorState;
  readonly dispatch: (action: EditorAction) => void;
  readonly catalog: Catalog | null;
  readonly editable: boolean;
  readonly runInput: RunInputApi;
  readonly workflowId: string | null;
  readonly workflows: readonly WorkflowSummary[];
  readonly notify: (text: string) => void;
  readonly triggers: TriggerApi;
}

function contextOf(editable: boolean, target: EventTarget | null): ShortcutContext {
  return { editable, typing: isTypingTarget(target) };
}

function countLabel(count: number): string {
  return count === 1 ? "1 node" : `${count} nodes`;
}

function useClipboardActions(options: EditingOptions) {
  const { dispatch, notify } = options;
  const latest = useRef(options);
  latest.current = options;

  return useMemo(() => {
    const copyText = (): string | null => {
      const { state } = latest.current;
      return copySelection(state.workflow, selectedIds(state.selection));
    };
    const pasteText = (text: string) => {
      const plan = planPaste(latest.current.state.workflow, text);
      if (!plan) return notify(NOTHING_TO_PASTE);
      dispatch({ type: "paste", text });
      if (plan.skippedTrigger) notify(TRIGGER_SKIPPED);
    };
    return {
      copyText,
      pasteText,
      copy: async () => {
        const text = copyText();
        if (text === null || !latest.current.editable) return;
        writeBuffer(text);
        notify(`Copied ${countLabel(selectedIds(latest.current.state.selection).length)}.`);
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          return;
        }
      },
      paste: () => {
        if (!latest.current.editable) return;
        const text = readBuffer();
        if (text === null) return notify(NOTHING_TO_PASTE);
        pasteText(text);
      },
      duplicate: () => {
        const text = copyText();
        if (text !== null && latest.current.editable) pasteText(text);
      },
    };
  }, [dispatch, notify]);
}

function useEditingKeys(
  options: EditingOptions,
  clipboard: ReturnType<typeof useClipboardActions>,
) {
  const { dispatch, notify } = options;
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const shortcut = resolveShortcut(event, contextOf(latest.current.editable, event.target));
      if (shortcut === "undo" || shortcut === "redo") {
        event.preventDefault();
        dispatch({ type: shortcut });
      } else if (isFormTarget(event.target)) {
        return;
      } else if (shortcut === "delete") {
        event.preventDefault();
        dispatch({ type: "deleteSelection" });
      } else if (shortcut === "selectAll") {
        event.preventDefault();
        dispatch({ type: "selectAll" });
      } else if (shortcut === "duplicate") {
        event.preventDefault();
        clipboard.duplicate();
      }
    }
    function onCopy(event: ClipboardEvent) {
      const { editable } = latest.current;
      if (!clipboardAllowed(contextOf(editable, event.target))) return;
      const text = clipboard.copyText();
      if (text === null) return;
      writeBuffer(text);
      if (!event.clipboardData) return;
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
      notify(`Copied ${countLabel(selectedIds(latest.current.state.selection).length)}.`);
    }
    function onPaste(event: ClipboardEvent) {
      if (!clipboardAllowed(contextOf(latest.current.editable, event.target))) return;
      const system = event.clipboardData?.getData("text/plain") ?? "";
      const text = parseClipboard(system) ? system : (readBuffer() ?? system);
      if (text === "") return;
      event.preventDefault();
      clipboard.pasteText(text);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("paste", onPaste);
    };
  }, [dispatch, notify, clipboard]);
}

export function useEditing(options: EditingOptions): EditApi {
  const { state, dispatch, catalog, editable, runInput, workflowId, workflows, triggers } = options;
  const clipboard = useClipboardActions(options);
  useEditingKeys(options, clipboard);
  const selectedCount = selectedIds(state.selection).length;
  const nodeCount = state.workflow.nodes.length;
  const canDelete = state.selection.kind !== null;
  const triggerTaken = hasTrigger(state.workflow);
  const canPaste = useClipboardBuffer();

  return useMemo(
    () => ({
      editable,
      catalog,
      runInput,
      workflowId,
      workflows,
      triggers,
      hasTrigger: triggerTaken,
      nodeCount,
      selectedCount,
      canDelete,
      canPaste,
      copy: clipboard.copy,
      paste: clipboard.paste,
      duplicate: clipboard.duplicate,
      deleteSelected: () => dispatch({ type: "deleteSelection" }),
      selectAll: () => dispatch({ type: "selectAll" }),
      updateNode: (id, node) => dispatch({ type: "updateNode", id, node }),
      deleteNode: (id) => {
        dispatch({ type: "selectNodes", ids: [id] });
        dispatch({ type: "deleteSelection" });
      },
      addAfter: (from, kind) => {
        const entry = catalog?.kinds.find((item) => item.kind === kind);
        if (!entry) return;
        const node = nodeFromSchema(entry.json_schema, kind, kind);
        if (!isNode(node)) return;
        const added = node.kind === "trigger" ? normalizeTrigger(node) : node;
        dispatch({ type: "addNode", node: added, from });
      },
      connect: (source, target) => dispatch({ type: "connect", source, target }),
      patchEdge: (id, patch) => dispatch({ type: "patchEdge", id, patch }),
    }),
    [
      editable,
      catalog,
      runInput,
      workflowId,
      workflows,
      triggers,
      dispatch,
      clipboard,
      triggerTaken,
      nodeCount,
      selectedCount,
      canDelete,
      canPaste,
    ],
  );
}
