import type { RunSummary, SystemStatusResponse, WorkspaceTab } from "../types";

interface OverviewTabProps {
  system: SystemStatusResponse | null;
  runs: RunSummary[];
  workflowCount: number;
  onRefreshSystem: () => void;
  onNavigate: (tab: WorkspaceTab) => void;
  onOpenRun: (runId: string) => void;
}

export function OverviewTab({
  system,
  runs,
  workflowCount,
  onRefreshSystem,
  onNavigate,
  onOpenRun,
}: OverviewTabProps) {
  const services = system?.services || [];
  const roles = Object.entries(system?.roles || {});
  const skills = system?.skills || [];
  const healthyCount = services.filter((s) => s.ok).length;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", maxWidth: 1240, width: "100%", margin: "0 auto" }}>
      {/* Hero Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Sosho Control Plane</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
            Local-first AI workflows, hybrid two-tier memory, multi-model routing, and YuE2 audio synthesis.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={onRefreshSystem}>Refresh Health</button>
          <button className="btn btn-primary" onClick={() => onNavigate("workflows")}>Open Workflows</button>
        </div>
      </div>

      {/* Quick Start Actions */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 24 }}>
        <div className="card" style={{ cursor: "pointer" }} onClick={() => onNavigate("workflows")}>
          <div className="section-title" style={{ color: "#818cf8" }}>Workflows ({workflowCount})</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }}>Run &amp; Edit DAG Pipelines</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
            Execute parallel agent graphs, inspect full outputs, and review HITL checkpoints.
          </div>
        </div>

        <div className="card" style={{ cursor: "pointer" }} onClick={() => onNavigate("memory")}>
          <div className="section-title" style={{ color: "#f472b6" }}>Two-Tier Memory</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }}>Search &amp; Curate Knowledge</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
            Hybrid FTS5 + embeddinggemma vectors + entity graph across Global and Project scopes.
          </div>
        </div>

        <div className="card" style={{ cursor: "pointer" }} onClick={() => onNavigate("music")}>
          <div className="section-title" style={{ color: "#34d399" }}>YuE2 Music Studio</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }}>Generate Local Audio Tracks</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
            Compose songs with style tags and lyrics. Automatically unloads GPU LLM during synthesis.
          </div>
        </div>

        <a
          href="http://127.0.0.1:3000"
          target="_blank"
          rel="noreferrer"
          className="card"
          style={{ textDecoration: "none", color: "inherit", display: "block" }}
        >
          <div className="section-title" style={{ color: "#38bdf8" }}>Observability</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }}>Langfuse Traces :3000 ↗</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
            Inspect every LLM generation, latency, token count, and nested subagent trace.
          </div>
        </a>
      </div>

      {/* Live Services Grid */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span className="section-title">Live Services ({healthyCount}/{services.length} Healthy)</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
          {services.map((s) => (
            <a
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="card"
              style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px" }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 2 }}>{s.detail}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span className={`pill ${s.ok ? "pill-ok" : "pill-err"}`}>
                  <span className="dot" style={{ background: s.ok ? "#10b981" : "#ef4444" }} />
                  {s.ok ? "Online" : "Offline"}
                </span>
                {s.ok && <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{s.latencyMs}ms</span>}
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Bottom Two Columns: Recent Runs + Model Tiers & Skills */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span className="section-title">Recent Workflow Runs</span>
            <button className="btn btn-sm" onClick={() => onNavigate("workflows")}>View Canvas</button>
          </div>
          {runs.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "12px 0" }}>
              No workflow runs yet. Open Workflows and click Run Workflow to start one.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {runs.slice(0, 6).map((r) => (
                <div
                  key={r.runId}
                  onClick={() => onOpenRun(r.runId)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "9px 11px",
                    borderRadius: 8,
                    background: "var(--bg-canvas)",
                    border: "1px solid var(--border)",
                    cursor: "pointer",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.graphId}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{r.runId} · {r.stepCount} steps</div>
                  </div>
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
                  >
                    {r.status === "waiting_checkpoint" ? "Needs Review" : r.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <div className="section-title" style={{ marginBottom: 10 }}>Model Role Tiers (.pi/model-roles.json)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {roles.map(([role, cfg]) => (
                <div key={role} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, gap: 8 }}>
                  <span style={{ fontWeight: 600, color: "#c7d2fe" }}>{role}</span>
                  <span style={{ color: "var(--text-secondary)", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {cfg.provider} / {cfg.model}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="section-title" style={{ marginBottom: 10 }}>Installed Skills ({skills.length})</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {skills.map((sk) => (
                <span key={sk} className="pill">{sk}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
