import { Button } from "@ui-sdk/react/button";
import { Input } from "@ui-sdk/react/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import { useState } from "react";
import { Icon } from "../components/icon";
import { MAX_NAME } from "../state/workflow-ops";

interface NameFieldProps {
  readonly name: string;
  readonly disabled: boolean;
  readonly onRename: (name: string) => Promise<string | null>;
}

export function NameField({ name, disabled, onRename }: NameFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setError(null);
  }
  async function commit() {
    const next = draft.trim();
    if (pending) return;
    if (next === "" || next === name) {
      cancel();
      return;
    }
    setPending(true);
    setError(null);
    const failure = await onRename(next);
    setPending(false);
    if (failure === null) setEditing(false);
    else setError(failure);
  }

  if (!editing) {
    return (
      <div className="hud-name" data-disabled={disabled ? "" : undefined}>
        <Tooltip>
          <TooltipTrigger
            render={
              <button type="button" className="hud-name-view" disabled={disabled} onClick={open} />
            }
          >
            <span className="hud-name-text">{name}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom">{name}</TooltipContent>
        </Tooltip>
        {disabled ? null : (
          <button type="button" className="hud-name-pencil" aria-label="Edit name" onClick={open}>
            <Icon name="pencil" size={14} />
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="hud-name" data-editing="">
      <Input
        className="hud-name-input"
        aria-label="Workflow name"
        value={draft}
        maxLength={MAX_NAME}
        disabled={pending}
        autoFocus
        aria-invalid={error !== null}
        onValueChange={(value) => setDraft(value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
          if (event.key === "Escape") {
            event.stopPropagation();
            cancel();
          }
        }}
      />
      <Button
        data-variant="primary"
        aria-label="Save name"
        disabled={pending}
        onClick={() => void commit()}
      >
        {pending ? <span className="spinner" aria-hidden="true" /> : <Icon name="tick" />}
      </Button>
      {error === null ? null : (
        <p className="hud-name-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
