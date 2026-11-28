import { describe, expect, it } from "vitest";
import { formatRoute, parseRoute } from "./route";

describe("route", () => {
  it("parses known paths and the run query", () => {
    expect(parseRoute("/", "")).toEqual({ kind: "home", runId: null });
    expect(parseRoute("/", "?run=r1")).toEqual({ kind: "home", runId: "r1" });
    expect(parseRoute("/w/a-b/", "?run=r%201")).toEqual({
      kind: "workflow",
      id: "a-b",
      version: null,
      runId: "r 1",
    });
    expect(parseRoute("/w/a", "?v=3&run=r1")).toEqual({
      kind: "workflow",
      id: "a",
      version: 3,
      runId: "r1",
    });
    expect(parseRoute("/w/a", "?v=0")).toMatchObject({ version: null });
    expect(parseRoute("/w/a", "?v=x")).toMatchObject({ version: null });
    expect(parseRoute("/design-ref/", "")).toEqual({ kind: "design-ref" });
    expect(parseRoute("/w/x/y", "")).toEqual({ kind: "not-found" });
    expect(parseRoute("/workflows", "")).toEqual({ kind: "not-found" });
  });

  it("formats routes so that parse inverts format", () => {
    const split = (url: string) => {
      const [path = "", query = ""] = url.split("?");
      return parseRoute(path, query ? `?${query}` : "");
    };
    const both = { kind: "workflow", id: "a b", version: 2, runId: "r/1" } as const;
    expect(formatRoute(both)).toBe("/w/a%20b?v=2&run=r%2F1");
    expect(split(formatRoute(both))).toEqual(both);
    const latest = { kind: "workflow", id: "a", version: null, runId: null } as const;
    expect(formatRoute(latest)).toBe("/w/a");
    expect(formatRoute({ ...latest, version: 4 })).toBe("/w/a?v=4");
  });
});
