import { isEdge } from "../api/guards";
import type { Edge, Node, Workflow, WorkflowDraft } from "../api/types";
import { edgeKey, emptyDraft, hasTrigger, planPaste, toDraft, uniqueId } from "./graph";
import {
  NO_SELECTION,
  nodesSelection,
  type Selection,
  selectedIds,
  toggleNode as toggleSelected,
} from "./selection";

export const HISTORY_LIMIT = 100;

export type { Selection } from "./selection";

export interface EdgePatch {
  readonly when?: string | null;
  readonly loop?: boolean;
  readonly max_iterations?: number | null;
  readonly on_limit?: "exit" | "fail";
}

export type Mode = { readonly kind: "edit" } | { readonly kind: "run"; readonly runId: string };

export interface EditorState {
  readonly workflowId: string | null;
  readonly workflow: WorkflowDraft;
  readonly baseline: WorkflowDraft;
  readonly baseVersion: number | null;
  readonly selection: Selection;
  readonly mode: Mode;
  readonly past: readonly WorkflowDraft[];
  readonly future: readonly WorkflowDraft[];
}

export type EditorAction =
  | {
      readonly type: "load";
      readonly workflowId: string;
      readonly baseline: WorkflowDraft | Workflow;
      readonly baseVersion: number | null;
      readonly draft?: WorkflowDraft;
    }
  | { readonly type: "markSaved"; readonly version: number }
  | { readonly type: "replace"; readonly workflow: WorkflowDraft | Workflow }
  | {
      readonly type: "addNode";
      readonly node: Node;
      readonly from?: string;
      readonly when?: string;
    }
  | { readonly type: "updateNode"; readonly id: string; readonly node: Node }
  | { readonly type: "deleteSelection" }
  | {
      readonly type: "connect";
      readonly source: string;
      readonly target: string;
      readonly when?: string;
    }
  | { readonly type: "updateEdge"; readonly id: string; readonly when: string | null }
  | { readonly type: "patchEdge"; readonly id: string; readonly patch: EdgePatch }
  | { readonly type: "select"; readonly selection: Selection }
  | { readonly type: "toggleNode"; readonly id: string }
  | { readonly type: "selectNodes"; readonly ids: readonly string[] }
  | { readonly type: "selectAll" }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "paste"; readonly text: string }
  | { readonly type: "enterRun"; readonly runId: string }
  | { readonly type: "exitRun" };

export function initialState(): EditorState {
  const blank = emptyDraft();
  return {
    workflowId: null,
    workflow: blank,
    baseline: blank,
    baseVersion: null,
    selection: NO_SELECTION,
    mode: { kind: "edit" },
    past: [],
    future: [],
  };
}

export function isDirty(state: EditorState): boolean {
  return state.workflow !== state.baseline;
}

function commit(state: EditorState, next: WorkflowDraft, selection?: Selection): EditorState {
  return {
    ...state,
    workflow: next,
    selection: selection ?? state.selection,
    past: [...state.past, state.workflow].slice(-HISTORY_LIMIT),
    future: [],
  };
}

const edgesOf = (workflow: WorkflowDraft): readonly Edge[] => workflow.edges ?? [];
const idsOf = (workflow: WorkflowDraft): Set<string> => new Set(workflow.nodes.map((n) => n.id));

function withEdge(workflow: WorkflowDraft, edge: Edge): WorkflowDraft {
  return { ...workflow, edges: [...edgesOf(workflow), edge] };
}

function newEdge(source: string, target: string, when: string | undefined): Edge {
  return when ? { source, target, when } : { source, target };
}

function addNode(state: EditorState, node: Node, from?: string, when?: string): EditorState {
  const { workflow } = state;
  const taken = idsOf(workflow);
  if (from !== undefined && !taken.has(from)) return state;
  if (node.kind === "trigger" && hasTrigger(workflow)) return state;
  const added = { ...node, id: uniqueId(node.id, taken) };
  let next: WorkflowDraft = { ...workflow, nodes: [...workflow.nodes, added] };
  if (workflow.entry === "") next = { ...next, entry: added.id };
  if (from !== undefined) next = withEdge(next, newEdge(from, added.id, when));
  return commit(state, next, nodesSelection([added.id]));
}

function updateNode(state: EditorState, id: string, node: Node): EditorState {
  const { workflow } = state;
  if (!workflow.nodes.some((n) => n.id === id)) return state;
  const renamed = node.id !== id;
  if (renamed && idsOf(workflow).has(node.id)) return state;
  const rename = (value: string) => (value === id ? node.id : value);
  const next: WorkflowDraft = {
    ...workflow,
    nodes: workflow.nodes.map((n) => (n.id === id ? node : n)),
    entry: rename(workflow.entry),
    edges: edgesOf(workflow).map((e) => ({
      ...e,
      source: rename(e.source),
      target: rename(e.target),
    })),
  };
  const ids = selectedIds(state.selection);
  const selection = ids.includes(id)
    ? nodesSelection(ids.map((item) => (item === id ? node.id : item)))
    : undefined;
  return commit(state, next, selection);
}

function deleteSelection(state: EditorState): EditorState {
  const { workflow, selection } = state;
  if (selection.kind === "nodes") {
    const gone = new Set(selection.ids);
    const nodes = workflow.nodes.filter((n) => !gone.has(n.id));
    if (nodes.length === workflow.nodes.length) return state;
    const edges = edgesOf(workflow).filter((e) => !gone.has(e.source) && !gone.has(e.target));
    const entry = gone.has(workflow.entry) ? (nodes[0]?.id ?? "") : workflow.entry;
    return commit(state, { ...workflow, nodes, edges, entry }, NO_SELECTION);
  }
  if (selection.kind === "edge") {
    const edges = edgesOf(workflow).filter((e) => edgeKey(e) !== selection.id);
    if (edges.length === edgesOf(workflow).length) return state;
    return commit(state, { ...workflow, edges }, NO_SELECTION);
  }
  return state;
}

function connect(state: EditorState, source: string, target: string, when?: string): EditorState {
  const ids = idsOf(state.workflow);
  const edge = newEdge(source, target, when);
  const exists = edgesOf(state.workflow).some((e) => edgeKey(e) === edgeKey(edge));
  if (!ids.has(source) || !ids.has(target) || exists) return state;
  return commit(state, withEdge(state.workflow, edge), { kind: "edge", id: edgeKey(edge) });
}

function applyEdgePatch(edge: Edge, patch: EdgePatch): Edge {
  const merged: Record<string, unknown> = { ...edge, ...patch };
  for (const key of ["when", "max_iterations"]) {
    if (merged[key] === null || merged[key] === "") delete merged[key];
  }
  if (merged.loop !== true) {
    delete merged.loop;
    delete merged.max_iterations;
    delete merged.on_limit;
  }
  return isEdge(merged) ? merged : edge;
}

function patchEdge(state: EditorState, id: string, patch: EdgePatch): EditorState {
  const { workflow } = state;
  if (!edgesOf(workflow).some((e) => edgeKey(e) === id)) return state;
  const edges = edgesOf(workflow).map((e) => (edgeKey(e) === id ? applyEdgePatch(e, patch) : e));
  return commit(state, { ...workflow, edges });
}

function updateEdge(state: EditorState, id: string, when: string | null): EditorState {
  return patchEdge(state, id, { when });
}

function paste(state: EditorState, text: string): EditorState {
  const plan = planPaste(state.workflow, text);
  const first = plan?.nodes[0];
  if (!plan || !first) return state;
  let next: WorkflowDraft = {
    ...state.workflow,
    nodes: [...state.workflow.nodes, ...plan.nodes],
    edges: [...edgesOf(state.workflow), ...plan.edges],
  };
  if (next.entry === "") next = { ...next, entry: first.id };
  return commit(state, next, nodesSelection(plan.nodes.map((node) => node.id)));
}

function undo(state: EditorState): EditorState {
  const previous = state.past.at(-1);
  if (!previous) return state;
  return {
    ...state,
    workflow: previous,
    past: state.past.slice(0, -1),
    future: [state.workflow, ...state.future],
    selection: NO_SELECTION,
  };
}

function redo(state: EditorState): EditorState {
  const [next, ...rest] = state.future;
  if (!next) return state;
  return {
    ...state,
    workflow: next,
    past: [...state.past, state.workflow].slice(-HISTORY_LIMIT),
    future: rest,
    selection: NO_SELECTION,
  };
}

function load(state: EditorState, action: Extract<EditorAction, { type: "load" }>): EditorState {
  const baseline = toDraft(action.baseline);
  return {
    ...initialState(),
    workflowId: action.workflowId,
    baseline,
    workflow: action.draft ?? baseline,
    baseVersion: action.baseVersion,
    mode: state.mode,
  };
}

export function reduce(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "load":
      return load(state, action);
    case "select":
      return { ...state, selection: action.selection };
    case "selectNodes":
      return { ...state, selection: nodesSelection(action.ids) };
    case "enterRun":
      return { ...state, mode: { kind: "run", runId: action.runId }, selection: NO_SELECTION };
    case "exitRun":
      return { ...state, mode: { kind: "edit" } };
    case "markSaved":
      return {
        ...state,
        baseline: state.workflow,
        baseVersion: action.version,
        past: [],
        future: [],
      };
    default:
      break;
  }
  if (state.mode.kind === "run") return state;
  switch (action.type) {
    case "addNode":
      return addNode(state, action.node, action.from, action.when);
    case "updateNode":
      return updateNode(state, action.id, action.node);
    case "deleteSelection":
      return deleteSelection(state);
    case "connect":
      return connect(state, action.source, action.target, action.when);
    case "updateEdge":
      return updateEdge(state, action.id, action.when);
    case "patchEdge":
      return patchEdge(state, action.id, action.patch);
    case "toggleNode":
      return { ...state, selection: toggleSelected(state.selection, action.id) };
    case "selectAll":
      return { ...state, selection: nodesSelection(state.workflow.nodes.map((n) => n.id)) };
    case "replace":
      return commit(state, toDraft(action.workflow), NO_SELECTION);
    case "paste":
      return paste(state, action.text);
    case "undo":
      return undo(state);
    case "redo":
      return redo(state);
    default:
      return state;
  }
}
