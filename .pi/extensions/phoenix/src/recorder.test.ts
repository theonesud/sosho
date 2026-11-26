import assert from "node:assert/strict";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { Recorder } from "./recorder.ts";

const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
const env: NodeJS.ProcessEnv = {};
const recorder = new Recorder({
  tracer: provider.getTracer("test"),
  identity: { sessionId: "s1", userId: "u1" },
  maxChars: 30,
  env,
  secrets: ["topsecret"],
});

recorder.beginAgent("hello topsecret");
assert.equal(env.SOSHO_TRACE_PARENT_SESSION_ID, "s1");
assert.equal(env.SOSHO_TRACE_PARENT_DEPTH, "1");
recorder.beginTurn(0);
recorder.beginLlm({ input: "hello", model: "main", provider: "openai", linked: false });
assert.equal(recorder.traceparent(), undefined);
assert.deepEqual(recorder.requestHeaders(), {});
recorder.endLlm({
  output: "x".repeat(50),
  usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
});
recorder.beginLlm({ input: "again", model: "main", provider: "litellm", linked: true });
assert.match(recorder.traceparent() ?? "", /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
assert.deepEqual(recorder.requestHeaders(), {
  traceparent: recorder.traceparent(),
  "x-litellm-session-id": "s1",
});
recorder.endLlm({ output: "done", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } });
recorder.beginTool("t1", "bash", { command: "echo topsecret" });
recorder.endTool("t1", "out", true);
recorder.endTurn();
recorder.endAgent({ cancelled: false, output: "final" });
recorder.endSession();

assert.equal(env.SOSHO_TRACE_PARENT_TRACE_ID, undefined);
await provider.forceFlush();
const spans = exporter.getFinishedSpans();
const named = (name: string) => spans.filter((span) => span.name === name);
assert.equal(spans.length, 6);
assert.equal(new Set(spans.map((span) => span.spanContext().traceId)).size, 1);

const session = named("pi session")[0];
const agent = named("agent")[0];
const turn = named("turn 0")[0];
assert.ok(session && agent && turn);
assert.equal(agent.attributes["openinference.span.kind"], "AGENT");
assert.equal(agent.attributes["input.value"], "hello [redacted-secret]");
assert.equal(agent.attributes["session.id"], "s1");
assert.equal(agent.attributes["user.id"], "u1");
assert.equal(agent.parentSpanContext?.spanId, session.spanContext().spanId);
assert.equal(turn.parentSpanContext?.spanId, agent.spanContext().spanId);

const [direct, linked] = named("LLM Call");
assert.ok(direct && linked);
assert.equal(direct.attributes["openinference.span.kind"], "LLM");
assert.equal(direct.attributes["llm.model_name"], "main");
assert.equal(direct.attributes["llm.provider"], "openai");
assert.equal(direct.attributes["llm.token_count.total"], 15);
assert.equal(String(direct.attributes["output.value"]).length, 30);
assert.equal(linked.attributes["openinference.span.kind"], "CHAIN");
assert.equal("llm.token_count.total" in linked.attributes, false);

const tool = named("tool bash")[0];
assert.ok(tool);
assert.equal(tool.attributes["openinference.span.kind"], "TOOL");
assert.equal(tool.attributes["tool.name"], "bash");
assert.equal(tool.status.code, 2);
assert.equal(tool.parentSpanContext?.spanId, turn.spanContext().spanId);
assert.equal(String(tool.attributes["input.value"]).includes("topsecret"), false);

const childEnv: NodeJS.ProcessEnv = {
  SOSHO_TRACE_PARENT_TRACE_ID: "c".repeat(32),
  SOSHO_TRACE_PARENT_SPAN_ID: "d".repeat(16),
};
exporter.reset();
const child = new Recorder({
  tracer: provider.getTracer("test"),
  identity: { sessionId: "s2" },
  maxChars: 100,
  inherited: { traceId: "c".repeat(32), spanId: "d".repeat(16), depth: 1 },
  env: childEnv,
});
child.beginAgent("sub");
assert.equal(childEnv.SOSHO_TRACE_PARENT_DEPTH, "2");
child.endSession();
await provider.forceFlush();
const childSpans = exporter.getFinishedSpans();
assert.ok(childSpans.every((span) => span.spanContext().traceId === "c".repeat(32)));
assert.equal(childSpans.find((span) => span.name === "pi session")?.parentSpanContext?.spanId, "d".repeat(16));
assert.equal(childEnv.SOSHO_TRACE_PARENT_TRACE_ID, "c".repeat(32));
assert.equal(childEnv.SOSHO_TRACE_PARENT_DEPTH, undefined);
