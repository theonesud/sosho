import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import type { KeyValueStore } from "../state/persist";
import {
  ACTIVE_RUN_TEXT,
  deleteFailure,
  nextAfterDelete,
  PANEL_KEY,
  readCollapsed,
  writeCollapsed,
} from "./panel-state";

function memoryStore(): KeyValueStore & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("panel state", () => {
  it("is open by default and remembers the choice", () => {
    const store = memoryStore();
    expect(readCollapsed(store)).toBe(false);
    writeCollapsed(true, store);
    expect(store.data.get(PANEL_KEY)).toBe("1");
    expect(readCollapsed(store)).toBe(true);
    writeCollapsed(false, store);
    expect(readCollapsed(store)).toBe(false);
  });

  it("ignores the collapsed value of the old default key", () => {
    const store = memoryStore();
    store.setItem("sosho.panel.collapsed", "1");
    expect(PANEL_KEY).not.toBe("sosho.panel.collapsed");
    expect(readCollapsed(store)).toBe(false);
  });

  it("stays open when storage is missing", () => {
    expect(readCollapsed(null)).toBe(false);
    expect(() => writeCollapsed(true, null)).not.toThrow();
  });

  it("opens the next workflow after a delete, else the previous, else none", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(nextAfterDelete(items, "b")).toBe("c");
    expect(nextAfterDelete(items, "c")).toBe("b");
    expect(nextAfterDelete([{ id: "a" }], "a")).toBeNull();
    expect(nextAfterDelete(items, "z")).toBeNull();
  });

  it("explains a 409 delete failure", () => {
    const busy = new ApiError(409, undefined, "run r1 is not finished", []);
    expect(deleteFailure(busy)).toBe(ACTIVE_RUN_TEXT);
    expect(deleteFailure(busy)).not.toContain("r1");
    expect(deleteFailure(new Error("boom"))).toBe("boom");
  });
});
