import { useCallback, useEffect, useState } from "react";
import { apiJson, authHeaders } from "../api";
import type { MemoryItem } from "../types";

interface MemoryTabProps {
  onStatus: (msg: string) => void;
}

export function MemoryTab({ onStatus }: MemoryTabProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"both" | "project" | "global">("both");
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [profiles, setProfiles] = useState<{ global: string; project: string }>({ global: "", project: "" });
  const [showCreate, setShowCreate] = useState(false);

  const [newScope, setNewScope] = useState<"project" | "global">("project");
  const [newType, setNewType] = useState<"semantic" | "procedural" | "episodic" | "entity">("semantic");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newTags, setNewTags] = useState("");

  const loadMemories = useCallback(async () => {
    const res = await apiJson<{ items?: MemoryItem[]; profiles?: { global: string; project: string } }>(
      `/api/memory?scope=${scope}&q=${encodeURIComponent(query)}`,
    );
    if (!res.ok) {
      onStatus(`Memory load failed: ${res.data.error || res.status}`);
      return;
    }
    setItems(res.data.items || []);
    if (res.data.profiles) setProfiles(res.data.profiles);
  }, [onStatus, query, scope]);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  const handleCreate = async () => {
    if (!newTitle.trim() || !newContent.trim()) {
      onStatus("Enter both a title and content to save a memory.");
      return;
    }
    const res = await apiJson("/api/memory", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        scope: newScope,
        type: newType,
        title: newTitle.trim(),
        content: newContent.trim(),
        tags: newTags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    });
    if (res.ok) {
      setNewTitle("");
      setNewContent("");
      setNewTags("");
      setShowCreate(false);
      onStatus("Saved memory record and refreshed core profile.");
      loadMemories();
    } else {
      onStatus(`Save failed (${res.status}): ${res.data.error || "Check API token"}`);
    }
  };

  const handleArchive = async (id: string, itemScope: string) => {
    const res = await apiJson(`/api/memory/${encodeURIComponent(id)}?scope=${encodeURIComponent(itemScope)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.ok) {
      onStatus(`Archived memory ${id}`);
      loadMemories();
    } else {
      onStatus(`Archive failed (${res.status}): ${res.data.error || "Check API token"}`);
    }
  };

  const handleConsolidate = async () => {
    const res = await apiJson<{ counts?: Record<string, number> }>("/api/memory/consolidate", {
      method: "POST",
      headers: authHeaders(),
    });
    if (res.ok) {
      onStatus(`Consolidated inbox: ${JSON.stringify(res.data.counts || {})}`);
      loadMemories();
    } else {
      onStatus(`Consolidate failed (${res.status}): ${res.data.error || "Check API token"}`);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px", maxWidth: 1200, width: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Two-Tier Memory Explorer</div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2 }}>
            Hybrid FTS5 + embeddinggemma vectors + 1-hop entity graph across Global (~/.sosho/memory) and Project (.pi/memory).
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={handleConsolidate}>Consolidate Inbox</button>
          <button className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Close Form" : "+ New Memory"}
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && loadMemories()}
          placeholder="Search memories by keyword, concept, or entity..."
          style={{ flex: 1 }}
        />
        <select
          className="select"
          value={scope}
          onChange={(e) => setScope(e.target.value as "both" | "project" | "global")}
          style={{ width: 170 }}
        >
          <option value="both">Both Scopes</option>
          <option value="project">Project Only</option>
          <option value="global">Global Only</option>
        </select>
        <button className="btn btn-primary" onClick={loadMemories}>Search</button>
      </div>

      {/* Collapsible Create Form */}
      {showCreate && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--accent)" }}>
          <div className="section-title" style={{ marginBottom: 10 }}>Create Durable Memory</div>
          <div style={{ display: "grid", gridTemplateColumns: "150px 150px 1fr", gap: 10, marginBottom: 10 }}>
            <label className="field-label">
              Scope
              <select className="select" value={newScope} onChange={(e) => setNewScope(e.target.value as "project" | "global")}>
                <option value="project">Project</option>
                <option value="global">Global</option>
              </select>
            </label>
            <label className="field-label">
              Type
              <select className="select" value={newType} onChange={(e) => setNewType(e.target.value as "semantic" | "procedural" | "episodic" | "entity")}>
                <option value="semantic">semantic</option>
                <option value="procedural">procedural</option>
                <option value="episodic">episodic</option>
                <option value="entity">entity</option>
              </select>
            </label>
            <label className="field-label">
              Title
              <input className="input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Short descriptive title" />
            </label>
          </div>
          <label className="field-label" style={{ marginBottom: 10 }}>
            Content (secrets are automatically redacted in both scopes)
            <textarea className="textarea" rows={3} value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Durable rule, architecture fact, or preference..." />
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <label className="field-label" style={{ flex: 1 }}>
              Tags (comma-separated)
              <input className="input" value={newTags} onChange={(e) => setNewTags(e.target.value)} placeholder="gpu, sqlite, architecture" />
            </label>
            <button className="btn btn-emerald" onClick={handleCreate}>Save Memory</button>
          </div>
        </div>
      )}

      {/* Core Profiles */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
        <div className="card">
          <div className="section-title" style={{ marginBottom: 8 }}>Global Core Profile</div>
          <pre className="mono-pre" style={{ maxHeight: 150, overflowY: "auto" }}>{profiles.global || "(empty)"}</pre>
        </div>
        <div className="card">
          <div className="section-title" style={{ marginBottom: 8 }}>Project Core Profile</div>
          <pre className="mono-pre" style={{ maxHeight: 150, overflowY: "auto" }}>{profiles.project || "(empty)"}</pre>
        </div>
      </div>

      {/* Records List */}
      <div className="section-title" style={{ marginBottom: 10 }}>Active Records ({items.length})</div>
      {items.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>
          No matching active memories found. Click <strong>+ New Memory</strong> or run a workflow to store durable knowledge.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((m) => (
            <div key={m.id} className="card" style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{m.title}</span>
                  <span className={`pill ${m.scope === "global" ? "pill-info" : "pill-ok"}`}>{m.scope}</span>
                  <span className="pill">{m.type}</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{m.id}</span>
                  {typeof m.access_count === "number" && (
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>recalls: {m.access_count}</span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: "#d4d4d8", marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {m.content}
                </div>
                {m.tags && m.tags.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {m.tags.map((t) => (
                      <span key={t} className="pill" style={{ fontSize: 10.5 }}>#{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <button className="btn btn-danger btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => handleArchive(m.id, m.scope)}>
                Archive
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
