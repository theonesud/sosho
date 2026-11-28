import { describe, expect, it } from "vitest";
import type { Node, WorkflowDraft } from "../api/types";
import { draftKey, type KeyValueStore, loadDraft, saveDraft } from "./persist";
import { type EditorAction, HISTORY_LIMIT, initialState, isDirty, reduce } from "./reducer";

const wait = (id: string): Node => ({ id, kind: "wait", seconds: 1 });
const base: WorkflowDraft = {
  name: "demo",
  nodes: [{ id: "t", kind: "trigger" }],
  edges: [],
  entry: "t",
};

function run(actions: readonly EditorAction[]) {
  const start = reduce(initialState(), {
    type: "load",
    workflowId: "demo",
    baseline: base,
    baseVersion: 3,
  });
  return actions.reduce(reduce, start);
}

describe("editor reducer", () => {
  it("edits the graph, tracks selection, and undoes and redoes", () => {
    let s = run([
      { type: "addNode", node: wait("a"), from: "t", when: "x" },
      { type: "addNode", node: wait("a"), from: "a" },
      { type: "connect", source: "t", target: "a_2" },
      { type: "updateEdge", id: "t>a_2", when: "y" },
    ]);
    expect(s.workflow.nodes.map((n) => n.id)).toEqual(["t", "a", "a_2"]);
    expect(s.workflow.edges).toEqual([
      { source: "t", target: "a", when: "x" },
      { source: "a", target: "a_2" },
      { source: "t", target: "a_2", when: "y" },
    ]);
    expect(isDirty(s)).toBe(true);
    expect(reduce(s, { type: "connect", source: "t", target: "a_2" })).toBe(s);

    s = reduce(s, { type: "updateNode", id: "a", node: wait("b") });
    expect(s.workflow.edges?.[0]).toEqual({ source: "t", target: "b", when: "x" });
    s = reduce(s, { type: "selectNodes", ids: ["b"] });
    s = reduce(s, { type: "deleteSelection" });
    expect(s.workflow.nodes.map((n) => n.id)).toEqual(["t", "a_2"]);
    expect(s.workflow.edges).toEqual([{ source: "t", target: "a_2", when: "y" }]);

    const undone = reduce(s, { type: "undo" });
    expect(undone.workflow.nodes).toHaveLength(3);
    expect(reduce(undone, { type: "redo" }).workflow).toBe(s.workflow);
    const reset = Array.from({ length: 6 }).reduce<typeof s>(
      (acc) => reduce(acc, { type: "undo" }),
      s,
    );
    expect(reset.workflow).toBe(reset.baseline);
    expect(isDirty(reset)).toBe(false);
  });

  it("caps history at the limit and drops redo after a new edit", () => {
    let s = run([]);
    for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) {
      s = reduce(s, { type: "addNode", node: wait(`n${i}`) });
    }
    expect(s.past).toHaveLength(HISTORY_LIMIT);
    s = reduce(s, { type: "undo" });
    expect(s.future).toHaveLength(1);
    s = reduce(s, { type: "addNode", node: wait("z") });
    expect(s.future).toHaveLength(0);
  });

  it("blocks edits in run mode and restores them after exit", () => {
    const s = run([{ type: "enterRun", runId: "r1" }]);
    expect(s.mode).toEqual({ kind: "run", runId: "r1" });
    expect(reduce(s, { type: "addNode", node: wait("a") })).toBe(s);
    const back = reduce(s, { type: "exitRun" });
    expect(reduce(back, { type: "addNode", node: wait("a") }).workflow.nodes).toHaveLength(2);
  });

  it("persists drafts per workflow and clears them on save", () => {
    const data = new Map<string, string>();
    const storage: KeyValueStore = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    saveDraft("demo", { baseVersion: 3, workflow: base }, storage);
    saveDraft("demo", { baseVersion: 2, workflow: { ...base, name: "older" } }, storage);
    expect(loadDraft("demo", 3, storage)).toEqual({ baseVersion: 3, workflow: base });
    expect(loadDraft("demo", 2, storage)?.workflow.name).toBe("older");
    expect(loadDraft("demo", 4, storage)).toBeNull();
    expect(loadDraft("other", 3, storage)).toBeNull();
    expect(draftKey("demo", 3)).not.toBe(draftKey("demo", 2));
    data.set(draftKey("demo", 3), "not json");
    expect(loadDraft("demo", 3, storage)).toBeNull();
    const saved = reduce(run([{ type: "addNode", node: wait("a") }]), {
      type: "markSaved",
      version: 4,
    });
    expect(isDirty(saved)).toBe(false);
    expect(saved.baseVersion).toBe(4);
  });

  it("patches an edge with loop settings and clears them when loop is off", () => {
    let s = run([
      { type: "addNode", node: wait("a"), from: "t" },
      { type: "patchEdge", id: "t>a", patch: { loop: true, max_iterations: 3, when: "x" } },
    ]);
    expect(s.workflow.edges).toEqual([
      { source: "t", target: "a", when: "x", loop: true, max_iterations: 3 },
    ]);
    s = reduce(s, { type: "patchEdge", id: "t>a", patch: { loop: false, when: null } });
    expect(s.workflow.edges).toEqual([{ source: "t", target: "a" }]);
  });
});
