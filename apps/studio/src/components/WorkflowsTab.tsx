import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type Node,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiJson, authHeaders } from "../api";
import {
  extractTemplateVariables,
  MODEL_TIERS,
  NODE_META,
  type NodeKind,
  type RawGraph,
  type RawGraphNode,
  type RunDetail,
  type RunSummary,
  WORKFLOW_TEMPLATES,
  type WorkflowSummary,
} from "../types";
import { WorkflowNode, type WorkflowNodeData } from "./WorkflowNode";

const NODE_TYPES = { workflow: WorkflowNode };

interface WorkflowsTabProps {
  workflows: WorkflowSummary[];
  skills: string[];
  runs: RunSummary[];
  activeRunId: string | null;
  onSelectRunId: (runId: string | null) => void;
  onRefreshWorkflows: () => Promise<WorkflowSummary[]>;
  onRefreshRuns: () => Promise<void>;
  onStatus: (msg: string) => void;
}

function makeEdge(e: { id: string; source: string; target: string; condition?: string }): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.condition || "",
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#52525b", width: 16, height: 16 },
    style: { stroke: "#52525b", strokeWidth: 1.75 },
    labelStyle: { fill: "#e4e4e7", fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: "#18181b", stroke: "#3f3f46", strokeWidth: 1 },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 5,
  };
}

export function WorkflowsTab({
  workflows,
  skills,
  runs,
  activeRunId,
  onSelectRunId,
  onRefreshWorkflows,
  onRefreshRuns,
  onStatus,
}: WorkflowsTabProps) {
  const [graphMeta, setGraphMeta] = useState<Omit<RawGraph, "nodes" | "edges"> | null>(null);
  const [rawNodes, setRawNodes] = useState<RawGraphNode[]>([]);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"output" | "inspector">("output");

  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [liveNodeStatus, setLiveNodeStatus] = useState<Record<string, { status: string; preview?: string }>>({});
  const [inputMode, setInputMode] = useState<"form" | "json">("form");
  const [formInputs, setFormInputs] = useState<Record<string, string>>({ topic: "Local GPU inference optimization" });
  const [rawInputJson, setRawInputJson] = useState('{"topic": "Local GPU inference optimization"}');
  const [checkpointPatchJson, setCheckpointPatchJson] = useState("{}");
  const [showPatchBox, setShowPatchBox] = useState(false);

  const activeRunIdRef = useRef<string | null>(activeRunId);
  activeRunIdRef.current = activeRunId;

  const hydrateGraph = useCallback(
    (g: RawGraph) => {
      setGraphMeta({
        id: g.id,
        name: g.name,
        description: g.description,
        version: g.version || 1,
        entryNode: g.entryNode,
        maxSteps: g.maxSteps || 50,
      });
      setRawNodes(g.nodes);
      setRfNodes(
        g.nodes.map((n, idx) => ({
          id: n.id,
          type: "workflow",
          position: n.position || { x: 60 + idx * 280, y: 140 },
          data: {
            nodeType: n.type,
            title: n.label || n.id,
            tier: typeof n.tier === "string" ? n.tier : undefined,
            subtitle:
              n.type === "memory"
                ? `${String(n.operation || "search")} (${String(n.scope || "both")})`
                : n.type === "skill"
                  ? String(n.skillName || "")
                  : n.type === "tool"
                    ? String(n.toolKind || "shell")
                    : undefined,
            isEntry: g.entryNode === n.id,
          } satisfies WorkflowNodeData,
        })),
      );
      setEdges(g.edges.map(makeEdge));
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    },
    [setEdges, setRfNodes],
  );

  const loadWorkflowById = useCallback(
    async (id: string) => {
      const res = await apiJson<RawGraph>(`/api/workflows/${encodeURIComponent(id)}`);
      if (!res.ok) return;
      hydrateGraph(res.data);
    },
    [hydrateGraph],
  );

  const fetchRunDetail = useCallback(async (runId: string) => {
    const res = await apiJson<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`);
    if (!res.ok) return;
    setRunDetail(res.data);
    const map: Record<string, { status: string; preview?: string }> = {};
    for (const h of res.data.history || []) {
      map[h.nodeId] = { status: h.status, preview: h.outputPreview };
    }
    setLiveNodeStatus(map);
  }, []);

  // Load initial workflow once workflows list arrives
  useEffect(() => {
    if (!graphMeta && workflows.length > 0) {
      loadWorkflowById(workflows[0].id);
    }
  }, [graphMeta, loadWorkflowById, workflows]);

  // Fetch full run details whenever activeRunId changes
  useEffect(() => {
    if (activeRunId) {
      fetchRunDetail(activeRunId);
      setRightTab("output");
    } else {
      setRunDetail(null);
      setLiveNodeStatus({});
    }
  }, [activeRunId, fetchRunDetail]);

  // Stable SSE listener (never reconnects on checkpoint state changes)
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as {
          type?: string;
          runId?: string;
          nodeId?: string;
          status?: string;
          preview?: string;
        };
        if (
          msg.type === "run_started" ||
          msg.type === "run_completed" ||
          msg.type === "run_failed" ||
          msg.type === "run_cancelled" ||
          msg.type === "checkpoint_waiting"
        ) {
          onRefreshRuns();
        }
        const cur = activeRunIdRef.current;
        if (!cur || (msg.runId && msg.runId !== cur)) return;
        if (msg.nodeId && msg.status) {
          setLiveNodeStatus((prev) => ({
            ...prev,
            [msg.nodeId!]: { status: msg.status!, preview: msg.preview },
          }));
        }
        if (
          msg.type === "node_done" ||
          msg.type === "node_failed" ||
          msg.type === "checkpoint_waiting" ||
          msg.type === "run_completed" ||
          msg.type === "run_failed" ||
          msg.type === "run_cancelled"
        ) {
          fetchRunDetail(cur);
        }
      } catch {
        // ignore malformed SSE
      }
    };
    return () => es.close();
  }, [fetchRunDetail, onRefreshRuns]);

  // Sync rawNodes + liveNodeStatus into rendered React Flow node data
  const renderedNodes = useMemo(() => {
    const rawMap = new Map(rawNodes.map((n) => [n.id, n]));
    return rfNodes.map((n) => {
      const raw = rawMap.get(n.id);
      const st = liveNodeStatus[n.id];
      return {
        ...n,
        data: {
          ...(n.data as WorkflowNodeData),
          nodeType: raw?.type || (n.data as WorkflowNodeData).nodeType || "agent",
          title: raw?.label || n.id,
          tier: typeof raw?.tier === "string" ? raw.tier : undefined,
          isEntry: graphMeta?.entryNode === n.id,
          runStatus: st?.status,
          preview: st?.preview,
        } satisfies WorkflowNodeData,
      };
    });
  }, [graphMeta?.entryNode, liveNodeStatus, rawNodes, rfNodes]);

  const currentGraph: RawGraph | null = useMemo(() => {
    if (!graphMeta) return null;
    const posMap = new Map(rfNodes.map((n) => [n.id, n.position]));
    return {
      ...graphMeta,
      nodes: rawNodes.map((n) => ({ ...n, position: posMap.get(n.id) || n.position })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        condition: typeof e.label === "string" && e.label.trim() ? e.label.trim() : undefined,
      })),
    };
  }, [edges, graphMeta, rawNodes, rfNodes]);

  const templateVars = useMemo(() => extractTemplateVariables(currentGraph), [currentGraph]);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          makeEdge({
            id: `e-${Date.now().toString(36)}`,
            source: params.source || "",
            target: params.target || "",
          }),
          eds,
        ),
      );
    },
    [setEdges],
  );

  const handleSave = async () => {
    if (!currentGraph) return;
    const res = await apiJson<{ id?: string }>("/api/workflows", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(currentGraph),
    });
    if (res.ok) {
      onStatus(`Saved workflow "${currentGraph.name}".`);
      onRefreshWorkflows();
    } else {
      onStatus(`Save failed (${res.status}): ${res.data.error || "Validation error"}`);
    }
  };

  const handleDeleteWorkflow = async () => {
    if (!graphMeta) return;
    const res = await apiJson(`/api/workflows/${encodeURIComponent(graphMeta.id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.ok) {
      onStatus(`Deleted workflow ${graphMeta.id}`);
      const list = await onRefreshWorkflows();
      if (list.length > 0) loadWorkflowById(list[0].id);
      else {
        setGraphMeta(null);
        setRawNodes([]);
        setRfNodes([]);
        setEdges([]);
      }
    } else {
      onStatus(`Delete failed (${res.status}): ${res.data.error || "Check API token"}`);
    }
  };

  const handleNewWorkflow = () => {
    const id = `wf-${Date.now().toString(36)}`;
    hydrateGraph({
      id,
      name: `New Workflow (${id})`,
      description: "",
      version: 1,
      entryNode: "start_agent",
      maxSteps: 30,
      nodes: [
        {
          id: "start_agent",
          type: "agent",
          label: "Start Agent",
          tier: "main",
          position: { x: 120, y: 150 },
          promptTemplate: "Analyze {{topic}} and provide clear takeaways.",
          outputKey: "result",
        },
      ],
      edges: [],
    });
    setSelectedNodeId("start_agent");
    setRightTab("inspector");
    onStatus(`Created draft workflow ${id}. Click Save to persist.`);
  };

  const handleRun = async () => {
    if (!currentGraph) return;
    let initialData: Record<string, unknown> = {};
    if (inputMode === "json") {
      try {
        initialData = JSON.parse(rawInputJson);
      } catch {
        onStatus("Invalid Run Input JSON.");
        return;
      }
    } else {
      for (const v of templateVars) {
        initialData[v] = formInputs[v] ?? "";
      }
    }

    setLiveNodeStatus({});
    const res = await apiJson<{ runId?: string }>("/api/runs", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ graph: currentGraph, initialData }),
    });
    if (res.ok && res.data.runId) {
      onSelectRunId(res.data.runId);
      setRightTab("output");
      onStatus(`Started run ${res.data.runId}`);
      onRefreshRuns();
    } else {
      onStatus(`Run failed (${res.status}): ${res.data.error || "Check Studio API"}`);
    }
  };

  const handleCancelRun = async (runId: string) => {
    const res = await apiJson(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (res.ok) {
      onStatus(`Cancelled run ${runId}`);
      onRefreshRuns();
      if (activeRunId === runId) fetchRunDetail(runId);
    }
  };

  const handleCheckpoint = async (action: "approve" | "reject") => {
    if (!activeRunId || !runDetail?.pausedCheckpoint) return;
    let statePatch: Record<string, unknown> | undefined;
    if (showPatchBox && checkpointPatchJson.trim()) {
      try {
        const parsed = JSON.parse(checkpointPatchJson);
        if (Object.keys(parsed).length > 0) statePatch = parsed;
      } catch {
        onStatus("Invalid state patch JSON.");
        return;
      }
    }
    const res = await apiJson(`/api/runs/${encodeURIComponent(activeRunId)}/checkpoint`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        nodeId: runDetail.pausedCheckpoint.nodeId,
        action,
        statePatch,
      }),
    });
    if (res.ok) {
      onStatus(`Sent ${action} to ${runDetail.pausedCheckpoint.nodeId}`);
      setShowPatchBox(false);
      fetchRunDetail(activeRunId);
      onRefreshRuns();
    } else {
      onStatus(`Checkpoint error (${res.status}): ${res.data.error || "Failed"}`);
    }
  };

  const addNode = (type: NodeKind) => {
    const id = `${type}_${Date.now().toString(36).slice(-4)}`;
    const defaults: Record<NodeKind, Record<string, unknown>> = {
      agent: { tier: "main", promptTemplate: "Analyze {{topic}}", outputKey: "agent_out" },
      subagent: { role: "Researcher", tier: "subagent", promptTemplate: "Research {{topic}}", skills: [], outputKey: "sub_out" },
      decision: { tier: "decision", promptTemplate: "Choose a branch for {{topic}}", branches: ["quick", "deep"], outputKey: "route" },
      tool: { toolKind: "shell", commandOrUrl: "echo hello", outputKey: "tool_out" },
      skill: { skillName: skills[0] || "github-scout", tier: "subagent", promptTemplate: "Run skill for {{topic}}", outputKey: "skill_out" },
      checkpoint: { message: "Review output before continuing.", allowStateEdit: true },
      memory: { operation: "search", scope: "both", queryOrTitleTemplate: "{{topic}}", outputKey: "mem_out" },
    };
    const pos = { x: 180 + Math.round(Math.random() * 240), y: 100 + Math.round(Math.random() * 180) };
    const newRaw: RawGraphNode = { id, type, label: `New ${type}`, position: pos, ...defaults[type] };
    setRawNodes((prev) => [...prev, newRaw]);
    setRfNodes((prev) => [
      ...prev,
      {
        id,
        type: "workflow",
        position: pos,
        data: { nodeType: type, title: newRaw.label, tier: typeof newRaw.tier === "string" ? newRaw.tier : undefined } satisfies WorkflowNodeData,
      },
    ]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setRightTab("inspector");
  };

  const updateSelectedNode = (key: string, value: unknown) => {
    if (!selectedNodeId) return;
    setRawNodes((prev) => prev.map((n) => (n.id === selectedNodeId ? { ...n, [key]: value } : n)));
  };

  const deleteSelectedNode = () => {
    if (!selectedNodeId) return;
    setRawNodes((prev) => prev.filter((n) => n.id !== selectedNodeId));
    setRfNodes((prev) => prev.filter((n) => n.id !== selectedNodeId));
    setEdges((prev) => prev.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
  };

  const selectedRawNode = rawNodes.find((n) => n.id === selectedNodeId) || null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) || null;
  const selectedEdgeSource = selectedEdge ? rawNodes.find((n) => n.id === selectedEdge.source) || null : null;

  const validEdgeConditions: string[] = useMemo(() => {
    if (!selectedEdgeSource) return [];
    if (selectedEdgeSource.type === "checkpoint") return ["approve", "reject"];
    if (selectedEdgeSource.type === "decision" && Array.isArray(selectedEdgeSource.branches)) {
      return selectedEdgeSource.branches as string[];
    }
    return [];
  }, [selectedEdgeSource]);

  // Identify primary output content to display prominently inside Checkpoint Review Card
  const checkpointReviewText = useMemo(() => {
    if (!runDetail?.data) return "";
    if (typeof runDetail.data.draft_brief === "string") return runDetail.data.draft_brief;
    const stringEntries = Object.entries(runDetail.data).filter(
      ([k, v]) => k !== "topic" && typeof v === "string" && v.trim().length > 0,
    );
    if (stringEntries.length === 0) return JSON.stringify(runDetail.data, null, 2);
    const [lastKey, lastVal] = stringEntries[stringEntries.length - 1];
    return `## ${lastKey}\n\n${String(lastVal)}`;
  }, [runDetail]);

  const rawNodeMap = useMemo(() => new Map(rawNodes.map((n) => [n.id, n])), [rawNodes]);

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* LEFT RAIL: Workflow Picker, Run Form, Recent Runs */}
      <aside
        style={{
          width: 268,
          flexShrink: 0,
          background: "var(--bg-surface)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          padding: 12,
          gap: 14,
        }}
      >
        {/* Workflow Selection */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="section-title">Workflow</div>
          <select
            className="select"
            value={graphMeta?.id || ""}
            onChange={(e) => {
              const val = e.target.value;
              if (val.startsWith("tpl:")) {
                const tpl = WORKFLOW_TEMPLATES[val.slice(4)];
                if (tpl) {
                  hydrateGraph(tpl);
                  onStatus(`Loaded template "${tpl.name}". Click Save to persist.`);
                }
              } else {
                loadWorkflowById(val);
              }
            }}
          >
            <optgroup label="Saved Workflows">
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </optgroup>
            <optgroup label="Templates">
              {Object.entries(WORKFLOW_TEMPLATES).map(([k, t]) => (
                <option key={k} value={`tpl:${k}`}>+ Template: {t.name}</option>
              ))}
            </optgroup>
          </select>

          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-sm" style={{ flex: 1 }} onClick={handleNewWorkflow}>+ New</button>
            <button className="btn btn-sm" style={{ flex: 1 }} onClick={handleSave}>Save</button>
            <button className="btn btn-danger btn-sm" onClick={handleDeleteWorkflow}>Delete</button>
          </div>

          {graphMeta && (
            <label className="field-label">
              Start Node (entryNode)
              <select
                className="select"
                value={graphMeta.entryNode}
                onChange={(e) => setGraphMeta({ ...graphMeta, entryNode: e.target.value })}
              >
                {rawNodes.map((n) => (
                  <option key={n.id} value={n.id}>{n.label} ({n.id})</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: 0 }} />

        {/* Run Input Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="section-title">Run Inputs</span>
            <button
              className="btn btn-sm"
              style={{ padding: "2px 6px", fontSize: 10.5 }}
              onClick={() => setInputMode((m) => (m === "form" ? "json" : "form"))}
            >
              {inputMode === "form" ? "JSON" : "Form"}
            </button>
          </div>

          {inputMode === "form" ? (
            templateVars.length > 0 ? (
              templateVars.map((v) => (
                <label key={v} className="field-label">
                  {v}
                  <input
                    className="input"
                    value={formInputs[v] ?? ""}
                    onChange={(e) => setFormInputs((prev) => ({ ...prev, [v]: e.target.value }))}
                    placeholder={`Enter ${v}...`}
                  />
                </label>
              ))
            ) : (
              <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>No input variables required.</div>
            )
          ) : (
            <textarea
              className="textarea"
              rows={4}
              value={rawInputJson}
              onChange={(e) => setRawInputJson(e.target.value)}
            />
          )}

          <button className="btn btn-emerald" style={{ width: "100%", padding: "8px 12px" }} onClick={handleRun}>
            ▶ Run Workflow
          </button>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: 0 }} />

        {/* Recent Runs */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
          <div className="section-title">Recent Runs ({runs.length})</div>
          {runs.length === 0 ? (
            <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              Click <strong>Run Workflow</strong> above to execute and inspect step outputs.
            </div>
          ) : (
            runs.map((r) => {
              const isSelected = activeRunId === r.runId;
              return (
                <div
                  key={r.runId}
                  onClick={() => onSelectRunId(r.runId)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: isSelected ? "var(--bg-elevated)" : "var(--bg-canvas)",
                    border: `1px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.runId.replace(/^sosho-/, "")}
                    </span>
                    <span
                      className={`pill ${
                        r.status === "completed"
                          ? "pill-ok"
                          : r.status === "waiting_checkpoint"
                            ? "pill-warn"
                            : r.status === "failed"
                              ? "pill-err"
                              : "pill-info"
                      }`}
                      style={{ fontSize: 10, padding: "1px 6px" }}
                    >
                      {r.status === "waiting_checkpoint" ? "review" : r.status}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                    <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>steps: {r.stepCount}</span>
                    {(r.status === "running" || r.status === "waiting_checkpoint") && (
                      <button
                        className="btn btn-danger btn-sm"
                        style={{ padding: "1px 6px", fontSize: 10 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelRun(r.runId);
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* CENTER CANVAS */}
      <div style={{ flex: 1, minWidth: 0, height: "100%", position: "relative" }}>
        <ReactFlow
          nodes={renderedNodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_e, node) => {
            setSelectedNodeId(node.id);
            setSelectedEdgeId(null);
            setRightTab("inspector");
          }}
          onEdgeClick={(_e, edge) => {
            setSelectedEdgeId(edge.id);
            setSelectedNodeId(null);
            setRightTab("inspector");
          }}
          fitView
          fitViewOptions={{ padding: 0.28 }}
        >
          <Background color="#27272a" gap={22} size={1} />
          <Controls />
          <MiniMap nodeColor="#3f3f46" maskColor="rgba(9, 9, 11, 0.72)" />
        </ReactFlow>

        {/* Floating Bottom Add-Node Dock */}
        <div
          style={{
            position: "absolute",
            bottom: 14,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 10,
            background: "rgba(17, 17, 20, 0.92)",
            border: "1px solid var(--border)",
            boxShadow: "0 8px 28px rgba(0,0,0,0.6)",
            backdropFilter: "blur(8px)",
            zIndex: 10,
          }}
        >
          <span style={{ fontSize: 10.5, color: "var(--text-muted)", fontWeight: 600, marginRight: 2 }}>ADD:</span>
          {(Object.keys(NODE_META) as NodeKind[]).map((k) => (
            <button
              key={k}
              title={NODE_META[k].hint}
              className="btn btn-sm"
              style={{ borderColor: `${NODE_META[k].color}55` }}
              onClick={() => addNode(k)}
            >
              <span className="dot" style={{ background: NODE_META[k].color, width: 6, height: 6 }} />
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT DRAWER: Tabbed Run Output & Node/Edge Inspector */}
      <aside
        style={{
          width: 400,
          flexShrink: 0,
          background: "var(--bg-surface)",
          borderLeft: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "8px 12px", gap: 6 }}>
          <button
            className={`nav-tab ${rightTab === "output" ? "active" : ""}`}
            style={{ flex: 1 }}
            onClick={() => setRightTab("output")}
          >
            Run Output {runDetail?.pausedCheckpoint ? "●" : ""}
          </button>
          <button
            className={`nav-tab ${rightTab === "inspector" ? "active" : ""}`}
            style={{ flex: 1 }}
            onClick={() => setRightTab("inspector")}
          >
            Inspector
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
          {rightTab === "output" ? (
            !runDetail ? (
              <div style={{ color: "var(--text-muted)", fontSize: 12.5, lineHeight: 1.6, padding: "20px 6px" }}>
                <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>No active run selected</div>
                Click <strong>▶ Run Workflow</strong> on the left or pick a past run from <strong>Recent Runs</strong> to see full step outputs, branch decisions, and checkpoint approvals here.
              </div>
            ) : (
              <>
                {/* Run Summary Header */}
                <div className="card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, wordBreak: "break-all" }}>{runDetail.runId}</span>
                    <span
                      className={`pill ${
                        runDetail.status === "completed"
                          ? "pill-ok"
                          : runDetail.status === "waiting_checkpoint"
                            ? "pill-warn"
                            : runDetail.status === "failed"
                              ? "pill-err"
                              : "pill-info"
                      }`}
                    >
                      {runDetail.status === "waiting_checkpoint" ? "Waiting Approval" : runDetail.status}
                    </span>
                  </div>
                  {runDetail.error && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#fca5a5" }}>Error: {runDetail.error}</div>
                  )}
                </div>

                {/* Rich HITL Checkpoint Review Card */}
                {runDetail.status === "waiting_checkpoint" && runDetail.pausedCheckpoint && (
                  <div
                    className="card"
                    style={{
                      borderColor: "#f97316",
                      background: "rgba(249, 115, 22, 0.06)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="dot" style={{ background: "#f97316" }} />
                      <strong style={{ fontSize: 13, color: "#fdba74" }}>Human Review Required</strong>
                    </div>
                    <div style={{ fontSize: 12, color: "#e4e4e7" }}>
                      {runDetail.pausedCheckpoint.message || `Checkpoint: ${runDetail.pausedCheckpoint.nodeId}`}
                    </div>
                    {checkpointReviewText && (
                      <div>
                        <div className="section-title" style={{ marginBottom: 4 }}>Content to Review</div>
                        <pre className="mono-pre" style={{ maxHeight: 240, overflowY: "auto" }}>{checkpointReviewText}</pre>
                      </div>
                    )}
                    <button
                      className="btn btn-sm"
                      style={{ alignSelf: "flex-start" }}
                      onClick={() => setShowPatchBox((v) => !v)}
                    >
                      {showPatchBox ? "Hide State Edit" : "Edit State JSON Before Approving"}
                    </button>
                    {showPatchBox && (
                      <textarea
                        className="textarea"
                        rows={4}
                        value={checkpointPatchJson}
                        onChange={(e) => setCheckpointPatchJson(e.target.value)}
                      />
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-emerald" style={{ flex: 1 }} onClick={() => handleCheckpoint("approve")}>
                        ✓ Approve &amp; Continue
                      </button>
                      <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => handleCheckpoint("reject")}>
                        ✕ Reject
                      </button>
                    </div>
                  </div>
                )}

                {/* Step Execution Timeline with Full Output */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="section-title">Execution Steps ({runDetail.history.length})</div>
                  {runDetail.history.map((h) => {
                    const nodeCfg = rawNodeMap.get(h.nodeId);
                    const outKey = typeof nodeCfg?.outputKey === "string" ? nodeCfg.outputKey : undefined;
                    const fullVal = outKey ? runDetail.data[outKey] : undefined;
                    const displayVal =
                      fullVal !== undefined
                        ? typeof fullVal === "string"
                          ? fullVal
                          : JSON.stringify(fullVal, null, 2)
                        : h.outputPreview || "";

                    return (
                      <div key={`${h.step}-${h.nodeId}`} className="card" style={{ padding: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 600 }}>
                            {h.step}. {nodeCfg?.label || h.nodeId}
                          </span>
                          <div style={{ display: "flex", gap: 4 }}>
                            {h.branch && <span className="pill pill-info">{h.branch}</span>}
                            <span
                              className={`pill ${
                                h.status === "done" ? "pill-ok" : h.status === "failed" ? "pill-err" : "pill-warn"
                              }`}
                            >
                              {h.status}
                            </span>
                          </div>
                        </div>
                        {h.error && <div style={{ color: "#fca5a5", fontSize: 11.5, marginTop: 6 }}>{h.error}</div>}
                        {displayVal && (
                          <pre className="mono-pre" style={{ marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
                            {displayVal}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Full State Data Viewer */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span className="section-title">Run State Data</span>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        navigator.clipboard?.writeText(JSON.stringify(runDetail.data, null, 2));
                        onStatus("Copied run state JSON to clipboard.");
                      }}
                    >
                      Copy JSON
                    </button>
                  </div>
                  <pre className="mono-pre" style={{ maxHeight: 220, overflowY: "auto" }}>
                    {JSON.stringify(runDetail.data, null, 2)}
                  </pre>
                </div>
              </>
            )
          ) : selectedEdge ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="section-title">
                Edge: {selectedEdge.source} → {selectedEdge.target}
              </div>
              {validEdgeConditions.length > 0 ? (
                <label className="field-label">
                  Branch Condition
                  <select
                    className="select"
                    value={String(selectedEdge.label || "")}
                    onChange={(e) =>
                      setEdges((eds) =>
                        eds.map((ed) => (ed.id === selectedEdge.id ? { ...ed, label: e.target.value } : ed)),
                      )
                    }
                  >
                    <option value="">(unconditional)</option>
                    {validEdgeConditions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  Unconditional edge (runs immediately after <strong>{selectedEdge.source}</strong> finishes).
                </div>
              )}
              <button
                className="btn btn-danger"
                onClick={() => {
                  setEdges((eds) => eds.filter((e) => e.id !== selectedEdge.id));
                  setSelectedEdgeId(null);
                }}
              >
                Delete Edge
              </button>
            </div>
          ) : selectedRawNode ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="section-title">{selectedRawNode.type} Node · {selectedRawNode.id}</span>
                <button className="btn btn-danger btn-sm" onClick={deleteSelectedNode}>Delete</button>
              </div>

              <label className="field-label">
                Label
                <input
                  className="input"
                  value={String(selectedRawNode.label || "")}
                  onChange={(e) => updateSelectedNode("label", e.target.value)}
                />
              </label>

              {(selectedRawNode.type === "agent" ||
                selectedRawNode.type === "subagent" ||
                selectedRawNode.type === "decision" ||
                selectedRawNode.type === "skill") && (
                <label className="field-label">
                  Model Tier
                  <select
                    className="select"
                    value={String(selectedRawNode.tier || "subagent")}
                    onChange={(e) => updateSelectedNode("tier", e.target.value)}
                  >
                    {MODEL_TIERS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>
              )}

              {selectedRawNode.type === "subagent" && (
                <>
                  <label className="field-label">
                    Role
                    <input
                      className="input"
                      value={String(selectedRawNode.role || "")}
                      onChange={(e) => updateSelectedNode("role", e.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    Skills (comma-separated)
                    <input
                      className="input"
                      value={Array.isArray(selectedRawNode.skills) ? (selectedRawNode.skills as string[]).join(", ") : ""}
                      onChange={(e) =>
                        updateSelectedNode(
                          "skills",
                          e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                        )
                      }
                      placeholder={skills.slice(0, 4).join(", ")}
                    />
                  </label>
                </>
              )}

              {selectedRawNode.type === "skill" && (
                <label className="field-label">
                  Skill
                  <select
                    className="select"
                    value={String(selectedRawNode.skillName || "")}
                    onChange={(e) => updateSelectedNode("skillName", e.target.value)}
                  >
                    {skills.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
              )}

              {selectedRawNode.type === "decision" && (
                <label className="field-label">
                  Branches (comma-separated)
                  <input
                    className="input"
                    value={Array.isArray(selectedRawNode.branches) ? (selectedRawNode.branches as string[]).join(", ") : ""}
                    onChange={(e) =>
                      updateSelectedNode(
                        "branches",
                        e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                      )
                    }
                  />
                </label>
              )}

              {selectedRawNode.type === "tool" && (
                <>
                  <label className="field-label">
                    Tool Kind
                    <select
                      className="select"
                      value={String(selectedRawNode.toolKind || "shell")}
                      onChange={(e) => updateSelectedNode("toolKind", e.target.value)}
                    >
                      <option value="shell">shell</option>
                      <option value="http">http</option>
                      <option value="yue2">yue2</option>
                    </select>
                  </label>
                  <label className="field-label">
                    Command or URL
                    <input
                      className="input"
                      value={String(selectedRawNode.commandOrUrl || "")}
                      onChange={(e) => updateSelectedNode("commandOrUrl", e.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    Body Template (JSON)
                    <textarea
                      className="textarea"
                      rows={3}
                      value={String(selectedRawNode.bodyTemplate || "")}
                      onChange={(e) => updateSelectedNode("bodyTemplate", e.target.value)}
                    />
                  </label>
                </>
              )}

              {selectedRawNode.type === "checkpoint" && (
                <>
                  <label className="field-label">
                    Review Prompt Message
                    <textarea
                      className="textarea"
                      rows={3}
                      value={String(selectedRawNode.message || "")}
                      onChange={(e) => updateSelectedNode("message", e.target.value)}
                    />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                    <input
                      type="checkbox"
                      checked={selectedRawNode.allowStateEdit !== false}
                      onChange={(e) => updateSelectedNode("allowStateEdit", e.target.checked)}
                    />
                    Allow state patch on approval
                  </label>
                </>
              )}

              {selectedRawNode.type === "memory" && (
                <>
                  <label className="field-label">
                    Operation
                    <select
                      className="select"
                      value={String(selectedRawNode.operation || "search")}
                      onChange={(e) => updateSelectedNode("operation", e.target.value)}
                    >
                      <option value="search">search</option>
                      <option value="save">save</option>
                      <option value="consolidate">consolidate</option>
                    </select>
                  </label>
                  <label className="field-label">
                    Scope
                    <select
                      className="select"
                      value={String(selectedRawNode.scope || "both")}
                      onChange={(e) => updateSelectedNode("scope", e.target.value)}
                    >
                      <option value="both">both</option>
                      <option value="project">project</option>
                      <option value="global">global</option>
                    </select>
                  </label>
                  <label className="field-label">
                    Query or Title Template
                    <input
                      className="input"
                      value={String(selectedRawNode.queryOrTitleTemplate || "")}
                      onChange={(e) => updateSelectedNode("queryOrTitleTemplate", e.target.value)}
                    />
                  </label>
                  {selectedRawNode.operation === "save" && (
                    <label className="field-label">
                      Content Template
                      <textarea
                        className="textarea"
                        rows={3}
                        value={String(selectedRawNode.contentTemplate || "")}
                        onChange={(e) => updateSelectedNode("contentTemplate", e.target.value)}
                      />
                    </label>
                  )}
                </>
              )}

              {(selectedRawNode.type === "agent" ||
                selectedRawNode.type === "subagent" ||
                selectedRawNode.type === "decision" ||
                selectedRawNode.type === "skill") && (
                <label className="field-label">
                  Prompt Template (supports {"{{nested.key}}"})
                  <textarea
                    className="textarea"
                    rows={5}
                    value={String(selectedRawNode.promptTemplate || "")}
                    onChange={(e) => updateSelectedNode("promptTemplate", e.target.value)}
                  />
                </label>
              )}

              {selectedRawNode.type !== "checkpoint" && (
                <label className="field-label">
                  Output Key
                  <input
                    className="input"
                    value={String(selectedRawNode.outputKey || "")}
                    onChange={(e) => updateSelectedNode("outputKey", e.target.value)}
                  />
                </label>
              )}
            </div>
          ) : (
            <div style={{ color: "var(--text-muted)", fontSize: 12.5, lineHeight: 1.6, padding: "20px 6px" }}>
              Click any node or edge on the canvas to edit its properties.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
