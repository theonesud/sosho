import type { Edge } from "../api/types";
import { cssVars } from "../css-vars";
import type { NodeStatus } from "../run/run-state";
import { edgeKey } from "../state/graph";
import type { Rect } from "./camera";
import { edgeEnds, edgeMidpoint, edgePath, graphBounds, loopRoute, type Point } from "./edge-path";

export interface PlacedEdge {
  readonly edge: Edge;
  readonly id: string;
  readonly path: string;
  readonly mid: Point;
  readonly above?: boolean;
}

export function placeEdges(
  edges: readonly Edge[],
  rects: ReadonlyMap<string, Rect>,
): readonly PlacedEdge[] {
  const bounds = graphBounds(rects.values());
  const placed: PlacedEdge[] = [];
  for (const edge of edges) {
    const source = rects.get(edge.source);
    const target = rects.get(edge.target);
    if (!source || !target) continue;
    const [from, to] = edgeEnds(source, target);
    const id = edgeKey(edge);
    if (edge.loop) {
      const route = loopRoute(from, to, bounds);
      placed.push({ edge, id, path: route.path, mid: route.mid, above: route.above });
    } else {
      placed.push({ edge, id, path: edgePath(from, to), mid: edgeMidpoint(from, to) });
    }
  }
  return placed;
}

interface EdgeSvgProps {
  readonly placed: readonly PlacedEdge[];
  readonly selectedId: string | null;
  readonly preview?: { readonly from: Point; readonly to: Point } | null;
  readonly statusOf?: ((nodeId: string) => NodeStatus | undefined) | undefined;
}

export function EdgeSvg({ placed, selectedId, preview, statusOf }: EdgeSvgProps) {
  return (
    <svg className="cv-edges" aria-hidden="true">
      <defs>
        <marker
          id="cv-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
        >
          <path d="M1 1L9 5L1 9z" className="cv-arrow-head" />
        </marker>
      </defs>
      {placed.map(({ edge, id, path }) => (
        <g
          key={id}
          className="cv-edge"
          data-edge-id={id}
          data-loop={edge.loop ? "" : undefined}
          data-selected={id === selectedId ? "" : undefined}
          data-active={statusOf?.(edge.target) === "running" ? "" : undefined}
          style={cssVars({ "--d": `path("${path}")` })}
        >
          <path className="cv-edge-line" d={path} markerEnd="url(#cv-arrow)" />
          <path className="cv-edge-hit" d={path} />
        </g>
      ))}
      {preview ? (
        <path
          className="cv-edge-preview"
          d={edgePath(preview.from, preview.to)}
          markerEnd="url(#cv-arrow)"
        />
      ) : null}
    </svg>
  );
}
