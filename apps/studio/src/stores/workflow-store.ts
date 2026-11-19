"use client";

import { create } from "zustand";
import type { NodeKind, RawGraph, RawGraphEdge, RawGraphNode } from "@/types";

function defaultNodeProps(kind: NodeKind, index: number): RawGraphNode {
  const id = `${kind}_${index}`;
  const base: RawGraphNode = {
    id,
    type: kind,
    label: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${index}`,
    position: { x: 160 + (index % 4) * 60, y: 120 + (index % 4) * 50 },
  };
  switch (kind) {
    case "agent":
      return { ...base, tier: "main", promptTemplate: "Analyze {{topic}}", outputKey: `${id}_out` };
    case "subagent":
      return {
        ...base,
        role: "Researcher",
        tier: "subagent",
        promptTemplate: "Research {{topic}}",
        outputKey: `${id}_out`,
      };
    case "decision":
      return {
        ...base,
        tier: "decision",
        promptTemplate: "Choose the next branch for {{topic}}",
        branches: ["yes", "no"],
      };
    case "tool":
      return {
        ...base,
        toolKind: "shell",
        commandOrUrl: "echo ok",
        outputKey: `${id}_out`,
      };
    case "skill":
      return {
        ...base,
        skillName: "",
        promptTemplate: "Run skill for {{topic}}",
        outputKey: `${id}_out`,
      };
    case "checkpoint":
      return {
        ...base,
        message: "Review intermediate output and approve to continue.",
        allowStateEdit: true,
      };
    case "memory":
      return {
        ...base,
        operation: "search",
        scope: "both",
        queryOrTitleTemplate: "{{topic}}",
        outputKey: `${id}_out`,
      };
  }
}

const MAX_HISTORY = 40;

function pushHistory(past: RawGraph[], current: RawGraph): RawGraph[] {
  const next = [...past, structuredClone(current)];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

interface WorkflowState {
  graph: RawGraph | null;
  past: RawGraph[];
  future: RawGraph[];
  isDirty: boolean;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  saveStatus: string | null;

  setGraph: (graph: RawGraph | null, dirty?: boolean) => void;
  updateGraphMeta: (patch: Partial<Pick<RawGraph, "id" | "name" | "description" | "entryNode" | "maxSteps">>) => void;
  addNode: (
    kind: NodeKind,
    options?: { position?: { x: number; y: number }; connectFromId?: string },
  ) => RawGraphNode | null;
  updateNode: (nodeId: string, patch: Record<string, unknown>) => void;
  setNodePositions: (updates: Array<{ id: string; position: { x: number; y: number } }>) => void;
  removeNodes: (nodeIds: string[]) => void;
  addEdge: (source: string, target: string, condition?: string) => void;
  updateEdge: (edgeId: string, patch: Partial<RawGraphEdge>) => void;
  removeEdges: (edgeIds: string[]) => void;
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (message?: string) => void;
  setSaveStatus: (message: string | null) => void;
  forkSnapshot: (snapshot: RawGraph) => RawGraph;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  graph: null,
  past: [],
  future: [],
  isDirty: false,
  selectedNodeId: null,
  selectedEdgeId: null,
  saveStatus: null,

  setGraph: (graph, dirty = false) =>
    set({
      graph: graph ? structuredClone(graph) : null,
      past: [],
      future: [],
      isDirty: dirty,
      selectedNodeId: null,
      selectedEdgeId: null,
    }),

  updateGraphMeta: (patch) =>
    set((state) => {
      if (!state.graph) return state;
      return {
        graph: { ...state.graph, ...patch },
        past: pushHistory(state.past, state.graph),
        future: [],
        isDirty: true,
      };
    }),

  addNode: (kind, options) => {
    const current = get().graph;
    if (!current) return null;
    let idx = current.nodes.length + 1;
    while (current.nodes.some((n) => n.id === `${kind}_${idx}`)) {
      idx += 1;
    }
    const created = defaultNodeProps(kind, idx);
    if (options?.position) {
      created.position = {
        x: Math.round(options.position.x),
        y: Math.round(options.position.y),
      };
    }
    const entryNode = current.entryNode || created.id;
    const nextEdges = [...current.edges];
    if (options?.connectFromId && current.nodes.some((n) => n.id === options.connectFromId)) {
      const edgeId = `e_${options.connectFromId}_${created.id}_${Date.now().toString(36).slice(-4)}`;
      nextEdges.push({ id: edgeId, source: options.connectFromId, target: created.id });
    }
    set((state) => ({
      graph: {
        ...current,
        entryNode,
        nodes: [...current.nodes, created],
        edges: nextEdges,
      },
      past: pushHistory(state.past, current),
      future: [],
      isDirty: true,
      selectedNodeId: created.id,
      selectedEdgeId: null,
    }));
    return created;
  },

  updateNode: (nodeId, patch) =>
    set((state) => {
      if (!state.graph) return state;
      return {
        graph: {
          ...state.graph,
          nodes: state.graph.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
        },
        past: pushHistory(state.past, state.graph),
        future: [],
        isDirty: true,
      };
    }),

  setNodePositions: (updates) =>
    set((state) => {
      if (!state.graph || updates.length === 0) return state;
      const map = new Map(updates.map((u) => [u.id, u.position]));
      let changed = false;
      const nodes = state.graph.nodes.map((n) => {
        const nextPos = map.get(n.id);
        if (!nextPos) return n;
        const rx = Math.round(nextPos.x);
        const ry = Math.round(nextPos.y);
        if (n.position?.x === rx && n.position?.y === ry) return n;
        changed = true;
        return { ...n, position: { x: rx, y: ry } };
      });
      if (!changed) return state;
      return {
        graph: { ...state.graph, nodes },
        past: pushHistory(state.past, state.graph),
        future: [],
        isDirty: true,
      };
    }),

  removeNodes: (nodeIds) =>
    set((state) => {
      if (!state.graph || nodeIds.length === 0) return state;
      const removeSet = new Set(nodeIds);
      const nodes = state.graph.nodes.filter((n) => !removeSet.has(n.id));
      const edges = state.graph.edges.filter((e) => !removeSet.has(e.source) && !removeSet.has(e.target));
      const entryNode = removeSet.has(state.graph.entryNode) ? (nodes[0]?.id ?? "") : state.graph.entryNode;
      return {
        graph: { ...state.graph, entryNode, nodes, edges },
        past: pushHistory(state.past, state.graph),
        future: [],
        isDirty: true,
        selectedNodeId: state.selectedNodeId && removeSet.has(state.selectedNodeId) ? null : state.selectedNodeId,
      };
    }),

  addEdge: (source, target, condition) =>
    set((state) => {
      if (!state.graph || !source || !target || source === target) return state;
      const exists = state.graph.edges.some(
        (e) => e.source === source && e.target === target && (e.condition ?? "") === (condition ?? ""),
      );
      if (exists) return state;
      const id = `e_${source}_${target}_${Date.now().toString(36).slice(-4)}`;
      const nextEdge: RawGraphEdge = condition ? { id, source, target, condition } : { id, source, target };
      return {
        graph: {
          ...state.graph,
          edges: [...state.graph.edges, nextEdge],
        },
        past: pushHistory(state.past, state.graph),
        future: [],
        isDirty: true,
        selectedEdgeId: id,
        selectedNodeId: null,
      };
    }),

  updateEdge: (edgeId, patch) =>
    set((state) => {
      if (!state.graph) return state;
      return {
        graph: {
          ...state.graph,
          edges: state.graph.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)),
        },
        past: pushHistory(state.past, state.graph),
        future: [],
        isDirty: true,
      };
    }),

  removeEdges: (edgeIds) =>
    set((state) => {
      if (!state.graph || edgeIds.length === 0) return state;
      const removeSet = new Set(edgeIds);
      return {
        graph: {
          ...state.graph,
          edges: state.graph.edges.filter((e) => !removeSet.has(e.id)),
        },
        past: pushHistory(state.past, state.graph),
        future: [],
        isDirty: true,
        selectedEdgeId: state.selectedEdgeId && removeSet.has(state.selectedEdgeId) ? null : state.selectedEdgeId,
      };
    }),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId, selectedEdgeId: null }),
  selectEdge: (edgeId) => set({ selectedEdgeId: edgeId, selectedNodeId: null }),

  undo: () =>
    set((state) => {
      if (!state.graph || state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        graph: previous,
        past: state.past.slice(0, -1),
        future: [structuredClone(state.graph), ...state.future].slice(0, MAX_HISTORY),
        isDirty: true,
        selectedNodeId: null,
        selectedEdgeId: null,
      };
    }),

  redo: () =>
    set((state) => {
      if (!state.graph || state.future.length === 0) return state;
      const next = state.future[0];
      return {
        graph: next,
        past: pushHistory(state.past, state.graph),
        future: state.future.slice(1),
        isDirty: true,
        selectedNodeId: null,
        selectedEdgeId: null,
      };
    }),

  markSaved: (message) => set({ isDirty: false, saveStatus: message ?? "Saved" }),
  setSaveStatus: (message) => set({ saveStatus: message }),

  forkSnapshot: (snapshot) => {
    const forked: RawGraph = {
      ...structuredClone(snapshot),
      id: `${snapshot.id}-fork-${Date.now().toString(36).slice(-4)}`,
      name: `${snapshot.name} (Fork)`,
    };
    set({
      graph: forked,
      isDirty: true,
      selectedNodeId: null,
      selectedEdgeId: null,
      saveStatus: "Forked snapshot into editor",
    });
    return forked;
  },
}));
