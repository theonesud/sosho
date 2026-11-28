import type { Rect, Viewport } from "./camera";
import type { Point } from "./edge-path";

export function boxFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function boxToWorld(box: Rect, view: Viewport): Rect {
  return {
    x: (box.x - view.x) / view.k,
    y: (box.y - view.y) / view.k,
    width: box.width / view.k,
    height: box.height / view.k,
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
  );
}

export function nodesInBox(rects: ReadonlyMap<string, Rect>, box: Rect): readonly string[] {
  return [...rects].filter(([, rect]) => rectsIntersect(rect, box)).map(([id]) => id);
}
