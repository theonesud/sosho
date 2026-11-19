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

interface WorkflowState {
  graph: RawGraph | null;
  isDirty: boolean;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  saveStatus: string | null;

  setGraph: (graph: RawGraph | null, dirty?: boolean) => void;
  updateGraphMeta: (patch: Partial<Pick<RawGraph, "id" | "name" | "description" | "entryNode" | "maxSteps">>) => void;
  addNode: (kind: NodeKind) => RawGraphNode | null;
  updateNode: (nodeId: string, patch: Record<string, unknown>) => void;
  setNodePositions: (updates: Array<{ id: string; position: { x: number; y: number } }>) => void;
  removeNodes: (nodeIds: string[]) => void;
  addEdge: (source: string, target: string, condition?: string) => void;
  updateEdge: (edgeId: string, patch: Partial<RawGraphEdge>) => void;
  removeEdges: (edgeIds: string[]) => void;
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;
  markSaved: (message?: string) => void;
  setSaveStatus: (message: string | null) => void;
  forkSnapshot: (snapshot: RawGraph) => RawGraph;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  graph: null,
  isDirty: false,
  selectedNodeId: null,
  selectedEdgeId: null,
  saveStatus: null,

  setGraph: (graph, dirty = false) =>
    set({
      graph: graph ? structuredClone(graph) : null,
      isDirty: dirty,
      selectedNodeId: null,
      selectedEdgeId: null,
    }),

  updateGraphMeta: (patch) =>
    set((state) => {
      if (!state.graph) return state;
      return {
        graph: { ...state.graph, ...patch },
        isDirty: true,
      };
    }),

  addNode: (kind) => {
    const current = get().graph;
    if (!current) return null;
    let idx = current.nodes.length + 1;
    while (current.nodes.some((n) => n.id === `${kind}_${idx}`)) {
      idx += 1;
    }
    const created = defaultNodeProps(kind, idx);
    const entryNode = current.entryNode || created.id;
    set({
      graph: {
        ...current,
        entryNode,
        nodes: [...current.nodes, created],
      },
      isDirty: true,
      selectedNodeId: created.id,
      selectedEdgeId: null,
    });
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
        if (n.position?.x === nextPos.x && n.position?.y === nextPos.y) return n;
        changed = true;
        return { ...n, position: { x: Math.round(nextPos.x), y: Math.round(nextPos.y) } };
      });
      if (!changed) return state;
      return {
        graph: { ...state.graph, nodes },
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
        isDirty: true,
        selectedEdgeId: state.selectedEdgeId && removeSet.has(state.selectedEdgeId) ? null : state.selectedEdgeId,
      };
    }),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId, selectedEdgeId: null }),
  selectEdge: (edgeId) => set({ selectedEdgeId: edgeId, selectedNodeId: null }),
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
