import { Hono } from "hono";

export const STUDIO_OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "Sosho Studio API",
    version: "0.2.0",
    description:
      "Local-first API for Sosho workflows, DAG runs, two-tier memory, YuE2 music, skills, and system health.",
  },
  servers: [{ url: "http://127.0.0.1:4101" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
      },
    },
  },
  paths: {
    "/health": {
      get: { summary: "Service health and endpoint discovery", responses: { "200": { description: "OK" } } },
    },
    "/api/workflows": {
      get: { summary: "List workflow graph definitions", responses: { "200": { description: "Workflow list" } } },
      post: {
        summary: "Create or update a workflow graph",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Saved" }, "400": { description: "Validation error" } },
      },
    },
    "/api/workflows/{id}": {
      get: {
        summary: "Get workflow graph by ID",
        responses: { "200": { description: "Workflow graph" }, "404": { description: "Not found" } },
      },
      delete: {
        summary: "Delete workflow graph by ID",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Deleted" }, "404": { description: "Not found" } },
      },
    },
    "/api/runs": {
      get: { summary: "List recent workflow runs", responses: { "200": { description: "Run list" } } },
      post: {
        summary: "Start a new workflow run",
        security: [{ bearerAuth: [] }],
        responses: { "202": { description: "Run started" }, "400": { description: "Validation error" } },
      },
    },
    "/api/runs/{id}": {
      get: {
        summary: "Get run state and node outputs",
        responses: { "200": { description: "Run details" }, "404": { description: "Not found" } },
      },
    },
    "/api/runs/{id}/cancel": {
      post: {
        summary: "Cancel a running or paused workflow run",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Cancelled" } },
      },
    },
    "/api/runs/{id}/checkpoint": {
      post: {
        summary: "Approve or reject a HITL checkpoint",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Checkpoint signalled" } },
      },
    },
    "/api/memory": {
      get: {
        summary: "Search or list two-tier memories with score breakdown",
        responses: { "200": { description: "Memory items and core profiles" } },
      },
      post: {
        summary: "Create or upsert a memory record",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Saved" } },
      },
    },
    "/api/memory/consolidate": {
      post: {
        summary: "Drain inbox events into episodic memory",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Consolidated" } },
      },
    },
    "/api/memory/{id}/supersede": {
      post: {
        summary: "Supersede an existing memory record",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Superseded" } },
      },
    },
    "/api/memory/{id}": {
      delete: {
        summary: "Archive a memory record",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Archived" }, "404": { description: "Not found" } },
      },
    },
    "/api/music/jobs": {
      get: { summary: "List YuE2 music generation jobs", responses: { "200": { description: "Job list" } } },
      post: {
        summary: "Submit a YuE2 music generation job",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Submitted" } },
      },
    },
    "/api/music/jobs/{id}/audio": {
      get: {
        summary: "Stream generated audio with Range passthrough",
        responses: { "200": { description: "Audio stream" }, "206": { description: "Partial content" } },
      },
    },
    "/api/music/jobs/{id}/cancel": {
      post: {
        summary: "Cancel a YuE2 music generation job",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Cancelled" } },
      },
    },
    "/api/system/status": {
      get: {
        summary: "Live health probes, model roles, providers, and skills",
        responses: { "200": { description: "System status" } },
      },
    },
    "/api/system/gpu": {
      get: {
        summary: "Query local NVIDIA GPU memory and utilization",
        responses: { "200": { description: "GPU state" } },
      },
    },
    "/api/system/gpu/unload": {
      post: {
        summary: "Unload llama-cpp or yue2 to free GPU VRAM",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Unload result" } },
      },
    },
    "/api/system/doctor": {
      post: {
        summary: "Run bin/doctor.sh health diagnostics",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Doctor output" } },
      },
    },
    "/api/skills": {
      get: {
        summary: "List .pi/skills with parsed SKILL.md frontmatter",
        responses: { "200": { description: "Skills list" } },
      },
    },
    "/api/playground/chat": {
      post: {
        summary: "Stream a single-role LLM chat completion via SSE",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "SSE stream (delta, done, error)" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/api/playground/compare": {
      post: {
        summary: "Stream two LLM roles side-by-side via multiplexed SSE",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Multiplexed SSE stream tagged with slot and role" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/api/playground/skill": {
      post: {
        summary: "Execute a Sosho skill with a prompt and return output and duration",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Skill output and durationMs" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/api/events": {
      get: {
        summary: "Subscribe to unified Server-Sent Events stream",
        responses: { "200": { description: "SSE stream" } },
      },
      post: {
        summary: "Broadcast a custom event to SSE subscribers",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Broadcasted" } },
      },
    },
  },
} as const;

const DOCS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sosho Studio API Docs</title>
  </head>
  <body>
    <script id="api-reference" data-url="/api/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;

export function createOpenApiRoutes(): Hono {
  const app = new Hono();
  app.get("/openapi.json", (c) => c.json(STUDIO_OPENAPI_SPEC));
  app.get("/docs", (c) => c.html(DOCS_HTML));
  return app;
}
