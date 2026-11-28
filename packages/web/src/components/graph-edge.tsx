import type { PlacedEdge } from "./graph-layout";
import { pathFromPoints } from "./graph-path";

interface GraphEdgeProps {
  readonly placed: PlacedEdge;
  readonly active: boolean;
  readonly linked: boolean;
}

export function GraphEdge({ placed, active, linked }: GraphEdgeProps) {
  const { edge, points, label } = placed;
  const isLoop = Boolean(edge.loop);
  const text = edge.when ?? (edge.loop ? `loop x${edge.loop.maxIterations}` : null);
  return (
    <g
      className="graph-edge"
      data-loop={isLoop ? "" : undefined}
      data-active={active ? "" : undefined}
      data-linked={linked ? "" : undefined}
    >
      <path d={pathFromPoints(points)} markerEnd="url(#graph-arrow)" />
      {text && label ? (
        <g transform={`translate(${label.x} ${label.y})`}>
          <rect className="graph-edge-label-bg" x={-36} y={-9} width={72} height={18} rx={6} />
          <text className="graph-edge-label" textAnchor="middle" y={4}>
            {text}
          </text>
        </g>
      ) : null}
    </g>
  );
}
