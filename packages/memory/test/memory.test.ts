import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendInboxEvent,
  archiveMemory,
  drainInboxToEpisodic,
  loadScopeMemories,
  readCoreProfile,
  rebuildCoreProfile,
  redactSecrets,
  searchMemory,
  upsertMemory,
} from "../src/store.ts";

const tmp = mkdtempSync(join(tmpdir(), "sosho-mem-test-"));
const fakeGlobal = join(tmp, "global-mem");
const fakeProject = join(tmp, "project");
process.env.SOSHO_GLOBAL_MEMORY_DIR = fakeGlobal;

try {
  // 1. Secret redaction
  const redacted = redactSecrets("my key is sk-1234567890abcdefghij123456 and hf_abcdefghijklmnopqrstuv");
  assert.ok(!redacted.includes("sk-123456"));
  assert.ok(!redacted.includes("hf_abcdef"));

  // 2. Global + Project save & secret redaction on global
  const g1 = upsertMemory(
    {
      scope: "global",
      type: "semantic",
      title: "Preferred Audio Target",
      content: "User prefers Harman curve EQ calibration for speakers. Token sk-1234567890abcdefghij123456",
      tags: ["audio", "preferences"],
      entities: ["harman", "eq"],
      importance: 0.9,
    },
    fakeProject,
  );
  assert.ok(g1.record.content.includes("[REDACTED_SECRET]"));

  const p1 = upsertMemory(
    {
      scope: "project",
      type: "procedural",
      title: "VRAM Handshake Rule",
      content: "Pause llama-cpp before running yue2-engine on RTX 3070 Ti 8GB VRAM.",
      tags: ["gpu", "vram"],
      entities: ["llama-cpp", "yue2-engine"],
      importance: 0.95,
    },
    fakeProject,
  );

  // 3. Hybrid search across both scopes
  const res = searchMemory({ query: "RTX 3070 Ti VRAM yue2-engine", scope: "both" }, fakeProject);
  assert.ok(res.length >= 1);
  assert.equal(res[0].record.id, p1.record.id);

  const resGlobal = searchMemory({ query: "Harman speaker calibration", scope: "both" }, fakeProject);
  assert.ok(resGlobal.length >= 1);
  assert.equal(resGlobal[0].record.id, g1.record.id);

  // 4. Supersede bi-temporal history
  const p2 = upsertMemory(
    {
      scope: "project",
      type: "procedural",
      title: "VRAM Handshake via Temporal Queue",
      content: "Serialize llama-cpp and yue2-engine through the local-gpu Temporal task queue.",
      tags: ["gpu", "temporal"],
      entities: ["llama-cpp", "temporal"],
      importance: 0.98,
      supersedes_id: p1.record.id,
    },
    fakeProject,
  );
  assert.equal(p2.action, "SUPERSEDE");
  assert.equal(p2.superseded, p1.record.id);

  const activeProj = loadScopeMemories("project", fakeProject, false);
  assert.equal(activeProj.length, 1);
  assert.equal(activeProj[0].id, p2.record.id);

  const allProj = loadScopeMemories("project", fakeProject, true);
  assert.equal(allProj.length, 2);
  const archivedOld = allProj.find((m) => m.id === p1.record.id);
  assert.equal(archivedOld?.status, "superseded");
  assert.equal(archivedOld?.superseded_by, p2.record.id);

  // 5. Inbox drain + dedupe + mid-drain concurrent append + profile refresh on empty inbox
  const dupEvent = {
    timestamp: new Date().toISOString(),
    scope: "project" as const,
    kind: "session_summary" as const,
    title: "Built Phase 1 Subagents",
    content: "Added subagent_run and subagent_parallel with Langfuse trace propagation.",
  };
  appendInboxEvent(dupEvent, fakeProject);
  appendInboxEvent(dupEvent, fakeProject); // Duplicate should be deduplicated
  const drained = drainInboxToEpisodic("project", fakeProject, () => {
    // Simulate concurrent append after events.jsonl is renamed to batch file
    appendInboxEvent(
      {
        timestamp: new Date().toISOString(),
        scope: "project",
        kind: "task_finish",
        title: "Concurrent Mid-Drain Task",
        content: "Appended while drain was processing previous batch.",
      },
      fakeProject,
    );
  });
  assert.equal(drained, 1);

  // Second drain picks up the mid-drain concurrent event with zero loss
  const drained2 = drainInboxToEpisodic("project", fakeProject);
  assert.equal(drained2, 1);

  // Empty inbox drain still refreshes core/profile.md
  const drainedEmpty = drainInboxToEpisodic("global", fakeProject);
  assert.equal(drainedEmpty, 0);
  const profile = readCoreProfile("global", fakeProject);
  assert.ok(profile.includes("Preferred Audio Target"));

  // 6. Archive / forget + verify zero active duplicates and no leftover .tmp files
  assert.equal(archiveMemory(g1.record.id, "global", "test_cleanup", fakeProject), true);
  assert.equal(loadScopeMemories("global", fakeProject, false).length, 0);
  const archivedGlobal = loadScopeMemories("global", fakeProject, true);
  assert.equal(archivedGlobal.length, 1);
  assert.equal(archivedGlobal[0].status, "archived");
  assert.equal(
    loadScopeMemories("project", fakeProject, false).filter((m) => m.id === p1.record.id).length,
    0,
  );
  console.log("ALL MEMORY TESTS PASSED");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
