import { isJsonObject } from "../api/guards";
import type { JsonObject } from "../api/types";
import type { KeyValueStore } from "../state/persist";

const PREFIX = "sosho.run-input.";
const RUN_PREFIX = "sosho.run-sent.";
export const DEFAULT_INPUT = "{}";

function defaultStorage(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadRunInput(
  workflowId: string,
  storage: KeyValueStore | null = defaultStorage(),
): string {
  try {
    return storage?.getItem(PREFIX + workflowId) ?? DEFAULT_INPUT;
  } catch {
    return DEFAULT_INPUT;
  }
}

export function saveRunInput(
  workflowId: string,
  text: string,
  storage: KeyValueStore | null = defaultStorage(),
): void {
  try {
    storage?.setItem(PREFIX + workflowId, text);
  } catch {
    return;
  }
}

export type ParsedInput =
  | { readonly ok: true; readonly value: JsonObject }
  | { readonly ok: false; readonly message: string };

export function parseRunInput(text: string): ParsedInput {
  if (text.trim() === "") return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (caught) {
    return { ok: false, message: caught instanceof Error ? caught.message : "Invalid JSON." };
  }
  if (!isJsonObject(parsed)) return { ok: false, message: "The input must be a JSON object." };
  return { ok: true, value: parsed };
}

export function rememberSentInput(
  runId: string,
  value: JsonObject,
  storage: KeyValueStore | null = defaultStorage(),
): void {
  try {
    storage?.setItem(RUN_PREFIX + runId, JSON.stringify(value));
  } catch {
    return;
  }
}

export function sentInput(
  runId: string,
  storage: KeyValueStore | null = defaultStorage(),
): JsonObject | null {
  try {
    const raw = storage?.getItem(RUN_PREFIX + runId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
