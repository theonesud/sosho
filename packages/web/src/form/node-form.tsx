import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/react/collapsible";
import { FieldLabel, Field as UiField } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import { useMemo, useState } from "react";
import type { Catalog, JsonObject, Node } from "../api/types";
import { Icon } from "../components/icon";
import { FieldList, type FormEnv } from "./schema-form";
import { fieldsFromSchema, groupFields } from "./schema-model";
import { useDraft } from "./use-draft";

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

interface IdFieldProps {
  readonly id: string;
  readonly taken: ReadonlySet<string>;
  readonly disabled: boolean;
  readonly onRename: (id: string) => void;
}

function IdField({ id, taken, disabled, onRename }: IdFieldProps) {
  const [text, setText] = useState(id);
  const [error, setError] = useState<string | null>(null);

  function commit() {
    if (text === id) return setError(null);
    if (!ID_PATTERN.test(text))
      return setError("Start with a letter. Use letters, digits, - or _.");
    if (taken.has(text)) return setError("Another node uses this id.");
    setError(null);
    onRename(text);
  }

  return (
    <UiField invalid={error !== null}>
      <FieldLabel>Id</FieldLabel>
      <Input
        aria-label="Node id"
        className="mono"
        value={text}
        disabled={disabled}
        spellCheck={false}
        onValueChange={setText}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      {error === null ? null : <span className="form-error">{error}</span>}
    </UiField>
  );
}

interface NodeFormProps {
  readonly node: Node;
  readonly schema: JsonObject;
  readonly catalog: Catalog | null;
  readonly taken: ReadonlySet<string>;
  readonly disabled: boolean;
  readonly onChange: (node: Node) => void;
}

export function NodeForm({ node, schema, catalog, taken, disabled, onChange }: NodeFormProps) {
  const { draft, change, flush } = useDraft(node, onChange);
  const groups = useMemo(() => groupFields(fieldsFromSchema(schema)), [schema]);
  const env: FormEnv = { catalog, disabled };
  const idText = typeof draft.id === "string" ? draft.id : node.id;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: blur flushes the pending edit
    <div className="form" onBlur={flush}>
      <IdField
        key={idText}
        id={idText}
        taken={taken}
        disabled={disabled}
        onRename={(id) => change({ ...draft, id }, true)}
      />
      <FieldList fields={groups.main} value={draft} env={env} onChange={(next) => change(next)} />
      {groups.advanced.length === 0 ? null : (
        <Collapsible className="form-advanced">
          <CollapsibleTrigger>
            <span>Advanced</span>
            <Icon name="chevronRight" size={14} />
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <FieldList
              fields={groups.advanced}
              value={draft}
              env={env}
              onChange={(next) => change(next)}
            />
          </CollapsiblePanel>
        </Collapsible>
      )}
    </div>
  );
}
