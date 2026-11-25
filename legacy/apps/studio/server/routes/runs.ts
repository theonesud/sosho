import { Hono } from "hono";
import { z } from "zod";
import { validateGraph } from "@sosho/workflow-engine/schema";
import { HttpError, parseValidatedBody, type StudioContext } from "../context.ts";

const startRunSchema = z.object({
  graph: z.record(z.string(), z.unknown()),
  initialData: z.record(z.string(), z.unknown()).optional(),
});

const checkpointSchema = z.object({
  nodeId: z.string().min(1),
  action: z.enum(["approve", "reject"]).default("approve"),
  statePatch: z.record(z.string(), z.unknown()).optional(),
  note: z.string().optional(),
});

const rollbackSchema = z.object({
  toStep: z.number().int().min(1).optional(),
});

async function proxyLangGraph(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: unknown = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const errMsg =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : `LangGraph HTTP ${res.status}`;
    throw new HttpError(res.status, errMsg);
  }
  return { status: res.status, data };
}

export function createRunsRoutes(ctx: StudioContext): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const rawLimit = Number(c.req.query("limit") || "50");
    const limit = Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50));
    if (ctx.langgraphUrl) {
      const { data } = await proxyLangGraph(ctx.langgraphUrl, `/runs?limit=${limit}`);
      return c.json(Array.isArray(data) ? { runs: data } : (data as Record<string, unknown>));
    }
    const runs = ctx.engine.listRuns(limit).map((r) => ({
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
    return c.json({ runs });
  });

  app.post("/", async (c) => {
    const body = await parseValidatedBody(c, startRunSchema);
    const validated = validateGraph(body.graph);
    if (ctx.langgraphUrl) {
      const { data } = await proxyLangGraph(ctx.langgraphUrl, "/runs", {
        method: "POST",
        body: JSON.stringify({ assistant_id: validated.id, input: body.initialData ?? {}, graph: validated }),
      });
      const obj = data as Record<string, unknown>;
      return c.json({ runId: obj.run_id ?? obj.runId, status: obj.status ?? "pending" }, 202);
    }
    const run = await ctx.engine.startRun(validated, body.initialData ?? {});
    return c.json({ runId: run.runId, status: run.status }, 202);
  });

  app.post("/:id/cancel", async (c) => {
    const runId = decodeURIComponent(c.req.param("id"));
    if (ctx.langgraphUrl) {
      await proxyLangGraph(ctx.langgraphUrl, `/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
      return c.json({ ok: true, runId, status: "cancelled" });
    }
    const run = ctx.engine.cancelRun(runId);
    return c.json({ ok: true, runId: run.runId, status: run.status });
  });

  app.post("/:id/checkpoint", async (c) => {
    const runId = decodeURIComponent(c.req.param("id"));
    const body = await parseValidatedBody(c, checkpointSchema);
    if (ctx.langgraphUrl) {
      const { data } = await proxyLangGraph(ctx.langgraphUrl, `/runs/${encodeURIComponent(runId)}/checkpoint`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const obj = data as Record<string, unknown>;
      return c.json({ ok: true, runId, status: obj.status ?? "running" });
    }
    const updated = await ctx.engine.signalCheckpoint(runId, {
      nodeId: body.nodeId,
      action: body.action,
      statePatch: body.statePatch,
      note: body.note,
    });
    return c.json({ ok: true, runId: updated.runId, status: updated.status });
  });

  app.post("/:id/rollback", async (c) => {
    const runId = decodeURIComponent(c.req.param("id"));
    const body = await parseValidatedBody(c, rollbackSchema).catch(() => ({ toStep: undefined }));
    const updated = await ctx.engine.rollbackRun(runId, body.toStep);
    return c.json({ ok: true, runId: updated.runId, status: updated.status, currentNodeId: updated.currentNodeId });
  });

  app.get("/:id", async (c) => {
    const runId = decodeURIComponent(c.req.param("id"));
    if (ctx.langgraphUrl) {
      const { data } = await proxyLangGraph(ctx.langgraphUrl, `/runs/${encodeURIComponent(runId)}`);
      return c.json(data as Record<string, unknown>);
    }
    const run = ctx.engine.getRun(runId);
    if (!run) {
      throw new HttpError(404, "Run not found");
    }
    return c.json(run);
  });

  return app;
}
