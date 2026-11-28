import type { RunSummary } from "../api/types";

export const WAITING_LIMIT = 200;

export type WaitingMap = ReadonlyMap<string, readonly RunSummary[]>;

const age = (run: RunSummary): number => run.created_at ?? Number.POSITIVE_INFINITY;

export function groupWaiting(runs: readonly RunSummary[]): WaitingMap {
  const map = new Map<string, RunSummary[]>();
  for (const run of runs) {
    if (run.workflow_id === null) continue;
    const list = map.get(run.workflow_id);
    if (list) list.push(run);
    else map.set(run.workflow_id, [run]);
  }
  for (const list of map.values()) list.sort((a, b) => age(a) - age(b));
  return map;
}

export function newWaitingIds(
  previous: ReadonlySet<string> | null,
  runs: readonly RunSummary[],
): readonly string[] {
  if (previous === null) return [];
  return runs.map((run) => run.run_id).filter((id) => !previous.has(id));
}

export const waitingCount = (waiting: WaitingMap): number => {
  let total = 0;
  for (const list of waiting.values()) total += list.length;
  return total;
};

export const waitingLabel = (count: number): string =>
  count === 1 ? "1 run waits for you" : `${count} runs wait for you`;
