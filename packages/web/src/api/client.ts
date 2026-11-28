import type { Guard } from "./guards";
import {
  arrayOf,
  isCatalog,
  isIssue,
  isRecord,
  isRunDetail,
  isRunRef,
  isRunSummaryList,
  isTriggerInfo,
  isTriggerWebhook,
  isValidateResponse,
  isVersionSummaryList,
  isWorkflow,
  isWorkflowSummary,
  isWorkflowSummaryList,
} from "./guards";
import type {
  Catalog,
  InputRequest,
  Issue,
  RunDetail,
  RunRef,
  RunSummary,
  StartRequest,
  TriggerInfo,
  TriggerWebhook,
  ValidateResponse,
  VersionSummary,
  Workflow,
  WorkflowDraft,
  WorkflowSummary,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly issues: readonly Issue[];

  constructor(status: number, body: unknown, message: string, issues: readonly Issue[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.issues = issues;
  }
}

function describe(status: number, body: unknown): { message: string; issues: readonly Issue[] } {
  if (!isRecord(body)) return { message: `HTTP ${status}`, issues: [] };
  const issues = arrayOf(isIssue)(body.issues) ? body.issues : [];
  const text = typeof body.error === "string" ? body.error : body.detail;
  return { message: typeof text === "string" ? text : `HTTP ${status}`, issues };
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(
  method: string,
  path: string,
  guard: Guard<T>,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  if (signal) init.signal = signal;
  const response = await fetch(path, init);
  const payload = await readBody(response);
  if (!response.ok) {
    const { message, issues } = describe(response.status, payload);
    throw new ApiError(response.status, payload, message, issues);
  }
  if (!guard(payload)) {
    throw new ApiError(response.status, payload, `Unexpected response from ${path}`, []);
  }
  return payload;
}

const enc = encodeURIComponent;

export const getCatalog = (signal?: AbortSignal): Promise<Catalog> =>
  request("GET", "/nodes", isCatalog, undefined, signal);

export const listWorkflows = (signal?: AbortSignal): Promise<readonly WorkflowSummary[]> =>
  request("GET", "/workflows", isWorkflowSummaryList, undefined, signal);

export const createWorkflow = (body: {
  id: string;
  name: string;
  description?: string;
}): Promise<WorkflowSummary> => request("POST", "/workflows", isWorkflowSummary, body);

export const updateWorkflow = (
  id: string,
  body: { name?: string; description?: string },
): Promise<WorkflowSummary> => request("PATCH", `/workflows/${enc(id)}`, isWorkflowSummary, body);

export const deleteWorkflow = (id: string): Promise<undefined> =>
  request("DELETE", `/workflows/${enc(id)}`, (value): value is undefined => value === undefined);

export const getWorkflow = (id: string, signal?: AbortSignal): Promise<WorkflowSummary> =>
  request("GET", `/workflows/${enc(id)}`, isWorkflowSummary, undefined, signal);

export const listVersions = (
  id: string,
  signal?: AbortSignal,
): Promise<readonly VersionSummary[]> =>
  request("GET", `/workflows/${enc(id)}/versions`, isVersionSummaryList, undefined, signal);

export const getVersion = (id: string, version: number, signal?: AbortSignal): Promise<Workflow> =>
  request("GET", `/workflows/${enc(id)}/versions/${version}`, isWorkflow, undefined, signal);

export const saveVersion = (id: string, draft: WorkflowDraft): Promise<Workflow> =>
  request("POST", `/workflows/${enc(id)}/versions`, isWorkflow, draft);

export const getTriggers = (id: string, signal?: AbortSignal): Promise<TriggerInfo> =>
  request("GET", `/workflows/${enc(id)}/triggers`, isTriggerInfo, undefined, signal);

export const regenerateWebhookToken = (id: string, nodeId: string): Promise<TriggerWebhook> =>
  request("POST", `/workflows/${enc(id)}/webhooks/${enc(nodeId)}/token`, isTriggerWebhook);

export const validateDraft = (
  draft: WorkflowDraft,
  workflowId = "draft",
  signal?: AbortSignal,
): Promise<ValidateResponse> =>
  request("POST", "/validate", isValidateResponse, { workflow_id: workflowId, draft }, signal);

export const startRun = (id: string, body: StartRequest = {}): Promise<RunRef> =>
  request("POST", `/workflows/${enc(id)}/runs`, isRunRef, body);

export function listRuns(
  filter: { status?: string; workflowId?: string; limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<readonly RunSummary[]> {
  const query = new URLSearchParams();
  if (filter.status) query.set("status", filter.status);
  if (filter.workflowId) query.set("workflow_id", filter.workflowId);
  if (filter.limit !== undefined) query.set("limit", String(filter.limit));
  if (filter.offset !== undefined) query.set("offset", String(filter.offset));
  const suffix = query.size > 0 ? `?${query}` : "";
  return request("GET", `/runs${suffix}`, isRunSummaryList, undefined, signal);
}

export const getRun = (runId: string, signal?: AbortSignal): Promise<RunDetail> =>
  request("GET", `/runs/${enc(runId)}`, isRunDetail, undefined, signal);

export const sendInput = (runId: string, body: InputRequest): Promise<RunRef> =>
  request("POST", `/runs/${enc(runId)}/input`, isRunRef, body);

export const cancelRun = (runId: string): Promise<RunRef> =>
  request("POST", `/runs/${enc(runId)}/cancel`, isRunRef);

export const resumeRun = (runId: string): Promise<RunRef> =>
  request("POST", `/runs/${enc(runId)}/resume`, isRunRef);

export const forkRun = (
  runId: string,
  body: { node_id: string; occurrence?: number },
): Promise<RunRef> => request("POST", `/runs/${enc(runId)}/fork`, isRunRef, body);
