import { describe, expect, it } from "vitest";
import { boxFromPoints, boxToWorld, nodesInBox, rectsIntersect } from "./box-select";

const rects = new Map([
  ["a", { x: 0, y: 0, width: 100, height: 50 }],
  ["b", { x: 200, y: 0, width: 100, height: 50 }],
  ["c", { x: 0, y: 200, width: 100, height: 50 }],
]);

describe("box select math", () => {
  it("normalizes a box drawn in any direction", () => {
    expect(boxFromPoints({ x: 50, y: 40 }, { x: 10, y: 5 })).toEqual({
      x: 10,
      y: 5,
      width: 40,
      height: 35,
    });
  });

  it("maps a screen box to world space with pan and zoom", () => {
    const world = boxToWorld({ x: 120, y: 70, width: 100, height: 50 }, { x: 20, y: 10, k: 2 });
    expect(world).toEqual({ x: 50, y: 30, width: 50, height: 25 });
  });

  it("selects nodes that touch the box, not only nodes inside it", () => {
    expect(
      rectsIntersect({ x: 0, y: 0, width: 100, height: 50 }, { x: 90, y: 40, width: 5, height: 5 }),
    ).toBe(true);
    expect(nodesInBox(rects, { x: 90, y: 40, width: 150, height: 5 })).toEqual(["a", "b"]);
    expect(nodesInBox(rects, { x: 101, y: 51, width: 50, height: 50 })).toEqual([]);
    expect(nodesInBox(rects, { x: -10, y: -10, width: 400, height: 400 })).toEqual(["a", "b", "c"]);
  });
});
