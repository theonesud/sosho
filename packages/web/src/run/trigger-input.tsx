import { FieldDescription, FieldError, FieldLabel, Field as UiField } from "@ui-sdk/react/field";
import { TextControl } from "../form/value-controls";
import { parseRunInput } from "./run-input";

export interface RunInputApi {
  readonly text: string;
  readonly onChange: (text: string) => void;
}

interface TriggerRunInputProps {
  readonly input: RunInputApi;
  readonly note: string;
}

export function TriggerRunInput({ input, note }: TriggerRunInputProps) {
  const parsed = parseRunInput(input.text);
  return (
    <UiField {...(parsed.ok ? {} : { invalid: true })} data-no-pan>
      <FieldLabel>Test input</FieldLabel>
      <TextControl
        label="Test input JSON"
        value={input.text}
        multiline
        mono
        disabled={false}
        onChange={input.onChange}
      />
      <FieldDescription>{note}</FieldDescription>
      {parsed.ok ? null : <FieldError match>{parsed.message}</FieldError>}
    </UiField>
  );
}
