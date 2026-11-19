"use client";

import { Activity, BookOpen, Cpu, ExternalLink, Lock, Power, RefreshCw, Server, Stethoscope } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useStudioStore } from "@/stores/studio-store";
import type { GpuState, ServiceStatus } from "@/types";

interface RoleConfig {
  provider?: string;
  model?: string;
  description?: string;
  concurrency?: number;
  maxConcurrency?: number;
  fallback?: string | string[];
  fallbacks?: string[];
}

interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

interface SystemStatusPayload {
  services: ServiceStatus[];
  roles: Record<string, RoleConfig>;
  providers?: string[];
  skills?: SkillInfo[];
}

interface DoctorResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

const ORDERED_TIERS = ["main", "subagent", "subagent-code", "decision", "local-uncensored", "embeddings"];

function formatFallback(role?: RoleConfig): string {
  if (!role) return "—";
  if (Array.isArray(role.fallbacks) && role.fallbacks.length > 0) {
    return role.fallbacks.join(" → ");
  }
  if (Array.isArray(role.fallback) && role.fallback.length > 0) {
    return role.fallback.join(" → ");
  }
  if (typeof role.fallback === "string" && role.fallback.trim()) {
    return role.fallback.trim();
  }
  return "None";
}

export function SystemWorkspace() {
  const gpuState = useStudioStore((s) => s.gpuState);
  const setGpuState = useStudioStore((s) => s.setGpuState);

  const [statusData, setStatusData] = useState<SystemStatusPayload | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [unloadingTarget, setUnloadingTarget] = useState<"llama-cpp" | "yue2" | null>(null);
  const [unloadNote, setUnloadNote] = useState<string | null>(null);

  const [runningDoctor, setRunningDoctor] = useState(false);
  const [doctorResult, setDoctorResult] = useState<DoctorResult | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, gpuRes, skillsRes] = await Promise.all([
        fetch("/api/system/status"),
        fetch("/api/system/gpu"),
        fetch("/api/skills"),
      ]);

      if (!statusRes.ok) throw new Error(`System status failed (HTTP ${statusRes.status})`);
      const statusJson = (await statusRes.json()) as SystemStatusPayload;
      setStatusData(statusJson);

      if (gpuRes.ok) {
        const gpuJson = (await gpuRes.json()) as GpuState;
        setGpuState(gpuJson);
      }

      if (skillsRes.ok) {
        const skillsJson = (await skillsRes.json()) as { skills?: SkillInfo[] };
        setSkills(Array.isArray(skillsJson.skills) ? skillsJson.skills : []);
      } else if (Array.isArray(statusJson.skills)) {
        setSkills(statusJson.skills);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [setGpuState]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const handleUnloadGpu = async (target: "llama-cpp" | "yue2") => {
    setUnloadingTarget(target);
    setUnloadNote(null);
    try {
      const res = await fetch("/api/system/gpu/unload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const data = (await res.json()) as { ok?: boolean; output?: string; gpu?: GpuState };
      if (data.gpu) setGpuState(data.gpu);
      setUnloadNote(data.ok ? `Unloaded ${target}` : `Unload ${target}: ${data.output || "failed"}`);
    } catch (err) {
      setUnloadNote(err instanceof Error ? err.message : String(err));
    } finally {
      setUnloadingTarget(null);
    }
  };

  const handleRunDoctor = async () => {
    setRunningDoctor(true);
    setError(null);
    try {
      const res = await fetch("/api/system/doctor", { method: "POST" });
      const data = (await res.json()) as DoctorResult & { error?: string };
      if (!res.ok && data.error) {
        throw new Error(data.error);
      }
      setDoctorResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningDoctor(false);
    }
  };

  const services = statusData?.services ?? [];
  const roles = statusData?.roles ?? {};
  const langfuseService = services.find((s) => s.id === "langfuse");

  const tierKeys = Array.from(new Set([...ORDERED_TIERS, ...Object.keys(roles)]));

  return (
    <div className="flex h-full flex-col overflow-hidden bg-canvas">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-accent" />
          <h1 className="text-[14px] font-semibold text-text-primary">System Diagnostics</h1>
          <Badge variant="neutral">
            <Lock className="h-2.5 w-2.5" />
            Read-Only Config
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void handleRunDoctor()} disabled={runningDoctor}>
            <Stethoscope className="h-3.5 w-3.5" />
            {runningDoctor ? "Running Doctor..." : "Run Doctor"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void fetchAll()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Main Scrollable Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-5">
        {error && (
          <div className="rounded-md border border-error/35 bg-error/10 px-3 py-2 text-[12px] text-red-300">
            {error}
          </div>
        )}

        {/* On-Demand Doctor Output */}
        {doctorResult && (
          <section className="rounded-md border border-border-strong bg-elevated p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-accent" />
                <h2 className="text-[13px] font-semibold text-text-primary">Doctor Check Output</h2>
                <Badge variant={doctorResult.ok ? "accent" : "error"}>exit {doctorResult.exitCode}</Badge>
              </div>
              <Button variant="ghost" size="xs" onClick={() => setDoctorResult(null)}>
                Dismiss
              </Button>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border-subtle bg-canvas p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
              {[doctorResult.stdout, doctorResult.stderr].filter(Boolean).join("\n").trim() || "No output."}
            </pre>
          </section>
        )}

        {/* Service Health & Latency Cards */}
        <section className="space-y-2.5">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-text-muted" />
            <h2 className="text-[12px] font-semibold uppercase tracking-wider text-text-muted">
              Service Health & Latency
            </h2>
          </div>
          {loading && services.length === 0 ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {services.map((svc) => (
                <div
                  key={svc.id}
                  className="flex flex-col justify-between rounded-md border border-border-subtle bg-elevated p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${svc.ok ? "bg-accent" : "bg-error"}`} />
                      <span className="text-[13px] font-medium text-text-primary">{svc.name}</span>
                    </div>
                    <Badge variant={svc.ok ? "accent" : "error"}>{svc.ok ? `${svc.latencyMs}ms` : "down"}</Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-text-muted">
                    <span className="truncate font-mono">{svc.detail}</span>
                    {svc.url && (
                      <a
                        href={svc.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-text-secondary hover:text-text-primary"
                      >
                        Open
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* GPU / VRAM Owner & Langfuse Quick-Link */}
        <section className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
          {/* GPU Card */}
          <div className="rounded-md border border-border-subtle bg-elevated p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-info" />
                <h2 className="text-[13px] font-semibold text-text-primary">GPU & VRAM Owner</h2>
                <Badge variant={gpuState.owner && gpuState.owner !== "idle" ? "info" : "neutral"}>
                  {gpuState.owner ?? "idle"}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="danger"
                  size="xs"
                  disabled={unloadingTarget !== null}
                  onClick={() => void handleUnloadGpu("llama-cpp")}
                >
                  <Power className="h-3 w-3" />
                  {unloadingTarget === "llama-cpp" ? "Unloading..." : "Unload LLM"}
                </Button>
                <Button
                  variant="danger"
                  size="xs"
                  disabled={unloadingTarget !== null}
                  onClick={() => void handleUnloadGpu("yue2")}
                >
                  <Power className="h-3 w-3" />
                  {unloadingTarget === "yue2" ? "Unloading..." : "Unload YuE2"}
                </Button>
              </div>
            </div>

            {unloadNote && <div className="text-[11px] font-mono text-text-secondary">{unloadNote}</div>}

            {gpuState.gpus.length === 0 ? (
              <p className="text-[12px] text-text-muted">No NVIDIA GPU detected via nvidia-smi.</p>
            ) : (
              <div className="space-y-2.5">
                {gpuState.gpus.map((gpu) => {
                  const pct =
                    gpu.memoryTotalMb > 0 ? Math.min(100, Math.round((gpu.memoryUsedMb / gpu.memoryTotalMb) * 100)) : 0;
                  return (
                    <div key={gpu.name} className="space-y-1">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="font-medium text-text-primary">{gpu.name}</span>
                        <span className="font-mono text-[11px] text-text-secondary tabular-nums">
                          {gpu.memoryUsedMb} / {gpu.memoryTotalMb} MB ({pct}%) · {gpu.utilizationPct}% util ·{" "}
                          {gpu.temperatureC}°C
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-canvas border border-border-subtle">
                        <div className="h-full bg-info transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Langfuse Quick-Link Card */}
          <div className="flex flex-col justify-between rounded-md border border-border-subtle bg-elevated p-3.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <h2 className="text-[13px] font-semibold text-text-primary">Langfuse Telemetry</h2>
                <Badge variant={langfuseService?.ok ? "accent" : "neutral"}>
                  {langfuseService?.ok ? "online" : "offline"}
                </Badge>
              </div>
              <p className="text-[12px] text-text-muted">
                Inspect LLM traces, prompt versions, token latency, and workflow spans.
              </p>
            </div>
            <div className="mt-3">
              <Button variant="secondary" size="sm" asChild className="w-full">
                <a href={langfuseService?.url || "http://127.0.0.1:3000"} target="_blank" rel="noreferrer">
                  Open Langfuse Dashboard
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          </div>
        </section>

        {/* Read-Only Model Role Route Map */}
        <section className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[12px] font-semibold uppercase tracking-wider text-text-muted">
              Model Role Route Map (Read-Only)
            </h2>
            <span className="font-mono text-[11px] text-text-muted">
              Source: .pi/model-roles.json · .pi/models.json · .env
            </span>
          </div>
          <div className="overflow-x-auto rounded-md border border-border-subtle bg-elevated">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="border-b border-border-subtle bg-surface text-[11px] uppercase tracking-wider text-text-muted">
                  <th className="px-3 py-2 font-medium">Tier</th>
                  <th className="px-3 py-2 font-medium">Provider / Model</th>
                  <th className="px-3 py-2 font-medium">Concurrency</th>
                  <th className="px-3 py-2 font-medium">Fallback Chain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {tierKeys.map((tier) => {
                  const cfg = roles[tier];
                  const concurrency = cfg?.concurrency ?? cfg?.maxConcurrency;
                  return (
                    <tr key={tier} className="hover:bg-surface/50">
                      <td className="px-3 py-2 font-mono font-medium text-text-primary">{tier}</td>
                      <td className="px-3 py-2 font-mono text-text-secondary">
                        {cfg?.provider || cfg?.model ? (
                          <span>
                            {cfg.provider ?? "—"} / <span className="text-text-primary">{cfg.model ?? "—"}</span>
                          </span>
                        ) : (
                          <span className="text-text-muted">Unconfigured</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-text-secondary tabular-nums">
                        {typeof concurrency === "number" ? concurrency : "default"}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-text-muted">{formatFallback(cfg)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Parsed SKILL.md Cards */}
        <section className="space-y-2.5">
          <div className="flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 text-text-muted" />
            <h2 className="text-[12px] font-semibold uppercase tracking-wider text-text-muted">
              Installed Skills ({skills.length})
            </h2>
          </div>
          {skills.length === 0 ? (
            <div className="rounded-md border border-border-subtle bg-surface p-6 text-center text-[12px] text-text-muted">
              No SKILL.md definitions found in the workspace skills directory.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {skills.map((skill) => (
                <div key={skill.path} className="rounded-md border border-border-subtle bg-elevated p-3 space-y-1.5">
                  <div className="text-[13px] font-semibold text-text-primary">{skill.name}</div>
                  <p className="text-[12px] leading-relaxed text-text-secondary">
                    {skill.description || "No description provided in SKILL.md frontmatter."}
                  </p>
                  <div className="truncate pt-1 font-mono text-[10px] text-text-muted" title={skill.path}>
                    {skill.path}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
