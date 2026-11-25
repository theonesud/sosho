"use client";

import { Archive, Database, GitBranch, Inbox, List, Plus, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MemoryGraphView } from "./MemoryGraphView";
import type { MemoryQueryResponse, MemoryRecord, MemoryScope, MemoryType } from "./types";

const MEMORY_TYPES: MemoryType[] = ["semantic", "procedural", "episodic", "entity"];

function parseCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function ScoreBar({ label, value, colorClass }: { label: string; value?: number; colorClass: string }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums">
      <span className="w-12 text-text-muted">{label}</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-canvas border border-border-subtle">
        <div className={`h-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-text-secondary">{value.toFixed(2)}</span>
    </div>
  );
}

export function MemoryWorkspace() {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"both" | MemoryScope>("both");
  const [selectedTypes, setSelectedTypes] = useState<MemoryType[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "graph">("list");

  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [profiles, setProfiles] = useState<{ global: string; project: string }>({ global: "", project: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline + New Memory drawer state
  const [newDrawerOpen, setNewDrawerOpen] = useState(false);
  const [newScope, setNewScope] = useState<MemoryScope>("project");
  const [newType, setNewType] = useState<MemoryType>("semantic");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newTags, setNewTags] = useState("");
  const [newEntities, setNewEntities] = useState("");
  const [newImportance, setNewImportance] = useState("0.75");
  const [creating, setCreating] = useState(false);

  // Inline supersede state
  const [supersedeId, setSupersedeId] = useState<string | null>(null);
  const [supTitle, setSupTitle] = useState("");
  const [supContent, setSupContent] = useState("");
  const [supTags, setSupTags] = useState("");
  const [supEntities, setSupEntities] = useState("");
  const [supType, setSupType] = useState<MemoryType>("semantic");
  const [supScope, setSupScope] = useState<MemoryScope>("project");
  const [supSaving, setSupSaving] = useState(false);

  // Inline archive state
  const [archiveTargetId, setArchiveTargetId] = useState<string | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiving, setArchiving] = useState(false);

  // Consolidate inbox state
  const [consolidating, setConsolidating] = useState(false);
  const [consolidateNote, setConsolidateNote] = useState<string | null>(null);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      params.set("scope", scope);
      if (selectedTypes.length > 0) params.set("types", selectedTypes.join(","));
      if (includeArchived) params.set("includeArchived", "true");
      params.set("limit", "50");

      const res = await fetch(`/api/memory?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as MemoryQueryResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setProfiles(data.profiles ?? { global: "", project: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [query, scope, selectedTypes, includeArchived]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchMemories();
    }, 150);
    return () => clearTimeout(timer);
  }, [fetchMemories]);

  const toggleType = (t: MemoryType) => {
    setSelectedTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: newScope,
          type: newType,
          title: newTitle.trim(),
          content: newContent,
          tags: parseCsv(newTags),
          entities: parseCsv(newEntities),
          importance: Number(newImportance) || 0.75,
        }),
      });
      if (!res.ok) throw new Error(`Create failed (HTTP ${res.status})`);
      setNewTitle("");
      setNewContent("");
      setNewTags("");
      setNewEntities("");
      setNewDrawerOpen(false);
      await fetchMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const openSupersede = (item: MemoryRecord) => {
    setSupersedeId(item.id);
    setSupScope(item.scope);
    setSupType(item.type);
    setSupTitle(item.title);
    setSupContent(item.content);
    setSupTags((item.tags ?? []).join(", "));
    setSupEntities((item.entities ?? []).join(", "));
    setArchiveTargetId(null);
  };

  const handleSupersede = async (id: string) => {
    if (!supTitle.trim()) return;
    setSupSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(id)}/supersede`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: supScope,
          type: supType,
          title: supTitle.trim(),
          content: supContent,
          tags: parseCsv(supTags),
          entities: parseCsv(supEntities),
          importance: 0.8,
        }),
      });
      if (!res.ok) throw new Error(`Supersede failed (HTTP ${res.status})`);
      setSupersedeId(null);
      await fetchMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSupSaving(false);
    }
  };

  const handleArchive = async (item: MemoryRecord) => {
    setArchiving(true);
    setError(null);
    try {
      const params = new URLSearchParams({ scope: item.scope });
      if (archiveReason.trim()) params.set("reason", archiveReason.trim());
      const res = await fetch(`/api/memory/${encodeURIComponent(item.id)}?${params.toString()}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Archive failed (HTTP ${res.status})`);
      setArchiveTargetId(null);
      setArchiveReason("");
      await fetchMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setArchiving(false);
    }
  };

  const handleConsolidate = async () => {
    setConsolidating(true);
    setConsolidateNote(null);
    setError(null);
    try {
      const res = await fetch("/api/memory/consolidate", { method: "POST" });
      if (!res.ok) throw new Error(`Consolidate failed (HTTP ${res.status})`);
      const data = (await res.json()) as { counts?: { project?: number; global?: number } };
      const p = data.counts?.project ?? 0;
      const g = data.counts?.global ?? 0;
      setConsolidateNote(`Consolidated ${p} project, ${g} global`);
      await fetchMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConsolidating(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-canvas">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-accent" />
          <h1 className="text-[14px] font-semibold text-text-primary">Memory</h1>
          <Badge variant="neutral">{items.length} records</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {consolidateNote && <Badge variant="accent">{consolidateNote}</Badge>}
          <Button variant="secondary" size="sm" onClick={handleConsolidate} disabled={consolidating}>
            <Inbox className="h-3.5 w-3.5" />
            {consolidating ? "Consolidating..." : "Consolidate Inbox"}
          </Button>
          <Button
            variant={newDrawerOpen ? "secondary" : "primary"}
            size="sm"
            onClick={() => setNewDrawerOpen((v) => !v)}
          >
            {newDrawerOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {newDrawerOpen ? "Close" : "New Memory"}
          </Button>
        </div>
      </div>

      {/* Search & Filters Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-surface/60 px-4 py-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hybrid search (lexical + vector + entity graph)..."
            className="pl-8"
          />
        </div>

        <div className="inline-flex h-8 items-center rounded-md border border-border-subtle bg-canvas p-0.5">
          {(["both", "project", "global"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`rounded px-2 py-1 text-[11px] font-medium capitalize transition-colors cursor-pointer ${
                scope === s ? "bg-elevated text-text-primary" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {MEMORY_TYPES.map((t) => {
            const active = selectedTypes.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                className={`rounded border px-2 py-1 text-[11px] font-medium capitalize transition-colors cursor-pointer ${
                  active
                    ? "border-accent/40 bg-accent/15 text-emerald-300"
                    : "border-border-subtle bg-canvas text-text-muted hover:text-text-secondary"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="h-3.5 w-3.5 accent-emerald-500"
          />
          Archived
        </label>

        <div className="ml-auto inline-flex h-8 items-center rounded-md border border-border-subtle bg-canvas p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
              viewMode === "list" ? "bg-elevated text-text-primary" : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <List className="h-3 w-3" />
            List
          </button>
          <button
            type="button"
            onClick={() => setViewMode("graph")}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
              viewMode === "graph" ? "bg-elevated text-text-primary" : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <GitBranch className="h-3 w-3" />
            Graph
          </button>
        </div>

        <Button variant="ghost" size="icon" onClick={() => void fetchMemories()} title="Refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Main Split Area */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_340px]">
        {/* Left Main Stage */}
        <div className="min-h-0 overflow-y-auto p-4 space-y-3">
          {error && (
            <div className="rounded-md border border-error/35 bg-error/10 px-3 py-2 text-[12px] text-red-300">
              {error}
            </div>
          )}

          {/* Inline + New Memory Drawer */}
          {newDrawerOpen && (
            <form
              onSubmit={handleCreate}
              className="rounded-md border border-border-strong bg-elevated p-3.5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-text-primary">New Memory</span>
                <div className="flex items-center gap-2">
                  <select
                    value={newScope}
                    onChange={(e) => setNewScope(e.target.value as MemoryScope)}
                    className="h-7 rounded border border-border-subtle bg-canvas px-2 text-[11px] text-text-primary"
                  >
                    <option value="project">project</option>
                    <option value="global">global</option>
                  </select>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as MemoryType)}
                    className="h-7 rounded border border-border-subtle bg-canvas px-2 text-[11px] text-text-primary"
                  >
                    {MEMORY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Memory title"
                required
              />
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Memory content..."
                rows={3}
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Input
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="Tags (comma-separated)"
                />
                <Input
                  value={newEntities}
                  onChange={(e) => setNewEntities(e.target.value)}
                  placeholder="Entities (comma-separated)"
                />
                <Input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={newImportance}
                  onChange={(e) => setNewImportance(e.target.value)}
                  placeholder="Importance (0-1)"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setNewDrawerOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" disabled={creating || !newTitle.trim()}>
                  {creating ? "Saving..." : "Save Memory"}
                </Button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="space-y-2.5">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : viewMode === "graph" ? (
            <MemoryGraphView
              items={items}
              onSelectMemory={(m) => {
                setViewMode("list");
                openSupersede(m);
              }}
            />
          ) : items.length === 0 ? (
            <div className="rounded-md border border-border-subtle bg-surface p-8 text-center">
              <p className="text-[13px] font-medium text-text-primary">No matching memories</p>
              <p className="mt-1 text-[12px] text-text-muted">
                Adjust your filters or click New Memory to record a project or global fact.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {items.map((item) => {
                const isSuperseding = supersedeId === item.id;
                const isArchiving = archiveTargetId === item.id;
                const hasScores = typeof item.score === "number";

                return (
                  <div
                    key={`${item.scope}:${item.id}`}
                    className={`rounded-md border border-border-subtle bg-elevated p-3 transition-colors hover:border-border-strong ${
                      item.archived ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-semibold text-text-primary">{item.title}</span>
                          <Badge variant={item.scope === "project" ? "accent" : "info"}>{item.scope}</Badge>
                          <Badge variant="neutral">{item.type}</Badge>
                          {item.archived && <Badge variant="warning">archived</Badge>}
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-text-secondary">
                          {item.content}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => (isSuperseding ? setSupersedeId(null) : openSupersede(item))}
                        >
                          <Sparkles className="h-3 w-3" />
                          Supersede
                        </Button>
                        {!item.archived && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                              setArchiveTargetId(isArchiving ? null : item.id);
                              setSupersedeId(null);
                            }}
                          >
                            <Archive className="h-3 w-3" />
                            Archive
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Tags & Entities */}
                    {((item.tags && item.tags.length > 0) || (item.entities && item.entities.length > 0)) && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {item.tags?.map((tag) => (
                          <span
                            key={`t:${tag}`}
                            className="rounded bg-canvas px-1.5 py-0.5 text-[11px] font-mono text-text-muted border border-border-subtle"
                          >
                            #{tag}
                          </span>
                        ))}
                        {item.entities?.map((ent) => (
                          <span
                            key={`e:${ent}`}
                            className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-mono text-emerald-300 border border-accent/25"
                          >
                            @{ent}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Hybrid Search Score Breakdown */}
                    {hasScores && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-subtle pt-2">
                        <ScoreBar label="score" value={item.score} colorClass="bg-accent" />
                        <ScoreBar label="lexical" value={item.lexicalScore} colorClass="bg-info" />
                        <ScoreBar label="vector" value={item.vectorScore} colorClass="bg-violet-400" />
                        <ScoreBar label="graph" value={item.graphBoost} colorClass="bg-warning" />
                      </div>
                    )}

                    {/* Inline Archive Bar */}
                    {isArchiving && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2.5">
                        <Input
                          value={archiveReason}
                          onChange={(e) => setArchiveReason(e.target.value)}
                          placeholder="Optional archive reason..."
                          className="h-7 flex-1 text-[11px]"
                        />
                        <Button
                          variant="danger"
                          size="xs"
                          disabled={archiving}
                          onClick={() => void handleArchive(item)}
                        >
                          {archiving ? "Archiving..." : "Confirm Archive"}
                        </Button>
                        <Button variant="ghost" size="xs" onClick={() => setArchiveTargetId(null)}>
                          Cancel
                        </Button>
                      </div>
                    )}

                    {/* Inline Supersede Editor */}
                    {isSuperseding && (
                      <div className="mt-2.5 space-y-2 border-t border-border-subtle pt-2.5">
                        <div className="text-[11px] font-medium text-text-muted">
                          Supersede <span className="font-mono text-text-secondary">{item.id}</span>
                        </div>
                        <Input
                          value={supTitle}
                          onChange={(e) => setSupTitle(e.target.value)}
                          placeholder="Updated title"
                        />
                        <Textarea
                          value={supContent}
                          onChange={(e) => setSupContent(e.target.value)}
                          rows={3}
                          placeholder="Updated content"
                        />
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <Input
                            value={supTags}
                            onChange={(e) => setSupTags(e.target.value)}
                            placeholder="Tags (comma-separated)"
                          />
                          <Input
                            value={supEntities}
                            onChange={(e) => setSupEntities(e.target.value)}
                            placeholder="Entities (comma-separated)"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="xs" onClick={() => setSupersedeId(null)}>
                            Cancel
                          </Button>
                          <Button
                            variant="primary"
                            size="xs"
                            disabled={supSaving || !supTitle.trim()}
                            onClick={() => void handleSupersede(item.id)}
                          >
                            {supSaving ? "Saving..." : "Save Superseding Memory"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Sidebar: Core Profiles */}
        <aside className="flex min-h-0 flex-col border-t border-border-subtle bg-surface p-3.5 lg:border-l lg:border-t-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[12px] font-semibold text-text-primary">Core Profile</h2>
            <span className="text-[11px] text-text-muted">Read-only summary</span>
          </div>
          <Tabs defaultValue="project" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="w-full">
              <TabsTrigger value="project" className="flex-1">
                Project
              </TabsTrigger>
              <TabsTrigger value="global" className="flex-1">
                Global
              </TabsTrigger>
            </TabsList>
            <TabsContent value="project" className="min-h-0 flex-1 overflow-y-auto">
              <pre className="whitespace-pre-wrap rounded-md border border-border-subtle bg-canvas p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
                {profiles.project?.trim() || "No project core profile generated yet."}
              </pre>
            </TabsContent>
            <TabsContent value="global" className="min-h-0 flex-1 overflow-y-auto">
              <pre className="whitespace-pre-wrap rounded-md border border-border-subtle bg-canvas p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
                {profiles.global?.trim() || "No global core profile generated yet."}
              </pre>
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}
