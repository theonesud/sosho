import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import type * as activities from "./activities.ts";
import type {
  CheckpointDecisionSignal,
  GraphDefinition,
  GraphNode,
  TaskQueue,
  WorkflowRunState,
} from "./schema.ts";

export const checkpointDecisionSignal = defineSignal<[CheckpointDecisionSignal]>("checkpointDecision");
export const runStateQuery = defineQuery<WorkflowRunState>("getRunState");

const cloudActivities = proxyActivities<typeof activities>({
  taskQueue: "cloud-io",
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 3, initialInterval: "2s", backoffCoefficient: 2 },
});

const localGpuActivities = proxyActivities<typeof activities>({
  taskQueue: "local-gpu",
  startToCloseTimeout: "20 minutes",
  retry: { maximumAttempts: 5, initialInterval: "5s", backoffCoefficient: 2 },
});

const browserActivities = proxyActivities<typeof activities>({
  taskQueue: "host-browser",
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 2, initialInterval: "3s" },
});

function pickQueue(node: GraphNode): TaskQueue {
  if (node.queue) return node.queue;
  if (node.type === "tool" && node.toolKind === "yue2") return "local-gpu";
  if ("tier" in node && node.tier === "local-uncensored") return "local-gpu";
  if (node.type === "skill" && ["dokobot", "social-x"].includes(node.skillName)) return "host-browser";
  return "cloud-io";
}

function getActivityProxy(queue: TaskQueue) {
  if (queue === "local-gpu") return localGpuActivities;
  if (queue === "host-browser") return browserActivities;
  return cloudActivities;
}

export async function executeGraphWorkflow(input: {
  graph: GraphDefinition;
  initialData: Record<string, unknown>;
  cwd: string;
}): Promise<WorkflowRunState> {
  const { graph, initialData, cwd } = input;
  const info = workflowInfo();

  const state: WorkflowRunState = {
    runId: info.workflowId,
    graphId: graph.id,
    status: "running",
    currentNodeId: graph.entryNode,
    stepCount: 0,
    data: { ...initialData },
    history: [],
  };

  let pendingSignal: CheckpointDecisionSignal | null = null;
  setHandler(checkpointDecisionSignal, (sig) => {
    pendingSignal = sig;
  });
  setHandler(runStateQuery, () => state);

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  let currentId: string | null = graph.entryNode;

  while (currentId && state.stepCount < graph.maxSteps) {
    const node = nodeMap.get(currentId);
    if (!node) {
      state.status = "failed";
      throw new Error(`Node '${currentId}' not found in graph '${graph.id}'`);
    }

    state.stepCount += 1;
    state.currentNodeId = node.id;
    const logEntry = {
      step: state.stepCount,
      nodeId: node.id,
      type: node.type,
      status: "running" as "running" | "waiting_checkpoint" | "done" | "failed",
      startedAt: new Date().toISOString(),
    };
    state.history.push(logEntry);

    await cloudActivities.emitCanvasEvent({
      runId: state.runId,
      graphId: graph.id,
      nodeId: node.id,
      status: "running",
    });

    let chosenBranch: string | undefined;

    if (node.type === "checkpoint") {
      state.status = "waiting_checkpoint";
      logEntry.status = "waiting_checkpoint";
      pendingSignal = null;

      await cloudActivities.emitCanvasEvent({
        runId: state.runId,
        graphId: graph.id,
        nodeId: node.id,
        status: "waiting_checkpoint",
        message: node.message,
      });

      await condition(() => pendingSignal !== null && pendingSignal.nodeId === node.id);
      const sig = pendingSignal!;
      if (sig.statePatch && node.allowStateEdit) {
        Object.assign(state.data, sig.statePatch);
      }
      chosenBranch = sig.action;
      state.status = "running";
      logEntry.status = "done";
      logEntry.finishedAt = new Date().toISOString();
      logEntry.branch = chosenBranch;
      logEntry.outputPreview = sig.note || `checkpoint ${sig.action}`;
    } else {
      try {
        const queue = pickQueue(node);
        const proxy = getActivityProxy(queue);
        const res = await proxy.executeNodeActivity({ node, data: state.data, cwd });
        if (res.outputKey) {
          state.data[res.outputKey] = res.value;
        }
        chosenBranch = res.branch;
        logEntry.status = "done";
        logEntry.finishedAt = new Date().toISOString();
        logEntry.outputPreview = res.preview;
        logEntry.branch = chosenBranch;
      } catch (err) {
        logEntry.status = "failed";
        logEntry.finishedAt = new Date().toISOString();
        logEntry.error = err instanceof Error ? err.message : String(err);
        state.status = "failed";
        await cloudActivities.emitCanvasEvent({
          runId: state.runId,
          graphId: graph.id,
          nodeId: node.id,
          status: "failed",
          error: logEntry.error,
        });
        throw err;
      }
    }

    await cloudActivities.emitCanvasEvent({
      runId: state.runId,
      graphId: graph.id,
      nodeId: node.id,
      status: "done",
      branch: chosenBranch,
      preview: logEntry.outputPreview,
    });

    const outgoing = graph.edges.filter((e) => e.source === node.id);
    if (outgoing.length === 0) {
      currentId = null;
    } else if (chosenBranch) {
      const matched = outgoing.find((e) => e.condition === chosenBranch) || outgoing.find((e) => !e.condition);
      currentId = matched ? matched.target : null;
    } else {
      currentId = outgoing[0].target;
    }
  }

  state.status = "completed";
  state.currentNodeId = null;
  return state;
}

export async function memoryConsolidateWorkflow(input: {
  scope: "global" | "project" | "both";
  cwd: string;
}): Promise<Record<string, number>> {
  return cloudActivities.consolidateMemoryActivity(input);
}
