import type { JsonObject, Node, PendingHuman } from "../api/types";
import { Callout } from "../components/callout";
import { JsonViewer } from "../components/json-viewer";
import { HumanPanel, type ReplyFn } from "./human-panel";
import { NodeStatusBadge } from "./node-status";
import type { NodeStatus, NodeStep } from "./run-state";

export interface RunNodeInfo {
  readonly status: NodeStatus | undefined;
  readonly step: NodeStep | null;
  readonly failure: string | null;
  readonly pending: PendingHuman | null;
  readonly input: JsonObject | null;
  readonly onReply: ReplyFn;
}

const clock = (ms: number | null): string =>
  ms === null ? "-" : new Date(ms).toLocaleTimeString(undefined, { hour12: false });

interface RunNodeBodyProps {
  readonly node: Node;
  readonly info: RunNodeInfo;
}

function Times({ step }: { readonly step: NodeStep | null }) {
  if (step === null) return null;
  return (
    <dl className="run-times mono muted">
      <dt>Start</dt>
      <dd>{clock(step.startedAt)}</dd>
      <dt>End</dt>
      <dd>{clock(step.completedAt)}</dd>
    </dl>
  );
}

function TriggerInput({ input }: { readonly input: JsonObject | null }) {
  return (
    <div className="stack-tight">
      {input === null ? null : <JsonViewer value={input} label="Run input" />}
      <p className="muted">
        The engine does not store node input. This is the run input sent from this browser.
      </p>
    </div>
  );
}

export function RunNodeBody({ node, info }: RunNodeBodyProps) {
  const { status, step, failure, pending, input, onReply } = info;
  const error = failure ?? (status === "failed" ? "The node failed." : null);
  return (
    <div className="run-body stack-tight">
      <div className="run-head">
        {status ? (
          <NodeStatusBadge status={status} />
        ) : (
          <span className="muted">No status yet</span>
        )}
        <Times step={step} />
      </div>
      {pending ? <HumanPanel key={pending.run_id} pending={pending} onReply={onReply} /> : null}
      {node.kind === "trigger" ? <TriggerInput input={input} /> : null}
      {error !== null ? (
        <Callout tone="danger" title="Error">
          {error}
        </Callout>
      ) : null}
      {step?.output !== undefined ? (
        <JsonViewer value={step.output} label={`${node.id} output`} />
      ) : null}
    </div>
  );
}
