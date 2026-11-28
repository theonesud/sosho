import { Menu, MenuContent, MenuItem } from "@ui-sdk/react/menu";
import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import { isNodeKind } from "../api/guards";
import type { KindEntry, NodeKind } from "../api/types";
import { Icon } from "../components/icon";
import { kindMeta } from "../meta";
import { validTargets } from "./link-rules";

const TRIGGER_TIP = "A workflow has one trigger";

interface OutputHandleProps {
  readonly node: string;
  readonly sourceKind: NodeKind;
  readonly kinds: readonly KindEntry[];
  readonly hasTrigger: boolean;
  readonly onPointerDown: (event: ReactPointerEvent, onClick: () => void) => void;
  readonly onAdd: (kind: string) => void;
}

export function OutputHandle({
  node,
  sourceKind,
  kinds,
  hasTrigger,
  onPointerDown,
  onAdd,
}: OutputHandleProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="cv-handle"
        data-no-pan
        aria-label={`Add a node after ${node}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(event) => onPointerDown(event, () => setOpen(true))}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <Icon name="plus" size={12} />
      </button>
      <Menu open={open} onOpenChange={(next) => setOpen(next)}>
        <MenuContent data-no-pan anchor={button.current} side="right" align="start" sideOffset={8}>
          {validTargets(sourceKind, kinds).map((entry) => (
            <MenuItem
              key={entry.kind}
              value={entry.kind}
              disabled={entry.kind === "trigger" && hasTrigger}
              {...(entry.kind === "trigger" && hasTrigger ? { title: TRIGGER_TIP } : {})}
              onSelect={() => onAdd(entry.kind)}
            >
              <span className="cv-kind-item">
                {isNodeKind(entry.kind) ? (
                  <Icon name={kindMeta[entry.kind].icon} size={14} />
                ) : null}
                {entry.title}
              </span>
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    </>
  );
}
