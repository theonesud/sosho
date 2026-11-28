import { useCallback, useEffect, useMemo, useState } from "react";
import { listRuns } from "../api";
import type { RunSummary } from "../api/types";
import { useFetch } from "../api/use-fetch";
import { mergeRuns, RUN_PAGE } from "./panel-model";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function useRunList() {
  const first = useFetch((signal) => listRuns({ limit: RUN_PAGE }, signal), "all-runs");
  const [more, setMore] = useState<readonly RunSummary[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const firstData = first.data;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new first page restarts the paging
  useEffect(() => {
    setMore([]);
    setExhausted(false);
    setMoreError(null);
  }, [firstData]);

  const runs = useMemo(
    () => (firstData === null ? null : mergeRuns(firstData, more)),
    [firstData, more],
  );
  const loaded = runs?.length ?? 0;
  const hasMore = firstData !== null && !exhausted && firstData.length >= RUN_PAGE;

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    setMoreError(null);
    listRuns({ limit: RUN_PAGE, offset: loaded }).then(
      (page) => {
        setMore((current) => mergeRuns(current, page));
        if (page.length < RUN_PAGE) setExhausted(true);
        setLoadingMore(false);
      },
      (caught: unknown) => {
        setMoreError(messageOf(caught));
        setLoadingMore(false);
      },
    );
  }, [loaded]);

  return {
    runs,
    loading: first.status === "loading" || first.status === "idle",
    error: first.error,
    refetch: first.refetch,
    hasMore,
    loadingMore,
    moreError,
    loadMore,
  };
}
