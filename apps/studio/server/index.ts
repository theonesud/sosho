import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { join, resolve } from "node:path";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { closeMemoryIndexes } from "../../../packages/memory/src/store.ts";
import { type NodeExecutor, WorkflowEngine } from "../../../packages/workflow-engine/src/engine.ts";
import { GraphValidationError } from "../../../packages/workflow-engine/src/schema.ts";
import { HttpError, isSafeWorkflowId, MAX_BODY_BYTES, type StudioContext } from "./context.ts";
import { createOpenApiRoutes } from "./openapi.ts";
import { createEventsRoutes } from "./routes/events.ts";
import { createMemoryRoutes } from "./routes/memory.ts";
import { createMusicRoutes } from "./routes/music.ts";
import { createPlaygroundRoutes } from "./routes/playground.ts";
import { createRunsRoutes } from "./routes/runs.ts";
import { createSkillsRoutes } from "./routes/skills.ts";
import { createSystemRoutes } from "./routes/system.ts";
import { createToolsRoutes } from "./routes/tools.ts";
import { createWorkflowsRoutes } from "./routes/workflows.ts";
import { SseHub } from "./sse.ts";

export { isSafeWorkflowId };

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:3000",
  "http://localhost:3000",
]);

const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE"]);

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

function verifyBearerHeader(auth: string | undefined, expectedToken: string): boolean {
  if (!auth?.startsWith("Bearer ")) return false;
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
  langgraphUrl?: string;
  langflowUrl?: string;
}

export function createStudioServer(options: StudioServerOptions = {}): {
  server: Server;
  app: Hono;
  engine: WorkflowEngine;
  sse: SseHub;
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

  const sse = new SseHub(HEARTBEAT_MS);

  // Forward in-process SQLite DAG engine events directly to SSE subscribers
  engine.on("event", (ev: Record<string, unknown>) => {
    sse.broadcast(ev);
  });

  // Recover any interrupted 'running' runs on startup
  engine.recoverInterruptedRuns();

  const langgraphUrl = (options.langgraphUrl ?? process.env.LANGGRAPH_URL)?.trim().replace(/\/+$/, "") || undefined;
  const langflowUrl = (options.langflowUrl ?? process.env.LANGFLOW_URL)?.trim().replace(/\/+$/, "") || undefined;

  const ctx: StudioContext = {
    root: ROOT,
    workflowsDir: WORKFLOWS_DIR,
    skillsDir: SKILLS_DIR,
    port: PORT,
    engine,
    sse,
    langgraphUrl,
    langflowUrl,
  };

  const app = new Hono();

  // Strict loopback CORS + Origin check + Bearer auth + Content-Length guard
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    c.header("Vary", "Origin");

    if (origin) {
      if (!DEFAULT_ALLOWED_ORIGINS.has(origin)) {
        return c.json({ error: "Origin not allowed" }, 403);
      }
      c.header("Access-Control-Allow-Origin", origin);
    }

    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }

    if (MUTATING_METHODS.has(c.req.method)) {
      if (!verifyBearerHeader(c.req.header("authorization"), STUDIO_TOKEN)) {
        return c.json({ error: "Unauthorized: missing or invalid bearer token" }, 401);
      }
      const contentLength = Number(c.req.header("content-length") || "0");
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        return c.json({ error: "Payload too large (max 1 MiB)" }, 413);
      }
    }

    await next();
  });

  // Root & Health Info
  const healthPayload = {
    service: "sosho-studio-api",
    status: "ok",
    ui: "http://127.0.0.1:3000",
    endpoints: [
      "/api/system/status",
      "/api/system/gpu",
      "/api/system/gpu/unload",
      "/api/system/doctor",
      "/api/workflows",
      "/api/runs",
      "/api/memory",
      "/api/skills",
      "/api/music/jobs",
      "/api/playground/chat",
      "/api/playground/compare",
      "/api/playground/skill",
      "/api/tools/memory/search",
      "/api/tools/memory/add",
      "/api/tools/music/generate",
      "/api/tools/pi/run",
      "/api/events",
      "/api/openapi.json",
      "/api/docs",
    ],
  };

  app.get("/", (c) => c.json(healthPayload));
  app.get("/health", (c) => c.json(healthPayload));

  // Mount modular route groups
  app.route("/api/workflows", createWorkflowsRoutes(ctx));
  app.route("/api/runs", createRunsRoutes(ctx));
  app.route("/api/memory", createMemoryRoutes(ctx));
  app.route("/api/music", createMusicRoutes(ctx));
  app.route("/api/playground", createPlaygroundRoutes(ctx));
  app.route("/api/system", createSystemRoutes(ctx));
  app.route("/api/skills", createSkillsRoutes(ctx));
  app.route("/api/tools", createToolsRoutes(ctx));
  app.route("/api/events", createEventsRoutes(ctx));
  app.route("/api", createOpenApiRoutes());

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      const payload: Record<string, unknown> = { error: err.message };
      if (err.details !== undefined) payload.details = err.details;
      return c.json(payload, err.status as ContentfulStatusCode);
    }
    if (err instanceof GraphValidationError) {
      return c.json({ error: err.message }, 400);
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("Run not found:")) {
      return c.json({ error: msg }, 404);
    }
    return c.json({ error: msg }, 500);
  });

  const server = createAdaptorServer({ fetch: app.fetch }) as Server;

  function closeAll(): void {
    sse.closeAll();
    server.close();
    engine.close();
    closeMemoryIndexes();
  }

  return { server, app, engine, sse, token: STUDIO_TOKEN, closeAll };
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
