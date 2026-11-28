import { isRecord, isWorkflowDraft } from "../api/guards";
import type { WorkflowDraft } from "../api/types";

const PREFIX = "sosho.draft.";

export const draftKey = (workflowId: string, baseVersion: number | null): string =>
  `${PREFIX}${workflowId}.v${baseVersion ?? 0}`;

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface StoredDraft {
  readonly baseVersion: number | null;
  readonly workflow: WorkflowDraft;
}

export function defaultStorage(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function saveDraft(
  workflowId: string,
  draft: StoredDraft,
  storage: KeyValueStore | null = defaultStorage(),
): void {
  try {
    storage?.setItem(draftKey(workflowId, draft.baseVersion), JSON.stringify(draft));
  } catch {
    return;
  }
}

export function loadDraft(
  workflowId: string,
  baseVersion: number | null,
  storage: KeyValueStore | null = defaultStorage(),
): StoredDraft | null {
  let raw: string | null | undefined;
  try {
    raw = storage?.getItem(draftKey(workflowId, baseVersion));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isWorkflowDraft(parsed.workflow)) return null;
    const version = parsed.baseVersion;
    return {
      baseVersion: typeof version === "number" ? version : null,
      workflow: parsed.workflow,
    };
  } catch {
    return null;
  }
}

export function clearDraft(
  workflowId: string,
  baseVersion: number | null,
  storage: KeyValueStore | null = defaultStorage(),
): void {
  try {
    storage?.removeItem(draftKey(workflowId, baseVersion));
  } catch {
    return;
  }
}
