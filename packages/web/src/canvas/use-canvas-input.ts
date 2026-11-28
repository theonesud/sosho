import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { Node } from "../api/types";
import { nodesSelection, type Selection, sameSelection } from "../state/selection";
import type { Rect } from "./camera";
import type { SelectApi } from "./select-api";
import { useEscapeToDeselect } from "./use-canvas-controls";
import type { useConnectDrag } from "./use-connect-drag";

const IGNORE_CLICK = "[data-no-pan], input, textarea, select";

function pickSelection(target: Element): Selection {
  const node = target.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
  if (node) return nodesSelection([node]);
  const edgeId = target.closest("[data-edge-id]")?.getAttribute("data-edge-id");
  return edgeId ? { kind: "edge", id: edgeId } : { kind: null };
}

function isInside(event: { readonly currentTarget: Element; readonly target: EventTarget }) {
  return event.target instanceof globalThis.Node && event.currentTarget.contains(event.target);
}

interface InputOptions {
  readonly rects: ReadonlyMap<string, Rect>;
  readonly selection: Selection;
  readonly select: SelectApi;
  readonly editable: boolean;
  readonly wasDragged: () => boolean;
  readonly wasBoxing: () => boolean;
  readonly connecting: ReturnType<typeof useConnectDrag>;
}

export function useCanvasInput({
  rects,
  selection,
  select,
  editable,
  wasDragged,
  wasBoxing,
  connecting,
}: InputOptions) {
  useEscapeToDeselect(selection, select.set);

  function onClick(event: ReactMouseEvent) {
    if (wasDragged() || wasBoxing() || connecting.wasConnecting() || !isInside(event)) return;
    if (!(event.target instanceof Element) || event.target.closest(IGNORE_CLICK)) return;
    const next = pickSelection(event.target);
    if (event.shiftKey && editable) {
      const id = next.kind === "nodes" ? next.ids[0] : undefined;
      if (id !== undefined) select.toggle(id);
      return;
    }
    if (!sameSelection(next, selection)) select.set(next);
  }

  function handleDown(node: Node) {
    return (event: ReactPointerEvent, onClickHandle: () => void) => {
      const rect = rects.get(node.id);
      if (!rect) return;
      const from = { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
      connecting.begin(event, node.id, from, onClickHandle);
    };
  }

  return { onClick, handleDown };
}
