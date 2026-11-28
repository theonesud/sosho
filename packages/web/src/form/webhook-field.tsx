import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/react/alert-dialog";
import { Input, InputGroup } from "@ui-sdk/react/input";
import { toast } from "@ui-sdk/react/toast";
import { useState } from "react";
import { regenerateWebhookToken } from "../api/client";
import type { TriggerWebhook, WorkflowSummary } from "../api/types";
import type { EditApi, TriggerApi } from "../canvas/edit-api";
import { CopyButton } from "../components/copy-button";
import { IconTip } from "../components/icon-tip";
import { Row } from "./trigger-fields";
import { curlCommand, formatNextFire, maskToken, statusPhrase } from "./trigger-info";

const SAVE_WEBHOOK = "Save to create this webhook.";
const SAVE_SCHEDULE = "Save to schedule this trigger.";

async function copySecret(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied curl command");
  } catch {
    toast.error("Copy failed", { description: "The browser blocked clipboard access." });
  }
}

interface DetailsProps {
  readonly workflowId: string;
  readonly hook: TriggerWebhook;
  readonly refresh: () => void;
}

function RegenerateDialog({
  open,
  pending,
  onOpen,
  onConfirm,
}: {
  readonly open: boolean;
  readonly pending: boolean;
  readonly onOpen: (open: boolean) => void;
  readonly onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        if (pending) details.cancel();
        else if (details.returnValue === "confirm") {
          details.cancel();
          onConfirm();
        } else onOpen(false);
      }}
    >
      <AlertDialogBackdrop />
      <AlertDialogContent>
        <div data-slot="stack">
          <AlertDialogTitle>Regenerate token?</AlertDialogTitle>
          <AlertDialogDescription>The old token stops working at once.</AlertDialogDescription>
        </div>
        <div data-slot="row" className="wp-dialog-actions">
          <AlertDialogClose disabled={pending}>Cancel</AlertDialogClose>
          <AlertDialogClose data-variant="danger" value="confirm" disabled={pending}>
            {pending ? "Regenerating" : "Regenerate"}
          </AlertDialogClose>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function WebhookDetails({ workflowId, hook, refresh }: DetailsProps) {
  const [shown, setShown] = useState(false);
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);

  async function regenerate() {
    setPending(true);
    try {
      await regenerateWebhookToken(workflowId, hook.node_id);
      refresh();
      setShown(false);
      setAsking(false);
    } catch (caught) {
      toast.error("Regenerate failed", {
        description: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Row label="Webhook URL" error={undefined}>
        <div className="form-inline">
          <Input aria-label="Webhook URL" className="mono" value={hook.url} readOnly />
          <CopyButton value={hook.url} label="Copy webhook URL" />
          <IconTip
            icon="terminal"
            label="Copy curl command"
            onClick={() => void copySecret(curlCommand(hook.url, hook.token))}
          />
        </div>
      </Row>
      <Row label="Token" error={undefined}>
        <div className="form-inline">
          <InputGroup className="token-group">
            <Input
              aria-label="Webhook token"
              className="mono"
              value={shown ? hook.token : maskToken(hook.token)}
              readOnly
            />
            <IconTip
              icon={shown ? "eyeOff" : "eye"}
              label={shown ? "Hide token" : "Show token"}
              pressed={shown}
              className="token-eye"
              onClick={() => setShown(!shown)}
            />
          </InputGroup>
          <CopyButton value={hook.token} label="Copy webhook token" secret />
          <IconTip icon="keyRotate" label="Regenerate token" onClick={() => setAsking(true)} />
        </div>
      </Row>
      <RegenerateDialog
        open={asking}
        pending={pending}
        onOpen={setAsking}
        onConfirm={() => void regenerate()}
      />
    </>
  );
}

export function WebhookField({
  nodeId,
  edit,
}: {
  readonly nodeId: string;
  readonly edit: EditApi;
}) {
  const { triggers, workflowId } = edit;
  if (triggers.info === null || workflowId === null) return null;
  const hook = triggers.info.webhooks.find((entry) => entry.node_id === nodeId);
  if (hook === undefined) return <p className="muted">{SAVE_WEBHOOK}</p>;
  return <WebhookDetails workflowId={workflowId} hook={hook} refresh={triggers.refresh} />;
}

export function NextRun({ triggers }: { readonly triggers: TriggerApi }) {
  if (triggers.info === null) return null;
  const schedule = triggers.info.schedules[0];
  if (schedule === undefined) return <p className="muted">{SAVE_SCHEDULE}</p>;
  if (schedule.next_fire === null) return null;
  const text = formatNextFire(schedule.next_fire, schedule.timezone);
  if (text === null) return null;
  return (
    <div className="trigger-output">
      <span className="trigger-output-label">Next run</span>
      <span className="mono">{text}</span>
    </div>
  );
}

export function FollowerLine({
  triggers,
  workflows,
}: {
  readonly triggers: TriggerApi;
  readonly workflows: readonly WorkflowSummary[];
}) {
  if (triggers.info === null) return null;
  const follower = triggers.info.followers[0];
  if (follower === undefined) return <p className="muted">{SAVE_SCHEDULE}</p>;
  const source =
    workflows.find((entry) => entry.id === follower.source_workflow_id)?.name ??
    follower.source_workflow_id;
  return (
    <p className="muted">
      Follows {source} when it {statusPhrase(follower.on_status)}.
    </p>
  );
}
