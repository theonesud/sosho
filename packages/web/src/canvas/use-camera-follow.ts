import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { fitViewport, holdTop, type Rect, revealRect, type Size, type Viewport } from "./camera";
import type { CanvasLayout } from "./layout";

interface FollowOptions {
  readonly frame: RefObject<HTMLDivElement | null>;
  readonly world: RefObject<HTMLDivElement | null>;
  readonly layout: CanvasLayout;
  readonly version: number;
  readonly expandedId: string | null;
  readonly moveTo: (view: Viewport, animate: boolean) => void;
  readonly getView: () => Viewport | null;
}

export function frameSize(frame: RefObject<HTMLDivElement | null>): Size | null {
  const element = frame.current;
  if (!element || element.clientWidth === 0) return null;
  return { width: element.clientWidth, height: element.clientHeight };
}

function sameRect(a: Rect | undefined, b: Rect | undefined): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function useCameraFollow({
  frame,
  world,
  layout,
  version,
  expandedId,
  moveTo,
  getView,
}: FollowOptions): void {
  const fitted = useRef(false);
  const stamp = useRef(0);
  const awaiting = useRef(false);
  const followed = useRef<Rect | undefined>(undefined);
  const latest = useRef({ layout, expandedId, version });
  latest.current = { layout, expandedId, version };

  // biome-ignore lint/correctness/useExhaustiveDependencies: the stamp must change only when the expanded node changes
  useLayoutEffect(() => {
    stamp.current = latest.current.version;
    awaiting.current = true;
    followed.current = undefined;
  }, [expandedId]);

  useEffect(() => {
    const size = frameSize(frame);
    if (!size || version === 0) return;
    const rect = expandedId === null ? undefined : layout.rects.get(expandedId);
    if (!fitted.current) {
      fitted.current = true;
      awaiting.current = false;
      moveTo(fitViewport(layout, size), false);
      requestAnimationFrame(() => world.current?.setAttribute("data-ready", ""));
      return;
    }
    if (awaiting.current) {
      if (version <= stamp.current) return;
      awaiting.current = false;
      followed.current = rect;
      moveTo(rect ? revealRect(rect, size, 1) : fitViewport(layout, size), true);
      return;
    }
    if (rect && !sameRect(rect, followed.current)) {
      const previous = followed.current;
      const view = getView();
      followed.current = rect;
      if (previous && view) moveTo(holdTop(view, previous, rect), true);
    }
  }, [frame, world, layout, version, expandedId, moveTo, getView]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const size = frameSize(frame);
      if (!size || !fitted.current || latest.current.expandedId !== null) return;
      moveTo(fitViewport(latest.current.layout, size), false);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [frame, moveTo]);
}
