"use client";

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import {
  Bot,
  Brain,
  CheckCircle2,
  GitFork,
  Loader2,
  PauseCircle,
  Sparkles,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NODE_META, type NodeExecutionLog, type NodeKind, type QueueLane } from "@/types";

export interface WorkflowNodeData extends Record<string, unknown> {
  nodeId: string;
  kind: NodeKind;
  label: string;
  subtitle?: string;
  isEntry?: boolean;
  queue?: QueueLane;
  isActive?: boolean;
  log?: NodeExecutionLog;
  latency?: string | null;
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

export function WorkflowNodeCard({ data, selected }: NodeProps<WorkflowFlowNode>) {
  const meta = NODE_META[data.kind] ?? NODE_META.agent;
  const Icon = KIND_ICON[data.kind] ?? Bot;
  const status = data.isActive ? "running" : data.log?.status;

  const borderClass =
    status === "running"
      ? "border-info node-pulse-active"
      : status === "waiting_checkpoint"
        ? "border-warning"
        : status === "failed"
          ? "border-error"
          : status === "done"
            ? "border-accent/70"
            : selected
              ? "border-accent"
              : "border-border-subtle hover:border-border-strong";

  return (
    <div
      className={cn(
        "min-w-[210px] max-w-[250px] rounded-lg border bg-elevated px-3 py-2.5 text-text-primary transition-colors duration-150",
        borderClass,
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-canvas !bg-border-strong"
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} />
          <span className="font-mono text-[10px] font-semibold tracking-wide text-text-secondary">{meta.badge}</span>
          {data.isEntry ? (
            <span className="rounded bg-accent/15 px-1 py-0.5 font-mono text-[9px] font-semibold text-accent">
              ENTRY
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {data.latency ? (
            <span className="rounded bg-canvas px-1 py-0.5 font-mono text-[10px] text-text-secondary tabular-nums">
              {data.latency}
            </span>
          ) : null}
          {status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-info" /> : null}
          {status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-accent" /> : null}
          {status === "failed" ? <XCircle className="h-3.5 w-3.5 text-error" /> : null}
          {status === "waiting_checkpoint" ? <PauseCircle className="h-3.5 w-3.5 text-warning" /> : null}
        </div>
      </div>

      <div className="mt-1.5 truncate text-[13px] font-medium text-text-primary">{data.label || data.nodeId}</div>

      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-text-muted">{data.subtitle || data.nodeId}</span>
        {data.queue ? (
          <span className="shrink-0 rounded border border-border-subtle bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
            {data.queue}
          </span>
        ) : null}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-canvas !bg-border-strong"
      />
    </div>
  );
}
