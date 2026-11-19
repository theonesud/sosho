"use client";

import { ArrowRight, ExternalLink, GitBranch, Link2, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  formatLatency,
  NODE_META,
  type NodeExecutionLog,
  type RawGraph,
  type RunDetail,
  type SkillInfo,
} from "@/types";
import { NodeInspector } from "./NodeInspector";

interface GraphInspectorDrawerProps {
  graph: RawGraph;
  runDetail: RunDetail | null;
  readOnly?: boolean;
  availableSkills?: Array<string | SkillInfo>;
  open: boolean;
  onClose: () => void;
  onFocusNode: (nodeId: string) => void;
}

export function GraphInspectorDrawer({
  graph,
  runDetail,
  readOnly = false,
  availableSkills = [],
  open,
  onClose,
  onFocusNode,
}: GraphInspectorDrawerProps) {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const selectedEdgeId = useWorkflowStore((s) => s.selectedEdgeId);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const selectEdge = useWorkflowStore((s) => s.selectEdge);
  const addEdge = useWorkflowStore((s) => s.addEdge);
  const removeEdges = useWorkflowStore((s) => s.removeEdges);

  const [newTargetId, setNewTargetId] = useState("");

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  const nodeLog: NodeExecutionLog | null = useMemo(() => {
    if (!selectedNodeId || !runDetail) return null;
    for (let i = runDetail.history.length - 1; i >= 0; i--) {
      if (runDetail.history[i].nodeId === selectedNodeId) return runDetail.history[i];
    }
    return null;
  }, [selectedNodeId, runDetail]);

  const incoming = useMemo(() => {
    if (!selectedNodeId) return [];
    return graph.edges.filter((e) => e.target === selectedNodeId);
  }, [graph.edges, selectedNodeId]);

  const outgoing = useMemo(() => {
    if (!selectedNodeId) return [];
    return graph.edges.filter((e) => e.source === selectedNodeId);
  }, [graph.edges, selectedNodeId]);

  const linkableTargets = useMemo(() => {
    if (!selectedNodeId) return [];
    const existingTargets = new Set(outgoing.map((e) => e.target));
    return graph.nodes.filter((n) => n.id !== selectedNodeId && !existingTargets.has(n.id));
  }, [graph.nodes, selectedNodeId, outgoing]);

  if (!open) return null;

  const title = selectedEdgeId ? "Edge Inspector" : selectedNodeId ? "Node Inspector" : "Graph Settings";
  const latency = nodeLog ? formatLatency(nodeLog.startedAt, nodeLog.finishedAt) : null;

  return (
    <aside
      aria-label={title}
      className="z-20 flex h-full w-[328px] shrink-0 flex-col border-l border-border-subtle bg-surface transition-transform duration-150"
    >
      {/* Header */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border-subtle px-3.5">
        <span className="text-[12px] font-semibold text-text-primary">{title}</span>
        <Button variant="ghost" size="icon" onClick={onClose} title="Close inspector" className="h-6 w-6">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto">
        {/* Live Run Execution Log (when viewing a run and node ran) */}
        {nodeLog ? (
          <div className="space-y-2 border-b border-border-subtle bg-canvas/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-text-secondary">Execution</span>
                <Badge
                  variant={
                    nodeLog.status === "done"
                      ? "accent"
                      : nodeLog.status === "failed"
                        ? "error"
                        : nodeLog.status === "waiting_checkpoint"
                          ? "warning"
                          : "info"
                  }
                  className="text-[10px]"
                >
                  {nodeLog.status}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {latency ? <span className="font-mono text-[10px] text-text-muted tabular-nums">{latency}</span> : null}
                {nodeLog.traceUrl ? (
                  <a
                    href={nodeLog.traceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline"
                  >
                    Trace <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                ) : null}
              </div>
            </div>

            {nodeLog.branch ? (
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-warning">
                <GitBranch className="h-3 w-3" />
                <span>branch: {nodeLog.branch}</span>
              </div>
            ) : null}

            {nodeLog.error ? (
              <pre className="max-h-28 overflow-auto rounded-md border border-error/40 bg-error/10 p-2 font-mono text-[10px] whitespace-pre-wrap break-words text-error">
                {nodeLog.error}
              </pre>
            ) : null}

            {nodeLog.outputPreview ? (
              <div className="space-y-1">
                <span className="block font-mono text-[10px] text-text-muted">Output</span>
                <pre className="max-h-36 overflow-auto rounded-md border border-border-subtle bg-surface p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-words text-text-secondary">
                  {nodeLog.outputPreview}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Core Node / Edge / Graph Fields */}
        <NodeInspector graph={graph} readOnly={readOnly} availableSkills={availableSkills} />

        {/* Node Connections (Obsidian backlinks & outgoing links) */}
        {selectedNodeId ? (
          <div className="space-y-3 border-t border-border-subtle p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary">
              <Link2 className="h-3.5 w-3.5 text-text-muted" />
              <span>Links</span>
              <span className="font-mono text-[10px] font-normal text-text-muted tabular-nums">
                {incoming.length + outgoing.length}
              </span>
            </div>

            {incoming.length > 0 ? (
              <div className="space-y-1">
                <span className="block font-mono text-[10px] text-text-muted">Incoming</span>
                <div className="space-y-1">
                  {incoming.map((edge) => {
                    const peer = nodeById.get(edge.source);
                    const color = peer ? NODE_META[peer.type].color : "#71717a";
                    return (
                      <div
                        key={edge.id}
                        className="flex items-center justify-between gap-1.5 rounded-md border border-border-subtle bg-canvas px-2 py-1"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            selectNode(edge.source);
                            onFocusNode(edge.source);
                          }}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] text-text-secondary hover:text-text-primary"
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                          <span className="truncate">{peer?.label ?? edge.source}</span>
                        </button>
                        {edge.condition ? (
                          <button
                            type="button"
                            onClick={() => selectEdge(edge.id)}
                            className="shrink-0 rounded border border-border-subtle bg-surface px-1.5 py-0.5 font-mono text-[9px] text-text-muted hover:border-border-strong hover:text-text-primary"
                          >
                            {edge.condition}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {outgoing.length > 0 ? (
              <div className="space-y-1">
                <span className="block font-mono text-[10px] text-text-muted">Outgoing</span>
                <div className="space-y-1">
                  {outgoing.map((edge) => {
                    const peer = nodeById.get(edge.target);
                    const color = peer ? NODE_META[peer.type].color : "#71717a";
                    return (
                      <div
                        key={edge.id}
                        className="flex items-center justify-between gap-1.5 rounded-md border border-border-subtle bg-canvas px-2 py-1"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            selectNode(edge.target);
                            onFocusNode(edge.target);
                          }}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] text-text-secondary hover:text-text-primary"
                        >
                          <ArrowRight className="h-3 w-3 shrink-0 text-text-muted" />
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                          <span className="truncate">{peer?.label ?? edge.target}</span>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          {edge.condition ? (
                            <button
                              type="button"
                              onClick={() => selectEdge(edge.id)}
                              className="rounded border border-border-subtle bg-surface px-1.5 py-0.5 font-mono text-[9px] text-text-muted hover:border-border-strong hover:text-text-primary"
                            >
                              {edge.condition}
                            </button>
                          ) : null}
                          {!readOnly ? (
                            <button
                              type="button"
                              onClick={() => removeEdges([edge.id])}
                              title="Remove link"
                              className="rounded p-0.5 text-text-muted hover:bg-elevated hover:text-error"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {!readOnly && linkableTargets.length > 0 ? (
              <div className="flex items-center gap-1.5 pt-1">
                <select
                  value={newTargetId}
                  onChange={(e) => setNewTargetId(e.target.value)}
                  className="h-7 min-w-0 flex-1 rounded-md border border-border-subtle bg-canvas px-2 text-[11px] text-text-primary focus-visible:border-accent focus-visible:outline-none"
                >
                  <option value="">Connect to node...</option>
                  {linkableTargets.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="secondary"
                  size="xs"
                  disabled={!newTargetId}
                  onClick={() => {
                    if (!newTargetId || !selectedNodeId) return;
                    addEdge(selectedNodeId, newTargetId);
                    setNewTargetId("");
                  }}
                >
                  <Plus className="h-3 w-3" />
                  Link
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
