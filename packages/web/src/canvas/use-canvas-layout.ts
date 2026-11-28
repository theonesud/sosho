import { useMemo } from "react";
import type { Edge, Node } from "../api/types";
import { placeEdges } from "./edge-layer";
import { layoutGraph } from "./layout";
import { useNodeSizes } from "./use-node-sizes";

export function useCanvasLayout(nodes: readonly Node[], edges: readonly Edge[]) {
  const { sizes, version, sizeRef } = useNodeSizes();
  const layout = useMemo(() => layoutGraph(nodes, edges, sizes), [nodes, edges, sizes]);
  const placed = useMemo(() => placeEdges(edges, layout.rects), [edges, layout.rects]);
  return { layout, placed, version, sizeRef };
}
