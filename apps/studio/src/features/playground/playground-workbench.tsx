"use client";

import { Columns2, GitBranchPlus, Play, RotateCcw, Sparkles, Square, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiJson, authHeaders } from "@/api";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn, normalizeSkills } from "@/lib/utils";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { ModelTier, RawGraph, SystemStatusResponse } from "@/types";
import { consumeSsePost } from "./sse-client";
import { StreamOutputPanel } from "./stream-output-panel";
import {
  createIdleStreamState,
  PLAYGROUND_TIERS,
  type PlaygroundMode,
  type PlaygroundSseEvent,
  type RoleInfo,
  type SkillInfo,
  type StreamOutputState,
} from "./types";

const WORKFLOW_MODEL_TIERS = new Set<string>(["main", "subagent", "subagent-code", "decision", "local-uncensored"]);

function computeTokensPerSec(
  content: string,
  chunkCount: number,
  durationMs: number,
  completionTokens?: number,
): number | undefined {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return undefined;
  const tokens =
    typeof completionTokens === "number" && completionTokens > 0
      ? completionTokens
      : Math.max(chunkCount, Math.ceil(content.length / 4));
  if (tokens <= 0) return undefined;
  return tokens / (durationMs / 1000);
}

function applyStreamEvent(prev: StreamOutputState, ev: PlaygroundSseEvent): StreamOutputState {
  if (ev.type === "delta") {
    const nextContent = prev.content + ev.content;
    const nextChunks = prev.chunkCount + 1;
    const elapsedMs = prev.startedAt ? Math.max(Date.now() - prev.startedAt, 50) : undefined;
    return {
      ...prev,
      status: "streaming",
      content: nextContent,
      chunkCount: nextChunks,
      durationMs: elapsedMs,
      tokensPerSec: elapsedMs ? computeTokensPerSec(nextContent, nextChunks, elapsedMs) : prev.tokensPerSec,
    };
  }
  if (ev.type === "done") {
    const finalContent = ev.content || prev.content;
    const completionTokens = ev.usage?.completion_tokens;
    return {
      ...prev,
      status: "done",
      content: finalContent,
      provider: ev.provider,
      model: ev.model,
      durationMs: ev.durationMs,
      completionTokens,
      tokensPerSec: computeTokensPerSec(finalContent, prev.chunkCount, ev.durationMs, completionTokens),
      fallbackUsed: Boolean(ev.fallbackUsed),
      error: null,
    };
  }
  return {
    ...prev,
    status: "error",
    error: ev.message || "Stream error",
  };
}

export function PlaygroundWorkbench() {
  const router = useRouter();
  const [mode, setMode] = useState<PlaygroundMode>("chat");

  // Remote metadata
  const [roles, setRoles] = useState<Record<string, RoleInfo>>({});
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  // Inputs
  const [selectedTier, setSelectedTier] = useState<string>("main");
  const [compareTierA, setCompareTierA] = useState<string>("main");
  const [compareTierB, setCompareTierB] = useState<string>("subagent");
  const [selectedSkill, setSelectedSkill] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [temperature, setTemperature] = useState<string>("");
  const [maxTokens, setMaxTokens] = useState<string>("");
  const [promoteKind, setPromoteKind] = useState<"agent" | "subagent">("agent");

  // Outputs
  const [chatOutput, setChatOutput] = useState<StreamOutputState>(createIdleStreamState);
  const [compareOutputs, setCompareOutputs] = useState<[StreamOutputState, StreamOutputState]>([
    createIdleStreamState(),
    createIdleStreamState(),
  ]);
  const [skillOutput, setSkillOutput] = useState<StreamOutputState>(createIdleStreamState);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadMeta() {
      setLoadingMeta(true);
      setMetaError(null);
      try {
        const [statusRes, skillsRes] = await Promise.all([
          apiJson<SystemStatusResponse>("/api/system/status", { headers: authHeaders() }),
          apiJson<{ skills: SkillInfo[] }>("/api/skills", { headers: authHeaders() }),
        ]);
        if (cancelled) return;
        if (statusRes.ok && statusRes.data.roles) {
          setRoles(statusRes.data.roles);
        } else if (!statusRes.ok) {
          setMetaError(statusRes.data.error || "Could not load system tiers");
        }
        if (skillsRes.ok && Array.isArray(skillsRes.data.skills)) {
          const normalized = normalizeSkills(skillsRes.data.skills);
          setSkills(normalized);
          if (normalized.length > 0) {
            setSelectedSkill((prev) => prev || normalized[0].name);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setMetaError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    }
    void loadMeta();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  const tierList = useMemo(() => {
    const merged = new Set<string>(PLAYGROUND_TIERS);
    for (const key of Object.keys(roles)) {
      merged.add(key);
    }
    return Array.from(merged);
  }, [roles]);

  const isRunning =
    (mode === "chat" && chatOutput.status === "streaming") ||
    (mode === "compare" && (compareOutputs[0].status === "streaming" || compareOutputs[1].status === "streaming")) ||
    (mode === "skill" && skillOutput.status === "streaming");

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (mode === "chat") {
      setChatOutput((prev) => (prev.status === "streaming" ? { ...prev, status: "aborted" } : prev));
    } else if (mode === "compare") {
      setCompareOutputs(([a, b]) => [
        a.status === "streaming" ? { ...a, status: "aborted" } : a,
        b.status === "streaming" ? { ...b, status: "aborted" } : b,
      ]);
    } else {
      setSkillOutput((prev) => (prev.status === "streaming" ? { ...prev, status: "aborted" } : prev));
    }
  }, [mode]);

  const handleClear = useCallback(() => {
    if (mode === "chat") setChatOutput(createIdleStreamState());
    else if (mode === "compare") setCompareOutputs([createIdleStreamState(), createIdleStreamState()]);
    else setSkillOutput(createIdleStreamState());
  }, [mode]);

  const parseAdvanced = useCallback(() => {
    const parsedTemp = temperature.trim() === "" ? undefined : Number(temperature);
    const parsedMax = maxTokens.trim() === "" ? undefined : Number.parseInt(maxTokens, 10);
    return {
      temperature: typeof parsedTemp === "number" && Number.isFinite(parsedTemp) ? parsedTemp : undefined,
      maxTokens: typeof parsedMax === "number" && Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : undefined,
    };
  }, [temperature, maxTokens]);

  const handleRun = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || isRunning) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const adv = parseAdvanced();
    const now = Date.now();

    if (mode === "chat") {
      const roleInfo = roles[selectedTier];
      setChatOutput({
        status: "streaming",
        content: "",
        error: null,
        provider: roleInfo?.provider,
        model: roleInfo?.model,
        startedAt: now,
        chunkCount: 0,
      });

      try {
        await consumeSsePost(
          "/api/playground/chat",
          {
            role: selectedTier,
            prompt: trimmedPrompt,
            systemPrompt: systemPrompt.trim() || undefined,
            ...adv,
          },
          ac.signal,
          (ev) => {
            setChatOutput((prev) => applyStreamEvent(prev, ev));
          },
        );
        setChatOutput((prev) => (prev.status === "streaming" ? { ...prev, status: "done" } : prev));
      } catch (err) {
        if (ac.signal.aborted) {
          setChatOutput((prev) => (prev.status === "streaming" ? { ...prev, status: "aborted" } : prev));
        } else {
          setChatOutput((prev) => ({
            ...prev,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
      return;
    }

    if (mode === "compare") {
      const infoA = roles[compareTierA];
      const infoB = roles[compareTierB];
      setCompareOutputs([
        {
          status: "streaming",
          content: "",
          error: null,
          provider: infoA?.provider,
          model: infoA?.model,
          startedAt: now,
          chunkCount: 0,
        },
        {
          status: "streaming",
          content: "",
          error: null,
          provider: infoB?.provider,
          model: infoB?.model,
          startedAt: now,
          chunkCount: 0,
        },
      ]);

      try {
        await consumeSsePost(
          "/api/playground/compare",
          {
            roles: [compareTierA, compareTierB],
            prompt: trimmedPrompt,
            systemPrompt: systemPrompt.trim() || undefined,
            ...adv,
          },
          ac.signal,
          (ev) => {
            if (ev.slot !== 0 && ev.slot !== 1) return;
            const slotIdx = ev.slot;
            setCompareOutputs((prev) => {
              const next: [StreamOutputState, StreamOutputState] = [prev[0], prev[1]];
              next[slotIdx] = applyStreamEvent(prev[slotIdx], ev);
              return next;
            });
          },
        );
        setCompareOutputs(([a, b]) => [
          a.status === "streaming" ? { ...a, status: "done" } : a,
          b.status === "streaming" ? { ...b, status: "done" } : b,
        ]);
      } catch (err) {
        if (ac.signal.aborted) {
          setCompareOutputs(([a, b]) => [
            a.status === "streaming" ? { ...a, status: "aborted" } : a,
            b.status === "streaming" ? { ...b, status: "aborted" } : b,
          ]);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setCompareOutputs(([a, b]) => [
            a.status === "streaming" ? { ...a, status: "error", error: msg } : a,
            b.status === "streaming" ? { ...b, status: "error", error: msg } : b,
          ]);
        }
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
      return;
    }

    // Skill mode
    if (!selectedSkill) return;
    setSkillOutput({
      status: "streaming",
      content: "",
      error: null,
      provider: "skill",
      model: selectedSkill,
      startedAt: now,
      chunkCount: 0,
    });

    try {
      const res = await apiJson<{ output: unknown; preview?: string; durationMs?: number }>("/api/playground/skill", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          skillName: selectedSkill,
          prompt: trimmedPrompt,
        }),
        signal: ac.signal,
      });

      if (!res.ok) {
        throw new Error(res.data.error || `Skill execution failed (${res.status})`);
      }

      const rawOutput = res.data.output;
      const formatted =
        typeof rawOutput === "string"
          ? rawOutput
          : rawOutput !== undefined && rawOutput !== null
            ? JSON.stringify(rawOutput, null, 2)
            : (res.data.preview ?? "");

      setSkillOutput({
        status: "done",
        content: formatted,
        error: null,
        provider: "skill",
        model: selectedSkill,
        durationMs: res.data.durationMs ?? Date.now() - now,
        chunkCount: 1,
      });
    } catch (err) {
      if (ac.signal.aborted) {
        setSkillOutput((prev) => ({ ...prev, status: "aborted" }));
      } else {
        setSkillOutput((prev) => ({
          ...prev,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [
    prompt,
    isRunning,
    parseAdvanced,
    mode,
    roles,
    selectedTier,
    systemPrompt,
    compareTierA,
    compareTierB,
    selectedSkill,
  ]);

  const promoteToWorkflow = useCallback(
    (overrideTier?: string) => {
      const store = useWorkflowStore.getState();
      if (!store.graph) {
        const fresh: RawGraph = {
          id: `playground-${Date.now().toString(36).slice(-4)}`,
          name: "Playground Workflow",
          description: "Created from Model Playground",
          version: 1,
          entryNode: "",
          maxSteps: 15,
          nodes: [],
          edges: [],
        };
        store.setGraph(fresh, true);
      }

      const trimmedPrompt = prompt.trim();
      const trimmedSystem = systemPrompt.trim();
      const combinedPrompt = trimmedSystem
        ? `${trimmedSystem}\n\n${trimmedPrompt || "{{topic}}"}`
        : trimmedPrompt || "Analyze {{topic}}";

      if (mode === "skill") {
        const created = useWorkflowStore.getState().addNode("skill");
        if (created) {
          useWorkflowStore.getState().updateNode(created.id, {
            label: selectedSkill ? `Skill: ${selectedSkill}` : "Playground Skill",
            skillName: selectedSkill,
            promptTemplate: trimmedPrompt || "Run skill for {{topic}}",
          });
        }
        router.push("/");
        return;
      }

      const tier = overrideTier ?? (mode === "compare" ? compareTierA : selectedTier);
      const safeTier: ModelTier = WORKFLOW_MODEL_TIERS.has(tier) ? (tier as ModelTier) : "main";
      const kind = promoteKind;
      const created = useWorkflowStore.getState().addNode(kind);
      if (created) {
        const adv = parseAdvanced();
        const patch: Record<string, unknown> = {
          label: `${kind === "subagent" ? "Subagent" : "Agent"} (${tier})`,
          tier: safeTier,
          promptTemplate: combinedPrompt,
        };
        if (kind === "subagent") {
          patch.role = `Playground ${tier}`;
        }
        if (adv.temperature !== undefined) patch.temperature = adv.temperature;
        if (adv.maxTokens !== undefined) patch.maxTokens = adv.maxTokens;
        useWorkflowStore.getState().updateNode(created.id, patch);
      }
      router.push("/");
    },
    [mode, prompt, systemPrompt, selectedSkill, compareTierA, selectedTier, promoteKind, parseAdvanced, router],
  );

  const selectedSkillInfo = useMemo(
    () => skills.find((s) => s.name === selectedSkill) ?? null,
    [skills, selectedSkill],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-canvas text-text-primary">
      {/* Top Workbench Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h1 className="text-[15px] font-semibold tracking-tight text-text-primary">Model Playground</h1>
          <Tabs value={mode} onValueChange={(v) => setMode(v as PlaygroundMode)}>
            <TabsList>
              <TabsTrigger value="chat" className="gap-1.5">
                <Sparkles className="h-3 w-3" />
                Chat
              </TabsTrigger>
              <TabsTrigger value="compare" className="gap-1.5">
                <Columns2 className="h-3 w-3" />
                Compare Tiers
              </TabsTrigger>
              <TabsTrigger value="skill" className="gap-1.5">
                <Wrench className="h-3 w-3" />
                Run Skill
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex items-center gap-2">
          {mode !== "skill" ? (
            <div className="inline-flex h-7 items-center rounded-md border border-border-subtle bg-canvas p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setPromoteKind("agent")}
                className={cn(
                  "rounded px-2 py-0.5 font-medium transition-colors cursor-pointer",
                  promoteKind === "agent"
                    ? "bg-elevated text-text-primary"
                    : "text-text-muted hover:text-text-secondary",
                )}
              >
                agent
              </button>
              <button
                type="button"
                onClick={() => setPromoteKind("subagent")}
                className={cn(
                  "rounded px-2 py-0.5 font-medium transition-colors cursor-pointer",
                  promoteKind === "subagent"
                    ? "bg-elevated text-text-primary"
                    : "text-text-muted hover:text-text-secondary",
                )}
              >
                subagent
              </button>
            </div>
          ) : null}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => promoteToWorkflow()}
            disabled={mode === "skill" && !selectedSkill}
            title="Add this configuration as a node in the active workflow and open the canvas"
          >
            <GitBranchPlus className="h-3.5 w-3.5 text-accent" />
            Promote to Workflow
          </Button>
        </div>
      </header>

      {/* Main Split Workspace */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left Control Rail */}
        <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-b border-border-subtle bg-surface p-4 lg:w-[360px] lg:border-b-0 lg:border-r">
          {metaError ? (
            <div className="rounded-md border border-warning/35 bg-warning/10 px-2.5 py-2 text-[11px] text-amber-300">
              {metaError}
            </div>
          ) : null}

          {/* Mode-specific Target Selector */}
          {mode === "chat" ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                  Model Tier
                </label>
                <Badge variant="neutral" className="font-mono">
                  {selectedTier}
                </Badge>
              </div>
              {loadingMeta ? (
                <div className="grid grid-cols-2 gap-1.5">
                  {PLAYGROUND_TIERS.map((t) => (
                    <Skeleton key={t} className="h-12 w-full" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {tierList.map((tier) => {
                    const info = roles[tier];
                    const active = selectedTier === tier;
                    return (
                      <button
                        key={tier}
                        type="button"
                        onClick={() => setSelectedTier(tier)}
                        className={cn(
                          "flex flex-col items-start rounded-md border px-2.5 py-2 text-left transition-colors duration-150 cursor-pointer",
                          active
                            ? "border-accent bg-accent/10 text-text-primary"
                            : "border-border-subtle bg-canvas text-text-secondary hover:border-border-strong hover:text-text-primary",
                        )}
                      >
                        <span className="font-mono text-[11.5px] font-semibold">{tier}</span>
                        <span className="mt-0.5 w-full truncate font-mono text-[10px] text-text-muted">
                          {info ? `${info.provider} · ${info.model}` : "Unconfigured"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : mode === "compare" ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label
                  htmlFor="compare-tier-a"
                  className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary"
                >
                  Slot A
                </label>
                <select
                  id="compare-tier-a"
                  value={compareTierA}
                  onChange={(e) => setCompareTierA(e.target.value)}
                  className="h-8 w-full rounded-md border border-border-subtle bg-canvas px-2 font-mono text-[12px] text-text-primary focus-visible:border-accent focus-visible:outline-none"
                >
                  {tierList.map((tier) => (
                    <option key={tier} value={tier}>
                      {tier}
                    </option>
                  ))}
                </select>
                <p className="truncate font-mono text-[10px] text-text-muted">
                  {roles[compareTierA]?.model ?? "Default"}
                </p>
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="compare-tier-b"
                  className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary"
                >
                  Slot B
                </label>
                <select
                  id="compare-tier-b"
                  value={compareTierB}
                  onChange={(e) => setCompareTierB(e.target.value)}
                  className="h-8 w-full rounded-md border border-border-subtle bg-canvas px-2 font-mono text-[12px] text-text-primary focus-visible:border-accent focus-visible:outline-none"
                >
                  {tierList.map((tier) => (
                    <option key={tier} value={tier}>
                      {tier}
                    </option>
                  ))}
                </select>
                <p className="truncate font-mono text-[10px] text-text-muted">
                  {roles[compareTierB]?.model ?? "Default"}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label
                htmlFor="skill-select"
                className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary"
              >
                Skill
              </label>
              {loadingMeta ? (
                <Skeleton className="h-8 w-full" />
              ) : skills.length === 0 ? (
                <div className="rounded-md border border-border-subtle bg-canvas px-3 py-2 text-[11px] text-text-muted">
                  No skills found in workspace. Add a skill folder with SKILL.md to run it here.
                </div>
              ) : (
                <>
                  <select
                    id="skill-select"
                    value={selectedSkill}
                    onChange={(e) => setSelectedSkill(e.target.value)}
                    className="h-8 w-full rounded-md border border-border-subtle bg-canvas px-2 font-mono text-[12px] text-text-primary focus-visible:border-accent focus-visible:outline-none"
                  >
                    {skills.map((s, idx) => (
                      <option key={s.path || `${s.name}-${idx}`} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {selectedSkillInfo?.description ? (
                    <p className="text-[11px] leading-relaxed text-text-muted">{selectedSkillInfo.description}</p>
                  ) : null}
                </>
              )}
            </div>
          )}

          {/* Prompt Editor */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="playground-prompt"
                className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary"
              >
                Prompt
              </label>
              <span className="font-mono text-[10px] text-text-muted">Ctrl+Enter to run</span>
            </div>
            <Textarea
              id="playground-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void handleRun();
                }
              }}
              placeholder={
                mode === "skill"
                  ? "Enter instructions or input for the selected skill..."
                  : "Enter your prompt to test against the selected model tier..."
              }
              className="min-h-[130px] font-mono text-[12px]"
            />
          </div>

          {/* Optional System Prompt (Chat & Compare) */}
          {mode !== "skill" ? (
            <div className="space-y-1.5">
              <label
                htmlFor="playground-system-prompt"
                className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary"
              >
                System Prompt <span className="font-normal lowercase text-text-muted">(optional)</span>
              </label>
              <Textarea
                id="playground-system-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Optional system instructions..."
                className="min-h-[68px] font-mono text-[12px]"
              />
            </div>
          ) : null}

          {/* Collapsed Advanced Accordion (Chat & Compare) */}
          {mode !== "skill" ? (
            <Accordion type="single" collapsible>
              <AccordionItem value="advanced">
                <AccordionTrigger>Advanced</AccordionTrigger>
                <AccordionContent>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label htmlFor="playground-temp" className="text-[11px] text-text-secondary">
                        Temperature (0–2)
                      </label>
                      <Input
                        id="playground-temp"
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        placeholder="Default"
                        value={temperature}
                        onChange={(e) => setTemperature(e.target.value)}
                        className="font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="playground-max-tokens" className="text-[11px] text-text-secondary">
                        Max Tokens
                      </label>
                      <Input
                        id="playground-max-tokens"
                        type="number"
                        min={1}
                        max={32768}
                        step={64}
                        placeholder="Default"
                        value={maxTokens}
                        onChange={(e) => setMaxTokens(e.target.value)}
                        className="font-mono"
                      />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          ) : null}

          {/* Action Buttons */}
          <div className="mt-auto flex items-center gap-2 pt-2">
            <Button
              type="button"
              variant="primary"
              size="md"
              className="flex-1"
              onClick={() => void handleRun()}
              disabled={isRunning || !prompt.trim() || (mode === "skill" && !selectedSkill)}
            >
              <Play className="h-3.5 w-3.5" />
              {mode === "compare" ? "Compare" : mode === "skill" ? "Run Skill" : "Run"}
            </Button>

            {isRunning ? (
              <Button type="button" variant="danger" size="md" onClick={handleStop}>
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="md" onClick={handleClear} title="Clear output">
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </aside>

        {/* Right Output Stage */}
        <main className="flex min-h-0 flex-1 flex-col p-4">
          {mode === "chat" ? (
            <StreamOutputPanel
              title={selectedTier}
              subtitle={roles[selectedTier]?.description}
              state={chatOutput}
              emptyHint="Select a model tier, enter a prompt, and press Run (or Ctrl+Enter) to stream tokens."
            />
          ) : mode === "compare" ? (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-2">
              <StreamOutputPanel
                title={`Slot A · ${compareTierA}`}
                state={compareOutputs[0]}
                emptyHint={`Press Compare to stream ${compareTierA} side by side with ${compareTierB}.`}
                onPromote={() => promoteToWorkflow(compareTierA)}
                promoteLabel={`Promote ${compareTierA}`}
              />
              <StreamOutputPanel
                title={`Slot B · ${compareTierB}`}
                state={compareOutputs[1]}
                emptyHint={`Press Compare to stream ${compareTierB} side by side with ${compareTierA}.`}
                onPromote={() => promoteToWorkflow(compareTierB)}
                promoteLabel={`Promote ${compareTierB}`}
              />
            </div>
          ) : (
            <StreamOutputPanel
              title={selectedSkill ? `Skill · ${selectedSkill}` : "Skill Runner"}
              subtitle={selectedSkillInfo?.description}
              state={skillOutput}
              emptyHint="Pick a skill from the left panel, enter a prompt, and press Run Skill to execute it."
            />
          )}
        </main>
      </div>
    </div>
  );
}
