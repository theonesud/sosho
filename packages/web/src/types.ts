export const runStatuses = [
  "pending",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof runStatuses)[number];

export const nodeKinds = [
  "trigger",
  "llm",
  "agent",
  "skill",
  "tool",
  "router",
  "map",
  "join",
  "human",
  "subworkflow",
  "wait",
] as const;
export type NodeKind = (typeof nodeKinds)[number];

export interface GraphNode {
  readonly id: string;
  readonly name: string;
  readonly kind: NodeKind;
  readonly status: RunStatus;
}

export interface GraphEdge {
  readonly source: string;
  readonly target: string;
  readonly when?: string;
  readonly loop?: { readonly maxIterations: number };
}

export interface RunRow {
  readonly id: string;
  readonly workflow: string;
  readonly status: RunStatus;
  readonly startedAt: string;
  readonly durationSeconds: number;
  readonly trigger: string;
}

export interface RunEvent {
  readonly id: string;
  readonly time: string;
  readonly title: string;
  readonly description: string;
  readonly status: RunStatus;
}
