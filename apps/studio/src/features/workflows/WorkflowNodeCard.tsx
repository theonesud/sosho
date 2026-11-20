"use client";

import { type Node, type NodeProps, Position } from "@xyflow/react";
import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  GitFork,
  Loader2,
  PauseCircle,
  Sparkles,
  Users,
  Volume2,
  Wrench,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  type ModelTier,
  NODE_META,
  type NodeExecutionLog,
  type NodeKind,
  type NodePort,
  type PortDataType,
  type QueueLane,
  type RawGraphNode,
} from "@/types";
import { PortSocket } from "./PortSocket";

export interface WorkflowNodeData extends Record<string, unknown> {
  nodeId: string;
  kind: NodeKind;
  label: string;
  rawNode: RawGraphNode;
  isEntry?: boolean;
  queue?: QueueLane;
  isActive?: boolean;
  readOnly?: boolean;
  log?: NodeExecutionLog;
  latency?: string | null;
  inputs: NodePort[];
  outputs: NodePort[];
}

export type WorkflowFlowNode = Node<WorkflowNodeData, "workflowNode">;

const KIND_ICON: Record<NodeKind, typeof Bot> = {
  agent: Bot,
  subagent: Users,
  decision: GitFork,
  tool: Wrench,
  skill: Sparkles,
  checkpoint: PauseCircle,
  memory: Brain,
};

const TIER_OPTIONS: ModelTier[] = ["main", "subagent", "subagent-code", "decision", "local-uncensored"];

function CornerScrew({ className }: { className: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute h-1.5 w-1.5 rounded-full border border-zinc-600/80 bg-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]",
        className,
      )}
    />
  );
}

export function WorkflowNodeCard({ data, selected }: NodeProps<WorkflowFlowNode>) {
  const meta = NODE_META[data.kind] ?? NODE_META.agent;
  const Icon = KIND_ICON[data.kind] ?? Bot;
  const raw = data.rawNode;
  const flags = raw.uiFlags ?? {};
  const status = data.isActive ? "running" : data.log?.status;
  const readOnly = Boolean(data.readOnly);

  const updateNode = useWorkflowStore((s) => s.updateNode);
  const toggleNodeFlag = useWorkflowStore((s) => s.toggleNodeFlag);

  const [copied, setCopied] = useState(false);
  const outputExpanded = Boolean(flags.outputExpanded);
  const hasOutput = Boolean(
    data.log?.outputPreview || data.log?.error || data.log?.decisionLog || data.log?.memoryRecall,
  );

  const borderClass = flags.bypass
    ? "border-zinc-700/60 opacity-55"
    : status === "running"
      ? "border-sky-400/90 shadow-[0_0_24px_rgba(56,189,248,0.22)]"
      : status === "waiting_checkpoint"
        ? "border-amber-400/90 shadow-[0_0_20px_rgba(245,158,11,0.2)]"
        : status === "failed"
          ? "border-red-500/90 shadow-[0_0_20px_rgba(239,68,68,0.2)]"
          : status === "done"
            ? "border-emerald-500/75 shadow-[0_0_18px_rgba(16,185,129,0.14)]"
            : selected
              ? "border-emerald-400/80 shadow-[0_0_22px_rgba(16,185,129,0.16)]"
              : "border-zinc-700/70 hover:border-zinc-500/80";

  const inputs: NodePort[] = data.inputs.length > 0 ? data.inputs : [{ id: "in", name: "in", type: "any" }];
  const outputs: NodePort[] = data.outputs.length > 0 ? data.outputs : [{ id: "out", name: "out", type: "any" }];

  const handleCopyOutput = () => {
    const text = data.log?.outputPreview ?? data.log?.error ?? "";
    if (!text) return;
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      className={cn(
        "group relative flex w-[288px] rounded-xl border bg-[#111114]/85 text-zinc-100 shadow-[0_14px_34px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-all duration-150",
        borderClass,
      )}
    >
      {/* Top 1px specular glass reflection */}
      <span className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

      {/* Machined corner hex screws */}
      <CornerScrew className="left-1.5 top-1.5" />
      <CornerScrew className="right-1.5 top-1.5" />
      <CornerScrew className="bottom-1.5 left-1.5" />
      <CornerScrew className="bottom-1.5 right-1.5" />

      {/* Eurorack input jack sockets */}
      {inputs.map((port, idx) => {
        const pct = inputs.length === 1 ? 50 : 25 + (idx / (inputs.length - 1)) * 50;
        return (
          <PortSocket
            key={port.id}
            id={port.id}
            type="target"
            position={Position.Left}
            dataType={port.type as PortDataType}
            label={port.name}
            topOffsetPct={pct}
          />
        );
      })}

      {/* Eurorack output jack sockets */}
      {outputs.map((port, idx) => {
        const pct = outputs.length === 1 ? 50 : 25 + (idx / (outputs.length - 1)) * 50;
        return (
          <PortSocket
            key={port.id}
            id={port.id}
            type="source"
            position={Position.Right}
            dataType={port.type as PortDataType}
            label={port.name}
            topOffsetPct={pct}
          />
        );
      })}

      {/* Left TouchDesigner Bypass / Lock / Solo control rail */}
      <div className="flex w-6 shrink-0 flex-col items-center justify-center gap-1 border-r border-zinc-800/80 bg-zinc-950/60 py-2 rounded-l-xl">
        <button
          type="button"
          title="Bypass node (B)"
          disabled={readOnly}
          onClick={(e) => {
            e.stopPropagation();
            toggleNodeFlag(data.nodeId, "bypass");
          }}
          className={cn(
            "nodrag h-4 w-4 rounded font-mono text-[9px] font-bold transition",
            flags.bypass
              ? "bg-amber-500/25 text-amber-300 ring-1 ring-amber-400/60"
              : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
          )}
        >
          B
        </button>
        <button
          type="button"
          title="Lock node position (L)"
          disabled={readOnly}
          onClick={(e) => {
            e.stopPropagation();
            toggleNodeFlag(data.nodeId, "locked");
          }}
          className={cn(
            "nodrag h-4 w-4 rounded font-mono text-[9px] font-bold transition",
            flags.locked
              ? "bg-sky-500/25 text-sky-300 ring-1 ring-sky-400/60"
              : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
          )}
        >
          L
        </button>
        <button
          type="button"
          title="Solo node"
          disabled={readOnly}
          onClick={(e) => {
            e.stopPropagation();
            toggleNodeFlag(data.nodeId, "solo");
          }}
          className={cn(
            "nodrag h-4 w-4 rounded font-mono text-[9px] font-bold transition",
            flags.solo
              ? "bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-400/60"
              : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
          )}
        >
          S
        </button>
      </div>

      {/* Main module face */}
      <div className="min-w-0 flex-1 px-3 py-2.5">
        {/* Frosted glass header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-700/80 bg-zinc-900/90"
              style={{ boxShadow: `inset 0 1px 0 rgba(255,255,255,0.1)` }}
            >
              <Icon className="h-3 w-3" style={{ color: meta.color }} />
            </span>
            <span className="font-mono text-[10px] font-semibold tracking-wider text-zinc-400">{meta.badge}</span>
            {data.isEntry ? (
              <span className="rounded bg-emerald-500/15 px-1 py-0.5 font-mono text-[9px] font-semibold text-emerald-400 ring-1 ring-emerald-500/30">
                ENTRY
              </span>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {data.latency ? (
              <span className="rounded bg-zinc-950/90 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 ring-1 ring-zinc-800 tabular-nums">
                {data.latency}
              </span>
            ) : null}
            {status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" /> : null}
            {status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : null}
            {status === "failed" ? <XCircle className="h-3.5 w-3.5 text-red-400" /> : null}
            {status === "waiting_checkpoint" ? <PauseCircle className="h-3.5 w-3.5 text-amber-400" /> : null}
            {!status ? (
              <span
                className="h-2 w-2 rounded-full bg-zinc-700"
                style={{ boxShadow: "inset 0 1px 1px rgba(0,0,0,0.8)" }}
              />
            ) : null}
          </div>
        </div>

        {/* Editable module title */}
        <input
          type="text"
          value={data.label}
          disabled={readOnly}
          onChange={(e) => updateNode(data.nodeId, { label: e.target.value })}
          className="nodrag nopan mt-1.5 w-full truncate rounded bg-transparent px-1 py-0.5 text-[13px] font-semibold text-zinc-100 outline-none ring-1 ring-transparent focus:bg-zinc-950/80 focus:ring-zinc-700"
        />

        {/* Compact inline inputs (ComfyUI-style 3 primary controls) */}
        <div className="nodrag nopan mt-2 space-y-1.5 text-[11px]">
          {(data.kind === "agent" || data.kind === "subagent" || data.kind === "skill" || data.kind === "decision") && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-10 shrink-0 font-mono text-[9px] uppercase text-zinc-500">Tier</span>
                <select
                  value={(raw.tier as string) ?? "main"}
                  disabled={readOnly}
                  onChange={(e) => updateNode(data.nodeId, { tier: e.target.value })}
                  className="h-6 flex-1 rounded border border-zinc-800 bg-zinc-950/90 px-1.5 font-mono text-[10px] text-zinc-200 outline-none focus:border-emerald-500/60"
                >
                  {TIER_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                rows={2}
                value={(raw.promptTemplate as string) ?? ""}
                disabled={readOnly}
                placeholder="Prompt template..."
                onChange={(e) => updateNode(data.nodeId, { promptTemplate: e.target.value })}
                className="w-full resize-none rounded border border-zinc-800 bg-zinc-950/90 px-2 py-1 font-mono text-[10px] leading-snug text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-emerald-500/60"
              />
            </>
          )}

          {data.kind === "decision" && Array.isArray(raw.branches) ? (
            <div className="flex flex-wrap gap-1">
              {(raw.branches as string[]).map((b) => (
                <span
                  key={b}
                  className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[9px] text-rose-300"
                >
                  {b}
                </span>
              ))}
            </div>
          ) : null}

          {data.kind === "tool" && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-10 shrink-0 font-mono text-[9px] uppercase text-zinc-500">Kind</span>
                <select
                  value={(raw.toolKind as string) ?? "shell"}
                  disabled={readOnly}
                  onChange={(e) => updateNode(data.nodeId, { toolKind: e.target.value })}
                  className="h-6 flex-1 rounded border border-zinc-800 bg-zinc-950/90 px-1.5 font-mono text-[10px] text-zinc-200 outline-none focus:border-emerald-500/60"
                >
                  <option value="shell">shell</option>
                  <option value="http">http</option>
                  <option value="yue2">yue2</option>
                </select>
              </div>
              <input
                type="text"
                value={(raw.commandOrUrl as string) ?? ""}
                disabled={readOnly}
                placeholder="Command or URL..."
                onChange={(e) => updateNode(data.nodeId, { commandOrUrl: e.target.value })}
                className="h-6 w-full rounded border border-zinc-800 bg-zinc-950/90 px-2 font-mono text-[10px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-emerald-500/60"
              />
            </>
          )}

          {data.kind === "memory" && (
            <>
              <div className="flex items-center gap-1.5">
                <select
                  value={(raw.operation as string) ?? "search"}
                  disabled={readOnly}
                  onChange={(e) => updateNode(data.nodeId, { operation: e.target.value })}
                  className="h-6 flex-1 rounded border border-zinc-800 bg-zinc-950/90 px-1.5 font-mono text-[10px] text-zinc-200 outline-none focus:border-emerald-500/60"
                >
                  <option value="search">search</option>
                  <option value="save">save</option>
                  <option value="consolidate">consolidate</option>
                </select>
                <select
                  value={(raw.scope as string) ?? "both"}
                  disabled={readOnly}
                  onChange={(e) => updateNode(data.nodeId, { scope: e.target.value })}
                  className="h-6 flex-1 rounded border border-zinc-800 bg-zinc-950/90 px-1.5 font-mono text-[10px] text-zinc-200 outline-none focus:border-emerald-500/60"
                >
                  <option value="both">both</option>
                  <option value="project">project</option>
                  <option value="global">global</option>
                </select>
              </div>
              <input
                type="text"
                value={(raw.queryOrTitleTemplate as string) ?? ""}
                disabled={readOnly}
                placeholder="Query template..."
                onChange={(e) => updateNode(data.nodeId, { queryOrTitleTemplate: e.target.value })}
                className="h-6 w-full rounded border border-zinc-800 bg-zinc-950/90 px-2 font-mono text-[10px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-emerald-500/60"
              />
            </>
          )}

          {data.kind === "checkpoint" && (
            <input
              type="text"
              value={(raw.message as string) ?? ""}
              disabled={readOnly}
              placeholder="Approval prompt..."
              onChange={(e) => updateNode(data.nodeId, { message: e.target.value })}
              className="h-6 w-full rounded border border-zinc-800 bg-zinc-950/90 px-2 font-mono text-[10px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-amber-500/60"
            />
          )}
        </div>

        {/* Expandable inset LCD monitor output tray */}
        <div className="nodrag nopan mt-2.5 overflow-hidden rounded-md border border-zinc-800/90 bg-[#09090b]/95 shadow-[inset_0_2px_8px_rgba(0,0,0,0.85)]">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleNodeFlag(data.nodeId, "outputExpanded");
            }}
            className="flex w-full items-center justify-between px-2 py-1 text-left transition hover:bg-zinc-900/70"
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  status === "running" ? "bg-sky-400 animate-pulse" : hasOutput ? "bg-emerald-400" : "bg-zinc-600",
                )}
              />
              <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-zinc-400">Output</span>
              {!outputExpanded && data.log?.outputPreview ? (
                <span className="truncate font-mono text-[10px] text-zinc-500">{data.log.outputPreview}</span>
              ) : null}
            </div>
            {outputExpanded ? (
              <ChevronUp className="h-3 w-3 shrink-0 text-zinc-500" />
            ) : (
              <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
            )}
          </button>

          {outputExpanded ? (
            <div className="border-t border-zinc-800/80 p-2">
              {data.kind === "tool" && raw.toolKind === "yue2" ? (
                <div className="mb-1.5 flex items-center gap-1.5 rounded bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300">
                  <Volume2 className="h-3 w-3 shrink-0" />
                  <span className="font-mono">YuE2 Audio Monitor</span>
                </div>
              ) : null}

              {data.log?.error ? (
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-red-400">
                  {data.log.error}
                </pre>
              ) : data.log?.outputPreview ? (
                <div className="relative">
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-zinc-300">
                    {data.log.outputPreview}
                  </pre>
                  <button
                    type="button"
                    onClick={handleCopyOutput}
                    className="mt-1 flex items-center gap-1 rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 hover:text-zinc-200"
                  >
                    <Copy className="h-2.5 w-2.5" />
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              ) : (
                <p className="font-mono text-[10px] text-zinc-600">
                  {status === "running" ? "Streaming output..." : "Run workflow to inspect live output."}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
