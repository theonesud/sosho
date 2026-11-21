import { randomBytes } from "node:crypto";
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
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MemoryRecord, MemoryScope } from "./types.ts";

const SUBDIRS = ["core", "semantic", "procedural", "episodic", "entities", "inbox", "archive"] as const;

export function getGlobalMemoryRoot(): string {
  return process.env.SOSHO_GLOBAL_MEMORY_DIR || join(homedir(), ".sosho", "memory");
}

export function getProjectMemoryRoot(cwd: string = process.cwd()): string {
  return join(cwd, ".pi", "memory");
}

export function getScopeRoot(scope: MemoryScope, cwd: string = process.cwd()): string {
  return scope === "global" ? getGlobalMemoryRoot() : getProjectMemoryRoot(cwd);
}

export function atomicWriteFileSync(targetPath: string, content: string): void {
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

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "memory"
  );
}

export function makeMemoryId(scope: MemoryScope): string {
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

export function walkMarkdownFiles(dir: string): string[] {
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

export function appendAudit(root: string, entry: Record<string, unknown>): void {
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
