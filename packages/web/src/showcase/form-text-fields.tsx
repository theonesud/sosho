import { Field, FieldDescription, FieldError, FieldLabel } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import { Textarea } from "@ui-sdk/react/textarea";
import {
  TokenInput,
  TokenInputEditor,
  TokenInputToken,
  TokenInputTokenRemove,
} from "@ui-sdk/react/token-input";
import { useState } from "react";

const CRON_FIELDS = 5;

function isCronValid(value: string): boolean {
  return value.trim().split(/\s+/).length === CRON_FIELDS;
}

export function FormTextFields() {
  const [cron, setCron] = useState("0 7 * * *");
  const cronInvalid = !isCronValid(cron);

  return (
    <div className="form-grid">
      <Field name="name">
        <FieldLabel>Workflow name</FieldLabel>
        <Input defaultValue="Daily digest" required />
        <FieldDescription>Shown in lists and in the run view.</FieldDescription>
      </Field>
      <Field name="cron" invalid={cronInvalid}>
        <FieldLabel>Cron schedule</FieldLabel>
        <Input
          className="mono"
          value={cron}
          onValueChange={setCron}
          spellCheck={false}
          autoComplete="off"
        />
        <FieldDescription>Five fields: minute, hour, day, month, weekday.</FieldDescription>
        {cronInvalid ? (
          <FieldError match>Enter exactly five fields, for example 0 7 * * *.</FieldError>
        ) : null}
      </Field>
      <Field name="notes" className="span-2">
        <FieldLabel>Description</FieldLabel>
        <Textarea rows={3} defaultValue="Collects sources each morning." />
      </Field>
      <Field name="prompt" className="span-2">
        <FieldLabel>Prompt with variables</FieldLabel>
        <TokenInput
          defaultValue={[
            "Summarize ",
            { type: "variable", value: "documents", label: "documents" },
            " in plain words.",
          ]}
          renderToken={(token) => (
            <TokenInputToken>
              {token.label}
              <TokenInputTokenRemove />
            </TokenInputToken>
          )}
        >
          <TokenInputEditor />
        </TokenInput>
        <FieldDescription>Tokens stand for values from earlier nodes.</FieldDescription>
      </Field>
    </div>
  );
}
