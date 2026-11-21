import { Hono } from "hono";
import { z } from "zod";
import {
  archiveMemory,
  drainInboxToEpisodic,
  loadScopeMemories,
  type MemoryScope,
  type MemoryType,
  readCoreProfile,
  rebuildCoreProfile,
  searchMemoryAsync,
  upsertMemory,
} from "@sosho/memory";
import { HttpError, parseValidatedBody, type StudioContext } from "../context.ts";

const MEMORY_TYPES = ["semantic", "episodic", "procedural", "entity"] as const;

const createMemorySchema = z.object({
  scope: z.enum(["project", "global"]).default("project"),
  type: z.enum(MEMORY_TYPES).default("semantic"),
  title: z.string().min(1).default("Untitled"),
  content: z.string().default(""),
  tags: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
  importance: z.number().min(0).max(1).default(0.75),
});

const supersedeMemorySchema = z.object({
  scope: z.enum(["project", "global"]).default("project"),
  type: z.enum(MEMORY_TYPES).default("semantic"),
  title: z.string().min(1).default("Updated Memory"),
  content: z.string().default(""),
  tags: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
  importance: z.number().min(0).max(1).default(0.8),
});

function parseTypesParam(raw: string | undefined): MemoryType[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is MemoryType => (MEMORY_TYPES as readonly string[]).includes(s));
  return parts.length > 0 ? parts : undefined;
}

export function createMemoryRoutes(ctx: StudioContext): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const q = c.req.query("q")?.trim() || "";
    const rawScope = c.req.query("scope") || "both";
    const scope: MemoryScope | "both" = rawScope === "global" || rawScope === "project" ? rawScope : "both";
    const includeArchived = c.req.query("includeArchived") === "true";
    const types = parseTypesParam(c.req.query("types"));
    const rawLimit = Number(c.req.query("limit") || "25");
    const limit = Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 25));
    const rawMaxTokens = c.req.query("maxTokens");
    const maxTokens =
      rawMaxTokens && Number.isFinite(Number(rawMaxTokens)) && Number(rawMaxTokens) > 0
        ? Number(rawMaxTokens)
        : undefined;

    let items: Array<Record<string, unknown>>;
    if (q) {
      const results = await searchMemoryAsync(
        {
          query: q,
          scope,
          types,
          limit,
          maxTokens,
          includeArchived,
        },
        ctx.root,
      );
      items = results.map((r) => ({
        ...r.record,
        score: r.score,
        lexicalScore: r.lexicalScore,
        vectorScore: r.vectorScore,
        graphBoost: r.graphBoost,
      }));
    } else {
      const loaded = [
        ...(scope === "global" ? [] : loadScopeMemories("project", ctx.root, includeArchived)),
        ...(scope === "project" ? [] : loadScopeMemories("global", ctx.root, includeArchived)),
      ];
      const filtered = types ? loaded.filter((m) => types.includes(m.type)) : loaded;
      items = filtered.slice(0, limit).map((m) => ({ ...m }));
    }

    return c.json({
      items,
      profiles: {
        global: readCoreProfile("global", ctx.root),
        project: readCoreProfile("project", ctx.root),
      },
    });
  });

  app.post("/", async (c) => {
    const body = await parseValidatedBody(c, createMemorySchema);
    const resSave = upsertMemory(
      {
        scope: body.scope,
        type: body.type,
        title: body.title,
        content: body.content,
        tags: body.tags,
        entities: body.entities,
        importance: body.importance,
      },
      ctx.root,
    );
    rebuildCoreProfile(body.scope, ctx.root);
    return c.json(resSave);
  });

  app.post("/consolidate", (c) => {
    const counts = {
      project: drainInboxToEpisodic("project", ctx.root),
      global: drainInboxToEpisodic("global", ctx.root),
    };
    return c.json({ ok: true, counts });
  });

  app.post("/:id/supersede", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const body = await parseValidatedBody(c, supersedeMemorySchema);
    const resSave = upsertMemory(
      {
        scope: body.scope,
        type: body.type,
        title: body.title,
        content: body.content,
        tags: body.tags,
        entities: body.entities,
        importance: body.importance,
        supersedes_id: id,
      },
      ctx.root,
    );
    rebuildCoreProfile(body.scope, ctx.root);
    return c.json(resSave);
  });

  app.delete("/:id", (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const scopeParam = c.req.query("scope");
    const scope: MemoryScope = scopeParam === "global" ? "global" : "project";
    const reason = c.req.query("reason") || "archived_from_studio";
    const ok = archiveMemory(id, scope, reason, ctx.root);
    if (!ok) {
      throw new HttpError(404, "Memory record not found");
    }
    rebuildCoreProfile(scope, ctx.root);
    return c.json({ ok: true, id, scope });
  });

  return app;
}
