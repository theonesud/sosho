import { describe, expect, it } from "vitest";
import { centerOnRect, fitViewport, MAX_ZOOM, zoomAt } from "./camera";

describe("camera math", () => {
  it("fits content into the frame and centers it", () => {
    const view = fitViewport({ width: 800, height: 400 }, { width: 400, height: 400 });
    expect(view.k).toBe(0.5);
    expect(view.x).toBe(0);
    expect(view.y).toBe(100);
  });

  it("does not zoom in past 1 when the content is small", () => {
    expect(fitViewport({ width: 100, height: 100 }, { width: 1000, height: 1000 }).k).toBe(1);
  });

  it("centers a rect at a given zoom", () => {
    const view = centerOnRect(
      { x: 100, y: 50, width: 200, height: 100 },
      { width: 600, height: 400 },
      1,
    );
    expect(view).toEqual({ k: 1, x: 100, y: 100 });
  });

  it("keeps the point under the cursor fixed when zooming", () => {
    const start = { x: 10, y: 20, k: 1 };
    const next = zoomAt(start, 2, 100, 100);
    expect((100 - next.x) / next.k).toBeCloseTo((100 - start.x) / start.k);
    expect(zoomAt(start, 100, 0, 0).k).toBe(MAX_ZOOM);
  });
});
