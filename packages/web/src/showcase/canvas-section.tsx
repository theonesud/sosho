import { useState } from "react";
import { GraphCanvas } from "../components/graph-canvas";
import { NodeKindBadge } from "../components/node-kind-badge";
import { RunStatusBadge } from "../components/run-status-badge";
import { workflowEdges, workflowNodes } from "./mock";
import { ShowcaseSection } from "./showcase-section";

export function CanvasSection() {
  const [selectedId, setSelectedId] = useState<string | null>("gate");
  const selected = workflowNodes.find((node) => node.id === selectedId);

  return (
    <ShowcaseSection
      id="canvas"
      title="Editor"
      description="Dagre lays out the nodes from left to right. Drag to pan and scroll to zoom."
    >
      <GraphCanvas
        nodes={workflowNodes}
        edges={workflowEdges}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <div className="card selection-panel" aria-live="polite">
        {selected ? (
          <>
            <strong>{selected.name}</strong>
            <NodeKindBadge kind={selected.kind} />
            <RunStatusBadge status={selected.status} />
          </>
        ) : (
          <span className="muted">Select a node to see its details.</span>
        )}
      </div>
    </ShowcaseSection>
  );
}
