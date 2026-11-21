import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ensureMemoryDirs, getScopeRoot, parseMemoryMarkdown, walkMarkdownFiles } from "./markdown.ts";
import type { MemoryRecord, MemoryScope, MemorySource, MemoryStatus, MemoryType } from "./types.ts";

const require = createRequire(import.meta.url);

export interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const indexCache = new Map<string, SqliteDb>();

export function openSqliteDb(dbPath: string): SqliteDb {
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

export function runTx(db: SqliteDb, fn: () => void): void {
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

export function rowToMemoryRecord(row: Record<string, unknown>): MemoryRecord {
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

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

export function buildFtsQuery(query: string): string | null {
  const tokens = tokenize(query)
    .map((t) => t.replace(/[^a-z0-9_]/g, ""))
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;
  return Array.from(new Set(tokens))
    .map((t) => `"${t}"`)
    .join(" OR ");
}

export function computeDecay(rec: MemoryRecord): number {
  const halfLifeDays = rec.type === "episodic" ? 30 : 180;
  const ageMs = Math.max(0, Date.now() - Date.parse(rec.last_accessed || rec.valid_from));
  const ageDays = ageMs / 86_400_000;
  const lambda = Math.LN2 / halfLifeDays;
  return 0.5 + 0.5 * Math.exp(-lambda * ageDays);
}
