import { useMemo, useSyncExternalStore } from "react";
import { parseClipboard } from "./graph";
import { defaultStorage, type KeyValueStore } from "./persist";

export const CLIPBOARD_KEY = "sosho.clipboard";

const listeners = new Set<() => void>();

export function readBuffer(storage: KeyValueStore | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(CLIPBOARD_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeBuffer(text: string, storage: KeyValueStore | null = defaultStorage()): void {
  try {
    storage?.setItem(CLIPBOARD_KEY, text);
  } catch {
    return;
  }
  for (const listener of listeners) listener();
}

export function bufferHasNodes(text: string | null): boolean {
  return text !== null && parseClipboard(text) !== null;
}

function subscribe(listener: () => void): () => void {
  const onStorage = (change: StorageEvent) => {
    if (change.key === null || change.key === CLIPBOARD_KEY) listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useClipboardBuffer(): boolean {
  const text = useSyncExternalStore(subscribe, () => readBuffer());
  return useMemo(() => bufferHasNodes(text), [text]);
}
