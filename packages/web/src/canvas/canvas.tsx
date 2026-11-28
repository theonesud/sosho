import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import type { Edge, Issue, Node } from "../api/types";
import { cssVars } from "../css-vars";
import { type Selection, selectedIds, singleNode } from "../state/selection";
import type { Rect } from "./camera";
import { EdgeGroup } from "./edge-group";
import type { EditApi } from "./edit-api";
import { HelpBox } from "./help-box";
import { NodeLayer } from "./node-layer";
import type { RunApi } from "./run-api";
import type { SelectApi } from "./select-api";
import { useBoxSelect } from "./use-box-select";
import { useCamera } from "./use-camera";
import { useCameraFollow } from "./use-camera-follow";
import { useZoomControls } from "./use-canvas-controls";
import { useCanvasInput } from "./use-canvas-input";
import { useCanvasLayout } from "./use-canvas-layout";
import { useConnectDrag } from "./use-connect-drag";
import { ZoomControls } from "./zoom-controls";

interface CanvasProps {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
  readonly selection: Selection;
  readonly select: SelectApi;
  readonly boxTool: boolean;
  readonly edit: EditApi;
  readonly invalid?: ReadonlyMap<string, readonly Issue[]>;
  readonly run?: RunApi;
}

function SelectionBox({ box }: { readonly box: Rect }) {
  return (
    <div
      className="cv-box"
      aria-hidden="true"
      style={cssVars({
        "--bx": `${box.x}px`,
        "--by": `${box.y}px`,
        "--bw": `${box.width}px`,
        "--bh": `${box.height}px`,
      })}
    />
  );
}

function hoveredEdge(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest("[data-edge-id]")?.getAttribute("data-edge-id") ?? null;
}

function useCanvasWiring({ nodes, edges, selection, select, boxTool, edit }: CanvasProps) {
  const frame = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const { layout, placed, version, sizeRef } = useCanvasLayout(nodes, edges);
  const { moveTo, getView, onPointerDown: camera, wasDragged } = useCamera(frame, world);
  const connecting = useConnectDrag({ frame, getView, onConnect: edit.connect });
  const expandedId = singleNode(selection);
  useCameraFollow({ frame, world, layout, version, expandedId, moveTo, getView });
  const zoom = useZoomControls({ frame, layout, getView, moveTo });
  const boxing = useBoxSelect({
    frame,
    getView,
    rects: layout.rects,
    enabled: edit.editable,
    tool: boxTool,
    onBox: select.many,
  });
  const { onClick, handleDown } = useCanvasInput({
    rects: layout.rects,
    selection,
    select,
    editable: edit.editable,
    wasDragged,
    wasBoxing: boxing.wasBoxing,
    connecting,
  });
  const onPointerDown = (event: ReactPointerEvent) => {
    if (!boxing.onPointerDown(event)) camera(event);
  };
  return {
    frame,
    world,
    layout,
    placed,
    sizeRef,
    onPointerDown,
    connecting,
    zoom,
    onClick,
    handleDown,
    expandedId,
    box: boxing.box,
  };
}

export function Canvas(props: CanvasProps) {
  const { nodes, selection, run, invalid, edit, boxTool } = props;
  const [hovered, setHovered] = useState<string | null>(null);
  const wiring = useCanvasWiring(props);
  const { connecting, layout, zoom } = wiring;
  const selectedEdge = selection.kind === "edge" ? selection.id : null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the frame handles pan and empty clicks
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc and the node buttons give keyboard access
    <div
      className="cv-frame"
      ref={wiring.frame}
      data-tool={edit.editable && boxTool ? "select" : undefined}
      data-boxing={wiring.box ? "" : undefined}
      onPointerDown={wiring.onPointerDown}
      onClick={wiring.onClick}
      onPointerOver={(event) => setHovered(hoveredEdge(event.target))}
    >
      <div className="cv-world" ref={wiring.world}>
        <EdgeGroup
          placed={wiring.placed}
          selectedId={selectedEdge}
          hoveredId={hovered}
          editable={edit.editable}
          preview={connecting.drag}
          statusOf={run?.statusOf}
          onPatch={edit.patchEdge}
        />
        <NodeLayer
          nodes={nodes}
          rects={layout.rects}
          expandedId={wiring.expandedId}
          selectedIds={new Set(selectedIds(selection))}
          connectTarget={connecting.drag?.target ?? null}
          edit={edit}
          invalid={invalid}
          run={run}
          sizeRef={wiring.sizeRef}
          onHandleDown={wiring.handleDown}
        />
      </div>
      {wiring.box ? <SelectionBox box={wiring.box} /> : null}
      <HelpBox runMode={!edit.editable} />
      <ZoomControls onZoomIn={zoom.zoomIn} onZoomOut={zoom.zoomOut} onFit={zoom.fit} />
    </div>
  );
}
