import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createEntityGraphState, expandOneHopEntities, loadScopeEntities } from "./entities.ts";
import { buildFtsQuery, closeMemoryIndexes, computeDecay, rowToMemoryRecord, runTx, type SqliteDb, syncScopeIndex } from "./fts.ts";
import {
  appendAudit,
  atomicWriteFileSync,
  ensureMemoryDirs,
  getGlobalMemoryRoot,
  getProjectMemoryRoot,
  getScopeRoot,
  loadScopeMemories,
  makeMemoryId,
  parseMemoryMarkdown,
  serializeMemoryMarkdown,
  slugify,
} from "./markdown.ts";
import { redactSecrets } from "./redaction.ts";
import type {
  InboxEvent,
  MemoryRecord,
  MemoryScope,
  MemorySearchOptions,
  MemorySearchResult,
  MemorySource,
  MemoryStatus,
  MemoryType,
  ScratchpadTaskHistoryItem,
  UpsertMemoryInput,
} from "./types.ts";
import { cosineSim, decodeFloat32, DEFAULT_EMBED_URL, encodeFloat32, fetchEmbeddings } from "./vectors.ts";

export {
  closeMemoryIndexes,
  DEFAULT_EMBED_URL,
  ensureMemoryDirs,
  fetchEmbeddings,
  getGlobalMemoryRoot,
  getProjectMemoryRoot,
  getScopeRoot,
  loadScopeMemories,
  parseMemoryMarkdown,
  redactSecrets,
  serializeMemoryMarkdown,
  syncScopeIndex,
};
export type {
  InboxEvent,
  MemoryRecord,
  MemoryScope,
  MemorySearchOptions,
  MemorySearchResult,
  MemorySource,
  MemoryStatus,
  MemoryType,
  ScratchpadTaskHistoryItem,
  UpsertMemoryInput,
};

export function upsertMemory(
  input: UpsertMemoryInput,
  cwd: string = process.cwd(),
): {
  action: "ADD" | "SUPERSEDE";
  record: MemoryRecord;
  superseded?: string;
} {
  const root = getScopeRoot(input.scope, cwd);
  ensureMemoryDirs(root);

  const now = new Date().toISOString();
  const safeContent = redactSecrets(input.content);
  const safeTitle = redactSecrets(input.title);

  const id = makeMemoryId(input.scope);
  const record: MemoryRecord = {
    id,
    scope: input.scope,
    type: input.type,
    title: safeTitle.trim(),
    content: safeContent.trim(),
    tags: Array.from(new Set((input.tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean))),
    entities: Array.from(new Set((input.entities || []).map((e) => e.trim().toLowerCase()).filter(Boolean))),
    importance: Math.min(1, Math.max(0, input.importance ?? 0.7)),
    confidence: Math.min(1, Math.max(0, input.confidence ?? 0.85)),
    status: "active",
    valid_from: now,
    valid_to: null,
    superseded_by: null,
    access_count: 0,
    last_accessed: now,
    sources: input.source ? [input.source] : [],
  };

  let superseded: string | undefined;
  if (input.supersedes_id) {
    const existing = loadScopeMemories(input.scope, cwd, false).find((m) => m.id === input.supersedes_id);
    if (existing && existing.filePath) {
      existing.status = "superseded";
      existing.valid_to = now;
      existing.superseded_by = id;
      const archivePath = join(root, "archive", `${existing.id}_${slugify(existing.title)}.md`);
      atomicWriteFileSync(archivePath, serializeMemoryMarkdown(existing));
      if (existsSync(existing.filePath)) {
        unlinkSync(existing.filePath);
      }
      superseded = existing.id;
    }
  }

  const targetDir = input.type === "entity" ? join(root, "entities") : join(root, input.type);
  mkdirSync(targetDir, { recursive: true });

  const filePath = join(targetDir, `${id}_${slugify(record.title)}.md`);
  record.filePath = filePath;
  atomicWriteFileSync(filePath, serializeMemoryMarkdown(record));

  appendAudit(root, {
    action: superseded ? "SUPERSEDE" : "ADD",
    id: record.id,
    type: record.type,
    title: record.title,
    superseded_id: superseded ?? null,
    source: input.source ?? null,
  });

  return { action: superseded ? "SUPERSEDE" : "ADD", record, superseded };
}

export function archiveMemory(
  id: string,
  scope: MemoryScope,
  reason: string,
  cwd: string = process.cwd(),
): boolean {
  const root = getScopeRoot(scope, cwd);
  const existing = loadScopeMemories(scope, cwd, false).find((m) => m.id === id);
  if (!existing || !existing.filePath) return false;

  const now = new Date().toISOString();
  existing.status = "archived";
  existing.valid_to = now;
  const archivePath = join(root, "archive", `${existing.id}_${slugify(existing.title)}.md`);
  atomicWriteFileSync(archivePath, serializeMemoryMarkdown(existing));
  if (existsSync(existing.filePath)) {
    unlinkSync(existing.filePath);
  }
  appendAudit(root, { action: "ARCHIVE", id, reason });
  return true;
}

interface IndexedDoc {
  record: MemoryRecord;
  embedding: Float32Array | null;
  db: SqliteDb;
}

function runIndexedSearch(
  options: MemorySearchOptions,
  cwd: string,
  queryEmbedding: Float32Array | null,
): MemorySearchResult[] {
  const scopes: MemoryScope[] =
    options.scope === "global"
      ? ["global"]
      : options.scope === "project"
        ? ["project"]
        : ["project", "global"];

  const docs: IndexedDoc[] = [];
  const lexicalMap = new Map<string, number>();
  const entityState = createEntityGraphState();

  const ftsQuery = buildFtsQuery(options.query);
  const queryLower = options.query.toLowerCase();
  const allowedTypes = options.types && options.types.length > 0 ? new Set(options.types) : null;

  for (const s of scopes) {
    const db = syncScopeIndex(s, cwd);
    const statusClause = options.includeArchived ? "" : "WHERE status = 'active'";
    const rows = db.prepare(`SELECT * FROM memories ${statusClause}`).all();
    const validIds = new Set<string>();

    for (const row of rows) {
      const rec = rowToMemoryRecord(row);
      if (allowedTypes && !allowedTypes.has(rec.type)) continue;
      validIds.add(rec.id);
      docs.push({ record: rec, embedding: decodeFloat32(row.embedding), db });
    }

    if (validIds.size === 0) continue;

    if (ftsQuery) {
      try {
        const ftsRows = db
          .prepare(
            "SELECT id, bm25(memories_fts) AS rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank ASC LIMIT 200",
          )
          .all(ftsQuery);
        let pos = 0;
        for (const fr of ftsRows) {
          const id = String(fr.id);
          if (!validIds.has(id)) continue;
          const rawRank = Number(fr.rank ?? 0);
          lexicalMap.set(id, Math.max(0, -rawRank) + 1 / (1 + pos));
          pos++;
        }
      } catch {
        // Ignore FTS syntax issues on unusual queries
      }
    }

    loadScopeEntities(db, validIds, queryLower, entityState);
  }

  if (docs.length === 0) return [];

  const lexicalScores = docs.map((d) => lexicalMap.get(d.record.id) || 0);
  const vectorScores = docs.map((d) => {
    if (!queryEmbedding || !d.embedding || queryEmbedding.length !== d.embedding.length) return 0;
    return Math.max(0, cosineSim(queryEmbedding, d.embedding));
  });

  const seedIds = new Set<string>(entityState.directEntityHits.keys());
  const topLexIndices = docs
    .map((_, i) => i)
    .filter((i) => lexicalScores[i] > 0)
    .sort((a, b) => lexicalScores[b] - lexicalScores[a])
    .slice(0, 5);
  for (const idx of topLexIndices) seedIds.add(docs[idx].record.id);

  const topVecIndices = docs
    .map((_, i) => i)
    .filter((i) => vectorScores[i] > 0.35)
    .sort((a, b) => vectorScores[b] - vectorScores[a])
    .slice(0, 5);
  for (const idx of topVecIndices) seedIds.add(docs[idx].record.id);

  const oneHopHits = expandOneHopEntities(seedIds, entityState);

  const N = docs.length;
  const lexOrder = docs.map((_, i) => i).sort((a, b) => lexicalScores[b] - lexicalScores[a]);
  const vecOrder = docs.map((_, i) => i).sort((a, b) => vectorScores[b] - vectorScores[a]);
  const lexRank = new Map<number, number>();
  const vecRank = new Map<number, number>();
  lexOrder.forEach((docIdx, r) => lexRank.set(docIdx, r + 1));
  vecOrder.forEach((docIdx, r) => vecRank.set(docIdx, r + 1));

  const RRF_K = 20;
  const scored: MemorySearchResult[] = docs.map((d, i) => {
    const rec = d.record;
    const lexContrib = lexicalScores[i] > 0 ? 1 / (RRF_K + (lexRank.get(i) || N)) : 0;
    const vecContrib = vectorScores[i] > 0.2 ? 1 / (RRF_K + (vecRank.get(i) || N)) : 0;
    const directHits = entityState.directEntityHits.get(rec.id) || 0;
    const hopHits = oneHopHits.get(rec.id) || 0;
    const graphContrib = directHits > 0 || hopHits > 0 ? 0.5 / (RRF_K + 1) : 0;
    const rrf = lexContrib + vecContrib + graphContrib;
    const scopeWeight = rec.scope === "project" ? 1.05 : 1.0;
    const decay = computeDecay(rec);
    const accessBoost = 1 + 0.15 * Math.log(1 + rec.access_count);
    const graphBoost = 1 + Math.min(0.4, directHits * 0.15 + hopHits * 0.1);
    const score = rrf * scopeWeight * decay * rec.confidence * (0.5 + 0.5 * rec.importance) * accessBoost * graphBoost;

    return { record: rec, score, lexicalScore: lexicalScores[i], vectorScore: vectorScores[i], graphBoost };
  });

  scored.sort((a, b) => b.score - a.score);
  const limit = options.limit ?? 8;
  const maxTokens = options.maxTokens ?? 1200;

  const picked: MemorySearchResult[] = [];
  const docDbMap = new Map<string, SqliteDb>();
  for (const d of docs) docDbMap.set(d.record.id, d.db);

  let estTokens = 0;
  for (const item of scored) {
    if (picked.length >= limit) break;
    if (item.lexicalScore === 0 && item.vectorScore < 0.2 && item.graphBoost <= 1.0) continue;
    const itemTokens = Math.ceil((item.record.title.length + item.record.content.length) / 4);
    if (picked.length > 0 && estTokens + itemTokens > maxTokens) break;
    picked.push(item);
    estTokens += itemTokens;
  }

  if (picked.length > 0) {
    const now = new Date().toISOString();
    const byDb = new Map<SqliteDb, MemorySearchResult[]>();
    for (const item of picked) {
      const db = docDbMap.get(item.record.id);
      if (!db) continue;
      const list = byDb.get(db) || [];
      list.push(item);
      byDb.set(db, list);
    }
    for (const [db, items] of byDb.entries()) {
      const upd = db.prepare("UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?");
      runTx(db, () => {
        for (const item of items) {
          upd.run(now, item.record.id);
          item.record.access_count += 1;
          item.record.last_accessed = now;
        }
      });
    }
  }

  return picked;
}

export function searchMemory(options: MemorySearchOptions, cwd: string = process.cwd()): MemorySearchResult[] {
  return runIndexedSearch(options, cwd, null);
}

export async function searchMemoryAsync(
  options: MemorySearchOptions,
  cwd: string = process.cwd(),
): Promise<MemorySearchResult[]> {
  const embedUrl = options.embedUrl ?? DEFAULT_EMBED_URL;
  const scopes: MemoryScope[] =
    options.scope === "global"
      ? ["global"]
      : options.scope === "project"
        ? ["project"]
        : ["project", "global"];

  let queryVec: Float32Array | null = null;
  const qVecs = await fetchEmbeddings([options.query], embedUrl);
  if (qVecs && qVecs[0]) {
    queryVec = qVecs[0];
    for (const s of scopes) {
      const db = syncScopeIndex(s, cwd);
      const missing = db
        .prepare("SELECT id, title, tags_json, content FROM memories WHERE embedding IS NULL AND status = 'active' LIMIT 64")
        .all();
      if (missing.length > 0) {
        const texts = missing.map(
          (r) => `${String(r.title)} ${(JSON.parse(String(r.tags_json || "[]")) as string[]).join(" ")} ${String(r.content)}`,
        );
        const vecs = await fetchEmbeddings(texts, embedUrl);
        if (vecs && vecs.length === missing.length) {
          const upd = db.prepare("UPDATE memories SET embedding = ? WHERE id = ?");
          runTx(db, () => {
            for (let i = 0; i < missing.length; i++) {
              upd.run(encodeFloat32(vecs[i]), String(missing[i].id));
            }
          });
        }
      }
    }
  }

  return runIndexedSearch(options, cwd, queryVec);
}

export function appendInboxEvent(event: InboxEvent, cwd: string = process.cwd()): void {
  const root = getScopeRoot(event.scope, cwd);
  ensureMemoryDirs(root);
  const safeEvent: InboxEvent = {
    ...event,
    title: redactSecrets(event.title),
    content: redactSecrets(event.content),
  };
  appendFileSync(join(root, "inbox", "events.jsonl"), `${JSON.stringify(safeEvent)}\n`, "utf8");
}

export function readCoreProfile(scope: MemoryScope, cwd: string = process.cwd()): string {
  const root = getScopeRoot(scope, cwd);
  ensureMemoryDirs(root);
  const p = join(root, "core", "profile.md");
  return existsSync(p) ? readFileSync(p, "utf8").trim() : "";
}

export function rebuildCoreProfile(scope: MemoryScope, cwd: string = process.cwd()): string {
  const root = getScopeRoot(scope, cwd);
  ensureMemoryDirs(root);
  const active = loadScopeMemories(scope, cwd, false)
    .filter((m) => m.status === "active" && m.type !== "episodic")
    .sort((a, b) => b.importance * b.confidence - a.importance * a.confidence)
    .slice(0, 12);

  const lines = [`# Core ${scope === "global" ? "Global" : "Project"} Memory Profile`, ""];
  if (active.length === 0) {
    lines.push("*(No durable memories yet.)*");
  } else {
    for (const m of active) {
      const snippet = m.content.replace(/\s+/g, " ").slice(0, 140);
      lines.push(`- **[${m.id}] ${m.title}** (${m.type}): ${snippet}`);
    }
  }
  const text = `${lines.join("\n")}\n`;
  atomicWriteFileSync(join(root, "core", "profile.md"), text);
  return text;
}

export function drainInboxToEpisodic(
  scope: MemoryScope,
  cwd: string = process.cwd(),
  onBatchClaimed?: () => void,
): number {
  const root = getScopeRoot(scope, cwd);
  ensureMemoryDirs(root);
  const inboxDir = join(root, "inbox");
  const inboxPath = join(inboxDir, "events.jsonl");

  if (existsSync(inboxPath)) {
    const batchPath = join(inboxDir, `events.${Date.now()}.${process.pid}.${randomBytes(3).toString("hex")}.jsonl`);
    try {
      renameSync(inboxPath, batchPath);
    } catch {
      // Another process claimed events.jsonl concurrently
    }
  }

  if (onBatchClaimed) {
    onBatchClaimed();
  }

  const batchFiles = readdirSync(inboxDir)
    .filter((f) => /^events\..+\.jsonl$/.test(f))
    .sort()
    .map((f) => join(inboxDir, f));

  const seenHashes = new Set<string>();
  let promoted = 0;

  for (const batchPath of batchFiles) {
    const raw = readFileSync(batchPath, "utf8").trim();
    if (raw) {
      const lines = raw.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const ev = JSON.parse(line) as InboxEvent;
          if (!ev.title || !ev.content) continue;
          const dedupeHash = createHash("sha256")
            .update(`${ev.kind}\0${ev.title.trim()}\0${ev.content.trim()}`)
            .digest("hex");
          if (seenHashes.has(dedupeHash)) continue;
          seenHashes.add(dedupeHash);

          upsertMemory(
            {
              scope,
              type: "episodic",
              title: ev.title,
              content: ev.content,
              tags: ev.tags || [ev.kind],
              entities: ev.entities || [],
              importance: ev.kind === "user_correction" ? 0.85 : 0.6,
              confidence: 0.8,
              source: ev.source,
            },
            cwd,
          );
          promoted++;
        } catch {
          // Skip malformed line
        }
      }
    }
    try {
      unlinkSync(batchPath);
    } catch {
      // Already removed
    }
  }

  rebuildCoreProfile(scope, cwd);
  return promoted;
}

export function captureCompletedTasksToInbox(ephemeralDir: string, cwd: string = process.cwd()): number {
  const statePath = join(ephemeralDir, "state.json");
  if (!existsSync(statePath)) return 0;

  const state = JSON.parse(readFileSync(statePath, "utf8")) as {
    session_id?: string;
    active_task?: { title?: string; goal?: string } | null;
    history?: ScratchpadTaskHistoryItem[];
  };

  const history = Array.isArray(state.history) ? state.history : [];
  if (history.length === 0) return 0;

  const markerPath = join(ephemeralDir, ".memory-captured.json");
  let capturedCount = 0;
  if (existsSync(markerPath)) {
    try {
      const marker = JSON.parse(readFileSync(markerPath, "utf8")) as { capturedCount?: number };
      if (typeof marker.capturedCount === "number" && marker.capturedCount >= 0) {
        capturedCount = marker.capturedCount;
      }
    } catch {
      capturedCount = 0;
    }
  }

  if (capturedCount >= history.length) return 0;

  const newlyCompleted = history.slice(capturedCount);
  let captured = 0;
  for (const item of newlyCompleted) {
    if (!item || !item.title) continue;
    appendInboxEvent(
      {
        timestamp: item.finished_at || new Date().toISOString(),
        scope: "project",
        kind: "session_summary",
        title: `Session task: ${item.title}`,
        content: `Goal: ${item.goal || ""}\nCompleted: ${item.completed ?? 0}/${item.total ?? 0}\nSummary: ${item.summary || ""}`,
        tags: ["session", "scratchpad"],
        source: { session_id: state.session_id || process.env.SOSHO_SESSION_ID },
      },
      cwd,
    );
    captured++;
  }

  atomicWriteFileSync(markerPath, JSON.stringify({ capturedCount: history.length }, null, 2));
  return captured;
}
