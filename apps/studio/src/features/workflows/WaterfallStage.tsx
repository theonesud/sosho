"use client";

import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  GitBranch,
  GitFork,
  Loader2,
  PauseCircle,
  Plus,
  Sparkles,
  Trash2,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn, normalizeSkills } from "@/lib/utils";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  MODEL_TIERS,
  NODE_META,
  type NodeExecutionLog,
  type NodeKind,
  QUEUE_LANES,
  type RawGraph,
  type RawGraphNode,
  type RunDetail,
  type SkillInfo,
} from "@/types";

interface WaterfallStageProps {
  graph: RawGraph | null;
  runDetail: RunDetail | null;
  readOnly?: boolean;
  availableSkills?: Array<string | SkillInfo>;
  onEditGraph?: () => void;
  onForkSnapshot?: () => void;
}

const KIND_ICON: Record<NodeKind, typeof Bot> = {
  agent: Bot,
  subagent: Users,
  decision: GitFork,
  tool: Wrench,
  skill: Sparkles,
  checkpoint: PauseCircle,
  memory: Brain,
};

const ALL_NODE_KINDS: NodeKind[] = ["agent", "subagent", "decision", "tool", "skill", "checkpoint", "memory"];

/** Distinct color, border, and silhouette per node kind. */
function getNodeStyleClasses(kind: NodeKind): string {
  switch (kind) {
    case "memory":
      return "rounded-[28px] border border-blue-400/70 bg-blue-950/85";
    case "decision":
      return "rounded-sm border-2 border-zinc-400/70 bg-zinc-800/90";
    case "agent":
      return "rounded-2xl border-2 border-emerald-400/70 bg-emerald-950/85";
    case "checkpoint":
      return "rounded-xl border-2 border-dashed border-zinc-600 bg-black";
    case "tool":
      return "rounded-sm border border-orange-400/70 bg-orange-950/85 font-mono";
    case "skill":
      return "rounded-3xl border border-yellow-400/70 bg-yellow-950/85";
    case "subagent":
      return "rounded-xl border border-border-strong bg-elevated ring-1 ring-inset ring-white/5";
    default:
      return "rounded-lg border border-border-subtle bg-elevated";
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Group nodes into vertical levels (BFS from entryNode) so parallel branches sit side-by-side. */
function groupNodesByLevel(graph: RawGraph): RawGraphNode[][] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = adj.get(edge.source) ?? [];
    list.push(edge.target);
    adj.set(edge.source, list);
  }

  const visited = new Set<string>();
  const levels: RawGraphNode[][] = [];
  let frontier: string[] = [];

  if (graph.entryNode && byId.has(graph.entryNode)) {
    frontier.push(graph.entryNode);
  } else if (graph.nodes.length > 0) {
    frontier.push(graph.nodes[0].id);
  }

  while (frontier.length > 0) {
    const currentLevel: RawGraphNode[] = [];
    const nextFrontier: string[] = [];

    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      const node = byId.get(id);
      if (node) currentLevel.push(node);
      for (const next of adj.get(id) ?? []) {
        if (!visited.has(next)) nextFrontier.push(next);
      }
    }

    if (currentLevel.length > 0) levels.push(currentLevel);
    frontier = nextFrontier;
  }

  const remaining = graph.nodes.filter((n) => !visited.has(n.id));
  if (remaining.length > 0) levels.push(remaining);

  return levels;
}

export function WaterfallStage({
  graph,
  runDetail,
  readOnly = false,
  availableSkills = [],
  onEditGraph,
  onForkSnapshot,
}: WaterfallStageProps) {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const updateNode = useWorkflowStore((s) => s.updateNode);
  const removeNodes = useWorkflowStore((s) => s.removeNodes);
  const addNode = useWorkflowStore((s) => s.addNode);

  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [openPickerLevel, setOpenPickerLevel] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [svgEdges, setSvgEdges] = useState<
    Array<{ id: string; d: string; label?: string; lx: number; ly: number; isLoop: boolean }>
  >([]);

  const levels = useMemo(() => (graph ? groupNodesByLevel(graph) : []), [graph]);

  const levelOfNode = useMemo(() => {
    const map = new Map<string, number>();
    levels.forEach((lvl, idx) => {
      for (const n of lvl) map.set(n.id, idx);
    });
    return map;
  }, [levels]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !graph) {
      setSvgEdges([]);
      return;
    }

    const computeEdges = () => {
      const cRect = container.getBoundingClientRect();
      const next: Array<{ id: string; d: string; label?: string; lx: number; ly: number; isLoop: boolean }> = [];

      for (const edge of graph.edges) {
        const srcEl = nodeRefs.current.get(edge.source);
        const tgtEl = nodeRefs.current.get(edge.target);
        if (!srcEl || !tgtEl) continue;

        const sRect = srcEl.getBoundingClientRect();
        const tRect = tgtEl.getBoundingClientRect();
        const srcLvl = levelOfNode.get(edge.source) ?? 0;
        const tgtLvl = levelOfNode.get(edge.target) ?? 0;
        const isLoop = tgtLvl <= srcLvl;

        if (isLoop) {
          const sx = sRect.right - cRect.left;
          const sy = sRect.top + sRect.height / 2 - cRect.top;
          const tx = tRect.right - cRect.left;
          const ty = tRect.top + tRect.height / 2 - cRect.top;
          const arcX = Math.max(sx, tx) + 44;
          const d = `M ${sx} ${sy} C ${arcX} ${sy}, ${arcX} ${ty}, ${tx} ${ty}`;
          next.push({ id: edge.id, d, label: edge.condition, lx: arcX - 10, ly: (sy + ty) / 2, isLoop: true });
        } else {
          const sx = sRect.left + sRect.width / 2 - cRect.left;
          const sy = sRect.bottom - cRect.top;
          const tx = tRect.left + tRect.width / 2 - cRect.left;
          const ty = tRect.top - cRect.top;
          const midY = (sy + ty) / 2;
          const d = `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;
          next.push({ id: edge.id, d, label: edge.condition, lx: (sx + tx) / 2, ly: midY, isLoop: false });
        }
      }
      setSvgEdges(next);
    };

    computeEdges();
    const ro = new ResizeObserver(computeEdges);
    ro.observe(container);
    return () => ro.disconnect();
  }, [graph, levelOfNode]);

  const logsByNode = useMemo(() => {
    const map = new Map<string, NodeExecutionLog>();
    for (const log of runDetail?.history ?? []) {
      map.set(log.nodeId, log);
    }
    return map;
  }, [runDetail]);

  const incomingEdges = useMemo(() => {
    const map = new Map<string, Array<{ from: string; condition?: string }>>();
    for (const edge of graph?.edges ?? []) {
      const list = map.get(edge.target) ?? [];
      list.push({ from: edge.source, condition: edge.condition });
      map.set(edge.target, list);
    }
    return map;
  }, [graph]);

  const outgoingEdges = useMemo(() => {
    const map = new Map<string, Array<{ to: string; condition?: string }>>();
    for (const edge of graph?.edges ?? []) {
      const list = map.get(edge.source) ?? [];
      list.push({ to: edge.target, condition: edge.condition });
      map.set(edge.source, list);
    }
    return map;
  }, [graph]);

  if (!graph) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-canvas text-[13px] text-text-muted">
        Select or create a workflow to view its flow.
      </div>
    );
  }

  const totalRunMs =
    runDetail?.createdAt && runDetail?.updatedAt
      ? new Date(runDetail.updatedAt).getTime() - new Date(runDetail.createdAt).getTime()
      : null;

  const doneCount = runDetail?.history.filter((l) => l.status === "done").length ?? 0;
  const failedCount = runDetail?.history.filter((l) => l.status === "failed").length ?? 0;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-canvas">
      {/* Inline Header with Run & Graph Stats */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface px-5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="truncate text-[14px] font-semibold text-text-primary">{graph.name}</h2>
          <Badge variant="neutral" className="font-mono text-[10px]">
            {graph.nodes.length} nodes
          </Badge>
          {runDetail ? (
            <>
              <Badge
                variant={
                  runDetail.status === "completed"
                    ? "accent"
                    : runDetail.status === "failed"
                      ? "error"
                      : runDetail.status === "waiting_checkpoint"
                        ? "warning"
                        : "info"
                }
              >
                {runDetail.status}
              </Badge>
              <span className="flex items-center gap-1 font-mono text-[11px] text-text-secondary tabular-nums">
                <Clock className="h-3 w-3 text-text-muted" />
                {totalRunMs !== null ? formatDuration(totalRunMs) : "live"}
              </span>
              <span className="font-mono text-[11px] text-text-muted tabular-nums">
                {doneCount}/{graph.nodes.length} done
                {failedCount > 0 ? ` · ${failedCount} failed` : ""}
              </span>
            </>
          ) : null}
        </div>

        {readOnly ? (
          <div className="flex items-center gap-1.5">
            {onEditGraph ? (
              <Button variant="secondary" size="sm" onClick={onEditGraph}>
                Edit Workflow
              </Button>
            ) : null}
            {onForkSnapshot ? (
              <Button variant="ghost" size="sm" onClick={onForkSnapshot}>
                Fork Snapshot
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* Vertically Flowing Tree / DAG */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div ref={containerRef} className="relative mx-auto flex max-w-[1320px] flex-col gap-6">
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            {svgEdges.map((edge) => (
              <g key={edge.id}>
                <path
                  d={edge.d}
                  fill="none"
                  stroke={edge.isLoop ? "#f59e0b" : "#3f3f46"}
                  strokeWidth={1.5}
                  strokeDasharray={edge.isLoop ? "4 3" : undefined}
                />
                {edge.label ? (
                  <g transform={`translate(${edge.lx}, ${edge.ly})`}>
                    <rect
                      x={-28}
                      y={-9}
                      width={56}
                      height={18}
                      rx={4}
                      fill="#111114"
                      stroke={edge.isLoop ? "#f59e0b" : "#3f3f46"}
                      strokeWidth={1}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={edge.isLoop ? "#f59e0b" : "#a1a1aa"}
                      fontSize={10}
                      fontFamily="monospace"
                    >
                      {edge.label}
                    </text>
                  </g>
                ) : null}
              </g>
            ))}
          </svg>
          {levels.map((levelNodes, levelIndex) => (
            <div key={levelNodes.map((n) => n.id).join("-")} className="flex flex-col">
              {/* Freeflow parallel branches at this depth */}
              <div className="flex flex-wrap items-start justify-center gap-6">
                {levelNodes.map((node) => {
                  const modelTier = typeof node.modelTier === "string" ? node.modelTier : "";
                  const skillName = typeof node.skill === "string" ? node.skill : "";
                  const promptText = typeof node.prompt === "string" ? node.prompt : "";
                  const queryText = typeof node.query === "string" ? node.query : "";

                  const meta = NODE_META[node.type] ?? NODE_META.agent;
                  const Icon = KIND_ICON[node.type] ?? Bot;
                  const log = logsByNode.get(node.id);
                  const isActive = runDetail?.activeNodeIds?.includes(node.id) ?? runDetail?.currentNodeId === node.id;
                  const status = isActive ? "running" : log?.status;
                  const isSelected = selectedNodeId === node.id;
                  const isExpanded = expandedNodeId === node.id;
                  const incoming = incomingEdges.get(node.id) ?? [];
                  const outgoing = outgoingEdges.get(node.id) ?? [];

                  const latency =
                    log?.startedAt && log?.finishedAt
                      ? formatDuration(new Date(log.finishedAt).getTime() - new Date(log.startedAt).getTime())
                      : null;

                  const statusRing =
                    status === "running"
                      ? "ring-2 ring-info node-running-shimmer"
                      : status === "waiting_checkpoint"
                        ? "ring-2 ring-warning"
                        : status === "failed"
                          ? "ring-2 ring-error"
                          : isSelected
                            ? "ring-2 ring-white/60"
                            : "";

                  const inputContent =
                    log?.renderedPrompt ||
                    promptText ||
                    queryText ||
                    (incoming.length > 0
                      ? incoming
                          .map((e) => (e.condition ? `From ${e.from} (${e.condition})` : `From ${e.from}`))
                          .join("\n")
                      : node.id === graph.entryNode && runDetail?.data
                        ? JSON.stringify(runDetail.data, null, 2)
                        : "Workflow entry input");

                  const outputContent =
                    log?.error ||
                    log?.outputPreview ||
                    (outgoing.length > 0
                      ? outgoing.map((e) => (e.condition ? `→ ${e.to} [${e.condition}]` : `→ ${e.to}`)).join("\n")
                      : "Terminal output");

                  return (
                    <div key={node.id} className="flex items-center justify-center">
                      {/* Left: Input Extension */}
                      <div className="flex w-[145px] shrink-0 flex-col justify-center rounded-l-lg border border-r-0 border-border-subtle bg-surface/70 px-2.5 py-2">
                        <div className="mb-0.5 flex items-center justify-between">
                          <span className="font-mono text-[9px] font-medium uppercase tracking-wider text-text-muted">
                            In
                          </span>
                          {incoming.length > 0 ? (
                            <span className="font-mono text-[9px] text-text-muted">{incoming.length}</span>
                          ) : null}
                        </div>
                        <pre className="max-h-[64px] overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-text-secondary">
                          {inputContent}
                        </pre>
                      </div>

                      {/* Center: Distinct Node Card */}
                      <div className="relative z-10 flex w-[260px] shrink-0 flex-col">
                        <div
                          ref={(el) => {
                            if (el) nodeRefs.current.set(node.id, el);
                            else nodeRefs.current.delete(node.id);
                          }}
                          onClick={() => {
                            selectNode(node.id);
                            setExpandedNodeId(isExpanded ? null : node.id);
                          }}
                          className={cn(
                            "cursor-pointer px-4 py-3 text-text-primary transition-all duration-150",
                            getNodeStyleClasses(node.type),
                            statusRing,
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                                style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}
                              >
                                <Icon className="h-3.5 w-3.5" />
                              </span>
                              <span className="font-mono text-[10px] font-semibold tracking-wide text-text-secondary">
                                {meta.badge}
                              </span>
                              {node.id === graph.entryNode ? (
                                <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-accent">
                                  ENTRY
                                </span>
                              ) : null}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {status === "running" ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />
                              ) : status === "done" ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
                              ) : status === "failed" ? (
                                <XCircle className="h-3.5 w-3.5 text-error" />
                              ) : status === "waiting_checkpoint" ? (
                                <PauseCircle className="h-3.5 w-3.5 text-warning" />
                              ) : null}
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-text-muted" />
                              )}
                            </div>
                          </div>

                          <div className="mt-2 truncate text-[13px] font-semibold text-text-primary">{node.label}</div>

                          {modelTier || node.queue || skillName || latency ? (
                            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2 font-mono text-[10px] text-text-muted">
                              {modelTier ? (
                                <span className="flex items-center gap-1 text-text-secondary">
                                  <Cpu className="h-3 w-3" />
                                  {modelTier}
                                </span>
                              ) : null}
                              {node.queue ? <span>queue:{node.queue}</span> : null}
                              {skillName ? <span>skill:{skillName}</span> : null}
                              {latency ? (
                                <span className="ml-auto text-text-secondary tabular-nums">{latency}</span>
                              ) : null}
                            </div>
                          ) : null}

                          {isExpanded ? (
                            <div
                              className="mt-3 space-y-2.5 border-t border-white/10 pt-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="space-y-1">
                                <label className="block text-[10px] font-medium text-text-secondary">Label</label>
                                <Input
                                  value={node.label}
                                  disabled={readOnly}
                                  onChange={(e) => updateNode(node.id, { label: e.target.value })}
                                  className="h-7 text-[12px]"
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <label className="block text-[10px] font-medium text-text-secondary">
                                    Model Tier
                                  </label>
                                  <select
                                    value={modelTier || "main"}
                                    disabled={readOnly}
                                    onChange={(e) => updateNode(node.id, { modelTier: e.target.value })}
                                    className="h-7 w-full rounded-md border border-border-subtle bg-canvas px-2 text-[11px] text-text-primary"
                                  >
                                    {MODEL_TIERS.map((tier) => (
                                      <option key={tier} value={tier}>
                                        {tier}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="space-y-1">
                                  <label className="block text-[10px] font-medium text-text-secondary">Queue</label>
                                  <select
                                    value={node.queue ?? "cloud-io"}
                                    disabled={readOnly}
                                    onChange={(e) =>
                                      updateNode(node.id, { queue: e.target.value as RawGraphNode["queue"] })
                                    }
                                    className="h-7 w-full rounded-md border border-border-subtle bg-canvas px-2 text-[11px] text-text-primary"
                                  >
                                    {QUEUE_LANES.map((q) => (
                                      <option key={q} value={q}>
                                        {q}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              {node.type === "skill" && availableSkills.length > 0 ? (
                                <div className="space-y-1">
                                  <label className="block text-[10px] font-medium text-text-secondary">Skill</label>
                                  <select
                                    value={skillName}
                                    disabled={readOnly}
                                    onChange={(e) => updateNode(node.id, { skill: e.target.value || undefined })}
                                    className="h-7 w-full rounded-md border border-border-subtle bg-canvas px-2 text-[11px] text-text-primary"
                                  >
                                    <option value="">None</option>
                                    {normalizeSkills(availableSkills).map((s) => (
                                      <option key={s.name} value={s.name}>
                                        {s.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : null}

                              <div className="space-y-1">
                                <label className="block text-[10px] font-medium text-text-secondary">Prompt</label>
                                <Textarea
                                  value={promptText}
                                  disabled={readOnly}
                                  rows={3}
                                  onChange={(e) => updateNode(node.id, { prompt: e.target.value })}
                                  className="font-mono text-[11px]"
                                />
                              </div>

                              {!readOnly ? (
                                <div className="flex justify-end">
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => {
                                      removeNodes([node.id]);
                                      setExpandedNodeId(null);
                                    }}
                                  >
                                    <Trash2 className="mr-1 h-3 w-3" />
                                    Remove
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {/* Right: Output Extension */}
                      <div
                        className={cn(
                          "flex w-[145px] shrink-0 flex-col justify-center rounded-r-lg border border-l-0 px-2.5 py-2",
                          log?.error ? "border-error/50 bg-error/5" : "border-border-subtle bg-surface/70",
                        )}
                      >
                        <div className="mb-0.5 flex items-center justify-between">
                          <span className="font-mono text-[9px] font-medium uppercase tracking-wider text-text-muted">
                            {log?.error ? "Err" : "Out"}
                          </span>
                          {outgoing.length > 0 ? (
                            <span className="flex items-center gap-0.5 font-mono text-[9px] text-text-muted">
                              <GitBranch className="h-2.5 w-2.5" />
                              {outgoing.length}
                            </span>
                          ) : null}
                        </div>
                        <pre className="max-h-[64px] overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-text-secondary">
                          {outputContent}
                        </pre>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Vertical Connector with Hover "+" Node Picker */}
              <div className="group relative flex flex-col items-center py-2">
                <div className="h-5 w-px bg-border-strong" />
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() => setOpenPickerLevel(openPickerLevel === levelIndex ? null : levelIndex)}
                    title="Add node"
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full border border-border-strong bg-elevated text-text-secondary transition-opacity duration-150 hover:border-accent hover:text-accent",
                      openPickerLevel === levelIndex ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                {levelIndex < levels.length - 1 ? <div className="h-5 w-px bg-border-strong" /> : null}

                {openPickerLevel === levelIndex && !readOnly ? (
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface p-2">
                    {ALL_NODE_KINDS.map((kind) => (
                      <Button
                        key={kind}
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 text-[11px]"
                        onClick={() => {
                          addNode(kind);
                          setOpenPickerLevel(null);
                        }}
                      >
                        {NODE_META[kind].badge}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
