import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  BoundedBuffer,
  buildSubagentCliArgs,
  getSubagentDepth,
  getSubagentOutputDir,
  MAX_STREAM_BUFFER_BYTES,
  MAX_SUBAGENT_DEPTH,
  TierSemaphoreRegistry,
} from "../../../../packages/llm/src/subagent-runtime.ts";

export type ModelRole =
  | "main"
  | "subagent"
  | "subagent-code"
  | "decision"
  | "local-uncensored"
  | "cloud-uncensored";

interface RoleConfig {
  provider: string;
  model: string;
  healthUrl?: string;
  fallback?: { provider: string; model: string };
  concurrency?: number;
  description?: string;
}

interface ModelRolesFile {
  roles: Record<string, RoleConfig>;
}

export interface SubagentRunParams {
  role: string;
  task: string;
  tier?: ModelRole;
  skills?: string[];
  timeout_seconds?: number;
}

export interface SubagentParallelParams {
  tasks: SubagentRunParams[];
}

interface SubagentResult {
  id: string;
  role: string;
  tier: string;
  provider: string;
  model: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  outputPath: string;
  summary: string;
}

const MAX_DEPTH = MAX_SUBAGENT_DEPTH;
const MAX_SUMMARY_CHARS = 3500;
const tierSemaphores = new TierSemaphoreRegistry();

// Local llama.cpp server. The launcher sets LLAMA_BASE_URL per mode.
const LLAMA_BASE_URL = (process.env.LLAMA_BASE_URL?.trim() || "http://127.0.0.1:8080").replace(/\/+$/, "");
const LLAMA_HEALTH_URL = `${LLAMA_BASE_URL}/health`;

const DEFAULT_ROLES: Record<string, RoleConfig> = {
  main: { provider: "deepinfra", model: "deepseek-ai/DeepSeek-V4.1-Flash-1017", concurrency: 2 },
  subagent: { provider: "deepinfra", model: "Qwen/Qwen3-32B", concurrency: 3 },
  "subagent-code": { provider: "deepinfra", model: "Qwen/Qwen3-Coder-30B-A3B-Instruct", concurrency: 3 },
  decision: {
    provider: "llama-decision",
    model: "Qwen3-1.7B",
    healthUrl: LLAMA_HEALTH_URL,
    concurrency: 4,
  },
  "local-uncensored": {
    provider: "llama.cpp",
    model: "Qwen3.6-35B-A3B",
    healthUrl: LLAMA_HEALTH_URL,
    concurrency: 1,
  },
  "cloud-uncensored": {
    provider: "refuseless",
    model: "deepseek-v4.1-flash-abliterated",
    concurrency: 2,
  },
};

function loadRoles(cwd: string): Record<string, RoleConfig> {
  const candidates = [
    join(cwd, ".pi", "model-roles.json"),
    join(getAgentDir(), "model-roles.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const parsed = JSON.parse(readFileSync(p, "utf8")) as ModelRolesFile;
        if (parsed?.roles && typeof parsed.roles === "object") {
          return { ...DEFAULT_ROLES, ...parsed.roles };
        }
      } catch {
        // Fall through to defaults
      }
    }
  }
  return DEFAULT_ROLES;
}

async function isHealthy(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

type ModelResolution =
  | { kind: "ready"; provider: string; model: string; concurrency: number }
  | { kind: "unhealthy"; healthUrl: string };

async function resolveModel(tier: string, cwd: string): Promise<ModelResolution> {
  const roles = loadRoles(cwd);
  const cfg = roles[tier] || roles.subagent || DEFAULT_ROLES.subagent;
  const concurrency = cfg.concurrency ?? 3;
  if (cfg.healthUrl && !(await isHealthy(cfg.healthUrl))) {
    if (cfg.fallback) {
      return { kind: "ready", provider: cfg.fallback.provider, model: cfg.fallback.model, concurrency };
    }
    // No fallback is configured. Fail here, so no prompt goes to another provider.
    return { kind: "unhealthy", healthUrl: cfg.healthUrl };
  }
  return { kind: "ready", provider: cfg.provider, model: cfg.model, concurrency };
}

function truncateSummary(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_SUMMARY_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_SUMMARY_CHARS)}\n\n...[truncated; full output saved to disk]`;
}

async function executeSingleSubagent(
  params: SubagentRunParams,
  ctx: ExtensionContext,
  abortSignal?: AbortSignal,
): Promise<SubagentResult> {
  const currentDepth = getSubagentDepth(process.env);
  if (currentDepth >= MAX_DEPTH) {
    return {
      id: "depth-limit",
      role: params.role,
      tier: params.tier || "subagent",
      provider: "none",
      model: "none",
      ok: false,
      exitCode: 1,
      durationMs: 0,
      outputPath: "",
      summary: `Blocked: max subagent nesting depth (${MAX_DEPTH}) reached.`,
    };
  }

  const cwd = ctx.cwd || process.cwd();
  const tier = params.tier || "subagent";
  const resolution = await resolveModel(tier, cwd);
  if (resolution.kind === "unhealthy") {
    return {
      id: "model-unavailable",
      role: params.role,
      tier,
      provider: "none",
      model: "none",
      ok: false,
      exitCode: 1,
      durationMs: 0,
      outputPath: "",
      summary: `Blocked: the local ${tier} model is not running. Health check failed: ${resolution.healthUrl}. No fallback is used.`,
    };
  }
  const { provider, model, concurrency } = resolution;
  const semaphore = tierSemaphores.get(tier, concurrency);

  return semaphore.run(async () => {
    const id = `${params.role.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}-${randomBytes(3).toString("hex")}`;
    const outDir = getSubagentOutputDir(cwd, process.env);
    const outputPath = join(outDir, `${id}.md`);

    const skillHint =
      params.skills && params.skills.length > 0
        ? `\nRelevant skills to consult if needed: ${params.skills.join(", ")}.`
        : "";

    const prompt = [
      `You are a focused subagent with role: ${params.role}.`,
      `Complete the task below concisely and accurately. Do not ask follow-up questions.`,
      `Return a structured final summary (<40 lines) with key findings, file paths, or results.`,
      skillHint,
      "",
      "### Task",
      params.task,
    ].join("\n");

    const timeoutMs = Math.min(Math.max((params.timeout_seconds ?? 180) * 1000, 10_000), 600_000);
    const start = Date.now();

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      SOSHO_SUBAGENT_DEPTH: String(currentDepth + 1),
      LANGFUSE_PI_PARENT_SESSION_ID:
        process.env.LANGFUSE_PI_PARENT_SESSION_ID ||
        ctx.sessionManager?.getSessionId?.() ||
        process.env.SOSHO_SESSION_ID ||
        "",
    };

    return new Promise<SubagentResult>((resolve) => {
      const args = buildSubagentCliArgs(provider, model, prompt);

      const child = spawn("pi", args, {
        cwd,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutBuf = new BoundedBuffer(MAX_STREAM_BUFFER_BYTES);
      const stderrBuf = new BoundedBuffer(MAX_STREAM_BUFFER_BYTES);
      let finished = false;

      const finish = (exitCode: number | null, timedOut = false) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        const stdout = stdoutBuf.toString();
        const stderr = stderrBuf.toString();
        const body = timedOut
          ? `Timed out after ${Math.round(timeoutMs / 1000)}s.\n\nPartial output:\n${stdout}\n${stderr}`
          : stdout.trim() || stderr.trim() || "(no output)";

        try {
          writeFileSync(
            outputPath,
            `# Subagent: ${params.role} (${id})\n- Tier: ${tier}\n- Model: ${provider}/${model}\n- Exit: ${exitCode}\n- Duration: ${durationMs}ms\n\n## Task\n${params.task}\n\n## Output\n${body}\n`,
            "utf8",
          );
        } catch {
          // Ignore disk write error
        }

        resolve({
          id,
          role: params.role,
          tier,
          provider,
          model,
          ok: !timedOut && exitCode === 0,
          exitCode,
          durationMs,
          outputPath,
          summary: truncateSummary(body),
        });
      };

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2000).unref();
        finish(null, true);
      }, timeoutMs);

      if (abortSignal) {
        const onAbort = () => {
          child.kill("SIGTERM");
          finish(null, false);
        };
        if (abortSignal.aborted) {
          onAbort();
          return;
        }
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuf.append(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBuf.append(chunk);
      });
      child.on("error", (err) => {
        stderrBuf.append(`\nSpawn error: ${err.message}`);
        finish(1, false);
      });
      child.on("close", (code) => {
        finish(code, false);
      });
    });
  });
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

export default function subagentsExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "subagent_run",
    label: "Run Subagent",
    description:
      "Delegate an isolated subtask to a specialized subagent using a cost/speed-appropriate model tier ('subagent' for general research/synthesis, 'subagent-code' for coding/repo exploration, 'decision' for fast classification/routing, 'local-uncensored' for private/security tasks, 'cloud-uncensored' for tasks the main model refuses (prompts leave the machine), 'main' for deep reasoning).",
    promptSnippet: "subagent_run: Delegate a focused subtask to a model-tiered subagent",
    parameters: {
      type: "object",
      properties: {
        role: { type: "string", description: "Short role name (e.g., 'Repo Researcher', 'Test Writer')" },
        task: { type: "string", description: "Clear, self-contained task description and expected output" },
        tier: {
          type: "string",
          enum: ["subagent", "subagent-code", "decision", "local-uncensored", "cloud-uncensored", "main"],
          description: "Model tier to use (defaults to 'subagent')",
        },
        skills: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of skill names to hint to the subagent",
        },
        timeout_seconds: {
          type: "number",
          description: "Timeout in seconds (default 180, max 600)",
        },
      },
      required: ["role", "task"],
    } as any,
    async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
      const params = rawParams as SubagentRunParams;
      const res = await executeSingleSubagent(params, ctx, signal);
      return {
        isError: !res.ok,
        content: [
          {
            type: "text",
            text: [
              `Subagent **${res.role}** (\`${res.provider}/${res.model}\`) ${res.ok ? "succeeded" : "failed"} in ${(res.durationMs / 1000).toFixed(1)}s.`,
              res.outputPath ? `Full log: \`${res.outputPath}\`` : "",
              "",
              res.summary,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
        details: res,
      };
    },
  });

  pi.registerTool({
    name: "subagent_parallel",
    label: "Run Parallel Subagents",
    description:
      "Run multiple independent subagent tasks concurrently (up to 3 cloud workers in parallel; local-uncensored tasks are automatically serialized to protect GPU VRAM).",
    promptSnippet: "subagent_parallel: Fan out multiple independent subtasks to subagents concurrently",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              task: { type: "string" },
              tier: {
                type: "string",
                enum: ["subagent", "subagent-code", "decision", "local-uncensored", "cloud-uncensored", "main"],
              },
              skills: { type: "array", items: { type: "string" } },
              timeout_seconds: { type: "number" },
            },
            required: ["role", "task"],
          },
        },
      },
      required: ["tasks"],
    } as any,
    async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
      const { tasks } = rawParams as SubagentParallelParams;
      // Per-tier module-level semaphores enforce local-uncensored=1 while cloud tiers run concurrently
      const results = await Promise.all(
        tasks.map((t) => executeSingleSubagent(t, ctx, signal)),
      );

      const blocks = results.map(
        (r, i) =>
          `### ${i + 1}. ${r.role} (${r.provider}/${r.model}) — ${r.ok ? "OK" : "FAILED"} (${(r.durationMs / 1000).toFixed(1)}s)\n` +
          (r.outputPath ? `Log: \`${r.outputPath}\`\n\n` : "\n") +
          r.summary,
      );

      return {
        isError: results.some((r) => !r.ok),
        content: [{ type: "text", text: blocks.join("\n\n---\n\n") }],
        details: { count: results.length, results },
      };
    },
  });
}
