import { type PointerEvent as ReactPointerEvent, useMemo } from "react";
import type { Issue, Node } from "../api/types";
import type { Rect } from "./camera";
import type { EditApi } from "./edit-api";
import { NodeCard } from "./node-card";
import type { RunApi } from "./run-api";

interface NodeLayerProps {
  readonly nodes: readonly Node[];
  readonly rects: ReadonlyMap<string, Rect>;
  readonly expandedId: string | null;
  readonly selectedIds: ReadonlySet<string>;
  readonly connectTarget: string | null;
  readonly edit: EditApi;
  readonly invalid?: ReadonlyMap<string, readonly Issue[]> | undefined;
  readonly run?: RunApi | undefined;
  readonly sizeRef: (id: string) => (element: HTMLElement | null) => void;
  readonly onHandleDown: (node: Node) => (event: ReactPointerEvent, onClick: () => void) => void;
}

export function NodeLayer(props: NodeLayerProps) {
  const { nodes, rects, expandedId, selectedIds, connectTarget, edit, invalid, run } = props;
  const taken = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  return nodes.map((node) => {
    const rect = rects.get(node.id);
    return rect ? (
      <NodeCard
        key={node.id}
        node={node}
        rect={rect}
        expanded={node.id === expandedId}
        selected={selectedIds.has(node.id)}
        status={run?.statusOf(node.id)}
        run={run?.infoOf(node.id)}
        issues={invalid?.get(node.id)}
        sizeRef={props.sizeRef(node.id)}
        edit={edit}
        taken={taken}
        connectTarget={connectTarget === node.id}
        onHandleDown={props.onHandleDown(node)}
      />
    ) : null;
  });
}
