import { Hono } from "hono";
import { readJsonObject, type StudioContext } from "../context.ts";

function getYue2Config() {
  const baseUrl = (process.env.YUE2_GATEWAY_URL || "http://127.0.0.1:8021").replace(/\/+$/, "");
  const apiKey = process.env.YUE2_API_KEY?.trim() || "";
  return { baseUrl, apiKey };
}

function buildUpstreamHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

export function createMusicRoutes(ctx: StudioContext): Hono {
  const app = new Hono();

  // Stream audio directly with HTTP Range header passthrough (no arrayBuffer buffering)
  app.get("/jobs/:id/audio", async (c) => {
    const { baseUrl, apiKey } = getYue2Config();
    const id = encodeURIComponent(c.req.param("id"));
    const range = c.req.header("range");
    const headers = buildUpstreamHeaders(apiKey, range ? { Range: range } : undefined);

    try {
      const upstream = await fetch(`${baseUrl}/v1/jobs/${id}/audio`, {
        method: "GET",
        headers,
      });

      const respHeaders = new Headers();
      for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "cache-control"]) {
        const val = upstream.headers.get(h);
        if (val) respHeaders.set(h, val);
      }
      if (!respHeaders.has("content-type")) {
        respHeaders.set("content-type", "audio/flac");
      }

      return new Response(upstream.body, {
        status: upstream.status,
        headers: respHeaders,
      });
    } catch (err) {
      return c.json({ error: `YuE2 gateway unreachable: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
  });

  // Cancel a YuE2 job
  app.post("/jobs/:id/cancel", async (c) => {
    const { baseUrl, apiKey } = getYue2Config();
    const id = encodeURIComponent(c.req.param("id"));
    try {
      const upstream = await fetch(`${baseUrl}/v1/jobs/${id}/cancel`, {
        method: "POST",
        headers: buildUpstreamHeaders(apiKey),
        signal: AbortSignal.timeout(15_000),
      });
      const ct = upstream.headers.get("content-type") || "application/json";
      const text = await upstream.text();
      if (upstream.ok) {
        ctx.sse.broadcastMusicJob({ jobId: c.req.param("id"), status: "cancelled" });
      }
      return new Response(text, {
        status: upstream.status,
        headers: { "Content-Type": ct },
      });
    } catch (err) {
      return c.json({ error: `YuE2 gateway unreachable: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
  });

  // Proxy /api/music/jobs and /api/music/jobs/*
  app.all("/jobs", async (c) => {
    const { baseUrl, apiKey } = getYue2Config();
    const url = new URL(c.req.url);
    const headers = buildUpstreamHeaders(apiKey);
    let bodyStr: string | undefined;
    if (c.req.method === "POST") {
      const body = await readJsonObject(c);
      bodyStr = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
    try {
      const upstream = await fetch(`${baseUrl}/v1/jobs${url.search}`, {
        method: c.req.method,
        headers,
        body: bodyStr,
        signal: AbortSignal.timeout(15_000),
      });
      const ct = upstream.headers.get("content-type") || "application/json";
      const buf = await upstream.arrayBuffer();
      if (c.req.method === "POST" && upstream.ok) {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(buf)) as Record<string, unknown>;
          ctx.sse.broadcastMusicJob({ status: "submitted", job: parsed });
        } catch {
          // ignore non-JSON body
        }
      }
      return new Response(buf, {
        status: upstream.status,
        headers: { "Content-Type": ct },
      });
    } catch (err) {
      return c.json({ error: `YuE2 gateway unreachable: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
  });

  app.all("/jobs/*", async (c) => {
    const { baseUrl, apiKey } = getYue2Config();
    const url = new URL(c.req.url);
    const subPath = url.pathname.replace(/^\/api\/music/, "/v1");
    const headers = buildUpstreamHeaders(apiKey);
    let bodyStr: string | undefined;
    if (c.req.method === "POST" || c.req.method === "PUT") {
      const body = await readJsonObject(c);
      bodyStr = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
    try {
      const upstream = await fetch(`${baseUrl}${subPath}${url.search}`, {
        method: c.req.method,
        headers,
        body: bodyStr,
        signal: AbortSignal.timeout(15_000),
      });
      const ct = upstream.headers.get("content-type") || "application/octet-stream";
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": ct },
      });
    } catch (err) {
      return c.json({ error: `YuE2 gateway unreachable: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
  });

  return app;
}
