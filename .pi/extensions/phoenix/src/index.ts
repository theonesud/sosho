import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isUsage } from "./attributes.ts";
import { loadConfig, reportError, type PhoenixConfig } from "./config.ts";
import { readInheritedParent } from "./parent.ts";
import { Recorder } from "./recorder.ts";
import { extractText, safeStringify, truncateText } from "./text.ts";
import { createTracing, type Tracing } from "./tracing.ts";

const LITELLM_PROVIDER = "litellm";
const FLUSH_BUDGET_MS = 3000;
const TOOL_RESULT_PREVIEW_CHARS = 4000;

interface Runtime {
  recorder: Recorder;
  tracing: Tracing;
  nextInput: string;
  lastAssistantText: string;
  sawError: boolean;
}

function guard(work: () => void): void {
  try {
    work();
  } catch (error) {
    reportError(error);
    return;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createRuntime(config: PhoenixConfig, ctx: ExtensionContext): Runtime {
  const inherited = readInheritedParent();
  const sessionId = inherited?.sessionId ?? ctx.sessionManager.getSessionId();
  const tracing = createTracing(config);
  const secrets = [process.env.LITELLM_MASTER_KEY ?? ""];
  const recorder = new Recorder({
    tracer: tracing.tracer,
    identity: { sessionId, ...(config.userId ? { userId: config.userId } : {}) },
    maxChars: config.maxChars,
    inherited,
    secrets,
  });
  return { recorder, tracing, nextInput: "", lastAssistantText: "", sawError: false };
}

function registerAgentEvents(
  pi: ExtensionAPI,
  ensure: (ctx: ExtensionContext) => Runtime,
  current: () => Runtime | undefined,
): void {
  pi.on("before_agent_start", (event, ctx) =>
    guard(() => {
      const runtime = ensure(ctx);
      const prompt = event.messageType === "custom" ? "" : event.prompt;
      runtime.nextInput = prompt;
      runtime.lastAssistantText = "";
      runtime.sawError = false;
      runtime.recorder.beginAgent(prompt);
    }),
  );
  pi.on("turn_start", (event) => guard(() => current()?.recorder.beginTurn(event.turnIndex)));
  pi.on("turn_end", () => guard(() => current()?.recorder.endTurn()));
  pi.on("agent_settled", async (event) => {
    const runtime = current();
    if (!runtime) return;
    guard(() =>
      runtime.recorder.endAgent({
        cancelled: event.aborted,
        output: runtime.lastAssistantText,
        error: runtime.sawError,
      }),
    );
    await runtime.tracing.flush(FLUSH_BUDGET_MS);
  });
  pi.on("session_shutdown", async () => {
    const runtime = current();
    if (!runtime) return;
    guard(() => runtime.recorder.endSession());
    await runtime.tracing.flush(FLUSH_BUDGET_MS);
    await runtime.tracing.shutdown(FLUSH_BUDGET_MS);
  });
}

function endAssistantMessage(runtime: Runtime | undefined, message: unknown): void {
  if (!runtime || !isRecord(message) || message.role !== "assistant") return;
  const text = extractText(message.content);
  const failed = message.stopReason === "error";
  if (failed) runtime.sawError = true;
  if (text) runtime.lastAssistantText = text;
  const model = message.responseModel ?? message.model;
  runtime.recorder.endLlm({
    output: text,
    ...(typeof model === "string" ? { model } : {}),
    usage: isUsage(message.usage) ? message.usage : undefined,
    error: failed ? String(message.errorMessage ?? "stopReason: error") : undefined,
  });
}

function registerLlmEvents(pi: ExtensionAPI, current: () => Runtime | undefined): void {
  pi.on("before_provider_headers", (event, ctx) =>
    guard(() => {
      const runtime = current();
      if (!runtime) return;
      runtime.recorder.beginLlm({
        input: runtime.nextInput,
        linked: ctx.model?.provider === LITELLM_PROVIDER,
        ...(ctx.model ? { model: ctx.model.id, provider: ctx.model.provider } : {}),
      });
      const traceparent = runtime.recorder.traceparent();
      if (traceparent) event.headers.traceparent = traceparent;
    }),
  );
  pi.on("message_end", (event) => guard(() => endAssistantMessage(current(), event.message)));
}

function registerToolEvents(pi: ExtensionAPI, current: () => Runtime | undefined): void {
  const previews: string[] = [];
  pi.on("tool_execution_start", (event) =>
    guard(() => current()?.recorder.beginTool(event.toolCallId, event.toolName, event.args)),
  );
  pi.on("tool_execution_end", (event) =>
    guard(() => {
      const runtime = current();
      if (!runtime) return;
      const content: unknown = isRecord(event.result) ? event.result.content : undefined;
      const output = extractText(content) || safeStringify(content);
      if (event.isError) runtime.sawError = true;
      runtime.recorder.endTool(event.toolCallId, output, event.isError);
      previews.push(`${event.toolName}: ${truncateText(output, TOOL_RESULT_PREVIEW_CHARS).text}`);
      runtime.nextInput = previews.join("\n");
    }),
  );
  pi.on("before_agent_start", () => {
    previews.length = 0;
  });
}

export default function (pi: ExtensionAPI): void {
  const config = loadConfig();
  let runtime: Runtime | undefined;
  const ensure = (ctx: ExtensionContext): Runtime => {
    runtime ??= createRuntime(config, ctx);
    return runtime;
  };
  const current = (): Runtime | undefined => runtime;
  registerAgentEvents(pi, ensure, current);
  registerLlmEvents(pi, current);
  registerToolEvents(pi, current);
}
