"use client";

import { Cpu, FileMusic, Music, Play, RefreshCw, Square, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useStudioStore } from "@/stores/studio-store";
import type { GpuState, MusicJob } from "@/types";

interface ExtendedMusicJob extends MusicJob {
  rtf?: number;
  duration_seconds?: number;
  duration?: number;
  metrics?: {
    rtf?: number;
    duration_seconds?: number;
    duration?: number;
  };
}

const STYLE_PRESETS = [
  {
    name: "Synthwave Drive",
    style: "retrowave, analog synth bass, driving 118 bpm, neon nocturnal atmosphere, crisp snare",
    lyrics:
      "[verse]\nNeon lines on midnight glass\nEngines hum as shadows pass\n\n[chorus]\nDrive until the skyline fades\nLost inside electric shades",
  },
  {
    name: "Lo-Fi Study",
    style: "lo-fi hip hop, warm dusty rhodes, vinyl crackle, mellow boom bap, 82 bpm, instrumental",
    lyrics: "[instrumental]\nWarm chords and soft rain over a gentle beat",
  },
  {
    name: "Cinematic Strings",
    style: "orchestral soundtrack, sweeping cello and violin ensemble, emotional crescendo, 96 bpm",
    lyrics: "[instrumental]\nSlow build from solo cello into full string section",
  },
  {
    name: "Acoustic Folk",
    style: "indie folk, fingerpicked acoustic guitar, warm male vocal, intimate room reverb, 104 bpm",
    lyrics:
      "[verse]\nMorning fog along the ridge\nFootsteps on the wooden bridge\n\n[chorus]\nCarry light and travel slow\nEvery mile we learn to know",
  },
];

function statusVariant(status: string): "accent" | "info" | "warning" | "error" | "neutral" {
  const s = status.toLowerCase();
  if (s === "completed" || s === "done" || s === "succeeded") return "accent";
  if (s === "running" || s === "processing" || s === "stage1" || s === "stage2") return "info";
  if (s === "queued" || s === "pending" || s === "submitted") return "warning";
  if (s === "failed" || s === "error" || s === "cancelled") return "error";
  return "neutral";
}

function isActiveStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "queued" || s === "pending" || s === "running" || s === "processing" || s === "submitted";
}

function isCompletedStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "completed" || s === "done" || s === "succeeded";
}

export function MusicWorkspace() {
  const gpuState = useStudioStore((s) => s.gpuState);
  const setGpuState = useStudioStore((s) => s.setGpuState);
  const storeMusicJobs = useStudioStore((s) => s.musicJobs);
  const upsertMusicJob = useStudioStore((s) => s.upsertMusicJob);

  const [style, setStyle] = useState(STYLE_PRESETS[0].style);
  const [lyrics, setLyrics] = useState(STYLE_PRESETS[0].lyrics);
  const [cot, setCot] = useState<"full" | "melody" | "off">("full");
  const [seed, setSeed] = useState("");

  // Advanced Synthesis (YuE2 REQUEST_OPTIONS)
  const [numInferenceSteps, setNumInferenceSteps] = useState("50");
  const [guidanceScale, setGuidanceScale] = useState("3.5");
  const [stopAfter, setStopAfter] = useState("");
  const [abc, setAbc] = useState(true);
  const [exportSemantic, setExportSemantic] = useState(false);
  const [topP, setTopP] = useState("0.93");
  const [temperature, setTemperature] = useState("1.0");
  const [repetitionPenalty, setRepetitionPenalty] = useState("1.1");

  const [submitting, setSubmitting] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remoteJobs, setRemoteJobs] = useState<ExtendedMusicJob[]>([]);

  // ABC Score viewer state per job
  const [openScores, setOpenScores] = useState<Record<string, boolean>>({});
  const [scoreContent, setScoreContent] = useState<Record<string, string>>({});
  const [scoreLoading, setScoreLoading] = useState<Record<string, boolean>>({});

  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const res = await fetch("/api/music/jobs");
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { jobs?: ExtendedMusicJob[] } | ExtendedMusicJob[];
      const list = Array.isArray(data) ? data : Array.isArray(data.jobs) ? data.jobs : [];
      setRemoteJobs(list);
      for (const job of list) {
        if (job?.id) upsertMusicJob(job);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingJobs(false);
    }
  }, [upsertMusicJob]);

  const fetchGpu = useCallback(async () => {
    try {
      const res = await fetch("/api/system/gpu");
      if (!res.ok) return;
      const data = (await res.json()) as GpuState;
      setGpuState(data);
    } catch {
      // ignore fallback gpu fetch failure
    }
  }, [setGpuState]);

  useEffect(() => {
    void fetchJobs();
    void fetchGpu();
  }, [fetchJobs, fetchGpu]);

  const mergedJobs = useMemo(() => {
    const map = new Map<string, ExtendedMusicJob>();
    for (const j of remoteJobs) {
      if (j?.id) map.set(j.id, j);
    }
    for (const j of Object.values(storeMusicJobs)) {
      if (j?.id) {
        map.set(j.id, { ...map.get(j.id), ...j });
      }
    }
    return Array.from(map.values()).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  }, [remoteJobs, storeMusicJobs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!style.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        style: style.trim(),
        lyrics: lyrics.trim(),
        cot,
        abc,
        export_semantic: exportSemantic,
      };
      if (seed.trim() && Number.isFinite(Number(seed))) {
        payload.seed = Number(seed);
      }
      if (numInferenceSteps.trim() && Number.isFinite(Number(numInferenceSteps))) {
        payload.num_inference_steps = Number(numInferenceSteps);
      }
      if (guidanceScale.trim() && Number.isFinite(Number(guidanceScale))) {
        payload.guidance_scale = Number(guidanceScale);
      }
      if (stopAfter.trim()) {
        payload.stop_after = stopAfter.trim();
      }
      if (topP.trim() && Number.isFinite(Number(topP))) {
        payload.top_p = Number(topP);
      }
      if (temperature.trim() && Number.isFinite(Number(temperature))) {
        payload.temperature = Number(temperature);
      }
      if (repetitionPenalty.trim() && Number.isFinite(Number(repetitionPenalty))) {
        payload.repetition_penalty = Number(repetitionPenalty);
      }

      const res = await fetch("/api/music/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error || `Submit failed (HTTP ${res.status})`);
      }
      const created = (await res.json()) as ExtendedMusicJob;
      if (created?.id) {
        upsertMusicJob(created);
      }
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      const res = await fetch(`/api/music/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error(`Cancel failed (HTTP ${res.status})`);
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleScore = async (id: string) => {
    const nextOpen = !openScores[id];
    setOpenScores((prev) => ({ ...prev, [id]: nextOpen }));
    if (nextOpen && !scoreContent[id]) {
      setScoreLoading((prev) => ({ ...prev, [id]: true }));
      try {
        const res = await fetch(`/api/music/jobs/${encodeURIComponent(id)}/score`);
        if (!res.ok) throw new Error(`Score unavailable (HTTP ${res.status})`);
        const text = await res.text();
        setScoreContent((prev) => ({ ...prev, [id]: text || "Empty score." }));
      } catch (err) {
        setScoreContent((prev) => ({
          ...prev,
          [id]: err instanceof Error ? err.message : "Failed to load ABC score.",
        }));
      } finally {
        setScoreLoading((prev) => ({ ...prev, [id]: false }));
      }
    }
  };

  const primaryGpu = gpuState.gpus[0];
  const gpuOwner = gpuState.owner ?? "idle";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-canvas">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Music className="h-4 w-4 text-accent" />
          <h1 className="text-[14px] font-semibold text-text-primary">Audio Synthesis</h1>
          <Badge variant="neutral">YuE2</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void fetchJobs()}>
          <RefreshCw className={`h-3.5 w-3.5 ${loadingJobs ? "animate-spin" : ""}`} />
          Refresh Queue
        </Button>
      </div>

      {/* Two-Column Workspace */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[420px_1fr]">
        {/* Left Column: Synthesis Controls */}
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-col overflow-y-auto border-b border-border-subtle bg-surface p-4 space-y-4 lg:border-b-0 lg:border-r"
        >
          {/* Style Presets */}
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-muted">Style Presets</div>
            <div className="flex flex-wrap gap-1.5">
              {STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => {
                    setStyle(preset.style);
                    setLyrics(preset.lyrics);
                  }}
                  className="rounded border border-border-subtle bg-elevated px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary cursor-pointer"
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Style Prompt */}
          <div className="space-y-1.5">
            <label htmlFor="music-style" className="text-[12px] font-medium text-text-secondary">
              Style / Tags
            </label>
            <Textarea
              id="music-style"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              rows={3}
              placeholder="Genre, instruments, mood, tempo..."
              required
            />
          </div>

          {/* Lyrics */}
          <div className="space-y-1.5">
            <label htmlFor="music-lyrics" className="text-[12px] font-medium text-text-secondary">
              Lyrics / Structure
            </label>
            <Textarea
              id="music-lyrics"
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              rows={5}
              placeholder="[verse] ... [chorus] ..."
              className="font-mono text-[11px]"
            />
          </div>

          {/* CoT & Seed */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="music-cot" className="text-[12px] font-medium text-text-secondary">
                Chain of Thought (`cot`)
              </label>
              <select
                id="music-cot"
                value={cot}
                onChange={(e) => setCot(e.target.value as "full" | "melody" | "off")}
                className="flex h-8 w-full rounded-md border border-border-subtle bg-canvas px-2.5 text-[12px] text-text-primary focus-visible:border-accent focus-visible:outline-none"
              >
                <option value="full">full</option>
                <option value="melody">melody</option>
                <option value="off">off</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="music-seed" className="text-[12px] font-medium text-text-secondary">
                Seed (optional)
              </label>
              <Input
                id="music-seed"
                type="number"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="Random"
                className="font-mono"
              />
            </div>
          </div>

          {/* Advanced Synthesis Accordion (collapsed by default) */}
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="advanced-synthesis">
              <AccordionTrigger>Advanced Synthesis</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label htmlFor="opt-steps" className="text-[11px] text-text-muted font-mono">
                      num_inference_steps
                    </label>
                    <Input
                      id="opt-steps"
                      type="number"
                      value={numInferenceSteps}
                      onChange={(e) => setNumInferenceSteps(e.target.value)}
                      className="h-7 font-mono text-[11px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="opt-guidance" className="text-[11px] text-text-muted font-mono">
                      guidance_scale
                    </label>
                    <Input
                      id="opt-guidance"
                      type="number"
                      step="0.1"
                      value={guidanceScale}
                      onChange={(e) => setGuidanceScale(e.target.value)}
                      className="h-7 font-mono text-[11px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="opt-stop" className="text-[11px] text-text-muted font-mono">
                      stop_after
                    </label>
                    <select
                      id="opt-stop"
                      value={stopAfter}
                      onChange={(e) => setStopAfter(e.target.value)}
                      className="flex h-7 w-full rounded-md border border-border-subtle bg-canvas px-2 font-mono text-[11px] text-text-primary"
                    >
                      <option value="">full pipeline</option>
                      <option value="stage1">stage1</option>
                      <option value="stage2">stage2</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="opt-top-p" className="text-[11px] text-text-muted font-mono">
                      top_p
                    </label>
                    <Input
                      id="opt-top-p"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={topP}
                      onChange={(e) => setTopP(e.target.value)}
                      className="h-7 font-mono text-[11px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="opt-temp" className="text-[11px] text-text-muted font-mono">
                      temperature
                    </label>
                    <Input
                      id="opt-temp"
                      type="number"
                      step="0.05"
                      min="0"
                      value={temperature}
                      onChange={(e) => setTemperature(e.target.value)}
                      className="h-7 font-mono text-[11px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="opt-rep" className="text-[11px] text-text-muted font-mono">
                      repetition_penalty
                    </label>
                    <Input
                      id="opt-rep"
                      type="number"
                      step="0.05"
                      min="0.5"
                      value={repetitionPenalty}
                      onChange={(e) => setRepetitionPenalty(e.target.value)}
                      className="h-7 font-mono text-[11px]"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <label className="flex items-center gap-1.5 text-[11px] font-mono text-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={abc}
                      onChange={(e) => setAbc(e.target.checked)}
                      className="h-3.5 w-3.5 accent-emerald-500"
                    />
                    abc
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] font-mono text-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={exportSemantic}
                      onChange={(e) => setExportSemantic(e.target.checked)}
                      className="h-3.5 w-3.5 accent-emerald-500"
                    />
                    export_semantic
                  </label>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <Button type="submit" variant="primary" size="md" disabled={submitting || !style.trim()}>
            <Play className="h-3.5 w-3.5" />
            {submitting ? "Submitting Job..." : "Generate Track"}
          </Button>
        </form>

        {/* Right Column: VRAM Handshake Banner + Job Queue */}
        <div className="min-h-0 overflow-y-auto p-4 space-y-4">
          {/* VRAM Handshake Status Banner */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-elevated px-3.5 py-2.5">
            <div className="flex items-center gap-2.5">
              <Cpu className="h-4 w-4 text-info" />
              <div>
                <div className="flex items-center gap-2 text-[12px] font-medium text-text-primary">
                  <span>VRAM Handshake</span>
                  <Badge variant={gpuOwner === "yue2" ? "accent" : gpuOwner === "idle" ? "neutral" : "warning"}>
                    owner: {gpuOwner}
                  </Badge>
                </div>
                <p className="text-[11px] text-text-muted">
                  {primaryGpu
                    ? `${primaryGpu.name} · ${primaryGpu.memoryUsedMb} / ${primaryGpu.memoryTotalMb} MB (${primaryGpu.utilizationPct}% util, ${primaryGpu.temperatureC}°C)`
                    : "No local GPU telemetry reported."}
                </p>
              </div>
            </div>
            {gpuOwner === "llama-cpp" && <Badge variant="warning">LLM holds VRAM — YuE2 will wait for unload</Badge>}
          </div>

          {error && (
            <div className="rounded-md border border-error/35 bg-error/10 px-3 py-2 text-[12px] text-red-300">
              {error}
            </div>
          )}

          {/* Job Queue */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-[12px] font-semibold uppercase tracking-wider text-text-muted">
                Job Queue ({mergedJobs.length})
              </h2>
            </div>

            {loadingJobs && mergedJobs.length === 0 ? (
              <div className="space-y-2.5">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : mergedJobs.length === 0 ? (
              <div className="rounded-md border border-border-subtle bg-surface p-8 text-center">
                <p className="text-[13px] font-medium text-text-primary">No synthesis jobs yet</p>
                <p className="mt-1 text-[12px] text-text-muted">
                  Choose a preset or enter style tags on the left, then click Generate Track.
                </p>
              </div>
            ) : (
              mergedJobs.map((job) => {
                const rtf = job.rtf ?? job.metrics?.rtf;
                const duration =
                  job.duration_seconds ?? job.duration ?? job.metrics?.duration_seconds ?? job.metrics?.duration;
                const canPlay = isCompletedStatus(job.status) || Boolean(job.artifacts?.audio?.url);
                const canCancel = isActiveStatus(job.status);
                const scoreOpen = Boolean(openScores[job.id]);

                return (
                  <div key={job.id} className="rounded-md border border-border-subtle bg-elevated p-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[12px] font-semibold text-text-primary">{job.id}</span>
                          <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                          {job.stage && <Badge variant="neutral">{job.stage}</Badge>}
                          {typeof rtf === "number" && <Badge variant="info">rtf {rtf.toFixed(2)}x</Badge>}
                          {typeof duration === "number" && <Badge variant="neutral">{duration.toFixed(1)}s</Badge>}
                        </div>
                        {job.request?.style && (
                          <p className="line-clamp-2 text-[12px] text-text-secondary">{job.request.style}</p>
                        )}
                        {job.error && <p className="text-[11px] font-mono text-red-400">{job.error}</p>}
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {canPlay && (
                          <Button variant="secondary" size="xs" onClick={() => void toggleScore(job.id)}>
                            <FileMusic className="h-3 w-3" />
                            {scoreOpen ? "Hide ABC" : "ABC Score"}
                          </Button>
                        )}
                        {canCancel && (
                          <Button variant="danger" size="xs" onClick={() => void handleCancel(job.id)}>
                            <Square className="h-3 w-3" />
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Inline Range-streamed Audio Player */}
                    {canPlay && (
                      <div className="flex items-center gap-2 rounded border border-border-subtle bg-canvas px-2.5 py-2">
                        <Volume2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                        <audio
                          controls
                          preload="none"
                          src={`/api/music/jobs/${encodeURIComponent(job.id)}/audio`}
                          className="h-8 w-full"
                        >
                          <track kind="captions" />
                        </audio>
                      </div>
                    )}

                    {/* Toggleable ABC Score Viewer */}
                    {scoreOpen && (
                      <div className="rounded border border-border-subtle bg-canvas p-2.5">
                        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-text-muted">
                          ABC Notation Score
                        </div>
                        {scoreLoading[job.id] ? (
                          <Skeleton className="h-16 w-full" />
                        ) : (
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-text-secondary">
                            {scoreContent[job.id]}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
