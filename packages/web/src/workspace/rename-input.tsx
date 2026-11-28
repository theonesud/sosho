import { Button } from "@ui-sdk/react/button";
import { Input } from "@ui-sdk/react/input";
import { useState } from "react";
import { Icon } from "../components/icon";
import { MAX_NAME } from "../state/workflow-ops";

interface RenameInputProps {
  readonly name: string;
  readonly onRename: (name: string) => Promise<string | null>;
  readonly onClose: () => void;
}

export function RenameInput({ name, onRename, onClose }: RenameInputProps) {
  const [draft, setDraft] = useState(name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    const next = draft.trim();
    if (pending) return;
    if (next === "" || next === name) {
      onClose();
      return;
    }
    setPending(true);
    setError(null);
    const failure = await onRename(next);
    if (failure === null) {
      onClose();
      return;
    }
    setPending(false);
    setError(failure);
  }

  return (
    <div className="wp-rename">
      <Input
        className="wp-rename-input"
        aria-label={`Rename ${name}`}
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
            onClose();
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
        <p className="wp-rename-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
