import { getTriggers } from "../api/client";
import { useFetch } from "../api/use-fetch";
import type { TriggerApi } from "../canvas/edit-api";

export function useTriggerInfo(workflowId: string | null, savedVersion: number | null): TriggerApi {
  const id = workflowId ?? "";
  const fetched = useFetch(
    workflowId === null ? null : (signal) => getTriggers(id, signal),
    `triggers:${id}:${savedVersion ?? 0}`,
  );
  return { info: fetched.data, refresh: fetched.refetch };
}
