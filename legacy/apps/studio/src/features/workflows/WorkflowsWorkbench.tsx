"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiJson, authHeaders } from "@/api";
import { useWorkflowStore } from "@/stores/workflow-store";
import type {
  NodeKind,
  RawGraph,
  RunDetail,
  RunSummary,
  SystemStatusResponse,
  WorkflowSummary,
  WorkflowVersion,
} from "@/types";
import { CanvasStage } from "./CanvasStage";
import { CheckpointBar } from "./CheckpointBar";
import { SourceDrawer } from "./SourceDrawer";

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
  const addNode = useWorkflowStore((s) => s.addNode);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const markSaved = useWorkflowStore((s) => s.markSaved);
  const setSaveStatus = useWorkflowStore((s) => s.setSaveStatus);
  const forkSnapshot = useWorkflowStore((s) => s.forkSnapshot);

  const [drawerOpen, setDrawerOpen] = useState(true);
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

  const activeWorkflowId = graph?.id ?? targetWorkflowId;
  const { data: versions = [] } = useQuery({
    queryKey: ["workflow-versions", activeWorkflowId],
    queryFn: async () => {
      if (!activeWorkflowId) return [];
      const res = await apiJson<{ versions: WorkflowVersion[] }>(
        `/api/workflows/${encodeURIComponent(activeWorkflowId)}/versions`,
      );
      return res.ok ? res.data.versions : [];
    },
    enabled: Boolean(activeWorkflowId) && !runId,
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
    if (!current || isSaving || current.nodes.length === 0) return;
    setIsSaving(true);
    setSaveStatus("Saving...");
    const res = await apiJson<{ ok: boolean; id: string }>("/api/workflows", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json", "X-Version-Label": "Manual save" }),
      body: JSON.stringify(current),
    });
    setIsSaving(false);
    if (res.ok) {
      markSaved("Saved");
      queryClient.setQueryData(["workflow", current.id], structuredClone(current));
      await queryClient.invalidateQueries({ queryKey: ["workflows"] });
      await queryClient.invalidateQueries({ queryKey: ["workflow-versions", current.id] });
    } else {
      setSaveStatus(res.data.error || "Save failed");
    }
  }, [isSaving, markSaved, queryClient, setSaveStatus]);

  // Debounced autosave snapshot to version history when dirty
  useEffect(() => {
    if (runId || !isDirty || !graph || graph.nodes.length === 0) return;
    const timer = setTimeout(() => {
      void apiJson(`/api/workflows/${encodeURIComponent(graph.id)}/versions`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ graph, label: "Autosave" }),
      }).then((res) => {
        if (res.ok) {
          void queryClient.invalidateQueries({ queryKey: ["workflow-versions", graph.id] });
        }
      });
    }, 4000);
    return () => clearTimeout(timer);
  }, [runId, isDirty, graph, queryClient]);

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
        entryNode: "",
        maxSteps: 20,
        policy: {
          memoryRecallBefore: "decision",
          saveRunSummary: true,
          autoCheckpointBefore: [],
          strictCompatibility: false,
        },
        nodes: [],
        edges: [],
      },
      false,
    );
    router.push("/");
  };

  const handleCreateStarterGraph = (kind: NodeKind) => {
    const id = graph?.id || `wf-${Date.now().toString(36).slice(-4)}`;
    if (!graph) {
      setGraph(
        {
          id,
          name: "Untitled Workflow",
          description: "",
          version: 1,
          entryNode: "",
          maxSteps: 20,
          policy: {
            memoryRecallBefore: "decision",
            saveRunSummary: true,
            autoCheckpointBefore: [],
            strictCompatibility: false,
          },
          nodes: [],
          edges: [],
        },
        true,
      );
    }
    const created = addNode(kind, { position: { x: 0, y: 0 } });
    if (created) {
      selectNode(created.id);
    }
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

  const handleStartRun = async (initialData: Record<string, unknown>) => {
    if (!graph || isStartingRun) return;
    setIsStartingRun(true);
    const res = await apiJson<{ runId: string; status: string }>("/api/runs", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ graph, initialData }),
    });
    setIsStartingRun(false);
    if (res.ok && res.data.runId) {
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
      router.push(`/runs/${encodeURIComponent(res.data.runId)}`);
    } else {
      setSaveStatus(res.data.error || "Failed to start run");
    }
  };

  const handleRollbackRun = async (toStep?: number) => {
    if (!runId) return;
    const res = await apiJson<{ ok: boolean; runId: string }>(`/api/runs/${encodeURIComponent(runId)}/rollback`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(toStep !== undefined ? { toStep } : {}),
    });
    if (res.ok) {
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
      void refetchRun();
    }
  };

  const handleCancelRun = async () => {
    if (!runId) return;
    const res = await apiJson<{ ok: boolean }>(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (res.ok) {
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
      void refetchRun();
    }
  };

  const handleRestoreVersion = (version: WorkflowVersion) => {
    setGraph(version.graph, true);
    setSaveStatus(`Restored ${version.label}`);
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
      <SourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        workflows={workflows}
        workflowsLoading={workflowsLoading}
        runs={runs}
        runsLoading={runsLoading}
        activeGraph={displayedGraph}
        activeRunId={runId}
        onSelectWorkflow={(id) => {
          router.push(`/?workflow=${encodeURIComponent(id)}`);
        }}
        onSelectRun={(id) => {
          router.push(`/runs/${encodeURIComponent(id)}`);
        }}
        onNewWorkflow={handleNewWorkflow}
        onDeleteWorkflow={handleDeleteWorkflow}
      />

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

        <CanvasStage
          graph={displayedGraph}
          runDetail={runDetail}
          isLoading={stageLoading}
          readOnly={isReadOnly}
          drawerOpen={drawerOpen}
          onToggleDrawer={() => setDrawerOpen((v) => !v)}
          isDirty={isDirty}
          isSaving={isSaving}
          isStartingRun={isStartingRun}
          saveStatus={saveStatus}
          versions={versions}
          availableSkills={systemData?.skills ?? []}
          modelCatalog={systemData?.modelCatalog ?? []}
          onSaveWorkflow={handleSaveWorkflow}
          onStartRun={handleStartRun}
          onCancelRun={handleCancelRun}
          onRestoreVersion={handleRestoreVersion}
          onCreateStarterGraph={handleCreateStarterGraph}
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
          onRollbackRun={handleRollbackRun}
        />
      </div>
    </div>
  );
}
