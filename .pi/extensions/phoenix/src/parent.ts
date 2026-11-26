export const ENV_PARENT_TRACE_ID = "SOSHO_TRACE_PARENT_TRACE_ID";
export const ENV_PARENT_SPAN_ID = "SOSHO_TRACE_PARENT_SPAN_ID";
export const ENV_PARENT_SESSION_ID = "SOSHO_TRACE_PARENT_SESSION_ID";
export const ENV_PARENT_DEPTH = "SOSHO_TRACE_PARENT_DEPTH";

const HEX_TRACE_ID = /^[0-9a-f]{32}$/;
const HEX_SPAN_ID = /^[0-9a-f]{16}$/;
const ALL_ZERO = /^0+$/;

export interface InheritedParent {
  traceId: string;
  spanId: string;
  sessionId?: string;
  depth: number;
}

export function readInheritedParent(
  env: Readonly<Record<string, string | undefined>> = process.env,
): InheritedParent | undefined {
  const traceId = env[ENV_PARENT_TRACE_ID]?.trim().toLowerCase();
  const spanId = env[ENV_PARENT_SPAN_ID]?.trim().toLowerCase();
  if (!traceId || !spanId) return undefined;
  if (!HEX_TRACE_ID.test(traceId) || !HEX_SPAN_ID.test(spanId)) return undefined;
  if (ALL_ZERO.test(traceId) || ALL_ZERO.test(spanId)) return undefined;
  const depth = Number(env[ENV_PARENT_DEPTH] ?? "0");
  const sessionId = env[ENV_PARENT_SESSION_ID]?.trim();
  return {
    traceId,
    spanId,
    ...(sessionId ? { sessionId } : {}),
    depth: Number.isFinite(depth) && depth > 0 ? depth : 0,
  };
}

export function formatTraceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}
