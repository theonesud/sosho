import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { Semaphore } from "../../llm/src/subagent-runtime.ts";
import { searchMemoryAsync, upsertMemory } from "../../memory/src/store.ts";
import { type ActivityResult, type ActivityRuntimeOptions, executeNodeActivity } from "./activities.ts";
import {
  type CheckpointDecisionSignal,
  checkPortCompatibility,
  DEFAULT_MIDDLEWARE_STAGES,
  deriveDefaultPorts,
  type GraphDefinition,
  type GraphEdge,
  type GraphNode,
  MAX_STEPS_EXCEEDED_ERROR,
  type NodeExecutionLog,
  type PortDataType,
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

function castMiddlewareValue(value: unknown, targetType: PortDataType): unknown {
  if (value === undefined || value === null) return value;
  switch (targetType) {
    case "text":
    case "markdown":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    case "boolean":
      return Boolean(value);
    case "json":
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          return { text: value };
        }
      }
      return value;
    default:
      return value;
  }
}

export function runEdgeMiddleware(
  edge: GraphEdge,
  sourceNode: GraphNode,
  targetNode: GraphNode,
  data: Record<string, unknown>,
  outputKey: string | undefined,
  outputValue: unknown,
  strict = false,
): { patch: Record<string, unknown>; trace: string } {
  const mw = edge.middleware;
  const stages = mw?.stages?.length ? mw.stages : DEFAULT_MIDDLEWARE_STAGES;
  const srcPorts = sourceNode.outputs?.length ? sourceNode.outputs : deriveDefaultPorts(sourceNode).outputs;
  const tgtPorts = targetNode.inputs?.length ? targetNode.inputs : deriveDefaultPorts(targetNode).inputs;
  const srcPort = (mw?.sourcePort ? srcPorts.find((p) => p.id === mw.sourcePort) : undefined) ?? srcPorts[0];
  const tgtPort = (mw?.targetPort ? tgtPorts.find((p) => p.id === mw.targetPort) : undefined) ?? tgtPorts[0];
  const compat = srcPort && tgtPort ? checkPortCompatibility(srcPort.type, tgtPort.type, strict) : "compatible";

  const traceParts: string[] = [];
  const patch: Record<string, unknown> = {};
  const defaultSrcKey = outputKey || srcPort?.id || "last_output";
  let currentVal = outputValue !== undefined ? outputValue : data[defaultSrcKey];

  if (stages.includes("validate")) {
    if (compat === "incompatible" && strict) {
      throw new Error(`Middleware validate failed on ${edge.source} -> ${edge.target}: incompatible port types`);
    }
    traceParts.push(`validate:${compat}`);
  }

  if (stages.includes("map")) {
    if (mw?.fieldMapping && Object.keys(mw.fieldMapping).length > 0) {
      for (const [targetField, sourceField] of Object.entries(mw.fieldMapping)) {
        const mappedVal = sourceField === defaultSrcKey ? currentVal : data[sourceField];
        if (mappedVal !== undefined) {
          patch[targetField] = mappedVal;
        }
      }
      traceParts.push(`map:${Object.keys(mw.fieldMapping).join(",")}`);
    } else {
      traceParts.push(`map:${defaultSrcKey}->passthrough`);
    }
  }

  if (stages.includes("cast")) {
    const castType = mw?.castTo ?? (compat === "cast" && tgtPort ? tgtPort.type : undefined);
    if (castType && currentVal !== undefined) {
      currentVal = castMiddlewareValue(currentVal, castType);
      for (const k of Object.keys(patch)) {
        patch[k] = castMiddlewareValue(patch[k], castType);
      }
      traceParts.push(`cast:${castType}`);
    }
  }

  if (stages.includes("redact")) {
    const patterns = mw?.redactPatterns ?? [];
    const shouldRedact = Boolean(sourceNode.outputVisibility?.redact) || patterns.length > 0;
    if (shouldRedact) {
      const applyRedact = (v: unknown) => {
        if (typeof v !== "string") return v;
        let out = v;
        for (const pat of patterns) {
          if (pat.trim()) {
            out = out.split(pat).join("[REDACTED]");
          }
        }
        if (sourceNode.outputVisibility?.redact && patterns.length === 0) {
          out = out.replace(/\b(sk-[a-zA-Z0-9_-]{8,}|Bearer\s+[a-zA-Z0-9._-]+)\b/g, "[REDACTED]");
        }
        return out;
      };
      currentVal = applyRedact(currentVal);
      for (const k of Object.keys(patch)) {
        patch[k] = applyRedact(patch[k]);
      }
      traceParts.push("redact:applied");
    }
  }

  if (stages.includes("deliver")) {
    if (Object.keys(patch).length === 0 && defaultSrcKey && currentVal !== undefined) {
      patch[defaultSrcKey] = currentVal;
    }
    traceParts.push(`deliver:${targetNode.id}`);
  }

  if (stages.includes("trace")) {
    traceParts.push(`trace:${edge.id}`);
  }

  return { patch, trace: `${edge.source}->${edge.target} [${traceParts.join(" | ")}]` };
}

function matchesAutoCheckpoint(node: GraphNode, categories: Array<"gpu" | "yue2" | "tool">): string | null {
  if (categories.length === 0) return null;
  if (categories.includes("yue2") && node.type === "tool" && node.toolKind === "yue2") {
    return "yue2";
  }
  if (categories.includes("gpu") && pickTaskQueue(node) === "local-gpu") {
    return "gpu";
  }
  if (categories.includes("tool") && node.type === "tool") {
    return "tool";
  }
  return null;
}

function shouldRecallMemory(
  node: GraphNode,
  entryNode: string,
  mode: "off" | "entry" | "decision" | "all",
): boolean {
  if (mode === "off") return false;
  if (mode === "all") return true;
  if (mode === "entry") return node.id === entryNode;
  return node.type === "decision";
}

export type NodeExecutor = (input: {
  node: GraphNode;
  data: Record<string, unknown>;
  cwd: string;
  runId: string;
  queue: TaskQueue;
  signal?: AbortSignal;
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
  private readonly runAbortControllers = new Map<string, AbortController>();
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
      (async ({ node, data, cwd, runId, signal }) =>
        executeNodeActivity({
          node,
          data,
          cwd,
          signal,
          options: { ...options.activityOptions, runId },
        }));
  }

  private emitWorkflowEvent(event: Record<string, unknown>): void {
    this.emit("event", { timestamp: new Date().toISOString(), ...event });
  }

  getQueueStats(): Record<TaskQueue, { active: number; limit: number }> {
    return {
      "cloud-io": {
        active: this.queues["cloud-io"].activeCount,
        limit: this.queues["cloud-io"].maxLimit,
      },
      "local-gpu": {
        active: this.queues["local-gpu"].activeCount,
        limit: this.queues["local-gpu"].maxLimit,
      },
      "host-browser": {
        active: this.queues["host-browser"].activeCount,
        limit: this.queues["host-browser"].maxLimit,
      },
    };
  }

  private emitQueueStats(runId: string, queue: TaskQueue): void {
    this.emitWorkflowEvent({
      type: "queue_stats",
      runId,
      queue,
      queues: this.getQueueStats(),
    });
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
    const isSynthetic = Boolean(run.pausedCheckpoint.synthetic) || cpNode?.type !== "checkpoint";
    if (signal.statePatch && (isSynthetic || (cpNode?.type === "checkpoint" && cpNode.allowStateEdit !== false))) {
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

    if (isSynthetic) {
      if (action === "reject") {
        run.status = "cancelled";
        run.currentNodeId = null;
        run.frontier = [];
        run.activeNodeIds = [];
        run.pausedCheckpoint = null;
        run.error = signal.note || "Auto-checkpoint rejected";
        this.store.saveRun(run);
        this.emitWorkflowEvent({ type: "run_cancelled", runId });
        return run;
      }
      const approved = Array.isArray(run.data._approved_checkpoints)
        ? (run.data._approved_checkpoints as string[])
        : [];
      run.data._approved_checkpoints = Array.from(new Set([...approved, signal.nodeId]));
      run.pausedCheckpoint = null;
      run.status = "running";
      run.currentNodeId = signal.nodeId;
      this.store.saveRun(run);
      this.emitWorkflowEvent({
        type: "node_done",
        runId,
        nodeId: signal.nodeId,
        status: "done",
        branch: action,
        preview: `Auto-checkpoint approved`,
      });
      this.launchLoop(runId);
      return run;
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

  async rollbackRun(runId: string, toStep?: number): Promise<PersistedWorkflowRun> {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status === "running") {
      this.cancelRun(runId);
    }

    const candidates = run.history.filter(
      (h) => h.status === "done" || h.status === "waiting_checkpoint" || h.status === "failed",
    );
    const targetEntry =
      toStep !== undefined
        ? candidates.find((h) => h.step === toStep)
        : [...candidates]
            .reverse()
            .find((h) => h.type === "checkpoint" || h.status === "done") ?? candidates[candidates.length - 1];

    if (!targetEntry) {
      throw new Error(`No restorable step found in run '${runId}'`);
    }

    if (targetEntry.inputSnapshot) {
      run.data = structuredClone(targetEntry.inputSnapshot);
    }
    run.status = "running";
    run.error = undefined;
    run.pausedCheckpoint = null;
    run.frontier = [targetEntry.nodeId];
    run.activeNodeIds = [targetEntry.nodeId];
    run.currentNodeId = targetEntry.nodeId;
    this.store.saveRun(run);
    this.emitWorkflowEvent({
      type: "run_rolled_back",
      runId,
      nodeId: targetEntry.nodeId,
      step: targetEntry.step,
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
    const controller = this.runAbortControllers.get(runId);
    if (controller) {
      controller.abort(new Error("cancelled_by_user"));
      this.runAbortControllers.delete(runId);
    }
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
    const controller = new AbortController();
    this.runAbortControllers.set(runId, controller);
    const promise = this.driveRun(runId, controller.signal).finally(() => {
      this.activeLoops.delete(runId);
      this.runAbortControllers.delete(runId);
    });
    this.activeLoops.set(runId, promise);
  }

  private async driveRun(runId: string, runSignal?: AbortSignal): Promise<void> {
    while (true) {
      if (this.cancelledRuns.has(runId) || runSignal?.aborted) {
        this.cancelledRuns.delete(runId);
        return;
      }

      const run = this.store.getRun(runId);
      if (!run || run.status !== "running") return;

      if (run.frontier.length === 0) {
        run.status = "completed";
        run.currentNodeId = null;
        run.activeNodeIds = [];
        if (run.graph.policy?.saveRunSummary !== false && !run.data._run_summary_saved) {
          try {
            const summarySteps = run.history
              .map((h) => `${h.step}. ${h.nodeId} (${h.status}): ${(h.outputPreview || "").slice(0, 100)}`)
              .join("\n");
            upsertMemory(
              {
                scope: "project",
                type: "episodic",
                title: `Workflow run ${run.graph.name} (${run.runId})`,
                content: `Completed in ${run.stepCount} steps.\n${summarySteps}`,
                tags: ["workflow-run", run.graph.id],
              },
              this.cwd,
            );
            run.data._run_summary_saved = true;
          } catch {
            // Best-effort run summary save
          }
        }
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

      // Policy: auto-checkpoint before gpu / yue2 / tool nodes
      const autoCpCategories = run.graph.policy?.autoCheckpointBefore ?? [];
      const approvedCps = new Set(
        Array.isArray(run.data._approved_checkpoints) ? (run.data._approved_checkpoints as string[]) : [],
      );
      if (autoCpCategories.length > 0 && nonCheckpoints.length > 0) {
        const autoTarget = nonCheckpoints.find((id) => {
          if (approvedCps.has(id)) return false;
          const n = nodeMap.get(id);
          return n ? matchesAutoCheckpoint(n, autoCpCategories) !== null : false;
        });
        if (autoTarget) {
          const targetNode = nodeMap.get(autoTarget)!;
          const cat = matchesAutoCheckpoint(targetNode, autoCpCategories)!;
          const msg = `Auto-checkpoint before ${cat} step: ${targetNode.label}`;
          run.stepCount += 1;
          run.status = "waiting_checkpoint";
          run.currentNodeId = autoTarget;
          run.pausedCheckpoint = {
            nodeId: autoTarget,
            message: msg,
            allowStateEdit: true,
            synthetic: true,
          };
          run.history.push({
            step: run.stepCount,
            nodeId: autoTarget,
            type: targetNode.type,
            status: "waiting_checkpoint",
            startedAt: new Date().toISOString(),
            inputSnapshot: { ...run.data },
            outputPreview: msg,
          });
          this.store.saveRun(run);
          this.emitWorkflowEvent({
            type: "checkpoint_waiting",
            runId,
            nodeId: autoTarget,
            status: "waiting_checkpoint",
            message: msg,
            allowStateEdit: true,
            synthetic: true,
            preview: msg,
          });
          return;
        }
      }

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

      const recallMode = run.graph.policy?.memoryRecallBefore ?? "decision";
      const waveEntries = await Promise.all(
        wave.map(async (nodeId) => {
          const node = nodeMap.get(nodeId)!;
          const queue = pickTaskQueue(node);
          const startedMs = Date.now();
          const inputSnapshot = { ...run.data };
          let memoryRecall: { query: string; count: number; preview?: string } | undefined;

          if (shouldRecallMemory(node, run.graph.entryNode, recallMode)) {
            const query = String(
              run.data.topic ||
                ("promptTemplate" in node && typeof node.promptTemplate === "string"
                  ? node.promptTemplate.slice(0, 120)
                  : node.label),
            ).trim();
            if (query) {
              try {
                const hits = await searchMemoryAsync({ query, scope: "both", limit: 3 }, this.cwd);
                const preview = hits.map((h) => `${h.record.title}: ${h.record.content.slice(0, 80)}`).join(" | ");
                memoryRecall = { query, count: hits.length, preview: preview || undefined };
                if (hits.length > 0) {
                  inputSnapshot._recalled_memory = hits.map((h) => ({
                    title: h.record.title,
                    content: h.record.content,
                  }));
                }
              } catch {
                memoryRecall = { query, count: 0 };
              }
            }
          }

          run.stepCount += 1;
          const entry: NodeExecutionLog = {
            step: run.stepCount,
            nodeId,
            type: node.type,
            status: "running",
            startedAt: new Date(startedMs).toISOString(),
            queue,
            inputSnapshot,
            memoryRecall,
            traceId: runId,
          };
          run.history.push(entry);
          return { node, entry, queue, startedMs, inputSnapshot };
        }),
      );

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
          waveEntries.map(async ({ node, queue, inputSnapshot }) => {
            const release = await this.queues[queue].acquire();
            this.emitQueueStats(runId, queue);
            try {
              const res = await this.executor({
                node,
                data: { ...inputSnapshot },
                cwd: this.cwd,
                runId,
                queue,
                signal: runSignal,
              });
              return { node, res };
            } finally {
              release();
              this.emitQueueStats(runId, queue);
            }
          }),
        );

        if (this.cancelledRuns.has(runId) || runSignal?.aborted) {
          this.cancelledRuns.delete(runId);
          return;
        }

        const nextTargets: string[] = [];
        for (let i = 0; i < results.length; i++) {
          const { node, res } = results[i];
          const { entry: logEntry, startedMs, inputSnapshot } = waveEntries[i];
          const stateDiff: Record<string, unknown> = {};
          if (res.outputKey) {
            if (inputSnapshot[res.outputKey] !== res.value) {
              stateDiff[res.outputKey] = res.value;
            }
            run.data[res.outputKey] = res.value;
          }
          Object.assign(logEntry, {
            status: "done",
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - startedMs,
            outputPreview: res.preview,
            branch: res.branch,
            renderedPrompt: res.renderedPrompt,
            stateDiff,
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
          const traversedEdges = res.branch
            ? outgoing.filter((e) => e.condition === res.branch)
            : outgoing.filter((e) => !e.condition);

          const middlewareTraces: string[] = [];
          const strictCompat = Boolean(run.graph.policy?.strictCompatibility);
          for (const edge of traversedEdges) {
            nextTargets.push(edge.target);
            const targetNode = nodeMap.get(edge.target);
            if (targetNode) {
              const mwResult = runEdgeMiddleware(
                edge,
                node,
                targetNode,
                run.data,
                res.outputKey,
                res.value,
                strictCompat,
              );
              Object.assign(run.data, mwResult.patch);
              middlewareTraces.push(mwResult.trace);
            }
          }

          if (middlewareTraces.length > 0) {
            logEntry.middlewareTraces = middlewareTraces;
          }
          if (node.type === "decision" && res.branch) {
            logEntry.decisionLog = {
              chosenBranch: res.branch,
              modelId: node.modelId || node.tier,
            };
          }
        }

        // Deduplicate next frontier so join nodes whose parallel predecessors finished in this wave execute once
        run.frontier = Array.from(new Set([...deferred, ...checkpoints, ...nextTargets]));
        run.activeNodeIds = [...run.frontier];
        run.currentNodeId = run.frontier[0] ?? null;
        this.store.saveRun(run);
      } catch (err) {
        if (this.cancelledRuns.has(runId) || runSignal?.aborted) {
          this.cancelledRuns.delete(runId);
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        for (const { entry, node, startedMs } of waveEntries) {
          if (entry.status === "running") {
            Object.assign(entry, {
              status: "failed",
              finishedAt: new Date().toISOString(),
              durationMs: Date.now() - startedMs,
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
