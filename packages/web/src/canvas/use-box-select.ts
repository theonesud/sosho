import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { boxFromPoints, boxToWorld, nodesInBox } from "./box-select";
import type { Rect, Viewport } from "./camera";
import { isTypingTarget } from "./shortcuts";
import { NO_PAN } from "./use-camera";

const DRAG_THRESHOLD = 4;

function useSpaceHeld() {
  const held = useRef(false);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space" && !isTypingTarget(event.target)) held.current = true;
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") held.current = false;
    };
    const reset = () => {
      held.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
    };
  }, []);
  return held;
}

interface BoxOptions {
  readonly frame: RefObject<HTMLDivElement | null>;
  readonly getView: () => Viewport | null;
  readonly rects: ReadonlyMap<string, Rect>;
  readonly enabled: boolean;
  readonly tool: boolean;
  readonly onBox: (ids: readonly string[]) => void;
}

export function useBoxSelect({ frame, getView, rects, enabled, tool, onBox }: BoxOptions) {
  const [box, setBox] = useState<Rect | null>(null);
  const space = useSpaceHeld();
  const consumed = useRef(false);
  const latest = useRef({ rects, onBox, getView });
  latest.current = { rects, onBox, getView };

  const onPointerDown = useCallback(
    (event: ReactPointerEvent): boolean => {
      const element = frame.current;
      if (!enabled || !element || event.button !== 0) return false;
      if (!event.shiftKey && !(tool && !space.current)) return false;
      if (!(event.target instanceof Element) || event.target.closest(NO_PAN)) return false;
      const bounds = element.getBoundingClientRect();
      const start = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      let moved = false;
      let current: Rect | null = null;

      function onMove(move: PointerEvent) {
        const at = { x: move.clientX - bounds.left, y: move.clientY - bounds.top };
        if (!moved && Math.hypot(at.x - start.x, at.y - start.y) < DRAG_THRESHOLD) return;
        moved = true;
        current = boxFromPoints(start, at);
        setBox(current);
      }

      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setBox(null);
        const view = latest.current.getView();
        if (!moved || !current || !view) return;
        consumed.current = true;
        setTimeout(() => {
          consumed.current = false;
        }, 0);
        latest.current.onBox(nodesInBox(latest.current.rects, boxToWorld(current, view)));
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return true;
    },
    [frame, enabled, tool, space],
  );

  const wasBoxing = useCallback(() => consumed.current, []);
  return { box, onPointerDown, wasBoxing };
}
