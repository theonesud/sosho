import { describe, expect, it } from "vitest";
import type { KeyValueStore } from "../state/persist";
import {
  DEFAULT_INPUT,
  loadRunInput,
  parseRunInput,
  rememberSentInput,
  saveRunInput,
  sentInput,
} from "./run-input";

function memory(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("run input persistence", () => {
  it("keeps the text for each workflow and survives a broken store", () => {
    const store = memory();
    expect(loadRunInput("a", store)).toBe(DEFAULT_INPUT);
    saveRunInput("a", '{"x":1}', store);
    saveRunInput("b", '{"y":2}', store);
    expect(loadRunInput("a", store)).toBe('{"x":1}');
    expect(loadRunInput("b", store)).toBe('{"y":2}');
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
    };
    saveRunInput("a", "{}", broken);
    expect(loadRunInput("a", broken)).toBe(DEFAULT_INPUT);
  });

  it("validates the JSON object and remembers what a run received", () => {
    expect(parseRunInput("")).toEqual({ ok: true, value: {} });
    expect(parseRunInput('{"a":[1]}')).toEqual({ ok: true, value: { a: [1] } });
    expect(parseRunInput("[1]").ok).toBe(false);
    expect(parseRunInput("{bad").ok).toBe(false);
    const store = memory();
    rememberSentInput("r1", { q: "hi" }, store);
    expect(sentInput("r1", store)).toEqual({ q: "hi" });
    expect(sentInput("r2", store)).toBeNull();
  });
});
