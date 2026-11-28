import { Button } from "@ui-sdk/react/button";
import { FieldDescription, FieldLabel, Field as UiField } from "@ui-sdk/react/field";
import { isJsonObject } from "../api/guards";
import type { Catalog, JsonObject, JsonValue } from "../api/types";
import { Icon } from "../components/icon";
import { choicesFor, cronHint } from "./choices";
import type { Field } from "./field-types";
import { fieldValue, seedValue, setKey } from "./field-value";
import { MultiSelect, SingleSelect } from "./select-controls";
import { JsonControl, NumberControl, SwitchControl, TextControl } from "./value-controls";

export interface FormEnv {
  readonly catalog: Catalog | null;
  readonly disabled: boolean;
}

interface FieldViewProps {
  readonly field: Field;
  readonly value: JsonValue | undefined;
  readonly env: FormEnv;
  readonly onChange: (value: JsonValue | undefined) => void;
}

const asText = (value: JsonValue | undefined): string => (typeof value === "string" ? value : "");
const asStrings = (value: JsonValue | undefined): readonly string[] =>
  Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];

function StringControl({ field, value, env, onChange }: FieldViewProps) {
  if (field.type !== "string" && field.type !== "enum") return null;
  const choices = choicesFor(field.key, env.catalog);
  const options = choices ?? (field.type === "enum" ? field.options : null);
  if (options) {
    return (
      <SingleSelect
        label={field.label}
        value={asText(value)}
        options={options}
        optional={!field.required}
        disabled={env.disabled}
        onChange={onChange}
      />
    );
  }
  return (
    <TextControl
      label={field.label}
      value={asText(value)}
      multiline={field.type === "string" && field.multiline}
      mono={field.key === "cron"}
      disabled={env.disabled}
      onChange={onChange}
    />
  );
}

function Control(props: FieldViewProps) {
  const { field, value, env, onChange } = props;
  const { disabled } = env;
  switch (field.type) {
    case "string":
    case "enum":
      return <StringControl {...props} />;
    case "number":
      return (
        <NumberControl
          label={field.label}
          value={typeof value === "number" ? value : null}
          integer={field.integer}
          min={field.min}
          max={field.max}
          disabled={disabled}
          onChange={(next) => onChange(next ?? (field.required ? (field.min ?? 0) : undefined))}
        />
      );
    case "boolean":
      return (
        <SwitchControl
          label={field.label}
          checked={value === true}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case "json":
      return (
        <JsonControl label={field.label} value={value} disabled={disabled} onChange={onChange} />
      );
    case "array":
      return <ArrayControl {...props} />;
    case "object":
      return (
        <FieldList
          fields={field.fields}
          value={isJsonObject(value) ? value : {}}
          env={env}
          onChange={onChange}
        />
      );
    case "const":
      return null;
  }
}

function ArrayControl({ field, value, env, onChange }: FieldViewProps) {
  if (field.type !== "array") return null;
  const { item } = field;
  const choices =
    choicesFor(field.key, env.catalog) ?? (item.type === "enum" ? item.options : null);
  if (choices && item.type !== "object") {
    return (
      <MultiSelect
        label={field.label}
        value={asStrings(value)}
        options={choices}
        disabled={env.disabled}
        onChange={onChange}
      />
    );
  }
  const items: readonly JsonValue[] = Array.isArray(value) ? value : [];
  return (
    <div className="form-list">
      {items.map((entry, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: list items have no id
        <div className="form-list-item" key={index}>
          <FieldView
            field={{ ...item, label: `${field.label} ${index + 1}` }}
            value={entry}
            env={env}
            onChange={(next) =>
              onChange(items.map((old, at) => (at === index ? (next ?? null) : old)))
            }
          />
          <Button
            data-variant="ghost"
            aria-label={`Remove ${field.label} ${index + 1}`}
            disabled={env.disabled}
            onClick={() => onChange(items.filter((_, at) => at !== index))}
          >
            <Icon name="x" />
          </Button>
        </div>
      ))}
      <Button
        data-variant="secondary"
        disabled={env.disabled}
        onClick={() => onChange([...items, seedValue({ ...item, required: true }) ?? null])}
      >
        <Icon name="plus" />
        Add {field.label.toLowerCase()}
      </Button>
    </div>
  );
}

export function FieldView(props: FieldViewProps) {
  const { field } = props;
  if (field.type === "const") return null;
  const hint = field.key === "cron" ? cronHint(asText(props.value)) : field.description;
  const grouped = field.type === "object" || field.type === "array";
  if (field.type === "boolean") {
    return (
      <UiField className="form-row">
        <FieldLabel>{field.label}</FieldLabel>
        <Control {...props} />
        {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      </UiField>
    );
  }
  return (
    <UiField className={grouped ? "form-group" : ""}>
      <FieldLabel>{field.label}</FieldLabel>
      <Control {...props} />
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </UiField>
  );
}

interface FieldListProps {
  readonly fields: readonly Field[];
  readonly value: JsonObject;
  readonly env: FormEnv;
  readonly onChange: (value: JsonObject) => void;
}

export function FieldList({ fields, value, env, onChange }: FieldListProps) {
  return (
    <div className="form-fields">
      {fields.map((field) => (
        <FieldView
          key={field.key}
          field={field}
          value={fieldValue(field, value)}
          env={env}
          onChange={(next) => onChange(setKey(value, field, next))}
        />
      ))}
    </div>
  );
}
