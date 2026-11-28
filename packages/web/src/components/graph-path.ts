import type { Point } from "./graph-layout";

export function pathFromPoints(points: readonly Point[]): string {
  const [first, ...rest] = points;
  if (!first) return "";
  if (rest.length === 0) return `M${first.x},${first.y}`;
  let d = `M${first.x},${first.y}`;
  let previous = first;
  for (const point of rest) {
    const midX = (previous.x + point.x) / 2;
    d += ` C${midX},${previous.y} ${midX},${point.y} ${point.x},${point.y}`;
    previous = point;
  }
  return d;
}
