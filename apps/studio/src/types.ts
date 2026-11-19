export type WorkspaceTab = "overview" | "workflows" | "memory" | "music";
export type NodeKind = "agent" | "subagent" | "decision" | "tool" | "skill" | "checkpoint" | "memory";
export type ModelTier = "main" | "subagent" | "subagent-code" | "decision" | "local-uncensored";

export interface RawGraphNode {
  id: string;
  type: NodeKind;
  label: string;
  position?: { x: number; y: number };
  [key: string]: unknown;
}

export interface RawGraphEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
}

export interface RawGraph {
  id: string;
  name: string;
  description?: string;
  version: number;
  entryNode: string;
  maxSteps: number;
  nodes: RawGraphNode[];
  edges: RawGraphEdge[];
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
  branch?: string;
  error?: string;
}

export interface PausedCheckpoint {
  nodeId: string;
  message?: string;
  allowStateEdit?: boolean;
}

export interface RunSummary {
  runId: string;
  graphId: string;
  status: "running" | "waiting_checkpoint" | "completed" | "failed" | "cancelled";
  currentNodeId: string | null;
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

export interface SystemStatusResponse {
  services: ServiceStatus[];
  roles: Record<string, { provider: string; model: string; description?: string }>;
  skills: string[];
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

export const WORKFLOW_TEMPLATES: Record<string, RawGraph> = {
  "parallel-compare": {
    id: "parallel-compare",
    name: "Parallel Multi-Agent Synthesis",
    description: "Fans out to two subagents in parallel, joins both results, and synthesizes a final report.",
    version: 1,
    entryNode: "pros_agent",
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
        promptTemplate: "Combine both analyses into one clear recommendation on {{topic}}.\n\nStrengths:\n{{pros}}\n\nRisks:\n{{risks}}",
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
WORKFLOW_TEMPLATES["parallel-compare"].entryNode = "seed";

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
      let m: RegExpExecArray | null;
      while ((m = re.exec(val)) !== null) {
        if (!produced.has(m[1])) referenced.add(m[1]);
      }
    }
  }
  return Array.from(referenced);
}
