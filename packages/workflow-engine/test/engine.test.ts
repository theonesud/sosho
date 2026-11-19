import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowEngine } from "../src/engine.ts";
import type { GraphDefinition } from "../src/schema.ts";

const tmp = mkdtempSync(join(tmpdir(), "sosho-engine-test-"));
const dbPath = join(tmp, "runs.sqlite");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  // 1. Diamond DAG parallel branches + single join execution + local-gpu semaphore cap = 1
  const diamond: GraphDefinition = {
    id: "diamond-dag",
    name: "Diamond Parallel DAG",
    version: 1,
    entryNode: "start",
    maxSteps: 20,
    nodes: [
      { id: "start", type: "agent", label: "Start", tier: "main", promptTemplate: "go", outputKey: "s" },
      { id: "left", type: "subagent", role: "L", label: "Left", tier: "subagent", promptTemplate: "L", outputKey: "left_out" },
      { id: "right", type: "subagent", role: "R", label: "Right", tier: "subagent", promptTemplate: "R", outputKey: "right_out" },
      { id: "join", type: "agent", label: "Join", tier: "main", promptTemplate: "J", outputKey: "final_out" },
    ],
    edges: [
      { id: "e1", source: "start", target: "left" },
      { id: "e2", source: "start", target: "right" },
      { id: "e3", source: "left", target: "join" },
      { id: "e4", source: "right", target: "join" },
    ],
  };

  let concurrentBranches = 0;
  let maxConcurrentBranches = 0;
  let joinExecutions = 0;
  const events: Array<Record<string, unknown>> = [];

  const engine1 = new WorkflowEngine({
    cwd: tmp,
    dbPath,
    executor: async ({ node, data }) => {
      if (node.id === "left" || node.id === "right") {
        concurrentBranches++;
        maxConcurrentBranches = Math.max(maxConcurrentBranches, concurrentBranches);
        await sleep(40);
        concurrentBranches--;
        return {
          outputKey: "outputKey" in node ? node.outputKey : undefined,
          value: `${node.id}-done`,
          preview: node.id,
        };
      }
      if (node.id === "join") {
        joinExecutions++;
        return {
          outputKey: "outputKey" in node ? node.outputKey : undefined,
          value: `${String(data.left_out)}+${String(data.right_out)}`,
          preview: "joined",
        };
      }
      return { outputKey: "s", value: "started", preview: "start" };
    },
  });
  engine1.on("event", (ev: Record<string, unknown>) => events.push(ev));

  const started = await engine1.startRun(diamond, { topic: "parallel" });
  const doneDiamond = await engine1.waitForRun(started.runId);
  assert.equal(doneDiamond.status, "completed");
  assert.equal(maxConcurrentBranches, 2, "Parallel branches must run concurrently");
  assert.equal(joinExecutions, 1, "Join node must execute exactly once");
  assert.equal(doneDiamond.data.final_out, "left-done+right-done");
  assert.ok(events.some((e) => e.type === "run_completed"));

  // 2. Resource queue cap: local-gpu serializes to 1 even in parallel wave
  const gpuGraph: GraphDefinition = {
    id: "gpu-cap",
    name: "GPU Cap",
    version: 1,
    entryNode: "s",
    maxSteps: 10,
    nodes: [
      { id: "s", type: "agent", label: "S", tier: "main", promptTemplate: "s", outputKey: "s" },
      { id: "g1", type: "agent", label: "G1", tier: "local-uncensored", promptTemplate: "g1", outputKey: "g1" },
      { id: "g2", type: "agent", label: "G2", tier: "local-uncensored", promptTemplate: "g2", outputKey: "g2" },
    ],
    edges: [
      { id: "e1", source: "s", target: "g1" },
      { id: "e2", source: "s", target: "g2" },
    ],
  };
  let gpuActive = 0;
  let gpuMax = 0;
  const engineGpu = new WorkflowEngine({
    cwd: tmp,
    dbPath,
    executor: async ({ node, queue }) => {
      if (queue === "local-gpu") {
        gpuActive++;
        gpuMax = Math.max(gpuMax, gpuActive);
        await sleep(30);
        gpuActive--;
      }
      return { outputKey: "outputKey" in node ? node.outputKey : undefined, value: node.id, preview: node.id };
    },
  });
  const gpuRun = await engineGpu.startRun(gpuGraph);
  const gpuDone = await engineGpu.waitForRun(gpuRun.runId);
  assert.equal(gpuDone.status, "completed");
  assert.equal(gpuMax, 1, "local-gpu queue must serialize to 1");
  engineGpu.close();

  // 3. Example research graph: pause at checkpoint, simulate server restart (new WorkflowEngine on same SQLite), approve, complete
  const examplePath = join(import.meta.dirname, "../../../workflows/example-research.graph.json");
  const exampleGraph = JSON.parse(readFileSync(examplePath, "utf8")) as GraphDefinition;

  const mockResearchExecutor = async ({ node }: { node: { id: string; type: string; outputKey?: string } }) => {
    if (node.id === "recall_mem") return { outputKey: "recalled_memory", value: "prior notes", preview: "1 mem" };
    if (node.id === "route_depth") return { outputKey: "route", value: "quick", branch: "quick", preview: "quick" };
    if (node.id === "quick_answer") return { outputKey: "draft_brief", value: "Draft brief v1", preview: "draft" };
    if (node.id === "save_mem") return { outputKey: "saved_memory", value: "mem_p_saved", preview: "saved" };
    return { preview: "ok" };
  };

  const engineA = new WorkflowEngine({ cwd: tmp, dbPath, executor: mockResearchExecutor });
  const r1 = await engineA.startRun(exampleGraph, { topic: "SQLite WAL" });
  const paused = await engineA.waitForRun(r1.runId);
  assert.equal(paused.status, "waiting_checkpoint");
  assert.equal(paused.pausedCheckpoint?.nodeId, "hitl_review");
  engineA.close(); // Simulate process crash / restart!

  // Reopen SQLite in a brand new WorkflowEngine instance
  const engineB = new WorkflowEngine({ cwd: tmp, dbPath, executor: mockResearchExecutor });
  const reloaded = engineB.getRun(r1.runId);
  assert.equal(reloaded?.status, "waiting_checkpoint");
  assert.equal(reloaded?.data.draft_brief, "Draft brief v1");

  await engineB.signalCheckpoint(r1.runId, {
    nodeId: "hitl_review",
    action: "approve",
    statePatch: { draft_brief: "Approved brief v2" },
  });
  const completed = await engineB.waitForRun(r1.runId);
  assert.equal(completed.status, "completed");
  assert.equal(completed.data.draft_brief, "Approved brief v2");
  assert.equal(completed.data.saved_memory, "mem_p_saved");

  // 4. Crash recovery of interrupted 'running' run
  const crashedRun = {
    ...completed,
    runId: "crashed-run-1",
    status: "running" as const,
    frontier: ["save_mem"],
    activeNodeIds: ["save_mem"],
    stepCount: 3,
    data: { topic: "recovery", draft_brief: "Recovered brief" },
  };
  engineB.store.saveRun(crashedRun);
  const recoveredIds = engineB.recoverInterruptedRuns();
  assert.deepEqual(recoveredIds, ["crashed-run-1"]);
  const recoveredDone = await engineB.waitForRun("crashed-run-1");
  assert.equal(recoveredDone.status, "completed");

  engine1.close();
  engineB.close();
  console.log("ALL SQLITE DAG ENGINE TESTS PASSED");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
