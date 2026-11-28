import { cssVars } from "../css-vars";
import { SingleSelect } from "../form/select-controls";
import { NumberControl, SwitchControl } from "../form/value-controls";
import type { EdgePatch } from "../state/reducer";
import type { PlacedEdge } from "./edge-layer";

interface EdgePanelProps {
  readonly item: PlacedEdge;
  readonly onPatch: (id: string, patch: EdgePatch) => void;
}

export function EdgePanel({ item, onPatch }: EdgePanelProps) {
  const { edge, id, mid } = item;
  const loop = edge.loop === true;
  return (
    <fieldset
      className="cv-edge-panel"
      data-no-pan
      data-above={item.above ? "" : undefined}
      aria-label="Edge settings"
      style={cssVars({ "--x": `${mid.x}px`, "--y": `${mid.y}px` })}
    >
      <div className="cv-edge-row">
        <span>Loop</span>
        <SwitchControl
          label="Loop"
          checked={loop}
          disabled={false}
          onChange={(next) => onPatch(id, next ? { loop: true } : { loop: false })}
        />
      </div>
      {loop ? (
        <>
          <div className="cv-edge-row">
            <span>Max iterations</span>
            <NumberControl
              label="Max iterations"
              value={edge.max_iterations ?? null}
              integer
              min={1}
              max={50}
              disabled={false}
              onChange={(next) => onPatch(id, { max_iterations: next })}
            />
          </div>
          <div className="cv-edge-row">
            <span>On limit</span>
            <SingleSelect
              label="On limit"
              value={edge.on_limit ?? "exit"}
              options={["exit", "fail"]}
              optional={false}
              disabled={false}
              onChange={(next) => onPatch(id, { on_limit: next === "fail" ? "fail" : "exit" })}
            />
          </div>
        </>
      ) : null}
    </fieldset>
  );
}
