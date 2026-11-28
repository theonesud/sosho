import { Button } from "@ui-sdk/react/button";
import type { NodeKind, RunStatus } from "../types";
import { Icon } from "./icon";
import { NodeKindBadge } from "./node-kind-badge";
import { RunStatusBadge } from "./run-status-badge";

interface WorkflowCardProps {
  readonly name: string;
  readonly description: string;
  readonly version: number;
  readonly nodeCount: number;
  readonly kinds: readonly NodeKind[];
  readonly lastRun: { readonly status: RunStatus; readonly when: string };
}

export function WorkflowCard({
  name,
  description,
  version,
  nodeCount,
  kinds,
  lastRun,
}: WorkflowCardProps) {
  return (
    <article className="card workflow-card">
      <header className="workflow-card-head">
        <h4>{name}</h4>
        <span className="mono muted">v{version}</span>
      </header>
      <p className="muted">{description}</p>
      <div className="badge-row">
        {kinds.map((kind) => (
          <NodeKindBadge key={kind} kind={kind} />
        ))}
      </div>
      <footer className="workflow-card-foot">
        <div className="stack-tight">
          <RunStatusBadge status={lastRun.status} />
          <span className="muted">
            {nodeCount} nodes, last run {lastRun.when}
          </span>
        </div>
        <Button data-variant="secondary" aria-label={`Open ${name}`}>
          <Icon name="chevronRight" />
        </Button>
      </footer>
    </article>
  );
}
