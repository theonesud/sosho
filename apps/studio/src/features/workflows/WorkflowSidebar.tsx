"use client";

import { Play, Plus, Save, Square } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { extractTemplateVariables, type RawGraph, type RunSummary, type WorkflowSummary } from "@/types";

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
  onStartRun,
  onCancelRun,
}: WorkflowSidebarProps) {
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const templateVars = useMemo(() => extractTemplateVariables(activeGraph), [activeGraph]);

  const handleRunClick = () => {
    const payload: Record<string, unknown> = {};
    for (const v of templateVars) {
      payload[v] = formValues[v] ?? "";
    }
    onStartRun(payload);
  };

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-border-subtle bg-surface overflow-hidden">
      {/* Workflows */}
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2.5">
        <span className="text-[12px] font-semibold text-text-primary">Workflows</span>
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
          <Button variant="ghost" size="icon" onClick={onNewWorkflow} title="New workflow" className="h-6 w-6">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="max-h-[200px] space-y-0.5 overflow-y-auto border-b border-border-subtle p-2">
        {workflowsLoading ? (
          <div className="space-y-1.5 p-1">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-text-muted">No workflows yet.</div>
        ) : (
          workflows.map((wf) => {
            const isActive = activeGraph?.id === wf.id && !activeRunId;
            return (
              <button
                key={wf.id}
                type="button"
                onClick={() => onSelectWorkflow(wf.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors",
                  isActive
                    ? "bg-elevated font-medium text-text-primary"
                    : "text-text-secondary hover:bg-elevated/60 hover:text-text-primary",
                )}
              >
                <span className="truncate">{wf.name}</span>
              </button>
            );
          })
        )}
        {saveStatus ? <div className="px-2 pt-1 text-[11px] text-text-muted">{saveStatus}</div> : null}
      </div>

      {/* Run Trigger */}
      <div className="space-y-2 border-b border-border-subtle p-3">
        {templateVars.map((v) => (
          <div key={v} className="space-y-1">
            <label className="block font-mono text-[10px] text-text-muted">{v}</label>
            <Input
              value={formValues[v] ?? ""}
              onChange={(e) => setFormValues((prev) => ({ ...prev, [v]: e.target.value }))}
              placeholder={`Enter ${v}`}
              className="h-7 text-[12px]"
            />
          </div>
        ))}
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          onClick={handleRunClick}
          disabled={!activeGraph || isStartingRun}
        >
          <Play className="mr-1.5 h-3.5 w-3.5" />
          {isStartingRun ? "Starting..." : "Run Workflow"}
        </Button>
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
