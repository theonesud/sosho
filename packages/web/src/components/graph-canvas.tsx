import { Button } from "@ui-sdk/react/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import { useMemo, useRef } from "react";
import type { GraphEdge as GraphEdgeData, GraphNode as GraphNodeData } from "../types";
import { GraphEdge } from "./graph-edge";
import { layoutGraph } from "./graph-layout";
import { GraphNode } from "./graph-node";
import { Icon } from "./icon";
import type { IconName } from "./icon-paths";
import { usePanZoom } from "./use-pan-zoom";

interface GraphCanvasProps {
  readonly nodes: readonly GraphNodeData[];
  readonly edges: readonly GraphEdgeData[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}

interface ControlButtonProps {
  readonly icon: IconName;
  readonly label: string;
  readonly onClick: () => void;
}

function ControlButton({ icon, label, onClick }: ControlButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button data-variant="ghost" aria-label={label} onClick={onClick} />}>
        <Icon name={icon} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function GraphCanvas({ nodes, edges, selectedId, onSelect }: GraphCanvasProps) {
  const layout = useMemo(() => layoutGraph(nodes, edges), [nodes, edges]);
  const statusById = useMemo(() => new Map(nodes.map((n) => [n.id, n.status])), [nodes]);
  const isLinked = (source: string, target: string) =>
    selectedId !== null && (source === selectedId || target === selectedId);
  const isActive = (source: string, target: string) =>
    statusById.get(source) === "succeeded" && statusById.get(target) === "running";
  const frame = useRef<HTMLDivElement>(null);
  const { view, fit, zoomIn, zoomOut, onPointerDown, wasDragged } = usePanZoom(frame, layout);

  return (
    <div className="graph-canvas card" ref={frame}>
      <svg
        className="graph-svg"
        aria-label="Workflow graph. Drag to pan, scroll to zoom."
        onPointerDown={onPointerDown}
      >
        <defs>
          <marker
            id="graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M1 1L9 5L1 9z" className="graph-arrow-head" />
          </marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {layout.edges.map((placed) => (
            <GraphEdge
              key={placed.id}
              placed={placed}
              active={isActive(placed.edge.source, placed.edge.target)}
              linked={isLinked(placed.edge.source, placed.edge.target)}
            />
          ))}
          {layout.nodes.map((placed) => (
            <GraphNode
              key={placed.node.id}
              node={placed.node}
              x={placed.x}
              y={placed.y}
              selected={placed.node.id === selectedId}
              onSelect={onSelect}
              wasDragged={wasDragged}
            />
          ))}
        </g>
      </svg>
      <div className="graph-controls">
        <ControlButton icon="plus" label="Zoom in" onClick={zoomIn} />
        <ControlButton icon="minus" label="Zoom out" onClick={zoomOut} />
        <ControlButton icon="fit" label="Zoom to fit" onClick={fit} />
      </div>
    </div>
  );
}
