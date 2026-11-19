"use client";

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Cpu,
  FlaskConical,
  GitBranch,
  KeyRound,
  Music,
  Search,
  Server,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiJson, getStoredToken, setStoredToken } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CommandPalette } from "@/features/command-palette/CommandPalette";
import { cn } from "@/lib/utils";
import { useStudioStore } from "@/stores/studio-store";
import type { MusicJob, QueueStats, RunSummary, SystemStatusResponse } from "@/types";

const NAV_ITEMS = [
  { href: "/", label: "Workflows & Runs", icon: GitBranch, match: (p: string) => p === "/" || p.startsWith("/runs") },
  {
    href: "/playground",
    label: "Model Playground",
    icon: FlaskConical,
    match: (p: string) => p.startsWith("/playground"),
  },
  { href: "/memory", label: "Memory Workbench", icon: Brain, match: (p: string) => p.startsWith("/memory") },
  { href: "/music", label: "Audio & YuE2", icon: Music, match: (p: string) => p.startsWith("/music") },
  { href: "/system", label: "System & Services", icon: Cpu, match: (p: string) => p.startsWith("/system") },
];

function GlobalSseBridge() {
  const queryClient = useQueryClient();
  const setSseConnected = useStudioStore((s) => s.setSseConnected);
  const setQueueStats = useStudioStore((s) => s.setQueueStats);
  const setGpuState = useStudioStore((s) => s.setGpuState);
  const upsertMusicJob = useStudioStore((s) => s.upsertMusicJob);
  const recordWorkflowEvent = useStudioStore((s) => s.recordWorkflowEvent);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/events");
      es.onopen = () => setSseConnected(true);
      es.onerror = () => setSseConnected(false);
      es.onmessage = (msg) => {
        try {
          const payload = JSON.parse(msg.data) as Record<string, unknown>;
          const type = String(payload.type || "");
          if (type === "connected") {
            setSseConnected(true);
            return;
          }
          if (type === "queue_stats") {
            setQueueStats(payload as Partial<QueueStats>);
            return;
          }
          if (type === "gpu_state") {
            setGpuState({
              available: Boolean(payload.available),
              owner: typeof payload.owner === "string" ? payload.owner : undefined,
              gpus: Array.isArray(payload.gpus) ? payload.gpus : undefined,
            });
            return;
          }
          if (type === "music_job" && typeof payload.id === "string") {
            upsertMusicJob(payload as unknown as MusicJob);
            return;
          }
          recordWorkflowEvent(payload as { type: string; runId?: string });
          void queryClient.invalidateQueries({ queryKey: ["runs"] });
          if (typeof payload.runId === "string") {
            void queryClient.invalidateQueries({ queryKey: ["run", payload.runId] });
          }
        } catch {
          // ignore malformed SSE payload
        }
      };
    };

    connect();
    return () => {
      closed = true;
      setSseConnected(false);
      es?.close();
    };
  }, [queryClient, setSseConnected, setQueueStats, setGpuState, upsertMusicJob, recordWorkflowEvent]);

  return null;
}

function TopStatusBar() {
  const router = useRouter();
  const sseConnected = useStudioStore((s) => s.sseConnected);
  const queueStats = useStudioStore((s) => s.queueStats);
  const gpuState = useStudioStore((s) => s.gpuState);
  const setCommandPaletteOpen = useStudioStore((s) => s.setCommandPaletteOpen);

  const [tokenInput, setTokenInput] = useState("");
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    const existing = getStoredToken();
    setTokenInput(existing);
    setHasToken(Boolean(existing));
  }, []);

  const { data: systemData } = useQuery({
    queryKey: ["system-status"],
    queryFn: async () => {
      const res = await apiJson<SystemStatusResponse>("/api/system/status");
      return res.ok ? res.data : null;
    },
    refetchInterval: 15_000,
  });

  const { data: runsData } = useQuery({
    queryKey: ["runs"],
    queryFn: async () => {
      const res = await apiJson<{ runs: RunSummary[] }>("/api/runs?limit=25");
      return res.ok ? res.data.runs : [];
    },
    refetchInterval: 10_000,
  });

  const pausedRun = useMemo(() => (runsData ?? []).find((r) => r.status === "waiting_checkpoint") ?? null, [runsData]);

  const services = systemData?.services ?? [];
  const healthyCount = services.filter((s) => s.ok).length;

  const gpuLabel = gpuState.owner
    ? gpuState.owner
    : gpuState.available && gpuState.gpus[0]
      ? `${gpuState.gpus[0].utilizationPct}%`
      : "idle";

  const saveToken = () => {
    setStoredToken(tokenInput);
    setHasToken(Boolean(tokenInput.trim()));
  };

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border-subtle bg-surface px-3">
      {/* Left: Brand + GPU owner */}
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2 text-text-primary hover:opacity-90">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 border border-accent/35 font-mono text-[11px] font-bold text-accent">
            S
          </span>
          <span className="text-[13px] font-semibold tracking-tight">Sosho Studio</span>
        </Link>

        <span
          className={cn("h-1.5 w-1.5 rounded-full", sseConnected ? "bg-accent" : "bg-text-muted")}
          title={sseConnected ? "Live SSE connected" : "SSE reconnecting"}
        />

        <div className="hidden items-center gap-1.5 sm:flex">
          <Badge variant="neutral" className="font-mono">
            <Cpu className="h-3 w-3 text-text-muted" />
            <span>GPU: {gpuLabel}</span>
          </Badge>

          <Badge variant="neutral" className="font-mono">
            <span>cloud-io</span>
            <span className="text-text-primary">
              {queueStats["cloud-io"].active}/{queueStats["cloud-io"].queued}
            </span>
          </Badge>
          <Badge variant="neutral" className="font-mono">
            <span>local-gpu</span>
            <span className="text-text-primary">
              {queueStats["local-gpu"].active}/{queueStats["local-gpu"].queued}
            </span>
          </Badge>
          <Badge variant="neutral" className="font-mono">
            <span>host-browser</span>
            <span className="text-text-primary">
              {queueStats["host-browser"].active}/{queueStats["host-browser"].queued}
            </span>
          </Badge>
        </div>
      </div>

      {/* Right: HITL alert, Service Health, Auth, Ctrl+K */}
      <div className="flex items-center gap-2">
        {pausedRun ? (
          <Button
            variant="warning"
            size="xs"
            onClick={() => router.push(`/runs/${encodeURIComponent(pausedRun.runId)}`)}
            className="gap-1.5"
          >
            <AlertTriangle className="h-3 w-3" />
            <span>Checkpoint waiting · {pausedRun.graphId}</span>
          </Button>
        ) : null}

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs" className="gap-1.5 font-mono">
              <Server className="h-3.5 w-3.5 text-text-secondary" />
              <span>
                {healthyCount}/{services.length || 5}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-semibold">Local Services</span>
              <Link href="/system" className="text-[11px] text-accent hover:underline">
                System view
              </Link>
            </div>
            <div className="space-y-1.5">
              {services.length === 0 ? (
                <div className="text-[12px] text-text-muted">Checking service endpoints...</div>
              ) : (
                services.map((svc) => (
                  <div
                    key={svc.id}
                    className="flex items-center justify-between rounded-md border border-border-subtle bg-canvas px-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {svc.ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                      )}
                      <span className="truncate text-[12px] text-text-primary">{svc.name}</span>
                    </div>
                    <span className="font-mono text-[11px] text-text-muted tabular-nums">
                      {svc.ok ? `${svc.latencyMs}ms` : "offline"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs" className="gap-1.5">
              <KeyRound className={cn("h-3.5 w-3.5", hasToken ? "text-accent" : "text-text-muted")} />
              <span className="hidden md:inline">{hasToken ? "Auth" : "Token"}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72">
            <div className="space-y-2">
              <div className="text-[12px] font-semibold">Studio API Token</div>
              <p className="text-[11px] text-text-secondary">
                Stored in localStorage as <code className="font-mono text-text-primary">sosho_studio_token</code> for
                write routes.
              </p>
              <Input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Paste bearer token..."
                className="font-mono"
              />
              <div className="flex justify-end gap-1.5">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setTokenInput("");
                    setStoredToken("");
                    setHasToken(false);
                  }}
                >
                  Clear
                </Button>
                <Button variant="primary" size="xs" onClick={saveToken}>
                  Save
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Button
          variant="secondary"
          size="xs"
          onClick={() => setCommandPaletteOpen(true)}
          className="gap-2 text-text-secondary"
        >
          <Search className="h-3 w-3" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="rounded border border-border-subtle bg-canvas px-1 font-mono text-[10px] text-text-muted">
            Ctrl+K
          </kbd>
        </Button>
      </div>
    </header>
  );
}

function LeftActivityRail() {
  const pathname = usePathname() || "/";

  return (
    <aside className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-border-subtle bg-surface py-2">
      {NAV_ITEMS.map((item) => {
        const active = item.match(pathname);
        const Icon = item.icon;
        return (
          <Tooltip key={item.href} delayDuration={150}>
            <TooltipTrigger asChild>
              <Link
                href={item.href}
                aria-label={item.label}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-md border transition-colors duration-150",
                  active
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-transparent text-text-secondary hover:bg-elevated hover:text-text-primary",
                )}
              >
                <Icon className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </aside>
  );
}

export function WorkbenchShell({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <GlobalSseBridge />
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas text-text-primary">
          <TopStatusBar />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <LeftActivityRail />
            <main className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
          </div>
        </div>
        <CommandPalette />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
