import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { validateGraph } from "../../../../packages/workflow-engine/src/schema.ts";
import { HttpError, isSafeWorkflowId, readJsonObject, type StudioContext } from "../context.ts";

export function createWorkflowsRoutes(ctx: StudioContext): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const files = readdirSync(ctx.workflowsDir).filter((f) => f.endsWith(".graph.json"));
    const workflows = files.map((f) => {
      const g = JSON.parse(readFileSync(join(ctx.workflowsDir, f), "utf8")) as {
        id: string;
        name: string;
        description?: string;
      };
      return { file: f, id: g.id, name: g.name, description: g.description || "" };
    });
    return c.json({ workflows });
  });

  app.get("/:id", (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    if (!isSafeWorkflowId(id)) {
      throw new HttpError(400, "Invalid workflow ID");
    }
    const files = readdirSync(ctx.workflowsDir).filter((f) => f.endsWith(".graph.json"));
    for (const f of files) {
      const g = JSON.parse(readFileSync(join(ctx.workflowsDir, f), "utf8")) as { id: string };
      if (g.id === id || f === id) {
        return c.json(g);
      }
    }
    throw new HttpError(404, "Workflow not found");
  });

  app.post("/", async (c) => {
    const graph = await readJsonObject(c);
    const rawId = graph.id !== undefined ? String(graph.id).trim() : `wf-${randomBytes(3).toString("hex")}`;
    if (!isSafeWorkflowId(rawId)) {
      throw new HttpError(400, "Invalid workflow ID");
    }
    graph.id = rawId;
    const validated = validateGraph(graph);
    let outPath = join(ctx.workflowsDir, `${validated.id}.graph.json`);
    const existingFiles = readdirSync(ctx.workflowsDir).filter((f) => f.endsWith(".graph.json"));
    for (const f of existingFiles) {
      try {
        const existing = JSON.parse(readFileSync(join(ctx.workflowsDir, f), "utf8")) as { id?: string };
        if (existing.id === validated.id) {
          outPath = join(ctx.workflowsDir, f);
          break;
        }
      } catch {
        // ignore unreadable file
      }
    }
    writeFileSync(outPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    return c.json({ ok: true, id: validated.id, path: outPath });
  });

  app.delete("/:id", (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    if (!isSafeWorkflowId(id)) {
      throw new HttpError(400, "Invalid workflow ID");
    }
    const files = readdirSync(ctx.workflowsDir).filter((f) => f.endsWith(".graph.json"));
    for (const f of files) {
      const full = join(ctx.workflowsDir, f);
      const g = JSON.parse(readFileSync(full, "utf8")) as { id: string };
      if (g.id === id || f === id) {
        unlinkSync(full);
        return c.json({ ok: true, id });
      }
    }
    throw new HttpError(404, "Workflow not found");
  });

  return app;
}
