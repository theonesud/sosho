import { useEffect, useMemo, useRef, useState } from "react";
import { listRuns } from "../api";
import type { RunSummary } from "../api/types";
import { playChime, unlockAudioOnGesture } from "./chime";
import { groupWaiting, newWaitingIds, WAITING_LIMIT } from "./waiting";

const POLL_MS = 5000;
const NO_RUNS: readonly RunSummary[] = [];

export function useWaiting() {
  const [runs, setRuns] = useState(NO_RUNS);
  const seen = useRef<ReadonlySet<string> | null>(null);

  useEffect(() => unlockAudioOnGesture(), []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let controller: AbortController | null = null;
    let alive = true;

    const poll = () => {
      controller?.abort();
      const own = new AbortController();
      controller = own;
      listRuns({ status: "waiting", limit: WAITING_LIMIT }, own.signal).then(
        (next) => {
          if (!alive || own.signal.aborted) return;
          if (newWaitingIds(seen.current, next).length > 0) playChime();
          seen.current = new Set(next.map((run) => run.run_id));
          setRuns(next);
        },
        () => undefined,
      );
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const sync = () => {
      stop();
      if (document.visibilityState !== "visible") return;
      poll();
      timer = setInterval(poll, POLL_MS);
    };

    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      alive = false;
      stop();
      controller?.abort();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return useMemo(() => groupWaiting(runs), [runs]);
}
