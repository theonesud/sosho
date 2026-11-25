"use client";

import { AlertTriangle, Check, X } from "lucide-react";
import { useState } from "react";
import { apiJson, authHeaders } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PausedCheckpoint } from "@/types";

interface CheckpointBarProps {
  runId: string;
  checkpoint: PausedCheckpoint;
  onResolved: () => void;
}

export function CheckpointBar({ runId, checkpoint, onResolved }: CheckpointBarProps) {
  const [note, setNote] = useState("");
  const [statePatchText, setStatePatchText] = useState("{}");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (action: "approve" | "reject") => {
    setError(null);
    let statePatch: Record<string, unknown> | undefined;
    if (checkpoint.allowStateEdit && statePatchText.trim()) {
      try {
        const parsed = JSON.parse(statePatchText) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          statePatch = parsed as Record<string, unknown>;
        } else {
          setError("State patch must be a JSON object.");
          return;
        }
      } catch {
        setError("State patch is not valid JSON.");
        return;
      }
    }

    setSubmitting(true);
    const res = await apiJson<{ ok: boolean }>(`/api/runs/${encodeURIComponent(runId)}/checkpoint`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        nodeId: checkpoint.nodeId,
        action,
        note: note.trim() || undefined,
        statePatch,
      }),
    });
    setSubmitting(false);

    if (!res.ok) {
      setError(res.data.error || `Failed to ${action} checkpoint.`);
      return;
    }
    setNote("");
    onResolved();
  };

  return (
    <div className="pointer-events-auto absolute left-1/2 top-3 z-20 w-[min(560px,calc(100%-24px))] -translate-x-1/2 rounded-xl border border-warning/45 bg-elevated p-3 shadow-[0_12px_36px_rgba(0,0,0,0.65)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-amber-200">Checkpoint Paused</span>
              <span className="font-mono text-[11px] text-text-muted">{checkpoint.nodeId}</span>
            </div>
            {checkpoint.message ? <p className="mt-0.5 text-[12px] text-text-secondary">{checkpoint.message}</p> : null}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="danger" size="xs" disabled={submitting} onClick={() => submit("reject")}>
            <X className="h-3 w-3" />
            Reject
          </Button>
          <Button variant="primary" size="xs" disabled={submitting} onClick={() => submit("approve")}>
            <Check className="h-3 w-3" />
            Approve
          </Button>
        </div>
      </div>

      <div className="mt-2.5 space-y-2">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional reviewer note..."
          disabled={submitting}
        />

        {checkpoint.allowStateEdit ? (
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-text-secondary">State Patch (JSON)</label>
            <Textarea
              value={statePatchText}
              onChange={(e) => setStatePatchText(e.target.value)}
              className="min-h-[60px] font-mono text-[11px]"
              disabled={submitting}
            />
          </div>
        ) : null}

        {error ? <div className="text-[11px] text-red-400">{error}</div> : null}
      </div>
    </div>
  );
}
