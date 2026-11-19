"use client";

import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  MarkerType,
  MiniMap,
  type NodeChange,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Bot, Brain, Copy, GitFork, PauseCircle, Pencil, Sparkles, Users, Wrench } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useWorkflowStore } from "@/stores/workflow-store";
import { formatLatency, NODE_META, type NodeExecutionLog, type NodeKind, type RawGraph, type RunDetail } from "@/types";
import { type WorkflowFlowNode, WorkflowNodeCard, type WorkflowNodeData } from "./WorkflowNodeCard";

const nodeTypes = {
  workflowNode: WorkflowNodeCard,
};

const DOCK_NODES: Array<{ kind: NodeKind; label: string; icon: typeof Bot }> = [
  { kind: "agent", label: "Agent", icon: Bot },
  { kind: "subagent", label: "Subagent", icon: Users },
  { kind: "decision", label: "Decision", icon: GitFork },
  { kind: "tool", label: "Tool", icon: Wrench },
  { kind: "skill", label: "Skill", icon: Sparkles },
  { kind: "checkpoint", label: "Checkpoint", icon: PauseCircle },
  { kind: "memory", label: "Memory", icon: Brain },
];

function nodeSubtitle(node: RawGraph["nodes"][number]): string {
  switch (node.type) {
    case "agent":
    case "subagent":
    case "decision":
      return typeof node.tier === "string" ? `tier: ${node.tier}` : node.id;
    case "tool":
      return typeof node.toolKind === "string" ? `tool: ${node.toolKind}` : node.id;
    case "skill":
      return typeof node.skillName === "string" && node.skillName ? `skill: ${node.skillName}` : node.id;
    case "memory":
      return typeof node.operation === "string" ? `op: ${node.operation}` : node.id;
    case "checkpoint":
      return node.allowStateEdit ? "HITL · editable" : "HITL · approval";
    default:
      return node.id;
  }
}

interface CanvasStageProps {
  graph: RawGraph | null;
  runDetail?: RunDetail | null;
  readOnly?: boolean;
  onEditGraph?: () => void;
  onForkSnapshot?: () => void;
  onNodeClick?: (nodeId: string) => void;
}

export function CanvasStage({
  graph,
  runDetail,
  readOnly = false,
  onEditGraph,
  onForkSnapshot,
  onNodeClick,
}: CanvasStageProps) {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const selectedEdgeId = useWorkflowStore((s) => s.selectedEdgeId);
  const addNode = useWorkflowStore((s) => s.addNode);
  const setNodePositions = useWorkflowStore((s) => s.setNodePositions);
  const removeNodes = useWorkflowStore((s) => s.removeNodes);
  const addEdge = useWorkflowStore((s) => s.addEdge);
  const removeEdges = useWorkflowStore((s) => s.removeEdges);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const selectEdge = useWorkflowStore((s) => s.selectEdge);

  const latestLogs = useMemo(() => {
    const map = new Map<string, NodeExecutionLog>();
    for (const item of runDetail?.history ?? []) {
      map.set(item.nodeId, item);
    }
    return map;
  }, [runDetail?.history]);

  const activeSet = useMemo(() => {
    const set = new Set<string>();
    if (runDetail?.status === "running") {
      if (runDetail.currentNodeId) set.add(runDetail.currentNodeId);
      for (const id of runDetail.activeNodeIds ?? []) set.add(id);
    }
    return set;
  }, [runDetail]);

  const traversedNodes = useMemo(() => {
    const set = new Set<string>();
    for (const item of runDetail?.history ?? []) {
      if (item.status === "done" || item.status === "running" || item.status === "waiting_checkpoint") {
        set.add(item.nodeId);
      }
    }
    return set;
  }, [runDetail?.history]);

  const flowNodes: WorkflowFlowNode[] = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.map((n, idx) => {
      const log = latestLogs.get(n.id);
      return {
        id: n.id,
        type: "workflowNode",
        position: n.position ?? { x: 80 + (idx % 3) * 280, y: 80 + Math.floor(idx / 3) * 150 },
        selected: selectedNodeId === n.id,
        draggable: !readOnly,
        data: {
          nodeId: n.id,
          kind: n.type,
          label: n.label,
          subtitle: nodeSubtitle(n),
          isEntry: graph.entryNode === n.id,
          queue: n.queue,
          isActive: activeSet.has(n.id),
          log,
          latency: formatLatency(log?.startedAt, log?.finishedAt),
        },
      };
    });
  }, [graph, latestLogs, activeSet, selectedNodeId, readOnly]);

  const flowEdges: Edge[] = useMemo(() => {
    if (!graph) return [];
    return graph.edges.map((e) => {
      const traversed = traversedNodes.has(e.source) && traversedNodes.has(e.target);
      const isSelected = selectedEdgeId === e.id;
      const stroke = isSelected ? "#10b981" : traversed ? "#38bdf8" : "#3f3f46";
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.condition || undefined,
        selected: isSelected,
        animated: traversed && runDetail?.status === "running",
        style: { stroke, strokeWidth: isSelected || traversed ? 2 : 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
      };
    });
  }, [graph, traversedNodes, selectedEdgeId, runDetail?.status]);

  const onNodesChange = useCallback(
    (changes: NodeChange<WorkflowFlowNode>[]) => {
      if (readOnly) return;
      const posUpdates: Array<{ id: string; position: { x: number; y: number } }> = [];
      const removed: string[] = [];
      for (const ch of changes) {
        if (ch.type === "position" && ch.position) {
          posUpdates.push({ id: ch.id, position: ch.position });
        } else if (ch.type === "remove") {
          removed.push(ch.id);
        }
      }
      if (posUpdates.length > 0) setNodePositions(posUpdates);
      if (removed.length > 0) removeNodes(removed);
    },
    [readOnly, setNodePositions, removeNodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (readOnly) return;
      const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
      if (removed.length > 0) removeEdges(removed);
    },
    [readOnly, removeEdges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      if (connection.source && connection.target) {
        addEdge(connection.source, connection.target);
      }
    },
    [readOnly, addEdge],
  );

  if (!graph) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-canvas text-center">
        <div className="text-[14px] font-medium text-text-primary">No workflow selected</div>
        <p className="max-w-xs text-[12px] text-text-secondary">
          Choose a workflow from the sidebar or create a new graph to start editing.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-canvas">
      {readOnly ? (
        <div className="pointer-events-auto absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-border-strong bg-surface/95 px-3 py-1.5 shadow-[0_6px_20px_rgba(0,0,0,0.45)]">
          <span className="text-[11px] font-medium text-text-secondary">Run Snapshot (Read-Only)</span>
          {onEditGraph ? (
            <Button variant="secondary" size="xs" onClick={onEditGraph}>
              <Pencil className="h-3 w-3" />
              Edit Graph
            </Button>
          ) : null}
          {onForkSnapshot ? (
            <Button variant="primary" size="xs" onClick={onForkSnapshot}>
              <Copy className="h-3 w-3" />
              Fork Snapshot
            </Button>
          ) : null}
        </div>
      ) : null}

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => {
          selectNode(node.id);
          onNodeClick?.(node.id);
        }}
        onEdgeClick={(_, edge) => selectEdge(edge.id)}
        onPaneClick={() => {
          selectNode(null);
          selectEdge(null);
        }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#27272a" />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          nodeColor={(n) => {
            const kind = (n.data as WorkflowNodeData | undefined)?.kind ?? "agent";
            return NODE_META[kind]?.color ?? "#6366f1";
          }}
          maskColor="rgba(9, 9, 11, 0.72)"
        />
      </ReactFlow>

      {!readOnly ? (
        <div className="pointer-events-auto absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border-strong bg-surface/95 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.6)]">
          {DOCK_NODES.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.kind}
                type="button"
                onClick={() => addNode(item.kind)}
                title={NODE_META[item.kind].hint}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors duration-150 hover:bg-elevated hover:text-text-primary"
              >
                <Icon className="h-3.5 w-3.5" style={{ color: NODE_META[item.kind].color }} />
                <span className="hidden md:inline">{item.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
