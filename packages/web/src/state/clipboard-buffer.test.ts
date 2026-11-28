import { describe, expect, it } from "vitest";
import { bufferHasNodes, CLIPBOARD_KEY, readBuffer, writeBuffer } from "./clipboard-buffer";
import { copySelection } from "./graph";
import type { KeyValueStore } from "./persist";

function memoryStore(): KeyValueStore & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("in-app clipboard buffer", () => {
  const text =
    copySelection(
      { name: "x", nodes: [{ id: "a", kind: "wait", seconds: 1 }], edges: [], entry: "a" },
      ["a"],
    ) ?? "";

  it("stores the copied JSON under one key and reads it back", () => {
    const store = memoryStore();
    expect(readBuffer(store)).toBeNull();
    writeBuffer(text, store);
    expect(store.data.get(CLIPBOARD_KEY)).toBe(text);
    expect(readBuffer(store)).toBe(text);
  });

  it("counts only a valid node payload as content", () => {
    expect(bufferHasNodes(text)).toBe(true);
    expect(bufferHasNodes(null)).toBe(false);
    expect(bufferHasNodes("not json")).toBe(false);
    expect(bufferHasNodes(JSON.stringify({ tag: "sosho.nodes", nodes: [], edges: [] }))).toBe(
      false,
    );
  });

  it("survives a missing or failing store", () => {
    expect(readBuffer(null)).toBeNull();
    expect(() => writeBuffer(text, null)).not.toThrow();
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => undefined,
    };
    expect(readBuffer(broken)).toBeNull();
    expect(() => writeBuffer(text, broken)).not.toThrow();
  });
});
