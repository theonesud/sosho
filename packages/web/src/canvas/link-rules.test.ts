import { describe, expect, it } from "vitest";
import { validTargets } from "./link-rules";

const kinds = ["trigger", "llm", "agent", "router"].map((kind) => ({ kind }));

describe("validTargets", () => {
  it("hides trigger as a target of a trigger", () => {
    expect(validTargets("trigger", kinds).map((entry) => entry.kind)).toEqual([
      "llm",
      "agent",
      "router",
    ]);
  });

  it("keeps the current list for other kinds", () => {
    expect(validTargets("llm", kinds)).toEqual(kinds);
  });
});
