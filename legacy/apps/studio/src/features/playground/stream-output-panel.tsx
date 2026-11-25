"use client";

import { AlertTriangle, Check, Copy, GitBranchPlus, Sparkles } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StreamOutputState } from "./types";

interface StreamOutputPanelProps {
  title: string;
  subtitle?: string;
  state: StreamOutputState;
  emptyHint: string;
  onPromote?: () => void;
  promoteLabel?: string;
  className?: string;
}

function formatDuration(ms?: number): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function StreamOutputPanel({
  title,
  subtitle,
  state,
  emptyHint,
  onPromote,
  promoteLabel = "Promote",
  className,
}: StreamOutputPanelProps) {
  const [copied, setCopied] = useState(false);

  const durationText = formatDuration(state.durationMs);
  const tpsText =
    typeof state.tokensPerSec === "number" && Number.isFinite(state.tokensPerSec) && state.tokensPerSec > 0
      ? `${state.tokensPerSec.toFixed(1)} tok/s`
      : null;

  const providerModel =
    state.provider && state.model ? `${state.provider} / ${state.model}` : state.model || state.provider || null;

  const handleCopy = async () => {
    if (!state.content) return;
    try {
      await navigator.clipboard.writeText(state.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <section
      className={cn(
        "flex min-h-0 flex-1 flex-col rounded-lg border border-border-subtle bg-surface overflow-hidden",
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-elevated/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              state.status === "streaming" && "animate-pulse bg-info",
              state.status === "done" && "bg-accent",
              state.status === "aborted" && "bg-warning",
              state.status === "error" && "bg-error",
              state.status === "idle" && "bg-zinc-600",
            )}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-[12px] font-semibold text-text-primary">{title}</span>
              {subtitle ? <span className="truncate text-[11px] text-text-muted">{subtitle}</span> : null}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {providerModel ? (
            <Badge variant="neutral" className="font-mono max-w-[220px] truncate" title={providerModel}>
              {providerModel}
            </Badge>
          ) : null}

          {state.fallbackUsed ? (
            <Badge variant="warning" title="Primary endpoint failed or was unavailable; fallback tier used">
              <AlertTriangle className="h-3 w-3" />
              Fallback
            </Badge>
          ) : null}

          {tpsText ? <Badge variant="info">{tpsText}</Badge> : null}

          {durationText ? <Badge variant="neutral">{durationText}</Badge> : null}

          {state.status === "aborted" ? <Badge variant="warning">Stopped</Badge> : null}

          {state.content ? (
            <Button type="button" variant="ghost" size="xs" onClick={handleCopy} title="Copy output">
              {copied ? <Check className="h-3 w-3 text-accent" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          ) : null}

          {onPromote ? (
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={onPromote}
              title="Add this configuration as a node in the active workflow"
            >
              <GitBranchPlus className="h-3 w-3 text-accent" />
              {promoteLabel}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {state.error ? (
          <div className="mb-3 rounded-md border border-error/35 bg-error/10 px-3 py-2 text-[12px] text-red-300">
            <span className="font-semibold">Error:</span> {state.error}
          </div>
        ) : null}

        {state.content ? (
          <div className="max-w-[75ch] whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-text-primary">
            {state.content}
            {state.status === "streaming" ? (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-info align-middle" />
            ) : null}
          </div>
        ) : state.status === "streaming" ? (
          <div className="flex items-center gap-2 text-[12px] text-text-secondary">
            <span className="h-2 w-2 animate-pulse rounded-full bg-info" />
            Waiting for first token…
          </div>
        ) : (
          <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 text-center">
            <Sparkles className="h-5 w-5 text-text-muted" />
            <p className="max-w-sm text-[12px] text-text-secondary">{emptyHint}</p>
          </div>
        )}
      </div>
    </section>
  );
}
