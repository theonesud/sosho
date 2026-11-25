"use client";

import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  MiniMap,
  type Node,
  type NodeChange,
  type OnConnectEnd,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertTriangle,
  Bot,
  Brain,
  Cable,
  Copy,
  GitFork,
  LayoutGrid,
  PanelLeft,
  PauseCircle,
  Pencil,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Sparkles,
  Square,
  Undo2,
  Users,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  checkNodeCompatibility,
  extractTemplateVariables,
  formatLatency,
  NODE_META,
  type NodeExecutionLog,
  type NodeKind,
  type NodePort,
  type PortDataType,
  type RawGraph,
  type RawGraphNode,
  type RunDetail,
  type SkillInfo,
  validateGraphIssues,
  type WorkflowVersion,
} from "@/types";
import { PatchCableEdge, type PatchCableEdgeData } from "./PatchCableEdge";
import { type WorkflowFlowNode, WorkflowNodeCard } from "./WorkflowNodeCard";
import { type ZipTieFlowNode, ZipTieNode } from "./ZipTieNode";

const nodeTypes = {
  workflowNode: WorkflowNodeCard,
  zipTie: ZipTieNode,
};

const edgeTypes = {
  patchCable: PatchCableEdge,
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

function deriveNodePorts(node: RawGraphNode): { inputs: NodePort[]; outputs: NodePort[] } {
  const inputType: PortDataType = node.inputType ?? "any";
  const outputKey = typeof node.outputKey === "string" && node.outputKey ? node.outputKey : "output";

  const defaultInputs: NodePort[] = node.inputs?.length
    ? node.inputs
    : [{ id: "in", name: node.type === "memory" ? "query" : "in", type: inputType === "any" ? "text" : inputType }];

  if (node.outputs?.length) {
    return { inputs: defaultInputs, outputs: node.outputs };
  }

  switch (node.type) {
    case "decision": {
      const branches =
        Array.isArray(node.branches) && node.branches.length > 0 ? (node.branches as string[]) : ["yes", "no"];
      return {
        inputs: defaultInputs,
        outputs: branches.map((b) => ({ id: b, name: b, type: "boolean" as const })),
      };
    }
    case "checkpoint":
      return {
        inputs: [{ id: "in", name: "state", type: "any" }],
        outputs: [
          { id: "approve", name: "approve", type: "boolean" },
          { id: "reject", name: "reject", type: "boolean" },
        ],
      };
    case "tool":
      return {
        inputs: defaultInputs,
        outputs: [{ id: outputKey, name: outputKey, type: node.toolKind === "yue2" ? "audio" : "text" }],
      };
    case "memory":
      return {
        inputs: defaultInputs,
        outputs: [{ id: outputKey, name: outputKey, type: "memory" }],
      };
    default:
      return {
        inputs: defaultInputs,
        outputs: [{ id: outputKey, name: outputKey, type: "markdown" }],
      };
  }
}

function wouldCreateCycle(graph: RawGraph, source: string, target: string): boolean {
  if (source === target) return true;
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  const queue = [target];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const curr = queue.shift();
    if (!curr || visited.has(curr)) continue;
    if (curr === source) return true;
    visited.add(curr);
    for (const next of adj.get(curr) ?? []) {
      queue.push(next);
    }
  }
  return false;
}

export interface CanvasStageProps {
  graph: RawGraph | null;
  runDetail?: RunDetail | null;
  isLoading?: boolean;
  readOnly?: boolean;
  drawerOpen?: boolean;
  onToggleDrawer?: () => void;
  isDirty?: boolean;
  isSaving?: boolean;
  isStartingRun?: boolean;
  saveStatus?: string | null;
  versions?: WorkflowVersion[];
  availableSkills?: Array<string | SkillInfo>;
  modelCatalog?: unknown[];
  onSaveWorkflow?: () => void;
  onStartRun?: (initialData: Record<string, unknown>) => void;
  onCancelRun?: () => void;
  onRestoreVersion?: (version: WorkflowVersion) => void;
  onCreateStarterGraph?: (kind: NodeKind) => void;
  onEditGraph?: () => void;
  onForkSnapshot?: () => void;
  onRollbackRun?: (toStep?: number) => void;
  onNodeClick?: (nodeId: string) => void;
}

interface QuickAddMenuState {
  screenX: number;
  screenY: number;
  flowX: number;
  flowY: number;
  connectFromId?: string;
  condition?: string;
  sourcePort?: string;
}

function RackCanvasInner({
  graph,
  runDetail,
  isLoading = false,
  readOnly = false,
  drawerOpen = true,
  onToggleDrawer,
  isDirty = false,
  isSaving = false,
  isStartingRun = false,
  saveStatus = null,
  onSaveWorkflow,
  onStartRun,
  onCancelRun,
  onCreateStarterGraph,
  onEditGraph,
  onForkSnapshot,
  onRollbackRun,
  onNodeClick,
}: CanvasStageProps) {
  const { screenToFlowPosition, fitView } = useReactFlow();

  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const selectedEdgeId = useWorkflowStore((s) => s.selectedEdgeId);
  const canUndo = useWorkflowStore((s) => s.past.length > 0);
  const canRedo = useWorkflowStore((s) => s.future.length > 0);

  const addNode = useWorkflowStore((s) => s.addNode);
  const duplicateNode = useWorkflowStore((s) => s.duplicateNode);
  const toggleNodeFlag = useWorkflowStore((s) => s.toggleNodeFlag);
  const setNodePositions = useWorkflowStore((s) => s.setNodePositions);
  const removeNodes = useWorkflowStore((s) => s.removeNodes);
  const addEdge = useWorkflowStore((s) => s.addEdge);
  const rewireEdge = useWorkflowStore((s) => s.rewireEdge);
  const removeEdges = useWorkflowStore((s) => s.removeEdges);
  const addZipTie = useWorkflowStore((s) => s.addZipTie);
  const moveZipTie = useWorkflowStore((s) => s.moveZipTie);
  const attachEdgeToZipTie = useWorkflowStore((s) => s.attachEdgeToZipTie);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const selectEdge = useWorkflowStore((s) => s.selectEdge);
  const undo = useWorkflowStore((s) => s.undo);
  const redo = useWorkflowStore((s) => s.redo);

  const [runInputs, setRunInputs] = useState<Record<string, string>>({ topic: "local AI architecture" });
  const [quickAdd, setQuickAdd] = useState<QuickAddMenuState | null>(null);
  const pendingConnectRef = useRef<{ nodeId: string; handleId: string | null } | null>(null);
  const reconnectSuccessRef = useRef(true);

  const templateVars = useMemo(() => {
    if (!graph) return ["topic"];
    const vars = extractTemplateVariables(graph);
    return vars.length > 0 ? vars : ["topic"];
  }, [graph]);

  const graphIssues = useMemo(() => (graph ? validateGraphIssues(graph) : []), [graph]);

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

  const nodePortMap = useMemo(() => {
    const map = new Map<string, { inputs: NodePort[]; outputs: NodePort[] }>();
    for (const n of graph?.nodes ?? []) {
      map.set(n.id, deriveNodePorts(n));
    }
    return map;
  }, [graph?.nodes]);

  const handleGatherNearby = useCallback(
    (zipTieId: string) => {
      if (!graph) return;
      const zt = (graph.zipTies ?? []).find((z) => z.id === zipTieId);
      if (!zt) return;
      const posMap = new Map(
        graph.nodes.map((n, idx) => [
          n.id,
          n.position ?? { x: 80 + (idx % 3) * 340, y: 80 + Math.floor(idx / 3) * 220 },
        ]),
      );
      for (const edge of graph.edges) {
        const sp = posMap.get(edge.source);
        const tp = posMap.get(edge.target);
        if (!sp || !tp) continue;
        const mx = (sp.x + 140 + tp.x + 140) * 0.5;
        const my = (sp.y + 80 + tp.y + 80) * 0.5;
        if (Math.hypot(mx - zt.position.x, my - zt.position.y) < 320) {
          attachEdgeToZipTie(zipTieId, edge.id);
        }
      }
    },
    [graph, attachEdgeToZipTie],
  );

  const handleTidyLayout = useCallback(() => {
    if (!graph || graph.nodes.length === 0) return;
    const adj = new Map<string, string[]>();
    for (const e of graph.edges) {
      const list = adj.get(e.source) ?? [];
      list.push(e.target);
      adj.set(e.source, list);
    }
    const levels = new Map<string, number>();
    const queue: Array<{ id: string; level: number }> = [];
    if (graph.entryNode) queue.push({ id: graph.entryNode, level: 0 });
    while (queue.length > 0) {
      const curr = queue.shift();
      if (!curr) continue;
      const prev = levels.get(curr.id);
      if (prev !== undefined && prev >= curr.level) continue;
      levels.set(curr.id, curr.level);
      for (const next of adj.get(curr.id) ?? []) {
        queue.push({ id: next, level: curr.level + 1 });
      }
    }
    for (const n of graph.nodes) {
      if (!levels.has(n.id)) levels.set(n.id, 0);
    }
    const rowsByLevel = new Map<number, string[]>();
    for (const n of graph.nodes) {
      const lvl = levels.get(n.id) ?? 0;
      const arr = rowsByLevel.get(lvl) ?? [];
      arr.push(n.id);
      rowsByLevel.set(lvl, arr);
    }
    const updates: Array<{ id: string; position: { x: number; y: number } }> = [];
    for (const [lvl, ids] of rowsByLevel.entries()) {
      ids.forEach((id, rowIdx) => {
        updates.push({ id, position: { x: 80 + lvl * 380, y: 80 + rowIdx * 280 } });
      });
    }
    setNodePositions(updates);
    setTimeout(() => void fitView({ padding: 0.2, duration: 250 }), 30);
  }, [graph, setNodePositions, fitView]);

  const flowNodes: Array<Node> = useMemo(() => {
    if (!graph) return [];
    const workflowNodes: WorkflowFlowNode[] = graph.nodes.map((n, idx) => {
      const log = latestLogs.get(n.id);
      const ports = nodePortMap.get(n.id) ?? { inputs: [], outputs: [] };
      const locked = Boolean(n.uiFlags?.locked);
      return {
        id: n.id,
        type: "workflowNode",
        position: n.position ?? { x: 80 + (idx % 3) * 340, y: 80 + Math.floor(idx / 3) * 240 },
        selected: selectedNodeId === n.id,
        draggable: !readOnly && !locked,
        data: {
          nodeId: n.id,
          kind: n.type,
          label: n.label,
          rawNode: n,
          isEntry: graph.entryNode === n.id,
          queue: n.queue,
          isActive: activeSet.has(n.id),
          readOnly,
          log,
          latency: formatLatency(log?.startedAt, log?.finishedAt),
          inputs: ports.inputs,
          outputs: ports.outputs,
        },
      };
    });

    const zipTieNodes: ZipTieFlowNode[] = (graph.zipTies ?? []).map((zt) => ({
      id: zt.id,
      type: "zipTie",
      position: zt.position,
      draggable: !readOnly,
      data: {
        zipTieId: zt.id,
        edgeIds: zt.edgeIds,
        label: zt.label,
        onGatherNearby: readOnly ? undefined : handleGatherNearby,
      },
    }));

    return [...workflowNodes, ...zipTieNodes];
  }, [graph, latestLogs, nodePortMap, selectedNodeId, readOnly, activeSet, handleGatherNearby]);

  const flowEdges: Edge[] = useMemo(() => {
    if (!graph) return [];
    const zipTies = graph.zipTies ?? [];
    return graph.edges.map((e) => {
      const active = activeSet.has(e.target) || activeSet.has(e.source);
      const traversed = traversedNodes.has(e.source) && traversedNodes.has(e.target);
      const srcPorts = nodePortMap.get(e.source)?.outputs ?? [];
      const sourceHandle = e.condition ?? e.middleware?.sourcePort ?? srcPorts[0]?.id;
      const srcPort = srcPorts.find((p) => p.id === sourceHandle) ?? srcPorts[0];
      const attachedZips = zipTies.filter((zt) => zt.edgeIds.includes(e.id));

      const data: PatchCableEdgeData = {
        portType: srcPort?.type ?? "any",
        condition: e.condition,
        middleware: e.middleware,
        isActive: active,
        isTraversed: traversed,
        zipTies: attachedZips,
      };

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle,
        targetHandle: e.middleware?.targetPort,
        type: "patchCable",
        selected: selectedEdgeId === e.id,
        data,
      };
    });
  }, [graph, activeSet, traversedNodes, nodePortMap, selectedEdgeId]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (readOnly) return;
      const posUpdates: Array<{ id: string; position: { x: number; y: number } }> = [];
      const removed: string[] = [];
      for (const ch of changes) {
        if (ch.type === "position" && ch.position) {
          if (ch.id.startsWith("zt_")) {
            moveZipTie(ch.id, ch.position, !ch.dragging);
          } else if (!ch.dragging) {
            posUpdates.push({ id: ch.id, position: ch.position });
          }
        } else if (ch.type === "remove") {
          if (!ch.id.startsWith("zt_")) {
            removed.push(ch.id);
          }
        }
      }
      if (posUpdates.length > 0) setNodePositions(posUpdates);
      if (removed.length > 0) removeNodes(removed);
    },
    [readOnly, setNodePositions, removeNodes, moveZipTie],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (readOnly) return;
      const removed = changes.filter((ch) => ch.type === "remove").map((ch) => ch.id);
      if (removed.length > 0) removeEdges(removed);
    },
    [readOnly, removeEdges],
  );

  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      if (!graph || !connection.source || !connection.target) return false;
      if (wouldCreateCycle(graph, connection.source, connection.target)) return false;
      if (graph.policy?.strictCompatibility) {
        const srcNode = graph.nodes.find((n) => n.id === connection.source);
        const tgtNode = graph.nodes.find((n) => n.id === connection.target);
        if (
          srcNode &&
          tgtNode &&
          checkNodeCompatibility(
            srcNode,
            tgtNode,
            {
              id: "preview",
              source: srcNode.id,
              target: tgtNode.id,
              middleware: {
                sourcePort: connection.sourceHandle ?? undefined,
                targetPort: connection.targetHandle ?? undefined,
              },
            },
            true,
          ) === "incompatible"
        ) {
          return false;
        }
      }
      return true;
    },
    [graph],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (readOnly || !connection.source || !connection.target) return;
      const sourceNode = graph?.nodes.find((n) => n.id === connection.source);
      const isBranching = sourceNode?.type === "decision" || sourceNode?.type === "checkpoint";
      const condition = isBranching && connection.sourceHandle ? connection.sourceHandle : undefined;
      addEdge(connection.source, connection.target, condition, {
        sourcePort: connection.sourceHandle ?? undefined,
        targetPort: connection.targetHandle ?? undefined,
      });
    },
    [readOnly, graph, addEdge],
  );

  const handleReconnectStart = useCallback(() => {
    reconnectSuccessRef.current = false;
  }, []);

  const handleReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      reconnectSuccessRef.current = true;
      if (readOnly || !newConnection.source || !newConnection.target) return;
      const sourceNode = graph?.nodes.find((n) => n.id === newConnection.source);
      const isBranching = sourceNode?.type === "decision" || sourceNode?.type === "checkpoint";
      const condition = isBranching && newConnection.sourceHandle ? newConnection.sourceHandle : undefined;
      rewireEdge(oldEdge.id, newConnection.source, newConnection.target, condition);
    },
    [readOnly, graph, rewireEdge],
  );

  const handleReconnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, edge: Edge) => {
      if (!reconnectSuccessRef.current && !readOnly) {
        removeEdges([edge.id]);
      }
      reconnectSuccessRef.current = true;
    },
    [readOnly, removeEdges],
  );

  const handleConnectStart = useCallback(
    (_event: unknown, params: { nodeId: string | null; handleId: string | null }) => {
      if (params.nodeId) {
        pendingConnectRef.current = { nodeId: params.nodeId, handleId: params.handleId };
      }
    },
    [],
  );

  const handleConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      if (readOnly || connectionState.isValid || !pendingConnectRef.current) {
        pendingConnectRef.current = null;
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && !target.classList.contains("react-flow__pane")) {
        pendingConnectRef.current = null;
        return;
      }
      const clientX = "clientX" in event ? event.clientX : (event.touches[0]?.clientX ?? 300);
      const clientY = "clientY" in event ? event.clientY : (event.touches[0]?.clientY ?? 300);
      const flowPos = screenToFlowPosition({ x: clientX, y: clientY });
      const pending = pendingConnectRef.current;
      pendingConnectRef.current = null;

      const sourceNode = graph?.nodes.find((n) => n.id === pending.nodeId);
      const isBranching = sourceNode?.type === "decision" || sourceNode?.type === "checkpoint";
      setQuickAdd({
        screenX: clientX,
        screenY: clientY,
        flowX: flowPos.x,
        flowY: flowPos.y,
        connectFromId: pending.nodeId,
        condition: isBranching && pending.handleId ? pending.handleId : undefined,
        sourcePort: pending.handleId ?? undefined,
      });
    },
    [readOnly, screenToFlowPosition, graph],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "d" || e.key === "D") && selectedNodeId && !readOnly) {
        e.preventDefault();
        duplicateNode(selectedNodeId);
      } else if (e.key === "/" && !readOnly && graph) {
        e.preventDefault();
        const center = screenToFlowPosition({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.45 });
        setQuickAdd({
          screenX: window.innerWidth * 0.55,
          screenY: window.innerHeight * 0.45,
          flowX: center.x,
          flowY: center.y,
        });
      } else if ((e.key === "b" || e.key === "B") && selectedNodeId && !readOnly) {
        toggleNodeFlag(selectedNodeId, "bypass");
      } else if ((e.key === "l" || e.key === "L") && selectedNodeId && !readOnly) {
        toggleNodeFlag(selectedNodeId, "locked");
      } else if (e.key === "f" || e.key === "F") {
        void fitView({ padding: 0.22, duration: 220 });
      } else if (e.key === "Escape") {
        setQuickAdd(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly, graph, screenToFlowPosition, selectedNodeId, toggleNodeFlag, duplicateNode, fitView]);

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#09090b] p-8">
        <div className="w-full max-w-md space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#09090b] px-4 text-center">
        <p className="text-[14px] font-medium text-zinc-200">Select or create a workflow</p>
        {onCreateStarterGraph ? (
          <div className="flex flex-wrap justify-center gap-2">
            {DOCK_NODES.slice(0, 4).map((item) => {
              const Icon = item.icon;
              return (
                <Button key={item.kind} variant="secondary" size="sm" onClick={() => onCreateStarterGraph(item.kind)}>
                  <Icon className="h-3.5 w-3.5" />
                  Start with {item.label}
                </Button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  const isRunning = runDetail?.status === "running" || runDetail?.status === "waiting_checkpoint";

  return (
    <div className="relative h-full w-full bg-[#09090b]">
      {/* Smoked glass top transport bar */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-center justify-between gap-2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-zinc-800/90 bg-zinc-950/85 px-2.5 py-1.5 shadow-xl backdrop-blur-xl">
          {onToggleDrawer ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleDrawer}
              title={drawerOpen ? "Hide source" : "Show source"}
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <span className="text-[13px] font-semibold text-zinc-100">{graph.name}</span>
          {isDirty ? (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">Unsaved</span>
          ) : null}
          {graphIssues.length > 0 ? (
            <span
              title={graphIssues.map((i) => i.message).join("\n")}
              className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-300"
            >
              <AlertTriangle className="h-3 w-3" />
              {graphIssues.length}
            </span>
          ) : null}
          {saveStatus ? <span className="font-mono text-[10px] text-zinc-400">{saveStatus}</span> : null}
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-800/90 bg-zinc-950/85 px-2.5 py-1.5 shadow-xl backdrop-blur-xl">
          {!readOnly ? (
            <>
              <Button variant="ghost" size="sm" disabled={!canUndo} onClick={undo} title="Undo">
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" disabled={!canRedo} onClick={redo} title="Redo">
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleTidyLayout} title="Auto-arrange modules">
                <LayoutGrid className="h-3.5 w-3.5" />
              </Button>
              {templateVars.slice(0, 3).map((varName) => (
                <Input
                  key={varName}
                  value={runInputs[varName] ?? ""}
                  onChange={(e) => setRunInputs((prev) => ({ ...prev, [varName]: e.target.value }))}
                  placeholder={`${varName}...`}
                  title={`Input variable: ${varName}`}
                  className="h-7 w-32 border-zinc-800 bg-zinc-900/90 font-mono text-[11px]"
                />
              ))}
              {onSaveWorkflow ? (
                <Button variant="secondary" size="sm" disabled={isSaving} onClick={onSaveWorkflow}>
                  <Save className="h-3.5 w-3.5" />
                  {isSaving ? "Saving" : "Save"}
                </Button>
              ) : null}
              {onStartRun ? (
                <Button size="sm" disabled={isStartingRun} onClick={() => onStartRun(runInputs)}>
                  <Play className="h-3.5 w-3.5" />
                  {isStartingRun ? "Starting" : "Run"}
                </Button>
              ) : null}
            </>
          ) : (
            <>
              {isRunning && onCancelRun ? (
                <Button variant="danger" size="sm" onClick={onCancelRun}>
                  <Square className="h-3 w-3" />
                  Stop
                </Button>
              ) : null}
              {onRollbackRun ? (
                <Button variant="secondary" size="sm" onClick={() => onRollbackRun()}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Rollback
                </Button>
              ) : null}
              {onForkSnapshot ? (
                <Button variant="secondary" size="sm" onClick={onForkSnapshot}>
                  <Copy className="h-3.5 w-3.5" />
                  Fork Snapshot
                </Button>
              ) : null}
              {onEditGraph ? (
                <Button size="sm" onClick={onEditGraph}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit Workflow
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        isValidConnection={isValidConnection}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onReconnectStart={handleReconnectStart}
        onReconnect={handleReconnect}
        onReconnectEnd={handleReconnectEnd}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onNodeClick={(_e, node) => {
          if (node.type === "zipTie") return;
          selectNode(node.id);
          onNodeClick?.(node.id);
        }}
        onEdgeClick={(_e, edge) => selectEdge(edge.id)}
        onPaneClick={() => {
          selectNode(null);
          selectEdge(null);
          setQuickAdd(null);
        }}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        edgesReconnectable={!readOnly}
        elementsSelectable
        selectionOnDrag
        deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
        defaultEdgeOptions={{ type: "patchCable" }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="#27272a" />
        <Controls showInteractive={!readOnly} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => {
            if (node.type === "zipTie") return "#10b981";
            const kind = (node.data as { kind?: NodeKind } | undefined)?.kind ?? "agent";
            return NODE_META[kind]?.color ?? "#3f3f46";
          }}
        />
      </ReactFlow>

      {/* Drag-cable or `/` quick-add menu */}
      {quickAdd && !readOnly ? (
        <div
          style={{ left: quickAdd.screenX, top: quickAdd.screenY }}
          className="fixed z-30 w-44 -translate-x-1/2 -translate-y-2 rounded-lg border border-zinc-700/90 bg-zinc-950/95 p-1.5 shadow-2xl backdrop-blur-xl"
        >
          <div className="mb-1 px-1.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
            Patch Module
          </div>
          {DOCK_NODES.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.kind}
                type="button"
                onClick={() => {
                  addNode(item.kind, {
                    position: { x: quickAdd.flowX, y: quickAdd.flowY },
                    connectFromId: quickAdd.connectFromId,
                    condition: quickAdd.condition,
                    sourcePort: quickAdd.sourcePort,
                  });
                  setQuickAdd(null);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] text-zinc-200 transition hover:bg-zinc-800/90"
              >
                <Icon className="h-3.5 w-3.5" style={{ color: NODE_META[item.kind].color }} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Bottom hardware dock */}
      {!readOnly ? (
        <div className="pointer-events-auto absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-zinc-800/90 bg-zinc-950/90 px-2 py-1.5 shadow-2xl backdrop-blur-xl">
          {DOCK_NODES.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.kind}
                variant="ghost"
                size="sm"
                onClick={() =>
                  addNode(item.kind, {
                    connectFromId: selectedNodeId ?? undefined,
                  })
                }
                className="h-7 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white"
              >
                <Icon className="h-3.5 w-3.5" style={{ color: NODE_META[item.kind].color }} />
                <span className="hidden sm:inline">{item.label}</span>
              </Button>
            );
          })}
          <span className="mx-1 h-4 w-px bg-zinc-800" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const center = screenToFlowPosition({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.5 });
              addZipTie(center);
            }}
            className="h-7 px-2 text-[11px] text-emerald-300 hover:bg-emerald-500/15"
            title="Drop a cable zip-tie collar"
          >
            <Cable className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Zip-Tie</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function CanvasStage(props: CanvasStageProps) {
  return (
    <ReactFlowProvider>
      <RackCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
