import { describe, expect, it } from "vitest";
import type { TriggerNode } from "../api/types";
import {
  browserZone,
  defaultName,
  fieldOfIssue,
  isSampleInput,
  normalizeTrigger,
  renameTrigger,
  sampleInput,
  switchMode,
  triggerIssueView,
  triggerLabel,
  triggerMessages,
} from "./trigger-spec";

const base: TriggerNode = { id: "trigger", kind: "trigger", mode: "manual" };

describe("trigger names", () => {
  it("uses one default name for each mode", () => {
    expect(defaultName("manual")).toBe("Manual");
    expect(defaultName("cron")).toBe("Schedule");
    expect(defaultName("webhook")).toBe("Webhook");
    expect(defaultName("workflow_finished")).toBe("After workflow");
    expect(triggerLabel(base)).toBe("Manual");
    expect(triggerLabel({ ...base, name: "  " })).toBe("Manual");
  });

  it("updates a default name on a mode switch and keeps a custom name", () => {
    expect(switchMode(base, "cron").name).toBe("Schedule");
    expect(switchMode({ ...base, name: "Morning run" }, "webhook").name).toBe("Morning run");
    expect(normalizeTrigger({ id: "t", kind: "trigger" })).toEqual({
      id: "t",
      kind: "trigger",
      name: "Manual",
      mode: "manual",
    });
    expect(renameTrigger({ ...base, name: "x" }, "").name).toBeUndefined();
  });
});

describe("schedule time zone", () => {
  it("defaults to the browser zone and keeps a chosen zone", () => {
    expect(switchMode(base, "cron").cron_timezone).toBe(browserZone());
    expect(
      switchMode({ ...base, mode: "cron", cron_timezone: "Asia/Tokyo" }, "cron"),
    ).toMatchObject({ cron_timezone: "Asia/Tokyo" });
  });

  it("shows a five-field message for a bad engine cron", () => {
    const node: TriggerNode = { ...base, mode: "cron", cron: "0 61 9 * * *" };
    const view = triggerIssueView(node, [
      { code: "bad_cron", message: "cron string 0 61 9 * * * is not valid", node: "trigger" },
    ]);
    expect(view.fields.cron).toBe("Minute must be 0 to 59");
  });
});

describe("mode switch", () => {
  it("drops the stale fields of the old mode", () => {
    const cron: TriggerNode = {
      ...base,
      mode: "cron",
      cron: "0 0 9 * * *",
      cron_timezone: "UTC",
      queue: "host",
      continue_on_error: true,
    };
    expect(switchMode(cron, "workflow_finished")).toEqual({
      id: "trigger",
      kind: "trigger",
      name: "After workflow",
      mode: "workflow_finished",
    });
    expect(switchMode({ ...cron, mode: "cron" }, "manual")).toEqual({
      id: "trigger",
      kind: "trigger",
      name: "Manual",
      mode: "manual",
    });
  });

  it("prefills a sample input by mode", () => {
    expect(sampleInput("webhook")).toBe('{"example": "body"}');
    expect(isSampleInput("{}")).toBe(true);
    expect(isSampleInput(sampleInput("workflow_finished"))).toBe(true);
    expect(isSampleInput('{"mine": 1}')).toBe(false);
  });
});

describe("issue to field mapping", () => {
  const cron: TriggerNode = { ...base, mode: "cron", cron: "0 0 9 * * *" };

  it("maps engine codes and 422 messages to fields", () => {
    const issue = (code: string, message: string, field?: string) => ({
      code,
      message,
      node: "trigger",
      ...(field ? { field } : {}),
    });
    expect(fieldOfIssue(issue("bad_cron", "cron string x is not valid"))).toBe("cron");
    expect(fieldOfIssue(issue("bad_timezone", "time zone x is unknown"))).toBe("cron_timezone");
    expect(fieldOfIssue(issue("finished_self", "a workflow cannot start from its own end"))).toBe(
      "source_workflow_id",
    );
    expect(
      fieldOfIssue(issue("value_error", "Value error, a cron trigger needs a cron string")),
    ).toBe("cron");
    expect(
      fieldOfIssue(issue("value_error", "a workflow_finished trigger needs source_workflow_id")),
    ).toBe("source_workflow_id");
    expect(fieldOfIssue(issue("trigger_cycle", "trigger cycle: a -> b -> a"))).toBe(
      "source_workflow_id",
    );
    expect(fieldOfIssue(issue("x", "m", "cron_timezone"))).toBe("cron_timezone");
    expect(fieldOfIssue(issue("queue_kind", "a trigger node has no queue"))).toBeNull();
  });

  it("adds client required checks and lists unmapped issues once", () => {
    expect(triggerIssueView({ ...base, mode: "cron" }, []).fields.cron).toBe(
      "Enter a cron expression.",
    );
    expect(triggerIssueView({ ...cron, cron: "0 9 * *" }, []).fields.cron).toMatch(/5 fields/);
    expect(triggerIssueView({ ...base, mode: "workflow_finished" }, []).fields).toEqual({
      source_workflow_id: "Choose the workflow to follow.",
    });
    const view = triggerIssueView({ ...cron, cron_timezone: "Foo/Bar" }, [
      { code: "bad_timezone", message: "time zone Foo/Bar is unknown", node: "trigger" },
      { code: "queue_kind", message: "a trigger node has no queue", node: "trigger" },
      { code: "queue_kind", message: "a trigger node has no queue", node: "trigger" },
    ]);
    expect(view.fields).toEqual({ cron_timezone: "Time zone Foo/Bar is unknown" });
    expect(view.general).toEqual(["A trigger node has no queue"]);
  });

  it("drops issues of fields that the mode no longer shows", () => {
    const stale = [
      { code: "bad_cron", message: "cron string x is not valid", node: "trigger" },
      { code: "bad_timezone", message: "time zone x is unknown", node: "trigger" },
    ];
    const hook: TriggerNode = { ...base, mode: "webhook" };
    expect(triggerIssueView(hook, stale)).toEqual({ fields: {}, general: [] });
    expect(triggerMessages(hook, stale)).toEqual([]);
    expect(triggerMessages(switchMode(cron, "webhook"), stale)).toEqual([]);
    expect(triggerMessages({ ...base, mode: "cron" }, [])).toEqual(["Enter a cron expression."]);
  });
});
