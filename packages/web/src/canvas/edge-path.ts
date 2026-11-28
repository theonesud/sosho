import type { Rect } from "./camera";

export interface Point {
  readonly x: number;
  readonly y: number;
}

const MIN_CURVE = 40;

export function edgeEnds(source: Rect, target: Rect): readonly [Point, Point] {
  return [
    { x: source.x + source.width, y: source.y + source.height / 2 },
    { x: target.x, y: target.y + target.height / 2 },
  ];
}

export function edgePath(from: Point, to: Point): string {
  const reach = Math.max(MIN_CURVE, Math.abs(to.x - from.x) / 2);
  return `M${from.x},${from.y} C${from.x + reach},${from.y} ${to.x - reach},${to.y} ${to.x},${to.y}`;
}

export function edgeMidpoint(from: Point, to: Point): Point {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

export interface LoopRoute {
  readonly path: string;
  readonly mid: Point;
  readonly above: boolean;
}

export interface Bounds {
  readonly top: number;
  readonly bottom: number;
}

const LOOP_CLEARANCE = 40;
const LOOP_REACH = 48;

export function graphBounds(rects: Iterable<Rect>): Bounds {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    top = Math.min(top, rect.y);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return Number.isFinite(top) ? { top, bottom } : { top: 0, bottom: 0 };
}

export function loopRoute(from: Point, to: Point, bounds: Bounds): LoopRoute {
  const above = (from.y + to.y) / 2 <= (bounds.top + bounds.bottom) / 2;
  const lift = above ? bounds.top - LOOP_CLEARANCE : bounds.bottom + LOOP_CLEARANCE;
  const apexX = (from.x + to.x) / 2;
  const out = from.x + LOOP_REACH;
  const into = to.x - LOOP_REACH;
  const path =
    `M${from.x},${from.y} C${out},${from.y} ${out},${lift} ${apexX},${lift} ` +
    `C${into},${lift} ${into},${to.y} ${to.x},${to.y}`;
  return { path, mid: { x: apexX, y: lift }, above };
}
