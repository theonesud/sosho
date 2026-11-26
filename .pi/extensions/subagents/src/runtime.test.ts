import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BoundedBuffer,
  buildSubagentCliArgs,
  getSubagentDepth,
  getSubagentOutputDir,
  isSubagentDepthAllowed,
  MAX_STREAM_BUFFER_BYTES,
  TierSemaphoreRegistry,
} from "./runtime.ts";

const tmp = mkdtempSync(join(tmpdir(), "sosho-subagent-test-"));

try {
  // 1. Depth tracking uses SOSHO_SUBAGENT_DEPTH independently of SOSHO_TRACE_PARENT_DEPTH
  assert.equal(getSubagentDepth({ SOSHO_TRACE_PARENT_DEPTH: "9" }), 0);
  assert.equal(isSubagentDepthAllowed({ SOSHO_SUBAGENT_DEPTH: "0" }), true);
  assert.equal(isSubagentDepthAllowed({ SOSHO_SUBAGENT_DEPTH: "1" }), true);
  assert.equal(isSubagentDepthAllowed({ SOSHO_SUBAGENT_DEPTH: "2" }), true);
  assert.equal(isSubagentDepthAllowed({ SOSHO_SUBAGENT_DEPTH: "3" }), false);

  // 2. CLI args include --no-session
  const args = buildSubagentCliArgs("litellm", "subagent", "hello");
  assert.ok(args.includes("--no-session"));
  assert.ok(args.includes("--print"));

  // 3. Fallback output dir does NOT double subagents/subagents
  const fallbackDir = getSubagentOutputDir(tmp, {});
  assert.equal(fallbackDir, join(tmp, ".pi", "scratchpad", "subagents"));
  const permDir = getSubagentOutputDir(tmp, { SOSHO_PERMANENT_DIR: join(tmp, "perm") });
  assert.equal(permDir, join(tmp, "perm", "subagents"));

  // 4. Buffer cap enforces 2 MiB limit
  const buf = new BoundedBuffer(MAX_STREAM_BUFFER_BYTES);
  const chunk = Buffer.alloc(512 * 1024, "a");
  for (let i = 0; i < 6; i++) buf.append(chunk); // 3 MiB attempted
  assert.equal(buf.bytes, MAX_STREAM_BUFFER_BYTES);
  assert.equal(buf.isTruncated, true);
  assert.ok(buf.toString().includes("stream truncated"));

  // 5. Mixed cloud + local-uncensored concurrency: local-uncensored caps at 1 while cloud runs in parallel
  const reg = new TierSemaphoreRegistry();
  let localActive = 0;
  let localMax = 0;
  let cloudActive = 0;
  let cloudMax = 0;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await Promise.all([
    reg.get("local-uncensored", 1).run(async () => {
      localActive++;
      localMax = Math.max(localMax, localActive);
      await sleep(40);
      localActive--;
    }),
    reg.get("local-uncensored", 1).run(async () => {
      localActive++;
      localMax = Math.max(localMax, localActive);
      await sleep(40);
      localActive--;
    }),
    reg.get("subagent", 3).run(async () => {
      cloudActive++;
      cloudMax = Math.max(cloudMax, cloudActive);
      await sleep(40);
      cloudActive--;
    }),
    reg.get("subagent", 3).run(async () => {
      cloudActive++;
      cloudMax = Math.max(cloudMax, cloudActive);
      await sleep(40);
      cloudActive--;
    }),
    reg.get("subagent", 3).run(async () => {
      cloudActive++;
      cloudMax = Math.max(cloudMax, cloudActive);
      await sleep(40);
      cloudActive--;
    }),
  ]);
  assert.equal(localMax, 1, "local-uncensored must serialize to 1 globally");
  assert.equal(cloudMax, 3, "cloud subagents must run in parallel up to tier limit");

  console.log("ALL SUBAGENT RUNTIME TESTS PASSED");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
