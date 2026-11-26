import { DEFAULT_MAX_CHARS } from "./text.ts";

export const DEFAULT_ENDPOINT = "http://127.0.0.1:6006";
export const DEFAULT_PROJECT = "sosho";

export interface PhoenixConfig {
  tracesUrl: string;
  projectName: string;
  userId?: string;
  maxChars: number;
}

type Env = Readonly<Record<string, string | undefined>>;

export function loadConfig(env: Env = process.env): PhoenixConfig {
  const endpoint = (env.PHOENIX_COLLECTOR_ENDPOINT?.trim() || DEFAULT_ENDPOINT).replace(/\/+$/, "");
  const userId = (env.SOSHO_TRACE_USER_ID ?? env.USER)?.trim();
  const maxChars = Number(env.SOSHO_TRACE_MAX_CHARS ?? DEFAULT_MAX_CHARS);
  return {
    tracesUrl: `${endpoint}/v1/traces`,
    projectName: env.PHOENIX_PROJECT_NAME?.trim() || DEFAULT_PROJECT,
    ...(userId ? { userId } : {}),
    maxChars: Number.isFinite(maxChars) && maxChars > 0 ? maxChars : DEFAULT_MAX_CHARS,
  };
}

export function reportError(error: unknown, env: Env = process.env, write = console.error): void {
  if (env.PI_PHOENIX_DEBUG !== "1") return;
  write(`pi-phoenix: ${error instanceof Error ? error.message : String(error)}`);
}
