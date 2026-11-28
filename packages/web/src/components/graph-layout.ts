import dagre from "@dagrejs/dagre";
import type { GraphEdge, GraphNode } from "../types";

export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 52;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface PlacedNode {
  readonly node: GraphNode;
  readonly x: number;
  readonly y: number;
}

export interface PlacedEdge {
  readonly id: string;
  readonly edge: GraphEdge;
  readonly points: readonly Point[];
  readonly label: Point | null;
}

export interface GraphLayout {
  readonly nodes: readonly PlacedNode[];
  readonly edges: readonly PlacedEdge[];
  readonly width: number;
  readonly height: number;
}

export function layoutGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): GraphLayout {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: "LR",
    nodesep: 20,
    ranksep: 40,
    marginx: 24,
    marginy: 24,
    acyclicer: "greedy",
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    const size = edge.when || edge.loop ? { width: 72, height: 18, labelpos: "c" } : {};
    graph.setEdge(edge.source, edge.target, size, `${edge.source}>${edge.target}`);
  }
  dagre.layout(graph);

  const placedNodes: PlacedNode[] = nodes.map((node) => {
    const placed = graph.node(node.id);
    return { node, x: placed.x, y: placed.y };
  });
  const placedEdges: PlacedEdge[] = edges.map((edge) => {
    const id = `${edge.source}>${edge.target}`;
    const placed = graph.edge({ v: edge.source, w: edge.target, name: id });
    const hasLabel = Boolean(edge.when || edge.loop);
    return {
      id,
      edge,
      points: placed.points ?? [],
      label: hasLabel ? { x: placed.x, y: placed.y } : null,
    };
  });
  const size = graph.graph();
  return {
    nodes: placedNodes,
    edges: placedEdges,
    width: size.width ?? 0,
    height: size.height ?? 0,
  };
}
