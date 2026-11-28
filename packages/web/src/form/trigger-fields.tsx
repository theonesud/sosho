import { Button } from "@ui-sdk/react/button";
import { FieldDescription, FieldError, FieldLabel, Field as UiField } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import { toast } from "@ui-sdk/react/toast";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowSummary } from "../api/types";
import { cronFromEngine, cronPreview, cronToEngine } from "./cron-text";
import { createTypeaheadBuffer, matchZone } from "./zone-match";

interface RowProps {
  readonly label: string;
  readonly required?: boolean;
  readonly error: string | undefined;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
}

export function Row({ label, required, error, hint, children }: RowProps) {
  return (
    <UiField {...(error === undefined ? {} : { invalid: true })}>
      <FieldLabel>
        {label}
        {required ? " *" : ""}
      </FieldLabel>
      {children}
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      {error === undefined ? null : <FieldError match>{error}</FieldError>}
    </UiField>
  );
}

interface ChoiceProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly disabled: boolean;
  readonly onChange: (value: T) => void;
}

export function Segmented<T extends string>(props: ChoiceProps<T>) {
  const { label, value, options, disabled, onChange } = props;
  return (
    <SegmentedControl
      aria-label={label}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const chosen = options.find((entry) => entry.value === next);
        if (chosen) onChange(chosen.value);
      }}
    >
      <SegmentedControlIndicator />
      {options.map((entry) => (
        <SegmentedControlItem key={entry.value} value={entry.value}>
          {entry.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

interface CronProps {
  readonly value: string;
  readonly zone: string;
  readonly disabled: boolean;
  readonly error: string | undefined;
  readonly onChange: (engine: string) => void;
}

export function CronField({ value, zone, disabled, error, onChange }: CronProps) {
  const [text, setText] = useState(() => cronFromEngine(value).text);
  useEffect(() => {
    setText((current) => (cronToEngine(current) === value ? current : cronFromEngine(value).text));
  }, [value]);
  const seconds = cronFromEngine(value).seconds;
  const preview = cronPreview(text, zone);
  const hint = (
    <>
      {seconds ? "Six fields: second, minute, hour, day, month, weekday. " : null}
      {preview ?? "Five fields: minute, hour, day, month, weekday."}
    </>
  );
  return (
    <Row label="Cron" required error={error} hint={hint}>
      <Input
        aria-label="Cron"
        className="mono"
        value={text}
        disabled={disabled}
        placeholder="0 9 * * *"
        spellCheck={false}
        autoComplete="off"
        onValueChange={(next) => {
          setText(next);
          onChange(cronToEngine(next));
        }}
      />
    </Row>
  );
}

interface ZoneOption {
  readonly value: string;
  readonly label: string;
}

function offsetLabel(zone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    const raw = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    return raw === "GMT" ? "UTC+0" : raw.replace("GMT", "UTC");
  } catch {
    return "";
  }
}

function zoneOptions(): ZoneOption[] {
  const supported = Intl.supportedValuesOf("timeZone");
  const zones = supported.includes("UTC") ? supported : ["UTC", ...supported];
  const now = new Date();
  return zones.map((zone) => {
    const offset = offsetLabel(zone, now);
    return { value: zone, label: offset === "" ? zone : `${zone} (${offset})` };
  });
}

function jumpToZone(
  event: KeyboardEvent<HTMLElement>,
  items: readonly ZoneOption[],
  buffer: ReturnType<typeof createTypeaheadBuffer>,
) {
  const { key } = event;
  if (key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
  if (key === " " && buffer.text() === "") return;
  event.preventDefault();
  event.stopPropagation();
  const typed = buffer.push(key);
  const at = matchZone(
    items.map((entry) => entry.value),
    typed,
  );
  const rows = event.currentTarget.querySelectorAll<HTMLElement>('[data-slot="select-item"]');
  const row = rows[at];
  if (row === undefined) return;
  const box = row.getBoundingClientRect();
  const x = box.left + 1 + (typed.length % 2);
  row.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerType: "mouse",
      clientX: x,
      clientY: box.top + box.height / 2,
    }),
  );
  row.focus();
}

interface ZoneProps {
  readonly value: string;
  readonly disabled: boolean;
  readonly error: string | undefined;
  readonly onChange: (zone: string) => void;
}

export function ZoneField({ value, disabled, error, onChange }: ZoneProps) {
  const options = useMemo(zoneOptions, []);
  const buffer = useRef(createTypeaheadBuffer());
  const items = options.some((entry) => entry.value === value)
    ? options
    : [{ value, label: value }, ...options];
  return (
    <Row label="Time zone" error={error}>
      <Select
        items={items}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next);
        }}
      >
        <SelectTrigger aria-label="Time zone">
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          className="zone-list"
          onKeyDownCapture={(event) => jumpToZone(event, items, buffer.current)}
        >
          <SelectList />
        </SelectContent>
      </Select>
    </Row>
  );
}

interface SourceProps {
  readonly value: string | null;
  readonly workflows: readonly WorkflowSummary[];
  readonly currentId: string | null;
  readonly disabled: boolean;
  readonly error: string | undefined;
  readonly onChange: (id: string | null) => void;
}

export function SourceField({
  value,
  workflows,
  currentId,
  disabled,
  error,
  onChange,
}: SourceProps) {
  const others = workflows.filter((entry) => entry.id !== currentId);
  const nameOf = (id: string) => others.find((entry) => entry.id === id)?.name ?? id;
  return (
    <Row label="Source workflow" required error={error}>
      <Select
        value={value}
        disabled={disabled}
        placeholder="Choose a workflow"
        onValueChange={(next) => onChange(typeof next === "string" ? next : null)}
      >
        <SelectTrigger aria-label="Source workflow">
          <SelectValue>{value === null ? "Choose a workflow" : nameOf(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {others.map((entry) => (
            <SelectItem key={entry.id} value={entry.id}>
              {entry.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

export function OutputHint({ keys }: { readonly keys: readonly string[] }) {
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard", { description: text });
    } catch {
      toast.error("Copy failed", { description: "The browser blocked clipboard access." });
    }
  }
  return (
    <div className="trigger-output">
      <span className="trigger-output-label">Output</span>
      {keys.length === 0 ? (
        <span className="muted">The output is the run input. Add keys to the test input.</span>
      ) : (
        <span className="trigger-output-keys">
          {keys.map((key) => {
            const text = `{{input.${key}}}`;
            return (
              <Button
                key={key}
                data-variant="ghost"
                className="mono trigger-output-key"
                aria-label={`Copy ${text}`}
                onClick={() => void copy(text)}
              >
                {text}
              </Button>
            );
          })}
        </span>
      )}
    </div>
  );
}
