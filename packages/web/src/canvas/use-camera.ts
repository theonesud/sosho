import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { type Viewport, viewTransform, zoomAt } from "./camera";

const DRAG_THRESHOLD = 4;
const LINE_PX = 16;
const WHEEL_RATE = 0.0015;
export const NO_PAN = "input, textarea, select, button, a, [contenteditable], [data-no-pan]";

function readView(world: HTMLElement): Viewport {
  const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
  return { x: matrix.e, y: matrix.f, k: matrix.a };
}

function setView(world: HTMLElement, view: Viewport, animate: boolean): void {
  if (animate) world.setAttribute("data-tween", "");
  else world.removeAttribute("data-tween");
  world.style.transform = viewTransform(view);
}

function freeze(world: HTMLElement): Viewport {
  const view = readView(world);
  setView(world, view, false);
  return view;
}

function isInsideScroller(start: Element, stop: Element | null): boolean {
  for (let el: Element | null = start; el && el !== stop; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) {
      return true;
    }
  }
  return false;
}

function useWheelZoom(
  frame: RefObject<HTMLDivElement | null>,
  world: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    function onWheel(event: WheelEvent) {
      const target = world.current;
      if (!target || !(event.target instanceof Element)) return;
      const onCard = event.target.closest(".cv-node-body") !== null;
      if (!onCard && event.target.closest("[data-no-pan]")) return;
      if (onCard && !event.ctrlKey && isInsideScroller(event.target, element)) return;
      event.preventDefault();
      if (onCard && !event.ctrlKey) {
        const lines = event.deltaMode === 1 ? LINE_PX : 1;
        const view = freeze(target);
        setView(target, { ...view, y: view.y - event.deltaY * lines }, false);
        return;
      }
      const rect = element?.getBoundingClientRect();
      if (!rect) return;
      const factor = Math.exp(-event.deltaY * WHEEL_RATE);
      const next = zoomAt(
        freeze(target),
        factor,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      setView(target, next, false);
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [frame, world]);
}

function startPan(
  target: HTMLElement,
  event: ReactPointerEvent,
  dragged: { current: boolean },
): void {
  const origin = freeze(target);
  const startX = event.clientX;
  const startY = event.clientY;
  function onMove(move: PointerEvent) {
    const dx = move.clientX - startX;
    const dy = move.clientY - startY;
    if (!dragged.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    dragged.current = true;
    setView(target, { ...origin, x: origin.x + dx, y: origin.y + dy }, false);
  }
  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    setTimeout(() => {
      dragged.current = false;
    }, 0);
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

export function useCamera(
  frame: RefObject<HTMLDivElement | null>,
  world: RefObject<HTMLDivElement | null>,
) {
  const dragged = useRef(false);

  const moveTo = useCallback(
    (view: Viewport, animate: boolean) => {
      if (world.current) setView(world.current, view, animate);
    },
    [world],
  );

  useWheelZoom(frame, world);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      const target = world.current;
      if (event.button !== 0 || !target) return;
      if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest(NO_PAN)) return;
      dragged.current = false;
      startPan(target, event, dragged);
    },
    [world],
  );

  const getView = useCallback(
    (): Viewport | null => (world.current ? readView(world.current) : null),
    [world],
  );

  const wasDragged = useCallback(() => dragged.current, []);
  return { moveTo, getView, onPointerDown, wasDragged };
}
