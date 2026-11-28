import { describe, expect, it } from "vitest";
import type { RunDetail, RunEvent } from "../api/types";
import {
  availableActions,
  initialRunState,
  nodeStatuses,
  nodeStep,
  runReducer,
  runStatus,
  unexplained,
} from "./run-state";

function detail(status: string, nodes: Record<string, string>, extra: Partial<RunDetail> = {}) {
  const base: RunDetail = {
    summary: {
      run_id: "r1",
      status,
      dbos_status: "PENDING",
      workflow_id: "w",
      version: 1,
      created_at: 1,
      updated_at: 2,
      app_version: null,
      forked_from: null,
      parent_run_id: null,
    },
    output: null,
    error: null,
    progress: { status, nodes },
    pending_human: [],
    steps: [],
  };
  return { ...base, ...extra };
}

const started = (seq: number, node: string): RunEvent => ({ seq, type: "node_started", node });
const finished = (seq: number, node: string): RunEvent => ({
  seq,
  type: "node_finished",
  node,
  output: {},
});
const failed = (seq: number, node: string): RunEvent => ({
  seq,
  type: "node_failed",
  node,
  error: "boom",
});

function apply(...actions: Parameters<typeof runReducer>[1][]) {
  return actions.reduce(runReducer, initialRunState);
}

describe("run status from snapshot plus events", () => {
  it("ignores duplicate events and sorts out-of-order events", () => {
    const state = apply(
      { type: "event", event: finished(3, "a") },
      { type: "event", event: started(2, "a") },
      { type: "event", event: started(2, "a") },
      { type: "event", event: started(4, "b") },
    );
    expect(state.events.map((event) => event.seq)).toEqual([2, 3, 4]);
    expect(nodeStatuses(state).get("a")).toBe("succeeded");
    expect(nodeStatuses(state).get("b")).toBe("running");
  });

  it("lets a settled snapshot beat a lagging running event", () => {
    const state = apply(
      { type: "event", event: started(1, "a") },
      { type: "detail", detail: detail("running", { t: "done", a: "done", b: "pending" }) },
    );
    const statuses = nodeStatuses(state);
    expect(statuses.get("t")).toBe("succeeded");
    expect(statuses.get("a")).toBe("succeeded");
    expect(statuses.get("b")).toBe("pending");
  });

  it("marks failed, skipped, waiting, and cancelled nodes", () => {
    const waiting = apply({
      type: "detail",
      detail: detail(
        "waiting",
        { h: "running", s: "skipped", n: "pending" },
        {
          pending_human: [
            {
              node_id: "h",
              run_id: "r1:h:1",
              prompt: "p",
              show: null,
              actions: ["approve"],
              wait_seconds: 1,
            },
          ],
        },
      ),
    });
    expect(runStatus(waiting)).toBe("waiting");
    expect(nodeStatuses(waiting).get("h")).toBe("waiting");
    expect(nodeStatuses(waiting).get("s")).toBe("skipped");

    const dead = apply(
      { type: "event", event: started(1, "x") },
      { type: "event", event: failed(2, "x") },
      { type: "event", event: started(3, "y") },
      { type: "detail", detail: detail("failed", { x: "pending", y: "running" }) },
    );
    expect(nodeStatuses(dead).get("x")).toBe("failed");
    expect(nodeStatuses(dead).get("y")).toBe("cancelled");
    expect(runStatus(dead)).toBe("failed");
  });

  it("flags events the snapshot cannot explain and reads the full step output", () => {
    const empty = apply();
    expect(unexplained(empty, started(1, "a"))).toBe(true);
    const state = apply({
      type: "detail",
      detail: detail(
        "running",
        { a: "running" },
        {
          steps: [
            {
              step: 6,
              name: "tool:a",
              child_run_id: null,
              error: null,
              started_at: 5,
              completed_at: 9,
              output: { output: { v: 1 }, llm_calls: 0 },
            },
          ],
        },
      ),
    });
    expect(unexplained(state, started(1, "a"))).toBe(false);
    expect(unexplained(state, started(2, "zzz"))).toBe(true);
    expect(nodeStep(state.detail, "a")).toMatchObject({
      output: { v: 1 },
      startedAt: 5,
      completedAt: 9,
    });
  });
});

describe("run action availability", () => {
  it("offers each action only for the statuses that allow it", () => {
    expect(availableActions("pending")).toEqual({ cancel: true, resume: false, fork: false });
    expect(availableActions("running")).toEqual({ cancel: true, resume: false, fork: false });
    expect(availableActions("waiting")).toEqual({ cancel: true, resume: false, fork: false });
    expect(availableActions("succeeded")).toEqual({ cancel: false, resume: false, fork: true });
    expect(availableActions("failed")).toEqual({ cancel: false, resume: false, fork: true });
    expect(availableActions("cancelled")).toEqual({ cancel: false, resume: true, fork: true });
    expect(availableActions("failed", "MAX_RECOVERY_ATTEMPTS_EXCEEDED").resume).toBe(true);
    expect(availableActions(null)).toEqual({ cancel: false, resume: false, fork: false });
  });
});
