"use client";

import { Play, Plus, Save, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  extractTemplateVariables,
  type RawGraph,
  type RunSummary,
  WORKFLOW_TEMPLATES,
  type WorkflowSummary,
} from "@/types";

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
  onLoadTemplate,
  onNewWorkflow,
  onSaveWorkflow,
  onDeleteWorkflow,
  onStartRun,
  onCancelRun,
}: WorkflowSidebarProps) {
  const [inputMode, setInputMode] = useState<"form" | "json">("form");
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [rawJson, setRawJson] = useState('{\n  "topic": ""\n}');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const templateVars = useMemo(() => extractTemplateVariables(activeGraph), [activeGraph]);

  const handleRunClick = () => {
    setJsonError(null);
    if (inputMode === "json") {
      try {
        const parsed = JSON.parse(rawJson || "{}") as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setJsonError("Run inputs must be a JSON object.");
          return;
        }
        onStartRun(parsed as Record<string, unknown>);
      } catch {
        setJsonError("Invalid JSON syntax.");
      }
      return;
    }

    const payload: Record<string, unknown> = {};
    for (const v of templateVars) {
      payload[v] = formValues[v] ?? "";
    }
    onStartRun(payload);
  };

  return (
    <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-border-subtle bg-surface overflow-hidden">
      {/* Workflow selector & CRUD */}
      <div className="space-y-2 border-b border-border-subtle p-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-text-primary">Workflows</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={onNewWorkflow} title="New workflow">
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={isDirty ? "primary" : "secondary"}
              size="xs"
              disabled={!activeGraph || isSaving}
              onClick={onSaveWorkflow}
              title="Save workflow (Ctrl+S)"
            >
              <Save className="h-3 w-3" />
              <span>{isDirty ? "Save*" : "Save"}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!activeGraph}
              onClick={onDeleteWorkflow}
              title="Delete workflow"
              className="text-text-muted hover:text-error"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {workflowsLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : (
          <select
            value={activeGraph?.id ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              if (val.startsWith("tpl:")) {
                onLoadTemplate(val.slice(4));
              } else if (val) {
                onSelectWorkflow(val);
              }
            }}
            className="flex h-8 w-full rounded-md border border-border-subtle bg-canvas px-2 text-[12px] text-text-primary hover:border-border-strong focus-visible:border-accent focus-visible:outline-none"
          >
            {workflows.length === 0 ? <option value="">No saved workflows</option> : null}
            <optgroup label="Saved Workflows">
              {workflows.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Templates">
              {Object.entries(WORKFLOW_TEMPLATES).map(([key, tpl]) => (
                <option key={`tpl:${key}`} value={`tpl:${key}`}>
                  Template: {tpl.name}
                </option>
              ))}
            </optgroup>
          </select>
        )}

        {saveStatus ? <div className="truncate text-[11px] text-text-muted">{saveStatus}</div> : null}
      </div>

      {/* Run Inputs */}
      <div className="space-y-2 border-b border-border-subtle p-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-text-primary">Run Inputs</span>
          <div className="inline-flex rounded border border-border-subtle bg-canvas p-0.5 text-[10px]">
            <button
              type="button"
              onClick={() => setInputMode("form")}
              className={cn(
                "cursor-pointer rounded px-1.5 py-0.5 font-medium",
                inputMode === "form" ? "bg-elevated text-text-primary" : "text-text-muted",
              )}
            >
              Form
            </button>
            <button
              type="button"
              onClick={() => setInputMode("json")}
              className={cn(
                "cursor-pointer rounded px-1.5 py-0.5 font-medium",
                inputMode === "json" ? "bg-elevated text-text-primary" : "text-text-muted",
              )}
            >
              JSON
            </button>
          </div>
        </div>

        {inputMode === "form" ? (
          templateVars.length === 0 ? (
            <div className="text-[11px] text-text-muted">No template variables detected.</div>
          ) : (
            <div className="max-h-36 space-y-2 overflow-y-auto pr-0.5">
              {templateVars.map((v) => (
                <div key={v} className="space-y-1">
                  <label className="block font-mono text-[11px] text-text-secondary">{v}</label>
                  <Input
                    value={formValues[v] ?? ""}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, [v]: e.target.value }))}
                    placeholder={`Enter ${v}...`}
                  />
                </div>
              ))}
            </div>
          )
        ) : (
          <Textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            className="min-h-[84px] font-mono text-[11px]"
          />
        )}

        {jsonError ? <div className="text-[11px] text-red-400">{jsonError}</div> : null}

        <Button
          variant="primary"
          size="md"
          disabled={!activeGraph || isStartingRun}
          onClick={handleRunClick}
          className="w-full"
        >
          <Play className="h-3.5 w-3.5" />
          <span>{isStartingRun ? "Starting..." : "Run Workflow"}</span>
        </Button>
      </div>

      {/* Recent Runs */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[12px] font-semibold text-text-primary">Recent Runs</span>
          <span className="font-mono text-[11px] text-text-muted tabular-nums">{runs.length}</span>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
          {runsLoading ? (
            <div className="space-y-1.5 px-1">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : runs.length === 0 ? (
            <div className="px-2 py-4 text-center text-[12px] text-text-muted">
              No runs yet. Click Run Workflow above to start one.
            </div>
          ) : (
            runs.map((r) => {
              const isSelected = activeRunId === r.runId;
              const canCancel = r.status === "running" || r.status === "waiting_checkpoint";
              return (
                <div
                  key={r.runId}
                  className={cn(
                    "group flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 transition-colors duration-150",
                    isSelected
                      ? "border-accent/50 bg-elevated"
                      : "border-transparent hover:border-border-subtle hover:bg-elevated/60",
                  )}
                >
                  <Link href={`/runs/${encodeURIComponent(r.runId)}`} className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="truncate text-[12px] font-medium text-text-primary">{r.graphId}</span>
                      <Badge
                        variant={
                          r.status === "completed"
                            ? "accent"
                            : r.status === "running"
                              ? "info"
                              : r.status === "waiting_checkpoint"
                                ? "warning"
                                : "error"
                        }
                      >
                        {r.status === "waiting_checkpoint" ? "paused" : r.status}
                      </Badge>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-text-muted tabular-nums">
                      <span>{r.runId.slice(0, 8)}</span>
                      <span>·</span>
                      <span>{r.stepCount} steps</span>
                    </div>
                  </Link>

                  {canCancel ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onCancelRun(r.runId)}
                      title="Cancel run"
                      className="h-6 w-6 shrink-0 text-text-muted hover:text-error"
                    >
                      <Square className="h-3 w-3" />
                    </Button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
