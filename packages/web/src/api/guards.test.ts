import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import {
  isCatalog,
  isNode,
  isRunDetail,
  isTriggerInfo,
  isTriggerWebhook,
  isValidateResponse,
  isWorkflow,
  isWorkflowDraft,
} from "./guards";
import { parseRunEvent } from "./sse";

const summary = {
  run_id: "r1",
  status: "running",
  dbos_status: "PENDING",
  workflow_id: "demo",
  version: 1,
  created_at: 1,
  updated_at: null,
  app_version: null,
  forked_from: null,
  parent_run_id: null,
};
const workflow = {
  id: "demo",
  version: 2,
  name: "Demo",
  description: null,
  nodes: [
    { id: "t", kind: "trigger", mode: "manual", retry: { max_attempts: 1 } },
    { id: "r", kind: "router", branches: [{ name: "b", when: { path: "x", op: "truthy" } }] },
  ],
  edges: [{ source: "t", target: "r", when: null, loop: false }],
  entry: "t",
  policy: { max_steps: 200 },
};

describe("api guards", () => {
  it("accepts engine shaped payloads and rejects broken ones", () => {
    expect(isWorkflow(workflow)).toBe(true);
    expect(isWorkflowDraft({ ...workflow, id: undefined, version: undefined })).toBe(true);
    expect(isWorkflow({ ...workflow, id: undefined })).toBe(false);
    expect(isNode({ id: "x", kind: "llm", role: "r" })).toBe(false);
    expect(isNode({ id: "x", kind: "bogus" })).toBe(false);
    expect(
      isValidateResponse({ valid: false, issues: [{ code: "c", message: "m", node: null }] }),
    ).toBe(true);
    expect(isValidateResponse({ valid: false, issues: [{ code: "c" }] })).toBe(false);
    const detail = {
      summary,
      output: { a: [1] },
      error: null,
      progress: null,
      pending_human: [],
      steps: [],
    };
    expect(isRunDetail(detail)).toBe(true);
    expect(isRunDetail({ ...detail, summary: { ...summary, status: 1 } })).toBe(false);
    const catalog = {
      kinds: [{ kind: "wait", title: "Wait", description: "d", json_schema: { type: "object" } }],
      tools: [],
      queues: { host: { global_concurrency: 4 } },
      skills: [],
      pi_roles: ["a"],
    };
    expect(isCatalog(catalog)).toBe(true);
    expect(isCatalog({ ...catalog, queues: { host: "x" } })).toBe(false);
  });

  it("parses run events and carries issues on an api error", () => {
    expect(parseRunEvent('{"seq":1,"type":"node_failed","node":"a","error":"boom"}')).toEqual({
      seq: 1,
      type: "node_failed",
      node: "a",
      error: "boom",
    });
    expect(parseRunEvent('{"seq":1,"type":"run_finished"}')).toBeNull();
    expect(parseRunEvent("nope")).toBeNull();
    const error = new ApiError(422, {}, "bad", [{ code: "c", message: "m", node: "a" }]);
    expect(error.status).toBe(422);
    expect(error.issues[0]?.node).toBe("a");
  });

  it("checks trigger info and webhook token guards", () => {
    const info = {
      version: 3,
      schedules: [
        {
          name: "wf.a.t",
          cron: "0 9 * * *",
          timezone: "UTC",
          next_fire: "2026-01-01T09:00:00+00:00",
        },
      ],
      webhooks: [{ node_id: "t", url: "http://x/webhooks/a/t", token: "tok" }],
      followers: [{ source_workflow_id: "b", on_status: "succeeded" }],
    };
    expect(isTriggerInfo(info)).toBe(true);
    expect(
      isTriggerInfo({ ...info, version: null, schedules: [], webhooks: [], followers: [] }),
    ).toBe(true);
    expect(isTriggerInfo({ ...info, version: "3" })).toBe(false);
    expect(isTriggerInfo({ ...info, webhooks: [{ node_id: "t", url: "u" }] })).toBe(false);
    expect(isTriggerWebhook(info.webhooks[0])).toBe(true);
    expect(isTriggerWebhook({ node_id: "t", url: "u", token: 1 })).toBe(false);
  });
});
