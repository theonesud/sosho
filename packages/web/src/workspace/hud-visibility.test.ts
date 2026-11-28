import { describe, expect, it } from "vitest";
import { type HudState, hudVisibility } from "./hud-visibility";

const idle: HudState = {
  runMode: false,
  editable: true,
  canUndo: false,
  canRedo: false,
  canPaste: false,
  hasSelection: false,
  selectedCount: 0,
  nodeCount: 3,
};

describe("hud visibility", () => {
  it("shows only the select tool and select all on an idle graph", () => {
    expect(hudVisibility(idle)).toEqual({
      undo: false,
      redo: false,
      copy: false,
      paste: false,
      duplicate: false,
      remove: false,
      selectAll: true,
      boxTool: true,
      history: false,
      clipboard: false,
      selection: true,
    });
  });

  it("follows history, selection, and the clipboard buffer", () => {
    const v = hudVisibility({
      ...idle,
      canUndo: true,
      canPaste: true,
      hasSelection: true,
      selectedCount: 1,
    });
    expect(v).toMatchObject({ undo: true, redo: false, copy: true, paste: true, remove: true });
    expect(v.history && v.clipboard).toBe(true);
  });

  it("shows delete for a selected edge but not copy or duplicate", () => {
    const v = hudVisibility({ ...idle, hasSelection: true });
    expect(v).toMatchObject({ remove: true, copy: false, duplicate: false, clipboard: true });
  });

  it("hides select all when the graph is empty or fully selected", () => {
    expect(hudVisibility({ ...idle, nodeCount: 0 }).selectAll).toBe(false);
    expect(hudVisibility({ ...idle, selectedCount: 3, hasSelection: true }).selectAll).toBe(false);
  });

  it("hides every edit icon in run mode and on a read-only view", () => {
    const busy = {
      ...idle,
      canUndo: true,
      canRedo: true,
      canPaste: true,
      hasSelection: true,
      selectedCount: 1,
    };
    for (const state of [
      { ...busy, runMode: true },
      { ...busy, editable: false },
    ]) {
      expect(Object.values(hudVisibility(state)).every((on) => !on)).toBe(true);
    }
  });
});
