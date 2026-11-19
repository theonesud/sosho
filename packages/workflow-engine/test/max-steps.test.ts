import assert from "node:assert/strict";
import { runInMemoryGraph } from "../src/engine.ts";
import { type GraphDefinition, MAX_STEPS_EXCEEDED_ERROR } from "../src/schema.ts";

const cyclicGraph: GraphDefinition = {
  id: "cyclic-test",
  name: "Cyclic Graph",
  version: 1,
  entryNode: "a",
  maxSteps: 4,
  nodes: [
    { id: "a", type: "agent", label: "A", tier: "main", promptTemplate: "A", outputKey: "a" },
    { id: "b", type: "agent", label: "B", tier: "main", promptTemplate: "B", outputKey: "b" },
  ],
  edges: [
    { id: "e1", source: "a", target: "b" },
    { id: "e2", source: "b", target: "a" },
  ],
};

const result = await runInMemoryGraph(cyclicGraph, async () => ({}));
assert.equal(result.status, "failed");
assert.equal(result.error, MAX_STEPS_EXCEEDED_ERROR);
assert.equal(result.stepCount, 4);
console.log("MAX_STEPS FAILURE TEST PASSED");
