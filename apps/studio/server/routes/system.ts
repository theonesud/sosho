import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { z } from "zod";
import { loadEnvMap, loadModelRoles, loadModelsConfig } from "../../../../packages/llm/src/index.ts";
import { HttpError, parseValidatedBody, type StudioContext } from "../context.ts";
import { listSkills } from "./skills.ts";

const execFileAsync = promisify(execFile);

const unloadSchema = z.object({
  target: z.enum(["llama-cpp", "yue2"]),
});

function stripApiSuffix(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
}

async function probeService(id: string, name: string, targetUrl: string, uiUrl: string, detail: string) {
  const t0 = Date.now();
  try {
    const r = await fetch(targetUrl, { signal: AbortSignal.timeout(1500) });
    return { id, name, ok: r.ok, status: r.status, latencyMs: Date.now() - t0, url: uiUrl, detail };
  } catch {
    return { id, name, ok: false, status: 0, latencyMs: Date.now() - t0, url: uiUrl, detail };
  }
}

export async function queryGpuState(): Promise<{
  available: boolean;
  gpus: Array<{
    name: string;
    memoryUsedMb: number;
    memoryTotalMb: number;
    utilizationPct: number;
    temperatureC: number;
  }>;
}> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu", "--format=csv,noheader,nounits"],
      { timeout: 3000 },
    );
    const gpus = stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [name, used, total, util, temp] = line.split(",").map((s) => s.trim());
        return {
          name: name || "GPU",
          memoryUsedMb: Number(used) || 0,
          memoryTotalMb: Number(total) || 0,
          utilizationPct: Number(util) || 0,
          temperatureC: Number(temp) || 0,
        };
      });
    return { available: gpus.length > 0, gpus };
  } catch {
    return { available: false, gpus: [] };
  }
}

export function createSystemRoutes(ctx: StudioContext): Hono {
  const app = new Hono();

  app.get("/status", async (c) => {
    const env = loadEnvMap(ctx.root, ctx.root);
    const { roles } = loadModelRoles(ctx.root, ctx.root);
    const { providers } = loadModelsConfig(ctx.root, ctx.root);

    const providerBase = (key: string, fallback: string) =>
      providers[key]?.baseUrl ? stripApiSuffix(providers[key].baseUrl) : fallback;

    const llamaCppBase = stripApiSuffix(env.LLAMA_CPP_URL || providerBase("llama-cpp", "http://127.0.0.1:8080"));
    const llamaDecisionBase = stripApiSuffix(
      env.LLAMA_DECISION_URL || providerBase("llama-decision", "http://127.0.0.1:8081"),
    );
    const llamaEmbedBase = stripApiSuffix(env.LLAMA_EMBED_URL || providerBase("llama-embed", "http://127.0.0.1:8082"));
    const langfuseBase = (env.LANGFUSE_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
    const yue2Base = (env.YUE2_GATEWAY_URL || "http://127.0.0.1:8021").replace(/\/+$/, "");

    const services = await Promise.all([
      probeService("llama-cpp", "Local GPU LLM", `${llamaCppBase}/health`, llamaCppBase, `GPU LLM (${llamaCppBase})`),
      probeService(
        "llama-decision",
        "CPU Decision Router",
        `${llamaDecisionBase}/health`,
        llamaDecisionBase,
        `Decision Router (${llamaDecisionBase})`,
      ),
      probeService(
        "llama-embed",
        "CPU Embeddings",
        `${llamaEmbedBase}/health`,
        llamaEmbedBase,
        `Embeddings (${llamaEmbedBase})`,
      ),
      probeService(
        "langfuse",
        "Langfuse Telemetry",
        `${langfuseBase}/api/public/health`,
        langfuseBase,
        `Traces & Prompts (${langfuseBase})`,
      ),
      probeService(
        "yue2",
        "YuE2 Music Gateway",
        `${yue2Base}/health/live`,
        `${yue2Base}/docs`,
        `Audio Synthesis (${yue2Base})`,
      ),
    ]);

    services.unshift({
      id: "studio-api",
      name: "Sosho Studio API",
      ok: true,
      status: 200,
      latencyMs: 0,
      url: `http://127.0.0.1:${ctx.port}`,
      detail: `SQLite WAL DAG Engine (:${ctx.port})`,
    });

    const skills = listSkills(ctx.skillsDir);
    return c.json({
      services,
      roles,
      providers: Object.keys(providers),
      skills,
    });
  });

  app.get("/gpu", async (c) => {
    const gpu = await queryGpuState();
    return c.json(gpu);
  });

  app.post("/gpu/unload", async (c) => {
    const body = await parseValidatedBody(c, unloadSchema);
    const target = body.target;
    let ok = false;
    let output = "";
    try {
      const composeService = target === "llama-cpp" ? "llama-cpp" : "yue2-gateway";
      const { stdout, stderr } = await execFileAsync("docker", ["compose", "stop", composeService], {
        cwd: ctx.root,
        timeout: 15_000,
      });
      ok = true;
      output = (stdout + stderr).trim();
    } catch (err) {
      output = err instanceof Error ? err.message : String(err);
    }

    const gpu = await queryGpuState();
    ctx.sse.broadcastGpuState({ target, unloaded: ok, ...gpu });
    return c.json({ ok, target, output, gpu });
  });

  app.post("/doctor", async (c) => {
    const doctorPath = join(ctx.root, "bin", "doctor.sh");
    if (!existsSync(doctorPath)) {
      throw new HttpError(404, "bin/doctor.sh not found");
    }
    try {
      const { stdout, stderr } = await execFileAsync("bash", [doctorPath], {
        cwd: ctx.root,
        timeout: 30_000,
      });
      return c.json({ ok: true, exitCode: 0, stdout, stderr });
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return c.json({
        ok: false,
        exitCode: typeof e.code === "number" ? e.code : 1,
        stdout: e.stdout || "",
        stderr: e.stderr || e.message || String(err),
      });
    }
  });

  return app;
}
