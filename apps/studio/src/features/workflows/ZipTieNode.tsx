"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { Cable, Magnet, X } from "lucide-react";
import { useWorkflowStore } from "@/stores/workflow-store";

export interface ZipTieNodeData extends Record<string, unknown> {
  zipTieId: string;
  edgeCount: number;
  label?: string;
  onGatherNearby?: (zipTieId: string) => void;
}

export type ZipTieFlowNode = Node<ZipTieNodeData, "zipTie">;

export function ZipTieNode({ data, selected }: NodeProps<ZipTieFlowNode>) {
  const removeZipTie = useWorkflowStore((s) => s.removeZipTie);

  return (
    <div
      className={`group relative flex items-center gap-1.5 rounded-full border px-2.5 py-1 shadow-[0_6px_18px_rgba(0,0,0,0.75)] backdrop-blur-md transition ${
        selected ? "border-emerald-400/80 bg-zinc-900/95" : "border-zinc-600/80 bg-zinc-950/90 hover:border-zinc-400"
      }`}
    >
      {/* Top specular highlight */}
      <span className="pointer-events-none absolute inset-x-2 top-0 h-px bg-white/25" />

      <Cable className="h-3 w-3 text-emerald-400" />
      <span className="font-mono text-[10px] font-semibold text-zinc-200 tabular-nums">
        {data.label || "TIE"} · {data.edgeCount}
      </span>

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
  );
}
