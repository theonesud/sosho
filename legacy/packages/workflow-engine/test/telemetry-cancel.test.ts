import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowEngine } from "../src/engine.ts";
import type { GraphDefinition } from "../src/schema.ts";

const tmp = mkdtempSync(join(tmpdir(), "sosho-telemetry-cancel-test-"));
const dbPath = join(tmp, "runs.sqlite");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  // 1. Cooperative AbortSignal cancellation
  const slowGraph: GraphDefinition = {
    id: "abort-test",
    name: "Abort Test",
    version: 1,
    entryNode: "slow_step",
    maxSteps: 10,
    nodes: [
      {
        id: "slow_step",
        type: "agent",
        label: "Slow Step",
        tier: "main",
        promptTemplate: "wait",
        outputKey: "out",
      },
    ],
    edges: [],
  };

  let receivedSignal: AbortSignal | undefined;
  let abortedDuringExecution = false;

  const engineCancel = new WorkflowEngine({
    cwd: tmp,
    dbPath,
    executor: async ({ signal }) => {
      receivedSignal = signal;
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          abortedDuringExecution = true;
          reject(new Error("aborted"));
          return;
        }
        const timer = setTimeout(resolve, 5000);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            abortedDuringExecution = true;
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
      return { outputKey: "out", value: "done", preview: "done" };
    },
  });

  const startedCancel = await engineCancel.startRun(slowGraph);
  await sleep(30);
  const cancelled = engineCancel.cancelRun(startedCancel.runId);
  assert.equal(cancelled.status, "cancelled");
  assert.ok(receivedSignal, "Executor must receive AbortSignal");
  assert.equal(receivedSignal.aborted, true, "AbortSignal must be aborted on cancelRun");
  assert.equal(abortedDuringExecution, true, "Executor must observe abort event");
  const afterCancel = await engineCancel.waitForRun(startedCancel.runId);
  assert.equal(afterCancel.status, "cancelled", "Cancelled run must not be overwritten with failed");
  engineCancel.close();

  // 2. activeNodeIds in listRuns, queue_stats events, and step telemetry
  const telemetryGraph: GraphDefinition = {
    id: "telemetry-test",
    name: "Telemetry Test",
    version: 1,
    entryNode: "gpu_step",
    maxSteps: 10,
    nodes: [
      {
        id: "gpu_step",
        type: "agent",
        label: "GPU Step",
        tier: "local-uncensored",
        promptTemplate: "hello {{topic}}",
        outputKey: "draft",
      },
      {
        id: "review_cp",
        type: "checkpoint",
        label: "Review",
        message: "Approve draft?",
        allowStateEdit: true,
      },
    ],
    edges: [{ id: "e1", source: "gpu_step", target: "review_cp" }],
  };

  const events: Array<Record<string, unknown>> = [];
  const engineTel = new WorkflowEngine({
    cwd: tmp,
    dbPath,
    executor: async ({ node, data }) => {
      await sleep(20);
      return {
        outputKey: "outputKey" in node ? node.outputKey : undefined,
        value: `draft for ${String(data.topic)}`,
        preview: "draft ready",
        renderedPrompt: `hello ${String(data.topic)}`,
      };
    },
  });
  engineTel.on("event", (ev: Record<string, unknown>) => events.push(ev));

  const startedTel = await engineTel.startRun(telemetryGraph, { topic: "telemetry" });
  const pausedTel = await engineTel.waitForRun(startedTel.runId);
  assert.equal(pausedTel.status, "waiting_checkpoint");

  // Verify activeNodeIds in listRuns while paused at checkpoint
  const runsWhilePaused = engineTel.listRuns();
  const pausedSummary = runsWhilePaused.find((r) => r.runId === startedTel.runId);
  assert.ok(pausedSummary, "listRuns must include the run");
  assert.deepEqual(pausedSummary.activeNodeIds, ["review_cp"], "listRuns must include activeNodeIds");

  // Verify queue_stats events were emitted with occupancy changes
  const queueEvents = events.filter((e) => e.type === "queue_stats");
  assert.ok(queueEvents.length >= 2, "Must emit queue_stats on acquire and release");
  const acquiredGpu = queueEvents.some((e) => {
    const queues = e.queues as Record<string, { active: number; limit: number }>;
    return e.queue === "local-gpu" && queues["local-gpu"].active === 1 && queues["local-gpu"].limit === 1;
  });
  const releasedGpu = queueEvents.some((e) => {
    const queues = e.queues as Record<string, { active: number; limit: number }>;
    return e.queue === "local-gpu" && queues["local-gpu"].active === 0 && queues["local-gpu"].limit === 1;
  });
  assert.ok(acquiredGpu, "queue_stats must report local-gpu active=1, limit=1 on acquire");
  assert.ok(releasedGpu, "queue_stats must report local-gpu active=0, limit=1 on release");

  // Verify step telemetry on history entry
  const stepRecord = pausedTel.history.find((h) => h.nodeId === "gpu_step");
  assert.ok(stepRecord, "History must contain gpu_step record");
  assert.equal(stepRecord.queue, "local-gpu");
  assert.equal(typeof stepRecord.durationMs, "number");
  assert.ok((stepRecord.durationMs ?? 0) >= 10, "durationMs must reflect execution time");
  assert.deepEqual(stepRecord.stateDiff, { draft: "draft for telemetry" });
  assert.deepEqual(stepRecord.inputSnapshot, { topic: "telemetry" });
  assert.equal(stepRecord.renderedPrompt, "hello telemetry");
  assert.equal(stepRecord.traceId, startedTel.runId);

  // Approve checkpoint and verify activeNodeIds becomes empty after completion
  await engineTel.signalCheckpoint(startedTel.runId, { nodeId: "review_cp", action: "approve" });
  const doneTel = await engineTel.waitForRun(startedTel.runId);
  assert.equal(doneTel.status, "completed");
  const doneSummary = engineTel.listRuns().find((r) => r.runId === startedTel.runId);
  assert.deepEqual(doneSummary?.activeNodeIds, [], "Completed run must have empty activeNodeIds");

  engineTel.close();
  console.log("ALL TELEMETRY AND CANCEL TESTS PASSED");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
