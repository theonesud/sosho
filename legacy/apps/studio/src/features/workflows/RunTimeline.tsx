"use client";

import { CheckCircle2, ExternalLink, Loader2, PauseCircle, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatLatency, type NodeExecutionLog, type RunDetail } from "@/types";

interface RunTimelineProps {
  run: RunDetail | null;
  selectedNodeId?: string | null;
  onSelectStepNode?: (nodeId: string) => void;
}

export function RunTimeline({ run, selectedNodeId, onSelectStepNode }: RunTimelineProps) {
  const [selectedStepIdx, setSelectedStepIdx] = useState<number | null>(null);

  const history = run?.history ?? [];

  const activeLog: NodeExecutionLog | null = useMemo(() => {
    if (selectedStepIdx !== null && history[selectedStepIdx]) {
      return history[selectedStepIdx];
    }
    if (selectedNodeId) {
      const found = [...history].reverse().find((h) => h.nodeId === selectedNodeId);
      if (found) return found;
    }
    return history[history.length - 1] ?? null;
  }, [history, selectedStepIdx, selectedNodeId]);

  if (!run) {
    return (
      <div className="p-4 text-[12px] text-text-muted">
        Start a run or select a recent run to inspect execution steps and state.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Run summary header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-[11px] text-text-secondary">{run.runId}</div>
          <div className="text-[11px] text-text-muted tabular-nums">{run.stepCount} steps</div>
        </div>
        <Badge
          variant={
            run.status === "completed"
              ? "accent"
              : run.status === "running"
                ? "info"
                : run.status === "waiting_checkpoint"
                  ? "warning"
                  : "error"
          }
        >
          {run.status}
        </Badge>
      </div>

      {/* Step list */}
      <div className="max-h-[42%] overflow-y-auto border-b border-border-subtle p-2 space-y-1">
        {history.length === 0 ? (
          <div className="px-2 py-4 text-center text-[12px] text-text-muted">Waiting for first step...</div>
        ) : (
          history.map((item, idx) => {
            const isSelected = activeLog === item;
            const latency = formatLatency(item.startedAt, item.finishedAt);
            return (
              <button
                key={`${item.step}-${item.nodeId}-${idx}`}
                type="button"
                onClick={() => {
                  setSelectedStepIdx(idx);
                  onSelectStepNode?.(item.nodeId);
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors duration-150",
                  isSelected
                    ? "border-accent/50 bg-elevated text-text-primary"
                    : "border-transparent hover:bg-elevated/60 text-text-secondary",
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {item.status === "running" ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-info" />
                  ) : item.status === "done" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                  ) : item.status === "waiting_checkpoint" ? (
                    <PauseCircle className="h-3.5 w-3.5 shrink-0 text-warning" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-error" />
                  )}
                  <span className="truncate font-mono text-[11px]">{item.nodeId}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {item.branch ? (
                    <span className="rounded bg-canvas px-1 py-0.5 font-mono text-[10px] text-amber-300">
                      {item.branch}
                    </span>
                  ) : null}
                  {latency ? (
                    <span className="font-mono text-[10px] text-text-muted tabular-nums">{latency}</span>
                  ) : null}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Selected step detail */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {activeLog ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[12px] font-semibold text-text-primary">
                Step {activeLog.step}: {activeLog.nodeId}
              </span>
              {activeLog.traceUrl ? (
                <a
                  href={activeLog.traceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-info hover:underline"
                >
                  <span>Langfuse</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>

            {activeLog.error ? (
              <div className="rounded-md border border-error/40 bg-error/10 p-2 font-mono text-[11px] text-red-300">
                {activeLog.error}
              </div>
            ) : null}

            {activeLog.renderedPrompt ? (
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-text-secondary">Rendered Prompt</div>
                <pre className="max-h-36 overflow-auto rounded-md border border-border-subtle bg-canvas p-2 font-mono text-[11px] text-text-primary whitespace-pre-wrap">
                  {activeLog.renderedPrompt}
                </pre>
              </div>
            ) : null}

            {activeLog.outputPreview ? (
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-text-secondary">Output</div>
                <pre className="max-h-44 overflow-auto rounded-md border border-border-subtle bg-canvas p-2 font-mono text-[11px] text-text-primary whitespace-pre-wrap">
                  {activeLog.outputPreview}
                </pre>
              </div>
            ) : null}
          </>
        ) : null}

        {/* State JSON */}
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-text-secondary">Run State (JSON)</div>
          <pre className="max-h-56 overflow-auto rounded-md border border-border-subtle bg-canvas p-2 font-mono text-[11px] text-text-secondary">
            {JSON.stringify(run.data ?? {}, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
