import { describe, expect, it } from "vitest";
import { edgePath, graphBounds, loopRoute } from "./edge-path";

const bounds = graphBounds([
  { x: 0, y: 0, width: 100, height: 50 },
  { x: 200, y: 100, width: 100, height: 50 },
]);

describe("loop route", () => {
  it("measures the graph bounds", () => {
    expect(bounds).toEqual({ top: 0, bottom: 150 });
    expect(graphBounds([])).toEqual({ top: 0, bottom: 0 });
  });

  it("arcs above the graph for an upper back edge and keeps both ends", () => {
    const route = loopRoute({ x: 300, y: 20 }, { x: 0, y: 20 }, bounds);
    expect(route.above).toBe(true);
    expect(route.mid.y).toBeLessThan(bounds.top);
    expect(route.path.startsWith("M300,20 ")).toBe(true);
    expect(route.path.endsWith(" 0,20")).toBe(true);
  });

  it("arcs below the graph for a lower back edge", () => {
    const route = loopRoute({ x: 300, y: 130 }, { x: 0, y: 130 }, bounds);
    expect(route.above).toBe(false);
    expect(route.mid.y).toBeGreaterThan(bounds.bottom);
  });

  it("keeps the forward edge as an S curve", () => {
    expect(edgePath({ x: 0, y: 0 }, { x: 100, y: 50 })).toBe("M0,0 C50,0 50,50 100,50");
  });
});
