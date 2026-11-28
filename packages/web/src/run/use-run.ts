import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { getRun } from "../api";
import { openRunEvents } from "../api/sse";
import type { RunEvent } from "../api/types";
import {
  initialRunState,
  isTerminal,
  nodeStatuses,
  runReducer,
  runStatus,
  unexplained,
} from "./run-state";

export type Link = "connecting" | "live" | "polling" | "ended";

const POLL_MS = 2000;
const REFRESH_MS = 150;
const HUMAN_REFRESH_MS = 400;

function mustRefresh(event: RunEvent): number | null {
  if (event.type === "node_finished" || event.type === "node_failed") return REFRESH_MS;
  if (event.type === "run_finished") return 0;
  return null;
}

const NO_IDS: ReadonlySet<string> = new Set();

export function useRun(runId: string | null) {
  const [humanIds, setHumanIds] = useState(NO_IDS);
  const [state, dispatch] = useReducer(runReducer, initialRunState);
  const [link, setLink] = useState<Link>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const latest = useRef(state);
  latest.current = state;
  const humans = useRef(humanIds);
  humans.current = humanIds;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (runId === null) return;
    try {
      const detail = await getRun(runId);
      dispatch({ type: "detail", detail });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [runId]);

  const refreshSoon = useCallback(
    (delay: number) => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void refresh();
      }, delay);
    },
    [refresh],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the run changes
  useEffect(() => {
    dispatch({ type: "reset" });
    setLink("connecting");
    setError(null);
    setEpoch(0);
  }, [runId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch reopens the stream after a resume
  useEffect(() => {
    if (runId === null) return;
    void refresh();
    const stream = openRunEvents(runId, {
      onEvent: (event) => {
        setLink("live");
        const surprise = unexplained(latest.current, event);
        dispatch({ type: "event", event });
        const delay = mustRefresh(event);
        if (surprise) refreshSoon(REFRESH_MS);
        else if (delay !== null) refreshSoon(delay);
        else if (event.type === "node_started" && humans.current.has(event.node)) {
          refreshSoon(HUMAN_REFRESH_MS);
        }
      },
      onEnd: () => {
        setLink("ended");
        void refresh();
      },
      onError: (reason) => {
        if (reason === "connection") setLink("polling");
      },
    });
    return () => {
      stream.close();
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [runId, epoch, refresh, refreshSoon]);

  const status = runStatus(state);
  const statuses = useMemo(() => nodeStatuses(state), [state]);
  const awaitingHuman = useMemo(
    () =>
      [...statuses].some(([id, value]) => value === "running" && humanIds.has(id)) &&
      !isTerminal(status),
    [statuses, humanIds, status],
  );
  const polling = runId !== null && !isTerminal(status) && (link === "polling" || awaitingHuman);

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [polling, refresh]);

  const reopen = useCallback(() => {
    setLink("connecting");
    setEpoch((value) => value + 1);
  }, []);

  return { state, status, statuses, link, error, refresh, reopen, setHumanIds };
}
