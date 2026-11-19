import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";

type NodeKind = "agent" | "subagent" | "decision" | "tool" | "skill" | "checkpoint" | "memory";

interface RawGraphNode {
  id: string;
  type: NodeKind;
  label: string;
  position?: { x: number; y: number };
  [key: string]: unknown;
}

interface RawGraph {
  id: string;
  name: string;
  description?: string;
  version: number;
  entryNode: string;
  maxSteps: number;
  nodes: RawGraphNode[];
  edges: Array<{ id: string; source: string; target: string; condition?: string }>;
}

const TYPE_COLORS: Record<NodeKind, string> = {
  agent: "#3b82f6",
  subagent: "#8b5cf6",
  decision: "#f59e0b",
  tool: "#10b981",
  skill: "#06b6d4",
  checkpoint: "#ef4444",
  memory: "#ec4899",
};

const STATUS_BORDER: Record<string, string> = {
  running: "#facc15",
  waiting_checkpoint: "#f97316",
  done: "#22c55e",
  failed: "#ef4444",
};

export default function App() {
  const [tab, setTab] = useState<"canvas" | "memory">("canvas");
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string }>>([]);
  const [graphMeta, setGraphMeta] = useState<Omit<RawGraph, "nodes" | "edges"> | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodeStatus, setNodeStatus] = useState<Record<string, { status: string; preview?: string }>>({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pausedCheckpoint, setPausedCheckpoint] = useState<{ nodeId: string; message?: string } | null>(null);
  const [runInputJson, setRunInputJson] = useState('{"topic": "Local GPU inference optimization"}');
  const [checkpointPatchJson, setCheckpointPatchJson] = useState("{}");
  const [statusBanner, setStatusBanner] = useState<string>("");

  // Memory explorer state
  const [memQuery, setMemQuery] = useState("");
  const [memScope, setMemScope] = useState<"both" | "project" | "global">("both");
  const [memories, setMemories] = useState<Array<Record<string, unknown>>>([]);
  const [profiles, setProfiles] = useState<{ global: string; project: string }>({ global: "", project: "" });

  const loadWorkflow = useCallback(async (id: string) => {
    const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const g = (await res.json()) as RawGraph;
    setGraphMeta({
      id: g.id,
      name: g.name,
      description: g.description,
      version: g.version || 1,
      entryNode: g.entryNode,
      maxSteps: g.maxSteps || 50,
    });
    setNodes(
      g.nodes.map((n, idx) => ({
        id: n.id,
        position: n.position || { x: 100 + idx * 240, y: 120 },
        data: { ...n },
        style: {
          background: "#111827",
          color: "#f3f4f6",
          border: `2px solid ${TYPE_COLORS[n.type] || "#64748b"}`,
          borderRadius: 10,
          padding: "8px 12px",
          minWidth: 180,
          fontSize: 12,
        },
      })),
    );
    setEdges(
      g.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.condition || "",
        animated: false,
        style: { stroke: "#64748b" },
      })),
    );
    setSelectedId(null);
    setNodeStatus({});
    setPausedCheckpoint(null);
  }, [setEdges, setNodes]);

  useEffect(() => {
    fetch("/api/workflows")
      .then((r) => r.json())
      .then((d: { workflows?: Array<{ id: string; name: string }> }) => {
        const list = d.workflows || [];
        setWorkflows(list);
        if (list.length > 0) loadWorkflow(list[0].id);
      })
      .catch(() => {});
  }, [loadWorkflow]);

  // Live SSE event stream
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as {
          nodeId?: string;
          status?: string;
          preview?: string;
          message?: string;
          runId?: string;
        };
        if (!msg.nodeId || !msg.status) return;
        setNodeStatus((prev) => ({
          ...prev,
          [msg.nodeId!]: { status: msg.status!, preview: msg.preview },
        }));
        if (msg.status === "waiting_checkpoint") {
          setPausedCheckpoint({ nodeId: msg.nodeId, message: msg.message });
        } else if (msg.status === "done" && pausedCheckpoint?.nodeId === msg.nodeId) {
          setPausedCheckpoint(null);
        }
      } catch {
        // ignore malformed SSE
      }
    };
    return () => es.close();
  }, [pausedCheckpoint?.nodeId]);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge({ ...params, id: `e-${Date.now()}`, style: { stroke: "#64748b" } }, eds),
      ),
    [setEdges],
  );

  const buildRawGraph = (): RawGraph | null => {
    if (!graphMeta) return null;
    return {
      ...graphMeta,
      nodes: nodes.map((n) => ({
        ...(n.data as RawGraphNode),
        id: n.id,
        position: n.position,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        condition: typeof e.label === "string" && e.label.trim() ? e.label.trim() : undefined,
      })),
    };
  };

  const handleSave = async () => {
    const g = buildRawGraph();
    if (!g) return;
    const res = await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(g),
    });
    setStatusBanner(res.ok ? `Saved ${g.id}.graph.json` : "Save failed");
  };

  const handleRun = async () => {
    const g = buildRawGraph();
    if (!g) return;
    let initialData: Record<string, unknown> = {};
    try {
      initialData = JSON.parse(runInputJson);
    } catch {
      setStatusBanner("Invalid Run Input JSON");
      return;
    }
    setNodeStatus({});
    setPausedCheckpoint(null);
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph: g, initialData }),
    });
    const data = (await res.json()) as { runId?: string; error?: string };
    if (res.ok && data.runId) {
      setActiveRunId(data.runId);
      setStatusBanner(`Started Temporal run: ${data.runId}`);
    } else {
      setStatusBanner(`Run error: ${data.error || "Check Temporal server"}`);
    }
  };

  const handleCheckpointAction = async (action: "approve" | "reject") => {
    if (!activeRunId || !pausedCheckpoint) return;
    let statePatch: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(checkpointPatchJson);
      if (Object.keys(parsed).length > 0) statePatch = parsed;
    } catch {
      setStatusBanner("Invalid statePatch JSON");
      return;
    }
    const res = await fetch(`/api/runs/${encodeURIComponent(activeRunId)}/checkpoint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: pausedCheckpoint.nodeId, action, statePatch }),
    });
    if (res.ok) {
      setStatusBanner(`Sent ${action} signal to ${pausedCheckpoint.nodeId}`);
      setPausedCheckpoint(null);
    }
  };

  const addNode = (type: NodeKind) => {
    const id = `${type}_${Date.now().toString(36).slice(-4)}`;
    const defaults: Record<NodeKind, Record<string, unknown>> = {
      agent: { tier: "main", promptTemplate: "Analyze {{topic}}", outputKey: "agent_out" },
      subagent: { role: "Researcher", tier: "subagent", promptTemplate: "Research {{topic}}", outputKey: "sub_out" },
      decision: { tier: "decision", promptTemplate: "Route {{topic}}", branches: ["a", "b"], outputKey: "route" },
      tool: { toolKind: "shell", commandOrUrl: "echo hello", outputKey: "tool_out" },
      skill: { skillName: "github-scout", tier: "subagent", promptTemplate: "Run skill", outputKey: "skill_out" },
      checkpoint: { message: "Approve to continue", allowStateEdit: true },
      memory: { operation: "search", scope: "both", queryOrTitleTemplate: "{{topic}}", outputKey: "mem_out" },
    };
    const newNode: Node = {
      id,
      position: { x: 240 + nodes.length * 30, y: 180 + nodes.length * 20 },
      data: { id, type, label: `New ${type}`, ...defaults[type] },
      style: {
        background: "#111827",
        color: "#f3f4f6",
        border: `2px solid ${TYPE_COLORS[type]}`,
        borderRadius: 10,
        padding: "8px 12px",
        minWidth: 180,
        fontSize: 12,
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedId(id);
  };

  const loadMemories = useCallback(async () => {
    const res = await fetch(`/api/memory?scope=${memScope}&q=${encodeURIComponent(memQuery)}`);
    if (!res.ok) return;
    const d = (await res.json()) as {
      items: Array<Record<string, unknown>>;
      profiles: { global: string; project: string };
    };
    setMemories(d.items || []);
    setProfiles(d.profiles || { global: "", project: "" });
  }, [memQuery, memScope]);

  useEffect(() => {
    if (tab === "memory") loadMemories();
  }, [tab, loadMemories]);

  const styledNodes = nodes.map((n) => {
    const st = nodeStatus[n.id];
    const kind = (n.data as RawGraphNode).type;
    const borderColor = st ? STATUS_BORDER[st.status] || TYPE_COLORS[kind] : TYPE_COLORS[kind];
    return {
      ...n,
      data: {
        ...n.data,
        label: (
          <div>
            <div style={{ fontSize: 10, opacity: 0.7, textTransform: "uppercase" }}>
              {kind} {st ? `• ${st.status}` : ""}
            </div>
            <div style={{ fontWeight: 600 }}>{String((n.data as RawGraphNode).label)}</div>
            {st?.preview && (
              <div style={{ fontSize: 10, opacity: 0.75, marginTop: 4 }}>{st.preview.slice(0, 60)}</div>
            )}
          </div>
        ),
      },
      style: { ...n.style, border: `2px solid ${borderColor}` },
    };
  });

  const selectedNode = nodes.find((n) => n.id === selectedId);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Top Bar */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          background: "#111827",
          borderBottom: "1px solid #1f2937",
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: 15 }}>Sosho Studio</strong>
        <button onClick={() => setTab("canvas")} style={btnStyle(tab === "canvas")}>
          Workflow Canvas
        </button>
        <button onClick={() => setTab("memory")} style={btnStyle(tab === "memory")}>
          Memory Explorer
        </button>

        {tab === "canvas" && (
          <>
            <select
              value={graphMeta?.id || ""}
              onChange={(e) => loadWorkflow(e.target.value)}
              style={{ background: "#1f2937", color: "#fff", border: "1px solid #374151", padding: "4px 8px", borderRadius: 6 }}
            >
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <button onClick={handleSave} style={btnStyle(false)}>Save</button>
            <button onClick={handleRun} style={{ ...btnStyle(true), background: "#10b981" }}>Run on Temporal</button>
          </>
        )}

        <div style={{ marginLeft: "auto", display: "flex", gap: 10, fontSize: 12 }}>
          <a href="http://127.0.0.1:3000" target="_blank" rel="noreferrer" style={{ color: "#93c5fd" }}>
            Langfuse :3000
          </a>
          <a href="http://127.0.0.1:8233" target="_blank" rel="noreferrer" style={{ color: "#c4b5fd" }}>
            Temporal UI :8233
          </a>
        </div>
      </header>

      {statusBanner && (
        <div style={{ padding: "4px 14px", background: "#1e293b", fontSize: 12, color: "#93c5fd" }}>
          {statusBanner}
        </div>
      )}

      {tab === "canvas" ? (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Node Palette */}
          <aside style={{ width: 150, padding: 10, background: "#0f172a", borderRight: "1px solid #1f2937", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>ADD NODE</div>
            {(Object.keys(TYPE_COLORS) as NodeKind[]).map((k) => (
              <button
                key={k}
                onClick={() => addNode(k)}
                style={{
                  textAlign: "left",
                  padding: "6px 8px",
                  background: "#111827",
                  color: "#e5e7eb",
                  border: `1px solid ${TYPE_COLORS[k]}`,
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                + {k}
              </button>
            ))}
            <div style={{ marginTop: 14, fontSize: 11, opacity: 0.6 }}>RUN INPUT JSON</div>
            <textarea
              value={runInputJson}
              onChange={(e) => setRunInputJson(e.target.value)}
              rows={5}
              style={{ background: "#111827", color: "#e5e7eb", border: "1px solid #374151", borderRadius: 6, fontSize: 11, padding: 6 }}
            />
          </aside>

          {/* React Flow Canvas */}
          <div style={{ flex: 1 }}>
            <ReactFlow
              nodes={styledNodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_e, node) => setSelectedId(node.id)}
              fitView
            >
              <Background color="#1f2937" gap={18} />
              <Controls />
              <MiniMap style={{ background: "#111827" }} />
            </ReactFlow>
          </div>

          {/* Right Inspector + HITL Checkpoint Drawer */}
          <aside style={{ width: 300, padding: 12, background: "#0f172a", borderLeft: "1px solid #1f2937", overflowY: "auto" }}>
            {pausedCheckpoint && (
              <div style={{ marginBottom: 14, padding: 10, border: "1px solid #f97316", borderRadius: 8, background: "#1c1917" }}>
                <strong style={{ color: "#fb923c" }}>HITL Checkpoint Paused</strong>
                <p style={{ fontSize: 12 }}>{pausedCheckpoint.message || pausedCheckpoint.nodeId}</p>
                <div style={{ fontSize: 11, opacity: 0.7 }}>Optional State Patch (JSON):</div>
                <textarea
                  value={checkpointPatchJson}
                  onChange={(e) => setCheckpointPatchJson(e.target.value)}
                  rows={3}
                  style={{ width: "100%", background: "#111827", color: "#fff", border: "1px solid #374151", borderRadius: 4, fontSize: 11 }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={() => handleCheckpointAction("approve")} style={{ ...btnStyle(true), background: "#16a34a" }}>
                    Approve
                  </button>
                  <button onClick={() => handleCheckpointAction("reject")} style={{ ...btnStyle(true), background: "#dc2626" }}>
                    Reject
                  </button>
                </div>
              </div>
            )}

            <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>NODE INSPECTOR</div>
            {selectedNode ? (
              <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", background: "#111827", padding: 10, borderRadius: 6 }}>
                {JSON.stringify(selectedNode.data, null, 2)}
              </pre>
            ) : (
              <div style={{ fontSize: 12, opacity: 0.6 }}>Click any node on the canvas to inspect its config and live status.</div>
            )}
          </aside>
        </div>
      ) : (
        /* Memory Explorer Tab */
        <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              value={memQuery}
              onChange={(e) => setMemQuery(e.target.value)}
              placeholder="Hybrid search Global & Project memory..."
              style={{ flex: 1, padding: "6px 10px", background: "#111827", color: "#fff", border: "1px solid #374151", borderRadius: 6 }}
            />
            <select
              value={memScope}
              onChange={(e) => setMemScope(e.target.value as "both" | "project" | "global")}
              style={{ background: "#111827", color: "#fff", border: "1px solid #374151", borderRadius: 6, padding: "6px 8px" }}
            >
              <option value="both">Both Scopes</option>
              <option value="project">Project (.pi/memory)</option>
              <option value="global">Global (~/.sosho/memory)</option>
            </select>
            <button onClick={loadMemories} style={btnStyle(true)}>Search</button>
            <button
              onClick={async () => {
                await fetch("/api/memory/consolidate", { method: "POST" });
                loadMemories();
                setStatusBanner("Consolidated memory inbox & refreshed profiles.");
              }}
              style={btnStyle(false)}
            >
              Consolidate Inbox
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div style={{ background: "#111827", padding: 10, borderRadius: 8, border: "1px solid #1f2937" }}>
              <div style={{ fontSize: 11, opacity: 0.7 }}>GLOBAL PROFILE (~/.sosho/memory/core/profile.md)</div>
              <pre style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>{profiles.global}</pre>
            </div>
            <div style={{ background: "#111827", padding: 10, borderRadius: 8, border: "1px solid #1f2937" }}>
              <div style={{ fontSize: 11, opacity: 0.7 }}>PROJECT PROFILE (.pi/memory/core/profile.md)</div>
              <pre style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>{profiles.project}</pre>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {memories.map((m) => (
              <div key={String(m.id)} style={{ background: "#111827", padding: 10, borderRadius: 8, border: "1px solid #1f2937" }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  [{String(m.id)}] {String(m.title)}{" "}
                  <span style={{ fontWeight: 400, opacity: 0.7 }}>
                    ({String(m.scope)}/{String(m.type)})
                  </span>
                </div>
                <div style={{ fontSize: 12, marginTop: 4, opacity: 0.9 }}>{String(m.content)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function btnStyle(active: boolean) {
  return {
    padding: "5px 10px",
    borderRadius: 6,
    border: "1px solid #374151",
    background: active ? "#2563eb" : "#1f2937",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
  } as const;
}
