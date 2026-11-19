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
import { ObsidianGraphStage } from "./ObsidianGraphStage";
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

  const {
    data: runDetail = null,
    isLoading: runLoading,
    refetch: refetchRun,
  } = useQuery({
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

  // Resolve target workflow ID cleanly via URL param or first saved workflow
  const urlWorkflowId = searchParams.get("workflow");
  const isLocalUnsavedGraph = Boolean(graph && !workflows.some((w) => w.id === graph.id));
  const targetWorkflowId = !runId ? urlWorkflowId || (isLocalUnsavedGraph ? null : (workflows[0]?.id ?? null)) : null;

  const { data: fetchedWorkflow = null, isLoading: workflowLoading } = useQuery({
    queryKey: ["workflow", targetWorkflowId],
    queryFn: async () => {
      if (!targetWorkflowId) return null;
      const res = await apiJson<RawGraph>(`/api/workflows/${encodeURIComponent(targetWorkflowId)}`);
      return res.ok && res.data.id ? res.data : null;
    },
    enabled: Boolean(targetWorkflowId),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (runId || !fetchedWorkflow) return;
    if (graph?.id !== fetchedWorkflow.id) {
      setGraph(fetchedWorkflow, false);
      setSaveStatus(null);
    }
  }, [runId, fetchedWorkflow, graph?.id, setGraph, setSaveStatus]);

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
      queryClient.setQueryData(["workflow", current.id], structuredClone(current));
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
            position: { x: 0, y: 0 },
            promptTemplate: "Analyze {{topic}}",
            outputKey: "result",
          },
        ],
        edges: [],
      },
      true,
    );
    router.push("/");
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

  const handleDeleteWorkflow = async (workflowId: string) => {
    const res = await apiJson<{ ok: boolean }>(`/api/workflows/${encodeURIComponent(workflowId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.ok) {
      queryClient.removeQueries({ queryKey: ["workflow", workflowId] });
      if (graph?.id === workflowId) {
        const remaining = workflows.filter((w) => w.id !== workflowId);
        if (remaining.length > 0) {
          router.push(`/?workflow=${encodeURIComponent(remaining[0].id)}`);
        } else {
          setGraph(null, false);
          router.push("/");
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["workflows"] });
    } else {
      setSaveStatus(res.data.error || "Delete failed");
    }
  };

  const handleStartRunForWorkflow = async (workflowId: string, initialData: Record<string, unknown>) => {
    if (isStartingRun) return;
    setIsStartingRun(true);
    let targetGraph: RawGraph | null = graph?.id === workflowId ? graph : null;
    if (!targetGraph) {
      const cached = queryClient.getQueryData<RawGraph>(["workflow", workflowId]);
      if (cached) {
        targetGraph = cached;
      } else {
        const fetched = await apiJson<RawGraph>(`/api/workflows/${encodeURIComponent(workflowId)}`);
        if (fetched.ok && fetched.data.id) {
          targetGraph = fetched.data;
        }
      }
    }
    if (!targetGraph) {
      setIsStartingRun(false);
      setSaveStatus("Could not load workflow");
      return;
    }

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

  const isSwitchingWorkflow = Boolean(!runId && targetWorkflowId && graph?.id !== targetWorkflowId && workflowLoading);
  const displayedGraph = runId
    ? (runDetail?.graph ?? null)
    : targetWorkflowId && graph?.id !== targetWorkflowId
      ? fetchedWorkflow
      : graph;
  const stageLoading = Boolean((runId && runLoading && !runDetail) || (isSwitchingWorkflow && !fetchedWorkflow));
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
          router.push(`/?workflow=${encodeURIComponent(id)}`);
        }}
        onLoadTemplate={handleLoadTemplate}
        onNewWorkflow={handleNewWorkflow}
        onSaveWorkflow={handleSaveWorkflow}
        onDeleteWorkflow={handleDeleteWorkflow}
        onStartRun={handleStartRunForWorkflow}
        onCancelRun={handleCancelRun}
      />

      {/* Center Flow Canvas Stage (Persistent instance, zero remount flicker) */}
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

        <ObsidianGraphStage
          graph={displayedGraph}
          runDetail={runDetail}
          isLoading={stageLoading}
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
