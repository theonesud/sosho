import { Button } from "@ui-sdk/react/button";
import { useState } from "react";
import type { HumanAction, JsonValue, PendingHuman } from "../api/types";
import { Callout } from "../components/callout";
import { TextControl } from "../form/value-controls";

export type ReplyFn = (
  pending: PendingHuman,
  action: HumanAction,
  value?: JsonValue,
) => Promise<string | null>;

const LABELS: Readonly<Record<string, string>> = {
  approve: "Approve",
  reject: "Reject",
  input: "Provide input",
  edit: "Edit",
};
const NEEDS_VALUE: ReadonlySet<string> = new Set(["input", "edit"]);

const actionOf = (value: string): HumanAction | null =>
  value === "approve" || value === "reject" || value === "input" || value === "edit" ? value : null;

interface HumanPanelProps {
  readonly pending: PendingHuman;
  readonly onReply: ReplyFn;
}

export function HumanPanel({ pending, onReply }: HumanPanelProps) {
  const [choice, setChoice] = useState<HumanAction | null>(null);
  const [text, setText] = useState(pending.show ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: HumanAction, value?: JsonValue) {
    setBusy(true);
    setError(null);
    const failure = await onReply(pending, action, value);
    setError(failure);
    setBusy(false);
  }

  function pick(action: HumanAction) {
    if (!NEEDS_VALUE.has(action)) return void send(action);
    setChoice(action);
    setText(action === "edit" ? (pending.show ?? "") : "");
  }

  return (
    <div className="human-panel stack-tight" data-no-pan>
      <p className="human-prompt">{pending.prompt}</p>
      {pending.show ? <pre className="human-show mono">{pending.show}</pre> : null}
      <div className="human-actions">
        {pending.actions.map((name) => {
          const action = actionOf(name);
          if (action === null) return null;
          return (
            <Button
              key={name}
              data-variant={action === "approve" ? "primary" : "secondary"}
              disabled={busy}
              aria-pressed={choice === action ? true : undefined}
              onClick={() => pick(action)}
            >
              {LABELS[action]}
            </Button>
          );
        })}
      </div>
      {choice !== null ? (
        <div className="stack-tight">
          <TextControl
            label={choice === "edit" ? "Edited value" : "Input value"}
            value={text}
            multiline
            disabled={busy}
            onChange={setText}
          />
          <div className="human-actions">
            <Button data-variant="primary" disabled={busy} onClick={() => void send(choice, text)}>
              Send {choice === "edit" ? "edit" : "input"}
            </Button>
            <Button data-variant="ghost" disabled={busy} onClick={() => setChoice(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {error !== null ? (
        <Callout tone="danger" title="Reply refused">
          {error}
        </Callout>
      ) : null}
    </div>
  );
}
