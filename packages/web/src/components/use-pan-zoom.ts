import {
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { easeOut, readTweenMs } from "./motion";

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.5;
const DRAG_THRESHOLD = 4;

function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

function zoomAt(view: Viewport, factor: number, cx: number, cy: number): Viewport {
  const k = clampZoom(view.k * factor);
  const ratio = k / view.k;
  return { k, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio };
}

interface DragState {
  readonly startX: number;
  readonly startY: number;
  readonly originX: number;
  readonly originY: number;
  moved: boolean;
}

type SetView = Dispatch<SetStateAction<Viewport>>;
type Frame = RefObject<HTMLDivElement | null>;

function useTween(frame: Frame, setView: SetView, viewRef: RefObject<Viewport>) {
  const frameId = useRef(0);
  const target = useRef<Viewport | null>(null);

  const stopTween = useCallback(() => {
    cancelAnimationFrame(frameId.current);
    target.current = null;
  }, []);

  const tweenTo = useCallback(
    (next: Viewport) => {
      cancelAnimationFrame(frameId.current);
      const ms = readTweenMs(frame.current);
      if (ms <= 0) {
        target.current = null;
        setView(next);
        return;
      }
      target.current = next;
      const from = viewRef.current;
      const start = performance.now();
      function step(now: number) {
        const t = Math.min(1, (now - start) / ms);
        const e = easeOut(t);
        setView({
          x: from.x + (next.x - from.x) * e,
          y: from.y + (next.y - from.y) * e,
          k: from.k + (next.k - from.k) * e,
        });
        if (t < 1) frameId.current = requestAnimationFrame(step);
        else target.current = null;
      }
      frameId.current = requestAnimationFrame(step);
    },
    [frame, setView, viewRef],
  );

  useEffect(() => stopTween, [stopTween]);
  return { stopTween, tweenTo, target };
}

function useWheelZoom(frame: Frame, setView: SetView, stopTween: () => void): void {
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      stopTween();
      const rect = el?.getBoundingClientRect();
      if (!rect) return;
      const factor = Math.exp(-event.deltaY * 0.0015);
      setView((current) =>
        zoomAt(current, factor, event.clientX - rect.left, event.clientY - rect.top),
      );
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [frame, setView, stopTween]);
}

function useDrag(setView: SetView, viewRef: RefObject<Viewport>, stopTween: () => void) {
  const drag = useRef<DragState | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      stopTween();
      const current = viewRef.current;
      drag.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: current.x,
        originY: current.y,
        moved: false,
      };
      function onMove(move: PointerEvent) {
        const state = drag.current;
        if (!state) return;
        const dx = move.clientX - state.startX;
        const dy = move.clientY - state.startY;
        if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        state.moved = true;
        setView((v) => ({ ...v, x: state.originX + dx, y: state.originY + dy }));
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setTimeout(() => {
          drag.current = null;
        }, 0);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setView, viewRef, stopTween],
  );

  const wasDragged = useCallback(() => drag.current?.moved ?? false, []);
  return { onPointerDown, wasDragged };
}

export function usePanZoom(
  frame: Frame,
  content: { readonly width: number; readonly height: number },
) {
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const { stopTween, tweenTo, target } = useTween(frame, setView, viewRef);

  const fitView = useCallback((): Viewport | null => {
    const el = frame.current;
    if (!el || content.width === 0) return null;
    const { width, height } = el.getBoundingClientRect();
    const k = clampZoom(Math.min(width / content.width, height / content.height, 1.2));
    return { k, x: (width - content.width * k) / 2, y: (height - content.height * k) / 2 };
  }, [frame, content.width, content.height]);

  const fit = useCallback(() => {
    const next = fitView();
    if (next) tweenTo(next);
  }, [fitView, tweenTo]);

  const zoomBy = useCallback(
    (factor: number) => {
      const el = frame.current;
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      tweenTo(zoomAt(target.current ?? viewRef.current, factor, width / 2, height / 2));
    },
    [frame, tweenTo, target],
  );

  useEffect(() => {
    const next = fitView();
    if (next) setView(next);
  }, [fitView]);

  useWheelZoom(frame, setView, stopTween);
  const { onPointerDown, wasDragged } = useDrag(setView, viewRef, stopTween);

  return {
    view,
    fit,
    zoomIn: () => zoomBy(1.25),
    zoomOut: () => zoomBy(0.8),
    onPointerDown,
    wasDragged,
  };
}
