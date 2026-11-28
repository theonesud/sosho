import { Input } from "@ui-sdk/react/input";
import {
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputGroup,
  NumberInputIncrement,
} from "@ui-sdk/react/number-input";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import { Textarea } from "@ui-sdk/react/textarea";
import { useEffect, useState } from "react";
import { isJsonValue } from "../api/guards";
import type { JsonValue } from "../api/types";

interface TextProps {
  readonly label: string;
  readonly value: string;
  readonly multiline: boolean;
  readonly disabled: boolean;
  readonly mono?: boolean;
  readonly onChange: (value: string) => void;
}

export function TextControl({ label, value, multiline, disabled, mono, onChange }: TextProps) {
  const common = {
    "aria-label": label,
    value,
    disabled,
    spellCheck: false,
    onValueChange: (next: string) => onChange(next),
  };
  const className = mono ? "mono" : "";
  return multiline ? (
    <Textarea {...common} rows={4} autoResize className={className} />
  ) : (
    <Input {...common} autoComplete="off" className={className} />
  );
}

interface NumberProps {
  readonly label: string;
  readonly value: number | null;
  readonly integer: boolean;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: number | null) => void;
}

export function NumberControl({
  label,
  value,
  integer,
  min,
  max,
  disabled,
  onChange,
}: NumberProps) {
  return (
    <NumberInput
      value={value}
      disabled={disabled}
      step={integer ? 1 : 0.1}
      largeStep={integer ? 10 : 1}
      {...(min !== undefined ? { min } : {})}
      {...(max !== undefined ? { max } : {})}
      onValueChange={(next) => onChange(next)}
    >
      <NumberInputGroup>
        <NumberInputDecrement aria-label={`Decrease ${label}`} />
        <NumberInputControl aria-label={label} />
        <NumberInputIncrement aria-label={`Increase ${label}`} />
      </NumberInputGroup>
    </NumberInput>
  );
}

interface SwitchProps {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}

export function SwitchControl({ label, checked, disabled, onChange }: SwitchProps) {
  return (
    <Switch
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => onChange(next)}
    >
      <SwitchThumb />
    </Switch>
  );
}

interface JsonProps {
  readonly label: string;
  readonly value: JsonValue | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: JsonValue) => void;
}

const stringify = (value: JsonValue | undefined): string =>
  value === undefined || value === null ? "" : JSON.stringify(value, null, 2);

export function JsonControl({ label, value, disabled, onChange }: JsonProps) {
  const [text, setText] = useState(() => stringify(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText((current) => {
      try {
        const parsed: unknown = current.trim() === "" ? null : JSON.parse(current);
        return stringify(isJsonValue(parsed) ? parsed : undefined) === stringify(value)
          ? current
          : stringify(value);
      } catch {
        return current;
      }
    });
  }, [value]);

  function edit(next: string) {
    setText(next);
    try {
      const parsed: unknown = next.trim() === "" ? null : JSON.parse(next);
      if (!isJsonValue(parsed)) throw new Error("Not JSON");
      setError(null);
      onChange(parsed);
    } catch {
      setError("Enter valid JSON.");
    }
  }

  return (
    <>
      <TextControl label={label} value={text} multiline disabled={disabled} mono onChange={edit} />
      {error === null ? null : <span className="form-error">{error}</span>}
    </>
  );
}
