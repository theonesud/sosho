import { describe, expect, it } from "vitest";
import type { WorkflowDraft } from "../api/types";
import { initialState, isDirty, reduce } from "./reducer";
import {
  canSave,
  duplicateId,
  duplicateName,
  freshIssues,
  issuesByNode,
  issuesFromDetail,
  latestOfList,
  minimalDraft,
  nextVersion,
  workflowIssues,
} from "./workflow-ops";

const saved: WorkflowDraft = minimalDraft("demo");

describe("workflow ops", () => {
  it("builds a valid minimal spec and duplicate names", () => {
    expect(minimalDraft("x")).toMatchObject({ entry: "start", nodes: [{ kind: "trigger" }] });
    expect(duplicateId("a", new Set(["a-copy"]))).toBe("a-copy_2");
    expect(duplicateName("a")).toBe("a copy");
  });

  it("groups issues by node and picks the latest workflow", () => {
    const grouped = issuesByNode([
      { code: "a", message: "m1", node: "n" },
      { code: "b", message: "m2", node: "n" },
      { code: "c", message: "m3", node: null },
    ]);
    expect(grouped.get("n")?.map((issue) => issue.message)).toEqual(["m1", "m2"]);
    expect(grouped.size).toBe(1);
    expect(
      workflowIssues([
        { code: "a", message: "m1", node: "n" },
        { code: "c", message: "no entry", node: null },
      ]),
    ).toEqual(["no entry"]);
    expect(
      latestOfList([
        { id: "a", created_at: "2026-01-01" },
        { id: "b", created_at: "2026-02-01" },
      ]),
    ).toBe("b");
    expect(latestOfList([])).toBeNull();
  });

  it("maps a schema 422 detail to the node and field", () => {
    const body = {
      detail: [
        {
          type: "string_pattern_mismatch",
          loc: ["body", "draft", "nodes", 1, "router", "branches", 0, "name"],
          msg: "String should match pattern",
        },
        { type: "missing", loc: ["body", "draft", "entry"], msg: "Field required" },
      ],
    };
    expect(issuesFromDetail(body, [{ id: "a" }, { id: "r" }])).toEqual([
      {
        code: "string_pattern_mismatch",
        message: "branches.0.name: String should match pattern",
        node: "r",
        field: "branches",
      },
      { code: "missing", message: "entry: Field required", node: null },
    ]);
    expect(issuesFromDetail("oops", [])).toEqual([]);
  });

  it("enables Save as vN for edits or for an opened old version", () => {
    const base = { dirty: false, opened: 3, latest: 3, saving: false };
    expect(canSave(base)).toBe(false);
    expect(canSave({ ...base, dirty: true })).toBe(true);
    expect(canSave({ ...base, opened: 2 })).toBe(true);
    expect(canSave({ ...base, dirty: true, saving: true })).toBe(false);
    expect(nextVersion(3)).toBe(4);
    expect(nextVersion(null)).toBe(1);
  });

  it("a replaced draft is dirty and save clears it", () => {
    let s = reduce(initialState(), {
      type: "load",
      workflowId: "demo",
      baseline: { ...saved, name: "v3" },
      baseVersion: 3,
    });
    expect(isDirty(s)).toBe(false);
    s = reduce(s, { type: "replace", workflow: { ...saved, name: "v1" } });
    expect(isDirty(s)).toBe(true);
    s = reduce(s, { type: "markSaved", version: 4 });
    expect(isDirty(s)).toBe(false);
    expect(s.baseVersion).toBe(4);
  });

  it("drops server issues of a node that changed since the check", () => {
    const a = { id: "a", kind: "trigger" } as const;
    const b = { id: "b", kind: "wait", seconds: 1 } as const;
    const issues = [
      { code: "x", message: "on a", node: "a" },
      { code: "y", message: "on b", node: "b" },
      { code: "z", message: "general", node: null },
    ];
    expect(freshIssues(issues, [a, b], [a, b])).toEqual(issues);
    const edited = { ...a, mode: "webhook" } as const;
    expect(freshIssues(issues, [a, b], [edited, b]).map((issue) => issue.code)).toEqual(["y", "z"]);
    expect(freshIssues(issues, [a, b], [a]).map((issue) => issue.code)).toEqual(["x", "z"]);
  });
});
