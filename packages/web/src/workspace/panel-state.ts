import { useCallback, useState } from "react";
import { ApiError } from "../api";
import { defaultStorage, type KeyValueStore } from "../state/persist";

export const PANEL_KEY = "sosho.panel.collapsed.v2";

export function readCollapsed(storage: KeyValueStore | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(PANEL_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCollapsed(
  collapsed: boolean,
  storage: KeyValueStore | null = defaultStorage(),
): void {
  try {
    storage?.setItem(PANEL_KEY, collapsed ? "1" : "0");
  } catch {
    return;
  }
}

export function usePanelCollapsed(): readonly [boolean, (collapsed: boolean) => void] {
  const [collapsed, setState] = useState(() => readCollapsed());
  const set = useCallback((next: boolean) => {
    setState(next);
    writeCollapsed(next);
  }, []);
  return [collapsed, set];
}

export function nextAfterDelete(
  items: readonly { readonly id: string }[],
  deletedId: string,
): string | null {
  const at = items.findIndex((item) => item.id === deletedId);
  if (at < 0) return null;
  return (items[at + 1] ?? items[at - 1])?.id ?? null;
}

export const ACTIVE_RUN_TEXT =
  "This workflow has an active run. Cancel the run, then delete the workflow.";

export function deleteFailure(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) return ACTIVE_RUN_TEXT;
  return error instanceof Error ? error.message : String(error);
}
