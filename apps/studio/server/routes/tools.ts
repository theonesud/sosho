import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Hono } from "hono";
import { z } from "zod";
import { loadEnvMap } from "../../../../packages/llm/src/index.ts";
import { searchMemoryAsync, upsertMemory } from "../../../../packages/memory/src/store.ts";
import { HttpError, parseValidatedBody, type StudioContext } from "../context.ts";

const execFileAsync = promisify(execFile);

const memorySearchSchema = z.object({
  query: z.string().min(1),
  scope: z.enum(["global", "project", "both"]).default("both"),
  limit: z.number().int().min(1).max(50).default(10),
});

const memoryAddSchema = z.object({
  scope: z.enum(["global", "project"]).default("project"),
  type: z.enum(["semantic", "procedural", "episodic", "entity"]).default("semantic"),
  title: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

const musicGenerateSchema = z.object({
  prompt: z.string().min(1),
  lyrics: z.string().optional(),
  duration_seconds: z.number().int().min(5).max(300).optional(),
});

const piRunSchema = z.object({
  prompt: z.string().min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().min(1000).max(300_000).default(120_000),
});

export function createToolsRoutes(ctx: StudioContext): Hono {
  const app = new Hono();

  app.post("/memory/search", async (c) => {
    const body = await parseValidatedBody(c, memorySearchSchema);
    const results = await searchMemoryAsync(
      {
        query: body.query,
        scope: body.scope,
        limit: body.limit,
      },
      ctx.root,
    );
    return c.json({ results });
  });

  app.post("/memory/add", async (c) => {
    const body = await parseValidatedBody(c, memoryAddSchema);
    const created = upsertMemory(
      {
        scope: body.scope,
        type: body.type,
        title: body.title,
        content: body.content,
        tags: body.tags,
      },
      ctx.root,
    );
    return c.json(created, 201);
  });

  app.post("/music/generate", async (c) => {
    const body = await parseValidatedBody(c, musicGenerateSchema);
    const env = loadEnvMap(ctx.root, ctx.root);
    const gatewayUrl = (env.YUE2_GATEWAY_URL || "http://127.0.0.1:8021").replace(/\/+$/, "");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (env.YUE2_API_KEY) {
      headers.Authorization = `Bearer ${env.YUE2_API_KEY}`;
    }
    const res = await fetch(`${gatewayUrl}/v1/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(res.status, `YuE2 gateway error: ${text.slice(0, 300)}`);
    }
    return c.json(JSON.parse(text) as Record<string, unknown>, 202);
  });

  app.post("/pi/run", async (c) => {
    const body = await parseValidatedBody(c, piRunSchema);
    const { stdout, stderr } = await execFileAsync("pi", ["--print", "--no-session", body.prompt], {
      cwd: body.cwd || ctx.root,
      timeout: body.timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    return c.json({ ok: true, stdout, stderr });
  });

  return app;
}
