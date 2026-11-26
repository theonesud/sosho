import assert from "node:assert/strict";
import { baseAttributes, isUsage, usageAttributes } from "./attributes.ts";
import { loadConfig } from "./config.ts";
import { formatTraceparent, readInheritedParent } from "./parent.ts";
import { CYCLE_MARK, createSecretRedactor, SECRET_REDACTION_MARK } from "./redact.ts";
import { extractText, extractToolCalls, safeStringify, truncateText } from "./text.ts";

const redact = createSecretRedactor("literal-secret-value");
assert.equal(redact("a literal-secret-value b"), `a ${SECRET_REDACTION_MARK} b`);
assert.equal(redact("key sk-abcdefghijklmnopqrstuv end"), `key ${SECRET_REDACTION_MARK} end`);
assert.equal(redact("Authorization: Bearer abcdefghijklmnop1234"), `Authorization: ${SECRET_REDACTION_MARK}`);
assert.deepEqual(redact({ a: ["literal-secret-value", 1], b: null }), {
  a: [SECRET_REDACTION_MARK, 1],
  b: null,
});
const cyclic: Record<string, unknown> = { name: "x" };
cyclic.self = cyclic;
assert.deepEqual(redact(cyclic), { name: "x", self: CYCLE_MARK });
const proto = JSON.parse('{"__proto__": {"polluted": true}}');
assert.equal(Object.getPrototypeOf(redact(proto)), Object.prototype);
assert.equal(createSecretRedactor("")("plain"), "plain");

assert.deepEqual(truncateText("short", 10), { text: "short", meta: { truncated: false, orig_len: 5 } });
const cut = truncateText("abcdefghij", 4);
assert.equal(cut.text, "abcd");
assert.equal(cut.meta.truncated, true);
assert.equal(cut.meta.orig_len, 10);
assert.equal(cut.meta.kept_len, 4);
assert.match(cut.meta.sha256 ?? "", /^[0-9a-f]{64}$/);

assert.equal(extractText("plain"), "plain");
assert.equal(extractText([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }]), "ab");
assert.equal(extractText(42), "");
assert.deepEqual(extractToolCalls([{ type: "toolCall", id: "1", name: "bash" }, { type: "text" }]), [
  { id: "1", name: "bash" },
]);
assert.equal(safeStringify({ a: 1 }), '{"a":1}');
assert.equal(safeStringify(undefined), "");

assert.deepEqual(usageAttributes({ input: 10, output: 5, cacheRead: 3, cacheWrite: 2 }), {
  "llm.token_count.prompt": 15,
  "llm.token_count.completion": 5,
  "llm.token_count.total": 20,
});
assert.deepEqual(usageAttributes({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), {});
assert.deepEqual(usageAttributes(undefined), {});
assert.equal(isUsage({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }), true);
assert.equal(isUsage({ input: "1" }), false);
assert.deepEqual(baseAttributes("TOOL", { sessionId: "s1", userId: "u1" }), {
  "openinference.span.kind": "TOOL",
  "session.id": "s1",
  "user.id": "u1",
});
assert.equal("user.id" in baseAttributes("LLM", { sessionId: "s1" }), false);

const traceId = "a".repeat(32);
const spanId = "b".repeat(16);
assert.deepEqual(
  readInheritedParent({
    SOSHO_TRACE_PARENT_TRACE_ID: traceId.toUpperCase(),
    SOSHO_TRACE_PARENT_SPAN_ID: spanId,
    SOSHO_TRACE_PARENT_SESSION_ID: "run-1",
    SOSHO_TRACE_PARENT_DEPTH: "2",
  }),
  { traceId, spanId, sessionId: "run-1", depth: 2 },
);
assert.equal(readInheritedParent({}), undefined);
assert.equal(
  readInheritedParent({ SOSHO_TRACE_PARENT_TRACE_ID: "0".repeat(32), SOSHO_TRACE_PARENT_SPAN_ID: spanId }),
  undefined,
);
assert.equal(
  readInheritedParent({ SOSHO_TRACE_PARENT_TRACE_ID: "short", SOSHO_TRACE_PARENT_SPAN_ID: spanId }),
  undefined,
);
assert.equal(formatTraceparent(traceId, spanId), `00-${traceId}-${spanId}-01`);

assert.deepEqual(loadConfig({}), {
  tracesUrl: "http://127.0.0.1:6006/v1/traces",
  projectName: "sosho",
  maxChars: 20000,
});
const custom = loadConfig({
  PHOENIX_COLLECTOR_ENDPOINT: "http://phoenix:6006/",
  PHOENIX_PROJECT_NAME: "other",
  SOSHO_TRACE_USER_ID: "me",
  SOSHO_TRACE_MAX_CHARS: "50",
});
assert.equal(custom.tracesUrl, "http://phoenix:6006/v1/traces");
assert.equal(custom.projectName, "other");
assert.equal(custom.userId, "me");
assert.equal(custom.maxChars, 50);
