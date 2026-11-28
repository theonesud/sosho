import { isJsonValue, isRecord } from "../api/guards";
import type { JsonValue, PendingHuman, RunDetail, RunEvent, StepSummary } from "../api/types";
import { type RunStatus, runStatuses } from "../types";

export type NodeStatus = RunStatus | "skipped";

export interface RunState {
  readonly detail: RunDetail | null;
  readonly events: readonly RunEvent[];
}

export type RunAction =
  | { readonly type: "reset" }
  | { readonly type: "detail"; readonly detail: RunDetail }
  | { readonly type: "event"; readonly event: RunEvent };

export const initialRunState: RunState = { detail: null, events: [] };

const TERMINAL: ReadonlySet<RunStatus> = new Set(["succeeded", "failed", "cancelled"]);
const SNAPSHOT_NAMES: Readonly<Record<string, NodeStatus>> = {
  done: "succeeded",
  running: "running",
  skipped: "skipped",
  pending: "pending",
};

export const isTerminal = (status: RunStatus | null): boolean =>
  status !== null && TERMINAL.has(status);

export const asRunStatus = (value: string): RunStatus | null =>
  runStatuses.find((status) => status === value) ?? null;

function insertEvent(events: readonly RunEvent[], event: RunEvent): readonly RunEvent[] {
  if (events.some((item) => item.seq === event.seq)) return events;
  return [...events, event].sort((a, b) => a.seq - b.seq);
}

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "reset":
      return initialRunState;
    case "detail":
      return { ...state, detail: action.detail };
    case "event":
      return { ...state, events: insertEvent(state.events, action.event) };
  }
}

function snapshotNodes(detail: RunDetail | null): Readonly<Record<string, string>> {
  const progress = detail?.progress;
  if (!isRecord(progress) || !isRecord(progress.nodes)) return {};
  const nodes: Record<string, string> = {};
  for (const [id, value] of Object.entries(progress.nodes)) {
    if (typeof value === "string") nodes[id] = value;
  }
  return nodes;
}

function foldEvents(events: readonly RunEvent[]): Map<string, NodeStatus> {
  const folded = new Map<string, NodeStatus>();
  for (const event of events) {
    if (event.type === "node_started") folded.set(event.node, "running");
    else if (event.type === "node_finished") folded.set(event.node, "succeeded");
    else if (event.type === "node_failed") folded.set(event.node, "failed");
  }
  return folded;
}

export function runStatus(state: RunState): RunStatus | null {
  const reported = state.detail ? asRunStatus(state.detail.summary.status) : null;
  if (isTerminal(reported)) return reported;
  const finished = state.events.findLast((event) => event.type === "run_finished");
  const final = finished?.type === "run_finished" ? asRunStatus(finished.status) : null;
  if (final !== null && isTerminal(final)) return final;
  if (reported === "running" && (state.detail?.pending_human.length ?? 0) > 0) return "waiting";
  return reported ?? (state.events.length > 0 ? "running" : null);
}

export function nodeStatuses(state: RunState): ReadonlyMap<string, NodeStatus> {
  const snapshot = snapshotNodes(state.detail);
  const folded = foldEvents(state.events);
  const overall = runStatus(state);
  const result = new Map<string, NodeStatus>();
  for (const id of new Set([...Object.keys(snapshot), ...folded.keys()])) {
    const fromSnapshot = SNAPSHOT_NAMES[snapshot[id] ?? "pending"] ?? "pending";
    const fromEvents = folded.get(id);
    const lagging = fromEvents === undefined || fromEvents === "running";
    const settled = fromSnapshot === "succeeded" || fromSnapshot === "skipped";
    result.set(id, lagging && settled ? fromSnapshot : (fromEvents ?? fromSnapshot));
  }
  for (const pending of state.detail?.pending_human ?? []) {
    if (!isTerminal(overall)) result.set(pending.node_id, "waiting");
  }
  if (isTerminal(overall)) {
    for (const [id, status] of result) {
      if (status === "running" || status === "waiting") {
        result.set(id, overall === "succeeded" ? "succeeded" : "cancelled");
      }
    }
  }
  return result;
}

export function unexplained(state: RunState, event: RunEvent): boolean {
  if (state.detail === null) return true;
  if (event.type === "run_started" || event.type === "run_finished") return false;
  return !(event.node in snapshotNodes(state.detail));
}

export interface RunAvailability {
  readonly cancel: boolean;
  readonly resume: boolean;
  readonly fork: boolean;
}

export function availableActions(
  status: RunStatus | null,
  dbosStatus: string | null = null,
): RunAvailability {
  const cancel = status === "pending" || status === "running" || status === "waiting";
  const resume = status === "cancelled" || dbosStatus === "MAX_RECOVERY_ATTEMPTS_EXCEEDED";
  return { cancel, resume, fork: isTerminal(status) };
}

export interface NodeStep {
  readonly output: JsonValue | undefined;
  readonly error: string | null;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
}

const INLINE = /^(llm|tool|router|join):(.+)$/;
const RESULT_STEP = "DBOS.getResult";

function unwrap(output: JsonValue): JsonValue | undefined {
  if (isRecord(output) && "output" in output) {
    const inner = output.output;
    return isJsonValue(inner) ? inner : undefined;
  }
  return output === null ? undefined : output;
}

function stepOf(runId: string, nodeId: string, steps: readonly StepSummary[]): NodeStep | null {
  const own = steps.filter((step) => step.name.match(INLINE)?.[2] === nodeId);
  const prefix = `${runId}:${nodeId}:`;
  const children = steps.filter((step) => step.child_run_id?.startsWith(prefix));
  const inline = own.at(-1);
  const result = children.findLast((step) => step.name === RESULT_STEP);
  const launch = children.findLast((step) => step.name !== RESULT_STEP);
  if (inline && (!result || inline.step > result.step)) {
    return {
      output: unwrap(inline.output),
      error: inline.error,
      startedAt: inline.started_at,
      completedAt: inline.completed_at,
    };
  }
  if (!result && !launch) return null;
  return {
    output: result ? unwrap(result.output) : undefined,
    error: result?.error ?? launch?.error ?? null,
    startedAt: launch?.started_at ?? result?.started_at ?? null,
    completedAt: result?.completed_at ?? null,
  };
}

export const nodeStep = (detail: RunDetail | null, nodeId: string): NodeStep | null =>
  detail === null ? null : stepOf(detail.summary.run_id, nodeId, detail.steps);

export function failureOf(state: RunState, nodeId: string): string | null {
  const event = state.events.findLast(
    (item) => item.type === "node_failed" && item.node === nodeId,
  );
  if (event?.type === "node_failed") return event.error;
  return nodeStep(state.detail, nodeId)?.error ?? null;
}

export const pendingFor = (state: RunState, nodeId: string): PendingHuman | null =>
  state.detail?.pending_human.find((item) => item.node_id === nodeId) ?? null;

export function forkTarget(
  state: RunState,
  statuses: ReadonlyMap<string, NodeStatus>,
  selected: string | null,
  triggerIds: ReadonlySet<string>,
): string | null {
  const ran = (id: string) => {
    const status = statuses.get(id);
    return !triggerIds.has(id) && (status === "succeeded" || status === "failed");
  };
  if (selected !== null && ran(selected)) return selected;
  const failed = [...statuses].find(([, status]) => status === "failed");
  if (failed) return failed[0];
  const last = state.events.findLast((event) => event.type === "node_finished" && ran(event.node));
  return last?.type === "node_finished" ? last.node : null;
}
