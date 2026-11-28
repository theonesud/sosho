import { describe, expect, it } from "vitest";
import type { Edge, Node, WorkflowDraft } from "../api/types";
import { copySelection, planPaste, reid } from "./graph";
import { type EditorAction, initialState, reduce } from "./reducer";
import { selectedIds, singleNode, toggleNode } from "./selection";

const wait = (id: string): Node => ({ id, kind: "wait", seconds: 1 });
const trigger = (id: string): Node => ({ id, kind: "trigger" });
const edge = (source: string, target: string): Edge => ({ source, target });

const graph: WorkflowDraft = {
  name: "demo",
  nodes: [trigger("t"), wait("a"), wait("b"), wait("c")],
  edges: [edge("t", "a"), edge("a", "b"), edge("b", "c")],
  entry: "t",
};

function start(workflow: WorkflowDraft = graph) {
  return reduce(initialState(), {
    type: "load",
    workflowId: "demo",
    baseline: workflow,
    baseVersion: 1,
  });
}

function run(actions: readonly EditorAction[], workflow: WorkflowDraft = graph) {
  return actions.reduce(reduce, start(workflow));
}

describe("multi-select", () => {
  it("toggles, replaces, selects all, and expands only a single node", () => {
    let s = run([{ type: "toggleNode", id: "a" }]);
    expect(singleNode(s.selection)).toBe("a");
    s = reduce(s, { type: "toggleNode", id: "b" });
    expect(selectedIds(s.selection)).toEqual(["a", "b"]);
    expect(singleNode(s.selection)).toBeNull();
    s = reduce(s, { type: "toggleNode", id: "a" });
    expect(selectedIds(s.selection)).toEqual(["b"]);
    expect(toggleNode(s.selection, "b")).toEqual({ kind: null });
    expect(reduce(s, { type: "selectAll" }).selection).toEqual({
      kind: "nodes",
      ids: ["t", "a", "b", "c"],
    });
    expect(reduce(s, { type: "selectNodes", ids: [] }).selection).toEqual({ kind: null });
  });

  it("ignores selection edits in run mode except a direct node pick", () => {
    const s = run([{ type: "enterRun", runId: "r1" }]);
    expect(reduce(s, { type: "selectAll" })).toBe(s);
    expect(reduce(s, { type: "toggleNode", id: "a" })).toBe(s);
    expect(singleNode(reduce(s, { type: "selectNodes", ids: ["a"] }).selection)).toBe("a");
  });

  it("deletes all selected nodes with their edges as one undo step", () => {
    let s = run([{ type: "selectNodes", ids: ["a", "b"] }, { type: "deleteSelection" }]);
    expect(s.workflow.nodes.map((n) => n.id)).toEqual(["t", "c"]);
    expect(s.workflow.edges).toEqual([]);
    expect(s.past).toHaveLength(1);
    s = reduce(s, { type: "undo" });
    expect(s.workflow).toBe(s.baseline);
  });

  it("moves the entry when the entry node is deleted", () => {
    const s = run([{ type: "selectNodes", ids: ["t", "a"] }, { type: "deleteSelection" }]);
    expect(s.workflow.entry).toBe("b");
  });
});

describe("copy and paste", () => {
  it("copies only the edges between selected nodes", () => {
    const text = copySelection(graph, ["a", "b"]) ?? "";
    expect(JSON.parse(text).edges).toEqual([edge("a", "b")]);
    expect(copySelection(graph, ["zzz"])).toBeNull();
  });

  it("pastes with new ids and internal edges, never an edge to the existing graph", () => {
    const text = copySelection(graph, ["a", "b"]) ?? "";
    let s = run([]);
    s = reduce(s, { type: "paste", text });
    expect(s.workflow.nodes.map((n) => n.id)).toEqual(["t", "a", "b", "c", "a_2", "b_2"]);
    expect(s.workflow.edges?.slice(3)).toEqual([edge("a_2", "b_2")]);
    expect(s.selection).toEqual({ kind: "nodes", ids: ["a_2", "b_2"] });
    expect(s.past).toHaveLength(1);
    const outside = JSON.stringify({
      tag: "sosho.nodes",
      nodes: [wait("a")],
      edges: [edge("t", "a"), edge("a", "c")],
    });
    const plan = planPaste(graph, outside);
    expect(plan?.edges).toEqual([]);
  });

  it("pastes into another workflow and rejects invalid clipboard data", () => {
    const text = copySelection(graph, ["a", "b"]) ?? "";
    const other = start({ name: "x", nodes: [trigger("start")], edges: [], entry: "start" });
    const pasted = reduce(other, { type: "paste", text });
    expect(pasted.workflow.nodes.map((n) => n.id)).toEqual(["start", "a", "b"]);
    expect(planPaste(graph, "not json")).toBeNull();
    expect(planPaste(graph, JSON.stringify({ tag: "other", nodes: [], edges: [] }))).toBeNull();
    expect(reduce(other, { type: "paste", text: "{}" })).toBe(other);
  });

  it("makes ids unique when names collide", () => {
    const taken = new Set(["a", "a_2", "a_3"]);
    const out = reid({ nodes: [wait("a"), wait("b")], edges: [edge("a", "b")] }, taken);
    expect(out.nodes.map((n) => n.id)).toEqual(["a_4", "b"]);
    expect(out.edges).toEqual([edge("a_4", "b")]);
    const twice = reid({ nodes: [wait("n"), wait("n_2")], edges: [] }, new Set(["n"]));
    expect(twice.nodes.map((n) => n.id)).toEqual(["n_2", "n_2_2"]);
  });

  it("duplicates a selection as one undo step", () => {
    const base = run([{ type: "selectNodes", ids: ["b", "c"] }]);
    const text = copySelection(base.workflow, selectedIds(base.selection)) ?? "";
    const s = reduce(base, { type: "paste", text });
    expect(s.workflow.edges?.at(-1)).toEqual(edge("b_2", "c_2"));
    expect(reduce(s, { type: "undo" }).workflow).toBe(base.workflow);
  });
});

describe("one trigger per workflow", () => {
  it("skips a pasted trigger and drops the edges that touch it", () => {
    const text = copySelection(graph, ["t", "a", "b"]) ?? "";
    const plan = planPaste(graph, text);
    expect(plan?.skippedTrigger).toBe(true);
    expect(plan?.nodes.map((n) => n.id)).toEqual(["a_2", "b_2"]);
    expect(plan?.edges).toEqual([edge("a_2", "b_2")]);
    const s = reduce(start(), { type: "paste", text });
    expect(s.workflow.nodes.filter((n) => n.kind === "trigger")).toHaveLength(1);
  });

  it("does nothing when only a trigger is pasted into a workflow that has one", () => {
    const s = start();
    expect(reduce(s, { type: "paste", text: copySelection(graph, ["t"]) ?? "" })).toBe(s);
  });

  it("allows a trigger after the only trigger is deleted, and keeps one from a clip", () => {
    const text = copySelection(graph, ["t"]) ?? "";
    let s = run([{ type: "selectNodes", ids: ["t"] }, { type: "deleteSelection" }]);
    s = reduce(s, { type: "paste", text });
    expect(s.workflow.nodes.filter((n) => n.kind === "trigger")).toHaveLength(1);
    const two = JSON.stringify({
      tag: "sosho.nodes",
      nodes: [trigger("x"), trigger("y")],
      edges: [],
    });
    expect(planPaste({ ...graph, nodes: [wait("a")] }, two)?.nodes).toHaveLength(1);
  });

  it("refuses to add a second trigger node", () => {
    const s = start();
    expect(reduce(s, { type: "addNode", node: trigger("t2"), from: "a" })).toBe(s);
  });
});
