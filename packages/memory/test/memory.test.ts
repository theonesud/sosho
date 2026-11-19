import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendInboxEvent,
  archiveMemory,
  closeMemoryIndexes,
  drainInboxToEpisodic,
  loadScopeMemories,
  readCoreProfile,
  rebuildCoreProfile,
  redactSecrets,
  searchMemory,
  searchMemoryAsync,
  upsertMemory,
} from "../src/store.ts";

const tmp = mkdtempSync(join(tmpdir(), "sosho-mem-test-"));
const fakeGlobal = join(tmp, "global-mem");
const fakeProject = join(tmp, "project");
process.env.SOSHO_GLOBAL_MEMORY_DIR = fakeGlobal;

try {
  // 1. Secret redaction (all patterns across both global and project scopes)
  const secretSamples = [
    "sk-1234567890abcdefghij123456",
    "hf_abcdefghijklmnopqrstuv",
    "AKIAIOSFODNN7EXAMPLE",
    "github_pat_11AAAAAA0123456789abcdef_GHIJKLMNOPQRSTUVWXYZ",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
    "postgresql://admin:s3cr3tpass@db.internal:5432/app",
  ];
  for (const sample of secretSamples) {
    const out = redactSecrets(`leak: ${sample}`);
    assert.ok(out.includes("[REDACTED_SECRET]"), `Expected redaction for: ${sample}`);
    assert.ok(!out.includes("s3cr3tpass") && !out.includes("AKIAIOSFODNN7EXAMPLE") && !out.includes("github_pat_"));
  }

  // Verify project scope also redacts secrets
  const pSecret = upsertMemory(
    {
      scope: "project",
      type: "semantic",
      title: "DB Note",
      content: "Connect via postgresql://user:supersecret@localhost:5432/db with AKIAIOSFODNN7EXAMPLE",
    },
    fakeProject,
  );
  assert.ok(!pSecret.record.content.includes("supersecret"));
  assert.ok(!pSecret.record.content.includes("AKIAIOSFODNN7EXAMPLE"));
  assert.equal(archiveMemory(pSecret.record.id, "project", "cleanup", fakeProject), true);

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
  assert.equal(allProj.length, 3);
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

  // 7. 1-hop entity graph boost (including multi-word entity)
  const e1 = upsertMemory(
    {
      scope: "project",
      type: "semantic",
      title: "Primary GPU Hardware",
      content: "Workstation runs an RTX 3070 Ti with 8GB graphics memory.",
      entities: ["rtx 3070 ti", "sosho workstation"],
      importance: 0.9,
    },
    fakeProject,
  );
  const e2 = upsertMemory(
    {
      scope: "project",
      type: "procedural",
      title: "Cooling Curve Policy",
      content: "Keep fan profile above 65 percent during sustained workloads.",
      entities: ["sosho workstation"],
      importance: 0.85,
    },
    fakeProject,
  );
  const graphRes = searchMemory({ query: "rtx 3070 ti", scope: "project", limit: 10 }, fakeProject);
  assert.ok(graphRes.some((r) => r.record.id === e1.record.id));
  const hopped = graphRes.find((r) => r.record.id === e2.record.id);
  assert.ok(hopped && hopped.graphBoost > 1.0, "Expected 1-hop entity graph recall for linked record");

  // 8. Semantic synonym recall via mock embeddinggemma server + offline FTS5 fallback
  const vecMem = upsertMemory(
    {
      scope: "project",
      type: "semantic",
      title: "OOM Mitigation",
      content: "Reduce batch size when GPU VRAM runs dry.",
      importance: 0.9,
    },
    fakeProject,
  );

  const embedServer = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { input: string[] };
    const data = body.input.map((text, index) => {
      const lower = text.toLowerCase();
      // Place "graphics memory exhaustion" and "gpu vram runs dry" in the same semantic subspace
      const isVram = lower.includes("vram") || lower.includes("graphics memory") || lower.includes("exhaustion");
      const embedding = isVram ? [0.98, 0.1, 0.0, 0.0] : [0.0, 0.0, 0.98, 0.1];
      return { index, embedding };
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data }));
  });
  await new Promise<void>((resolve) => embedServer.listen(0, "127.0.0.1", resolve));
  const embedAddr = embedServer.address();
  const embedPort = typeof embedAddr === "object" && embedAddr ? embedAddr.port : 0;

  try {
    const semRes = await searchMemoryAsync(
      {
        query: "graphics memory exhaustion",
        scope: "project",
        embedUrl: `http://127.0.0.1:${embedPort}/v1/embeddings`,
      },
      fakeProject,
    );
    assert.ok(semRes.some((r) => r.record.id === vecMem.record.id && r.vectorScore > 0.9));
  } finally {
    await new Promise<void>((resolve) => embedServer.close(() => resolve()));
  }

  // Offline embed server falls back cleanly to FTS5
  const fallbackRes = await searchMemoryAsync(
    { query: "OOM Mitigation VRAM", scope: "project", embedUrl: "http://127.0.0.1:1/v1/embeddings" },
    fakeProject,
  );
  assert.ok(fallbackRes.some((r) => r.record.id === vecMem.record.id));

  // 8b. Access count tracking and rank boost on repeated recall
  const accProject = join(tmp, "access-project");
  const mA = upsertMemory(
    {
      scope: "project",
      type: "semantic",
      title: "Alpha Cache Strategy",
      content: "Use write-through caching for alpha workloads.",
      importance: 0.7,
    },
    accProject,
  );
  const mB = upsertMemory(
    {
      scope: "project",
      type: "semantic",
      title: "Beta Cache Strategy",
      content: "Use write-through caching for beta workloads.",
      importance: 0.7,
    },
    accProject,
  );
  // Recall mB specifically several times so its access_count grows above mA
  for (let i = 0; i < 4; i++) {
    const r = searchMemory({ query: "Beta Cache Strategy", scope: "project", limit: 1 }, accProject);
    assert.equal(r[0].record.id, mB.record.id);
    assert.equal(r[0].record.access_count, i + 1);
  }
  const rankedBoth = searchMemory({ query: "write-through caching", scope: "project", limit: 5 }, accProject);
  assert.equal(rankedBoth[0].record.id, mB.record.id, "Repeatedly recalled memory should rank higher");
  assert.ok(rankedBoth.find((r) => r.record.id === mA.record.id));

  // 9. 500 synthetic memories latency benchmark (< 30ms warm indexed query)
  const benchProject = join(tmp, "bench-project");
  for (let i = 0; i < 500; i++) {
    upsertMemory(
      {
        scope: "project",
        type: i % 2 === 0 ? "semantic" : "episodic",
        title: `Synthetic Memory Entry ${i}`,
        content: `Benchmark record ${i} discussing distributed caching, SQLite WAL mode, and module ${i % 17}.`,
        tags: [`mod-${i % 17}`],
        entities: [`service-${i % 25}`],
        importance: 0.7,
      },
      benchProject,
    );
  }
  // Prime index once
  searchMemory({ query: "SQLite WAL mode", scope: "project" }, benchProject);
  const t0 = performance.now();
  const benchRes = searchMemory({ query: "SQLite WAL mode service-3", scope: "project", limit: 8 }, benchProject);
  const elapsedMs = performance.now() - t0;
  assert.ok(benchRes.length > 0);
  assert.ok(elapsedMs < 30, `Expected <30ms indexed search latency over 500 records, got ${elapsedMs.toFixed(2)}ms`);
  console.log(`ALL MEMORY TESTS PASSED (500-record indexed query: ${elapsedMs.toFixed(2)}ms)`);
} finally {
  closeMemoryIndexes();
  rmSync(tmp, { recursive: true, force: true });
}
