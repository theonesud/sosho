import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GraphDefinition } from "../../../packages/workflow-engine/src/schema.ts";
import { createStudioServer } from "./index.ts";

const tmp = mkdtempSync(join(tmpdir(), "sosho-studio-test-"));
const dbPath = join(tmp, ".pi", "workflows", "runs.sqlite");
const TOKEN = "test-studio-token-123";
process.env.SOSHO_GLOBAL_MEMORY_DIR = join(tmp, "global-mem");

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

  // 1. Origin rejection
  const evilOrigin = await fetch(`${s1.baseUrl}/api/workflows`, {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(evilOrigin.status, 403);

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

  // 3. Invalid JSON -> 400 and oversized payload -> 413
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

  const cancelRes = await fetch(`${s2.baseUrl}/api/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(cancelRes.status, 200);
  const afterCancel = (await (await fetch(`${s2.baseUrl}/api/runs/${encodeURIComponent(runId)}`)).json()) as {
    status: string;
  };
  assert.equal(afterCancel.status, "cancelled");

  // 6. Memory save, supersede, and archive
  const memSave = await fetch(`${s2.baseUrl}/api/memory`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ scope: "project", type: "semantic", title: "M1", content: "Original fact" }),
  });
  assert.equal(memSave.status, 200);
  const mem1 = (await memSave.json()) as { record: { id: string } };

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

  // 7. Delete workflow
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
