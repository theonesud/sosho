"use client";

import { Trash2 } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { normalizeSkills } from "@/lib/utils";
import { useWorkflowStore } from "@/stores/workflow-store";
import { MODEL_TIERS, NODE_META, QUEUE_LANES, type RawGraph, type SkillInfo } from "@/types";

interface NodeInspectorProps {
  graph: RawGraph | null;
  readOnly?: boolean;
  availableSkills?: Array<string | SkillInfo>;
}

const selectClass =
  "flex h-8 w-full rounded-md border border-border-subtle bg-canvas px-2 text-[12px] text-text-primary transition-colors duration-150 hover:border-border-strong focus-visible:border-accent focus-visible:outline-none disabled:opacity-50";

export function NodeInspector({ graph, readOnly = false, availableSkills = [] }: NodeInspectorProps) {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const selectedEdgeId = useWorkflowStore((s) => s.selectedEdgeId);
  const updateNode = useWorkflowStore((s) => s.updateNode);
  const updateGraphMeta = useWorkflowStore((s) => s.updateGraphMeta);
  const removeNodes = useWorkflowStore((s) => s.removeNodes);
  const updateEdge = useWorkflowStore((s) => s.updateEdge);
  const removeEdges = useWorkflowStore((s) => s.removeEdges);

  if (!graph) {
    return <div className="p-4 text-[12px] text-text-muted">Select a workflow to inspect its nodes and edges.</div>;
  }

  const selectedEdge = selectedEdgeId ? graph.edges.find((e) => e.id === selectedEdgeId) : null;
  if (selectedEdge) {
    return (
      <div className="space-y-4 p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold text-text-primary">Edge Connection</div>
            <div className="font-mono text-[11px] text-text-muted">
              {selectedEdge.source} → {selectedEdge.target}
            </div>
          </div>
          {!readOnly ? (
            <Button variant="danger" size="icon" onClick={() => removeEdges([selectedEdge.id])} title="Delete edge">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <label className="block text-[11px] font-medium text-text-secondary">Branch Condition</label>
          <Input
            value={selectedEdge.condition ?? ""}
            disabled={readOnly}
            onChange={(e) => updateEdge(selectedEdge.id, { condition: e.target.value || undefined })}
            placeholder="Leave empty for unconditional edge"
            className="font-mono"
          />
          <p className="text-[11px] text-text-muted">
            Match a branch name returned by a Decision node (for example <code className="font-mono">yes</code> or{" "}
            <code className="font-mono">fallback</code>).
          </p>
        </div>
      </div>
    );
  }

  const node = selectedNodeId ? graph.nodes.find((n) => n.id === selectedNodeId) : null;
  if (!node) {
    return (
      <div className="space-y-3 p-3">
        <div className="text-[13px] font-semibold text-text-primary">Graph Settings</div>
        <div className="space-y-1.5">
          <label className="block text-[11px] font-medium text-text-secondary">Name</label>
          <Input value={graph.name} disabled={readOnly} onChange={(e) => updateGraphMeta({ name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-[11px] font-medium text-text-secondary">Entry Node</label>
          <select
            value={graph.entryNode}
            disabled={readOnly}
            onChange={(e) => updateGraphMeta({ entryNode: e.target.value })}
            className={selectClass}
          >
            {graph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label} ({n.id})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-[11px] font-medium text-text-secondary">Max Steps</label>
          <Input
            type="number"
            min={1}
            max={200}
            value={graph.maxSteps}
            disabled={readOnly}
            onChange={(e) => updateGraphMeta({ maxSteps: Math.max(1, Number(e.target.value) || 1) })}
            className="font-mono"
          />
        </div>
        <p className="pt-1 text-[11px] text-text-muted">Click any node or edge on the canvas to edit its fields.</p>
      </div>
    );
  }

  const meta = NODE_META[node.type];
  const isEntry = graph.entryNode === node.id;

  return (
    <div className="space-y-3 p-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Badge variant="neutral" className="font-mono" style={{ color: meta.color }}>
              {meta.badge}
            </Badge>
            <span className="truncate font-mono text-[11px] text-text-muted">{node.id}</span>
          </div>
          <div className="mt-1 truncate text-[13px] font-semibold text-text-primary">{node.label}</div>
        </div>

        {!readOnly ? (
          <div className="flex items-center gap-1 shrink-0">
            {!isEntry ? (
              <Button variant="ghost" size="xs" onClick={() => updateGraphMeta({ entryNode: node.id })}>
                Set Entry
              </Button>
            ) : null}
            <Button variant="danger" size="icon" onClick={() => removeNodes([node.id])} title="Delete node">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}
      </div>

      {/* Primary 3 fields per node */}
      <div className="space-y-2.5">
        <div className="space-y-1">
          <label className="block text-[11px] font-medium text-text-secondary">Label</label>
          <Input
            value={node.label}
            disabled={readOnly}
            onChange={(e) => updateNode(node.id, { label: e.target.value })}
          />
        </div>

        {(node.type === "agent" || node.type === "subagent" || node.type === "decision") && (
          <>
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-text-secondary">Model Tier</label>
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
              <label className="block text-[11px] font-medium text-text-secondary">Prompt Template</label>
              <Textarea
                value={String(node.promptTemplate ?? "")}
                disabled={readOnly}
                onChange={(e) => updateNode(node.id, { promptTemplate: e.target.value })}
                className="min-h-[96px] font-mono text-[11px]"
                placeholder="Use {{variable}} placeholders..."
              />
            </div>
          </>
        )}

        {node.type === "tool" && (
          <>
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-text-secondary">Tool Kind</label>
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
              <label className="block text-[11px] font-medium text-text-secondary">Command or URL</label>
              <Input
                value={String(node.commandOrUrl ?? "")}
                disabled={readOnly}
                onChange={(e) => updateNode(node.id, { commandOrUrl: e.target.value })}
                className="font-mono"
              />
            </div>
          </>
        )}

        {node.type === "skill" && (
          <>
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-text-secondary">Skill Name</label>
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
                  className="font-mono"
                />
              )}
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-text-secondary">Prompt Template</label>
              <Textarea
                value={String(node.promptTemplate ?? "")}
                disabled={readOnly}
                onChange={(e) => updateNode(node.id, { promptTemplate: e.target.value })}
                className="min-h-[88px] font-mono text-[11px]"
              />
            </div>
          </>
        )}

        {node.type === "memory" && (
          <>
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-text-secondary">Operation</label>
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
              <label className="block text-[11px] font-medium text-text-secondary">Query or Title Template</label>
              <Input
                value={String(node.queryOrTitleTemplate ?? "")}
                disabled={readOnly}
                onChange={(e) => updateNode(node.id, { queryOrTitleTemplate: e.target.value })}
                className="font-mono"
              />
            </div>
          </>
        )}

        {node.type === "checkpoint" && (
          <>
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-text-secondary">Reviewer Message</label>
              <Textarea
                value={String(node.message ?? "")}
                disabled={readOnly}
                onChange={(e) => updateNode(node.id, { message: e.target.value })}
                className="min-h-[76px]"
              />
            </div>
            <label className="flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer">
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
      </div>

      {/* Progressive disclosure: Advanced Accordion */}
      <Accordion type="single" collapsible className="pt-1">
        <AccordionItem value="advanced">
          <AccordionTrigger>Advanced Engine Settings</AccordionTrigger>
          <AccordionContent>
            {node.type !== "checkpoint" ? (
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-text-secondary">Output Key</label>
                <Input
                  value={String(node.outputKey ?? "")}
                  disabled={readOnly}
                  onChange={(e) => updateNode(node.id, { outputKey: e.target.value })}
                  className="font-mono"
                />
              </div>
            ) : null}

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-text-secondary">Queue Lane</label>
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
                <label className="block text-[11px] font-medium text-text-secondary">Retry Attempts</label>
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
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-text-secondary">Timeout (s)</label>
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
                  className="font-mono"
                />
              </div>
            </div>

            {(node.type === "agent" || node.type === "subagent") && (
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-text-secondary">System Prompt</label>
                <Textarea
                  value={String(node.systemPrompt ?? "")}
                  disabled={readOnly}
                  onChange={(e) => updateNode(node.id, { systemPrompt: e.target.value || undefined })}
                  className="min-h-[68px] font-mono text-[11px]"
                />
              </div>
            )}

            {node.type === "tool" && (
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-text-secondary">HTTP Method</label>
                <select
                  value={String(node.method ?? "GET")}
                  disabled={readOnly}
                  onChange={(e) => updateNode(node.id, { method: e.target.value })}
                  className={selectClass}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </div>
            )}

            {node.type === "memory" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-text-secondary">Scope</label>
                  <select
                    value={String(node.scope ?? "both")}
                    disabled={readOnly}
                    onChange={(e) => updateNode(node.id, { scope: e.target.value })}
                    className={selectClass}
                  >
                    <option value="both">both</option>
                    <option value="project">project</option>
                    <option value="global">global</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-text-secondary">Memory Type</label>
                  <select
                    value={String(node.memoryType ?? "semantic")}
                    disabled={readOnly}
                    onChange={(e) => updateNode(node.id, { memoryType: e.target.value })}
                    className={selectClass}
                  >
                    <option value="semantic">semantic</option>
                    <option value="procedural">procedural</option>
                    <option value="episodic">episodic</option>
                    <option value="entity">entity</option>
                  </select>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-text-secondary">Graph Max Steps</label>
              <Input
                type="number"
                min={1}
                max={200}
                value={graph.maxSteps}
                disabled={readOnly}
                onChange={(e) => updateGraphMeta({ maxSteps: Math.max(1, Number(e.target.value) || 1) })}
                className="font-mono"
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
