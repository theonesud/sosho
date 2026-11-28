import { Button } from "@ui-sdk/react/button";
import { Field, FieldDescription, FieldLabel } from "@ui-sdk/react/field";
import { Textarea } from "@ui-sdk/react/textarea";
import { toast } from "@ui-sdk/react/toast";
import type { RunStatus } from "../types";
import { Icon } from "./icon";
import { RunStatusBadge } from "./run-status-badge";

interface InboxRequestCardProps {
  readonly workflow: string;
  readonly node: string;
  readonly prompt: string;
  readonly waitingSince: string;
  readonly decision: Decision | null;
  readonly onDecide: (decision: Decision) => void;
}

export type Decision = "approved" | "rejected";

const decisionStatus: Record<Decision, RunStatus> = {
  approved: "succeeded",
  rejected: "cancelled",
};

export function InboxRequestCard({
  workflow,
  node,
  prompt,
  waitingSince,
  decision,
  onDecide,
}: InboxRequestCardProps) {
  return (
    <form
      className="card inbox-card"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <header className="inbox-head">
        <div className="stack-tight">
          <h4>{node}</h4>
          <span className="muted">
            {workflow}, waiting since {waitingSince}
          </span>
        </div>
        <RunStatusBadge status={decision ? decisionStatus[decision] : "waiting"} />
      </header>
      <blockquote className="inbox-prompt">{prompt}</blockquote>
      <Field name="comment">
        <FieldLabel>Comment</FieldLabel>
        <Textarea placeholder="Optional note for the run log" rows={3} />
        <FieldDescription>The workflow receives this note with your decision.</FieldDescription>
      </Field>
      <div className="inbox-actions" data-resolved={decision ? "" : undefined}>
        <Button
          type="button"
          data-variant="danger"
          disabled={decision !== null}
          onClick={() => {
            onDecide("rejected");
            toast.warning("Rejected", { description: "The run takes the reject path." });
          }}
        >
          <Icon name="x" />
          Reject
        </Button>
        <Button
          type="button"
          data-variant="primary"
          disabled={decision !== null}
          onClick={() => {
            onDecide("approved");
            toast.success("Approved", { description: "The run resumes." });
          }}
        >
          <Icon name="check" />
          Approve
        </Button>
      </div>
    </form>
  );
}
