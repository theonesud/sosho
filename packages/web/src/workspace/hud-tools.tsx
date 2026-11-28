import { Separator } from "@ui-sdk/react/separator";
import { Toggle } from "@ui-sdk/react/toggle";
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from "@ui-sdk/react/tooltip";
import type { EditApi } from "../canvas/edit-api";
import { Icon } from "../components/icon";
import { IconTip } from "../components/icon-tip";
import { Reveal } from "../components/reveal";
import { hudVisibility } from "./hud-visibility";

export interface HudToolsProps {
  readonly runMode: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly edit: EditApi;
  readonly boxTool: boolean;
  readonly onBoxTool: (on: boolean) => void;
}

function BoxToolToggle({
  pressed,
  onChange,
}: {
  readonly pressed: boolean;
  readonly onChange: (on: boolean) => void;
}) {
  return (
    <Tooltip shortcut="shift">
      <TooltipTrigger
        render={
          <Toggle
            data-variant="ghost"
            aria-label="Select tool"
            pressed={pressed}
            onPressedChange={onChange}
          />
        }
      >
        <Icon name="select" />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Select tool: drag a box. Hold Space to pan.
        <TooltipShortcut />
      </TooltipContent>
    </Tooltip>
  );
}

export function HudTools(props: HudToolsProps) {
  const { runMode, edit } = props;
  const show = hudVisibility({
    runMode,
    editable: edit.editable,
    canUndo: props.canUndo,
    canRedo: props.canRedo,
    canPaste: edit.canPaste,
    hasSelection: edit.canDelete,
    selectedCount: edit.selectedCount,
    nodeCount: edit.nodeCount,
  });
  return (
    <>
      <Reveal show={show.history} group>
        <div className="hud-group">
          <Reveal show={show.undo}>
            <IconTip icon="undo" label="Undo" shortcut="mod+z" onClick={props.onUndo} />
          </Reveal>
          <Reveal show={show.redo}>
            <IconTip icon="redo" label="Redo" shortcut="mod+shift+z" onClick={props.onRedo} />
          </Reveal>
        </div>
        <Separator orientation="vertical" />
      </Reveal>
      <Reveal show={show.clipboard} group>
        <div className="hud-group">
          <Reveal show={show.copy}>
            <IconTip icon="copy" label="Copy" shortcut="mod+c" onClick={() => void edit.copy()} />
          </Reveal>
          <Reveal show={show.paste}>
            <IconTip icon="paste" label="Paste" shortcut="mod+v" onClick={edit.paste} />
          </Reveal>
          <Reveal show={show.duplicate}>
            <IconTip icon="duplicate" label="Duplicate" shortcut="mod+d" onClick={edit.duplicate} />
          </Reveal>
          <Reveal show={show.remove}>
            <IconTip
              icon="trash"
              label="Delete selection"
              shortcut="delete"
              onClick={edit.deleteSelected}
            />
          </Reveal>
        </div>
        <Separator orientation="vertical" />
      </Reveal>
      <Reveal show={show.selection} group>
        <div className="hud-group">
          <Reveal show={show.selectAll}>
            <IconTip
              icon="selectAll"
              label="Select all"
              shortcut="mod+a"
              onClick={edit.selectAll}
            />
          </Reveal>
          <BoxToolToggle pressed={props.boxTool} onChange={props.onBoxTool} />
        </div>
        <Separator orientation="vertical" />
      </Reveal>
    </>
  );
}
