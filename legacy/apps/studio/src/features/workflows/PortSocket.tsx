"use client";

import { Handle, type HandleProps, type Position } from "@xyflow/react";
import { PORT_TYPE_COLOR, type PortDataType } from "@/types";

interface PortSocketProps {
  id: string;
  type: HandleProps["type"];
  position: Position;
  dataType?: PortDataType;
  label?: string;
  topOffsetPct?: number;
}

export function PortSocket({ id, type, position, dataType = "any", label, topOffsetPct }: PortSocketProps) {
  const color = PORT_TYPE_COLOR[dataType] ?? PORT_TYPE_COLOR.any;
  const isSource = type === "source";

  return (
    <Handle
      id={id}
      type={type}
      position={position}
      title={label ? `${label} (${dataType})` : dataType}
      style={topOffsetPct !== undefined ? { top: `${topOffsetPct}%` } : undefined}
      className="!group !h-4 !w-4 !rounded-full !border !border-zinc-500/80 !bg-gradient-to-b !from-zinc-600 !to-zinc-900 !shadow-[inset_0_1px_1px_rgba(255,255,255,0.28),0_2px_6px_rgba(0,0,0,0.85)] transition-transform duration-150 hover:!scale-125"
    >
      {/* Inner machined jack sleeve + colored type ring */}
      <span
        className="pointer-events-none absolute inset-[3px] rounded-full bg-zinc-950"
        style={{
          boxShadow: `inset 0 0 0 1.5px ${color}, 0 0 6px ${color}55`,
        }}
      />
      {label ? (
        <span
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-zinc-950/90 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300 opacity-0 ring-1 ring-zinc-700/70 transition-opacity group-hover:opacity-100 ${
            isSource ? "left-5" : "right-5"
          }`}
        >
          {label}
        </span>
      ) : null}
    </Handle>
  );
}
