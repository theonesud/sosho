import { kindMeta, statusMeta } from "../meta";
import type { GraphNode as GraphNodeData } from "../types";
import { NODE_HEIGHT, NODE_WIDTH } from "./graph-layout";
import { iconPaths } from "./icon-paths";

interface GraphNodeProps {
  readonly node: GraphNodeData;
  readonly x: number;
  readonly y: number;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
  readonly wasDragged: () => boolean;
}

export function GraphNode({ node, x, y, selected, onSelect, wasDragged }: GraphNodeProps) {
  const kind = kindMeta[node.kind];
  const status = statusMeta[node.status];

  function select() {
    if (!wasDragged()) onSelect(node.id);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a button element
    <g
      className="graph-node"
      data-kind={node.kind}
      data-status={node.status}
      data-selected={selected ? "" : undefined}
      transform={`translate(${x - NODE_WIDTH / 2} ${y - NODE_HEIGHT / 2})`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${node.name}, ${kind.label} node, ${status.label}`}
      onClick={select}
      onKeyDown={(event) => {
        if (event.code === "Enter" || event.code === "Space") {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      <rect className="graph-node-body" width={NODE_WIDTH} height={NODE_HEIGHT} rx={10} />
      <g
        transform="translate(14 16) scale(0.8)"
        className="graph-node-icon"
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={iconPaths[kind.icon]} />
      </g>
      <text className="graph-node-name" x={42} y={24}>
        {node.name}
      </text>
      <text className="graph-node-meta" x={42} y={39}>
        {kind.label}
      </text>
      <circle className="graph-node-dot" cx={NODE_WIDTH - 16} cy={NODE_HEIGHT / 2} r={4} />
      <title>{`${node.name}: ${status.label}`}</title>
    </g>
  );
}
