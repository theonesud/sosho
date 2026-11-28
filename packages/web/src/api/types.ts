export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export const NODE_KINDS = [
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
export type NodeKind = (typeof NODE_KINDS)[number];

export type QueueName = "cloud-io" | "host-browser" | "host";
export type HumanAction = "approve" | "reject" | "input" | "edit";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface RetryPolicy {
  readonly max_attempts?: number;
  readonly interval_seconds?: number;
  readonly backoff_rate?: number;
}

interface NodeBase {
  readonly id: string;
  readonly name?: string | null;
  readonly queue?: QueueName | null;
  readonly retry?: RetryPolicy;
  readonly timeout_seconds?: number | null;
  readonly continue_on_error?: boolean;
}

export interface TriggerNode extends NodeBase {
  readonly kind: "trigger";
  readonly mode?: "manual" | "cron" | "webhook" | "workflow_finished";
  readonly cron?: string | null;
  readonly cron_timezone?: string | null;
  readonly source_workflow_id?: string | null;
  readonly on_status?: "succeeded" | "failed" | "any";
}

export interface LlmNode extends NodeBase {
  readonly kind: "llm";
  readonly role: string;
  readonly prompt: string;
  readonly system?: string | null;
  readonly temperature?: number | null;
  readonly max_tokens?: number | null;
  readonly json_output?: boolean;
  readonly thinking?: ThinkingLevel | null;
}

export interface AgentNode extends NodeBase {
  readonly kind: "agent";
  readonly role: string;
  readonly prompt: string;
  readonly instructions?: string | null;
  readonly skills?: readonly string[];
  readonly max_turns?: number;
  readonly thinking?: ThinkingLevel | null;
}

export interface SkillNode extends NodeBase {
  readonly kind: "skill";
  readonly skill: string;
  readonly task: string;
  readonly role: string;
  readonly max_turns?: number;
  readonly thinking?: ThinkingLevel | null;
}

export interface ToolNode extends NodeBase {
  readonly kind: "tool";
  readonly tool: string;
  readonly args?: JsonObject;
}

export type ConditionOp =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "contains"
  | "truthy"
  | "exists";

export interface Condition {
  readonly path: string;
  readonly op?: ConditionOp;
  readonly value?: JsonValue;
}

export interface Branch {
  readonly name: string;
  readonly when: Condition;
}

export interface RouterNode extends NodeBase {
  readonly kind: "router";
  readonly branches: readonly Branch[];
  readonly default?: string | null;
}

export interface MapNode extends NodeBase {
  readonly kind: "map";
  readonly items: string;
  readonly workflow_id: string;
  readonly version: number;
  readonly max_items?: number;
}

export interface JoinNode extends NodeBase {
  readonly kind: "join";
  readonly require_all?: boolean;
}

export interface HumanNode extends NodeBase {
  readonly kind: "human";
  readonly prompt: string;
  readonly actions?: readonly HumanAction[];
  readonly wait_seconds?: number;
  readonly default_action?: HumanAction;
  readonly default_value?: JsonValue;
  readonly show?: string | null;
}

export interface SubworkflowNode extends NodeBase {
  readonly kind: "subworkflow";
  readonly workflow_id: string;
  readonly version: number;
  readonly input?: JsonObject;
}

export interface WaitNode extends NodeBase {
  readonly kind: "wait";
  readonly seconds: number;
}

export type Node =
  | TriggerNode
  | LlmNode
  | AgentNode
  | SkillNode
  | ToolNode
  | RouterNode
  | MapNode
  | JoinNode
  | HumanNode
  | SubworkflowNode
  | WaitNode;

export interface Edge {
  readonly source: string;
  readonly target: string;
  readonly when?: string | null;
  readonly loop?: boolean;
  readonly max_iterations?: number | null;
  readonly on_limit?: "exit" | "fail";
}

export interface Policy {
  readonly allowed_kinds?: readonly NodeKind[] | null;
  readonly allowed_tools?: readonly string[] | null;
  readonly allowed_skills?: readonly string[] | null;
  readonly max_steps?: number;
  readonly max_run_seconds?: number;
  readonly max_llm_calls?: number;
  readonly max_depth?: number;
}

export interface WorkflowDraft {
  readonly name: string;
  readonly description?: string | null;
  readonly nodes: readonly Node[];
  readonly edges?: readonly Edge[];
  readonly entry: string;
  readonly policy?: Policy;
}

export interface Workflow extends WorkflowDraft {
  readonly id: string;
  readonly version: number;
}

export interface TriggerSchedule {
  readonly name: string;
  readonly cron: string;
  readonly timezone: string | null;
  readonly next_fire: string | null;
}

export interface TriggerWebhook {
  readonly node_id: string;
  readonly url: string;
  readonly token: string;
}

export interface TriggerFollower {
  readonly source_workflow_id: string;
  readonly on_status: string;
}

export interface TriggerInfo {
  readonly version: number | null;
  readonly schedules: readonly TriggerSchedule[];
  readonly webhooks: readonly TriggerWebhook[];
  readonly followers: readonly TriggerFollower[];
}

export interface WorkflowSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly latest_version: number | null;
  readonly created_at: string;
}

export interface VersionSummary {
  readonly version: number;
  readonly name: string;
  readonly created_at: string;
}

export interface KindEntry {
  readonly kind: string;
  readonly title: string;
  readonly description: string;
  readonly json_schema: JsonObject;
}

export interface ToolEntry {
  readonly name: string;
  readonly description: string;
  readonly side_effect: boolean;
  readonly json_schema: JsonObject;
}

export interface Catalog {
  readonly kinds: readonly KindEntry[];
  readonly tools: readonly ToolEntry[];
  readonly queues: { readonly [queue: string]: { readonly [limit: string]: number } };
  readonly skills: readonly string[];
  readonly pi_roles: readonly string[];
}

export interface Issue {
  readonly code: string;
  readonly message: string;
  readonly node: string | null;
  readonly field?: string;
}

export interface ValidateResponse {
  readonly valid: boolean;
  readonly issues: readonly Issue[];
}

export interface RunSummary {
  readonly run_id: string;
  readonly status: string;
  readonly dbos_status: string;
  readonly workflow_id: string | null;
  readonly version: number | null;
  readonly created_at: number | null;
  readonly updated_at: number | null;
  readonly app_version: string | null;
  readonly forked_from: string | null;
  readonly parent_run_id: string | null;
}

export interface StepSummary {
  readonly step: number;
  readonly name: string;
  readonly child_run_id: string | null;
  readonly error: string | null;
  readonly started_at: number | null;
  readonly completed_at: number | null;
  readonly output: JsonValue;
}

export interface PendingHuman {
  readonly node_id: string;
  readonly run_id: string;
  readonly prompt: string;
  readonly show: string | null;
  readonly actions: readonly HumanAction[];
  readonly wait_seconds: number;
}

export interface RunDetail {
  readonly summary: RunSummary;
  readonly output: JsonValue;
  readonly error: string | null;
  readonly progress: JsonValue;
  readonly pending_human: readonly PendingHuman[];
  readonly steps: readonly StepSummary[];
}

export interface InputRequest {
  readonly node_id: string;
  readonly reply: { readonly action: HumanAction; readonly value?: JsonValue };
}

export interface StartRequest {
  readonly version?: number | null;
  readonly input?: JsonObject;
  readonly trigger_node?: string | null;
}

export interface RunRef {
  readonly run_id: string;
}

export interface RunStartedEvent {
  readonly seq: number;
  readonly type: "run_started";
  readonly workflow_id: string;
  readonly version: number;
}

export interface NodeStartedEvent {
  readonly seq: number;
  readonly type: "node_started";
  readonly node: string;
}

export interface NodeFinishedEvent {
  readonly seq: number;
  readonly type: "node_finished";
  readonly node: string;
  readonly output: JsonValue;
}

export interface NodeFailedEvent {
  readonly seq: number;
  readonly type: "node_failed";
  readonly node: string;
  readonly error: string;
}

export interface RunFinishedEvent {
  readonly seq: number;
  readonly type: "run_finished";
  readonly status: string;
}

export type RunEvent =
  | RunStartedEvent
  | NodeStartedEvent
  | NodeFinishedEvent
  | NodeFailedEvent
  | RunFinishedEvent;
