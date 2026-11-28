import { Button } from "@ui-sdk/react/button";
import { useState } from "react";
import type { WorkflowSummary } from "../api/types";
import type { FetchState } from "../api/use-fetch";
import { Callout } from "../components/callout";
import { EmptyState } from "../components/empty-state";
import { type GroupActions, WorkflowGroup } from "./workflow-group";

export interface WorkflowTreeProps extends GroupActions {
  readonly list: FetchState<readonly WorkflowSummary[]>;
  readonly activeId: string | null;
  readonly openedVersion: number | null;
  readonly onRetry: () => void;
}

function Skeletons() {
  return (
    <ul className="nav-list" aria-label="Loading workflows">
      {[0, 1, 2, 3].map((row) => (
        <li key={row} className="wp-row">
          <span className="skeleton" data-width="2" />
        </li>
      ))}
    </ul>
  );
}

export function WorkflowTree(props: WorkflowTreeProps) {
  const { list, activeId, openedVersion, onRetry } = props;
  const [renaming, setRenaming] = useState<string | null>(null);
  if (list.status === "error" && list.data === null) {
    return (
      <div className="stack-tight">
        <Callout tone="danger" title="Could not load workflows">
          {list.error.message}
        </Callout>
        <Button data-variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (list.data === null) return <Skeletons />;
  if (list.data.length === 0) {
    return (
      <EmptyState icon="workflow" title="No workflows">
        Use New to create the first workflow.
      </EmptyState>
    );
  }
  return (
    <ul className="wp-groups" aria-label="Workflows">
      {list.data.map((item) => (
        <WorkflowGroup
          key={item.id}
          item={item}
          activeId={activeId}
          openedVersion={openedVersion}
          renaming={renaming === item.id}
          onRenameStart={setRenaming}
          busy={props.busy}
          onDuplicate={props.onDuplicate}
          onRename={props.onRename}
          onDelete={props.onDelete}
        />
      ))}
    </ul>
  );
}
