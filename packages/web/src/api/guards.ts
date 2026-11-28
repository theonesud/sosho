import type {
  Catalog,
  Edge,
  Issue,
  JsonObject,
  JsonValue,
  KindEntry,
  Node,
  NodeKind,
  PendingHuman,
  RunDetail,
  RunEvent,
  RunRef,
  RunSummary,
  StepSummary,
  ToolEntry,
  TriggerFollower,
  TriggerInfo,
  TriggerSchedule,
  TriggerWebhook,
  ValidateResponse,
  VersionSummary,
  Workflow,
  WorkflowDraft,
  WorkflowSummary,
} from "./types";
import { NODE_KINDS } from "./types";

export type Guard<T> = (value: unknown) => value is T;
type Rec = { readonly [key: string]: unknown };

export function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const nullable =
  <T>(guard: Guard<T>): Guard<T | null> =>
  (value): value is T | null =>
    value === null || guard(value);

export function arrayOf<T>(guard: Guard<T>): Guard<readonly T[]> {
  return (value): value is readonly T[] => Array.isArray(value) && value.every(guard);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || isString(value) || isNumber(value) || isBoolean(value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && isJsonValue(value);
}

function optional(value: Rec, key: string, guard: Guard<unknown>): boolean {
  return !(key in value) || guard(value[key]);
}

export function isNodeKind(value: unknown): value is NodeKind {
  return NODE_KINDS.some((kind) => kind === value);
}

const isOptString = (value: unknown) => value === undefined || value === null || isString(value);

const kindChecks: { readonly [K in NodeKind]: (node: Rec) => boolean } = {
  trigger: (n) => optional(n, "mode", isString) && optional(n, "cron", isOptString),
  llm: (n) => isString(n.role) && isString(n.prompt),
  agent: (n) => isString(n.role) && isString(n.prompt) && optional(n, "skills", arrayOf(isString)),
  skill: (n) => isString(n.skill) && isString(n.task) && isString(n.role),
  tool: (n) => isString(n.tool) && optional(n, "args", isJsonObject),
  router: (n) => Array.isArray(n.branches) && n.branches.every(isRecord),
  map: (n) => isString(n.items) && isString(n.workflow_id) && isNumber(n.version),
  join: (n) => optional(n, "require_all", isBoolean),
  human: (n) => isString(n.prompt) && optional(n, "actions", arrayOf(isString)),
  subworkflow: (n) => isString(n.workflow_id) && isNumber(n.version),
  wait: (n) => isNumber(n.seconds),
};

export function isNode(value: unknown): value is Node {
  if (!isRecord(value) || !isString(value.id) || !isNodeKind(value.kind)) return false;
  return optional(value, "name", isOptString) && kindChecks[value.kind](value);
}

export function isEdge(value: unknown): value is Edge {
  return (
    isRecord(value) &&
    isString(value.source) &&
    isString(value.target) &&
    optional(value, "when", isOptString) &&
    optional(value, "loop", isBoolean)
  );
}

export function isWorkflowDraft(value: unknown): value is WorkflowDraft {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.entry) &&
    arrayOf(isNode)(value.nodes) &&
    optional(value, "edges", arrayOf(isEdge)) &&
    optional(value, "policy", isRecord) &&
    optional(value, "description", isOptString)
  );
}

export function isWorkflow(value: unknown): value is Workflow {
  return isWorkflowDraft(value) && isRecord(value) && isString(value.id) && isNumber(value.version);
}

const isTriggerSchedule = (value: unknown): value is TriggerSchedule =>
  isRecord(value) &&
  isString(value.name) &&
  isString(value.cron) &&
  nullable(isString)(value.timezone) &&
  nullable(isString)(value.next_fire);

export const isTriggerWebhook = (value: unknown): value is TriggerWebhook =>
  isRecord(value) && isString(value.node_id) && isString(value.url) && isString(value.token);

const isTriggerFollower = (value: unknown): value is TriggerFollower =>
  isRecord(value) && isString(value.source_workflow_id) && isString(value.on_status);

export function isTriggerInfo(value: unknown): value is TriggerInfo {
  return (
    isRecord(value) &&
    nullable(isNumber)(value.version) &&
    arrayOf(isTriggerSchedule)(value.schedules) &&
    arrayOf(isTriggerWebhook)(value.webhooks) &&
    arrayOf(isTriggerFollower)(value.followers)
  );
}

export function isIssue(value: unknown): value is Issue {
  return (
    isRecord(value) &&
    isString(value.code) &&
    isString(value.message) &&
    nullable(isString)(value.node)
  );
}

export function isValidateResponse(value: unknown): value is ValidateResponse {
  return isRecord(value) && isBoolean(value.valid) && arrayOf(isIssue)(value.issues);
}

export function isWorkflowSummary(value: unknown): value is WorkflowSummary {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isOptString(value.description) &&
    nullable(isNumber)(value.latest_version) &&
    isString(value.created_at)
  );
}

function isVersionSummary(value: unknown): value is VersionSummary {
  return (
    isRecord(value) && isNumber(value.version) && isString(value.name) && isString(value.created_at)
  );
}

function isKindEntry(value: unknown): value is KindEntry {
  return (
    isRecord(value) &&
    isString(value.kind) &&
    isString(value.title) &&
    isString(value.description) &&
    isJsonObject(value.json_schema)
  );
}

function isToolEntry(value: unknown): value is ToolEntry {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.description) &&
    isBoolean(value.side_effect) &&
    isJsonObject(value.json_schema)
  );
}

const isQueues = (value: unknown): value is Catalog["queues"] =>
  isRecord(value) &&
  Object.values(value).every((limits) => isRecord(limits) && Object.values(limits).every(isNumber));

export function isCatalog(value: unknown): value is Catalog {
  return (
    isRecord(value) &&
    arrayOf(isKindEntry)(value.kinds) &&
    arrayOf(isToolEntry)(value.tools) &&
    isQueues(value.queues) &&
    arrayOf(isString)(value.skills) &&
    arrayOf(isString)(value.pi_roles)
  );
}

function isRunSummary(value: unknown): value is RunSummary {
  const optNumber = nullable(isNumber);
  const optText = nullable(isString);
  return (
    isRecord(value) &&
    isString(value.run_id) &&
    isString(value.status) &&
    isString(value.dbos_status) &&
    optText(value.workflow_id) &&
    optNumber(value.version) &&
    optNumber(value.created_at) &&
    optNumber(value.updated_at) &&
    optText(value.app_version) &&
    optText(value.forked_from) &&
    optText(value.parent_run_id)
  );
}

function isStepSummary(value: unknown): value is StepSummary {
  const optNumber = nullable(isNumber);
  return (
    isRecord(value) &&
    isNumber(value.step) &&
    isString(value.name) &&
    nullable(isString)(value.child_run_id) &&
    nullable(isString)(value.error) &&
    optNumber(value.started_at) &&
    optNumber(value.completed_at) &&
    isJsonValue(value.output)
  );
}

function isPendingHuman(value: unknown): value is PendingHuman {
  return (
    isRecord(value) &&
    isString(value.node_id) &&
    isString(value.run_id) &&
    isString(value.prompt) &&
    nullable(isString)(value.show) &&
    arrayOf(isString)(value.actions) &&
    isNumber(value.wait_seconds)
  );
}

export function isRunDetail(value: unknown): value is RunDetail {
  return (
    isRecord(value) &&
    isRunSummary(value.summary) &&
    isJsonValue(value.output) &&
    nullable(isString)(value.error) &&
    isJsonValue(value.progress) &&
    arrayOf(isPendingHuman)(value.pending_human) &&
    arrayOf(isStepSummary)(value.steps)
  );
}

export function isRunRef(value: unknown): value is RunRef {
  return isRecord(value) && isString(value.run_id);
}

export function isRunEvent(value: unknown): value is RunEvent {
  if (!isRecord(value) || !isNumber(value.seq)) return false;
  switch (value.type) {
    case "run_started":
      return isString(value.workflow_id) && isNumber(value.version);
    case "node_started":
      return isString(value.node);
    case "node_finished":
      return isString(value.node) && isJsonValue(value.output);
    case "node_failed":
      return isString(value.node) && isString(value.error);
    case "run_finished":
      return isString(value.status);
    default:
      return false;
  }
}

export const isWorkflowSummaryList = arrayOf(isWorkflowSummary);
export const isVersionSummaryList = arrayOf(isVersionSummary);
export const isRunSummaryList = arrayOf(isRunSummary);
