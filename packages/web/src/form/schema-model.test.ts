import { describe, expect, it } from "vitest";
import type { JsonObject } from "../api/types";
import { nodeFromSchema, setKey } from "./field-value";
import { fieldsFromSchema, groupFields } from "./schema-model";

const schema: JsonObject = {
  $defs: {
    RetryPolicy: {
      properties: {
        max_attempts: { default: 1, maximum: 10, minimum: 1, type: "integer" },
      },
      type: "object",
    },
    Branch: {
      properties: { name: { type: "string" }, when: { $ref: "#/$defs/Condition" } },
      required: ["name", "when"],
      type: "object",
    },
    Condition: {
      properties: {
        path: { type: "string" },
        op: { default: "truthy", enum: ["eq", "truthy"], type: "string" },
      },
      required: ["path"],
      type: "object",
    },
  },
  properties: {
    id: { type: "string" },
    kind: { const: "router", default: "router", type: "string" },
    queue: {
      anyOf: [{ enum: ["cloud-io", "host"], type: "string" }, { type: "null" }],
      default: null,
    },
    retry: { $ref: "#/$defs/RetryPolicy", default: { max_attempts: 1 } },
    timeout_seconds: { anyOf: [{ maximum: 3600, type: "number" }, { type: "null" }] },
    continue_on_error: { default: false, type: "boolean" },
    prompt: { type: "string", description: "Text sent to the model." },
    skills: { default: [], items: { type: "string" }, type: "array" },
    branches: { items: { $ref: "#/$defs/Branch" }, minItems: 1, type: "array" },
  },
  required: ["id", "prompt", "branches"],
  type: "object",
};

describe("schema to field model", () => {
  const fields = fieldsFromSchema(schema);
  const byKey = (key: string) => fields.find((field) => field.key === key);

  it("resolves $ref, anyOf with null, enums, and descriptions", () => {
    expect(byKey("queue")).toMatchObject({ type: "enum", nullable: true, required: false });
    expect(byKey("timeout_seconds")).toMatchObject({ type: "number", max: 3600, nullable: true });
    expect(byKey("retry")).toMatchObject({ type: "object" });
    expect(byKey("prompt")).toMatchObject({
      type: "string",
      multiline: true,
      description: "Text sent to the model.",
    });
    const branches = byKey("branches");
    expect(branches).toMatchObject({ type: "array", minItems: 1 });
    expect(branches?.type === "array" && branches.item.type).toBe("object");
  });

  it("groups the generic fields into advanced and hides id and kind", () => {
    const { main, advanced } = groupFields(fields);
    expect(advanced.map((f) => f.key)).toEqual([
      "queue",
      "retry",
      "timeout_seconds",
      "continue_on_error",
    ]);
    expect(main.map((f) => f.key)).toEqual(["prompt", "skills", "branches"]);
  });

  it("seeds a new node from required fields and drops empty optional values", () => {
    const node = nodeFromSchema(schema, "router", "router");
    expect(node).toEqual({
      id: "router",
      kind: "router",
      prompt: "",
      branches: [{ name: "", when: { path: "" } }],
    });
    const queue = byKey("queue");
    if (!queue) throw new Error("queue field missing");
    expect(setKey({ id: "a", queue: "host" }, queue, null)).toEqual({ id: "a" });
  });
});
