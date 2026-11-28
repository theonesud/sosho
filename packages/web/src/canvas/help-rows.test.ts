import { describe, expect, it } from "vitest";
import { helpRows } from "./help-rows";

describe("shortcut rows", () => {
  it("lists only the actions that apply in run mode", () => {
    const run = helpRows(true).map((row) => row.action);
    expect(run).toContain("Pan");
    expect(run).not.toContain("Paste");
    expect(helpRows(false).length).toBeGreaterThan(run.length);
  });
});
