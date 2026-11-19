import { useCallback, useEffect, useState } from "react";
import { apiJson, getStoredToken, setStoredToken } from "./api";
import { MemoryTab } from "./components/MemoryTab";
import { MusicTab } from "./components/MusicTab";
import { OverviewTab } from "./components/OverviewTab";
import { WorkflowsTab } from "./components/WorkflowsTab";
import type { RunSummary, SystemStatusResponse, WorkflowSummary, WorkspaceTab } from "./types";

function getInitialRunId(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("runId");
  if (fromUrl) return fromUrl;
  return window.localStorage.getItem("sosho_active_run_id");
}

function persistRunId(runId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (runId) {
    window.localStorage.setItem("sosho_active_run_id", runId);
    url.searchParams.set("runId", runId);
  } else {
    window.localStorage.removeItem("sosho_active_run_id");
    url.searchParams.delete("runId");
  }
  window.history.replaceState({}, "", url.toString());
}

export default function App() {
  const initialRun = getInitialRunId();
  const [tab, setTab] = useState<WorkspaceTab>(initialRun ? "workflows" : "overview");
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [system, setSystem] = useState<SystemStatusResponse | null>(null);
  const [activeRunId, setActiveRunIdState] = useState<string | null>(initialRun);
  const [toast, setToast] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [tokenInput, setTokenInput] = useState(() => getStoredToken());

  const setActiveRunId = useCallback((runId: string | null) => {
    setActiveRunIdState(runId);
    persistRunId(runId);
  }, []);

  const refreshWorkflows = useCallback(async () => {
    const res = await apiJson<{ workflows?: WorkflowSummary[] }>("/api/workflows");
    const list = res.data.workflows || [];
    setWorkflows(list);
    return list;
  }, []);

  const refreshRuns = useCallback(async () => {
    const res = await apiJson<{ runs?: RunSummary[] }>("/api/runs?limit=25");
    if (res.ok && res.data.runs) setRuns(res.data.runs);
  }, []);

  const refreshSystem = useCallback(async () => {
    const res = await apiJson<SystemStatusResponse>("/api/system/status");
    if (res.ok) setSystem(res.data);
  }, []);

  useEffect(() => {
    refreshWorkflows();
    refreshRuns();
    refreshSystem();
  }, [refreshRuns, refreshSystem, refreshWorkflows]);

  const healthyCount = system?.services.filter((s) => s.ok).length ?? 0;
  const totalCount = system?.services.length ?? 0;

  return (
    <div className="studio-shell">
      {/* Top Bar */}
      <header className="studio-header">
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div className="brand" style={{ cursor: "pointer" }} onClick={() => setTab("overview")}>
            <span className="brand-mark">S</span>
            <span>Sosho Studio</span>
          </div>

          <nav className="nav-tabs">
            {(["overview", "workflows", "memory", "music"] as WorkspaceTab[]).map((t) => (
              <button
                key={t}
                className={`nav-tab ${tab === t ? "active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t === "overview"
                  ? "Overview"
                  : t === "workflows"
                    ? "Workflows"
                    : t === "memory"
                      ? "Memory"
                      : "Music"}
              </button>
            ))}
          </nav>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
          <button
            className={`pill ${totalCount > 0 && healthyCount === totalCount ? "pill-ok" : "pill-warn"}`}
            style={{ cursor: "pointer" }}
            onClick={() => {
              setTab("overview");
              refreshSystem();
            }}
          >
            <span
              className="dot"
              style={{ background: totalCount > 0 && healthyCount === totalCount ? "#10b981" : "#f59e0b" }}
            />
            {totalCount > 0 ? `${healthyCount}/${totalCount} Services` : "Checking..."}
          </button>

          <a
            href="http://127.0.0.1:3000"
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm"
            style={{ textDecoration: "none" }}
          >
            Langfuse ↗
          </a>

          <button className="btn btn-sm" onClick={() => setShowSettings((v) => !v)}>
            Auth
          </button>

          {showSettings && (
            <div
              className="card"
              style={{
                position: "absolute",
                top: 42,
                right: 0,
                width: 280,
                zIndex: 50,
                boxShadow: "0 12px 32px rgba(0,0,0,0.65)",
              }}
            >
              <div className="section-title" style={{ marginBottom: 8 }}>Studio API Bearer Token</div>
              <input
                type="password"
                className="input"
                value={tokenInput}
                onChange={(e) => {
                  setTokenInput(e.target.value);
                  setStoredToken(e.target.value);
                }}
                placeholder="SOSHO_STUDIO_TOKEN"
              />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                Auto-loaded from <code>.env</code> in local dev mode. Saved in browser storage if overridden.
              </div>
            </div>
          )}
        </div>
      </header>

      {toast && (
        <div className="toast-bar">
          <span>{toast}</span>
          <button
            className="btn btn-sm"
            style={{ padding: "1px 6px", fontSize: 10.5 }}
            onClick={() => setToast("")}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Active Workspace */}
      {tab === "overview" && (
        <OverviewTab
          system={system}
          runs={runs}
          workflowCount={workflows.length}
          onRefreshSystem={refreshSystem}
          onNavigate={setTab}
          onOpenRun={(runId) => {
            setActiveRunId(runId);
            setTab("workflows");
          }}
        />
      )}

      {tab === "workflows" && (
        <WorkflowsTab
          workflows={workflows}
          skills={system?.skills || []}
          runs={runs}
          activeRunId={activeRunId}
          onSelectRunId={setActiveRunId}
          onRefreshWorkflows={refreshWorkflows}
          onRefreshRuns={refreshRuns}
          onStatus={setToast}
        />
      )}

      {tab === "memory" && <MemoryTab onStatus={setToast} />}
      {tab === "music" && <MusicTab onStatus={setToast} />}
    </div>
  );
}
