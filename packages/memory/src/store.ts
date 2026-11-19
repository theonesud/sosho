import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export type MemoryScope = "global" | "project";
export type MemoryType = "semantic" | "procedural" | "episodic" | "entity";
export type MemoryStatus = "active" | "superseded" | "archived" | "needs_review";

export interface MemorySource {
  session_id?: string;
  langfuse_trace_id?: string;
  note?: string;
}

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  type: MemoryType;
  title: string;
  content: string;
  tags: string[];
  entities: string[];
  importance: number;
  confidence: number;
  status: MemoryStatus;
  valid_from: string;
  valid_to: string | null;
  superseded_by: string | null;
  access_count: number;
  last_accessed: string;
  sources: MemorySource[];
  filePath?: string;
}

export interface MemorySearchOptions {
  query: string;
  scope?: MemoryScope | "both";
  types?: MemoryType[];
  limit?: number;
  maxTokens?: number;
  includeArchived?: boolean;
  embedUrl?: string;
}

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number;
  lexicalScore: number;
  vectorScore: number;
  graphBoost: number;
}

export interface UpsertMemoryInput {
  scope: MemoryScope;
  type: MemoryType;
  title: string;
  content: string;
  tags?: string[];
  entities?: string[];
  importance?: number;
  confidence?: number;
  supersedes_id?: string;
  source?: MemorySource;
}

export interface InboxEvent {
  timestamp: string;
  scope: MemoryScope;
  kind: "session_summary" | "task_finish" | "user_correction" | "workflow_outcome" | "manual";
  title: string;
  content: string;
  tags?: string[];
  entities?: string[];
  source?: MemorySource;
}

const SUBDIRS = ["core", "semantic", "procedural", "episodic", "entities", "inbox", "archive"] as const;

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
  /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:\s/@]+:[^@\s/]+@)/g,
  /\b(sk-[a-zA-Z0-9_-]{20,})\b/g,
  /\b(pk-lf-[a-zA-Z0-9_-]{8,})\b/g,
  /\b(sk-lf-[a-zA-Z0-9_-]{8,})\b/g,
  /\b(ghp_[a-zA-Z0-9]{20,})\b/g,
  /\b(hf_[a-zA-Z0-9]{20,})\b/g,
  /\b(AIza[0-9A-Za-z_-]{30,})\b/g,
  /\b(Bearer\s+[A-Za-z0-9._-]{20,})\b/gi,
  /\b([A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD)\s*=\s*[^\s"'`]{8,})/g,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    if (re.source.includes(":\\/\\/")) {
      out = out.replace(re, "$1[REDACTED_SECRET]@");
    } else {
      out = out.replace(re, "[REDACTED_SECRET]");
    }
  }
  return out;
}

export function getGlobalMemoryRoot(): string {
  return process.env.SOSHO_GLOBAL_MEMORY_DIR || join(homedir(), ".sosho", "memory");
}

export function getProjectMemoryRoot(cwd: string = process.cwd()): string {
  return join(cwd, ".pi", "memory");
}

export function getScopeRoot(scope: MemoryScope, cwd: string = process.cwd()): string {
  return scope === "global" ? getGlobalMemoryRoot() : getProjectMemoryRoot(cwd);
}

function atomicWriteFileSync(targetPath: string, content: string): void {
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.tmp.${process.pid}.${randomBytes(6).toString("hex")}`);
  const fd = openSync(tmpPath, "w", 0o644);
  try {
    writeSync(fd, content, 0, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, targetPath);
}

export function ensureMemoryDirs(root: string): void {
  for (const sub of SUBDIRS) {
    mkdirSync(join(root, sub), { recursive: true });
  }
  const profilePath = join(root, "core", "profile.md");
  if (!existsSync(profilePath)) {
    atomicWriteFileSync(
      profilePath,
      "# Core Memory Profile\n\n*(Auto-maintained compact summary of highest-importance active memories.)*\n",
    );
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "memory";
}

function makeMemoryId(scope: MemoryScope): string {
  const prefix = scope === "global" ? "mem_g" : "mem_p";
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

export function serializeMemoryMarkdown(rec: MemoryRecord): string {
  const frontmatter = {
    id: rec.id,
    scope: rec.scope,
    type: rec.type,
    title: rec.title,
    tags: rec.tags,
    entities: rec.entities,
    importance: Number(rec.importance.toFixed(3)),
    confidence: Number(rec.confidence.toFixed(3)),
    status: rec.status,
    valid_from: rec.valid_from,
    valid_to: rec.valid_to,
    superseded_by: rec.superseded_by,
    access_count: rec.access_count,
    last_accessed: rec.last_accessed,
    sources: rec.sources,
  };
  return `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n\n${rec.content.trim()}\n`;
}

export function parseMemoryMarkdown(raw: string, filePath?: string): MemoryRecord | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  try {
    const meta = JSON.parse(match[1]) as Partial<MemoryRecord>;
    if (!meta.id || !meta.scope || !meta.type || !meta.title) return null;
    return {
      id: meta.id,
      scope: meta.scope,
      type: meta.type,
      title: meta.title,
      content: match[2].trim(),
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      entities: Array.isArray(meta.entities) ? meta.entities : [],
      importance: typeof meta.importance === "number" ? meta.importance : 0.6,
      confidence: typeof meta.confidence === "number" ? meta.confidence : 0.8,
      status: meta.status || "active",
      valid_from: meta.valid_from || new Date().toISOString(),
      valid_to: meta.valid_to ?? null,
      superseded_by: meta.superseded_by ?? null,
      access_count: typeof meta.access_count === "number" ? meta.access_count : 0,
      last_accessed: meta.last_accessed || meta.valid_from || new Date().toISOString(),
      sources: Array.isArray(meta.sources) ? meta.sources : [],
      filePath,
    };
  } catch {
    return null;
  }
}

function walkMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

export function loadScopeMemories(
  scope: MemoryScope,
  cwd: string = process.cwd(),
  includeArchived = false,
): MemoryRecord[] {
  const root = getScopeRoot(scope, cwd);
  ensureMemoryDirs(root);
  const dirs = includeArchived
    ? ["semantic", "procedural", "episodic", "entities", "archive"]
    : ["semantic", "procedural", "episodic", "entities"];

  const records: MemoryRecord[] = [];
  for (const d of dirs) {
    for (const filePath of walkMarkdownFiles(join(root, d))) {
      try {
        const parsed = parseMemoryMarkdown(readFileSync(filePath, "utf8"), filePath);
        if (parsed) records.push(parsed);
      } catch {
        // Ignore unreadable files
      }
    }
  }
  return records;
}

function appendAudit(root: string, entry: Record<string, unknown>): void {
  try {
    appendFileSync(
      join(root, "audit.jsonl"),
      `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`,
      "utf8",
    );
  } catch {
    // Ignore audit write errors
  }
}

export function upsertMemory(input: UpsertMemoryInput, cwd: string = process.cwd()): {
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

  const targetDir =
    input.type === "entity"
      ? join(root, "entities")
      : join(root, input.type);
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

// ---------------------------------------------------------------------------
// Rebuildable SQLite Index (memories + FTS5 + memory_entities + dense vectors)
// ---------------------------------------------------------------------------

export const DEFAULT_EMBED_URL = process.env.SOSHO_EMBED_URL || "http://127.0.0.1:8082/v1/embeddings";

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const indexCache = new Map<string, SqliteDb>();

function openSqliteDb(dbPath: string): SqliteDb {
  const cached = indexCache.get(dbPath);
  if (cached) return cached;

  let db: SqliteDb;
  const nodeMajor = Number(process.versions.node.split(".")[0] || "20");
  if (nodeMajor >= 22) {
    try {
      const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (p: string) => SqliteDb };
      db = new DatabaseSync(dbPath);
    } catch {
      const BetterSqlite3 = require("better-sqlite3") as new (p: string) => SqliteDb;
      db = new BetterSqlite3(dbPath);
    }
  } else {
    const BetterSqlite3 = require("better-sqlite3") as new (p: string) => SqliteDb;
    db = new BetterSqlite3(dbPath);
  }

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      entities_json TEXT NOT NULL,
      importance REAL NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      superseded_by TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mtime_ms REAL NOT NULL,
      embedding BLOB
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      id UNINDEXED,
      title,
      tags,
      entities,
      content
    );
    CREATE TABLE IF NOT EXISTS memory_entities (
      memory_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      PRIMARY KEY (memory_id, entity)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_entities_entity ON memory_entities(entity);
    CREATE INDEX IF NOT EXISTS idx_memories_file_path ON memories(file_path);
  `);

  indexCache.set(dbPath, db);
  return db;
}

export function closeMemoryIndexes(): void {
  for (const db of indexCache.values()) {
    try {
      db.close();
    } catch {
      // ignore close errors
    }
  }
  indexCache.clear();
}

function runTx(db: SqliteDb, fn: () => void): void {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw err;
  }
}

function encodeFloat32(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function decodeFloat32(blob: unknown): Float32Array | null {
  if (!blob) return null;
  if (blob instanceof Uint8Array) {
    const copy = new Uint8Array(blob.byteLength);
    copy.set(blob);
    return new Float32Array(copy.buffer);
  }
  return null;
}

function rowToMemoryRecord(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    scope: String(row.scope) as MemoryScope,
    type: String(row.type) as MemoryType,
    title: String(row.title),
    content: String(row.content),
    tags: JSON.parse(String(row.tags_json || "[]")) as string[],
    entities: JSON.parse(String(row.entities_json || "[]")) as string[],
    importance: Number(row.importance ?? 0.6),
    confidence: Number(row.confidence ?? 0.8),
    status: String(row.status || "active") as MemoryStatus,
    valid_from: String(row.valid_from),
    valid_to: row.valid_to ? String(row.valid_to) : null,
    superseded_by: row.superseded_by ? String(row.superseded_by) : null,
    access_count: Number(row.access_count ?? 0),
    last_accessed: String(row.last_accessed || row.valid_from),
    sources: JSON.parse(String(row.sources_json || "[]")) as MemorySource[],
    filePath: String(row.file_path),
  };
}

export function syncScopeIndex(scope: MemoryScope, cwd: string = process.cwd()): SqliteDb {
  const root = getScopeRoot(scope, cwd);
  ensureMemoryDirs(root);
  const db = openSqliteDb(join(root, "index.sqlite"));

  const dirs = ["semantic", "procedural", "episodic", "entities", "archive"];
  const diskFiles = new Map<string, number>();
  for (const d of dirs) {
    for (const filePath of walkMarkdownFiles(join(root, d))) {
      try {
        diskFiles.set(filePath, statSync(filePath).mtimeMs);
      } catch {
        // Ignore vanished file
      }
    }
  }

  const indexedRows = db.prepare("SELECT id, file_path, mtime_ms, access_count, last_accessed FROM memories").all();
  const byPath = new Map<string, { id: string; mtimeMs: number; accessCount: number; lastAccessed: string }>();
  for (const r of indexedRows) {
    byPath.set(String(r.file_path), {
      id: String(r.id),
      mtimeMs: Number(r.mtime_ms),
      accessCount: Number(r.access_count ?? 0),
      lastAccessed: String(r.last_accessed || ""),
    });
  }

  const toDelete: string[] = [];
  for (const [fp, info] of byPath.entries()) {
    if (!diskFiles.has(fp)) {
      toDelete.push(info.id);
    }
  }

  const toUpsert: Array<{ rec: MemoryRecord; mtimeMs: number; accessCount: number; lastAccessed: string }> = [];
  for (const [fp, mtimeMs] of diskFiles.entries()) {
    const existing = byPath.get(fp);
    if (existing && Math.abs(existing.mtimeMs - mtimeMs) < 1) {
      continue;
    }
    try {
      const parsed = parseMemoryMarkdown(readFileSync(fp, "utf8"), fp);
      if (parsed) {
        const accessCount = Math.max(parsed.access_count, existing?.accessCount ?? 0);
        const lastAccessed =
          existing?.lastAccessed && existing.lastAccessed > parsed.last_accessed
            ? existing.lastAccessed
            : parsed.last_accessed;
        toUpsert.push({ rec: parsed, mtimeMs, accessCount, lastAccessed });
      }
    } catch {
      // Ignore unreadable file
    }
  }

  if (toDelete.length === 0 && toUpsert.length === 0) {
    return db;
  }

  const delMem = db.prepare("DELETE FROM memories WHERE id = ?");
  const delFts = db.prepare("DELETE FROM memories_fts WHERE id = ?");
  const delEnt = db.prepare("DELETE FROM memory_entities WHERE memory_id = ?");
  const insMem = db.prepare(`
    INSERT OR REPLACE INTO memories (
      id, scope, type, title, content, tags_json, entities_json,
      importance, confidence, status, valid_from, valid_to, superseded_by,
      access_count, last_accessed, sources_json, file_path, mtime_ms, embedding
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  const insFts = db.prepare("INSERT INTO memories_fts (id, title, tags, entities, content) VALUES (?, ?, ?, ?, ?)");
  const insEnt = db.prepare("INSERT OR IGNORE INTO memory_entities (memory_id, entity) VALUES (?, ?)");

  runTx(db, () => {
    for (const id of toDelete) {
      delMem.run(id);
      delFts.run(id);
      delEnt.run(id);
    }
    for (const { rec, mtimeMs, accessCount, lastAccessed } of toUpsert) {
      delFts.run(rec.id);
      delEnt.run(rec.id);
      insMem.run(
        rec.id,
        rec.scope,
        rec.type,
        rec.title,
        rec.content,
        JSON.stringify(rec.tags),
        JSON.stringify(rec.entities),
        rec.importance,
        rec.confidence,
        rec.status,
        rec.valid_from,
        rec.valid_to,
        rec.superseded_by,
        accessCount,
        lastAccessed,
        JSON.stringify(rec.sources),
        rec.filePath || "",
        mtimeMs,
      );
      insFts.run(rec.id, rec.title, rec.tags.join(" "), rec.entities.join(" "), rec.content);
      for (const entity of rec.entities) {
        const norm = entity.trim().toLowerCase();
        if (norm) insEnt.run(rec.id, norm);
      }
    }
  });

  return db;
}

export async function fetchEmbeddings(
  texts: string[],
  embedUrl: string = DEFAULT_EMBED_URL,
): Promise<Float32Array[] | null> {
  if (!embedUrl || texts.length === 0) return null;
  try {
    const res = await fetch(embedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "embeddinggemma", input: texts }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    if (!Array.isArray(json.data) || json.data.length !== texts.length) return null;
    const sorted = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return sorted.map((item) => {
      const arr = new Float32Array(item.embedding || []);
      let norm = 0;
      for (let i = 0; i < arr.length; i++) norm += arr[i] * arr[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < arr.length; i++) arr[i] /= norm;
      return arr;
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hybrid Search: SQLite FTS5 + Dense Vectors (embeddinggemma) + 1-Hop Entity Graph + RRF + Decay
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function buildFtsQuery(query: string): string | null {
  const tokens = tokenize(query)
    .map((t) => t.replace(/[^a-z0-9_]/g, ""))
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;
  return Array.from(new Set(tokens))
    .map((t) => `"${t}"`)
    .join(" OR ");
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

function computeDecay(rec: MemoryRecord): number {
  const halfLifeDays = rec.type === "episodic" ? 30 : 180;
  const ageMs = Math.max(0, Date.now() - Date.parse(rec.last_accessed || rec.valid_from));
  const ageDays = ageMs / 86_400_000;
  const lambda = Math.LN2 / halfLifeDays;
  return 0.5 + 0.5 * Math.exp(-lambda * ageDays);
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
  const directEntityHits = new Map<string, number>();
  const entityToDocs = new Map<string, Set<string>>();
  const docToEntities = new Map<string, string[]>();

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
      docs.push({
        record: rec,
        embedding: decodeFloat32(row.embedding),
        db,
      });
    }

    if (validIds.size === 0) continue;

    // FTS5 BM25 lexical recall (ORDER BY bm25() ASC handles small-corpus positive IDF cleanly)
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
          // Combine raw bm25 magnitude with monotonic position score so small corpora preserve exact ordering
          const score = Math.max(0, -rawRank) + 1 / (1 + pos);
          lexicalMap.set(id, score);
          pos++;
        }
      } catch {
        // Ignore FTS syntax issues on unusual queries
      }
    }

    // Load entity graph edges from memory_entities
    const entRows = db.prepare("SELECT memory_id, entity FROM memory_entities").all();
    for (const er of entRows) {
      const mid = String(er.memory_id);
      if (!validIds.has(mid)) continue;
      const entity = String(er.entity);
      let set = entityToDocs.get(entity);
      if (!set) {
        set = new Set();
        entityToDocs.set(entity, set);
      }
      set.add(mid);
      const list = docToEntities.get(mid) || [];
      list.push(entity);
      docToEntities.set(mid, list);

      if (entity.length >= 2 && queryLower.includes(entity)) {
        directEntityHits.set(mid, (directEntityHits.get(mid) || 0) + 1);
      }
    }
  }

  if (docs.length === 0) return [];

  const lexicalScores = docs.map((d) => lexicalMap.get(d.record.id) || 0);
  const vectorScores = docs.map((d) => {
    if (!queryEmbedding || !d.embedding || queryEmbedding.length !== d.embedding.length) return 0;
    return Math.max(0, cosineSim(queryEmbedding, d.embedding));
  });

  // 1-hop entity graph traversal from top seed documents (lexical + vector + direct entity matches)
  const seedIds = new Set<string>(directEntityHits.keys());
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

  const oneHopHits = new Map<string, number>();
  for (const sid of seedIds) {
    const ents = docToEntities.get(sid) || [];
    for (const e of ents) {
      const neighbors = entityToDocs.get(e);
      if (!neighbors) continue;
      for (const nid of neighbors) {
        if (nid === sid) continue;
        oneHopHits.set(nid, (oneHopHits.get(nid) || 0) + 1);
      }
    }
  }

  // Reciprocal Rank Fusion (RRF)
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
    const directHits = directEntityHits.get(rec.id) || 0;
    const hopHits = oneHopHits.get(rec.id) || 0;
    const graphContrib = directHits > 0 || hopHits > 0 ? 0.5 / (RRF_K + 1) : 0;
    const rrf = lexContrib + vecContrib + graphContrib;
    const scopeWeight = rec.scope === "project" ? 1.05 : 1.0;
    const decay = computeDecay(rec);
    const accessBoost = 1 + 0.15 * Math.log(1 + rec.access_count);
    const graphBoost = 1 + Math.min(0.4, directHits * 0.15 + hopHits * 0.1);
    const score = rrf * scopeWeight * decay * rec.confidence * (0.5 + 0.5 * rec.importance) * accessBoost * graphBoost;

    return {
      record: rec,
      score,
      lexicalScore: lexicalScores[i],
      vectorScore: vectorScores[i],
      graphBoost,
    };
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

  // Update access_count and last_accessed in the SQLite index for returned records
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

export function searchMemory(
  options: MemorySearchOptions,
  cwd: string = process.cwd(),
): MemorySearchResult[] {
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
    // Backfill missing dense vectors in SQLite for active rows
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

// ---------------------------------------------------------------------------
// Inbox & Core Profile Consolidation
// ---------------------------------------------------------------------------

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

  const lines = [
    `# Core ${scope === "global" ? "Global" : "Project"} Memory Profile`,
    "",
  ];
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

export interface ScratchpadTaskHistoryItem {
  title: string;
  goal: string;
  summary: string;
  completed: number;
  total: number;
  finished_at?: string;
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
