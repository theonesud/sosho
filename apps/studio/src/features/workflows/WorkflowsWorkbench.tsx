"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiJson, authHeaders } from "@/api";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  type RawGraph,
  type RunDetail,
  type RunSummary,
  type SystemStatusResponse,
  WORKFLOW_TEMPLATES,
  type WorkflowSummary,
} from "@/types";
import { CheckpointBar } from "./CheckpointBar";
import { WaterfallStage } from "./WaterfallStage";
import { WorkflowSidebar } from "./WorkflowSidebar";

interface WorkflowsWorkbenchProps {
  runId?: string;
}

export function WorkflowsWorkbench({ runId }: WorkflowsWorkbenchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const graph = useWorkflowStore((s) => s.graph);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const saveStatus = useWorkflowStore((s) => s.saveStatus);
  const setGraph = useWorkflowStore((s) => s.setGraph);
  const markSaved = useWorkflowStore((s) => s.markSaved);
  const setSaveStatus = useWorkflowStore((s) => s.setSaveStatus);
  const forkSnapshot = useWorkflowStore((s) => s.forkSnapshot);

  const [isSaving, setIsSaving] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);

  const { data: workflows = [], isLoading: workflowsLoading } = useQuery({
    queryKey: ["workflows"],
    queryFn: async () => {
      const res = await apiJson<{ workflows: WorkflowSummary[] }>("/api/workflows");
      return res.ok ? res.data.workflows : [];
    },
  });

  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ["runs"],
    queryFn: async () => {
      const res = await apiJson<{ runs: RunSummary[] }>("/api/runs?limit=50");
      return res.ok ? res.data.runs : [];
    },
    refetchInterval: 5_000,
  });

  const { data: systemData } = useQuery({
    queryKey: ["system-status"],
    queryFn: async () => {
      const res = await apiJson<SystemStatusResponse>("/api/system/status");
      return res.ok ? res.data : null;
    },
  });

  const { data: runDetail = null, refetch: refetchRun } = useQuery({
    queryKey: ["run", runId],
    queryFn: async () => {
      if (!runId) return null;
      const res = await apiJson<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`);
      return res.ok ? res.data : null;
    },
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "waiting_checkpoint" ? 2_000 : false;
    },
  });

  const loadWorkflowById = useCallback(
    async (id: string) => {
      const res = await apiJson<RawGraph>(`/api/workflows/${encodeURIComponent(id)}`);
      if (res.ok && res.data.id) {
        setGraph(res.data, false);
        setSaveStatus(null);
      }
    },
    [setGraph, setSaveStatus],
  );

  // Sync URL ?workflow= param or load first workflow on mount
  const urlWorkflowId = searchParams.get("workflow");
  useEffect(() => {
    if (runId) return;
    if (urlWorkflowId && graph?.id !== urlWorkflowId) {
      void loadWorkflowById(urlWorkflowId);
      return;
    }
    if (!graph && workflows.length > 0) {
      void loadWorkflowById(workflows[0].id);
    }
  }, [runId, urlWorkflowId, graph, workflows, loadWorkflowById]);

  const handleSaveWorkflow = useCallback(async () => {
    const current = useWorkflowStore.getState().graph;
    if (!current || isSaving) return;
    setIsSaving(true);
    setSaveStatus("Saving...");
    const res = await apiJson<{ ok: boolean; id: string }>("/api/workflows", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(current),
    });
    setIsSaving(false);
    if (res.ok) {
      markSaved("Saved");
      await queryClient.invalidateQueries({ queryKey: ["workflows"] });
    } else {
      setSaveStatus(res.data.error || "Save failed");
    }
  }, [isSaving, markSaved, queryClient, setSaveStatus]);

  // Cmd+S / Ctrl+S shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!runId) {
          void handleSaveWorkflow();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runId, handleSaveWorkflow]);

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
    if (runId) router.push("/");
  };

  const handleLoadTemplate = (templateKey: string) => {
    const tpl = WORKFLOW_TEMPLATES[templateKey];
    if (!tpl) return;
    setGraph(
      {
        ...structuredClone(tpl),
        id: `${tpl.id}-${Date.now().toString(36).slice(-3)}`,
      },
      true,
    );
    if (runId) router.push("/");
  };

  const handleDeleteWorkflow = async () => {
    if (!graph) return;
    const res = await apiJson<{ ok: boolean }>(`/api/workflows/${encodeURIComponent(graph.id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.ok) {
      setGraph(null, false);
      await queryClient.invalidateQueries({ queryKey: ["workflows"] });
    } else {
      setSaveStatus(res.data.error || "Delete failed");
    }
  };

  const handleStartRun = async (initialData: Record<string, unknown>) => {
    const targetGraph = runId && runDetail?.graph ? runDetail.graph : graph;
    if (!targetGraph || isStartingRun) return;
    setIsStartingRun(true);
    const res = await apiJson<{ runId: string; status: string }>("/api/runs", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ graph: targetGraph, initialData }),
    });
    setIsStartingRun(false);
    if (res.ok && res.data.runId) {
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
      router.push(`/runs/${encodeURIComponent(res.data.runId)}`);
    } else {
      setSaveStatus(res.data.error || "Failed to start run");
    }
  };

  const handleCancelRun = async (id: string) => {
    await apiJson<{ ok: boolean }>(`/api/runs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: authHeaders(),
    });
    await queryClient.invalidateQueries({ queryKey: ["runs"] });
    if (id === runId) void refetchRun();
  };

  const displayedGraph = runId ? (runDetail?.graph ?? graph) : graph;
  const isReadOnly = Boolean(runId);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <WorkflowSidebar
        workflows={workflows}
        workflowsLoading={workflowsLoading}
        runs={runs}
        runsLoading={runsLoading}
        activeGraph={displayedGraph}
        activeRunId={runId}
        isDirty={isDirty}
        saveStatus={saveStatus}
        isSaving={isSaving}
        isStartingRun={isStartingRun}
        onSelectWorkflow={(id) => {
          void loadWorkflowById(id);
          if (runId) router.push(`/?workflow=${encodeURIComponent(id)}`);
        }}
        onLoadTemplate={handleLoadTemplate}
        onNewWorkflow={handleNewWorkflow}
        onSaveWorkflow={handleSaveWorkflow}
        onDeleteWorkflow={handleDeleteWorkflow}
        onStartRun={handleStartRun}
        onCancelRun={handleCancelRun}
      />

      {/* Center Canvas Stage */}
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {runDetail?.status === "waiting_checkpoint" && runDetail.pausedCheckpoint ? (
          <CheckpointBar
            runId={runDetail.runId}
            checkpoint={runDetail.pausedCheckpoint}
            onResolved={() => {
              void refetchRun();
              void queryClient.invalidateQueries({ queryKey: ["runs"] });
            }}
          />
        ) : null}

        <WaterfallStage
          graph={displayedGraph}
          runDetail={runDetail}
          readOnly={isReadOnly}
          availableSkills={systemData?.skills ?? []}
          onEditGraph={
            runDetail?.graph
              ? () => {
                  setGraph(runDetail.graph ?? null, false);
                  router.push(`/?workflow=${encodeURIComponent(runDetail.graphId)}`);
                }
              : undefined
          }
          onForkSnapshot={
            runDetail?.graph
              ? () => {
                  forkSnapshot(runDetail.graph as RawGraph);
                  router.push("/");
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
