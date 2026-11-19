import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCompletedTasksToInbox } from "../src/store.ts";

const tmp = mkdtempSync(join(tmpdir(), "sosho-capture-test-"));
const ephemeralDir = join(tmp, "ephemeral");
const projectDir = join(tmp, "project");
mkdirSync(ephemeralDir, { recursive: true });
mkdirSync(projectDir, { recursive: true });

try {
  const state = {
    session_id: "sess-test-1",
    history: [
      { title: "Task One", goal: "Goal 1", summary: "Done 1", completed: 2, total: 2 },
      { title: "Task Two", goal: "Goal 2", summary: "Done 2", completed: 3, total: 3 },
      { title: "Task Three", goal: "Goal 3", summary: "Done 3", completed: 1, total: 1 },
    ],
  };
  writeFileSync(join(ephemeralDir, "state.json"), JSON.stringify(state, null, 2), "utf8");

  const first = captureCompletedTasksToInbox(ephemeralDir, projectDir);
  assert.equal(first, 3, "Expected all 3 completed tasks to be captured");

  // Re-running shutdown capture must not duplicate already captured tasks
  const second = captureCompletedTasksToInbox(ephemeralDir, projectDir);
  assert.equal(second, 0, "Expected 0 duplicate captures on second shutdown");

  const eventsPath = join(projectDir, ".pi", "memory", "inbox", "events.jsonl");
  const lines = readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 3);
  const titles = lines.map((l) => (JSON.parse(l) as { title: string }).title);
  assert.deepEqual(titles, ["Session task: Task One", "Session task: Task Two", "Session task: Task Three"]);
  console.log("SESSION SHUTDOWN CAPTURE TEST PASSED");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
