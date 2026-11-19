import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GraphDefinition } from "../../../packages/workflow-engine/src/schema.ts";
import { createStudioServer } from "./index.ts";

const tmp = mkdtempSync(join(tmpdir(), "sosho-studio-test-"));
const dbPath = join(tmp, ".pi", "workflows", "runs.sqlite");
const TOKEN = "test-studio-token-123";
process.env.SOSHO_GLOBAL_MEMORY_DIR = join(tmp, "global-mem");

// Seed a sample skill in tmp/.pi/skills/demo-skill/SKILL.md
const demoSkillDir = join(tmp, ".pi", "skills", "demo-skill");
mkdirSync(demoSkillDir, { recursive: true });
writeFileSync(
  join(demoSkillDir, "SKILL.md"),
  "---\nname: demo-skill\ndescription: A demo skill for testing frontmatter parsing.\n---\n\n# Demo\n",
  "utf8",
);

const sampleGraph: GraphDefinition = {
  id: "test-wf",
  name: "Test Workflow",
  version: 1,
  entryNode: "step1",
  maxSteps: 10,
  nodes: [
    { id: "step1", type: "agent", label: "Step 1", tier: "main", promptTemplate: "Hi", outputKey: "out1" },
    { id: "cp1", type: "checkpoint", label: "Approve", message: "Approve?", allowStateEdit: true },
  ],
  edges: [{ id: "e1", source: "step1", target: "cp1" }],
};

async function startServer() {
  const ctx = createStudioServer({
    root: tmp,
    port: 0,
    token: TOKEN,
    dbPath,
    heartbeatMs: 60_000,
    executor: async ({ node }) => ({
      outputKey: "outputKey" in node ? node.outputKey : undefined,
      value: "step1-ok",
      preview: "step1-ok",
    }),
  });
  await new Promise<void>((resolve) => ctx.server.listen(0, "127.0.0.1", resolve));
  const addr = ctx.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { ...ctx, baseUrl: `http://127.0.0.1:${port}` };
}

try {
  const s1 = await startServer();

  // 1. CORS: Origin rejection + allowed origin + OPTIONS preflight
  const evilOrigin = await fetch(`${s1.baseUrl}/api/workflows`, {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(evilOrigin.status, 403);

  const goodOrigin = await fetch(`${s1.baseUrl}/api/workflows`, {
    headers: { Origin: "http://127.0.0.1:4100" },
  });
  assert.equal(goodOrigin.status, 200);
  assert.equal(goodOrigin.headers.get("access-control-allow-origin"), "http://127.0.0.1:4100");

  const preflight = await fetch(`${s1.baseUrl}/api/workflows`, {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:4100" },
  });
  assert.equal(preflight.status, 204);

  // 2. Bearer auth enforcement on POST
  const unauth = await fetch(`${s1.baseUrl}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph: sampleGraph }),
  });
  assert.equal(unauth.status, 401);

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
  };

  // 3. Invalid JSON -> 400, oversized payload -> 413, Zod validation errors -> 400
  const badJson = await fetch(`${s1.baseUrl}/api/workflows`, {
    method: "POST",
    headers: authHeaders,
    body: "{not-json",
  });
  assert.equal(badJson.status, 400);

  const huge = await fetch(`${s1.baseUrl}/api/workflows`, {
    method: "POST",
    headers: authHeaders,
    body: "x".repeat(1024 * 1024 + 16),
  });
  assert.equal(huge.status, 413);

  const badMemory = await fetch(`${s1.baseUrl}/api/memory`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ scope: "project", importance: 99 }),
  });
  assert.equal(badMemory.status, 400);

  const badUnload = await fetch(`${s1.baseUrl}/api/system/gpu/unload`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ target: "unknown-service" }),
  });
  assert.equal(badUnload.status, 400);

  // 4. Workflow CRUD (save, list, get, delete)
  const saveRes = await fetch(`${s1.baseUrl}/api/workflows`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(sampleGraph),
  });
  assert.equal(saveRes.status, 200);

  const listRes = await fetch(`${s1.baseUrl}/api/workflows`);
  const listData = (await listRes.json()) as { workflows: Array<{ id: string }> };
  assert.ok(listData.workflows.some((w) => w.id === "test-wf"));

  const getWfRes = await fetch(`${s1.baseUrl}/api/workflows/test-wf`);
  assert.equal(getWfRes.status, 200);

  // 5. Start run, wait for checkpoint, restart server, confirm persisted state, then cancel
  const runRes = await fetch(`${s1.baseUrl}/api/runs`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ graph: sampleGraph, initialData: { topic: "studio" } }),
  });
  assert.equal(runRes.status, 202);
  const { runId } = (await runRes.json()) as { runId: string };
  await s1.engine.waitForRun(runId);

  // Restart server completely
  s1.closeAll();
  const s2 = await startServer();

  const persistedRes = await fetch(`${s2.baseUrl}/api/runs/${encodeURIComponent(runId)}`);
  assert.equal(persistedRes.status, 200);
  const persisted = (await persistedRes.json()) as { status: string; data: Record<string, unknown> };
  assert.equal(persisted.status, "waiting_checkpoint");
  assert.equal(persisted.data.out1, "step1-ok");

  const runsListRes = await fetch(`${s2.baseUrl}/api/runs`);
  const runsList = (await runsListRes.json()) as { runs: Array<{ runId: string }> };
  assert.ok(runsList.runs.some((r) => r.runId === runId));

  const badCp = await fetch(`${s2.baseUrl}/api/runs/${encodeURIComponent(runId)}/checkpoint`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ action: "approve" }), // missing nodeId
  });
  assert.equal(badCp.status, 400);

  const cancelRes = await fetch(`${s2.baseUrl}/api/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(cancelRes.status, 200);
  const afterCancel = (await (await fetch(`${s2.baseUrl}/api/runs/${encodeURIComponent(runId)}`)).json()) as {
    status: string;
  };
  assert.equal(afterCancel.status, "cancelled");

  // 6. Memory save, searchMemoryAsync with score breakdown, consolidate, supersede, and archive
  const memSave = await fetch(`${s2.baseUrl}/api/memory`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      scope: "project",
      type: "semantic",
      title: "M1 Studio Architecture",
      content: "Original fact about Hono modular routes",
    }),
  });
  assert.equal(memSave.status, 200);
  const mem1 = (await memSave.json()) as { record: { id: string } };

  const memSearch = await fetch(
    `${s2.baseUrl}/api/memory?q=Hono&scope=project&types=semantic&limit=10&maxTokens=1000&includeArchived=false`,
  );
  assert.equal(memSearch.status, 200);
  const searchData = (await memSearch.json()) as {
    items: Array<{ id: string; score: number; lexicalScore: number; vectorScore: number; graphBoost: number }>;
  };
  assert.ok(searchData.items.length >= 1);
  assert.equal(typeof searchData.items[0].score, "number");
  assert.equal(typeof searchData.items[0].lexicalScore, "number");
  assert.equal(typeof searchData.items[0].vectorScore, "number");
  assert.equal(typeof searchData.items[0].graphBoost, "number");

  const memCons = await fetch(`${s2.baseUrl}/api/memory/consolidate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(memCons.status, 200);

  const memSup = await fetch(`${s2.baseUrl}/api/memory/${encodeURIComponent(mem1.record.id)}/supersede`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ scope: "project", type: "semantic", title: "M1 v2", content: "Updated fact" }),
  });
  assert.equal(memSup.status, 200);
  const mem2 = (await memSup.json()) as { record: { id: string }; superseded?: string };
  assert.equal(mem2.superseded, mem1.record.id);

  const memDel = await fetch(`${s2.baseUrl}/api/memory/${encodeURIComponent(mem2.record.id)}?scope=project`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(memDel.status, 200);

  // 7. Skills frontmatter parsing
  const skillsRes = await fetch(`${s2.baseUrl}/api/skills`);
  assert.equal(skillsRes.status, 200);
  const skillsData = (await skillsRes.json()) as {
    skills: Array<{ name: string; description: string; path: string }>;
  };
  const demoSkill = skillsData.skills.find((s) => s.name === "demo-skill");
  assert.ok(demoSkill, "demo-skill should be discovered");
  assert.equal(demoSkill.description, "A demo skill for testing frontmatter parsing.");
  assert.ok(demoSkill.path.endsWith("SKILL.md"));

  // 8. OpenAPI 3.1 & Docs
  const openapiRes = await fetch(`${s2.baseUrl}/api/openapi.json`);
  assert.equal(openapiRes.status, 200);
  const spec = (await openapiRes.json()) as { openapi: string; paths: Record<string, unknown> };
  assert.equal(spec.openapi, "3.1.0");
  assert.ok(spec.paths["/api/workflows"]);

  const docsRes = await fetch(`${s2.baseUrl}/api/docs`);
  assert.equal(docsRes.status, 200);
  const docsHtml = await docsRes.text();
  assert.ok(docsHtml.includes("/api/openapi.json"));

  // 9. System GPU endpoint
  const gpuRes = await fetch(`${s2.baseUrl}/api/system/gpu`);
  assert.equal(gpuRes.status, 200);
  const gpuData = (await gpuRes.json()) as { available: boolean; gpus: unknown[] };
  assert.equal(typeof gpuData.available, "boolean");
  assert.ok(Array.isArray(gpuData.gpus));

  // 10. SSE broadcast
  const ac = new AbortController();
  const sseRes = await fetch(`${s2.baseUrl}/api/events`, { signal: ac.signal });
  assert.equal(sseRes.status, 200);
  assert.ok(sseRes.body, "SSE response missing body");
  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();

  const firstChunk = await reader.read();
  assert.ok(decoder.decode(firstChunk.value).includes('"type":"connected"'));

  const postEv = await fetch(`${s2.baseUrl}/api/events`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ type: "test_ping", value: 42 }),
  });
  assert.equal(postEv.status, 200);

  const secondChunk = await reader.read();
  const secondText = decoder.decode(secondChunk.value);
  assert.ok(secondText.includes('"type":"test_ping"'));
  assert.ok(secondText.includes('"value":42'));
  ac.abort();

  // 11. Playground Zod validation
  const badChat = await fetch(`${s2.baseUrl}/api/playground/chat`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ role: "main", prompt: "" }), // empty prompt
  });
  assert.equal(badChat.status, 400);

  const badCompare = await fetch(`${s2.baseUrl}/api/playground/compare`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ roles: ["main"], prompt: "Hi" }), // requires 2 roles
  });
  assert.equal(badCompare.status, 400);

  const badSkill = await fetch(`${s2.baseUrl}/api/playground/skill`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ skillName: "" }), // missing prompt + empty skillName
  });
  assert.equal(badSkill.status, 400);

  // 12. Delete workflow
  const wfDel = await fetch(`${s2.baseUrl}/api/workflows/test-wf`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(wfDel.status, 200);

  s2.closeAll();
  console.log("ALL STUDIO SERVER TESTS PASSED");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
