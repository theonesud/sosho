import { z } from "zod";

export const ModelTierSchema = z.enum([
  "main",
  "subagent",
  "subagent-code",
  "decision",
  "local-uncensored",
]);

export const TaskQueueSchema = z.enum(["cloud-io", "local-gpu", "host-browser"]);

export const PortDataTypeSchema = z.enum(["text", "json", "number", "boolean", "markdown", "audio", "memory", "any"]);

export const NodePortSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: PortDataTypeSchema.default("any"),
  required: z.boolean().optional(),
  description: z.string().optional(),
});

export const OutputVisibilitySchema = z.object({
  previewLength: z.number().int().min(40).max(10000).optional(),
  includeInFinalOutput: z.boolean().optional(),
  redact: z.boolean().optional(),
});

export const EdgeMiddlewareStageSchema = z.enum(["validate", "map", "cast", "redact", "trace", "deliver"]);

export const DEFAULT_MIDDLEWARE_STAGES: ReadonlyArray<z.infer<typeof EdgeMiddlewareStageSchema>> = [
  "validate",
  "map",
  "cast",
  "redact",
  "trace",
  "deliver",
];

export const EdgeMiddlewareConfigSchema = z.object({
  stages: z.array(EdgeMiddlewareStageSchema).optional(),
  sourcePort: z.string().optional(),
  targetPort: z.string().optional(),
  fieldMapping: z.record(z.string(), z.string()).optional(),
  castTo: PortDataTypeSchema.optional(),
  redactPatterns: z.array(z.string()).optional(),
  strict: z.boolean().optional(),
});

export const GraphPolicySchema = z.object({
  memoryRecallBefore: z.enum(["off", "entry", "decision", "all"]).default("decision"),
  saveRunSummary: z.boolean().default(true),
  autoCheckpointBefore: z.array(z.enum(["gpu", "yue2", "tool"])).default([]),
  strictCompatibility: z.boolean().default(false),
});

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const NodeUiFlagsSchema = z.object({
  bypass: z.boolean().optional(),
  locked: z.boolean().optional(),
  solo: z.boolean().optional(),
  outputExpanded: z.boolean().optional(),
  wide: z.boolean().optional(),
});

export const ZipTieSchema = z.object({
  id: z.string().min(1),
  position: PositionSchema,
  edgeIds: z.array(z.string()).default([]),
  label: z.string().optional(),
});

const BaseNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  position: PositionSchema.optional(),
  queue: TaskQueueSchema.optional(),
  retryMaxAttempts: z.number().int().min(1).max(10).optional(),
  timeoutSeconds: z.number().int().min(5).max(3600).optional(),
  modelId: z.string().optional(),
  inputType: PortDataTypeSchema.optional(),
  inputs: z.array(NodePortSchema).optional(),
  outputs: z.array(NodePortSchema).optional(),
  outputVisibility: OutputVisibilitySchema.optional(),
  isOutput: z.boolean().optional(),
  uiFlags: NodeUiFlagsSchema.optional(),
});

export const AgentNodeSchema = BaseNodeSchema.extend({
  type: z.literal("agent"),
  tier: ModelTierSchema.default("main"),
  systemPrompt: z.string().optional(),
  promptTemplate: z.string().min(1),
  outputKey: z.string().default("last_output"),
});

export const SubagentNodeSchema = BaseNodeSchema.extend({
  type: z.literal("subagent"),
  role: z.string().min(1),
  tier: ModelTierSchema.default("subagent"),
  promptTemplate: z.string().min(1),
  skills: z.array(z.string()).optional(),
  outputKey: z.string().default("subagent_output"),
});

export const DecisionNodeSchema = BaseNodeSchema.extend({
  type: z.literal("decision"),
  tier: ModelTierSchema.default("decision"),
  promptTemplate: z.string().min(1),
  branches: z.array(z.string().min(1)).min(1),
  outputKey: z.string().default("decision"),
});

export const ToolNodeSchema = BaseNodeSchema.extend({
  type: z.literal("tool"),
  toolKind: z.enum(["shell", "http", "yue2"]),
  commandOrUrl: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT"]).optional(),
  bodyTemplate: z.string().optional(),
  outputKey: z.string().default("tool_output"),
});

export const SkillNodeSchema = BaseNodeSchema.extend({
  type: z.literal("skill"),
  skillName: z.string().min(1),
  tier: ModelTierSchema.default("subagent"),
  promptTemplate: z.string().min(1),
  outputKey: z.string().default("skill_output"),
});

export const CheckpointNodeSchema = BaseNodeSchema.extend({
  type: z.literal("checkpoint"),
  message: z.string().min(1),
  allowStateEdit: z.boolean().default(true),
});

export const MemoryNodeSchema = BaseNodeSchema.extend({
  type: z.literal("memory"),
  operation: z.enum(["search", "save", "consolidate"]),
  scope: z.enum(["global", "project", "both"]).default("both"),
  queryOrTitleTemplate: z.string().optional(),
  contentTemplate: z.string().optional(),
  memoryType: z.enum(["semantic", "procedural", "episodic", "entity"]).optional(),
  outputKey: z.string().default("memory_result"),
});

export const GraphNodeSchema = z.discriminatedUnion("type", [
  AgentNodeSchema,
  SubagentNodeSchema,
  DecisionNodeSchema,
  ToolNodeSchema,
  SkillNodeSchema,
  CheckpointNodeSchema,
  MemoryNodeSchema,
]);

export const CHECKPOINT_ACTIONS = ["approve", "reject"] as const;
export const MAX_STEPS_EXCEEDED_ERROR = "max_steps_exceeded";

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  condition: z.string().optional(), // Matches DecisionNode branch name or "approve" / "reject" for CheckpointNode
  middleware: EdgeMiddlewareConfigSchema.optional(),
});

export const GraphDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.number().int().min(1).default(1),
  entryNode: z.string().min(1),
  maxSteps: z.number().int().min(1).max(200).default(50),
  policy: GraphPolicySchema.optional(),
  nodes: z.array(GraphNodeSchema).min(1),
  edges: z.array(GraphEdgeSchema),
  zipTies: z.array(ZipTieSchema).optional(),
});

export type PortDataType = z.infer<typeof PortDataTypeSchema>;
export type NodePort = z.infer<typeof NodePortSchema>;
export type OutputVisibility = z.infer<typeof OutputVisibilitySchema>;
export type NodeUiFlags = z.infer<typeof NodeUiFlagsSchema>;
export type ZipTie = z.infer<typeof ZipTieSchema>;
export type EdgeMiddlewareStage = z.infer<typeof EdgeMiddlewareStageSchema>;
export type EdgeMiddlewareConfig = z.infer<typeof EdgeMiddlewareConfigSchema>;
export type GraphPolicy = z.infer<typeof GraphPolicySchema>;
export type GraphDefinition = z.infer<typeof GraphDefinitionSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type ModelTier = z.infer<typeof ModelTierSchema>;
export type TaskQueue = z.infer<typeof TaskQueueSchema>;

export interface CheckpointDecisionSignal {
  nodeId: string;
  action: "approve" | "reject";
  statePatch?: Record<string, unknown>;
  note?: string;
}

export interface NodeExecutionLog {
  step: number;
  nodeId: string;
  type: GraphNode["type"];
  status: "running" | "waiting_checkpoint" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  outputPreview?: string;
  branch?: string;
  error?: string;
  renderedPrompt?: string;
  inputSnapshot?: Record<string, unknown>;
  stateDiff?: Record<string, unknown>;
  queue?: TaskQueue;
  durationMs?: number;
  traceId?: string;
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

export type StepExecutionRecord = NodeExecutionLog;

export interface WorkflowRunState {
  runId: string;
  graphId: string;
  status: "running" | "waiting_checkpoint" | "completed" | "failed" | "cancelled";
  currentNodeId: string | null;
  activeNodeIds?: string[];
  stepCount: number;
  data: Record<string, unknown>;
  history: NodeExecutionLog[];
  error?: string;
}

export class GraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphValidationError";
  }
}

export function validateGraph(raw: unknown): GraphDefinition {
  const parsed = GraphDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
    throw new GraphValidationError(`Invalid workflow schema: ${details}`);
  }

  const graph = parsed.data;
  const nodeMap = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    if (nodeMap.has(node.id)) {
      throw new GraphValidationError(`Duplicate node id: '${node.id}'`);
    }
    nodeMap.set(node.id, node);
  }

  if (!nodeMap.has(graph.entryNode)) {
    throw new GraphValidationError(`entryNode '${graph.entryNode}' does not exist in nodes`);
  }

  for (const edge of graph.edges) {
    const src = nodeMap.get(edge.source);
    if (!src) {
      throw new GraphValidationError(`Edge '${edge.id}' references unknown source node '${edge.source}'`);
    }
    if (!nodeMap.has(edge.target)) {
      throw new GraphValidationError(`Edge '${edge.id}' references unknown target node '${edge.target}'`);
    }
    if (edge.condition !== undefined && edge.condition.trim() !== "") {
      const cond = edge.condition.trim();
      if (src.type === "decision") {
        if (!src.branches.includes(cond)) {
          throw new GraphValidationError(
            `Edge '${edge.id}' condition '${cond}' is not in decision node '${src.id}' branches [${src.branches.join(", ")}]`,
          );
        }
      } else if (src.type === "checkpoint") {
        if (cond !== "approve" && cond !== "reject") {
          throw new GraphValidationError(
            `Edge '${edge.id}' condition '${cond}' on checkpoint '${src.id}' must be 'approve' or 'reject'`,
          );
        }
      } else {
        throw new GraphValidationError(
          `Edge '${edge.id}' defines condition '${cond}' on non-branching node '${src.id}' (type: ${src.type})`,
        );
      }
    }

    if (graph.policy?.strictCompatibility) {
      const tgt = nodeMap.get(edge.target);
      if (tgt) {
        const srcPorts = src.outputs?.length ? src.outputs : deriveDefaultPorts(src).outputs;
        const tgtPorts = tgt.inputs?.length ? tgt.inputs : deriveDefaultPorts(tgt).inputs;
        const srcPort =
          (edge.middleware?.sourcePort ? srcPorts.find((p) => p.id === edge.middleware?.sourcePort) : undefined) ??
          srcPorts[0];
        const tgtPort =
          (edge.middleware?.targetPort ? tgtPorts.find((p) => p.id === edge.middleware?.targetPort) : undefined) ??
          tgtPorts[0];
        if (srcPort && tgtPort) {
          const compat = checkPortCompatibility(srcPort.type, tgtPort.type, true);
          if (compat === "incompatible") {
            throw new GraphValidationError(
              `Edge '${edge.id}' connects incompatible ports (${src.id}:${srcPort.type} -> ${tgt.id}:${tgtPort.type}) in strict mode`,
            );
          }
        }
      }
    }
  }

  return graph;
}

export function deriveDefaultPorts(node: Pick<GraphNode, "type"> & Record<string, unknown>): {
  inputs: NodePort[];
  outputs: NodePort[];
} {
  const inputType = (node.inputType as PortDataType | undefined) ?? "any";
  const outputKey = typeof node.outputKey === "string" && node.outputKey ? node.outputKey : "output";

  switch (node.type) {
    case "agent":
    case "subagent":
    case "skill":
      return {
        inputs: [{ id: "in", name: "input", type: inputType === "any" ? "text" : inputType, required: false }],
        outputs: [{ id: outputKey, name: outputKey, type: "markdown" }],
      };
    case "decision": {
      const branches = Array.isArray(node.branches) ? (node.branches as string[]) : ["yes", "no"];
      return {
        inputs: [{ id: "in", name: "context", type: inputType }],
        outputs: branches.map((b) => ({ id: b, name: b, type: "text" as const })),
      };
    }
    case "tool": {
      const outType: PortDataType = node.toolKind === "yue2" ? "audio" : "text";
      return {
        inputs: [{ id: "in", name: "args", type: inputType }],
        outputs: [{ id: outputKey, name: outputKey, type: outType }],
      };
    }
    case "memory":
      return {
        inputs: [{ id: "in", name: "query", type: inputType === "any" ? "text" : inputType }],
        outputs: [{ id: outputKey, name: outputKey, type: "memory" }],
      };
    case "checkpoint":
      return {
        inputs: [{ id: "in", name: "state", type: "any" }],
        outputs: [
          { id: "approve", name: "approve", type: "any" },
          { id: "reject", name: "reject", type: "any" },
        ],
      };
    default:
      return {
        inputs: [{ id: "in", name: "input", type: inputType }],
        outputs: [{ id: outputKey, name: outputKey, type: "any" }],
      };
  }
}

export type PortCompatibility = "compatible" | "cast" | "incompatible";

const CASTABLE_TYPES: Record<PortDataType, PortDataType[]> = {
  any: ["text", "json", "number", "boolean", "markdown", "audio", "memory", "any"],
  text: ["markdown", "json", "any"],
  markdown: ["text", "any"],
  json: ["text", "markdown", "any"],
  number: ["text", "json", "any"],
  boolean: ["text", "json", "any"],
  memory: ["text", "json", "markdown", "any"],
  audio: ["any"],
};

export function checkPortCompatibility(
  sourceType: PortDataType,
  targetType: PortDataType,
  strict = false,
): PortCompatibility {
  if (sourceType === targetType || sourceType === "any" || targetType === "any") {
    return "compatible";
  }
  if (!strict && CASTABLE_TYPES[sourceType]?.includes(targetType)) {
    return "cast";
  }
  return "incompatible";
}
