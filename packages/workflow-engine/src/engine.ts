import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { Semaphore } from "../../llm/src/subagent-runtime.ts";
import { type ActivityResult, type ActivityRuntimeOptions, executeNodeActivity } from "./activities.ts";
import {
  type CheckpointDecisionSignal,
  type GraphDefinition,
  type GraphNode,
  MAX_STEPS_EXCEEDED_ERROR,
  type TaskQueue,
  type WorkflowRunState,
  validateGraph,
} from "./schema.ts";
import { type PersistedWorkflowRun, WorkflowRunStore } from "./store.ts";

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

export function pickTaskQueue(node: GraphNode): TaskQueue {
  if (node.queue) return node.queue;
  if (node.type === "tool" && node.toolKind === "yue2") return "local-gpu";
  if (node.type === "skill" && ["dokobot", "social-x", "youtube-digest"].includes(node.skillName)) {
    return "host-browser";
  }
  if ("tier" in node && node.tier === "local-uncensored") return "local-gpu";
  return "cloud-io";
}

export type NodeExecutor = (input: {
  node: GraphNode;
  data: Record<string, unknown>;
  cwd: string;
  runId: string;
  queue: TaskQueue;
}) => Promise<ActivityResult>;

export interface WorkflowEngineOptions {
  cwd: string;
  dbPath?: string;
  executor?: NodeExecutor;
  activityOptions?: ActivityRuntimeOptions;
}

export class WorkflowEngine extends EventEmitter {
  readonly store: WorkflowRunStore;
  private readonly cwd: string;
  private readonly executor: NodeExecutor;
  private readonly activeLoops = new Map<string, Promise<void>>();
  private readonly cancelledRuns = new Set<string>();
  private readonly queues: Record<TaskQueue, Semaphore> = {
    "cloud-io": new Semaphore(8),
    "local-gpu": new Semaphore(1),
    "host-browser": new Semaphore(2),
  };

  constructor(options: WorkflowEngineOptions) {
    super();
    this.cwd = options.cwd;
    this.store = new WorkflowRunStore(options.cwd, options.dbPath);
    this.executor =
      options.executor ||
      (async ({ node, data, cwd, runId }) =>
        executeNodeActivity({
          node,
          data,
          cwd,
          options: { ...options.activityOptions, runId },
        }));
  }

  private emitWorkflowEvent(event: Record<string, unknown>): void {
    this.emit("event", { timestamp: new Date().toISOString(), ...event });
  }

  async startRun(
    rawGraph: unknown,
    initialData: Record<string, unknown> = {},
    customRunId?: string,
  ): Promise<PersistedWorkflowRun> {
    const graph = validateGraph(rawGraph);
    const runId = customRunId || `sosho-${graph.id}-${randomBytes(3).toString("hex")}`;
    const now = new Date().toISOString();
    const run: PersistedWorkflowRun = {
      runId,
      graphId: graph.id,
      graph,
      status: "running",
      currentNodeId: graph.entryNode,
      frontier: [graph.entryNode],
      activeNodeIds: [graph.entryNode],
      pausedCheckpoint: null,
      stepCount: 0,
      data: { ...initialData },
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    this.store.saveRun(run);
    this.emitWorkflowEvent({ type: "run_started", runId, graphId: graph.id });
    this.launchLoop(runId);
    return run;
  }

  getRun(runId: string): PersistedWorkflowRun | null {
    return this.store.getRun(runId);
  }

  listRuns(limit = 50): PersistedWorkflowRun[] {
    return this.store.listRuns(limit);
  }

  async signalCheckpoint(runId: string, signal: CheckpointDecisionSignal): Promise<PersistedWorkflowRun> {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status !== "waiting_checkpoint" || !run.pausedCheckpoint) {
      throw new Error(`Run '${runId}' is not waiting at a checkpoint (status: ${run.status})`);
    }
    if (run.pausedCheckpoint.nodeId !== signal.nodeId) {
      throw new Error(
        `Run '${runId}' is paused at '${run.pausedCheckpoint.nodeId}', not '${signal.nodeId}'`,
      );
    }

    const cpNode = run.graph.nodes.find((n) => n.id === signal.nodeId);
    if (signal.statePatch && cpNode?.type === "checkpoint" && cpNode.allowStateEdit !== false) {
      Object.assign(run.data, signal.statePatch);
    }

    const action = signal.action === "reject" ? "reject" : "approve";
    const lastEntry = [...run.history]
      .reverse()
      .find((h) => h.nodeId === signal.nodeId && h.status === "waiting_checkpoint");
    if (lastEntry) {
      lastEntry.status = "done";
      lastEntry.finishedAt = new Date().toISOString();
      lastEntry.branch = action;
      lastEntry.outputPreview = signal.note ? `${action}: ${signal.note}` : action;
    }

    const outgoing = run.graph.edges.filter((e) => e.source === signal.nodeId);
    const nextTargets = outgoing
      .filter((e) => !e.condition || e.condition === action)
      .map((e) => e.target);

    const remaining = run.frontier.filter((id) => id !== signal.nodeId);
    run.frontier = Array.from(new Set([...remaining, ...nextTargets]));
    run.activeNodeIds = [...run.frontier];
    run.pausedCheckpoint = null;
    run.status = "running";
    run.currentNodeId = run.frontier[0] ?? null;
    this.store.saveRun(run);

    this.emitWorkflowEvent({
      type: "node_done",
      runId,
      nodeId: signal.nodeId,
      status: "done",
      branch: action,
      preview: action,
    });

    this.launchLoop(runId);
    return run;
  }

  cancelRun(runId: string): PersistedWorkflowRun {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      return run;
    }
    this.cancelledRuns.add(runId);
    run.status = "cancelled";
    run.currentNodeId = null;
    run.frontier = [];
    run.activeNodeIds = [];
    run.pausedCheckpoint = null;
    run.error = "cancelled_by_user";
    this.store.saveRun(run);
    this.emitWorkflowEvent({ type: "run_cancelled", runId });
    return run;
  }

  recoverInterruptedRuns(): string[] {
    const interrupted = this.store.listInterruptedRuns();
    const recovered: string[] = [];
    for (const run of interrupted) {
      if (!this.activeLoops.has(run.runId)) {
        recovered.push(run.runId);
        this.launchLoop(run.runId);
      }
    }
    return recovered;
  }

  async waitForRun(runId: string, timeoutMs = 30_000): Promise<PersistedWorkflowRun> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const active = this.activeLoops.get(runId);
      if (active) {
        await active;
      }
      const run = this.store.getRun(runId);
      if (!run) throw new Error(`Run not found: ${runId}`);
      if (run.status !== "running") return run;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error(`Timed out waiting for run ${runId}`);
  }

  close(): void {
    this.store.close();
  }

  private launchLoop(runId: string): void {
    if (this.activeLoops.has(runId)) return;
    const promise = this.driveRun(runId).finally(() => {
      this.activeLoops.delete(runId);
    });
    this.activeLoops.set(runId, promise);
  }

  private async driveRun(runId: string): Promise<void> {
    while (true) {
      if (this.cancelledRuns.has(runId)) {
        this.cancelledRuns.delete(runId);
        return;
      }

      const run = this.store.getRun(runId);
      if (!run || run.status !== "running") return;

      if (run.frontier.length === 0) {
        run.status = "completed";
        run.currentNodeId = null;
        run.activeNodeIds = [];
        this.store.saveRun(run);
        this.emitWorkflowEvent({ type: "run_completed", runId, graphId: run.graphId });
        return;
      }

      const limitCheck = evaluateStepLimit(run.stepCount, run.graph.maxSteps, run.frontier.length);
      if (limitCheck.exceeded) {
        run.status = "failed";
        run.error = limitCheck.error;
        run.activeNodeIds = [];
        this.store.saveRun(run);
        this.emitWorkflowEvent({ type: "run_failed", runId, error: run.error });
        return;
      }

      const nodeMap = new Map(run.graph.nodes.map((n) => [n.id, n]));

      // Partition frontier: if a checkpoint node is ready, pause cleanly after any non-checkpoint ready nodes finish
      const nonCheckpoints = run.frontier.filter((id) => nodeMap.get(id)?.type !== "checkpoint");
      const checkpoints = run.frontier.filter((id) => nodeMap.get(id)?.type === "checkpoint");

      if (nonCheckpoints.length === 0 && checkpoints.length > 0) {
        const cpId = checkpoints[0];
        const cpNode = nodeMap.get(cpId);
        if (!cpNode || cpNode.type !== "checkpoint") return;

        run.stepCount += 1;
        run.status = "waiting_checkpoint";
        run.currentNodeId = cpId;
        run.pausedCheckpoint = {
          nodeId: cpId,
          message: cpNode.message,
          allowStateEdit: cpNode.allowStateEdit ?? true,
        };
        run.history.push({
          step: run.stepCount,
          nodeId: cpId,
          type: "checkpoint",
          status: "waiting_checkpoint",
          startedAt: new Date().toISOString(),
          outputPreview: cpNode.message,
        });
        this.store.saveRun(run);
        this.emitWorkflowEvent({
          type: "checkpoint_waiting",
          runId,
          nodeId: cpId,
          status: "waiting_checkpoint",
          message: cpNode.message,
          allowStateEdit: cpNode.allowStateEdit ?? true,
          preview: cpNode.message,
        });
        return;
      }

      // Execute all ready non-checkpoint nodes in this wave in parallel (subject to resource queue semaphores)
      // Enforce maxSteps budget before launching wave
      const budget = run.graph.maxSteps - run.stepCount;
      const wave = nonCheckpoints.slice(0, Math.max(1, budget));
      const deferred = nonCheckpoints.slice(wave.length);

      const waveEntries = wave.map((nodeId) => {
        const node = nodeMap.get(nodeId)!;
        run.stepCount += 1;
        const entry = {
          step: run.stepCount,
          nodeId,
          type: node.type,
          status: "running" as const,
          startedAt: new Date().toISOString(),
        };
        run.history.push(entry);
        return { node, entry };
      });

      run.currentNodeId = wave[0] ?? null;
      this.store.saveRun(run);

      for (const { node } of waveEntries) {
        this.emitWorkflowEvent({
          type: "node_running",
          runId,
          nodeId: node.id,
          status: "running",
        });
      }

      try {
        const results = await Promise.all(
          waveEntries.map(({ node }) => {
            const queue = pickTaskQueue(node);
            return this.queues[queue].run(async () => {
              const res = await this.executor({
                node,
                data: { ...run.data },
                cwd: this.cwd,
                runId,
                queue,
              });
              return { node, res };
            });
          }),
        );

        if (this.cancelledRuns.has(runId)) {
          this.cancelledRuns.delete(runId);
          return;
        }

        const nextTargets: string[] = [];
        for (let i = 0; i < results.length; i++) {
          const { node, res } = results[i];
          const logEntry = waveEntries[i].entry;
          if (res.outputKey) {
            run.data[res.outputKey] = res.value;
          }
          Object.assign(logEntry, {
            status: "done",
            finishedAt: new Date().toISOString(),
            outputPreview: res.preview,
            branch: res.branch,
          });
          this.emitWorkflowEvent({
            type: "node_done",
            runId,
            nodeId: node.id,
            status: "done",
            branch: res.branch,
            preview: res.preview,
          });

          const outgoing = run.graph.edges.filter((e) => e.source === node.id);
          if (res.branch) {
            for (const e of outgoing) {
              if (e.condition === res.branch) nextTargets.push(e.target);
            }
          } else {
            for (const e of outgoing) {
              if (!e.condition) nextTargets.push(e.target);
            }
          }
        }

        // Deduplicate next frontier so join nodes whose parallel predecessors finished in this wave execute once
        run.frontier = Array.from(new Set([...deferred, ...checkpoints, ...nextTargets]));
        run.activeNodeIds = [...run.frontier];
        run.currentNodeId = run.frontier[0] ?? null;
        this.store.saveRun(run);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        for (const { entry, node } of waveEntries) {
          if (entry.status === "running") {
            Object.assign(entry, {
              status: "failed",
              finishedAt: new Date().toISOString(),
              error: message,
            });
            this.emitWorkflowEvent({
              type: "node_failed",
              runId,
              nodeId: node.id,
              status: "failed",
              error: message,
            });
          }
        }
        run.status = "failed";
        run.error = message;
        run.frontier = [];
        run.activeNodeIds = [];
        this.store.saveRun(run);
        this.emitWorkflowEvent({ type: "run_failed", runId, error: message });
        return;
      }
    }
  }
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
