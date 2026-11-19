import { Hono } from "hono";
import { z } from "zod";
import { validateGraph } from "../../../../packages/workflow-engine/src/schema.ts";
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

export function createRunsRoutes(ctx: StudioContext): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const rawLimit = Number(c.req.query("limit") || "50");
    const limit = Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50));
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
    const run = await ctx.engine.startRun(validated, body.initialData ?? {});
    return c.json({ runId: run.runId, status: run.status }, 202);
  });

  app.post("/:id/cancel", (c) => {
    const runId = decodeURIComponent(c.req.param("id"));
    const run = ctx.engine.cancelRun(runId);
    return c.json({ ok: true, runId: run.runId, status: run.status });
  });

  app.post("/:id/checkpoint", async (c) => {
    const runId = decodeURIComponent(c.req.param("id"));
    const body = await parseValidatedBody(c, checkpointSchema);
    const updated = await ctx.engine.signalCheckpoint(runId, {
      nodeId: body.nodeId,
      action: body.action,
      statePatch: body.statePatch,
      note: body.note,
    });
    return c.json({ ok: true, runId: updated.runId, status: updated.status });
  });

  app.get("/:id", (c) => {
    const runId = decodeURIComponent(c.req.param("id"));
    const run = ctx.engine.getRun(runId);
    if (!run) {
      throw new HttpError(404, "Run not found");
    }
    return c.json(run);
  });

  return app;
}
