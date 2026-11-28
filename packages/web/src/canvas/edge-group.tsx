import type { NodeStatus } from "../run/run-state";
import type { EdgePatch } from "../state/reducer";
import { EdgeLabels } from "./edge-labels";
import { EdgeSvg, type PlacedEdge } from "./edge-layer";
import { EdgePanel } from "./edge-panel";
import type { ConnectDrag } from "./use-connect-drag";

interface EdgeGroupProps {
  readonly placed: readonly PlacedEdge[];
  readonly selectedId: string | null;
  readonly hoveredId: string | null;
  readonly editable: boolean;
  readonly statusOf?: ((nodeId: string) => NodeStatus | undefined) | undefined;
  readonly preview: ConnectDrag | null;
  readonly onPatch: (id: string, patch: EdgePatch) => void;
}

export function EdgeGroup({
  placed,
  selectedId,
  hoveredId,
  editable,
  statusOf,
  preview,
  onPatch,
}: EdgeGroupProps) {
  const selected = placed.find((item) => item.id === selectedId);
  return (
    <>
      <EdgeSvg placed={placed} selectedId={selectedId} preview={preview} statusOf={statusOf} />
      <EdgeLabels
        placed={placed}
        selectedId={selectedId}
        hoveredId={hoveredId}
        editable={editable}
        onPatch={onPatch}
      />
      {selected && editable ? <EdgePanel item={selected} onPatch={onPatch} /> : null}
    </>
  );
}
