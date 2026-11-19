import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { chatCompletion, getDefaultSoshoRoot, loadEnvMap, resolveRoleEndpoint } from "../../llm/src/index.ts";
import {
  drainInboxToEpisodic,
  type MemoryScope,
  rebuildCoreProfile,
  searchMemoryAsync,
  upsertMemory,
} from "../../memory/src/store.ts";
import type { GraphNode } from "./schema.ts";

const execFileAsync = promisify(execFile);

export function resolveNestedPath(data: Record<string, unknown>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(data, path)) {
    return data[path];
  }
  const parts = path.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const val = resolveNestedPath(data, key);
    if (val === undefined || val === null) return "";
    return typeof val === "string" ? val : JSON.stringify(val, null, 2);
  });
}

export interface ActivityRuntimeOptions {
  piBinary?: string;
  retryBaseDelayMs?: number;
  yue2PollIntervalMs?: number;
  runId?: string;
}

export interface ActivityResult {
  outputKey?: string;
  value?: unknown;
  branch?: string;
  preview: string;
  renderedPrompt?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withNodeRetryAndTimeout<T>(
  node: GraphNode,
  fn: (signal: AbortSignal, attempt: number) => Promise<T>,
  baseDelayMs = 500,
  externalSignal?: AbortSignal,
): Promise<T> {
  const maxAttempts = Math.max(1, node.retryMaxAttempts ?? 1);
  const timeoutMs = (node.timeoutSeconds ?? 120) * 1000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (externalSignal?.aborted) {
      throw externalSignal.reason ?? new Error("Run aborted");
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = externalSignal ? AbortSignal.any([timeoutSignal, externalSignal]) : timeoutSignal;
    try {
      return await fn(signal, attempt);
    } catch (err) {
      lastError = err;
      if (externalSignal?.aborted) {
        throw err;
      }
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

async function runPiPrint(
  prompt: string,
  tier: string,
  cwd: string,
  timeoutMs: number,
  piBinary: string,
  signal?: AbortSignal,
): Promise<string> {
  const endpoint = await resolveRoleEndpoint(tier, { cwd });
  const args = [
    "--print",
    "--no-session",
    "--approve",
    "--provider",
    endpoint.provider,
    "--model",
    endpoint.model,
    prompt,
  ];
  const { stdout, stderr } = await execFileAsync(piBinary, args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 4,
    signal,
  });
  return (stdout || stderr).trim();
}

async function runYue2Job(
  baseUrl: string,
  bodyRaw: string | undefined,
  cwd: string,
  signal: AbortSignal,
  pollIntervalMs: number,
): Promise<{ jobId: string; status: string; audioPath?: string; scorePath?: string }> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const env = loadEnvMap(cwd);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.YUE2_API_KEY) {
    headers.Authorization = `Bearer ${env.YUE2_API_KEY}`;
  }

  const submitUrl = cleanBase.endsWith("/v1/jobs") ? cleanBase : `${cleanBase}/v1/jobs`;
  const gatewayRoot = cleanBase.endsWith("/v1/jobs") ? cleanBase.slice(0, -"/v1/jobs".length) : cleanBase;

  const submitRes = await fetch(submitUrl, {
    method: "POST",
    headers,
    body: bodyRaw || "{}",
    signal,
  });
  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    throw new Error(`YuE2 submit failed (${submitRes.status}): ${text.slice(0, 200)}`);
  }
  const submitted = (await submitRes.json()) as { id?: string; job_id?: string };
  const jobId = submitted.id || submitted.job_id;
  if (!jobId) {
    throw new Error("YuE2 gateway did not return a job id");
  }

  const terminalStatuses = new Set(["succeeded", "failed", "cancelled", "truncated"]);
  let finalJob: Record<string, unknown> = {};

  while (true) {
    if (signal.aborted) {
      throw new Error(`YuE2 job ${jobId} timed out`);
    }
    const statusRes = await fetch(`${gatewayRoot}/v1/jobs/${encodeURIComponent(jobId)}`, {
      headers: env.YUE2_API_KEY ? { Authorization: `Bearer ${env.YUE2_API_KEY}` } : undefined,
      signal,
    });
    if (!statusRes.ok) {
      throw new Error(`YuE2 status check failed (${statusRes.status})`);
    }
    finalJob = (await statusRes.json()) as Record<string, unknown>;
    const status = String(finalJob.status || "");
    if (terminalStatuses.has(status)) {
      if (status !== "succeeded") {
        throw new Error(`YuE2 job ${jobId} ended with status '${status}': ${String(finalJob.error || "")}`);
      }
      break;
    }
    await sleep(pollIntervalMs);
  }

  const artifactsDir = join(cwd, ".pi", "workflows", "artifacts", jobId);
  mkdirSync(artifactsDir, { recursive: true });
  const authHeaders = env.YUE2_API_KEY ? { Authorization: `Bearer ${env.YUE2_API_KEY}` } : undefined;

  let audioPath: string | undefined;
  let scorePath: string | undefined;
  const artifacts = (finalJob.artifacts || {}) as {
    audio?: { url?: string; format?: string };
    score?: { url?: string };
  };

  if (artifacts.audio?.url) {
    const audioRes = await fetch(`${gatewayRoot}${artifacts.audio.url}`, { headers: authHeaders, signal });
    if (audioRes.ok) {
      const ext = artifacts.audio.format === "wav" ? "wav" : "flac";
      audioPath = join(artifactsDir, `song.${ext}`);
      writeFileSync(audioPath, Buffer.from(await audioRes.arrayBuffer()));
    }
  }
  if (artifacts.score?.url) {
    const scoreRes = await fetch(`${gatewayRoot}${artifacts.score.url}`, { headers: authHeaders, signal });
    if (scoreRes.ok) {
      scorePath = join(artifactsDir, "score.abc");
      writeFileSync(scorePath, await scoreRes.text(), "utf8");
    }
  }

  return { jobId, status: "succeeded", audioPath, scorePath };
}

export async function executeNodeActivity(input: {
  node: GraphNode;
  data: Record<string, unknown>;
  cwd: string;
  signal?: AbortSignal;
  options?: ActivityRuntimeOptions;
}): Promise<ActivityResult> {
  const { node, data, cwd, signal: externalSignal, options } = input;
  const piBinary = options?.piBinary || process.env.SOSHO_PI_BIN || "pi";
  const retryBaseDelayMs = options?.retryBaseDelayMs ?? 500;
  const yue2PollIntervalMs = options?.yue2PollIntervalMs ?? 2000;
  const timeoutMs = (node.timeoutSeconds ?? 120) * 1000;

  return withNodeRetryAndTimeout(
    node,
    async (signal) => {
      switch (node.type) {
        case "agent": {
          const prompt = renderTemplate(node.promptTemplate, data);
          const sys = node.systemPrompt || "You are a precise, concise Sosho workflow agent.";
          const res = await chatCompletion({
            role: node.tier,
            messages: [
              { role: "system", content: sys },
              { role: "user", content: prompt },
            ],
            temperature: 0.2,
            timeoutMs,
            signal,
            cwd,
            traceId: options?.runId,
            traceName: `Workflow Agent: ${node.label}`,
            metadata: { nodeId: node.id, nodeType: node.type },
          });
          return {
            outputKey: node.outputKey,
            value: res.content,
            preview: res.content.slice(0, 240),
            renderedPrompt: prompt,
          };
        }

        case "subagent": {
          const prompt = renderTemplate(node.promptTemplate, data);
          const hasSkills = Array.isArray(node.skills) && node.skills.length > 0;
          if (hasSkills) {
            const fullPrompt = [
              `You are a focused subagent (${node.role}).`,
              `Use these skills as needed: ${node.skills!.join(", ")}.`,
              "",
              prompt,
            ].join("\n");
            const text = await runPiPrint(fullPrompt, node.tier, cwd, timeoutMs, piBinary, signal);
            return {
              outputKey: node.outputKey,
              value: text,
              preview: text.slice(0, 240),
              renderedPrompt: fullPrompt,
            };
          }
          const sys = `You are a focused subagent (${node.role}). Return a concise structured result.`;
          const res = await chatCompletion({
            role: node.tier,
            messages: [
              { role: "system", content: sys },
              { role: "user", content: prompt },
            ],
            temperature: 0.2,
            timeoutMs,
            signal,
            cwd,
            traceId: options?.runId,
            traceName: `Workflow Subagent: ${node.role}`,
            metadata: { nodeId: node.id, role: node.role },
          });
          return {
            outputKey: node.outputKey,
            value: res.content,
            preview: res.content.slice(0, 240),
            renderedPrompt: prompt,
          };
        }

        case "decision": {
          const prompt = renderTemplate(node.promptTemplate, data);
          const sys = `You are a fast deterministic router. Choose exactly ONE branch from: ${JSON.stringify(node.branches)}. Respond ONLY with valid JSON: {"branch": "<chosen>", "reason": "<short>"}.`;
          const res = await chatCompletion({
            role: node.tier,
            messages: [
              { role: "system", content: sys },
              { role: "user", content: prompt },
            ],
            temperature: 0.0,
            timeoutMs,
            signal,
            cwd,
            traceId: options?.runId,
            traceName: `Workflow Decision: ${node.label}`,
            metadata: { nodeId: node.id, branches: node.branches },
          });
          const text = res.content;
          let chosen = node.branches[0];
          try {
            const match = text.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(match ? match[0] : text) as { branch?: string };
            if (parsed.branch && node.branches.includes(parsed.branch)) {
              chosen = parsed.branch;
            }
          } catch {
            const found = node.branches.find((b) => text.toLowerCase().includes(b.toLowerCase()));
            if (found) chosen = found;
          }
          return {
            outputKey: node.outputKey,
            value: chosen,
            branch: chosen,
            preview: `branch=${chosen}`,
            renderedPrompt: prompt,
          };
        }

        case "skill": {
          const skillCandidates = [
            join(cwd, ".pi", "skills", node.skillName, "SKILL.md"),
            join(getDefaultSoshoRoot(), ".pi", "skills", node.skillName, "SKILL.md"),
          ];
          const skillPath = skillCandidates.find((p) => existsSync(p));
          const skillInstructions = skillPath
            ? readFileSync(skillPath, "utf8").slice(0, 6000)
            : `Skill '${node.skillName}' requested.`;
          const prompt = renderTemplate(node.promptTemplate, data);
          const fullPrompt = `Follow this Sosho skill (${node.skillName}):\n\n${skillInstructions}\n\nTask:\n${prompt}`;
          const text = await runPiPrint(fullPrompt, node.tier, cwd, timeoutMs, piBinary, signal);
          return {
            outputKey: node.outputKey,
            value: text,
            preview: text.slice(0, 240),
            renderedPrompt: fullPrompt,
          };
        }

        case "tool": {
          const target = renderTemplate(node.commandOrUrl, data);
          if (node.toolKind === "shell") {
            const { stdout, stderr } = await execFileAsync("bash", ["-lc", target], {
              cwd,
              timeout: timeoutMs,
              maxBuffer: 1024 * 1024 * 4,
              signal,
            });
            const out = (stdout || stderr).trim();
            return {
              outputKey: node.outputKey,
              value: out,
              preview: out.slice(0, 240),
              renderedPrompt: target,
            };
          }
          if (node.toolKind === "yue2") {
            const body = node.bodyTemplate ? renderTemplate(node.bodyTemplate, data) : undefined;
            const result = await runYue2Job(target, body, cwd, signal, yue2PollIntervalMs);
            return {
              outputKey: node.outputKey,
              value: result,
              preview: `yue2 ${result.jobId} (${result.audioPath ? "audio saved" : "done"})`,
              renderedPrompt: body || target,
            };
          }
          const method = node.method || (node.bodyTemplate ? "POST" : "GET");
          const body = node.bodyTemplate ? renderTemplate(node.bodyTemplate, data) : undefined;
          const res = await fetch(target, {
            method,
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body,
            signal,
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP tool ${res.status}: ${text.slice(0, 200)}`);
          return {
            outputKey: node.outputKey,
            value: text,
            preview: text.slice(0, 240),
            renderedPrompt: target,
          };
        }

        case "memory": {
          if (node.operation === "search") {
            const q = renderTemplate(node.queryOrTitleTemplate || "", data);
            const hits = await searchMemoryAsync({ query: q, scope: node.scope, limit: 6 }, cwd);
            const formatted = hits.map((h) => `[${h.record.id}] ${h.record.title}: ${h.record.content}`).join("\n");
            return {
              outputKey: node.outputKey,
              value: formatted || "(no matching memories)",
              preview: `${hits.length} memories recalled`,
              renderedPrompt: q,
            };
          }
          if (node.operation === "save") {
            const scope: MemoryScope = node.scope === "global" ? "global" : "project";
            const title = renderTemplate(node.queryOrTitleTemplate || "Workflow Memory", data);
            const content = renderTemplate(node.contentTemplate || "", data);
            const res = upsertMemory(
              { scope, type: node.memoryType || "semantic", title, content },
              cwd,
            );
            rebuildCoreProfile(scope, cwd);
            return {
              outputKey: node.outputKey,
              value: res.record.id,
              preview: `saved ${res.record.id} (${scope})`,
              renderedPrompt: `${title}: ${content}`,
            };
          }
          const scopes: MemoryScope[] =
            node.scope === "global" ? ["global"] : node.scope === "project" ? ["project"] : ["project", "global"];
          const counts: Record<string, number> = {};
          for (const s of scopes) counts[s] = drainInboxToEpisodic(s, cwd);
          return {
            outputKey: node.outputKey,
            value: counts,
            preview: `consolidated ${JSON.stringify(counts)}`,
          };
        }

        case "checkpoint":
          return { preview: "checkpoint reached" };
      }
    },
    retryBaseDelayMs,
    externalSignal,
  );
}
