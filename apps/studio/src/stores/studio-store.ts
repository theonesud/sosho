"use client";

import { create } from "zustand";
import type { GpuState, MusicJob, QueueStats, RunSummary } from "@/types";

export interface WorkflowEventPayload {
  type: string;
  runId?: string;
  graphId?: string;
  nodeId?: string;
  status?: string;
  ts?: number;
  [key: string]: unknown;
}

interface StudioState {
  sseConnected: boolean;
  queueStats: QueueStats;
  gpuState: GpuState;
  musicJobs: Record<string, MusicJob>;
  pausedRuns: RunSummary[];
  lastWorkflowEvent: WorkflowEventPayload | null;
  commandPaletteOpen: boolean;

  setSseConnected: (connected: boolean) => void;
  setQueueStats: (stats: Partial<QueueStats>) => void;
  setGpuState: (gpu: Partial<GpuState>) => void;
  upsertMusicJob: (job: MusicJob) => void;
  setPausedRuns: (runs: RunSummary[]) => void;
  recordWorkflowEvent: (ev: WorkflowEventPayload) => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

const DEFAULT_QUEUE_STATS: QueueStats = {
  "cloud-io": { active: 0, queued: 0 },
  "local-gpu": { active: 0, queued: 0 },
  "host-browser": { active: 0, queued: 0 },
};

export const useStudioStore = create<StudioState>((set) => ({
  sseConnected: false,
  queueStats: DEFAULT_QUEUE_STATS,
  gpuState: { available: false, owner: "idle", gpus: [] },
  musicJobs: {},
  pausedRuns: [],
  lastWorkflowEvent: null,
  commandPaletteOpen: false,

  setSseConnected: (connected) => set({ sseConnected: connected }),
  setQueueStats: (stats) =>
    set((state) => ({
      queueStats: {
        "cloud-io": stats["cloud-io"] ?? state.queueStats["cloud-io"],
        "local-gpu": stats["local-gpu"] ?? state.queueStats["local-gpu"],
        "host-browser": stats["host-browser"] ?? state.queueStats["host-browser"],
      },
    })),
  setGpuState: (gpu) =>
    set((state) => ({
      gpuState: {
        ...state.gpuState,
        ...gpu,
      },
    })),
  upsertMusicJob: (job) =>
    set((state) => ({
      musicJobs: {
        ...state.musicJobs,
        [job.id]: job,
      },
    })),
  setPausedRuns: (runs) => set({ pausedRuns: runs }),
  recordWorkflowEvent: (ev) => set({ lastWorkflowEvent: { ...ev, ts: ev.ts ?? Date.now() } }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
}));
