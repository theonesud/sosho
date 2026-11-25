import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeNodeActivity, renderTemplate, withNodeRetryAndTimeout } from "../src/activities.ts";
import type { GraphNode } from "../src/schema.ts";

const tmp = mkdtempSync(join(tmpdir(), "sosho-act-test-"));

try {
  // 1. Nested template resolution
  const rendered = renderTemplate(
    "Summary: {{result.summary}} | First: {{result.items.0.name}} | Missing: {{result.missing}}",
    { result: { summary: "ok", items: [{ name: "alpha" }] } },
  );
  assert.equal(rendered, "Summary: ok | First: alpha | Missing: ");

  // 2. Retry with exponential backoff
  let attempts = 0;
  const retryNode: GraphNode = {
    id: "n1",
    type: "tool",
    label: "Retry Test",
    toolKind: "shell",
    commandOrUrl: "echo hi",
    outputKey: "out",
    retryMaxAttempts: 3,
    timeoutSeconds: 10,
  };
  const retriedVal = await withNodeRetryAndTimeout(
    retryNode,
    async () => {
      attempts++;
      if (attempts < 3) throw new Error("transient failure");
      return "recovered";
    },
    10,
  );
  assert.equal(retriedVal, "recovered");
  assert.equal(attempts, 3);

  // 3. Mock YuE2 job submit, poll, and artifact download
  let pollCount = 0;
  const yue2Server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/v1/jobs") {
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "job-123" }));
      return;
    }
    if (req.method === "GET" && req.url === "/v1/jobs/job-123") {
      pollCount++;
      if (pollCount < 2) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "job-123", status: "running" }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "job-123",
            status: "succeeded",
            artifacts: {
              audio: { url: "/v1/jobs/job-123/audio", format: "flac" },
              score: { url: "/v1/jobs/job-123/score", format: "abc" },
            },
          }),
        );
      }
      return;
    }
    if (req.url === "/v1/jobs/job-123/audio") {
      res.writeHead(200, { "Content-Type": "audio/flac" });
      res.end(Buffer.from("fLaC-mock-audio"));
      return;
    }
    if (req.url === "/v1/jobs/job-123/score") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("X:1\nT:Mock Song\nK:C\nCDEF|");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => yue2Server.listen(0, "127.0.0.1", resolve));
  const yAddr = yue2Server.address();
  const yPort = typeof yAddr === "object" && yAddr ? yAddr.port : 0;

  try {
    const yue2Node: GraphNode = {
      id: "music1",
      type: "tool",
      label: "Generate Song",
      toolKind: "yue2",
      commandOrUrl: `http://127.0.0.1:${yPort}`,
      bodyTemplate: '{"style":"synthwave","lyrics":"[Verse]\\nHello"}',
      outputKey: "song",
    };
    const res = await executeNodeActivity({
      node: yue2Node,
      data: {},
      cwd: tmp,
      options: { yue2PollIntervalMs: 10 },
    });
    const val = res.value as { jobId: string; audioPath: string; scorePath: string };
    assert.equal(val.jobId, "job-123");
    assert.ok(existsSync(val.audioPath));
    assert.ok(existsSync(val.scorePath));
    assert.equal(readFileSync(val.scorePath, "utf8").includes("T:Mock Song"), true);
  } finally {
    await new Promise<void>((resolve) => yue2Server.close(() => resolve()));
  }

  // 4. Skill execution via pi --print --no-session (mock pi binary)
  mkdirSync(join(tmp, ".pi", "skills", "demo-skill"), { recursive: true });
  writeFileSync(join(tmp, ".pi", "skills", "demo-skill", "SKILL.md"), "# Demo Skill\nRun demo.", "utf8");
  writeFileSync(
    join(tmp, ".pi", "model-roles.json"),
    JSON.stringify({ roles: { subagent: { provider: "mock", model: "mock-m" } } }),
    "utf8",
  );
  writeFileSync(
    join(tmp, ".pi", "models.json"),
    JSON.stringify({ providers: { mock: { baseUrl: "http://127.0.0.1:9999/v1", apiKey: "local" } } }),
    "utf8",
  );
  const mockPi = join(tmp, "mock-pi.sh");
  writeFileSync(
    mockPi,
    '#!/usr/bin/env bash\necho "PI_ARGS:$*"\n',
    "utf8",
  );
  chmodSync(mockPi, 0o755);

  const skillNode: GraphNode = {
    id: "sk1",
    type: "skill",
    label: "Demo Skill",
    skillName: "demo-skill",
    tier: "subagent",
    promptTemplate: "Do {{task.name}}",
    outputKey: "skill_out",
  };
  const skillRes = await executeNodeActivity({
    node: skillNode,
    data: { task: { name: "build" } },
    cwd: tmp,
    options: { piBinary: mockPi },
  });
  const outStr = String(skillRes.value);
  assert.ok(outStr.includes("--print") && outStr.includes("--no-session"));
  assert.ok(outStr.includes("Do build"));

  console.log("ALL WORKFLOW ACTIVITY TESTS PASSED");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
