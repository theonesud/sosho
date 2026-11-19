import {
  type GraphDefinition,
  type GraphNode,
  MAX_STEPS_EXCEEDED_ERROR,
  type WorkflowRunState,
  validateGraph,
} from "./schema.ts";

export interface StepLimitCheck {
  exceeded: boolean;
  status: WorkflowRunState["status"];
  error?: string;
}

export function evaluateStepLimit(stepCount: number, maxSteps: number, remainingNodes: number): StepLimitCheck {
  if (remainingNodes > 0 && stepCount >= maxSteps) {
    return {
      exceeded: true,
      status: "failed",
      error: MAX_STEPS_EXCEEDED_ERROR,
    };
  }
  return { exceeded: false, status: remainingNodes > 0 ? "running" : "completed" };
}

export async function runInMemoryGraph(
  rawGraph: GraphDefinition,
  executeNode: (node: GraphNode, data: Record<string, unknown>) => Promise<{ dataPatch?: Record<string, unknown>; branch?: string }>,
  initialData: Record<string, unknown> = {},
): Promise<WorkflowRunState> {
  const graph = validateGraph(rawGraph);
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const state: WorkflowRunState = {
    runId: `run-${Date.now().toString(36)}`,
    graphId: graph.id,
    status: "running",
    currentNodeId: graph.entryNode,
    activeNodeIds: [graph.entryNode],
    stepCount: 0,
    data: { ...initialData },
    history: [],
  };

  let frontier = [graph.entryNode];
  while (frontier.length > 0) {
    const check = evaluateStepLimit(state.stepCount, graph.maxSteps, frontier.length);
    if (check.exceeded) {
      state.status = "failed";
      state.error = check.error;
      return state;
    }

    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      const checkInner = evaluateStepLimit(state.stepCount, graph.maxSteps, 1);
      if (checkInner.exceeded) {
        state.status = "failed";
        state.error = checkInner.error;
        return state;
      }

      const node = nodeMap.get(nodeId);
      if (!node) continue;
      state.currentNodeId = nodeId;
      state.stepCount += 1;
      const startedAt = new Date().toISOString();
      const res = await executeNode(node, state.data);
      if (res.dataPatch) Object.assign(state.data, res.dataPatch);
      state.history.push({
        step: state.stepCount,
        nodeId,
        type: node.type,
        status: "done",
        startedAt,
        finishedAt: new Date().toISOString(),
        branch: res.branch,
      });

      const outgoing = graph.edges.filter((e) => e.source === nodeId);
      if (res.branch) {
        for (const e of outgoing) {
          if (e.condition === res.branch) nextFrontier.push(e.target);
        }
      } else {
        for (const e of outgoing) {
          if (!e.condition) nextFrontier.push(e.target);
        }
      }
    }
    frontier = nextFrontier;
  }

  state.status = "completed";
  state.currentNodeId = null;
  state.activeNodeIds = [];
  return state;
}
