import { Input } from "@ui-sdk/react/input";
import { useState } from "react";
import type { Edge } from "../api/types";
import { cssVars } from "../css-vars";
import type { EdgePatch } from "../state/reducer";
import type { PlacedEdge } from "./edge-layer";
import { hasLabel } from "./layout";

interface EdgeLabelsProps {
  readonly placed: readonly PlacedEdge[];
  readonly selectedId: string | null;
  readonly hoveredId: string | null;
  readonly editable: boolean;
  readonly onPatch: (id: string, patch: EdgePatch) => void;
}

function labelText(edge: Edge): string {
  return edge.when ? edge.when : "loop";
}

interface LabelProps {
  readonly item: PlacedEdge;
  readonly selected: boolean;
  readonly visible: boolean;
  readonly editable: boolean;
  readonly onWhen: (when: string) => void;
}

function EdgeLabel({ item, selected, visible, editable, onWhen }: LabelProps) {
  const { edge, id, mid } = item;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const labelled = hasLabel(edge);
  const position = cssVars({ "--x": `${mid.x}px`, "--y": `${mid.y}px` });

  function open() {
    setText(edge.when ?? "");
    setEditing(true);
  }
  function commit() {
    setEditing(false);
    if (text.trim() !== (edge.when ?? "")) onWhen(text.trim());
  }

  if (editing) {
    return (
      <Input
        className="cv-edge-input mono"
        aria-label="Edge condition"
        placeholder="Condition"
        autoFocus
        spellCheck={false}
        value={text}
        style={position}
        data-edge-id={id}
        onValueChange={setText}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            event.stopPropagation();
            setEditing(false);
          }
        }}
      />
    );
  }
  if (!labelled && !(editable && visible)) return null;
  return (
    <button
      type="button"
      className="cv-edge-label"
      data-ghost={labelled ? undefined : ""}
      data-edge-id={id}
      data-selected={selected ? "" : undefined}
      style={position}
      onClick={editable ? open : undefined}
    >
      {labelled ? labelText(edge) : "+ condition"}
    </button>
  );
}

export function EdgeLabels({ placed, selectedId, hoveredId, editable, onPatch }: EdgeLabelsProps) {
  return placed.map((item) => (
    <EdgeLabel
      key={item.id}
      item={item}
      selected={item.id === selectedId}
      visible={item.id === selectedId || item.id === hoveredId}
      editable={editable}
      onWhen={(when) => onPatch(item.id, { when: when === "" ? null : when })}
    />
  ));
}
