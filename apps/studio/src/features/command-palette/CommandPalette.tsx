"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Command } from "cmdk";
import {
  Activity,
  Brain,
  Cpu,
  FlaskConical,
  GitBranch,
  Music,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiJson, authHeaders } from "@/api";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { normalizeSkills } from "@/lib/utils";
import { useStudioStore } from "@/stores/studio-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { RunSummary, SystemStatusResponse, WorkflowSummary } from "@/types";

export function CommandPalette() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const open = useStudioStore((s) => s.commandPaletteOpen);
  const setOpen = useStudioStore((s) => s.setCommandPaletteOpen);
  const setGraph = useWorkflowStore((s) => s.setGraph);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useStudioStore.getState().commandPaletteOpen);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  const { data: workflowsData } = useQuery({
    queryKey: ["workflows"],
    queryFn: async () => {
      const res = await apiJson<{ workflows: WorkflowSummary[] }>("/api/workflows");
      return res.ok ? res.data.workflows : [];
    },
    enabled: open,
  });

  const { data: runsData } = useQuery({
    queryKey: ["runs"],
    queryFn: async () => {
      const res = await apiJson<{ runs: RunSummary[] }>("/api/runs?limit=25");
      return res.ok ? res.data.runs : [];
    },
    enabled: open,
  });

  const { data: systemData } = useQuery({
    queryKey: ["system-status"],
    queryFn: async () => {
      const res = await apiJson<SystemStatusResponse>("/api/system/status");
      return res.ok ? res.data : null;
    },
    enabled: open,
  });

  const go = (path: string) => {
    setOpen(false);
    router.push(path);
  };

  const handleNewWorkflow = () => {
    const id = `wf-${Date.now().toString(36).slice(-4)}`;
    setGraph(
      {
        id,
        name: "Untitled Workflow",
        description: "",
        version: 1,
        entryNode: "agent_1",
        maxSteps: 12,
        nodes: [
          {
            id: "agent_1",
            type: "agent",
            label: "Primary Agent",
            tier: "main",
            position: { x: 160, y: 140 },
            promptTemplate: "Analyze {{topic}}",
            outputKey: "result",
          },
        ],
        edges: [],
      },
      true,
    );
    setOpen(false);
    router.push("/");
  };

  const handleConsolidateMemory = async () => {
    setActionMsg("Consolidating memory...");
    const res = await apiJson<{ ok: boolean }>("/api/memory/consolidate", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ scope: "both" }),
    });
    if (res.ok) {
      setActionMsg("Memory consolidated.");
      await queryClient.invalidateQueries({ queryKey: ["memory"] });
      setTimeout(() => {
        setActionMsg(null);
        setOpen(false);
      }, 600);
    } else {
      setActionMsg(res.data.error || "Consolidation failed.");
    }
  };

  const workflows = workflowsData ?? [];
  const runs = runsData ?? [];
  const skills = normalizeSkills(systemData?.skills);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0">
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <Command className="flex flex-col bg-elevated text-text-primary">
          <div className="flex items-center gap-2.5 border-b border-border-subtle px-3.5 py-0.5">
            <Search className="h-4 w-4 shrink-0 text-text-muted" />
            <Command.Input
              placeholder="Jump to workflow, run, skill, route, or action..."
              className="h-11 w-full bg-transparent text-[13px] text-text-primary placeholder:text-text-muted outline-none focus-visible:outline-none"
            />
            <kbd className="rounded border border-border-subtle bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
              ESC
            </kbd>
          </div>

          {actionMsg ? (
            <div className="border-b border-border-subtle bg-canvas/60 px-3 py-1.5 text-[11px] text-emerald-300">
              {actionMsg}
            </div>
          ) : null}

          <Command.List className="max-h-[360px] overflow-y-auto p-1.5">
            <Command.Empty className="py-8 text-center text-[12px] text-text-muted">
              No matching command or item.
            </Command.Empty>

            <Command.Group
              heading="Actions"
              className="px-1 py-1 text-[11px] font-medium text-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1"
            >
              <Command.Item
                onSelect={handleNewWorkflow}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-text-primary aria-selected:bg-zinc-800"
              >
                <Plus className="h-3.5 w-3.5 text-accent" />
                <span>New Workflow</span>
              </Command.Item>
              <Command.Item
                onSelect={handleConsolidateMemory}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-text-primary aria-selected:bg-zinc-800"
              >
                <RefreshCw className="h-3.5 w-3.5 text-info" />
                <span>Consolidate Memory Inbox</span>
              </Command.Item>
            </Command.Group>

            <Command.Group
              heading="Navigate"
              className="px-1 py-1 text-[11px] font-medium text-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1"
            >
              <Command.Item
                onSelect={() => go("/")}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-text-primary aria-selected:bg-zinc-800"
              >
                <GitBranch className="h-3.5 w-3.5 text-text-secondary" />
                <span>Workflows & Runs</span>
              </Command.Item>
              <Command.Item
                onSelect={() => go("/playground")}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-text-primary aria-selected:bg-zinc-800"
              >
                <FlaskConical className="h-3.5 w-3.5 text-text-secondary" />
                <span>Model Playground</span>
              </Command.Item>
              <Command.Item
                onSelect={() => go("/memory")}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-text-primary aria-selected:bg-zinc-800"
              >
                <Brain className="h-3.5 w-3.5 text-text-secondary" />
                <span>Memory Workbench</span>
              </Command.Item>
              <Command.Item
                onSelect={() => go("/music")}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-text-primary aria-selected:bg-zinc-800"
              >
                <Music className="h-3.5 w-3.5 text-text-secondary" />
                <span>Audio & YuE2</span>
              </Command.Item>
              <Command.Item
                onSelect={() => go("/system")}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-text-primary aria-selected:bg-zinc-800"
              >
                <Cpu className="h-3.5 w-3.5 text-text-secondary" />
                <span>System & Services</span>
              </Command.Item>
            </Command.Group>

            {workflows.length > 0 ? (
              <Command.Group
                heading="Workflows"
                className="px-1 py-1 text-[11px] font-medium text-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1"
              >
                {workflows.map((wf) => (
                  <Command.Item
                    key={wf.id}
                    value={`workflow ${wf.name} ${wf.id}`}
                    onSelect={() => go(`/?workflow=${encodeURIComponent(wf.id)}`)}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[12px] text-text-primary aria-selected:bg-zinc-800"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Play className="h-3 w-3 text-accent shrink-0" />
                      <span className="truncate">{wf.name}</span>
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">{wf.id}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

            {runs.length > 0 ? (
              <Command.Group
                heading="Recent Runs"
                className="px-1 py-1 text-[11px] font-medium text-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1"
              >
                {runs.slice(0, 8).map((r) => (
                  <Command.Item
                    key={r.runId}
                    value={`run ${r.graphId} ${r.runId} ${r.status}`}
                    onSelect={() => go(`/runs/${encodeURIComponent(r.runId)}`)}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[12px] text-text-primary aria-selected:bg-zinc-800"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Activity className="h-3 w-3 text-info shrink-0" />
                      <span className="truncate">{r.graphId}</span>
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">
                      {r.status} · {r.runId.slice(0, 8)}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

            {skills.length > 0 ? (
              <Command.Group
                heading="Skills"
                className="px-1 py-1 text-[11px] font-medium text-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1"
              >
                {skills.slice(0, 10).map((skill, idx) => (
                  <Command.Item
                    key={skill.path || `${skill.name}-${idx}`}
                    value={`skill ${skill.name}`}
                    onSelect={() => go(`/playground?skill=${encodeURIComponent(skill.name)}`)}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-text-primary aria-selected:bg-zinc-800"
                  >
                    <Sparkles className="h-3 w-3 text-sky-400 shrink-0" />
                    <span className="font-mono text-[12px]">{skill.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
