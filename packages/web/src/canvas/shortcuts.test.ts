import { describe, expect, it } from "vitest";
import { clipboardAllowed, resolveShortcut } from "./shortcuts";

const press = (name: string, extra: Partial<Record<string, boolean>> = {}) => ({
  key: name,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...extra,
});
const open = { editable: true, typing: false };

describe("keyboard shortcut guards", () => {
  it("maps undo, redo, and delete when editing is allowed", () => {
    expect(resolveShortcut(press("z", { ctrlKey: true }), open)).toBe("undo");
    expect(resolveShortcut(press("Z", { ctrlKey: true, shiftKey: true }), open)).toBe("redo");
    expect(resolveShortcut(press("y", { metaKey: true }), open)).toBe("redo");
    expect(resolveShortcut(press("Delete"), open)).toBe("delete");
    expect(resolveShortcut(press("Backspace"), open)).toBe("delete");
    expect(resolveShortcut(press("a"), open)).toBeNull();
  });

  it("maps select all and duplicate with a modifier only", () => {
    expect(resolveShortcut(press("a", { ctrlKey: true }), open)).toBe("selectAll");
    expect(resolveShortcut(press("d", { metaKey: true }), open)).toBe("duplicate");
    expect(resolveShortcut(press("d"), open)).toBeNull();
    expect(
      resolveShortcut(press("a", { ctrlKey: true }), { editable: true, typing: true }),
    ).toBeNull();
    expect(
      resolveShortcut(press("d", { ctrlKey: true }), { editable: false, typing: false }),
    ).toBeNull();
  });

  it("ignores edit keys while typing, in read-only view, and in run mode", () => {
    const typing = { editable: true, typing: true };
    const locked = { editable: false, typing: false };
    expect(resolveShortcut(press("z", { ctrlKey: true }), typing)).toBeNull();
    expect(resolveShortcut(press("Backspace"), typing)).toBeNull();
    expect(resolveShortcut(press("z", { ctrlKey: true }), locked)).toBeNull();
    expect(resolveShortcut(press("Delete"), locked)).toBeNull();
    expect(resolveShortcut(press("Escape"), typing)).toBe("escape");
    expect(clipboardAllowed(open)).toBe(true);
    expect(clipboardAllowed(typing)).toBe(false);
    expect(clipboardAllowed(locked)).toBe(false);
  });
});
