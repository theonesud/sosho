export type NodeKind = "agent" | "subagent" | "decision" | "tool" | "skill" | "checkpoint" | "memory";
export type ModelTier = "main" | "subagent" | "subagent-code" | "decision" | "local-uncensored";
export type QueueLane = "cloud-io" | "local-gpu" | "host-browser";
export type PortDataType = "text" | "json" | "number" | "boolean" | "markdown" | "audio" | "memory" | "any";
export type PortCompatibility = "compatible" | "cast" | "incompatible";
export type EdgeMiddlewareStage = "validate" | "map" | "cast" | "redact" | "trace" | "deliver";

export interface NodePort {
  id: string;
  name: string;
  type: PortDataType;
  required?: boolean;
  description?: string;
}

export interface OutputVisibility {
  previewLength?: number;
  includeInFinalOutput?: boolean;
  redact?: boolean;
}

export interface EdgeMiddlewareConfig {
  stages?: EdgeMiddlewareStage[];
  sourcePort?: string;
  targetPort?: string;
  fieldMapping?: Record<string, string>;
  castTo?: PortDataType;
  redactPatterns?: string[];
  strict?: boolean;
}

export interface GraphPolicy {
  memoryRecallBefore?: "off" | "entry" | "decision" | "all";
  saveRunSummary?: boolean;
  autoCheckpointBefore?: Array<"gpu" | "yue2" | "tool">;
  strictCompatibility?: boolean;
}

export interface NodeUiFlags {
  bypass?: boolean;
  locked?: boolean;
  solo?: boolean;
  outputExpanded?: boolean;
  wide?: boolean;
}

export interface ZipTie {
  id: string;
  position: { x: number; y: number };
  edgeIds: string[];
  label?: string;
}

export const PORT_TYPE_COLOR: Record<PortDataType, string> = {
  text: "#38bdf8",
  markdown: "#38bdf8",
  json: "#a78bfa",
  number: "#38bdf8",
  boolean: "#fb7185",
  audio: "#10b981",
  memory: "#f59e0b",
  any: "#a1a1aa",
};

export interface RawGraphNode {
  id: string;
  type: NodeKind;
  label: string;
  position?: { x: number; y: number };
  queue?: QueueLane;
  retryMaxAttempts?: number;
  timeoutSeconds?: number;
  modelId?: string;
  inputType?: PortDataType;
  inputs?: NodePort[];
  outputs?: NodePort[];
  outputVisibility?: OutputVisibility;
  isOutput?: boolean;
  uiFlags?: NodeUiFlags;
  [key: string]: unknown;
}

export interface RawGraphEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
  middleware?: EdgeMiddlewareConfig;
}

export interface RawGraph {
  id: string;
  name: string;
  description?: string;
  version: number;
  entryNode: string;
  maxSteps: number;
  policy?: GraphPolicy;
  nodes: RawGraphNode[];
  edges: RawGraphEdge[];
  zipTies?: ZipTie[];
}

export interface WorkflowVersion {
  versionId: string;
  graphId: string;
  label: string;
  graph: RawGraph;
  createdAt: string;
}

export interface ModelCatalogEntry {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  tags: string[];
}

export interface WorkflowSummary {
  file: string;
  id: string;
  name: string;
  description?: string;
}

export interface NodeExecutionLog {
  step: number;
  nodeId: string;
  type: NodeKind;
  status: "running" | "waiting_checkpoint" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  outputPreview?: string;
  renderedPrompt?: string;
  traceUrl?: string;
  branch?: string;
  error?: string;
  middlewareTraces?: string[];
  memoryRecall?: {
    query: string;
    count: number;
    preview?: string;
  };
  decisionLog?: {
    chosenBranch: string;
    modelId?: string;
    reason?: string;
  };
}

export interface PausedCheckpoint {
  nodeId: string;
  message?: string;
  allowStateEdit?: boolean;
  synthetic?: boolean;
}

export interface RunSummary {
  runId: string;
  graphId: string;
  status: "running" | "waiting_checkpoint" | "completed" | "failed" | "cancelled";
  currentNodeId: string | null;
  activeNodeIds?: string[];
  stepCount: number;
  pausedCheckpoint?: PausedCheckpoint | null;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RunDetail extends RunSummary {
  graph?: RawGraph;
  data: Record<string, unknown>;
  history: NodeExecutionLog[];
}

export interface ServiceStatus {
  id: string;
  name: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  url: string;
  detail: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

export interface SystemStatusResponse {
  services: ServiceStatus[];
  roles: Record<string, { provider: string; model: string; description?: string }>;
  modelCatalog?: ModelCatalogEntry[];
  skills: Array<string | SkillInfo>;
}

export interface QueueLaneStat {
  active: number;
  queued: number;
}

export interface QueueStats {
  "cloud-io": QueueLaneStat;
  "local-gpu": QueueLaneStat;
  "host-browser": QueueLaneStat;
}

export interface GpuState {
  available: boolean;
  owner?: string;
  gpus: Array<{
    name: string;
    memoryUsedMb: number;
    memoryTotalMb: number;
    utilizationPct: number;
    temperatureC: number;
  }>;
}

export interface MemoryItem {
  id: string;
  scope: "global" | "project";
  type: "semantic" | "procedural" | "episodic" | "entity";
  title: string;
  content: string;
  tags?: string[];
  entities?: string[];
  importance?: number;
  access_count?: number;
  valid_from?: string;
  score?: number;
}

export interface MusicJob {
  id: string;
  status: string;
  stage?: string;
  created_at?: number;
  finished_at?: number;
  error?: string;
  request?: { style?: string; lyrics?: string; seed?: number; cot?: string };
  artifacts?: {
    audio?: { url: string; bytes?: number; format?: string };
    score?: { url: string; format?: string };
  };
}

export const NODE_META: Record<NodeKind, { color: string; badge: string; hint: string }> = {
  agent: { color: "#6366f1", badge: "AGENT", hint: "Primary LLM reasoning step" },
  subagent: { color: "#8b5cf6", badge: "SUBAGENT", hint: "Specialized worker (optional skills)" },
  decision: { color: "#f59e0b", badge: "DECISION", hint: "Fast router picking one branch" },
  tool: { color: "#10b981", badge: "TOOL", hint: "Shell, HTTP, or YuE2 job" },
  skill: { color: "#0ea5e9", badge: "SKILL", hint: "Tool-enabled pi --print skill" },
  checkpoint: { color: "#f97316", badge: "CHECKPOINT", hint: "Pause for human approval" },
  memory: { color: "#ec4899", badge: "MEMORY", hint: "Search, save, or consolidate" },
};

export const MODEL_TIERS: ModelTier[] = ["main", "subagent", "subagent-code", "decision", "local-uncensored"];

export const QUEUE_LANES: QueueLane[] = ["cloud-io", "local-gpu", "host-browser"];

export const WORKFLOW_TEMPLATES: Record<string, RawGraph> = {
  "parallel-compare": {
    id: "parallel-compare",
    name: "Parallel Multi-Agent Synthesis",
    description: "Fans out to two subagents in parallel, joins both results, and synthesizes a final report.",
    version: 1,
    entryNode: "seed",
    maxSteps: 15,
    nodes: [
      {
        id: "seed",
        type: "memory",
        label: "Recall Context",
        position: { x: 40, y: 150 },
        operation: "search",
        scope: "both",
        queryOrTitleTemplate: "{{topic}}",
        outputKey: "context",
      },
      {
        id: "pros_agent",
        type: "subagent",
        label: "Strengths Analyst",
        role: "Strengths Analyst",
        tier: "subagent",
        position: { x: 320, y: 40 },
        promptTemplate: "List the top technical strengths and opportunities for: {{topic}}\nContext: {{context}}",
        outputKey: "pros",
      },
      {
        id: "risks_agent",
        type: "subagent",
        label: "Risks Analyst",
        role: "Risks Analyst",
        tier: "subagent",
        position: { x: 320, y: 260 },
        promptTemplate: "List the key risks and failure modes for: {{topic}}\nContext: {{context}}",
        outputKey: "risks",
      },
      {
        id: "synthesize",
        type: "agent",
        label: "Final Executive Brief",
        tier: "main",
        position: { x: 640, y: 150 },
        promptTemplate:
          "Combine both analyses into one clear recommendation on {{topic}}.\n\nStrengths:\n{{pros}}\n\nRisks:\n{{risks}}",
        outputKey: "final_brief",
      },
    ],
    edges: [
      { id: "e1", source: "seed", target: "pros_agent" },
      { id: "e2", source: "seed", target: "risks_agent" },
      { id: "e3", source: "pros_agent", target: "synthesize" },
      { id: "e4", source: "risks_agent", target: "synthesize" },
    ],
  },
  "memory-maintenance": {
    id: "memory-maintenance",
    name: "Memory Inbox Consolidation",
    description: "Drains session inbox events into episodic memory and refreshes core profiles.",
    version: 1,
    entryNode: "consolidate_all",
    maxSteps: 5,
    nodes: [
      {
        id: "consolidate_all",
        type: "memory",
        label: "Consolidate Both Scopes",
        position: { x: 140, y: 140 },
        operation: "consolidate",
        scope: "both",
        outputKey: "consolidated",
      },
    ],
    edges: [],
  },
};

export function extractTemplateVariables(graph: RawGraph | null): string[] {
  if (!graph) return [];
  const produced = new Set<string>();
  const referenced = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_-]+)/g;

  for (const n of graph.nodes) {
    if (typeof n.outputKey === "string" && n.outputKey.trim()) {
      produced.add(n.outputKey.trim());
    }
  }
  for (const n of graph.nodes) {
    for (const key of ["promptTemplate", "queryOrTitleTemplate", "contentTemplate", "commandOrUrl", "bodyTemplate"]) {
      const val = n[key];
      if (typeof val !== "string") continue;
      re.lastIndex = 0;
      let m: RegExpExecArray | null = re.exec(val);
      while (m !== null) {
        if (!produced.has(m[1])) referenced.add(m[1]);
        m = re.exec(val);
      }
    }
  }
  return Array.from(referenced);
}

export function formatLatency(startedAt?: string, finishedAt?: string): string | null {
  if (!startedAt || !finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const PORT_DATA_TYPES: PortDataType[] = [
  "text",
  "markdown",
  "json",
  "number",
  "boolean",
  "memory",
  "audio",
  "any",
];

export const MIDDLEWARE_STAGES: EdgeMiddlewareStage[] = ["validate", "map", "cast", "redact", "trace", "deliver"];

export const BRANCH_COLORS = ["#10b981", "#f59e0b", "#38bdf8", "#ec4899", "#8b5cf6", "#f97316"];

export function deriveNodePorts(node: RawGraphNode): { inputs: NodePort[]; outputs: NodePort[] } {
  if (node.inputs?.length && node.outputs?.length) {
    return { inputs: node.inputs, outputs: node.outputs };
  }
  const inputType = node.inputType ?? "any";
  const outputKey = typeof node.outputKey === "string" && node.outputKey ? node.outputKey : "output";
  let defaultInputs: NodePort[];
  let defaultOutputs: NodePort[];

  switch (node.type) {
    case "agent":
    case "subagent":
    case "skill":
      defaultInputs = [{ id: "in", name: "input", type: inputType === "any" ? "text" : inputType }];
      defaultOutputs = [{ id: outputKey, name: outputKey, type: "markdown" }];
      break;
    case "decision": {
      const branches = Array.isArray(node.branches) ? (node.branches as string[]) : ["yes", "no"];
      defaultInputs = [{ id: "in", name: "context", type: inputType }];
      defaultOutputs = branches.map((b) => ({ id: b, name: b, type: "text" }));
      break;
    }
    case "tool":
      defaultInputs = [{ id: "in", name: "args", type: inputType }];
      defaultOutputs = [{ id: outputKey, name: outputKey, type: node.toolKind === "yue2" ? "audio" : "text" }];
      break;
    case "memory":
      defaultInputs = [{ id: "in", name: "query", type: inputType === "any" ? "text" : inputType }];
      defaultOutputs = [{ id: outputKey, name: outputKey, type: "memory" }];
      break;
    case "checkpoint":
      defaultInputs = [{ id: "in", name: "state", type: "any" }];
      defaultOutputs = [
        { id: "approve", name: "approve", type: "any" },
        { id: "reject", name: "reject", type: "any" },
      ];
      break;
  }

  return {
    inputs: node.inputs?.length ? node.inputs : defaultInputs,
    outputs: node.outputs?.length ? node.outputs : defaultOutputs,
  };
}

const CASTABLE_CLIENT: Record<PortDataType, PortDataType[]> = {
  any: ["text", "json", "number", "boolean", "markdown", "audio", "memory", "any"],
  text: ["markdown", "json", "any"],
  markdown: ["text", "any"],
  json: ["text", "markdown", "any"],
  number: ["text", "json", "any"],
  boolean: ["text", "json", "any"],
  memory: ["text", "json", "markdown", "any"],
  audio: ["any"],
};

export function checkNodeCompatibility(
  src: RawGraphNode,
  tgt: RawGraphNode,
  edge?: RawGraphEdge,
  strict = false,
): PortCompatibility {
  const srcPorts = deriveNodePorts(src).outputs;
  const tgtPorts = deriveNodePorts(tgt).inputs;
  const srcPort =
    (edge?.middleware?.sourcePort ? srcPorts.find((p) => p.id === edge.middleware?.sourcePort) : undefined) ??
    srcPorts[0];
  const tgtPort =
    (edge?.middleware?.targetPort ? tgtPorts.find((p) => p.id === edge.middleware?.targetPort) : undefined) ??
    tgtPorts[0];
  if (!srcPort || !tgtPort) return "compatible";
  if (srcPort.type === tgtPort.type || srcPort.type === "any" || tgtPort.type === "any") return "compatible";
  if (!strict && CASTABLE_CLIENT[srcPort.type]?.includes(tgtPort.type)) return "cast";
  return "incompatible";
}

export interface GraphValidationIssue {
  id: string;
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export function validateGraphIssues(graph: RawGraph | null): GraphValidationIssue[] {
  if (!graph) return [];
  const issues: GraphValidationIssue[] = [];
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const strict = Boolean(graph.policy?.strictCompatibility);

  if (graph.nodes.length === 0) {
    issues.push({ id: "empty", severity: "warning", message: "Workflow has no nodes yet." });
    return issues;
  }

  if (!graph.entryNode || !nodeMap.has(graph.entryNode)) {
    issues.push({ id: "missing-entry", severity: "error", message: "Missing valid entry node." });
  }

  const connected = new Set<string>();
  for (const e of graph.edges) {
    connected.add(e.source);
    connected.add(e.target);
    const src = nodeMap.get(e.source);
    const tgt = nodeMap.get(e.target);
    if (!src || !tgt) {
      issues.push({
        id: `dangling-${e.id}`,
        severity: "error",
        message: `Edge ${e.id} references missing node.`,
        edgeId: e.id,
      });
      continue;
    }
    const compat = checkNodeCompatibility(src, tgt, e, strict);
    if (compat === "incompatible") {
      issues.push({
        id: `compat-${e.id}`,
        severity: strict ? "error" : "warning",
        message: `Incompatible types: ${src.label} → ${tgt.label}`,
        edgeId: e.id,
      });
    }
  }

  if (graph.nodes.length > 1) {
    for (const n of graph.nodes) {
      if (!connected.has(n.id)) {
        issues.push({
          id: `orphan-${n.id}`,
          severity: "warning",
          message: `Node "${n.label}" is disconnected.`,
          nodeId: n.id,
        });
      }
    }
  }

  return issues;
}
