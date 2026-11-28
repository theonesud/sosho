import { useCallback, useEffect, useReducer, useRef } from "react";

export type FetchState<T> =
  | { readonly status: "idle"; readonly data: null; readonly error: null }
  | { readonly status: "loading"; readonly data: T | null; readonly error: null }
  | { readonly status: "success"; readonly data: T; readonly error: null }
  | { readonly status: "error"; readonly data: T | null; readonly error: Error };

export type FetchAction<T> =
  | { readonly type: "reset" }
  | { readonly type: "start"; readonly keepData: boolean }
  | { readonly type: "success"; readonly data: T }
  | { readonly type: "failure"; readonly error: Error };

export const idleState = <T>(): FetchState<T> => ({ status: "idle", data: null, error: null });

export function fetchReducer<T>(state: FetchState<T>, action: FetchAction<T>): FetchState<T> {
  switch (action.type) {
    case "reset":
      return idleState();
    case "start":
      return { status: "loading", data: action.keepData ? state.data : null, error: null };
    case "success":
      return { status: "success", data: action.data, error: null };
    case "failure":
      return { status: "error", data: state.data, error: action.error };
  }
}

export type Fetcher<T> = (signal: AbortSignal) => Promise<T>;

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

export function useFetch<T>(fetcher: Fetcher<T> | null, cacheKey: string) {
  const [state, dispatch] = useReducer(
    (s: FetchState<T>, a: FetchAction<T>) => fetchReducer(s, a),
    idleState<T>(),
  );
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  const latest = useRef(fetcher);
  latest.current = fetcher;
  const active = fetcher !== null;
  const seen = useRef({ cacheKey, tick });

  // biome-ignore lint/correctness/useExhaustiveDependencies: cacheKey and tick are the triggers
  useEffect(() => {
    const run = latest.current;
    if (run === null) {
      dispatch({ type: "reset" });
      return;
    }
    const keepData = seen.current.cacheKey === cacheKey && seen.current.tick !== tick;
    seen.current = { cacheKey, tick };
    const controller = new AbortController();
    dispatch({ type: "start", keepData });
    run(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) dispatch({ type: "success", data });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) dispatch({ type: "failure", error: toError(error) });
      },
    );
    return () => controller.abort();
  }, [cacheKey, tick, active]);

  const refetch = useCallback(() => bump(), []);
  return { ...state, refetch };
}
