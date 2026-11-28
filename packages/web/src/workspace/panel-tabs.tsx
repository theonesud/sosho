import { Button } from "@ui-sdk/react/button";
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { useMemo, useState } from "react";
import { Icon } from "../components/icon";
import { waitingLabel } from "../waiting/waiting";
import { type RunListModel, RunsTab } from "./runs-tab";
import { WorkflowTree, type WorkflowTreeProps } from "./workflow-tree";

export interface PanelTabsProps extends WorkflowTreeProps {
  readonly waitingCount: number;
  readonly runList: RunListModel;
  readonly activeRunId: string | null;
  readonly onNew: () => void;
}

export function PanelTabs(props: PanelTabsProps) {
  const { busy, onNew, list, runList, waitingCount } = props;
  const [tab, setTab] = useState<string | null>("workflows");
  const names = useMemo(
    () => new Map((list.data ?? []).map((item) => [item.id, item.name])),
    [list.data],
  );
  const { refetch } = runList;
  return (
    <Tabs
      className="wp-tabs"
      value={tab}
      onValueChange={(value) => {
        setTab(value);
        if (value === "runs") refetch();
      }}
    >
      <TabsList aria-label="Left panel">
        <TabsTab value="workflows">Workflows</TabsTab>
        <TabsTab value="runs">
          Runs
          {waitingCount > 0 ? (
            <span
              className="badge wp-count"
              data-status="waiting"
              role="status"
              aria-label={waitingLabel(waitingCount)}
              title={waitingLabel(waitingCount)}
            >
              {waitingCount}
            </span>
          ) : null}
        </TabsTab>
        <TabsIndicator />
      </TabsList>
      <TabsPanel value="workflows" className="wp-pane">
        <div className="wp-head">
          <Button data-variant="primary" onClick={onNew} disabled={busy}>
            <Icon name="plus" />
            New
          </Button>
        </div>
        <div className="wp-list">
          <WorkflowTree {...props} />
        </div>
      </TabsPanel>
      <TabsPanel value="runs" className="wp-pane">
        <div className="wp-list">
          <RunsTab model={runList} names={names} activeRunId={props.activeRunId} />
        </div>
      </TabsPanel>
    </Tabs>
  );
}
