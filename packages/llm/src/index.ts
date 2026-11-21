import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface RoleTarget {
  provider: string;
  model: string;
}

export interface ModelRoleConfig {
  provider: string;
  model: string;
  healthUrl?: string;
  fallback?: RoleTarget;
  concurrency?: number;
  description?: string;
}

export interface ModelRolesFile {
  roles: Record<string, ModelRoleConfig>;
}

export interface ProviderConfig {
  baseUrl: string;
  api?: string;
  apiKey?: string;
  models?: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
  }>;
}

export interface ModelsFile {
  providers: Record<string, ProviderConfig>;
}

export interface ResolvedEndpoint {
  role: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  concurrency: number;
  usedFallback: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  role?: string;
  provider?: string;
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  cwd?: string;
  soshoRoot?: string;
  traceName?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatCompletionResult {
  content: string;
  provider: string;
  model: string;
  durationMs: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export type ChatCompletionStreamEvent =
  | { type: "delta"; content: string }
  | {
      type: "done";
      content: string;
      provider: string;
      model: string;
      durationMs: number;
      usage?: ChatCompletionResult["usage"];
      fallbackUsed: boolean;
    };

export function getDefaultSoshoRoot(): string {
  if (process.env.SOSHO_ROOT && existsSync(join(process.env.SOSHO_ROOT, ".pi"))) {
    return resolve(process.env.SOSHO_ROOT);
  }
  const candidate = resolve(join(import.meta.dirname, "../.."));
  if (existsSync(join(candidate, ".pi"))) return candidate;
  return join(homedir(), "sosho");
}

export function parseDotEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function loadEnvMap(cwd: string = process.cwd(), soshoRoot: string = getDefaultSoshoRoot()): Record<string, string> {
  const merged: Record<string, string> = {};
  const soshoEnv = join(soshoRoot, ".env");
  if (existsSync(soshoEnv)) {
    Object.assign(merged, parseDotEnv(readFileSync(soshoEnv, "utf8")));
  }
  const cwdEnv = join(cwd, ".env");
  if (resolve(cwdEnv) !== resolve(soshoEnv) && existsSync(cwdEnv)) {
    Object.assign(merged, parseDotEnv(readFileSync(cwdEnv, "utf8")));
  }
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) merged[k] = v;
  }
  return merged;
}

function readJsonFromWorkspaceOrSosho<T>(
  relPath: string,
  cwd: string,
  soshoRoot: string,
): T | null {
  const candidates = [join(cwd, relPath), join(soshoRoot, relPath)];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf8")) as T;
      } catch {
        // try next
      }
    }
  }
  return null;
}

export function loadModelRoles(
  cwd: string = process.cwd(),
  soshoRoot: string = getDefaultSoshoRoot(),
): ModelRolesFile {
  return readJsonFromWorkspaceOrSosho<ModelRolesFile>(join(".pi", "model-roles.json"), cwd, soshoRoot) || { roles: {} };
}

export function loadModelsConfig(
  cwd: string = process.cwd(),
  soshoRoot: string = getDefaultSoshoRoot(),
): ModelsFile {
  return readJsonFromWorkspaceOrSosho<ModelsFile>(join(".pi", "models.json"), cwd, soshoRoot) || { providers: {} };
}

export function resolveProviderApiKey(
  providerName: string,
  providerCfg: ProviderConfig | undefined,
  env: Record<string, string>,
): string {
  // 1. Check standard <PROVIDER>_API_KEY env var
  const norm = providerName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const directEnv = env[`${norm}_API_KEY`];
  if (directEnv) return directEnv;

  // 2. Check apiKey field in models.json (extract ${VAR} from !bash commands or use literal)
  const rawKey = providerCfg?.apiKey?.trim();
  if (rawKey) {
    if (rawKey.startsWith("!")) {
      const m = rawKey.match(/\$\{([A-Z0-9_]+)(?::-[^}]*)?\}/);
      if (m && env[m[1]]) return env[m[1]];
    } else {
      return rawKey;
    }
  }

  return "local";
}

// 15-second health check cache
const healthCache = new Map<string, { ok: boolean; expiresAt: number }>();
export const DEFAULT_HEALTH_TTL_MS = 15_000;

export function clearHealthCache(): void {
  healthCache.clear();
}

export async function isHealthEndpointUp(
  healthUrl: string,
  ttlMs: number = DEFAULT_HEALTH_TTL_MS,
  nowFn: () => number = Date.now,
): Promise<boolean> {
  const now = nowFn();
  const cached = healthCache.get(healthUrl);
  if (cached && cached.expiresAt > now) {
    return cached.ok;
  }

  let ok = false;
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
    ok = res.ok;
  } catch {
    ok = false;
  }

  healthCache.set(healthUrl, { ok, expiresAt: now + ttlMs });
  return ok;
}

export async function resolveRoleEndpoint(
  roleName: string,
  options: {
    cwd?: string;
    soshoRoot?: string;
    healthTtlMs?: number;
    nowFn?: () => number;
  } = {},
): Promise<ResolvedEndpoint> {
  const cwd = options.cwd ?? process.cwd();
  const soshoRoot = options.soshoRoot ?? getDefaultSoshoRoot();
  const env = loadEnvMap(cwd, soshoRoot);
  const rolesFile = loadModelRoles(cwd, soshoRoot);
  const modelsFile = loadModelsConfig(cwd, soshoRoot);

  const roleCfg = rolesFile.roles[roleName] || rolesFile.roles.main;
  if (!roleCfg) {
    throw new Error(`Unknown model role: ${roleName}`);
  }

  let provider = roleCfg.provider;
  let model = roleCfg.model;
  let usedFallback = false;

  if (roleCfg.healthUrl && roleCfg.fallback) {
    const healthy = await isHealthEndpointUp(
      roleCfg.healthUrl,
      options.healthTtlMs ?? DEFAULT_HEALTH_TTL_MS,
      options.nowFn ?? Date.now,
    );
    if (!healthy) {
      provider = roleCfg.fallback.provider;
      model = roleCfg.fallback.model;
      usedFallback = true;
    }
  }

  const providerCfg = modelsFile.providers[provider];
  if (!providerCfg || !providerCfg.baseUrl) {
    throw new Error(`Provider '${provider}' not found in .pi/models.json`);
  }

  const apiKey = resolveProviderApiKey(provider, providerCfg, env);
  return {
    role: roleName,
    provider,
    model,
    baseUrl: providerCfg.baseUrl.replace(/\/+$/, ""),
    apiKey,
    concurrency: roleCfg.concurrency ?? 2,
    usedFallback,
  };
}

async function emitLangfuseGeneration(
  env: Record<string, string>,
  payload: {
    traceId: string;
    traceName: string;
    provider: string;
    model: string;
    input: ChatMessage[];
    output: string;
    startTime: string;
    endTime: string;
    usage?: ChatCompletionResult["usage"];
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const pk = env.LANGFUSE_PUBLIC_KEY?.trim();
  const sk = env.LANGFUSE_SECRET_KEY?.trim();
  const baseUrl = (env.LANGFUSE_BASE_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
  if (!pk || !sk) return;

  const auth = Buffer.from(`${pk}:${sk}`).toString("base64");
  const genId = randomUUID();
  const batch = {
    batch: [
      {
        id: randomUUID(),
        type: "trace-create",
        timestamp: payload.startTime,
        body: {
          id: payload.traceId,
          name: payload.traceName,
          tags: ["sosho", "llm"],
          metadata: payload.metadata ?? {},
        },
      },
      {
        id: randomUUID(),
        type: "generation-create",
        timestamp: payload.endTime,
        body: {
          id: genId,
          traceId: payload.traceId,
          name: `LLM ${payload.provider}/${payload.model}`,
          model: payload.model,
          startTime: payload.startTime,
          endTime: payload.endTime,
          input: payload.input,
          output: payload.output,
          usage: payload.usage
            ? {
                input: payload.usage.prompt_tokens,
                output: payload.usage.completion_tokens,
                total: payload.usage.total_tokens,
              }
            : undefined,
          metadata: { provider: payload.provider, ...(payload.metadata ?? {}) },
        },
      },
    ],
  };

  try {
    await fetch(`${baseUrl}/api/public/ingestion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    // Best-effort telemetry; never fail LLM call if Langfuse is unreachable
  }
}

export async function chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const cwd = options.cwd ?? process.cwd();
  const soshoRoot = options.soshoRoot ?? getDefaultSoshoRoot();
  const env = loadEnvMap(cwd, soshoRoot);

  let baseUrl: string;
  let apiKey: string;
  let provider: string;
  let model: string;

  if (options.provider && options.model) {
    const modelsFile = loadModelsConfig(cwd, soshoRoot);
    const providerCfg = modelsFile.providers[options.provider];
    if (!providerCfg?.baseUrl) {
      throw new Error(`Provider '${options.provider}' not found in .pi/models.json`);
    }
    provider = options.provider;
    model = options.model;
    baseUrl = providerCfg.baseUrl.replace(/\/+$/, "");
    apiKey = resolveProviderApiKey(provider, providerCfg, env);
  } else {
    const resolved = await resolveRoleEndpoint(options.role || "main", { cwd, soshoRoot });
    provider = resolved.provider;
    model = options.model || resolved.model;
    baseUrl = resolved.baseUrl;
    apiKey = resolved.apiKey;
  }

  const startMs = Date.now();
  const startIso = new Date(startMs).toISOString();

  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  const fetchSignal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 1024,
    }),
    signal: fetchSignal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LLM ${provider}/${model} HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: ChatCompletionResult["usage"];
  };
  const content = (data.choices?.[0]?.message?.content ?? "").trim();
  const endMs = Date.now();

  void emitLangfuseGeneration(env, {
    traceId: options.traceId || randomUUID(),
    traceName: options.traceName || "Sosho LLM Call",
    provider,
    model,
    input: options.messages,
    output: content,
    startTime: startIso,
    endTime: new Date(endMs).toISOString(),
    usage: data.usage,
    metadata: options.metadata,
  });

  return {
    content,
    provider,
    model,
    durationMs: endMs - startMs,
    usage: data.usage,
  };
}

export async function* chatCompletionStream(
  options: ChatCompletionOptions,
): AsyncGenerator<ChatCompletionStreamEvent> {
  const cwd = options.cwd ?? process.cwd();
  const soshoRoot = options.soshoRoot ?? getDefaultSoshoRoot();
  const env = loadEnvMap(cwd, soshoRoot);

  let baseUrl: string;
  let apiKey: string;
  let provider: string;
  let model: string;
  let fallbackUsed = false;

  if (options.provider && options.model) {
    const modelsFile = loadModelsConfig(cwd, soshoRoot);
    const providerCfg = modelsFile.providers[options.provider];
    if (!providerCfg?.baseUrl) {
      throw new Error(`Provider '${options.provider}' not found in .pi/models.json`);
    }
    provider = options.provider;
    model = options.model;
    baseUrl = providerCfg.baseUrl.replace(/\/+$/, "");
    apiKey = resolveProviderApiKey(provider, providerCfg, env);
  } else {
    const resolved = await resolveRoleEndpoint(options.role || "main", { cwd, soshoRoot });
    provider = resolved.provider;
    model = options.model || resolved.model;
    baseUrl = resolved.baseUrl;
    apiKey = resolved.apiKey;
    fallbackUsed = resolved.usedFallback;
  }

  const startMs = Date.now();
  const startIso = new Date(startMs).toISOString();

  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  const fetchSignal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 1024,
      stream: true,
    }),
    signal: fetchSignal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LLM ${provider}/${model} HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  if (!res.body) {
    throw new Error(`LLM ${provider}/${model} returned empty stream body`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let usage: ChatCompletionResult["usage"];

  try {
    while (true) {
      if (fetchSignal.aborted) {
        throw fetchSignal.reason ?? new Error("Stream aborted");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: ChatCompletionResult["usage"];
          };
          if (parsed.usage) {
            usage = parsed.usage;
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            fullContent += delta;
            yield { type: "delta", content: delta };
          }
        } catch {
          // Ignore malformed SSE JSON chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const endMs = Date.now();
  void emitLangfuseGeneration(env, {
    traceId: options.traceId || randomUUID(),
    traceName: options.traceName || "Sosho LLM Stream",
    provider,
    model,
    input: options.messages,
    output: fullContent,
    startTime: startIso,
    endTime: new Date(endMs).toISOString(),
    usage,
    metadata: { fallbackUsed, ...(options.metadata ?? {}) },
  });

  yield {
    type: "done",
    content: fullContent,
    provider,
    model,
    durationMs: endMs - startMs,
    usage,
    fallbackUsed,
  };
}

export * from "./subagent-runtime.ts";
