import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "../api/types";
import { edgeKey } from "../state/graph";
import type { Rect } from "./camera";
import { DEFAULT_SIZE, type SizeMap } from "./sizes";

const LABEL_SIZE = { width: 72, height: 18 };

export interface CanvasLayout {
  readonly rects: ReadonlyMap<string, Rect>;
  readonly width: number;
  readonly height: number;
}

export function hasLabel(edge: Edge): boolean {
  return Boolean(edge.when) || edge.loop === true;
}

export function layoutGraph(
  nodes: readonly Node[],
  edges: readonly Edge[],
  sizes: SizeMap,
): CanvasLayout {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: "LR",
    nodesep: 24,
    ranksep: 56,
    marginx: 32,
    marginy: 32,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    graph.setNode(node.id, { ...(sizes.get(node.id) ?? DEFAULT_SIZE) });
  }
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    const label = hasLabel(edge) ? { ...LABEL_SIZE, labelpos: "c" } : {};
    const [from, to] = edge.loop ? [edge.target, edge.source] : [edge.source, edge.target];
    graph.setEdge(from, to, label, edgeKey(edge));
  }
  dagre.layout(graph);

  const rects = new Map<string, Rect>();
  for (const node of nodes) {
    const placed = graph.node(node.id);
    rects.set(node.id, {
      x: placed.x - placed.width / 2,
      y: placed.y - placed.height / 2,
      width: placed.width,
      height: placed.height,
    });
  }
  const size = graph.graph();
  return { rects, width: size.width ?? 0, height: size.height ?? 0 };
}
