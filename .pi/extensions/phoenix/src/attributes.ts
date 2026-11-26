export type SpanKind = "AGENT" | "CHAIN" | "LLM" | "TOOL";
export type SpanAttributes = Record<string, string | number | boolean>;

export interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Identity {
  sessionId: string;
  userId?: string;
}

export function baseAttributes(kind: SpanKind, identity: Identity): SpanAttributes {
  return {
    "openinference.span.kind": kind,
    "session.id": identity.sessionId,
    ...(identity.userId ? { "user.id": identity.userId } : {}),
  };
}

export function inputAttributes(text: string | undefined): SpanAttributes {
  if (!text) return {};
  return { "input.value": text, "input.mime_type": "text/plain" };
}

export function outputAttributes(text: string | undefined): SpanAttributes {
  if (!text) return {};
  return { "output.value": text, "output.mime_type": "text/plain" };
}

export function modelAttributes(model: string | undefined, provider: string | undefined) {
  const attributes: SpanAttributes = {};
  if (model) attributes["llm.model_name"] = model;
  if (provider) attributes["llm.provider"] = provider;
  return attributes;
}

export function usageAttributes(usage: PiUsage | undefined): SpanAttributes {
  if (!usage) return {};
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
  const total = prompt + usage.output;
  if (total <= 0) return {};
  return {
    "llm.token_count.prompt": prompt,
    "llm.token_count.completion": usage.output,
    "llm.token_count.total": total,
  };
}

export function isUsage(value: unknown): value is PiUsage {
  if (typeof value !== "object" || value === null) return false;
  const usage: Record<string, unknown> = { ...value };
  return ["input", "output", "cacheRead", "cacheWrite"].every(
    (key) => typeof usage[key] === "number",
  );
}
