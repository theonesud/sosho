"use client";

import { ChevronLeft, FileCode2, PlayCircle, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { RawGraph, RunSummary, WorkflowSummary } from "@/types";

interface SourceDrawerProps {
  open: boolean;
  onClose: () => void;
  workflows: WorkflowSummary[];
  workflowsLoading?: boolean;
  runs: RunSummary[];
  runsLoading?: boolean;
  activeGraph: RawGraph | null;
  activeRunId?: string | null;
  onSelectWorkflow: (id: string) => void;
  onSelectRun: (runId: string) => void;
  onNewWorkflow: () => void;
  onDeleteWorkflow: (workflowId: string) => void;
}

export function SourceDrawer({
  open,
  onClose,
  workflows,
  workflowsLoading,
  runs,
  runsLoading,
  activeGraph,
  activeRunId,
  onSelectWorkflow,
  onSelectRun,
  onNewWorkflow,
  onDeleteWorkflow,
}: SourceDrawerProps) {
  if (!open) return null;

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-border-subtle bg-surface overflow-hidden">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border-subtle px-3">
        <span className="text-[12px] font-semibold text-text-primary">Sources</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onNewWorkflow} title="New empty workflow" className="h-6 w-6">
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} title="Collapse drawer" className="h-6 w-6">
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Saved Workflows (read-only list; click loads into Current) */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Saved Workflows</span>
        <span className="font-mono text-[10px] text-text-muted tabular-nums">{workflows.length}</span>
      </div>

      <div className="max-h-[240px] space-y-0.5 overflow-y-auto border-b border-border-subtle px-2 pb-2">
        {workflowsLoading ? (
          <div className="space-y-1.5 p-1">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-text-muted">No saved workflows.</div>
        ) : (
          workflows.map((wf) => {
            const isActive = activeGraph?.id === wf.id && !activeRunId;
            return (
              <div
                key={wf.id}
                className={cn(
                  "group flex items-center justify-between gap-1 rounded-md px-2 py-1.5 text-[12px] transition-colors",
                  isActive
                    ? "bg-elevated font-medium text-text-primary"
                    : "text-text-secondary hover:bg-elevated/60 hover:text-text-primary",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectWorkflow(wf.id)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <FileCode2 className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <span className="truncate">{wf.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteWorkflow(wf.id)}
                  title="Delete saved workflow"
                  className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-canvas hover:text-error group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Past Runs (read-only; click loads into Current read-only) */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Run History</span>
        <span className="font-mono text-[10px] text-text-muted tabular-nums">{runs.length}</span>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {runsLoading ? (
          <div className="space-y-1.5 p-1">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : runs.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-text-muted">No runs recorded.</div>
        ) : (
          runs.map((run) => {
            const isSelected = activeRunId === run.runId;
            return (
              <button
                key={run.runId}
                type="button"
                onClick={() => onSelectRun(run.runId)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
                  isSelected
                    ? "bg-elevated text-text-primary"
                    : "text-text-secondary hover:bg-elevated/60 hover:text-text-primary",
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <PlayCircle className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{run.graphId}</div>
                    <div className="font-mono text-[10px] text-text-muted">{run.runId.slice(0, 8)}</div>
                  </div>
                </div>
                <Badge
                  variant={
                    run.status === "completed"
                      ? "accent"
                      : run.status === "failed"
                        ? "error"
                        : run.status === "waiting_checkpoint"
                          ? "warning"
                          : "neutral"
                  }
                  className="shrink-0 text-[10px]"
                >
                  {run.status}
                </Badge>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
