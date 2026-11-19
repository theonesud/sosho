import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { Client, Connection } from "@temporalio/client";
import {
  drainInboxToEpisodic,
  loadScopeMemories,
  type MemoryScope,
  type MemoryType,
  readCoreProfile,
  rebuildCoreProfile,
  searchMemory,
  upsertMemory,
} from "../../../packages/memory/src/store.ts";

const ROOT = resolve(process.env.SOSHO_ROOT || join(import.meta.dirname, "../../.."));
const WORKFLOWS_DIR = join(ROOT, "workflows");
const SKILLS_DIR = join(ROOT, ".pi", "skills");
const PORT = Number(process.env.STUDIO_API_PORT || "4101");
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || "127.0.0.1:7233";

mkdirSync(WORKFLOWS_DIR, { recursive: true });

// SSE subscribers for live canvas updates
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

let temporalClientPromise: Promise<Client> | null = null;
async function getTemporalClient(): Promise<Client> {
  if (!temporalClientPromise) {
    temporalClientPromise = Connection.connect({ address: TEMPORAL_ADDRESS }).then(
      (connection) => new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE || "default" }),
    );
  }
  return temporalClientPromise;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const path = url.pathname;

    // 1. SSE Live Events Stream
    if (req.method === "GET" && path === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (req.method === "POST" && path === "/api/events") {
      const body = await readBody(req);
      broadcastEvent(body);
      sendJson(res, 200, { ok: true });
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
      sendJson(res, 200, { workflows: list });
      return;
    }

    if (req.method === "GET" && path.startsWith("/api/workflows/")) {
      const id = decodeURIComponent(path.slice("/api/workflows/".length));
      const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".graph.json"));
      for (const f of files) {
        const g = JSON.parse(readFileSync(join(WORKFLOWS_DIR, f), "utf8")) as { id: string };
        if (g.id === id || f === id) {
          sendJson(res, 200, g);
          return;
        }
      }
      sendJson(res, 404, { error: "Workflow not found" });
      return;
    }

    if (req.method === "POST" && path === "/api/workflows") {
      const graph = await readBody(req);
      const id = String(graph.id || `wf-${randomBytes(3).toString("hex")}`).replace(/[^a-zA-Z0-9_-]/g, "-");
      graph.id = id;
      const outPath = join(WORKFLOWS_DIR, `${id}.graph.json`);
      writeFileSync(outPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
      sendJson(res, 200, { ok: true, id, path: outPath });
      return;
    }

    // 3. Skills Discovery
    if (req.method === "GET" && path === "/api/skills") {
      const skills = existsSync(SKILLS_DIR)
        ? readdirSync(SKILLS_DIR, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
        : [];
      sendJson(res, 200, { skills });
      return;
    }

    // 4. Temporal Run Control & HITL Checkpoints
    if (req.method === "POST" && path === "/api/runs") {
      const body = await readBody(req);
      const client = await getTemporalClient();
      const runId = `sosho-${String((body.graph as { id?: string })?.id || "run")}-${randomBytes(3).toString("hex")}`;
      const handle = await client.workflow.start("executeGraphWorkflow", {
        taskQueue: "cloud-io",
        workflowId: runId,
        args: [
          {
            graph: body.graph,
            initialData: (body.initialData as Record<string, unknown>) || {},
            cwd: ROOT,
          },
        ],
      });
      sendJson(res, 202, { runId: handle.workflowId });
      return;
    }

    if (req.method === "GET" && path.startsWith("/api/runs/")) {
      const runId = decodeURIComponent(path.slice("/api/runs/".length));
      const client = await getTemporalClient();
      const handle = client.workflow.getHandle(runId);
      const state = await handle.query("getRunState");
      sendJson(res, 200, state);
      return;
    }

    if (req.method === "POST" && path.match(/^\/api\/runs\/[^/]+\/checkpoint$/)) {
      const runId = decodeURIComponent(path.split("/")[3]);
      const body = await readBody(req);
      const client = await getTemporalClient();
      const handle = client.workflow.getHandle(runId);
      await handle.signal("checkpointDecision", {
        nodeId: String(body.nodeId),
        action: body.action === "reject" ? "reject" : "approve",
        statePatch: body.statePatch as Record<string, unknown> | undefined,
        note: body.note ? String(body.note) : undefined,
      });
      sendJson(res, 200, { ok: true, runId });
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
      sendJson(res, 200, {
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
          importance: typeof body.importance === "number" ? body.importance : 0.75,
        },
        ROOT,
      );
      rebuildCoreProfile(scope, ROOT);
      sendJson(res, 200, resSave);
      return;
    }

    if (req.method === "POST" && path === "/api/memory/consolidate") {
      const counts = {
        project: drainInboxToEpisodic("project", ROOT),
        global: drainInboxToEpisodic("global", ROOT),
      };
      sendJson(res, 200, { ok: true, counts });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[Sosho Studio API] Listening on http://127.0.0.1:${PORT} (root: ${ROOT})`);
});
