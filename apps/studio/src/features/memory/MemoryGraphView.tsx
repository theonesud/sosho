"use client";

import { Background, Controls, type Edge, MarkerType, type Node, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { MemoryRecord } from "./types";

interface MemoryGraphViewProps {
  items: MemoryRecord[];
  onSelectMemory?: (item: MemoryRecord) => void;
}

const TYPE_ACCENT: Record<string, string> = {
  semantic: "#10b981",
  procedural: "#38bdf8",
  episodic: "#f59e0b",
  entity: "#a78bfa",
};

export function MemoryGraphView({ items, onSelectMemory }: MemoryGraphViewProps) {
  const { nodes, edges } = useMemo(() => {
    const nextNodes: Node[] = [];
    const nextEdges: Edge[] = [];
    const entityMap = new Map<string, string[]>();

    items.forEach((item, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const accent = TYPE_ACCENT[item.type] ?? "#71717a";

      nextNodes.push({
        id: `mem:${item.id}`,
        position: { x: col * 280 + 40, y: row * 140 + 40 },
        data: {
          label: (
            <div className="text-left">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-400">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
                <span>{item.scope}</span>
                <span>·</span>
                <span>{item.type}</span>
              </div>
              <div className="mt-0.5 line-clamp-2 text-[12px] font-medium text-zinc-100">{item.title}</div>
            </div>
          ),
        },
        style: {
          width: 230,
          background: "#18181c",
          border: `1px solid ${item.archived ? "#3f3f46" : accent}`,
          borderRadius: 6,
          padding: "8px 10px",
          opacity: item.archived ? 0.55 : 1,
          color: "#fafafa",
        },
      });

      for (const rawEntity of item.entities ?? []) {
        const entity = rawEntity.trim();
        if (!entity) continue;
        const list = entityMap.get(entity) ?? [];
        list.push(item.id);
        entityMap.set(entity, list);
      }
    });

    const baseEntityY = Math.ceil(items.length / 3) * 140 + 100;
    let entityIdx = 0;
    for (const [entity, memIds] of entityMap.entries()) {
      const entityNodeId = `ent:${entity}`;
      const col = entityIdx % 4;
      const row = Math.floor(entityIdx / 4);
      entityIdx += 1;

      nextNodes.push({
        id: entityNodeId,
        position: { x: col * 210 + 60, y: baseEntityY + row * 90 },
        data: {
          label: (
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-emerald-300">
              <span className="truncate">{entity}</span>
              <span className="text-[10px] text-zinc-400">{memIds.length}</span>
            </div>
          ),
        },
        style: {
          width: 180,
          background: "#111114",
          border: "1px solid #27272a",
          borderRadius: 999,
          padding: "6px 12px",
          color: "#fafafa",
        },
      });

      for (const memId of memIds) {
        nextEdges.push({
          id: `edge:${memId}:${entity}`,
          source: `mem:${memId}`,
          target: entityNodeId,
          style: { stroke: "#3f3f46", strokeWidth: 1.25 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#52525b" },
        });
      }
    }

    return { nodes: nextNodes, edges: nextEdges };
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-md border border-border-subtle bg-surface text-[12px] text-text-muted">
        No memory nodes to visualize. Create a memory or broaden your search query.
      </div>
    );
  }

  return (
    <div className="h-[560px] w-full overflow-hidden rounded-md border border-border-subtle bg-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        colorMode="dark"
        onNodeClick={(_event, node) => {
          if (!onSelectMemory || !node.id.startsWith("mem:")) return;
          const id = node.id.slice(4);
          const found = items.find((m) => m.id === id);
          if (found) onSelectMemory(found);
        }}
      >
        <Background color="#27272a" gap={20} size={1} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
