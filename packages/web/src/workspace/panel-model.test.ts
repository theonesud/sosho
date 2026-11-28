import { describe, expect, it } from "vitest";
import type { RunSummary } from "../api/types";
import { mergeRuns, runRows, sortRuns, sortVersions } from "./panel-model";

const run = (
  run_id: string,
  status: string,
  created_at: number | null,
  workflow_id: string | null = "w1",
): RunSummary => ({
  run_id,
  status,
  dbos_status: "SUCCESS",
  workflow_id,
  version: 2,
  created_at,
  updated_at: created_at,
  app_version: null,
  forked_from: null,
  parent_run_id: null,
});

describe("panel rows", () => {
  it("lists versions newest first", () => {
    const versions = [1, 3, 2].map((version) => ({ version, name: "n", created_at: "t" }));
    expect(sortVersions(versions).map((item) => item.version)).toEqual([3, 2, 1]);
  });

  it("sorts waiting runs first, then newest first", () => {
    const runs = [
      run("old", "succeeded", 1),
      run("new", "failed", 9),
      run("wait-old", "waiting", 2),
      run("wait-new", "waiting", 8),
      run("none", "running", null),
    ];
    expect(sortRuns(runs).map((item) => item.run_id)).toEqual([
      "wait-new",
      "wait-old",
      "new",
      "old",
      "none",
    ]);
  });

  it("builds run rows with the workflow name and a safe status", () => {
    const names = new Map([["w1", "Daily"]]);
    const rows = runRows([run("a", "succeeded", 5), run("b", "odd", 4, "gone")], names);
    expect(rows[0]).toMatchObject({ name: "Daily", version: 2, status: "succeeded" });
    expect(rows[1]).toMatchObject({ name: "gone", status: "pending" });
  });

  it("merges a further page without duplicates", () => {
    const merged = mergeRuns(
      [run("a", "failed", 3)],
      [run("a", "failed", 3), run("b", "failed", 2)],
    );
    expect(merged.map((item) => item.run_id)).toEqual(["a", "b"]);
  });
});
