import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";

export type ModelRole = "main" | "subagent" | "subagent-code" | "decision" | "local-uncensored";

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

const MAX_DEPTH = 3;
const MAX_SUMMARY_CHARS = 3500;

const DEFAULT_ROLES: Record<string, RoleConfig> = {
  main: { provider: "deepinfra", model: "deepseek-ai/DeepSeek-V4.1-Flash-1017", concurrency: 2 },
  subagent: { provider: "deepinfra", model: "Qwen/Qwen3-32B", concurrency: 3 },
  "subagent-code": { provider: "deepinfra", model: "Qwen/Qwen3-Coder-30B-A3B-Instruct", concurrency: 3 },
  decision: {
    provider: "llama-decision",
    model: "Qwen3-1.7B",
    healthUrl: "http://127.0.0.1:8081/health",
    fallback: { provider: "deepinfra", model: "Qwen/Qwen3-Coder-30B-A3B-Instruct" },
    concurrency: 4,
  },
  "local-uncensored": {
    provider: "llama.cpp",
    model: "Qwen3.6-35B-A3B",
    healthUrl: "http://127.0.0.1:8080/health",
    concurrency: 1,
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

async function resolveModel(
  tier: string,
  cwd: string,
): Promise<{ provider: string; model: string; concurrency: number }> {
  const roles = loadRoles(cwd);
  const cfg = roles[tier] || roles.subagent || DEFAULT_ROLES.subagent;
  if (cfg.healthUrl) {
    const healthy = await isHealthy(cfg.healthUrl);
    if (!healthy && cfg.fallback) {
      return {
        provider: cfg.fallback.provider,
        model: cfg.fallback.model,
        concurrency: cfg.concurrency ?? 3,
      };
    }
  }
  return {
    provider: cfg.provider,
    model: cfg.model,
    concurrency: cfg.concurrency ?? 3,
  };
}

function getSubagentOutputDir(cwd: string): string {
  const base =
    process.env.SOSHO_PERMANENT_DIR ||
    join(cwd, ".pi", "scratchpad", "subagents");
  const dir = join(base, "subagents");
  mkdirSync(dir, { recursive: true });
  return dir;
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
  const currentDepth = Number(process.env.LANGFUSE_PI_PARENT_DEPTH ?? "0");
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
  const { provider, model } = await resolveModel(tier, cwd);
  const id = `${params.role.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}-${randomBytes(3).toString("hex")}`;
  const outDir = getSubagentOutputDir(cwd);
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
    LANGFUSE_PI_PARENT_DEPTH: String(currentDepth + 1),
    LANGFUSE_PI_PARENT_SESSION_ID:
      process.env.LANGFUSE_PI_PARENT_SESSION_ID ||
      ctx.sessionManager?.getSessionId?.() ||
      process.env.SOSHO_SESSION_ID ||
      "",
  };

  return new Promise<SubagentResult>((resolve) => {
    const args = [
      "--print",
      "--approve",
      "--provider",
      provider,
      "--model",
      model,
      prompt,
    ];

    const child = spawn("pi", args, {
      cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const finish = (exitCode: number | null, timedOut = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const durationMs = Date.now() - start;
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
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      stderr += `\nSpawn error: ${err.message}`;
      finish(1, false);
    });
    child.on("close", (code) => {
      finish(code, false);
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
      "Delegate an isolated subtask to a specialized subagent using a cost/speed-appropriate model tier ('subagent' for general research/synthesis, 'subagent-code' for coding/repo exploration, 'decision' for fast classification/routing, 'local-uncensored' for private/security tasks, 'main' for deep reasoning).",
    promptSnippet: "subagent_run: Delegate a focused subtask to a model-tiered subagent",
    parameters: {
      type: "object",
      properties: {
        role: { type: "string", description: "Short role name (e.g., 'Repo Researcher', 'Test Writer')" },
        task: { type: "string", description: "Clear, self-contained task description and expected output" },
        tier: {
          type: "string",
          enum: ["subagent", "subagent-code", "decision", "local-uncensored", "main"],
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
                enum: ["subagent", "subagent-code", "decision", "local-uncensored", "main"],
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
      const hasLocalGpu = tasks.some((t) => t.tier === "local-uncensored");
      const concurrency = hasLocalGpu ? 1 : 3;
      const results = await runWithConcurrency(tasks, concurrency, (t) =>
        executeSingleSubagent(t, ctx, signal),
      );

      const blocks = results.map(
        (r, i) =>
          `### ${i + 1}. ${r.role} (${r.provider}/${r.model}) — ${r.ok ? "OK" : "FAILED"} (${(r.durationMs / 1000).toFixed(1)}s)\n` +
          (r.outputPath ? `Log: \`${r.outputPath}\`\n\n` : "\n") +
          r.summary,
      );

      return {
        content: [{ type: "text", text: blocks.join("\n\n---\n\n") }],
        details: { count: results.length, results },
      };
    },
  });
}
