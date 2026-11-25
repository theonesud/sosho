import { Hono } from "hono";
import { readJsonObject, type StudioContext } from "../context.ts";

export function createEventsRoutes(ctx: StudioContext): Hono {
  const app = new Hono();

  app.get("/", () => {
    return new Response(ctx.sse.subscribe(), {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  app.post("/", async (c) => {
    const body = await readJsonObject(c);
    ctx.sse.broadcast(body);
    return c.json({ ok: true });
  });

  return app;
}
