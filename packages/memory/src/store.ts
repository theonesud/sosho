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
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
// Hybrid Search: BM25 + Cosine Vector (pluggable local embedder + hash fallback) + RRF + Decay
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function hashEmbed(text: string, dims = 128): Float32Array {
  const vec = new Float32Array(dims);
  const tokens = tokenize(text);
  for (const tok of tokens) {
    const h = createHash("sha256").update(tok).digest();
    const idx = h.readUInt16BE(0) % dims;
    const sign = (h[2] & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
    // Character trigram features for fuzzy/morphological recall
    for (let i = 0; i <= tok.length - 3; i++) {
      const tri = tok.slice(i, i + 3);
      const th = createHash("sha256").update(tri).digest();
      const tidx = th.readUInt16BE(0) % dims;
      vec[tidx] += ((th[2] & 1) === 0 ? 0.5 : -0.5);
    }
  }
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims; i++) vec[i] /= norm;
  return vec;
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
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

export function searchMemory(
  options: MemorySearchOptions,
  cwd: string = process.cwd(),
): MemorySearchResult[] {
  const scopes: MemoryScope[] =
    options.scope === "global"
      ? ["global"]
      : options.scope === "project"
        ? ["project"]
        : ["project", "global"];

  let docs: MemoryRecord[] = [];
  for (const s of scopes) {
    docs.push(...loadScopeMemories(s, cwd, Boolean(options.includeArchived)));
  }

  if (options.types && options.types.length > 0) {
    const allowed = new Set(options.types);
    docs = docs.filter((d) => allowed.has(d.type));
  }
  if (!options.includeArchived) {
    docs = docs.filter((d) => d.status === "active");
  }
  if (docs.length === 0) return [];

  const queryTokens = tokenize(options.query);
  const querySet = new Set(queryTokens);
  const queryVec = hashEmbed(options.query);

  // BM25 corpus stats
  const docTokens = docs.map((d) =>
    tokenize(`${d.title} ${d.tags.join(" ")} ${d.entities.join(" ")} ${d.content}`),
  );
  const avgDl = docTokens.reduce((sum, t) => sum + t.length, 0) / Math.max(1, docs.length);
  const df = new Map<string, number>();
  for (const toks of docTokens) {
    for (const uniq of new Set(toks)) {
      df.set(uniq, (df.get(uniq) || 0) + 1);
    }
  }

  const k1 = 1.5;
  const b = 0.75;
  const N = docs.length;

  const lexicalScores = docs.map((_d, i) => {
    const toks = docTokens[i];
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const qt of queryTokens) {
      const f = tf.get(qt) || 0;
      if (f === 0) continue;
      const n = df.get(qt) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks.length) / Math.max(1, avgDl))));
    }
    return score;
  });

  const vectorScores = docs.map((d) => {
    const dv = hashEmbed(`${d.title} ${d.tags.join(" ")} ${d.content}`);
    return Math.max(0, cosineSim(queryVec, dv));
  });

  // Ranks for Reciprocal Rank Fusion (RRF)
  const lexOrder = docs.map((_, i) => i).sort((a, bIdx) => lexicalScores[bIdx] - lexicalScores[a]);
  const vecOrder = docs.map((_, i) => i).sort((a, bIdx) => vectorScores[bIdx] - vectorScores[a]);
  const lexRank = new Map<number, number>();
  const vecRank = new Map<number, number>();
  lexOrder.forEach((docIdx, r) => lexRank.set(docIdx, r + 1));
  vecOrder.forEach((docIdx, r) => vecRank.set(docIdx, r + 1));

  const RRF_K = 20;
  const scored: MemorySearchResult[] = docs.map((rec, i) => {
    const lexContrib = lexicalScores[i] > 0 ? 1 / (RRF_K + (lexRank.get(i) || N)) : 0;
    const vecContrib = vectorScores[i] > 0.05 ? 1 / (RRF_K + (vecRank.get(i) || N)) : 0;
    const rrf = lexContrib + vecContrib;
    const scopeWeight = rec.scope === "project" ? 1.05 : 1.0;
    const decay = computeDecay(rec);
    const accessBoost = 1 + 0.15 * Math.log(1 + rec.access_count);
    const entityMatches = rec.entities.filter((e) => querySet.has(e)).length;
    const graphBoost = 1 + Math.min(0.4, entityMatches * 0.15);
    const score = rrf * scopeWeight * decay * rec.confidence * (0.5 + 0.5 * rec.importance) * accessBoost * graphBoost;

    return {
      record: rec,
      score,
      lexicalScore: lexicalScores[i],
      vectorScore: vectorScores[i],
      graphBoost,
    };
  });

  scored.sort((a, bRes) => bRes.score - a.score);
  const limit = options.limit ?? 8;
  const maxTokens = options.maxTokens ?? 1200;

  const picked: MemorySearchResult[] = [];
  let estTokens = 0;
  for (const item of scored) {
    if (picked.length >= limit) break;
    if (item.lexicalScore === 0 && item.vectorScore < 0.08) continue;
    const itemTokens = Math.ceil((item.record.title.length + item.record.content.length) / 4);
    if (picked.length > 0 && estTokens + itemTokens > maxTokens) break;
    picked.push(item);
    estTokens += itemTokens;
  }

  return picked;
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
