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
import { useCallback, useEffect, useRef, useState } from "react";

type NodeKind = "agent" | "subagent" | "decision" | "tool" | "skill" | "checkpoint" | "memory";
type ModelTier = "main" | "subagent" | "subagent-code" | "decision" | "local-uncensored";

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

interface RunSummary {
  runId: string;
  graphId: string;
  status: string;
  currentNodeId: string | null;
  stepCount: number;
  pausedCheckpoint?: { nodeId: string; message?: string } | null;
  error?: string;
  updatedAt?: string;
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

const MODEL_TIERS: ModelTier[] = ["main", "subagent", "subagent-code", "decision", "local-uncensored"];

function getStoredToken(): string {
  if (typeof window !== "undefined") {
    const ls = window.localStorage.getItem("sosho_studio_token");
    if (ls) return ls;
  }
  return (import.meta.env.VITE_SOSHO_STUDIO_TOKEN as string | undefined) || "";
}

function getAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getStoredToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

function getInitialRunId(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("runId");
  if (fromUrl) return fromUrl;
  return window.localStorage.getItem("sosho_active_run_id");
}

function persistActiveRunId(runId: string | null) {
  if (typeof window === "undefined") return;
  if (runId) {
    window.localStorage.setItem("sosho_active_run_id", runId);
    const url = new URL(window.location.href);
    url.searchParams.set("runId", runId);
    window.history.replaceState({}, "", url.toString());
  } else {
    window.localStorage.removeItem("sosho_active_run_id");
    const url = new URL(window.location.href);
    url.searchParams.delete("runId");
    window.history.replaceState({}, "", url.toString());
  }
}

export default function App() {
  const [tab, setTab] = useState<"canvas" | "memory">("canvas");
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string }>>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [graphMeta, setGraphMeta] = useState<Omit<RawGraph, "nodes" | "edges"> | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [nodeStatus, setNodeStatus] = useState<Record<string, { status: string; preview?: string }>>({});
  const [activeRunId, setActiveRunIdState] = useState<string | null>(() => getInitialRunId());
  const activeRunIdRef = useRef<string | null>(activeRunId);
  const [pausedCheckpoint, setPausedCheckpoint] = useState<{ nodeId: string; message?: string } | null>(null);
  const [runInputJson, setRunInputJson] = useState('{"topic": "Local GPU inference optimization"}');
  const [checkpointPatchJson, setCheckpointPatchJson] = useState("{}");
  const [statusBanner, setStatusBanner] = useState<string>("");
  const [studioToken, setStudioToken] = useState<string>(() => getStoredToken());

  // Memory explorer state
  const [memQuery, setMemQuery] = useState("");
  const [memScope, setMemScope] = useState<"both" | "project" | "global">("both");
  const [memories, setMemories] = useState<Array<Record<string, unknown>>>([]);
  const [profiles, setProfiles] = useState<{ global: string; project: string }>({ global: "", project: "" });
  const [newMemScope, setNewMemScope] = useState<"project" | "global">("project");
  const [newMemType, setNewMemType] = useState<"semantic" | "procedural" | "episodic" | "entity">("semantic");
  const [newMemTitle, setNewMemTitle] = useState("");
  const [newMemContent, setNewMemContent] = useState("");

  const setActiveRunId = useCallback((runId: string | null) => {
    activeRunIdRef.current = runId;
    setActiveRunIdState(runId);
    persistActiveRunId(runId);
  }, []);

  const refreshWorkflows = useCallback(async () => {
    try {
      const r = await fetch("/api/workflows");
      const d = (await r.json()) as { workflows?: Array<{ id: string; name: string }> };
      const list = d.workflows || [];
      setWorkflows(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const refreshRuns = useCallback(async () => {
    try {
      const r = await fetch("/api/runs?limit=20");
      if (!r.ok) return;
      const d = (await r.json()) as { runs?: RunSummary[] };
      setRuns(d.runs || []);
    } catch {
      // ignore
    }
  }, []);

  const hydrateRunState = useCallback(async (runId: string) => {
    try {
      const r = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
      if (!r.ok) return;
      const run = (await r.json()) as {
        runId: string;
        status: string;
        pausedCheckpoint?: { nodeId: string; message?: string } | null;
        history?: Array<{ nodeId: string; status: string; outputPreview?: string }>;
      };
      const statuses: Record<string, { status: string; preview?: string }> = {};
      for (const h of run.history || []) {
        statuses[h.nodeId] = { status: h.status, preview: h.outputPreview };
      }
      setNodeStatus(statuses);
      if (run.status === "waiting_checkpoint" && run.pausedCheckpoint) {
        setPausedCheckpoint(run.pausedCheckpoint);
      } else {
        setPausedCheckpoint(null);
      }
      setStatusBanner(`Run ${run.runId}: ${run.status}`);
    } catch {
      // ignore
    }
  }, []);

  const loadWorkflow = useCallback(
    async (id: string) => {
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
      setSelectedEdgeId(null);
    },
    [setEdges, setNodes],
  );

  // Initial load: workflows, skills, runs, and restore persisted activeRunId
  useEffect(() => {
    refreshWorkflows().then((list) => {
      if (list.length > 0) loadWorkflow(list[0].id);
    });
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d: { skills?: string[] }) => setSkills(d.skills || []))
      .catch(() => {});
    refreshRuns();
    if (activeRunIdRef.current) {
      hydrateRunState(activeRunIdRef.current);
    }
  }, [hydrateRunState, loadWorkflow, refreshRuns, refreshWorkflows]);

  // Stable SSE event stream (never reconnects on checkpoint changes; filters by activeRunId)
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as {
          type?: string;
          nodeId?: string;
          status?: string;
          preview?: string;
          message?: string;
          runId?: string;
        };
        if (msg.type === "run_started" || msg.type === "run_completed" || msg.type === "run_failed" || msg.type === "run_cancelled") {
          refreshRuns();
        }
        const currentRun = activeRunIdRef.current;
        if (currentRun && msg.runId && msg.runId !== currentRun) return;
        if (msg.type === "run_completed" || msg.type === "run_failed" || msg.type === "run_cancelled") {
          setPausedCheckpoint(null);
          setStatusBanner(`Run ${msg.runId || currentRun}: ${msg.type.replace("run_", "")}`);
          return;
        }
        if (!msg.nodeId || !msg.status) return;
        setNodeStatus((prev) => ({
          ...prev,
          [msg.nodeId!]: { status: msg.status!, preview: msg.preview },
        }));
        if (msg.status === "waiting_checkpoint") {
          setPausedCheckpoint({ nodeId: msg.nodeId, message: msg.message });
          refreshRuns();
        } else if (msg.status === "done") {
          setPausedCheckpoint((prev) => (prev?.nodeId === msg.nodeId ? null : prev));
        }
      } catch {
        // ignore malformed SSE
      }
    };
    return () => es.close();
  }, [refreshRuns]);

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

  const handleNewWorkflow = () => {
    const id = `wf-${Date.now().toString(36)}`;
    const firstId = "start_agent";
    setGraphMeta({
      id,
      name: `New Workflow (${id})`,
      description: "",
      version: 1,
      entryNode: firstId,
      maxSteps: 30,
    });
    setNodes([
      {
        id: firstId,
        position: { x: 160, y: 140 },
        data: {
          id: firstId,
          type: "agent",
          label: "Start Agent",
          tier: "main",
          promptTemplate: "Analyze {{topic}}",
          outputKey: "result",
        },
        style: {
          background: "#111827",
          color: "#f3f4f6",
          border: `2px solid ${TYPE_COLORS.agent}`,
          borderRadius: 10,
          padding: "8px 12px",
          minWidth: 180,
          fontSize: 12,
        },
      },
    ]);
    setEdges([]);
    setSelectedId(firstId);
    setSelectedEdgeId(null);
    setStatusBanner(`Drafted new workflow ${id}. Click Save to persist.`);
  };

  const handleDeleteWorkflow = async () => {
    if (!graphMeta) return;
    const res = await fetch(`/api/workflows/${encodeURIComponent(graphMeta.id)}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (res.ok) {
      setStatusBanner(`Deleted workflow ${graphMeta.id}`);
      const list = await refreshWorkflows();
      if (list.length > 0) {
        loadWorkflow(list[0].id);
      } else {
        setGraphMeta(null);
        setNodes([]);
        setEdges([]);
      }
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setStatusBanner(`Delete failed: ${err.error || res.status}`);
    }
  };

  const handleSave = async () => {
    const g = buildRawGraph();
    if (!g) return;
    const res = await fetch("/api/workflows", {
      method: "POST",
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(g),
    });
    if (res.ok) {
      setStatusBanner(`Saved ${g.id}.graph.json`);
      refreshWorkflows();
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setStatusBanner(`Save failed: ${err.error || res.status}`);
    }
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
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ graph: g, initialData }),
    });
    const data = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
    if (res.ok && data.runId) {
      setActiveRunId(data.runId);
      setStatusBanner(`Started workflow run: ${data.runId}`);
      refreshRuns();
    } else {
      setStatusBanner(`Run error: ${data.error || res.status}`);
    }
  };

  const handleCancelRun = async (runId: string) => {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      headers: getAuthHeaders(),
    });
    if (res.ok) {
      setStatusBanner(`Cancelled run ${runId}`);
      if (activeRunId === runId) setPausedCheckpoint(null);
      refreshRuns();
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
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ nodeId: pausedCheckpoint.nodeId, action, statePatch }),
    });
    if (res.ok) {
      setStatusBanner(`Sent ${action} signal to ${pausedCheckpoint.nodeId}`);
      setPausedCheckpoint(null);
      refreshRuns();
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setStatusBanner(`Checkpoint error: ${err.error || res.status}`);
    }
  };

  const addNode = (type: NodeKind) => {
    const id = `${type}_${Date.now().toString(36).slice(-4)}`;
    const defaults: Record<NodeKind, Record<string, unknown>> = {
      agent: { tier: "main", promptTemplate: "Analyze {{topic}}", outputKey: "agent_out" },
      subagent: { role: "Researcher", tier: "subagent", promptTemplate: "Research {{topic}}", skills: [], outputKey: "sub_out" },
      decision: { tier: "decision", promptTemplate: "Route {{topic}}", branches: ["a", "b"], outputKey: "route" },
      tool: { toolKind: "shell", commandOrUrl: "echo hello", outputKey: "tool_out" },
      skill: { skillName: skills[0] || "github-scout", tier: "subagent", promptTemplate: "Run skill on {{topic}}", outputKey: "skill_out" },
      checkpoint: { message: "Review before continuing", allowStateEdit: true },
      memory: { operation: "search", scope: "both", queryOrTitleTemplate: "{{topic}}", outputKey: "mem_out" },
    };
    const newNode: Node = {
      id,
      position: { x: 240 + Math.random() * 140, y: 120 + Math.random() * 120 },
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
    setSelectedEdgeId(null);
  };

  const updateSelectedNodeField = (key: string, value: unknown) => {
    if (!selectedId) return;
    setNodes((nds) =>
      nds.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, [key]: value } } : n)),
    );
  };

  const deleteSelectedNode = () => {
    if (!selectedId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  };

  const updateSelectedEdgeCondition = (condition: string) => {
    if (!selectedEdgeId) return;
    setEdges((eds) =>
      eds.map((e) => (e.id === selectedEdgeId ? { ...e, label: condition } : e)),
    );
  };

  const deleteSelectedEdge = () => {
    if (!selectedEdgeId) return;
    setEdges((eds) => eds.filter((e) => e.id !== selectedEdgeId));
    setSelectedEdgeId(null);
  };

  const loadMemories = useCallback(async () => {
    const res = await fetch(`/api/memory?scope=${memScope}&q=${encodeURIComponent(memQuery)}`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      items?: Array<Record<string, unknown>>;
      profiles?: { global: string; project: string };
    };
    setMemories(data.items || []);
    if (data.profiles) setProfiles(data.profiles);
  }, [memQuery, memScope]);

  const handleCreateMemory = async () => {
    if (!newMemTitle.trim() || !newMemContent.trim()) return;
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        scope: newMemScope,
        type: newMemType,
        title: newMemTitle.trim(),
        content: newMemContent.trim(),
      }),
    });
    if (res.ok) {
      setNewMemTitle("");
      setNewMemContent("");
      setStatusBanner("Saved memory record.");
      loadMemories();
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setStatusBanner(`Memory save failed: ${err.error || res.status}`);
    }
  };

  const handleArchiveMemory = async (id: string, scope: string) => {
    const res = await fetch(`/api/memory/${encodeURIComponent(id)}?scope=${encodeURIComponent(scope)}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (res.ok) {
      setStatusBanner(`Archived memory ${id}`);
      loadMemories();
    }
  };

  useEffect(() => {
    if (tab === "memory") loadMemories();
  }, [tab, loadMemories]);

  const styledNodes = nodes.map((n) => {
    const raw = n.data as RawGraphNode;
    const st = nodeStatus[n.id];
    const borderColor = st ? STATUS_BORDER[st.status] || TYPE_COLORS[raw.type] : TYPE_COLORS[raw.type];
    const isEntry = graphMeta?.entryNode === n.id;
    return {
      ...n,
      data: {
        ...raw,
        label: (
          <div>
            <div style={{ fontSize: 10, opacity: 0.7, textTransform: "uppercase" }}>
              {raw.type} {isEntry ? "· ENTRY" : ""} {st ? `· ${st.status}` : ""}
            </div>
            <div style={{ fontWeight: 600 }}>{String(raw.label || n.id)}</div>
            {st?.preview && (
              <div style={{ fontSize: 10, opacity: 0.75, marginTop: 4 }}>
                {st.preview.slice(0, 60)}
              </div>
            )}
          </div>
        ),
      },
      style: {
        ...n.style,
        border: `2px solid ${borderColor}`,
        boxShadow: st?.status === "running" ? "0 0 12px #facc15" : undefined,
      },
    };
  });

  const selectedNode = nodes.find((n) => n.id === selectedId);
  const selectedRaw = selectedNode ? (selectedNode.data as RawGraphNode) : null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0b0f19", color: "#e5e7eb", fontFamily: "system-ui, sans-serif" }}>
      {/* Top Bar */}
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid #1f2937", background: "#0f172a", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 15 }}>Sosho Studio</strong>
        <button onClick={() => setTab("canvas")} style={btnStyle(tab === "canvas")}>Workflow Canvas</button>
        <button onClick={() => setTab("memory")} style={btnStyle(tab === "memory")}>Memory Explorer</button>

        {tab === "canvas" && (
          <>
            <select
              value={graphMeta?.id || ""}
              onChange={(e) => loadWorkflow(e.target.value)}
              style={inputStyle}
            >
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <button onClick={handleNewWorkflow} style={btnStyle(false)}>New</button>
            <button onClick={handleSave} style={btnStyle(false)}>Save</button>
            <button onClick={handleDeleteWorkflow} style={{ ...btnStyle(false), borderColor: "#991b1b", color: "#fca5a5" }}>Delete</button>
            {graphMeta && (
              <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                Entry:
                <select
                  value={graphMeta.entryNode}
                  onChange={(e) => setGraphMeta({ ...graphMeta, entryNode: e.target.value })}
                  style={inputStyle}
                >
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.id}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button onClick={handleRun} style={{ ...btnStyle(true), background: "#10b981" }}>Run Workflow</button>
          </>
        )}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          <input
            type="password"
            placeholder="Studio API Token"
            value={studioToken}
            onChange={(e) => {
              setStudioToken(e.target.value);
              window.localStorage.setItem("sosho_studio_token", e.target.value);
            }}
            style={{ ...inputStyle, width: 130 }}
          />
          <a href="http://127.0.0.1:3000" target="_blank" rel="noreferrer" style={{ color: "#93c5fd" }}>
            Langfuse :3000
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
          {/* Left Palette + Recent Runs */}
          <aside style={{ width: 190, padding: 10, background: "#0f172a", borderRight: "1px solid #1f2937", display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
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

            <div style={{ marginTop: 12, fontSize: 11, opacity: 0.6 }}>RUN INPUT JSON</div>
            <textarea
              value={runInputJson}
              onChange={(e) => setRunInputJson(e.target.value)}
              rows={4}
              style={{ ...inputStyle, width: "100%", fontSize: 11 }}
            />

            <div style={{ marginTop: 12, fontSize: 11, opacity: 0.6 }}>RECENT RUNS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {runs.map((r) => (
                <div
                  key={r.runId}
                  style={{
                    padding: 6,
                    borderRadius: 6,
                    background: activeRunId === r.runId ? "#1e293b" : "#111827",
                    border: "1px solid #1f2937",
                    fontSize: 11,
                  }}
                >
                  <div
                    style={{ cursor: "pointer", fontWeight: 600, wordBreak: "break-all" }}
                    onClick={() => {
                      setActiveRunId(r.runId);
                      hydrateRunState(r.runId);
                    }}
                  >
                    {r.runId}
                  </div>
                  <div style={{ opacity: 0.75 }}>{r.status} · steps: {r.stepCount}</div>
                  {(r.status === "running" || r.status === "waiting_checkpoint") && (
                    <button
                      onClick={() => handleCancelRun(r.runId)}
                      style={{ ...btnStyle(false), marginTop: 4, padding: "2px 6px", fontSize: 10, borderColor: "#991b1b", color: "#fca5a5" }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              ))}
            </div>
          </aside>

          {/* React Flow Canvas */}
          <div style={{ flex: 1 }}>
            <ReactFlow
              nodes={styledNodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_e, node) => {
                setSelectedId(node.id);
                setSelectedEdgeId(null);
              }}
              onEdgeClick={(_e, edge) => {
                setSelectedEdgeId(edge.id);
                setSelectedId(null);
              }}
              fitView
            >
              <Background color="#1f2937" gap={18} />
              <Controls />
              <MiniMap style={{ background: "#111827" }} />
            </ReactFlow>
          </div>

          {/* Right Inspector + HITL Checkpoint Drawer */}
          <aside style={{ width: 320, padding: 12, background: "#0f172a", borderLeft: "1px solid #1f2937", overflowY: "auto" }}>
            {pausedCheckpoint && (
              <div style={{ marginBottom: 14, padding: 10, border: "1px solid #f97316", borderRadius: 8, background: "#1c1917" }}>
                <strong style={{ color: "#fb923c" }}>HITL Checkpoint Paused</strong>
                <p style={{ fontSize: 12 }}>{pausedCheckpoint.message || pausedCheckpoint.nodeId}</p>
                <div style={{ fontSize: 11, opacity: 0.7 }}>Optional State Patch (JSON):</div>
                <textarea
                  value={checkpointPatchJson}
                  onChange={(e) => setCheckpointPatchJson(e.target.value)}
                  rows={3}
                  style={{ ...inputStyle, width: "100%", fontSize: 11 }}
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

            {selectedEdge ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11, opacity: 0.6 }}>EDGE INSPECTOR ({selectedEdge.source} → {selectedEdge.target})</div>
                <label style={labelStyle}>
                  Condition (branch name or approve/reject)
                  <input
                    value={String(selectedEdge.label || "")}
                    onChange={(e) => updateSelectedEdgeCondition(e.target.value)}
                    placeholder="leave empty for unconditional"
                    style={{ ...inputStyle, width: "100%" }}
                  />
                </label>
                <button onClick={deleteSelectedEdge} style={{ ...btnStyle(false), borderColor: "#991b1b", color: "#fca5a5" }}>
                  Delete Edge
                </button>
              </div>
            ) : selectedRaw ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, opacity: 0.6 }}>NODE INSPECTOR ({selectedRaw.type})</span>
                  <button onClick={deleteSelectedNode} style={{ ...btnStyle(false), padding: "2px 8px", borderColor: "#991b1b", color: "#fca5a5" }}>
                    Delete
                  </button>
                </div>

                <label style={labelStyle}>
                  Label
                  <input
                    value={String(selectedRaw.label || "")}
                    onChange={(e) => updateSelectedNodeField("label", e.target.value)}
                    style={{ ...inputStyle, width: "100%" }}
                  />
                </label>

                {(selectedRaw.type === "agent" || selectedRaw.type === "subagent" || selectedRaw.type === "decision" || selectedRaw.type === "skill") && (
                  <label style={labelStyle}>
                    Model Tier
                    <select
                      value={String(selectedRaw.tier || "subagent")}
                      onChange={(e) => updateSelectedNodeField("tier", e.target.value)}
                      style={{ ...inputStyle, width: "100%" }}
                    >
                      {MODEL_TIERS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                )}

                {selectedRaw.type === "subagent" && (
                  <>
                    <label style={labelStyle}>
                      Role
                      <input
                        value={String(selectedRaw.role || "")}
                        onChange={(e) => updateSelectedNodeField("role", e.target.value)}
                        style={{ ...inputStyle, width: "100%" }}
                      />
                    </label>
                    <label style={labelStyle}>
                      Skills (comma-separated, available: {skills.join(", ") || "none"})
                      <input
                        value={Array.isArray(selectedRaw.skills) ? (selectedRaw.skills as string[]).join(", ") : ""}
                        onChange={(e) =>
                          updateSelectedNodeField(
                            "skills",
                            e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                          )
                        }
                        style={{ ...inputStyle, width: "100%" }}
                      />
                    </label>
                  </>
                )}

                {selectedRaw.type === "skill" && (
                  <label style={labelStyle}>
                    Skill Name
                    <select
                      value={String(selectedRaw.skillName || "")}
                      onChange={(e) => updateSelectedNodeField("skillName", e.target.value)}
                      style={{ ...inputStyle, width: "100%" }}
                    >
                      {skills.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                )}

                {selectedRaw.type === "decision" && (
                  <label style={labelStyle}>
                    Branches (comma-separated)
                    <input
                      value={Array.isArray(selectedRaw.branches) ? (selectedRaw.branches as string[]).join(", ") : ""}
                      onChange={(e) =>
                        updateSelectedNodeField(
                          "branches",
                          e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                        )
                      }
                      style={{ ...inputStyle, width: "100%" }}
                    />
                  </label>
                )}

                {selectedRaw.type === "tool" && (
                  <>
                    <label style={labelStyle}>
                      Tool Kind
                      <select
                        value={String(selectedRaw.toolKind || "shell")}
                        onChange={(e) => updateSelectedNodeField("toolKind", e.target.value)}
                        style={{ ...inputStyle, width: "100%" }}
                      >
                        <option value="shell">shell</option>
                        <option value="http">http</option>
                        <option value="yue2">yue2</option>
                      </select>
                    </label>
                    <label style={labelStyle}>
                      Command or URL
                      <input
                        value={String(selectedRaw.commandOrUrl || "")}
                        onChange={(e) => updateSelectedNodeField("commandOrUrl", e.target.value)}
                        style={{ ...inputStyle, width: "100%" }}
                      />
                    </label>
                    <label style={labelStyle}>
                      Body Template (optional JSON)
                      <textarea
                        rows={3}
                        value={String(selectedRaw.bodyTemplate || "")}
                        onChange={(e) => updateSelectedNodeField("bodyTemplate", e.target.value)}
                        style={{ ...inputStyle, width: "100%" }}
                      />
                    </label>
                  </>
                )}

                {selectedRaw.type === "checkpoint" && (
                  <>
                    <label style={labelStyle}>
                      Checkpoint Message
                      <textarea
                        rows={3}
                        value={String(selectedRaw.message || "")}
                        onChange={(e) => updateSelectedNodeField("message", e.target.value)}
                        style={{ ...inputStyle, width: "100%" }}
                      />
                    </label>
                    <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedRaw.allowStateEdit !== false}
                        onChange={(e) => updateSelectedNodeField("allowStateEdit", e.target.checked)}
                      />
                      Allow state patch on approve
                    </label>
                  </>
                )}

                {selectedRaw.type === "memory" && (
                  <>
                    <label style={labelStyle}>
                      Operation
                      <select
                        value={String(selectedRaw.operation || "search")}
                        onChange={(e) => updateSelectedNodeField("operation", e.target.value)}
                        style={{ ...inputStyle, width: "100%" }}
                      >
                        <option value="search">search</option>
                        <option value="save">save</option>
                        <option value="consolidate">consolidate</option>
                      </select>
                    </label>
                    <label style={labelStyle}>
                      Scope
                      <select
                        value={String(selectedRaw.scope || "both")}
                        onChange={(e) => updateSelectedNodeField("scope", e.target.value)}
                        style={{ ...inputStyle, width: "100%" }}
                      >
                        <option value="both">both</option>
                        <option value="project">project</option>
                        <option value="global">global</option>
                      </select>
                    </label>
                    <label style={labelStyle}>
                      Query or Title Template
                      <input
                        value={String(selectedRaw.queryOrTitleTemplate || "")}
                        onChange={(e) => updateSelectedNodeField("queryOrTitleTemplate", e.target.value)}
                        style={{ ...inputStyle, width: "100%" }}
                      />
                    </label>
                    {selectedRaw.operation === "save" && (
                      <label style={labelStyle}>
                        Content Template
                        <textarea
                          rows={3}
                          value={String(selectedRaw.contentTemplate || "")}
                          onChange={(e) => updateSelectedNodeField("contentTemplate", e.target.value)}
                          style={{ ...inputStyle, width: "100%" }}
                        />
                      </label>
                    )}
                  </>
                )}

                {(selectedRaw.type === "agent" || selectedRaw.type === "subagent" || selectedRaw.type === "decision" || selectedRaw.type === "skill") && (
                  <label style={labelStyle}>
                    Prompt Template
                    <textarea
                      rows={4}
                      value={String(selectedRaw.promptTemplate || "")}
                      onChange={(e) => updateSelectedNodeField("promptTemplate", e.target.value)}
                      style={{ ...inputStyle, width: "100%" }}
                    />
                  </label>
                )}

                {selectedRaw.type !== "checkpoint" && (
                  <label style={labelStyle}>
                    Output Key
                    <input
                      value={String(selectedRaw.outputKey || "")}
                      onChange={(e) => updateSelectedNodeField("outputKey", e.target.value)}
                      style={{ ...inputStyle, width: "100%" }}
                    />
                  </label>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 12, opacity: 0.6 }}>Click any node or edge on the canvas to edit its configuration.</div>
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
              style={{ ...inputStyle, flex: 1 }}
            />
            <select
              value={memScope}
              onChange={(e) => setMemScope(e.target.value as "both" | "project" | "global")}
              style={inputStyle}
            >
              <option value="both">Both Scopes</option>
              <option value="project">Project (.pi/memory)</option>
              <option value="global">Global (~/.sosho/memory)</option>
            </select>
            <button onClick={loadMemories} style={btnStyle(true)}>Search</button>
            <button
              onClick={async () => {
                await fetch("/api/memory/consolidate", {
                  method: "POST",
                  headers: getAuthHeaders(),
                });
                loadMemories();
                setStatusBanner("Consolidated memory inbox & refreshed profiles.");
              }}
              style={btnStyle(false)}
            >
              Consolidate Inbox
            </button>
          </div>

          {/* Create Memory Form */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14, padding: 10, background: "#111827", borderRadius: 8, border: "1px solid #1f2937", flexWrap: "wrap" }}>
            <select value={newMemScope} onChange={(e) => setNewMemScope(e.target.value as "project" | "global")} style={inputStyle}>
              <option value="project">project</option>
              <option value="global">global</option>
            </select>
            <select value={newMemType} onChange={(e) => setNewMemType(e.target.value as "semantic" | "procedural" | "episodic" | "entity")} style={inputStyle}>
              <option value="semantic">semantic</option>
              <option value="procedural">procedural</option>
              <option value="episodic">episodic</option>
              <option value="entity">entity</option>
            </select>
            <input
              value={newMemTitle}
              onChange={(e) => setNewMemTitle(e.target.value)}
              placeholder="Title"
              style={{ ...inputStyle, width: 200 }}
            />
            <input
              value={newMemContent}
              onChange={(e) => setNewMemContent(e.target.value)}
              placeholder="Durable memory content..."
              style={{ ...inputStyle, flex: 1, minWidth: 220 }}
            />
            <button onClick={handleCreateMemory} style={{ ...btnStyle(true), background: "#10b981" }}>Add Memory</button>
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
              <div key={String(m.id)} style={{ background: "#111827", padding: 10, borderRadius: 8, border: "1px solid #1f2937", display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    [{String(m.id)}] {String(m.title)}{" "}
                    <span style={{ fontWeight: 400, opacity: 0.7 }}>
                      ({String(m.scope)}/{String(m.type)})
                    </span>
                  </div>
                  <div style={{ fontSize: 12, marginTop: 4, opacity: 0.9 }}>{String(m.content)}</div>
                </div>
                <button
                  onClick={() => handleArchiveMemory(String(m.id), String(m.scope || "project"))}
                  style={{ ...btnStyle(false), alignSelf: "flex-start", borderColor: "#991b1b", color: "#fca5a5" }}
                >
                  Archive
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  background: "#111827",
  color: "#fff",
  border: "1px solid #374151",
  borderRadius: 6,
  padding: "5px 8px",
  fontSize: 12,
} as const;

const labelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 11,
  color: "#cbd5e1",
} as const;

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
