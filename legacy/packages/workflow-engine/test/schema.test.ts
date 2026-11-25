import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GraphValidationError, validateGraph } from "../src/schema.ts";

// 1. Valid example graph passes
const examplePath = join(import.meta.dirname, "../../../apps/studio/workflows/example-research.graph.json");
const exampleRaw = JSON.parse(readFileSync(examplePath, "utf8"));
const validated = validateGraph(exampleRaw);
assert.equal(validated.id, "example-research-checkpoint");

// 2. Missing entryNode fails
assert.throws(
  () => validateGraph({ ...exampleRaw, entryNode: "nonexistent" }),
  (err: unknown) => err instanceof GraphValidationError && err.message.includes("entryNode"),
);

// 3. Unknown edge target fails
assert.throws(
  () =>
    validateGraph({
      ...exampleRaw,
      edges: [...exampleRaw.edges, { id: "bad", source: "recall_mem", target: "ghost" }],
    }),
  (err: unknown) => err instanceof GraphValidationError && err.message.includes("unknown target"),
);

// 4. Invalid decision branch fails
assert.throws(
  () =>
    validateGraph({
      ...exampleRaw,
      edges: [
        ...exampleRaw.edges,
        { id: "bad_branch", source: "route_depth", target: "quick_answer", condition: "invalid_branch" },
      ],
    }),
  (err: unknown) => err instanceof GraphValidationError && err.message.includes("not in decision node"),
);

// 5. Invalid checkpoint condition ('approved' instead of 'approve') fails
assert.throws(
  () =>
    validateGraph({
      ...exampleRaw,
      edges: [
        ...exampleRaw.edges.slice(0, -1),
        { id: "e6", source: "hitl_review", target: "save_mem", condition: "approved" },
      ],
    }),
  (err: unknown) => err instanceof GraphValidationError && err.message.includes("'approve' or 'reject'"),
);

// 6. Duplicate node ID fails
assert.throws(
  () =>
    validateGraph({
      ...exampleRaw,
      nodes: [...exampleRaw.nodes, exampleRaw.nodes[0]],
    }),
  (err: unknown) => err instanceof GraphValidationError && err.message.includes("Duplicate node id"),
);

console.log("ALL SCHEMA VALIDATION TESTS PASSED");
