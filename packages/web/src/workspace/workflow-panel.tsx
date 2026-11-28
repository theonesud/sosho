import { Button } from "@ui-sdk/react/button";
import { useState } from "react";
import { Icon } from "../components/icon";
import { IconTip } from "../components/icon-tip";
import { isMuted, setMuted } from "../waiting/chime";
import { DeleteDialog } from "./delete-dialog";
import { useDeleteFlow } from "./delete-flow";
import { PanelRail } from "./panel-rail";
import { PanelTabs, type PanelTabsProps } from "./panel-tabs";

interface WorkflowPanelProps extends Omit<PanelTabsProps, "onDelete"> {
  readonly collapsed: boolean;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  readonly onRemove: (id: string, name: string) => Promise<string | null>;
}

function SoundToggle() {
  const [muted, setMutedState] = useState(isMuted);
  const label = muted ? "Sound off" : "Sound on";
  return (
    <div className="wp-footer">
      <Button
        data-variant="ghost"
        aria-pressed={muted}
        onClick={() => {
          setMuted(!muted);
          setMutedState(!muted);
        }}
      >
        <Icon name={muted ? "mute" : "volume"} />
        {label}
      </Button>
    </div>
  );
}

export function WorkflowPanel(props: WorkflowPanelProps) {
  const { busy, onNew, list, runList, waitingCount, collapsed, onCollapsedChange } = props;
  const flow = useDeleteFlow(props.onRemove);
  return (
    <aside
      className="workspace-panel"
      aria-label="Workflows and runs"
      data-collapsed={collapsed ? "" : undefined}
    >
      <PanelRail waitingCount={waitingCount} onExpand={() => onCollapsedChange(false)} />
      <div className="wp-full" inert={collapsed}>
        <div className="wp-top">
          <a className="brand" href="/">
            <span className="brand-mark" aria-hidden="true" />
            Sosho
          </a>
          <IconTip
            icon="chevronLeft"
            label="Collapse panel"
            side="right"
            onClick={() => onCollapsedChange(true)}
          />
        </div>
        <PanelTabs
          list={list}
          activeId={props.activeId}
          openedVersion={props.openedVersion}
          busy={busy}
          onRetry={props.onRetry}
          onDuplicate={props.onDuplicate}
          onRename={props.onRename}
          onDelete={flow.ask}
          onNew={onNew}
          waitingCount={waitingCount}
          runList={runList}
          activeRunId={props.activeRunId}
        />
        <SoundToggle />
      </div>
      <DeleteDialog
        name={flow.target?.name ?? null}
        error={flow.error}
        pending={flow.pending}
        onCancel={flow.cancel}
        onConfirm={() => void flow.confirm()}
      />
    </aside>
  );
}
