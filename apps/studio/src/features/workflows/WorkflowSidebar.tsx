"use client";

import { Check, Pencil, Play, Plus, Save, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { RawGraph, RunSummary, WorkflowSummary } from "@/types";

interface WorkflowSidebarProps {
  workflows: WorkflowSummary[];
  workflowsLoading?: boolean;
  runs: RunSummary[];
  runsLoading?: boolean;
  activeGraph: RawGraph | null;
  activeRunId?: string | null;
  isDirty: boolean;
  saveStatus: string | null;
  isSaving: boolean;
  isStartingRun: boolean;
  onSelectWorkflow: (id: string) => void;
  onLoadTemplate: (templateKey: string) => void;
  onNewWorkflow: () => void;
  onSaveWorkflow: () => void;
  onDeleteWorkflow: () => void;
  onStartRun: (initialData: Record<string, unknown>) => void;
  onCancelRun: (runId: string) => void;
}

export function WorkflowSidebar({
  workflows,
  workflowsLoading,
  runs,
  runsLoading,
  activeGraph,
  activeRunId,
  isDirty,
  saveStatus,
  isSaving,
  isStartingRun,
  onSelectWorkflow,
  onNewWorkflow,
  onSaveWorkflow,
  onDeleteWorkflow,
  onStartRun,
  onCancelRun,
}: WorkflowSidebarProps) {
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const updateGraphMeta = useWorkflowStore((s) => s.updateGraphMeta);

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-border-subtle bg-surface overflow-hidden">
      {/* Saved Workflows */}
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2.5">
        <span className="text-[12px] font-semibold text-text-primary">Saved Workflows</span>
        <div className="flex items-center gap-1">
          {isDirty ? (
            <Button
              variant="primary"
              size="sm"
              onClick={onSaveWorkflow}
              disabled={isSaving}
              className="h-6 px-2 text-[11px]"
            >
              <Save className="mr-1 h-3 w-3" />
              Save
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" onClick={onNewWorkflow} title="Create workflow" className="h-6 w-6">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="max-h-[210px] space-y-0.5 overflow-y-auto border-b border-border-subtle p-2">
        {workflowsLoading ? (
          <div className="space-y-1.5 p-1">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-text-muted">No saved workflows yet.</div>
        ) : (
          workflows.map((wf) => {
            const isActive = activeGraph?.id === wf.id && !activeRunId;
            const isEditing = editingWorkflowId === wf.id && isActive;
            return (
              <div
                key={wf.id}
                className={cn(
                  "group flex w-full items-center justify-between gap-1 rounded-md px-2 py-1.5 text-[12px] transition-colors",
                  isActive
                    ? "bg-elevated font-medium text-text-primary"
                    : "text-text-secondary hover:bg-elevated/60 hover:text-text-primary",
                )}
              >
                {isEditing ? (
                  <input
                    autoFocus
                    aria-label="Edit workflow name"
                    value={activeGraph.name}
                    onChange={(e) => updateGraphMeta({ name: e.target.value })}
                    onBlur={() => setEditingWorkflowId(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") {
                        setEditingWorkflowId(null);
                      }
                    }}
                    className="h-5 min-w-0 flex-1 rounded border border-accent/60 bg-canvas px-1.5 text-[12px] font-medium text-text-primary focus:outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectWorkflow(wf.id)}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    {isActive ? activeGraph.name : wf.name}
                  </button>
                )}
                <div
                  className={cn(
                    "flex shrink-0 items-center gap-0.5 transition-opacity",
                    isEditing ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                  )}
                >
                  {isEditing ? (
                    <button
                      type="button"
                      onClick={() => setEditingWorkflowId(null)}
                      title="Done editing"
                      className="rounded p-1 text-accent hover:bg-canvas"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (!isActive) onSelectWorkflow(wf.id);
                          setEditingWorkflowId(wf.id);
                        }}
                        title="Edit workflow name"
                        className="rounded p-1 text-text-muted hover:bg-canvas hover:text-text-primary"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={isStartingRun}
                        onClick={() => {
                          if (!isActive) onSelectWorkflow(wf.id);
                          onStartRun({});
                        }}
                        title="Run workflow"
                        className="rounded p-1 text-text-muted hover:bg-canvas hover:text-accent disabled:opacity-50"
                      >
                        <Play className="h-3 w-3" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (!isActive) onSelectWorkflow(wf.id);
                      onDeleteWorkflow();
                    }}
                    title="Delete saved workflow"
                    className="rounded p-1 text-text-muted hover:bg-canvas hover:text-error"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
        {saveStatus ? <div className="px-2 pt-1 text-[11px] text-text-muted">{saveStatus}</div> : null}
      </div>

      {/* Recent Runs */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Runs</span>
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
              <div
                key={run.runId}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[12px] transition-colors",
                  isSelected ? "bg-elevated text-text-primary" : "text-text-secondary hover:bg-elevated/60",
                )}
              >
                <Link href={`/runs/${encodeURIComponent(run.runId)}`} className="min-w-0 flex-1 truncate">
                  <div className="truncate font-medium">{run.graphId}</div>
                  <div className="font-mono text-[10px] text-text-muted">{run.runId.slice(0, 8)}</div>
                </Link>
                {run.status === "running" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => onCancelRun(run.runId)}
                    title="Cancel run"
                  >
                    <Square className="h-3 w-3 text-error" />
                  </Button>
                ) : (
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
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
