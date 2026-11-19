import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  appendInboxEvent,
  archiveMemory,
  drainInboxToEpisodic,
  type MemoryScope,
  type MemoryType,
  readCoreProfile,
  rebuildCoreProfile,
  searchMemory,
  upsertMemory,
} from "../../../packages/memory/src/store.ts";

export default function memoryExtension(pi: ExtensionAPI): void {
  // 1. Inject compact Global + Project core profiles before agent start (KV-cache friendly)
  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const cwd = ctx.cwd || process.cwd();
      const globalProfile = readCoreProfile("global", cwd);
      const projectProfile = readCoreProfile("project", cwd);

      const sections: string[] = [
        "",
        "## Long-Term Memory (Global + Project)",
        "Use `memory_search` to recall past preferences, decisions, or playbooks; `memory_save` to store durable learnings (with `supersedes_id` when updating old facts); `memory_forget` to archive outdated entries.",
      ];

      if (globalProfile && !globalProfile.includes("No durable memories yet") && !globalProfile.includes("Auto-maintained compact summary")) {
        sections.push("", "### Global Profile (~/.sosho/memory)", globalProfile);
      }
      if (projectProfile && !projectProfile.includes("No durable memories yet") && !projectProfile.includes("Auto-maintained compact summary")) {
        sections.push("", "### Project Profile (.pi/memory)", projectProfile);
      }

      return {
        systemPrompt: `${event.systemPrompt}\n${sections.join("\n")}\n`,
      };
    } catch {
      return undefined;
    }
  });

  // 2. Bridge existing ephemeral/permanent scratchpad into long-term memory inbox on shutdown
  pi.on("session_shutdown", async (_event, ctx) => {
    try {
      const cwd = ctx.cwd || process.cwd();
      const ephemeralDir = process.env.SOSHO_EPHEMERAL_DIR;
      if (!ephemeralDir) return;
      const statePath = join(ephemeralDir, "state.json");
      if (!existsSync(statePath)) return;

      const state = JSON.parse(readFileSync(statePath, "utf8")) as {
        session_id?: string;
        active_task?: { title?: string; goal?: string } | null;
        history?: Array<{ title: string; goal: string; summary: string; completed: number; total: number }>;
      };

      const history = state.history || [];
      if (history.length === 0) return;

      const latest = history[history.length - 1];
      appendInboxEvent(
        {
          timestamp: new Date().toISOString(),
          scope: "project",
          kind: "session_summary",
          title: `Session task: ${latest.title}`,
          content: `Goal: ${latest.goal}\nCompleted: ${latest.completed}/${latest.total}\nSummary: ${latest.summary}`,
          tags: ["session", "scratchpad"],
          source: { session_id: state.session_id || process.env.SOSHO_SESSION_ID },
        },
        cwd,
      );
    } catch {
      // Ignore shutdown capture errors
    }
  });

  // 3. Tool: memory_search
  pi.registerTool({
    name: "memory_search",
    label: "Search Memory",
    description:
      "Hybrid BM25 + semantic vector search across Global (~/.sosho/memory) and Project (.pi/memory) long-term memories with temporal decay and scope precedence.",
    promptSnippet: "memory_search: Search global and project long-term memories",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (keywords, entities, or natural language)" },
        scope: {
          type: "string",
          enum: ["both", "project", "global"],
          description: "Which memory scope to search (default 'both')",
        },
        types: {
          type: "array",
          items: { type: "string", enum: ["semantic", "procedural", "episodic", "entity"] },
          description: "Optional filter by memory type",
        },
        limit: { type: "number", description: "Max results (default 8)" },
      },
      required: ["query"],
    } as any,
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx: ExtensionContext) {
      const params = rawParams as {
        query: string;
        scope?: MemoryScope | "both";
        types?: MemoryType[];
        limit?: number;
      };
      const cwd = ctx.cwd || process.cwd();
      const results = searchMemory(
        {
          query: params.query,
          scope: params.scope || "both",
          types: params.types,
          limit: params.limit ?? 8,
        },
        cwd,
      );

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No matching memories found." }],
          details: { count: 0 },
        };
      }

      const formatted = results.map(
        (r, idx) =>
          `${idx + 1}. **[${r.record.id}] ${r.record.title}** *(${r.record.scope}/${r.record.type}, score=${r.score.toFixed(4)})*\n` +
          `${r.record.content}`,
      );

      return {
        content: [{ type: "text", text: formatted.join("\n\n") }],
        details: { count: results.length, ids: results.map((r) => r.record.id) },
      };
    },
  });

  // 4. Tool: memory_save
  pi.registerTool({
    name: "memory_save",
    label: "Save Memory",
    description:
      "Persist a durable memory to Global (~/.sosho/memory, for personal preferences/life/cross-project rules) or Project (.pi/memory, for repo architecture/bugs/decisions). Pass supersedes_id to cleanly archive and replace an outdated memory.",
    promptSnippet: "memory_save: Save or supersede a global/project long-term memory",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short descriptive title" },
        content: { type: "string", description: "Concise, atomic memory content" },
        scope: {
          type: "string",
          enum: ["project", "global"],
          description: "Target scope: 'project' (repo-specific) or 'global' (personal/cross-project)",
        },
        type: {
          type: "string",
          enum: ["semantic", "procedural", "episodic", "entity"],
          description: "Memory category (default 'semantic')",
        },
        tags: { type: "array", items: { type: "string" } },
        entities: { type: "array", items: { type: "string" } },
        importance: { type: "number", description: "0.0 to 1.0 (default 0.7)" },
        supersedes_id: {
          type: "string",
          description: "Optional existing memory ID that this new memory replaces",
        },
      },
      required: ["title", "content", "scope"],
    } as any,
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx: ExtensionContext) {
      const params = rawParams as {
        title: string;
        content: string;
        scope: MemoryScope;
        type?: MemoryType;
        tags?: string[];
        entities?: string[];
        importance?: number;
        supersedes_id?: string;
      };
      const cwd = ctx.cwd || process.cwd();
      const res = upsertMemory(
        {
          scope: params.scope,
          type: params.type || "semantic",
          title: params.title,
          content: params.content,
          tags: params.tags,
          entities: params.entities,
          importance: params.importance,
          supersedes_id: params.supersedes_id,
          source: { session_id: ctx.sessionManager?.getSessionId?.() || process.env.SOSHO_SESSION_ID },
        },
        cwd,
      );
      rebuildCoreProfile(params.scope, cwd);

      return {
        content: [
          {
            type: "text",
            text: `${res.action} memory **[${res.record.id}]** in \`${res.record.scope}/${res.record.type}\`${res.superseded ? ` (superseded \`${res.superseded}\`)` : ""}.`,
          },
        ],
        details: res,
      };
    },
  });

  // 5. Tool: memory_forget
  pi.registerTool({
    name: "memory_forget",
    label: "Archive Memory",
    description: "Archive an outdated or incorrect memory by ID (moves to archive/ with audit trail).",
    promptSnippet: "memory_forget: Archive an outdated memory by ID",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory ID (e.g., mem_p_... or mem_g_...)" },
        scope: { type: "string", enum: ["project", "global"] },
        reason: { type: "string", description: "Why this memory is being archived" },
      },
      required: ["id", "scope"],
    } as any,
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx: ExtensionContext) {
      const params = rawParams as { id: string; scope: MemoryScope; reason?: string };
      const cwd = ctx.cwd || process.cwd();
      const ok = archiveMemory(params.id, params.scope, params.reason || "manual_forget", cwd);
      if (ok) rebuildCoreProfile(params.scope, cwd);
      return {
        content: [
          {
            type: "text",
            text: ok
              ? `Archived memory \`${params.id}\` in \`${params.scope}\`.`
              : `Memory \`${params.id}\` not found in active \`${params.scope}\` memories.`,
          },
        ],
        details: { ok, id: params.id, scope: params.scope },
      };
    },
  });

  // 6. Tool: memory_consolidate
  pi.registerTool({
    name: "memory_consolidate",
    label: "Consolidate Memory",
    description: "Drain pending inbox events into episodic memory and refresh core/profile.md.",
    promptSnippet: "memory_consolidate: Consolidate inbox events and refresh core profile",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["both", "project", "global"] },
      },
    } as any,
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx: ExtensionContext) {
      const params = (rawParams || {}) as { scope?: MemoryScope | "both" };
      const cwd = ctx.cwd || process.cwd();
      const scopes: MemoryScope[] =
        params.scope === "global"
          ? ["global"]
          : params.scope === "project"
            ? ["project"]
            : ["project", "global"];

      const counts: Record<string, number> = {};
      for (const s of scopes) {
        counts[s] = drainInboxToEpisodic(s, cwd);
      }

      return {
        content: [
          {
            type: "text",
            text: `Consolidated memory inbox (${Object.entries(counts)
              .map(([k, v]) => `${k}: ${v} events`)
              .join(", ")}) and refreshed \`core/profile.md\`.`,
          },
        ],
        details: counts,
      };
    },
  });
}
