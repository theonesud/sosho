import { describe, expect, it } from "vitest";
import type { Edge, Node } from "../api/types";
import { layoutGraph } from "./layout";
import { sizesEqual } from "./sizes";

const nodes: readonly Node[] = [
  { id: "a", kind: "trigger" },
  { id: "b", kind: "join" },
  { id: "c", kind: "join" },
];
const edges: readonly Edge[] = [
  { source: "a", target: "b" },
  { source: "b", target: "c", when: "ok" },
];

describe("layoutGraph", () => {
  it("places nodes left to right without overlap", () => {
    const { rects } = layoutGraph(nodes, edges, new Map());
    const [a, b, c] = ["a", "b", "c"].map((id) => rects.get(id));
    expect(a && b && c).toBeTruthy();
    if (!a || !b || !c) return;
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
    expect(c.x).toBeGreaterThanOrEqual(b.x + b.width);
  });

  it("uses the measured size and moves the next rank when a node grows", () => {
    const small = layoutGraph(nodes, edges, new Map());
    const big = layoutGraph(nodes, edges, new Map([["a", { width: 400, height: 300 }]]));
    expect(big.rects.get("a")?.width).toBe(400);
    expect(big.rects.get("a")?.height).toBe(300);
    expect(big.rects.get("b")?.x).toBeGreaterThan(small.rects.get("b")?.x ?? 0);
  });

  it("accepts a loop edge", () => {
    const loop: readonly Edge[] = [...edges, { source: "c", target: "a", loop: true }];
    expect(layoutGraph(nodes, loop, new Map()).rects.size).toBe(3);
  });
});

describe("sizesEqual", () => {
  const one = new Map([["a", { width: 10, height: 20 }]]);
  it("is true for equal content", () => {
    expect(sizesEqual(one, new Map([["a", { width: 10, height: 20 }]]))).toBe(true);
  });
  it("is false for a changed size or key set", () => {
    expect(sizesEqual(one, new Map([["a", { width: 11, height: 20 }]]))).toBe(false);
    expect(sizesEqual(one, new Map())).toBe(false);
  });
});
