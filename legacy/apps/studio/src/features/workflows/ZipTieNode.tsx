"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { Cable, Magnet, X } from "lucide-react";
import { useState } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";

export interface ZipTieNodeData extends Record<string, unknown> {
  zipTieId: string;
  edgeIds: string[];
  label?: string;
  onGatherNearby?: (zipTieId: string) => void;
}

export type ZipTieFlowNode = Node<ZipTieNodeData, "zipTie">;

export function ZipTieNode({ data, selected }: NodeProps<ZipTieFlowNode>) {
  const removeZipTie = useWorkflowStore((s) => s.removeZipTie);
  const detachEdgeFromZipTie = useWorkflowStore((s) => s.detachEdgeFromZipTie);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <div
        className={`group relative flex items-center gap-1.5 rounded-full border px-2.5 py-1 shadow-[0_6px_18px_rgba(0,0,0,0.75)] backdrop-blur-md transition ${
          selected ? "border-emerald-400/80 bg-zinc-900/95" : "border-zinc-600/80 bg-zinc-950/90 hover:border-zinc-400"
        }`}
      >
        <span className="pointer-events-none absolute inset-x-2 top-0 h-px bg-white/25" />

        <Cable className="h-3 w-3 text-emerald-400" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="nodrag font-mono text-[10px] font-semibold text-zinc-200 tabular-nums hover:text-emerald-300"
        >
          {data.label || "TIE"} · {data.edgeIds.length}
        </button>

        {data.onGatherNearby ? (
          <button
            type="button"
            title="Gather nearby cables"
            onClick={(e) => {
              e.stopPropagation();
              data.onGatherNearby?.(data.zipTieId);
            }}
            className="nodrag rounded-full p-0.5 text-zinc-400 hover:bg-emerald-500/20 hover:text-emerald-300"
          >
            <Magnet className="h-2.5 w-2.5" />
          </button>
        ) : null}

        <button
          type="button"
          title="Cut zip-tie"
          onClick={(e) => {
            e.stopPropagation();
            removeZipTie(data.zipTieId);
          }}
          className="nodrag rounded-full p-0.5 text-zinc-500 hover:bg-red-500/20 hover:text-red-400"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>

      {open && data.edgeIds.length > 0 ? (
        <div
          onClick={(e) => e.stopPropagation()}
          className="nodrag nopan absolute left-1/2 top-8 z-30 w-44 -translate-x-1/2 rounded-lg border border-zinc-700/90 bg-zinc-950/95 p-1.5 shadow-2xl backdrop-blur-xl"
        >
          <div className="mb-1 px-1 font-mono text-[9px] uppercase text-zinc-500">Bundled Cables</div>
          <div className="max-h-28 space-y-1 overflow-auto">
            {data.edgeIds.map((eid) => (
              <div key={eid} className="flex items-center justify-between gap-1 rounded bg-zinc-900/90 px-1.5 py-0.5">
                <span className="truncate font-mono text-[9px] text-zinc-300">{eid}</span>
                <button
                  type="button"
                  title="Detach cable"
                  onClick={() => detachEdgeFromZipTie(data.zipTieId, eid)}
                  className="text-zinc-500 hover:text-red-400"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
