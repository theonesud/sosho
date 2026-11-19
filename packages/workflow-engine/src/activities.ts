import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  drainInboxToEpisodic,
  type MemoryScope,
  rebuildCoreProfile,
  searchMemory,
  upsertMemory,
} from "../../memory/src/store.ts";
import type { GraphNode, ModelTier } from "./schema.ts";

const execFileAsync = promisify(execFile);

interface ModelRolesConfig {
  roles: Record<
    string,
    {
      provider: string;
      model: string;
      healthUrl?: string;
      fallback?: { provider: string; model: string };
    }
  >;
}

interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
}

interface ModelsFile {
  providers: Record<string, ProviderConfig>;
}

export function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const val = data[key];
    if (val === undefined || val === null) return "";
    return typeof val === "string" ? val : JSON.stringify(val, null, 2);
  });
}

async function resolveEndpoint(
  tier: ModelTier,
  cwd: string,
): Promise<{ baseUrl: string; apiKey: string; model: string }> {
  const rolesPath = join(cwd, ".pi", "model-roles.json");
  const modelsPath = join(cwd, ".pi", "models.json");
  const roles = existsSync(rolesPath)
    ? (JSON.parse(readFileSync(rolesPath, "utf8")) as ModelRolesConfig).roles
    : {};
  const providers = existsSync(modelsPath)
    ? (JSON.parse(readFileSync(modelsPath, "utf8")) as ModelsFile).providers
    : {};

  const role = roles[tier] || { provider: "deepinfra", model: "deepseek-ai/DeepSeek-V4.1-Flash-1017" };
  let providerName = role.provider;
  let model = role.model;

  if (role.healthUrl && role.fallback) {
    try {
      const res = await fetch(role.healthUrl, { signal: AbortSignal.timeout(500) });
      if (!res.ok) {
        providerName = role.fallback.provider;
        model = role.fallback.model;
      }
    } catch {
      providerName = role.fallback.provider;
      model = role.fallback.model;
    }
  }

  const prov = providers[providerName] || { baseUrl: "https://api.deepinfra.com/v1/openai" };
  const apiKey =
    providerName === "deepinfra"
      ? process.env.DEEPINFRA_API_KEY || ""
      : providerName === "refuseless"
        ? process.env.REFUSELESS_API_KEY || ""
        : "local";

  return { baseUrl: prov.baseUrl.replace(/\/$/, ""), apiKey, model };
}

async function callChatCompletion(
  tier: ModelTier,
  systemPrompt: string,
  userPrompt: string,
  cwd: string,
  temperature = 0.2,
): Promise<{ text: string; model: string }> {
  const { baseUrl, apiKey, model } = await resolveEndpoint(tier, cwd);
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`LLM call failed (${res.status}) for ${model}: ${errBody.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content?.trim() || "";
  return { text, model };
}

export async function emitCanvasEvent(event: Record<string, unknown>): Promise<void> {
  const url = process.env.SOSHO_STUDIO_EVENT_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestamp: new Date().toISOString(), ...event }),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // Non-fatal: canvas UI might not be running
  }
}

export async function executeNodeActivity(input: {
  node: GraphNode;
  data: Record<string, unknown>;
  cwd: string;
}): Promise<{ outputKey?: string; value?: unknown; branch?: string; preview: string }> {
  const { node, data, cwd } = input;

  switch (node.type) {
    case "agent": {
      const prompt = renderTemplate(node.promptTemplate, data);
      const sys = node.systemPrompt || "You are a precise, concise Sosho workflow agent.";
      const { text } = await callChatCompletion(node.tier, sys, prompt, cwd);
      return { outputKey: node.outputKey, value: text, preview: text.slice(0, 240) };
    }

    case "subagent": {
      const prompt = renderTemplate(node.promptTemplate, data);
      const sys = `You are a focused subagent (${node.role}). Return a concise structured result.`;
      const { text } = await callChatCompletion(node.tier, sys, prompt, cwd);
      return { outputKey: node.outputKey, value: text, preview: text.slice(0, 240) };
    }

    case "decision": {
      const prompt = renderTemplate(node.promptTemplate, data);
      const sys = `You are a fast deterministic router. Choose exactly ONE branch from: ${JSON.stringify(node.branches)}. Respond ONLY with valid JSON: {"branch": "<chosen>", "reason": "<short>"}.`;
      const { text } = await callChatCompletion(node.tier, sys, prompt, cwd, 0.0);
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
      return { outputKey: node.outputKey, value: chosen, branch: chosen, preview: `branch=${chosen}` };
    }

    case "skill": {
      const skillPath = join(cwd, ".pi", "skills", node.skillName, "SKILL.md");
      const skillInstructions = existsSync(skillPath)
        ? readFileSync(skillPath, "utf8").slice(0, 6000)
        : `Skill '${node.skillName}' requested.`;
      const prompt = renderTemplate(node.promptTemplate, data);
      const { text } = await callChatCompletion(
        node.tier,
        `Follow this Sosho skill specification:\n\n${skillInstructions}`,
        prompt,
        cwd,
      );
      return { outputKey: node.outputKey, value: text, preview: text.slice(0, 240) };
    }

    case "tool": {
      const target = renderTemplate(node.commandOrUrl, data);
      if (node.toolKind === "shell") {
        const { stdout, stderr } = await execFileAsync("bash", ["-lc", target], {
          cwd,
          timeout: (node.timeoutSeconds ?? 120) * 1000,
          maxBuffer: 1024 * 1024 * 4,
        });
        const out = (stdout || stderr).trim();
        return { outputKey: node.outputKey, value: out, preview: out.slice(0, 240) };
      }
      const method = node.method || (node.bodyTemplate ? "POST" : "GET");
      const body = node.bodyTemplate ? renderTemplate(node.bodyTemplate, data) : undefined;
      const res = await fetch(target, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP tool ${res.status}: ${text.slice(0, 200)}`);
      return { outputKey: node.outputKey, value: text, preview: text.slice(0, 240) };
    }

    case "memory": {
      if (node.operation === "search") {
        const q = renderTemplate(node.queryOrTitleTemplate || "", data);
        const hits = searchMemory({ query: q, scope: node.scope, limit: 6 }, cwd);
        const formatted = hits.map((h) => `[${h.record.id}] ${h.record.title}: ${h.record.content}`).join("\n");
        return {
          outputKey: node.outputKey,
          value: formatted || "(no matching memories)",
          preview: `${hits.length} memories recalled`,
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
}

export async function consolidateMemoryActivity(input: {
  scope: MemoryScope | "both";
  cwd: string;
}): Promise<Record<string, number>> {
  const scopes: MemoryScope[] =
    input.scope === "global" ? ["global"] : input.scope === "project" ? ["project"] : ["project", "global"];
  const counts: Record<string, number> = {};
  for (const s of scopes) {
    counts[s] = drainInboxToEpisodic(s, input.cwd);
    rebuildCoreProfile(s, input.cwd);
  }
  return counts;
}
