import { describe, expect, it } from "vitest";
import type { RunSummary } from "../api/types";
import { groupWaiting, newWaitingIds, waitingCount, waitingLabel } from "./waiting";

const run = (
  run_id: string,
  workflow_id: string | null,
  created_at: number | null,
): RunSummary => ({
  run_id,
  status: "waiting",
  dbos_status: "PENDING",
  workflow_id,
  version: 1,
  created_at,
  updated_at: created_at,
  app_version: null,
  forked_from: null,
  parent_run_id: null,
});

describe("newWaitingIds", () => {
  it("reports nothing on the first load", () => {
    expect(newWaitingIds(null, [run("a", "w", 1)])).toEqual([]);
  });

  it("reports only ids that the last poll did not have", () => {
    const runs = [run("a", "w", 1), run("b", "w", 2)];
    expect(newWaitingIds(new Set(["a"]), runs)).toEqual(["b"]);
    expect(newWaitingIds(new Set(["a", "b"]), runs)).toEqual([]);
    expect(newWaitingIds(new Set(["a", "b", "c"]), [])).toEqual([]);
  });
});

describe("grouping", () => {
  const runs = [
    run("late", "w1", 20),
    run("x", "w2", 5),
    run("early", "w1", 10),
    run("n", null, 1),
  ];
  const waiting = groupWaiting(runs);

  it("groups by workflow, oldest first, and skips runs without a workflow", () => {
    expect(waiting.get("w1")?.map((r) => r.run_id)).toEqual(["early", "late"]);
    expect(waiting.has("null")).toBe(false);
    expect(waitingCount(waiting)).toBe(3);
  });

  it("words the count", () => {
    expect(waitingLabel(1)).toBe("1 run waits for you");
    expect(waitingLabel(2)).toBe("2 runs wait for you");
  });
});
