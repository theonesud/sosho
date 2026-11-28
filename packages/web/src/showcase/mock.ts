import type { JsonValue } from "../components/json-viewer";
import type { GraphEdge, GraphNode, NodeKind, RunEvent, RunRow, RunStatus } from "../types";

export const workflowNodes: readonly GraphNode[] = [
  { id: "trigger", name: "Daily 07:00", kind: "trigger", status: "succeeded" },
  { id: "gather", name: "Gather sources", kind: "agent", status: "succeeded" },
  { id: "each", name: "Each source", kind: "map", status: "succeeded" },
  { id: "summarize", name: "Summarize", kind: "llm", status: "succeeded" },
  { id: "merge", name: "Merge notes", kind: "join", status: "succeeded" },
  { id: "gate", name: "Quality gate", kind: "router", status: "running" },
  { id: "review", name: "Editor review", kind: "human", status: "waiting" },
  { id: "rewrite", name: "Rewrite draft", kind: "llm", status: "pending" },
  { id: "publish", name: "Publish digest", kind: "tool", status: "pending" },
  { id: "archive", name: "Archive run", kind: "subworkflow", status: "pending" },
];

export const workflowEdges: readonly GraphEdge[] = [
  { source: "trigger", target: "gather" },
  { source: "gather", target: "each" },
  { source: "each", target: "summarize" },
  { source: "summarize", target: "merge" },
  { source: "merge", target: "gate" },
  { source: "gate", target: "publish", when: "score >= 0.8" },
  { source: "gate", target: "review", when: "score < 0.8" },
  { source: "review", target: "rewrite" },
  { source: "rewrite", target: "gate", loop: { maxIterations: 3 } },
  { source: "publish", target: "archive" },
];

export const workflowCards: readonly {
  name: string;
  description: string;
  version: number;
  nodeCount: number;
  kinds: readonly NodeKind[];
  lastRun: { status: RunStatus; when: string };
}[] = [
  {
    name: "Daily digest",
    description: "Collects sources each morning and publishes a reviewed summary.",
    version: 12,
    nodeCount: 10,
    kinds: ["trigger", "agent", "llm", "human"],
    lastRun: { status: "waiting", when: "12 min ago" },
  },
  {
    name: "Invoice intake",
    description: "Reads new invoices from a webhook and routes them by amount.",
    version: 4,
    nodeCount: 7,
    kinds: ["trigger", "tool", "router"],
    lastRun: { status: "succeeded", when: "2 h ago" },
  },
  {
    name: "Support triage",
    description: "Classifies inbound tickets and drafts first replies.",
    version: 9,
    nodeCount: 14,
    kinds: ["trigger", "llm", "skill", "map"],
    lastRun: { status: "failed", when: "yesterday" },
  },
];

export const stats: readonly {
  label: string;
  value: string;
  detail: string;
  icon: "run" | "inbox" | "clock" | "workflow";
}[] = [
  { label: "Runs today", value: "128", detail: "12 more than yesterday", icon: "run" },
  { label: "Waiting for input", value: "3", detail: "Oldest waits 14 min", icon: "inbox" },
  { label: "Median duration", value: "42 s", detail: "Across 7 days", icon: "clock" },
  { label: "Active workflows", value: "9", detail: "2 are paused", icon: "workflow" },
];

export const refreshedStatValues: readonly string[] = ["136", "2", "38 s", "9"];

export const runRows: readonly RunRow[] = [
  {
    id: "run_8f3a21",
    workflow: "Daily digest",
    status: "waiting",
    startedAt: "07:00",
    durationSeconds: 312,
    trigger: "cron",
  },
  {
    id: "run_8f39c0",
    workflow: "Invoice intake",
    status: "succeeded",
    startedAt: "06:48",
    durationSeconds: 18,
    trigger: "webhook",
  },
  {
    id: "run_8f3877",
    workflow: "Support triage",
    status: "failed",
    startedAt: "06:31",
    durationSeconds: 54,
    trigger: "webhook",
  },
  {
    id: "run_8f3702",
    workflow: "Daily digest",
    status: "running",
    startedAt: "06:30",
    durationSeconds: 97,
    trigger: "manual",
  },
  {
    id: "run_8f3655",
    workflow: "Support triage",
    status: "cancelled",
    startedAt: "06:12",
    durationSeconds: 9,
    trigger: "webhook",
  },
  {
    id: "run_8f35e4",
    workflow: "Invoice intake",
    status: "pending",
    startedAt: "06:10",
    durationSeconds: 0,
    trigger: "webhook",
  },
];

export const runEvents: readonly RunEvent[] = [
  {
    id: "e1",
    time: "07:00:01",
    title: "Run started",
    description: "Trigger fired by schedule 0 7 * * *.",
    status: "succeeded",
  },
  {
    id: "e2",
    time: "07:00:09",
    title: "Gather sources",
    description: "Agent returned 6 documents.",
    status: "succeeded",
  },
  {
    id: "e3",
    time: "07:01:44",
    title: "Summarize",
    description: "6 of 6 items finished.",
    status: "succeeded",
  },
  {
    id: "e4",
    time: "07:02:10",
    title: "Quality gate",
    description: "Score 0.62 is below 0.8. Route to review.",
    status: "running",
  },
  {
    id: "e5",
    time: "07:02:11",
    title: "Editor review",
    description: "Waiting for a human decision.",
    status: "waiting",
  },
];

export const nodeInput: JsonValue = {
  documents: [{ id: "doc_41", title: "Release notes", tokens: 812 }],
  tone: "neutral",
  maxWords: 120,
  includeLinks: true,
};

export const nodeOutput: JsonValue = {
  summary: "Three fixes shipped. One breaking change in the export API.",
  score: 0.62,
  citations: ["doc_41", "doc_44"],
  reviewer: null,
};

export const versionTree: readonly {
  value: string;
  label: string;
  children?: readonly { value: string; label: string }[];
}[] = [
  {
    value: "v12",
    label: "v12 - current",
    children: [
      { value: "v12-1", label: "Add quality gate loop" },
      { value: "v12-2", label: "Raise review timeout" },
    ],
  },
  {
    value: "v11",
    label: "v11",
    children: [{ value: "v11-1", label: "Switch summary model" }],
  },
  { value: "v10", label: "v10" },
];
