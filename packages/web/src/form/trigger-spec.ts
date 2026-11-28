import type { Issue, TriggerNode } from "../api/types";
import { cronFieldCount, cronFromEngine, cronIssueMessage } from "./cron-text";

export type TriggerMode = NonNullable<TriggerNode["mode"]>;
export type TriggerField =
  | "name"
  | "mode"
  | "cron"
  | "cron_timezone"
  | "source_workflow_id"
  | "on_status";

export const TRIGGER_MODES: readonly { readonly value: TriggerMode; readonly label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "cron", label: "Schedule" },
  { value: "webhook", label: "Webhook" },
  { value: "workflow_finished", label: "After workflow" },
];

export const STATUS_OPTIONS = [
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "any", label: "Any" },
] as const;

const MODE_FIELDS: Readonly<Record<TriggerMode, readonly TriggerField[]>> = {
  manual: ["name", "mode"],
  cron: ["name", "mode", "cron", "cron_timezone"],
  webhook: ["name", "mode"],
  workflow_finished: ["name", "mode", "source_workflow_id", "on_status"],
};

const SAMPLES: Readonly<Record<TriggerMode, string>> = {
  manual: "{}",
  cron: "{}",
  webhook: '{"example": "body"}',
  workflow_finished: '{"source_run_id": "test", "status": "succeeded", "output": {}}',
};

export const modeLabel = (mode: TriggerMode): string =>
  TRIGGER_MODES.find((entry) => entry.value === mode)?.label ?? mode;

export const defaultName = modeLabel;

export const triggerMode = (node: TriggerNode): TriggerMode => node.mode ?? "manual";

export function triggerLabel(node: TriggerNode): string {
  const name = node.name?.trim();
  return name ? name : defaultName(triggerMode(node));
}

export function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export const sampleInput = (mode: TriggerMode): string => SAMPLES[mode];

export function isSampleInput(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === "" || Object.values(SAMPLES).includes(trimmed);
}

export function isDefaultName(name: string | null | undefined): boolean {
  const trimmed = name?.trim() ?? "";
  return trimmed === "" || TRIGGER_MODES.some((entry) => entry.label === trimmed);
}

export function visibleFields(mode: TriggerMode): readonly TriggerField[] {
  return MODE_FIELDS[mode];
}

function base(node: TriggerNode, mode: TriggerMode, name: string | null | undefined): TriggerNode {
  const named = name ? { name } : {};
  return { id: node.id, kind: "trigger", ...named, mode };
}

export function switchMode(node: TriggerNode, mode: TriggerMode): TriggerNode {
  const name = isDefaultName(node.name) ? defaultName(mode) : node.name;
  const next = base(node, mode, name);
  if (mode === "cron") {
    return {
      ...next,
      ...(node.cron ? { cron: node.cron } : {}),
      cron_timezone: node.cron_timezone || browserZone(),
    };
  }
  if (mode === "workflow_finished") {
    return {
      ...next,
      ...(node.source_workflow_id ? { source_workflow_id: node.source_workflow_id } : {}),
      ...(node.on_status ? { on_status: node.on_status } : {}),
    };
  }
  return next;
}

export function normalizeTrigger(node: TriggerNode): TriggerNode {
  return switchMode(node, triggerMode(node));
}

export function renameTrigger(node: TriggerNode, name: string): TriggerNode {
  const { name: _old, ...rest } = node;
  return name.trim() === "" ? rest : { ...rest, name };
}

export type TriggerValue = string | null | undefined;

export function setTriggerField(
  node: TriggerNode,
  key: "cron" | "cron_timezone" | "source_workflow_id",
  value: TriggerValue,
): TriggerNode {
  const { [key]: _old, ...rest } = node;
  return value ? { ...rest, [key]: value } : rest;
}

export type FieldErrors = Partial<Record<TriggerField, string>>;

export function requiredErrors(node: TriggerNode): FieldErrors {
  const mode = triggerMode(node);
  if (mode === "cron") {
    const value = node.cron ?? "";
    if (cronFromEngine(value).text === "") return { cron: "Enter a cron expression." };
    if (cronFieldCount(value) !== 6) {
      return { cron: "A cron expression needs 5 fields: minute, hour, day, month, weekday." };
    }
  }
  if (mode === "workflow_finished" && !node.source_workflow_id) {
    return { source_workflow_id: "Choose the workflow to follow." };
  }
  return {};
}

const FIELD_SET: ReadonlySet<string> = new Set<TriggerField>([
  "name",
  "mode",
  "cron",
  "cron_timezone",
  "source_workflow_id",
  "on_status",
]);

const CODE_FIELDS: Readonly<Record<string, TriggerField>> = {
  bad_cron: "cron",
  bad_timezone: "cron_timezone",
  finished_self: "source_workflow_id",
  trigger_cycle: "source_workflow_id",
};

function isField(value: string): value is TriggerField {
  return FIELD_SET.has(value);
}

export function fieldOfIssue(issue: Issue): TriggerField | null {
  if (issue.field !== undefined && isField(issue.field)) return issue.field;
  const byCode = CODE_FIELDS[issue.code];
  if (byCode !== undefined) return byCode;
  if (/source_workflow_id/.test(issue.message)) return "source_workflow_id";
  if (/cron string/.test(issue.message)) return "cron";
  return null;
}

export function cleanMessage(message: string): string {
  const plain = message.replace(/^Value error, /, "");
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

export interface TriggerIssueView {
  readonly fields: FieldErrors;
  readonly general: readonly string[];
}

export function triggerIssueView(node: TriggerNode, issues: readonly Issue[]): TriggerIssueView {
  const visible = visibleFields(triggerMode(node));
  const fields: Record<string, string> = { ...requiredErrors(node) };
  const general: string[] = [];
  for (const issue of issues) {
    const field = fieldOfIssue(issue);
    const clean = cleanMessage(issue.message);
    const message = field === "cron" ? cronIssueMessage(node.cron ?? "", clean) : clean;
    if (field === null) {
      if (!general.includes(message)) general.push(message);
    } else if (!visible.includes(field)) {
    } else if (fields[field] === undefined) {
      fields[field] = message;
    }
  }
  return { fields, general };
}

export function triggerMessages(node: TriggerNode, issues: readonly Issue[]): readonly string[] {
  const view = triggerIssueView(node, issues);
  return [...Object.values(view.fields), ...view.general];
}
