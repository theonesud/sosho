import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from "react";
import type { Viewport } from "./camera";
import type { Point } from "./edge-path";

export interface ConnectDrag {
  readonly source: string;
  readonly from: Point;
  readonly to: Point;
  readonly target: string | null;
}

interface Options {
  readonly frame: RefObject<HTMLDivElement | null>;
  readonly getView: () => Viewport | null;
  readonly onConnect: (source: string, target: string) => void;
}

const DRAG_THRESHOLD = 4;

function nodeAt(x: number, y: number): string | null {
  const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-node-id]");
  return hit?.dataset.nodeId ?? null;
}

export function useConnectDrag({ frame, getView, onConnect }: Options) {
  const [drag, setDrag] = useState<ConnectDrag | null>(null);
  const consumed = useRef(false);

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const box = frame.current?.getBoundingClientRect();
      const view = getView();
      if (!box || !view) return null;
      return {
        x: (clientX - box.left - view.x) / view.k,
        y: (clientY - box.top - view.y) / view.k,
      };
    },
    [frame, getView],
  );

  const begin = useCallback(
    (event: ReactPointerEvent, source: string, from: Point, onClick: () => void) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      let target: string | null = null;

      function onMove(move: PointerEvent) {
        if (!moved && Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD) {
          return;
        }
        moved = true;
        const to = toWorld(move.clientX, move.clientY);
        target = nodeAt(move.clientX, move.clientY);
        if (to) setDrag({ source, from, to, target: target === source ? null : target });
      }

      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setDrag(null);
        if (!moved) return onClick();
        consumed.current = true;
        setTimeout(() => {
          consumed.current = false;
        }, 0);
        if (target !== null && target !== source) onConnect(source, target);
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [toWorld, onConnect],
  );

  const wasConnecting = useCallback(() => consumed.current, []);
  return { drag, begin, wasConnecting };
}
