import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import {
  archiveMemory,
  closeMemoryIndexes,
  drainInboxToEpisodic,
  loadScopeMemories,
  type MemoryScope,
  type MemoryType,
  readCoreProfile,
  rebuildCoreProfile,
  searchMemory,
  upsertMemory,
} from "../../../packages/memory/src/store.ts";
import { type NodeExecutor, WorkflowEngine } from "../../../packages/workflow-engine/src/engine.ts";
import { GraphValidationError, validateGraph } from "../../../packages/workflow-engine/src/schema.ts";

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:4100",
  "http://localhost:4100",
]);

const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB
const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE"]);

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function isSafeWorkflowId(id: string): boolean {
  if (!id || id.length > 128) return false;
  if (id.includes("/") || id.includes("\\") || id.includes("..") || id.includes("\0")) return false;
  return /^[a-zA-Z0-9._-]+$/.test(id);
}

function loadStudioToken(root: string): string {
  const fromEnv = process.env.SOSHO_STUDIO_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const envPath = join(root, ".env");
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*SOSHO_STUDIO_TOKEN\s*=\s*(.+?)\s*$/);
      if (m) {
        const val = m[1].replace(/^["']|["']$/g, "").trim();
        if (val) return val;
      }
    }
  }
  return randomBytes(24).toString("hex");
}

function verifyBearer(req: IncomingMessage, expectedToken: string): boolean {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return false;
  const provided = auth.slice("Bearer ".length).trim();
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expectedToken, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface StudioServerOptions {
  root?: string;
  port?: number;
  token?: string;
  dbPath?: string;
  executor?: NodeExecutor;
  heartbeatMs?: number;
}

export function createStudioServer(options: StudioServerOptions = {}): {
  server: Server;
  engine: WorkflowEngine;
  token: string;
  closeAll: () => void;
} {
  const ROOT = resolve(options.root || process.env.SOSHO_ROOT || join(import.meta.dirname, "../../.."));
  const WORKFLOWS_DIR = join(ROOT, "workflows");
  const SKILLS_DIR = join(ROOT, ".pi", "skills");
  const PORT = options.port ?? Number(process.env.STUDIO_API_PORT || "4101");
  const STUDIO_TOKEN = options.token ?? loadStudioToken(ROOT);
  const HEARTBEAT_MS = options.heartbeatMs ?? 15_000;

  mkdirSync(WORKFLOWS_DIR, { recursive: true });

  const engine = new WorkflowEngine({
    cwd: ROOT,
    dbPath: options.dbPath,
    executor: options.executor,
  });

  const sseClients = new Set<ServerResponse>();

  function broadcastEvent(payload: Record<string, unknown>) {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(data);
      } catch {
        sseClients.delete(res);
      }
    }
  }

  // Forward in-process SQLite DAG engine events directly to SSE subscribers
  engine.on("event", (ev: Record<string, unknown>) => {
    broadcastEvent(ev);
  });

  // Recover any interrupted 'running' runs on startup
  engine.recoverInterruptedRuns();

  const heartbeatTimer = setInterval(() => {
    for (const res of sseClients) {
      try {
        res.write(": ping\n\n");
      } catch {
        sseClients.delete(res);
      }
    }
  }, HEARTBEAT_MS);
  heartbeatTimer.unref();

  function corsHeaders(req: IncomingMessage): Record<string, string> {
    const origin = req.headers.origin;
    const headers: Record<string, string> = {
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      Vary: "Origin",
    };
    if (origin && DEFAULT_ALLOWED_ORIGINS.has(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
    }
    return headers;
  }

  function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      ...corsHeaders(req),
    });
    res.end(JSON.stringify(body));
  }

  async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > MAX_BODY_BYTES) {
        throw new HttpError(413, "Payload too large (max 1 MiB)");
      }
      chunks.push(buf);
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new HttpError(400, "JSON body must be an object");
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, "Invalid JSON payload");
    }
  }

  const server = createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      if (origin && !DEFAULT_ALLOWED_ORIGINS.has(origin)) {
        sendJson(req, res, 403, { error: "Origin not allowed" });
        return;
      }

      if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders(req));
        res.end();
        return;
      }

      if (req.method && MUTATING_METHODS.has(req.method)) {
        if (!verifyBearer(req, STUDIO_TOKEN)) {
          sendJson(req, res, 401, { error: "Unauthorized: missing or invalid bearer token" });
          return;
        }
      }

      const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
      const path = url.pathname;

      // 1. SSE Live Events Stream (with 15s : ping heartbeat)
      if (req.method === "GET" && path === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...corsHeaders(req),
        });
        res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      if (req.method === "POST" && path === "/api/events") {
        const body = await readBody(req);
        broadcastEvent(body);
        sendJson(req, res, 200, { ok: true });
        return;
      }

      // 2. Workflows CRUD (workflows/*.graph.json)
      if (req.method === "GET" && path === "/api/workflows") {
        const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".graph.json"));
        const list = files.map((f) => {
          const g = JSON.parse(readFileSync(join(WORKFLOWS_DIR, f), "utf8")) as {
            id: string;
            name: string;
            description?: string;
          };
          return { file: f, id: g.id, name: g.name, description: g.description || "" };
        });
        sendJson(req, res, 200, { workflows: list });
        return;
      }

      if (req.method === "GET" && path.startsWith("/api/workflows/")) {
        const id = decodeURIComponent(path.slice("/api/workflows/".length));
        if (!isSafeWorkflowId(id)) {
          sendJson(req, res, 400, { error: "Invalid workflow ID" });
          return;
        }
        const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".graph.json"));
        for (const f of files) {
          const g = JSON.parse(readFileSync(join(WORKFLOWS_DIR, f), "utf8")) as { id: string };
          if (g.id === id || f === id) {
            sendJson(req, res, 200, g);
            return;
          }
        }
        sendJson(req, res, 404, { error: "Workflow not found" });
        return;
      }

      if (req.method === "POST" && path === "/api/workflows") {
        const graph = await readBody(req);
        const rawId = graph.id !== undefined ? String(graph.id).trim() : `wf-${randomBytes(3).toString("hex")}`;
        if (!isSafeWorkflowId(rawId)) {
          sendJson(req, res, 400, { error: "Invalid workflow ID" });
          return;
        }
        graph.id = rawId;
        const validated = validateGraph(graph);
        const outPath = join(WORKFLOWS_DIR, `${validated.id}.graph.json`);
        writeFileSync(outPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
        sendJson(req, res, 200, { ok: true, id: validated.id, path: outPath });
        return;
      }

      if (req.method === "DELETE" && path.startsWith("/api/workflows/")) {
        const id = decodeURIComponent(path.slice("/api/workflows/".length));
        if (!isSafeWorkflowId(id)) {
          sendJson(req, res, 400, { error: "Invalid workflow ID" });
          return;
        }
        const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".graph.json"));
        for (const f of files) {
          const full = join(WORKFLOWS_DIR, f);
          const g = JSON.parse(readFileSync(full, "utf8")) as { id: string };
          if (g.id === id || f === id) {
            unlinkSync(full);
            sendJson(req, res, 200, { ok: true, id });
            return;
          }
        }
        sendJson(req, res, 404, { error: "Workflow not found" });
        return;
      }

      // 3. Skills Discovery
      if (req.method === "GET" && path === "/api/skills") {
        const skills = existsSync(SKILLS_DIR)
          ? readdirSync(SKILLS_DIR, { withFileTypes: true })
              .filter((d) => d.isDirectory())
              .map((d) => d.name)
          : [];
        sendJson(req, res, 200, { skills });
        return;
      }

      // 4. SQLite WAL DAG Workflow Runs & HITL Checkpoints
      if (req.method === "GET" && path === "/api/runs") {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || "50")));
        const runs = engine.listRuns(limit).map((r) => ({
          runId: r.runId,
          graphId: r.graphId,
          status: r.status,
          currentNodeId: r.currentNodeId,
          stepCount: r.stepCount,
          pausedCheckpoint: r.pausedCheckpoint,
          error: r.error,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));
        sendJson(req, res, 200, { runs });
        return;
      }

      if (req.method === "POST" && path === "/api/runs") {
        const body = await readBody(req);
        const validated = validateGraph(body.graph);
        const initialData =
          body.initialData && typeof body.initialData === "object" && !Array.isArray(body.initialData)
            ? (body.initialData as Record<string, unknown>)
            : {};
        const run = await engine.startRun(validated, initialData);
        sendJson(req, res, 202, { runId: run.runId, status: run.status });
        return;
      }

      const cancelMatch = path.match(/^\/api\/runs\/([^/]+)\/cancel$/);
      if (req.method === "POST" && cancelMatch) {
        const runId = decodeURIComponent(cancelMatch[1]);
        const run = engine.cancelRun(runId);
        sendJson(req, res, 200, { ok: true, runId: run.runId, status: run.status });
        return;
      }

      const cpMatch = path.match(/^\/api\/runs\/([^/]+)\/checkpoint$/);
      if (req.method === "POST" && cpMatch) {
        const runId = decodeURIComponent(cpMatch[1]);
        const body = await readBody(req);
        const updated = await engine.signalCheckpoint(runId, {
          nodeId: String(body.nodeId || ""),
          action: body.action === "reject" ? "reject" : "approve",
          statePatch:
            body.statePatch && typeof body.statePatch === "object" && !Array.isArray(body.statePatch)
              ? (body.statePatch as Record<string, unknown>)
              : undefined,
          note: body.note ? String(body.note) : undefined,
        });
        sendJson(req, res, 200, { ok: true, runId: updated.runId, status: updated.status });
        return;
      }

      if (req.method === "GET" && path.startsWith("/api/runs/")) {
        const runId = decodeURIComponent(path.slice("/api/runs/".length));
        const run = engine.getRun(runId);
        if (!run) {
          sendJson(req, res, 404, { error: "Run not found" });
          return;
        }
        sendJson(req, res, 200, run);
        return;
      }

      // 5. Two-Tier Memory Explorer API
      if (req.method === "GET" && path === "/api/memory") {
        const q = url.searchParams.get("q")?.trim() || "";
        const scope = (url.searchParams.get("scope") || "both") as MemoryScope | "both";
        const items = q
          ? searchMemory({ query: q, scope, limit: 25 }, ROOT).map((r) => ({ ...r.record, score: r.score }))
          : [
              ...(scope === "global" ? [] : loadScopeMemories("project", ROOT, false)),
              ...(scope === "project" ? [] : loadScopeMemories("global", ROOT, false)),
            ];
        sendJson(req, res, 200, {
          items,
          profiles: {
            global: readCoreProfile("global", ROOT),
            project: readCoreProfile("project", ROOT),
          },
        });
        return;
      }

      if (req.method === "POST" && path === "/api/memory") {
        const body = await readBody(req);
        const scope: MemoryScope = body.scope === "global" ? "global" : "project";
        const resSave = upsertMemory(
          {
            scope,
            type: (body.type as MemoryType) || "semantic",
            title: String(body.title || "Untitled"),
            content: String(body.content || ""),
            tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
            entities: Array.isArray(body.entities) ? (body.entities as string[]) : [],
            importance: typeof body.importance === "number" ? body.importance : 0.75,
          },
          ROOT,
        );
        rebuildCoreProfile(scope, ROOT);
        sendJson(req, res, 200, resSave);
        return;
      }

      if (req.method === "POST" && path === "/api/memory/consolidate") {
        const counts = {
          project: drainInboxToEpisodic("project", ROOT),
          global: drainInboxToEpisodic("global", ROOT),
        };
        sendJson(req, res, 200, { ok: true, counts });
        return;
      }

      const supersedeMatch = path.match(/^\/api\/memory\/([^/]+)\/supersede$/);
      if (req.method === "POST" && supersedeMatch) {
        const id = decodeURIComponent(supersedeMatch[1]);
        const body = await readBody(req);
        const scope: MemoryScope = body.scope === "global" ? "global" : "project";
        const resSave = upsertMemory(
          {
            scope,
            type: (body.type as MemoryType) || "semantic",
            title: String(body.title || "Updated Memory"),
            content: String(body.content || ""),
            tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
            entities: Array.isArray(body.entities) ? (body.entities as string[]) : [],
            importance: typeof body.importance === "number" ? body.importance : 0.8,
            supersedes_id: id,
          },
          ROOT,
        );
        rebuildCoreProfile(scope, ROOT);
        sendJson(req, res, 200, resSave);
        return;
      }

      if (req.method === "DELETE" && path.startsWith("/api/memory/")) {
        const id = decodeURIComponent(path.slice("/api/memory/".length));
        const scopeParam = url.searchParams.get("scope");
        const scope: MemoryScope = scopeParam === "global" ? "global" : "project";
        const reason = url.searchParams.get("reason") || "archived_from_studio";
        const ok = archiveMemory(id, scope, reason, ROOT);
        if (!ok) {
          sendJson(req, res, 404, { error: "Memory record not found" });
          return;
        }
        rebuildCoreProfile(scope, ROOT);
        sendJson(req, res, 200, { ok: true, id, scope });
        return;
      }

      sendJson(req, res, 404, { error: "Not found" });
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(req, res, err.status, { error: err.message });
        return;
      }
      if (err instanceof GraphValidationError) {
        sendJson(req, res, 400, { error: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("Run not found:")) {
        sendJson(req, res, 404, { error: msg });
        return;
      }
      sendJson(req, res, 500, { error: msg });
    }
  });

  function closeAll(): void {
    clearInterval(heartbeatTimer);
    for (const res of sseClients) {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
    sseClients.clear();
    server.close();
    engine.close();
    closeMemoryIndexes();
  }

  return { server, engine, token: STUDIO_TOKEN, closeAll };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const ROOT = resolve(process.env.SOSHO_ROOT || join(import.meta.dirname, "../../.."));
  const PORT = Number(process.env.STUDIO_API_PORT || "4101");
  const { server, token, closeAll } = createStudioServer({ root: ROOT, port: PORT });

  const shutdown = () => {
    console.log("\n[Sosho Studio API] Shutting down cleanly...");
    closeAll();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[Sosho Studio API] Listening on http://127.0.0.1:${PORT} (root: ${ROOT})`);
    if (!process.env.SOSHO_STUDIO_TOKEN) {
      console.log(`[Sosho Studio API] Generated session bearer token (set SOSHO_STUDIO_TOKEN to override): ${token}`);
    }
  });
}
