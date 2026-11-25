"use client";

import { EdgeLabelRenderer, type EdgeProps, useReactFlow } from "@xyflow/react";
import { SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  type EdgeMiddlewareConfig,
  type EdgeMiddlewareStage,
  PORT_TYPE_COLOR,
  type PortDataType,
  type ZipTie,
} from "@/types";
import { type CableRopeState, createCableRope, ropePointsToSvgPath, stepCableRope } from "./cable-physics";

const MIDDLEWARE_STAGES: EdgeMiddlewareStage[] = ["validate", "map", "cast", "redact", "trace", "deliver"];
const CAST_TYPES: PortDataType[] = ["any", "text", "markdown", "json", "number", "boolean", "audio", "memory"];

export interface PatchCableEdgeData extends Record<string, unknown> {
  portType?: PortDataType;
  condition?: string;
  middleware?: EdgeMiddlewareConfig;
  isActive?: boolean;
  isTraversed?: boolean;
  zipTies?: ZipTie[];
}

export function PatchCableEdge({ id, sourceX, sourceY, targetX, targetY, selected, data }: EdgeProps) {
  const edgeData = (data ?? {}) as PatchCableEdgeData;
  const portType = edgeData.portType ?? "any";
  const cableColor = PORT_TYPE_COLOR[portType] ?? PORT_TYPE_COLOR.any;
  const isActive = Boolean(edgeData.isActive);
  const isTraversed = Boolean(edgeData.isTraversed);
  const middleware = edgeData.middleware;
  const activeStages = middleware?.stages ?? [];

  const updateEdge = useWorkflowStore((s) => s.updateEdge);
  const removeEdges = useWorkflowStore((s) => s.removeEdges);
  const { setEdges } = useReactFlow();

  const [pillOpen, setPillOpen] = useState(false);
  const ropeRef = useRef<CableRopeState | null>(null);
  const [pathD, setPathD] = useState<string>(() => {
    const initial = createCableRope(sourceX, sourceY, targetX, targetY);
    ropeRef.current = initial;
    return ropePointsToSvgPath(initial.points);
  });
  const [midPoint, setMidPoint] = useState<{ x: number; y: number }>({
    x: (sourceX + targetX) * 0.5,
    y: (sourceY + targetY) * 0.5 + 24,
  });

  const zipKey = (edgeData.zipTies ?? []).map((zt) => `${zt.position.x},${zt.position.y}`).join("|");
  const zipPoints = useMemo(
    () =>
      zipKey
        ? zipKey.split("|").map((pair) => {
            const [x, y] = pair.split(",").map(Number);
            return { x, y };
          })
        : [],
    [zipKey],
  );

  useEffect(() => {
    if (!ropeRef.current) {
      ropeRef.current = createCableRope(sourceX, sourceY, targetX, targetY);
    }
    let rafId = 0;
    let frame = 0;

    const tick = () => {
      const rope = ropeRef.current;
      if (!rope) return;
      const keepMoving = stepCableRope(rope, sourceX, sourceY, targetX, targetY, zipPoints);
      setPathD(ropePointsToSvgPath(rope.points));
      const mid = rope.points[Math.floor(rope.points.length / 2)];
      if (mid) setMidPoint({ x: mid.x, y: mid.y });
      frame += 1;
      if (keepMoving && frame < 180) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [sourceX, sourceY, targetX, targetY, zipPoints]);

  const toggleStage = (stage: EdgeMiddlewareStage) => {
    const next = activeStages.includes(stage) ? activeStages.filter((s) => s !== stage) : [...activeStages, stage];
    updateEdge(id, {
      middleware: {
        ...middleware,
        stages: next,
      },
    });
  };

  const strokeColor = selected ? "#fafafa" : isActive ? "#38bdf8" : isTraversed ? "#10b981" : cableColor;

  return (
    <>
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        className="cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          setPillOpen((prev) => !prev);
        }}
      />

      <path
        d={pathD}
        fill="none"
        stroke="rgba(0, 0, 0, 0.72)"
        strokeWidth={7}
        strokeLinecap="round"
        transform="translate(0, 3)"
        className="pointer-events-none"
      />

      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth={selected ? 5 : 4.2}
        strokeLinecap="round"
        style={{
          filter: isActive ? `drop-shadow(0 0 8px ${strokeColor})` : undefined,
          opacity: isActive || isTraversed || selected ? 1 : 0.86,
        }}
        className="pointer-events-none transition-colors duration-150"
      />

      <path
        d={pathD}
        fill="none"
        stroke="rgba(255, 255, 255, 0.28)"
        strokeWidth={1.1}
        strokeLinecap="round"
        transform="translate(0, -1)"
        className="pointer-events-none"
      />

      {isActive ? (
        <path
          d={pathD}
          fill="none"
          stroke="#ffffff"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray="10 22"
          className="pointer-events-none animate-[cable-pulse_0.75s_linear_infinite]"
        />
      ) : null}

      <g className="pointer-events-none">
        <rect
          x={sourceX - 2}
          y={sourceY - 4}
          width={11}
          height={8}
          rx={2}
          fill="#18181c"
          stroke="#52525b"
          strokeWidth={1}
        />
        <rect
          x={targetX - 9}
          y={targetY - 4}
          width={11}
          height={8}
          rx={2}
          fill="#18181c"
          stroke="#52525b"
          strokeWidth={1}
        />
      </g>

      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${midPoint.x}px, ${midPoint.y}px)`,
            pointerEvents: "all",
            zIndex: pillOpen ? 40 : 10,
          }}
          className="nodrag nopan"
        >
          {!pillOpen ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPillOpen(true);
              }}
              className="flex items-center gap-1 rounded-full border border-zinc-700/80 bg-zinc-950/90 px-2 py-0.5 font-mono text-[10px] text-zinc-300 shadow-md backdrop-blur-md transition hover:border-zinc-500 hover:text-white"
            >
              <SlidersHorizontal className="h-2.5 w-2.5 text-zinc-400" />
              {edgeData.condition ? (
                <span className="text-amber-400">{edgeData.condition}</span>
              ) : activeStages.length > 0 ? (
                <span className="text-emerald-400">{activeStages.length} mw</span>
              ) : (
                <span className="text-zinc-500">{portType}</span>
              )}
            </button>
          ) : (
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-60 rounded-lg border border-zinc-700/90 bg-zinc-950/95 p-2.5 text-[11px] text-zinc-200 shadow-2xl backdrop-blur-xl"
            >
              <div className="mb-2 flex items-center justify-between border-b border-zinc-800 pb-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Cable Middleware
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title="Disconnect cable"
                    onClick={() => {
                      removeEdges([id]);
                      setEdges((eds) => eds.filter((e) => e.id !== id));
                    }}
                    className="rounded p-0.5 text-zinc-400 hover:bg-red-500/20 hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPillOpen(false)}
                    className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-12 shrink-0 font-mono text-[9px] uppercase text-zinc-500">Branch</span>
                  <input
                    type="text"
                    value={edgeData.condition ?? ""}
                    placeholder="condition..."
                    onChange={(e) => updateEdge(id, { condition: e.target.value || undefined })}
                    className="h-6 flex-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 font-mono text-[10px] text-zinc-200 outline-none focus:border-amber-400/60"
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="w-12 shrink-0 font-mono text-[9px] uppercase text-zinc-500">Cast</span>
                  <select
                    value={middleware?.castTo ?? ""}
                    onChange={(e) =>
                      updateEdge(id, {
                        middleware: {
                          ...middleware,
                          castTo: (e.target.value || undefined) as PortDataType | undefined,
                        },
                      })
                    }
                    className="h-6 flex-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 font-mono text-[10px] text-zinc-200 outline-none focus:border-emerald-500/60"
                  >
                    <option value="">auto</option>
                    {CAST_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap gap-1">
                  {MIDDLEWARE_STAGES.map((stage) => {
                    const enabled = activeStages.includes(stage);
                    return (
                      <button
                        key={stage}
                        type="button"
                        onClick={() => toggleStage(stage)}
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition ${
                          enabled
                            ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
                            : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        {stage}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
