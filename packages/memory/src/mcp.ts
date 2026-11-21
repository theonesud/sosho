import { createInterface } from "node:readline";
import { archiveMemory, type MemoryScope, type MemoryType, searchMemoryAsync, upsertMemory } from "./store.ts";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: "memory_search",
    description: "Search global and project Sosho memories using hybrid FTS5, vector, and entity recall.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        scope: { type: "string", enum: ["global", "project", "both"] },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_add",
    description: "Store a durable memory record in global or project scope with secret redaction.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["global", "project"] },
        type: { type: "string", enum: ["semantic", "procedural", "episodic", "entity"] },
        title: { type: "string" },
        content: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["scope", "type", "title", "content"],
    },
  },
  {
    name: "memory_archive",
    description: "Archive a memory record by scope and id.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["global", "project"] },
        id: { type: "string" },
      },
      required: ["scope", "id"],
    },
  },
];

function send(msg: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  if (req.id === undefined) return;
  const id = req.id;

  if (req.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "sosho-memory", version: "0.1.0" },
      },
    });
    return;
  }

  if (req.method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }

  if (req.method === "tools/call") {
    const name = String(req.params?.name || "");
    const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
    try {
      let data: unknown;
      if (name === "memory_search") {
        const scopeArg = args.scope === "global" || args.scope === "project" ? args.scope : "both";
        data = await searchMemoryAsync(
          {
            query: String(args.query || ""),
            scope: scopeArg,
            limit: typeof args.limit === "number" ? args.limit : 10,
          },
          process.cwd(),
        );
      } else if (name === "memory_add") {
        data = upsertMemory(
          {
            scope: (args.scope === "global" ? "global" : "project") as MemoryScope,
            type: String(args.type || "semantic") as MemoryType,
            title: String(args.title || ""),
            content: String(args.content || ""),
            tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
          },
          process.cwd(),
        );
      } else if (name === "memory_archive") {
        data = { archived: archiveMemory(String(args.id || ""), (args.scope === "global" ? "global" : "project") as MemoryScope, process.cwd()) };
      } else {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });
        return;
      }
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(data) }] },
      });
    } catch (err) {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
      });
    }
    return;
  }

  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${req.method}` } });
}

const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed) as JsonRpcRequest;
    void handleRequest(parsed);
  } catch {
    // Ignore malformed JSON-RPC lines
  }
});
