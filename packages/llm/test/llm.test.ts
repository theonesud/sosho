import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chatCompletionStream,
  clearHealthCache,
  isHealthEndpointUp,
  loadEnvMap,
  resolveProviderApiKey,
  resolveRoleEndpoint,
} from "../src/index.ts";

const tmp = mkdtempSync(join(tmpdir(), "sosho-llm-test-"));
const soshoDir = join(tmp, "sosho");
const wsDir = join(tmp, "workspace");
mkdirSync(join(soshoDir, ".pi"), { recursive: true });
mkdirSync(wsDir, { recursive: true });

try {
  // 1. .env key lookup across soshoRoot and workspace override
  writeFileSync(join(soshoDir, ".env"), "DEEPINFRA_API_KEY=di_from_sosho\nCUSTOM_PROV_API_KEY=cp_123\n", "utf8");
  writeFileSync(join(wsDir, ".env"), "DEEPINFRA_API_KEY=di_from_ws\n", "utf8");

  const origDi = process.env.DEEPINFRA_API_KEY;
  delete process.env.DEEPINFRA_API_KEY;
  try {
    const env = loadEnvMap(wsDir, soshoDir);
    assert.equal(env.DEEPINFRA_API_KEY, "di_from_ws");
    assert.equal(env.CUSTOM_PROV_API_KEY, "cp_123");
    assert.equal(resolveProviderApiKey("custom-prov", undefined, env), "cp_123");
    assert.equal(resolveProviderApiKey("deepinfra", undefined, env), "di_from_ws");
  } finally {
    if (origDi !== undefined) process.env.DEEPINFRA_API_KEY = origDi;
  }

  // 2. Health cache expiry (15s TTL) + role fallback
  let healthCalls = 0;
  let healthStatus = 200;
  const server = createServer((_req, res) => {
    healthCalls++;
    res.writeHead(healthStatus);
    res.end(healthStatus === 200 ? "ok" : "down");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const healthUrl = `http://127.0.0.1:${port}/health`;

  try {
    writeFileSync(
      join(soshoDir, ".pi", "models.json"),
      JSON.stringify({
        providers: {
          "llama-decision": { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "local" },
          deepinfra: { baseUrl: "https://api.deepinfra.com/v1/openai" },
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(soshoDir, ".pi", "model-roles.json"),
      JSON.stringify({
        roles: {
          decision: {
            provider: "llama-decision",
            model: "Qwen3-1.7B",
            healthUrl,
            fallback: { provider: "deepinfra", model: "Qwen/Qwen3-Coder-30B-A3B-Instruct" },
            concurrency: 4,
          },
        },
      }),
      "utf8",
    );

    clearHealthCache();
    let fakeNow = 1000;
    const nowFn = () => fakeNow;

    // First call hits server (200)
    assert.equal(await isHealthEndpointUp(healthUrl, 15_000, nowFn), true);
    assert.equal(healthCalls, 1);

    // Within 15s TTL, returns cached true without hitting server
    fakeNow += 10_000;
    healthStatus = 503;
    const ep1 = await resolveRoleEndpoint("decision", { cwd: wsDir, soshoRoot: soshoDir, healthTtlMs: 15_000, nowFn });
    assert.equal(ep1.provider, "llama-decision");
    assert.equal(ep1.usedFallback, false);
    assert.equal(healthCalls, 1);

    // After 15s TTL expires, re-checks server (503) and falls back to deepinfra
    fakeNow += 6_000;
    const ep2 = await resolveRoleEndpoint("decision", { cwd: wsDir, soshoRoot: soshoDir, healthTtlMs: 15_000, nowFn });
    assert.equal(ep2.provider, "deepinfra");
    assert.equal(ep2.model, "Qwen/Qwen3-Coder-30B-A3B-Instruct");
    assert.equal(ep2.usedFallback, true);
    assert.equal(healthCalls, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // 3. chatCompletionStream SSE deltas + done event + AbortSignal
  let lastStreamFlag = false;
  const streamServer = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += String(c);
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body) as { stream?: boolean };
        lastStreamFlag = parsed.stream === true;
      } catch {
        lastStreamFlag = false;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello " } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "world!" } }] })}\n\n`);
      res.write(
        `data: ${JSON.stringify({
          choices: [{ delta: {} }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  await new Promise<void>((resolve) => streamServer.listen(0, "127.0.0.1", resolve));
  const sAddr = streamServer.address();
  const sPort = typeof sAddr === "object" && sAddr ? sAddr.port : 0;

  try {
    writeFileSync(
      join(soshoDir, ".pi", "models.json"),
      JSON.stringify({
        providers: {
          "mock-stream": { baseUrl: `http://127.0.0.1:${sPort}/v1`, apiKey: "test-key" },
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(soshoDir, ".pi", "model-roles.json"),
      JSON.stringify({
        roles: {
          main: { provider: "mock-stream", model: "mock-1" },
        },
      }),
      "utf8",
    );

    const deltas: string[] = [];
    let doneEvent:
      | {
          type: "done";
          content: string;
          provider: string;
          model: string;
          durationMs: number;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
          fallbackUsed: boolean;
        }
      | undefined;

    for await (const ev of chatCompletionStream({
      role: "main",
      messages: [{ role: "user", content: "hi" }],
      cwd: wsDir,
      soshoRoot: soshoDir,
    })) {
      if (ev.type === "delta") deltas.push(ev.content);
      if (ev.type === "done") doneEvent = ev;
    }

    assert.equal(lastStreamFlag, true, "chatCompletionStream must post stream: true");
    assert.deepEqual(deltas, ["Hello ", "world!"]);
    assert.ok(doneEvent, "chatCompletionStream must yield final done event");
    assert.equal(doneEvent.content, "Hello world!");
    assert.equal(doneEvent.provider, "mock-stream");
    assert.equal(doneEvent.model, "mock-1");
    assert.equal(doneEvent.fallbackUsed, false);
    assert.equal(doneEvent.usage?.total_tokens, 7);

    // Pre-aborted signal must reject immediately
    const ac = new AbortController();
    ac.abort(new Error("user_aborted"));
    await assert.rejects(async () => {
      for await (const _ev of chatCompletionStream({
        role: "main",
        messages: [{ role: "user", content: "hi" }],
        cwd: wsDir,
        soshoRoot: soshoDir,
        signal: ac.signal,
      })) {
        // should not yield
      }
    });
  } finally {
    await new Promise<void>((resolve) => streamServer.close(() => resolve()));
  }

  console.log("ALL LLM PACKAGE TESTS PASSED");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
