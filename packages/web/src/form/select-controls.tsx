import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import { NONE } from "./choices";

interface SingleProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly optional: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: string | null) => void;
}

export function SingleSelect({ label, value, options, optional, disabled, onChange }: SingleProps) {
  const known = value === "" || options.includes(value) ? options : [...options, value];
  const current = value === "" ? (optional ? NONE : null) : value;
  return (
    <Select
      value={current}
      disabled={disabled}
      placeholder="Choose"
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next === NONE ? null : next);
      }}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue>
          {current === null ? "Choose" : current === NONE ? "None" : current}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {optional ? <SelectItem value={NONE}>None</SelectItem> : null}
        {known.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface MultiProps {
  readonly label: string;
  readonly value: readonly string[];
  readonly options: readonly string[];
  readonly disabled: boolean;
  readonly onChange: (value: readonly string[]) => void;
}

export function MultiSelect({ label, value, options, disabled, onChange }: MultiProps) {
  const known = [...options, ...value.filter((entry) => !options.includes(entry))];
  return (
    <Select
      multiple
      value={[...value]}
      disabled={disabled}
      placeholder="None"
      onValueChange={(next) => {
        if (Array.isArray(next)) onChange(next.map(String));
      }}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue>{value.length === 0 ? "None" : value.join(", ")}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {known.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
