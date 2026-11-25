"use client";

import {
  ArrowRight,
  Bot,
  Brain,
  ExternalLink,
  GitBranch,
  GitFork,
  Link2,
  LogIn,
  LogOut,
  PauseCircle,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn, normalizeSkills } from "@/lib/utils";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  checkNodeCompatibility,
  deriveNodePorts,
  type EdgeMiddlewareStage,
  formatLatency,
  MIDDLEWARE_STAGES,
  MODEL_TIERS,
  type ModelCatalogEntry,
  NODE_META,
  type NodeExecutionLog,
  type NodeKind,
  PORT_DATA_TYPES,
  type PortDataType,
  QUEUE_LANES,
  type RawGraph,
  type RawGraphEdge,
  type RawGraphNode,
  type RunDetail,
  type SkillInfo,
} from "@/types";

export const PRIMARY_NODE_KINDS: Array<{ kind: NodeKind; label: string; icon: typeof Bot }> = [
  { kind: "agent", label: "Agent", icon: Bot },
  { kind: "skill", label: "Skill", icon: Sparkles },
  { kind: "tool", label: "Tool", icon: Wrench },
];

export const SECONDARY_NODE_KINDS: Array<{ kind: NodeKind; label: string; icon: typeof Bot }> = [
  { kind: "decision", label: "Decision", icon: GitFork },
  { kind: "memory", label: "Memory", icon: Brain },
  { kind: "checkpoint", label: "Checkpoint", icon: PauseCircle },
  { kind: "subagent", label: "Subagent", icon: Users },
];

export const NODE_KIND_ITEMS = [...PRIMARY_NODE_KINDS, ...SECONDARY_NODE_KINDS];

const selectClass =
  "flex h-7 w-full rounded-md border border-border-subtle bg-canvas px-2 text-[11px] text-text-primary transition-colors duration-150 hover:border-border-strong focus-visible:border-accent focus-visible:outline-none disabled:opacity-50";

function extractVarsFromText(text: string): string[] {
  const vars = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  let m = re.exec(text);
  while (m) {
    vars.add(m[1]);
    m = re.exec(text);
  }
  return Array.from(vars);
}

interface AnchoredNodePopoverProps {
  graph: RawGraph;
  node: RawGraphNode;
  runDetail: RunDetail | null;
  readOnly: boolean;
  availableSkills: Array<string | SkillInfo>;
  modelCatalog?: ModelCatalogEntry[];
  screenPos: { x: number; y: number };
  bounds: { width: number; height: number };
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onRollbackToStep?: (step: number) => void;
}

export function AnchoredNodePopover({
  graph,
  node,
  runDetail,
  readOnly,
  availableSkills,
  modelCatalog = [],
  screenPos,
  bounds,
  onClose,
  onSelectNode,
  onSelectEdge,
  onRollbackToStep,
}: AnchoredNodePopoverProps) {
  const updateNode = useWorkflowStore((s) => s.updateNode);
  const updateGraphMeta = useWorkflowStore((s) => s.updateGraphMeta);
  const removeNodes = useWorkflowStore((s) => s.removeNodes);
  const addEdge = useWorkflowStore((s) => s.addEdge);
  const removeEdges = useWorkflowStore((s) => s.removeEdges);

  const [newTargetId, setNewTargetId] = useState("");
  const [newBranchName, setNewBranchName] = useState("");

  const meta = NODE_META[node.type] ?? NODE_META.agent;
  const isEntry = graph.entryNode === node.id;
  const isOutput = Boolean(node.isOutput);

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const ports = useMemo(() => deriveNodePorts(node), [node]);

  const nodeLog: NodeExecutionLog | null = useMemo(() => {
    if (!runDetail) return null;
    for (let i = runDetail.history.length - 1; i >= 0; i--) {
      if (runDetail.history[i].nodeId === node.id) return runDetail.history[i];
    }
    return null;
  }, [runDetail, node.id]);

  const incoming = useMemo(() => graph.edges.filter((e) => e.target === node.id), [graph.edges, node.id]);
  const outgoing = useMemo(() => graph.edges.filter((e) => e.source === node.id), [graph.edges, node.id]);
  const linkableTargets = useMemo(() => {
    const existing = new Set(outgoing.map((e) => e.target));
    return graph.nodes.filter((n) => n.id !== node.id && !existing.has(n.id));
  }, [graph.nodes, node.id, outgoing]);

  const promptVars = useMemo(() => {
    const raw =
      typeof node.promptTemplate === "string"
        ? node.promptTemplate
        : typeof node.queryOrTitleTemplate === "string"
          ? node.queryOrTitleTemplate
          : "";
    return extractVarsFromText(raw);
  }, [node.promptTemplate, node.queryOrTitleTemplate]);

  const selectedCatalogModel = useMemo(
    () => modelCatalog.find((m) => m.id === node.modelId) ?? null,
    [modelCatalog, node.modelId],
  );

  const cardW = 348;
  const maxCardH = Math.min(580, Math.max(300, bounds.height - 28));
  const preferRight = screenPos.x + 36 + cardW < bounds.width - 12;
  const left = preferRight
    ? Math.min(bounds.width - cardW - 12, Math.max(12, screenPos.x + 36))
    : Math.max(12, screenPos.x - cardW - 36);
  const top = Math.max(12, Math.min(bounds.height - maxCardH - 12, screenPos.y - 96));

  const latency = nodeLog ? formatLatency(nodeLog.startedAt, nodeLog.finishedAt) : null;
  const previewLimit = node.outputVisibility?.previewLength ?? 240;

  return (
    <div
      style={{ left, top, width: cardW, maxHeight: maxCardH }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="absolute z-30 flex flex-col overflow-hidden rounded-xl border border-border-strong bg-surface/98 shadow-[0_16px_48px_rgba(0,0,0,0.65)] backdrop-blur-md"
    >
      {/* Card Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
          <span className="shrink-0 font-mono text-[10px] font-semibold tracking-wide text-text-secondary">
            {meta.badge}
          </span>
          <span className="truncate font-mono text-[10px] text-text-muted">{node.id}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!readOnly ? (
            <button
              type="button"
              onClick={() => {
                removeNodes([node.id]);
                onClose();
              }}
              title="Delete node"
              className="rounded p-1 text-text-muted transition-colors hover:bg-elevated hover:text-error"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="rounded p-1 text-text-muted transition-colors hover:bg-elevated hover:text-text-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Role Toggle Strip (First / Last Node) */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border-subtle bg-canvas/50 px-3 py-1.5">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => updateGraphMeta({ entryNode: node.id })}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-60",
            isEntry ? "bg-accent/15 text-accent" : "text-text-secondary hover:bg-elevated hover:text-text-primary",
          )}
        >
          <LogIn className="h-3 w-3" />
          <span>First Node</span>
        </button>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => updateNode(node.id, { isOutput: !isOutput })}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-60",
            isOutput ? "bg-info/15 text-info" : "text-text-secondary hover:bg-elevated hover:text-text-primary",
          )}
        >
          <LogOut className="h-3 w-3" />
          <span>Last Node</span>
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* Live / Historical Run Output + Middleware + Memory Recall + Rollback */}
        {nodeLog ? (
          <div className="space-y-2 rounded-lg border border-border-subtle bg-canvas p-2.5">
            <div className="flex items-center justify-between gap-2">
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
                {onRollbackToStep && runDetail?.status !== "running" ? (
                  <button
                    type="button"
                    onClick={() => onRollbackToStep(nodeLog.step)}
                    title="Resume run from this step"
                    className="inline-flex items-center gap-1 rounded border border-border-subtle bg-surface px-1.5 py-0.5 text-[10px] text-text-secondary hover:border-border-strong hover:text-text-primary"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    Resume
                  </button>
                ) : null}
              </div>
            </div>

            {nodeLog.memoryRecall ? (
              <div className="rounded border border-info/30 bg-info/10 px-2 py-1 text-[10px] text-info">
                <div className="font-medium">
                  Memory recall: {nodeLog.memoryRecall.count} hit{nodeLog.memoryRecall.count === 1 ? "" : "s"}
                </div>
                {nodeLog.memoryRecall.preview ? (
                  <div className="mt-0.5 truncate text-[9px] opacity-85">{nodeLog.memoryRecall.preview}</div>
                ) : null}
              </div>
            ) : null}

            {nodeLog.decisionLog ? (
              <div className="flex items-center gap-1.5 font-mono text-[10px] text-warning">
                <GitBranch className="h-3 w-3" />
                <span>
                  decision: {nodeLog.decisionLog.chosenBranch}
                  {nodeLog.decisionLog.modelId ? ` (${nodeLog.decisionLog.modelId})` : ""}
                </span>
              </div>
            ) : nodeLog.branch ? (
              <div className="flex items-center gap-1.5 font-mono text-[10px] text-warning">
                <GitBranch className="h-3 w-3" />
                <span>branch: {nodeLog.branch}</span>
              </div>
            ) : null}

            {nodeLog.middlewareTraces && nodeLog.middlewareTraces.length > 0 ? (
              <div className="space-y-0.5 rounded border border-border-subtle bg-surface p-1.5">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">Middleware</div>
                {nodeLog.middlewareTraces.map((tr) => (
                  <div key={tr} className="truncate font-mono text-[9px] text-text-secondary">
                    {tr}
                  </div>
                ))}
              </div>
            ) : null}

            {nodeLog.error ? (
              <pre className="max-h-24 overflow-auto rounded border border-error/40 bg-error/10 p-2 font-mono text-[10px] whitespace-pre-wrap break-words text-error">
                {nodeLog.error}
              </pre>
            ) : null}

            {nodeLog.outputPreview ? (
              <pre className="max-h-32 overflow-auto rounded border border-border-subtle bg-surface p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-words text-text-secondary">
                {nodeLog.outputPreview.slice(0, previewLimit)}
              </pre>
            ) : null}
          </div>
        ) : null}

        {/* Label */}
        <div className="space-y-1">
          <label className="block text-[10px] font-medium text-text-secondary">Label</label>
          <Input
            value={node.label}
            disabled={readOnly}
            onChange={(e) => updateNode(node.id, { label: e.target.value })}
            className="h-7 text-[12px]"
          />
        </div>

        {/* Model Picker (exact model id + tags, plus tier fallback) + Input Type */}
        {(node.type === "agent" || node.type === "subagent" || node.type === "decision" || node.type === "skill") && (
          <div className="space-y-2">
            {modelCatalog.length > 0 ? (
              <div className="space-y-1">
                <label className="block text-[10px] font-medium text-text-secondary">Model</label>
                <select
                  value={String(node.modelId ?? "")}
                  disabled={readOnly}
                  onChange={(e) => updateNode(node.id, { modelId: e.target.value || undefined })}
                  className={selectClass}
                >
                  <option value="">Role default ({String(node.tier ?? "main")})</option>
                  {modelCatalog.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id} ({m.provider})
                    </option>
                  ))}
                </select>
                {selectedCatalogModel ? (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {selectedCatalogModel.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded border border-border-subtle bg-canvas px-1.5 py-0.5 font-mono text-[9px] text-text-secondary"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="block text-[10px] font-medium text-text-secondary">Role Tier</label>
                <select
                  value={String(node.tier ?? "main")}
                  disabled={readOnly}
                  onChange={(e) => updateNode(node.id, { tier: e.target.value })}
                  className={selectClass}
                >
                  {MODEL_TIERS.map((tier) => (
                    <option key={tier} value={tier}>
                      {tier}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-medium text-text-secondary">Input Type</label>
                <select
                  value={String(node.inputType ?? "text")}
                  disabled={readOnly}
                  onChange={(e) => updateNode(node.id, { inputType: e.target.value as PortDataType })}
                  className={selectClass}
                >
                  {PORT_DATA_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Prompt / Template */}
        {(node.type === "agent" || node.type === "subagent" || node.type === "decision") && (
          <div className="space-y-1">
            <label className="block text-[10px] font-medium text-text-secondary">Prompt Template</label>
            <Textarea
              value={String(node.promptTemplate ?? "")}
              disabled={readOnly}
              onChange={(e) => updateNode(node.id, { promptTemplate: e.target.value })}
              className="min-h-[76px] font-mono text-[11px]"
              placeholder="Use {{variable}} placeholders..."
            />
            {promptVars.length > 0 ? (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {promptVars.map((v) => (
                  <span
                    key={v}
                    className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[9px] text-accent"
                  >
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {/* Decision Branches */}
        {node.type === "decision" && (
          <div className="space-y-1.5">
            <label className="block text-[10px] font-medium text-text-secondary">Decision Branches</label>
            <div className="flex flex-wrap gap-1">
              {(Array.isArray(node.branches) ? (node.branches as string[]) : ["yes", "no"]).map((branch) => (
                <span
                  key={branch}
                  className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning"
                >
                  {branch}
                  {!readOnly && (node.branches as string[]).length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        updateNode(node.id, {
                          branches: (node.branches as string[]).filter((b) => b !== branch),
                        })
                      }
                      className="hover:text-error"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
            {!readOnly ? (
              <div className="flex gap-1">
                <Input
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="Add branch..."
                  className="h-6 font-mono text-[11px]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newBranchName.trim()) {
                      const existing = Array.isArray(node.branches) ? (node.branches as string[]) : [];
                      if (!existing.includes(newBranchName.trim())) {
                        updateNode(node.id, { branches: [...existing, newBranchName.trim()] });
                      }
                      setNewBranchName("");
                    }
                  }}
                />
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => {
                    if (!newBranchName.trim()) return;
                    const existing = Array.isArray(node.branches) ? (node.branches as string[]) : [];
                    if (!existing.includes(newBranchName.trim())) {
                      updateNode(node.id, { branches: [...existing, newBranchName.trim()] });
                    }
                    setNewBranchName("");
                  }}
                >
                  Add
                </Button>
              </div>
            ) : null}
          </div>
        )}

        {node.type === "tool" && (
          <>
            <div className="space-y-1">
              <label className="block text-[10px] font-medium text-text-secondary">Tool Kind</label>
              <select
                value={String(node.toolKind ?? "shell")}
                disabled={readOnly}
                onChange={(e) => updateNode(node.id, { toolKind: e.target.value })}
                className={selectClass}
              >
                <option value="shell">shell</option>
                <option value="http">http</option>
                <option value="yue2">yue2</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-medium text-text-secondary">Command or URL</label>
              <Input
                value={String(node.commandOrUrl ?? "")}
                disabled={readOnly}
                onChange={(e) => updateNode(node.id, { commandOrUrl: e.target.value })}
                className="h-7 font-mono text-[11px]"
              />
            </div>
          </>
        )}

        {node.type === "skill" && (
          <>
            <div className="space-y-1">
              <label className="block text-[10px] font-medium text-text-secondary">Skill Name</label>
              {availableSkills.length > 0 ? (
                <select
                  value={String(node.skillName ?? "")}
                  disabled={readOnly}
                  onChange={(e) => updateNode(node.id, { skillName: e.target.value })}
                  className={selectClass}
                >
                  <option value="">Select skill...</option>
                  {normalizeSkills(availableSkills).map((sk, idx) => (
                    <option key={sk.path || `${sk.name}-${idx}`} value={sk.name}>
                      {sk.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={String(node.skillName ?? "")}
                  disabled={readOnly}
                  onChange={(e) => updateNode(node.id, { skillName: e.target.value })}
                  className="h-7 font-mono text-[11px]"
                />
              )}
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-medium text-text-secondary">Prompt Template</label>
              <Textarea
                value={String(node.promptTemplate ?? "")}
                disabled={readOnly}
                onChange={(e) => updateNode(node.id, { promptTemplate: e.target.value })}
                className="min-h-[72px] font-mono text-[11px]"
              />
            </div>
          </>
        )}

        {node.type === "memory" && (
          <>
            <div className="space-y-1">
              <label className="block text-[10px] font-medium text-text-secondary">Operation</label>
              <select
                value={String(node.operation ?? "search")}
                disabled={readOnly}
                onChange={(e) => updateNode(node.id, { operation: e.target.value })}
                className={selectClass}
              >
                <option value="search">search</option>
                <option value="save">save</option>
                <option value="consolidate">consolidate</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-medium text-text-secondary">Query or Title Template</label>
              <Input
                value={String(node.queryOrTitleTemplate ?? "")}
                disabled={readOnly}
                onChange={(e) => updateNode(node.id, { queryOrTitleTemplate: e.target.value })}
                className="h-7 font-mono text-[11px]"
              />
            </div>
          </>
        )}

        {node.type === "checkpoint" && (
          <>
            <div className="space-y-1">
              <label className="block text-[10px] font-medium text-text-secondary">Reviewer Message</label>
              <Textarea
                value={String(node.message ?? "")}
                disabled={readOnly}
                onChange={(e) => updateNode(node.id, { message: e.target.value })}
                className="min-h-[68px] text-[11px]"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-text-secondary">
              <input
                type="checkbox"
                checked={Boolean(node.allowStateEdit)}
                disabled={readOnly}
                onChange={(e) => updateNode(node.id, { allowStateEdit: e.target.checked })}
                className="accent-emerald-500"
              />
              <span>Allow state JSON patch on approve</span>
            </label>
          </>
        )}

        {/* Collapsible Typed Ports (Inputs & Outputs) */}
        <Accordion type="multiple" className="border-t border-border-subtle pt-1">
          <AccordionItem value="inputs" className="border-b-0">
            <AccordionTrigger className="py-1.5 text-[11px]">Inputs ({ports.inputs.length})</AccordionTrigger>
            <AccordionContent className="space-y-1.5 pb-2">
              {ports.inputs.map((port) => (
                <div
                  key={port.id}
                  className="flex items-center justify-between rounded border border-border-subtle bg-canvas px-2 py-1 font-mono text-[10px]"
                >
                  <span className="text-text-primary">{port.name}</span>
                  <span className="text-accent">{port.type}</span>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="outputs" className="border-b-0">
            <AccordionTrigger className="py-1.5 text-[11px]">Outputs ({ports.outputs.length})</AccordionTrigger>
            <AccordionContent className="space-y-1.5 pb-2">
              {ports.outputs.map((port) => (
                <div
                  key={port.id}
                  className="flex items-center justify-between rounded border border-border-subtle bg-canvas px-2 py-1 font-mono text-[10px]"
                >
                  <span className="text-text-primary">{port.name}</span>
                  <span className="text-info">{port.type}</span>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Connections */}
        <div className="space-y-2 border-t border-border-subtle pt-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            <Link2 className="h-3 w-3" />
            <span>Connections</span>
          </div>

          {incoming.length === 0 && outgoing.length === 0 ? (
            <div className="text-[11px] text-text-muted">No links connected yet.</div>
          ) : (
            <div className="space-y-1">
              {incoming.map((edge) => {
                const peer = nodeById.get(edge.source);
                const compat = peer
                  ? checkNodeCompatibility(peer, node, edge, Boolean(graph.policy?.strictCompatibility))
                  : "compatible";
                return (
                  <div
                    key={edge.id}
                    className="flex items-center justify-between gap-1.5 rounded-md border border-border-subtle bg-canvas px-2 py-1"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectNode(edge.source)}
                      className="min-w-0 flex-1 truncate text-left text-[11px] text-text-secondary hover:text-text-primary"
                    >
                      from {peer?.label ?? edge.source}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectEdge(edge.id)}
                      className={cn(
                        "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px]",
                        compat === "compatible"
                          ? "border-accent/30 text-accent"
                          : compat === "cast"
                            ? "border-warning/40 text-warning"
                            : "border-error/40 text-error",
                      )}
                    >
                      {edge.condition || compat}
                    </button>
                  </div>
                );
              })}

              {outgoing.map((edge) => {
                const peer = nodeById.get(edge.target);
                const compat = peer
                  ? checkNodeCompatibility(node, peer, edge, Boolean(graph.policy?.strictCompatibility))
                  : "compatible";
                return (
                  <div
                    key={edge.id}
                    className="flex items-center justify-between gap-1.5 rounded-md border border-border-subtle bg-canvas px-2 py-1"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectNode(edge.target)}
                      className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] text-text-secondary hover:text-text-primary"
                    >
                      <ArrowRight className="h-3 w-3 shrink-0 text-text-muted" />
                      <span className="truncate">{peer?.label ?? edge.target}</span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onSelectEdge(edge.id)}
                        className={cn(
                          "rounded border px-1.5 py-0.5 font-mono text-[9px]",
                          compat === "compatible"
                            ? "border-border-subtle bg-surface text-text-muted hover:text-text-primary"
                            : compat === "cast"
                              ? "border-warning/40 bg-warning/10 text-warning"
                              : "border-error/40 bg-error/10 text-error",
                        )}
                      >
                        {edge.condition || "middleware"}
                      </button>
                      {!readOnly ? (
                        <button
                          type="button"
                          onClick={() => removeEdges([edge.id])}
                          title="Remove link"
                          className="rounded p-0.5 text-text-muted hover:text-error"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!readOnly && linkableTargets.length > 0 ? (
            <div className="flex items-center gap-1.5 pt-0.5">
              <select value={newTargetId} onChange={(e) => setNewTargetId(e.target.value)} className={selectClass}>
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
                  if (!newTargetId) return;
                  addEdge(node.id, newTargetId);
                  setNewTargetId("");
                }}
              >
                <Plus className="h-3 w-3" />
                Link
              </Button>
            </div>
          ) : null}
        </div>

        {/* Output Visibility & Advanced Settings Accordion */}
        <Accordion type="single" collapsible>
          <AccordionItem value="advanced" className="border-b-0">
            <AccordionTrigger className="py-1.5 text-[11px]">Advanced & Output Visibility</AccordionTrigger>
            <AccordionContent className="space-y-2.5 pb-1">
              {node.type !== "checkpoint" ? (
                <div className="space-y-1">
                  <label className="block text-[10px] font-medium text-text-secondary">Output Key</label>
                  <Input
                    value={String(node.outputKey ?? "")}
                    disabled={readOnly}
                    onChange={(e) => updateNode(node.id, { outputKey: e.target.value })}
                    className="h-7 font-mono text-[11px]"
                  />
                </div>
              ) : null}

              <div className="space-y-1.5 rounded-md border border-border-subtle bg-canvas p-2">
                <div className="text-[10px] font-semibold text-text-secondary">Output Visibility</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="block text-[9px] text-text-muted">Preview chars</label>
                    <Input
                      type="number"
                      min={40}
                      max={10000}
                      value={node.outputVisibility?.previewLength ?? 240}
                      disabled={readOnly}
                      onChange={(e) =>
                        updateNode(node.id, {
                          outputVisibility: {
                            ...node.outputVisibility,
                            previewLength: Number(e.target.value) || 240,
                          },
                        })
                      }
                      className="h-6 font-mono text-[10px]"
                    />
                  </div>
                  <div className="flex flex-col justify-end gap-1">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-text-secondary">
                      <input
                        type="checkbox"
                        checked={node.outputVisibility?.includeInFinalOutput ?? true}
                        disabled={readOnly}
                        onChange={(e) =>
                          updateNode(node.id, {
                            outputVisibility: {
                              ...node.outputVisibility,
                              includeInFinalOutput: e.target.checked,
                            },
                          })
                        }
                        className="accent-emerald-500"
                      />
                      <span>Include final</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-text-secondary">
                      <input
                        type="checkbox"
                        checked={Boolean(node.outputVisibility?.redact)}
                        disabled={readOnly}
                        onChange={(e) =>
                          updateNode(node.id, {
                            outputVisibility: {
                              ...node.outputVisibility,
                              redact: e.target.checked,
                            },
                          })
                        }
                        className="accent-emerald-500"
                      />
                      <span>Redact secrets</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-medium text-text-secondary">Queue Lane</label>
                <select
                  value={String(node.queue ?? "")}
                  disabled={readOnly}
                  onChange={(e) => updateNode(node.id, { queue: e.target.value || undefined })}
                  className={selectClass}
                >
                  <option value="">auto (default)</option>
                  {QUEUE_LANES.map((lane) => (
                    <option key={lane} value={lane}>
                      {lane}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-[10px] font-medium text-text-secondary">Retries</label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={node.retryMaxAttempts ?? ""}
                    disabled={readOnly}
                    onChange={(e) =>
                      updateNode(node.id, {
                        retryMaxAttempts: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                    placeholder="0"
                    className="h-7 font-mono text-[11px]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[10px] font-medium text-text-secondary">Timeout (s)</label>
                  <Input
                    type="number"
                    min={1}
                    max={3600}
                    value={node.timeoutSeconds ?? ""}
                    disabled={readOnly}
                    onChange={(e) =>
                      updateNode(node.id, {
                        timeoutSeconds: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                    placeholder="120"
                    className="h-7 font-mono text-[11px]"
                  />
                </div>
              </div>

              {(node.type === "agent" || node.type === "subagent") && (
                <div className="space-y-1">
                  <label className="block text-[10px] font-medium text-text-secondary">System Prompt</label>
                  <Textarea
                    value={String(node.systemPrompt ?? "")}
                    disabled={readOnly}
                    onChange={(e) => updateNode(node.id, { systemPrompt: e.target.value || undefined })}
                    className="min-h-[60px] font-mono text-[11px]"
                  />
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
}

interface AnchoredEdgePopoverProps {
  graph: RawGraph;
  edge: RawGraphEdge;
  readOnly: boolean;
  screenPos: { x: number; y: number };
  bounds: { width: number; height: number };
  onClose: () => void;
}

export function AnchoredEdgePopover({ graph, edge, readOnly, screenPos, bounds, onClose }: AnchoredEdgePopoverProps) {
  const updateEdge = useWorkflowStore((s) => s.updateEdge);
  const removeEdges = useWorkflowStore((s) => s.removeEdges);
  const [mapTarget, setMapTarget] = useState("");
  const [mapSource, setMapSource] = useState("");

  const sourceNode = graph.nodes.find((n) => n.id === edge.source);
  const targetNode = graph.nodes.find((n) => n.id === edge.target);
  const compat =
    sourceNode && targetNode
      ? checkNodeCompatibility(sourceNode, targetNode, edge, Boolean(graph.policy?.strictCompatibility))
      : "compatible";

  const branchOptions =
    sourceNode?.type === "decision" && Array.isArray(sourceNode.branches)
      ? (sourceNode.branches as string[])
      : sourceNode?.type === "checkpoint"
        ? ["approve", "reject"]
        : null;

  const activeStages = edge.middleware?.stages ?? MIDDLEWARE_STAGES;
  const fieldMapping = edge.middleware?.fieldMapping ?? {};

  const toggleStage = (stage: EdgeMiddlewareStage) => {
    const next = activeStages.includes(stage)
      ? activeStages.filter((s) => s !== stage)
      : MIDDLEWARE_STAGES.filter((s) => s === stage || activeStages.includes(s));
    updateEdge(edge.id, { middleware: { ...edge.middleware, stages: next } });
  };

  const cardW = 304;
  const left = Math.max(12, Math.min(bounds.width - cardW - 12, screenPos.x - cardW / 2));
  const top = Math.max(12, Math.min(bounds.height - 320, screenPos.y + 14));

  return (
    <div
      style={{ left, top, width: cardW }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="absolute z-30 space-y-2.5 rounded-xl border border-border-strong bg-surface/98 p-3 shadow-[0_12px_36px_rgba(0,0,0,0.6)] backdrop-blur-md"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-text-primary">Edge Middleware</span>
            <Badge
              variant={compat === "compatible" ? "accent" : compat === "cast" ? "warning" : "error"}
              className="text-[9px]"
            >
              {compat}
            </Badge>
          </div>
          <div className="truncate font-mono text-[10px] text-text-muted">
            {edge.source} → {edge.target}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!readOnly ? (
            <button
              type="button"
              onClick={() => {
                removeEdges([edge.id]);
                onClose();
              }}
              title="Delete link"
              className="rounded p-1 text-text-muted hover:bg-elevated hover:text-error"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-elevated hover:text-text-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Branch selector for decision/checkpoint or condition input */}
      <div className="space-y-1">
        <label className="block text-[10px] font-medium text-text-secondary">Branch Condition</label>
        {branchOptions ? (
          <select
            value={edge.condition ?? ""}
            disabled={readOnly}
            onChange={(e) => updateEdge(edge.id, { condition: e.target.value || undefined })}
            className={selectClass}
          >
            <option value="">(default / any)</option>
            {branchOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        ) : (
          <Input
            value={edge.condition ?? ""}
            disabled={readOnly}
            onChange={(e) => updateEdge(edge.id, { condition: e.target.value || undefined })}
            placeholder="Branch name (optional)"
            className="h-7 font-mono text-[11px]"
          />
        )}
      </div>

      {/* Pipeline stages */}
      <div className="space-y-1">
        <label className="block text-[10px] font-medium text-text-secondary">Pipeline</label>
        <div className="flex flex-wrap gap-1">
          {MIDDLEWARE_STAGES.map((stage) => {
            const enabled = activeStages.includes(stage);
            return (
              <button
                key={stage}
                type="button"
                disabled={readOnly}
                onClick={() => toggleStage(stage)}
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[9px] transition-colors",
                  enabled
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-border-subtle bg-canvas text-text-muted",
                )}
              >
                {stage}
              </button>
            );
          })}
        </div>
      </div>

      {/* Field Mapping */}
      <div className="space-y-1.5 border-t border-border-subtle pt-2">
        <label className="block text-[10px] font-medium text-text-secondary">Field Mapping</label>
        {Object.keys(fieldMapping).length === 0 ? (
          <div className="font-mono text-[10px] text-text-muted">
            Default passthrough ({String(sourceNode?.outputKey ?? "output")})
          </div>
        ) : (
          <div className="space-y-1">
            {Object.entries(fieldMapping).map(([tgt, src]) => (
              <div
                key={tgt}
                className="flex items-center justify-between rounded border border-border-subtle bg-canvas px-2 py-0.5 font-mono text-[10px]"
              >
                <span>
                  {tgt} ← {src}
                </span>
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...fieldMapping };
                      delete next[tgt];
                      updateEdge(edge.id, { middleware: { ...edge.middleware, fieldMapping: next } });
                    }}
                    className="text-text-muted hover:text-error"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {!readOnly ? (
          <div className="flex items-center gap-1">
            <Input
              value={mapTarget}
              onChange={(e) => setMapTarget(e.target.value)}
              placeholder="targetKey"
              className="h-6 font-mono text-[10px]"
            />
            <span className="text-[10px] text-text-muted">←</span>
            <Input
              value={mapSource}
              onChange={(e) => setMapSource(e.target.value)}
              placeholder="sourceKey"
              className="h-6 font-mono text-[10px]"
            />
            <Button
              variant="secondary"
              size="xs"
              disabled={!mapTarget.trim() || !mapSource.trim()}
              onClick={() => {
                updateEdge(edge.id, {
                  middleware: {
                    ...edge.middleware,
                    fieldMapping: { ...fieldMapping, [mapTarget.trim()]: mapSource.trim() },
                  },
                });
                setMapTarget("");
                setMapSource("");
              }}
            >
              Map
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface AnchoredNodePickerProps {
  screenPos: { x: number; y: number };
  bounds: { width: number; height: number };
  onPick: (kind: NodeKind) => void;
  onClose: () => void;
}

export function AnchoredNodePicker({ screenPos, bounds, onPick, onClose }: AnchoredNodePickerProps) {
  const cardW = 228;
  const cardH = 316;
  const left = Math.max(12, Math.min(bounds.width - cardW - 12, screenPos.x + 18));
  const top = Math.max(12, Math.min(bounds.height - cardH - 12, screenPos.y - 40));

  return (
    <div
      style={{ left, top, width: cardW }}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-30 rounded-xl border border-border-strong bg-surface/98 p-1.5 shadow-[0_14px_40px_rgba(0,0,0,0.65)] backdrop-blur-md"
    >
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Primary</span>
        <button type="button" onClick={onClose} className="rounded p-0.5 text-text-muted hover:text-text-primary">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="space-y-0.5">
        {PRIMARY_NODE_KINDS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.kind}
              type="button"
              onClick={() => onPick(item.kind)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-elevated"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: NODE_META[item.kind].color }} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-text-primary">{item.label}</div>
                <div className="truncate text-[9px] text-text-muted">{NODE_META[item.kind].hint}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-1 border-t border-border-subtle px-2 pt-1.5 pb-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Secondary</span>
      </div>
      <div className="space-y-0.5">
        {SECONDARY_NODE_KINDS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.kind}
              type="button"
              onClick={() => onPick(item.kind)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-elevated"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: NODE_META[item.kind].color }} />
              <span className="text-[11px] font-medium text-text-secondary">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
