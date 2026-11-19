import { z } from "zod";

export const ModelTierSchema = z.enum([
  "main",
  "subagent",
  "subagent-code",
  "decision",
  "local-uncensored",
]);

export const TaskQueueSchema = z.enum(["cloud-io", "local-gpu", "host-browser"]);

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const BaseNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  position: PositionSchema.optional(),
  queue: TaskQueueSchema.optional(),
  retryMaxAttempts: z.number().int().min(1).max(10).optional(),
  timeoutSeconds: z.number().int().min(5).max(3600).optional(),
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

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  condition: z.string().optional(), // Matches DecisionNode branch name or "approved" / "rejected" for CheckpointNode
});

export const GraphDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.number().int().min(1).default(1),
  entryNode: z.string().min(1),
  maxSteps: z.number().int().min(1).max(200).default(50),
  nodes: z.array(GraphNodeSchema).min(1),
  edges: z.array(GraphEdgeSchema),
});

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
}

export interface WorkflowRunState {
  runId: string;
  graphId: string;
  status: "running" | "waiting_checkpoint" | "completed" | "failed";
  currentNodeId: string | null;
  stepCount: number;
  data: Record<string, unknown>;
  history: NodeExecutionLog[];
}
