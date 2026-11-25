import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowEngine } from "../src/engine.ts";
import { checkPortCompatibility, deriveDefaultPorts, type GraphDefinition, validateGraph } from "../src/schema.ts";

const tmp = mkdtempSync(join(tmpdir(), "sosho-mw-policy-test-"));
const dbPath = join(tmp, "runs.sqlite");

try {
  // 1. Port derivation and compatibility checks
  const ports = deriveDefaultPorts({ type: "tool", toolKind: "yue2", outputKey: "song" });
  assert.equal(ports.outputs[0]?.type, "audio");
  assert.equal(checkPortCompatibility("text", "text"), "compatible");
  assert.equal(checkPortCompatibility("json", "text", false), "cast");
  assert.equal(checkPortCompatibility("json", "text", true), "incompatible");
  assert.equal(checkPortCompatibility("audio", "number", false), "incompatible");

  // Strict compatibility rejects incompatible graph
  assert.throws(() =>
    validateGraph({
      id: "strict-fail",
      name: "Strict Fail",
      version: 1,
      entryNode: "a",
      maxSteps: 5,
      policy: { strictCompatibility: true },
      nodes: [
        { id: "a", type: "tool", label: "Music", toolKind: "yue2", commandOrUrl: "gen", outputKey: "song" },
        { id: "b", type: "agent", label: "Agent", tier: "main", inputType: "number", promptTemplate: "{{song}}", outputKey: "out" },
      ],
      edges: [{ id: "e1", source: "a", target: "b" }],
    }),
  );

  // 2. Edge middleware (map + redact + trace) + auto-checkpoint + rollback
  const graph: GraphDefinition = {
    id: "mw-policy-graph",
    name: "Middleware & Policy",
    version: 1,
    entryNode: "step1",
    maxSteps: 15,
    policy: {
      memoryRecallBefore: "decision",
      saveRunSummary: true,
      autoCheckpointBefore: ["tool"],
      strictCompatibility: false,
    },
    nodes: [
      {
        id: "step1",
        type: "agent",
        label: "Step 1",
        tier: "main",
        promptTemplate: "Start {{topic}}",
        outputKey: "raw_out",
      },
      {
        id: "step2",
        type: "tool",
        label: "Shell Tool",
        toolKind: "shell",
        commandOrUrl: "echo {{mapped_in}}",
        outputKey: "tool_out",
      },
    ],
    edges: [
      {
        id: "e1",
        source: "step1",
        target: "step2",
        middleware: {
          stages: ["validate", "map", "cast", "redact", "trace", "deliver"],
          fieldMapping: { mapped_in: "raw_out" },
          redactPatterns: ["SECRET123"],
        },
      },
    ],
  };

  let toolCount = 0;
  const engine = new WorkflowEngine({
    cwd: tmp,
    dbPath,
    executor: async ({ node, data }) => {
      if (node.id === "step1") {
        return { outputKey: "raw_out", value: "hello SECRET123 world", preview: "step1" };
      }
      toolCount += 1;
      return { outputKey: "tool_out", value: `tool:${String(data.mapped_in)}`, preview: "step2" };
    },
  });

  // Save version snapshot
  const v = engine.store.saveVersion(graph, "Initial");
  assert.equal(engine.store.listVersions(graph.id).length, 1);
  assert.equal(engine.store.getVersion(v.versionId)?.label, "Initial");

  const started = await engine.startRun(graph, { topic: "test" });
  const paused = await engine.waitForRun(started.runId);
  assert.equal(paused.status, "waiting_checkpoint");
  assert.equal(paused.pausedCheckpoint?.synthetic, true);
  assert.equal(paused.pausedCheckpoint?.nodeId, "step2");
  assert.equal(paused.data.mapped_in, "hello [REDACTED] world");
  assert.ok(paused.history[0]?.middlewareTraces?.[0]?.includes("map:mapped_in"));

  // Approve synthetic auto-checkpoint
  await engine.signalCheckpoint(started.runId, { nodeId: "step2", action: "approve" });
  const done = await engine.waitForRun(started.runId);
  assert.equal(done.status, "completed");
  assert.equal(toolCount, 1);
  assert.equal(done.data.tool_out, "tool:hello [REDACTED] world");

  // Rollback to step 1 and verify history is kept and step re-runs (including auto-checkpoint)
  const prevHistoryLen = done.history.length;
  await engine.rollbackRun(started.runId, 1);
  const pausedAgain = await engine.waitForRun(started.runId);
  assert.equal(pausedAgain.status, "waiting_checkpoint");
  await engine.signalCheckpoint(started.runId, { nodeId: "step2", action: "approve" });
  const afterRollback = await engine.waitForRun(started.runId);
  assert.equal(afterRollback.status, "completed");
  assert.ok(afterRollback.history.length > prevHistoryLen);

  engine.close();
  console.log("ALL MIDDLEWARE, POLICY, VERSION & ROLLBACK TESTS PASSED");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
