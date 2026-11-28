import type { RunSummary, VersionSummary } from "../api/types";
import { asRunStatus } from "../run/run-state";
import type { RunStatus } from "../types";

export const RUN_PAGE = 50;

export const sortVersions = (versions: readonly VersionSummary[]): readonly VersionSummary[] =>
  [...versions].sort((a, b) => b.version - a.version);

const startedAt = (run: RunSummary): number => run.created_at ?? Number.NEGATIVE_INFINITY;

export function sortRuns(runs: readonly RunSummary[]): readonly RunSummary[] {
  const rank = (run: RunSummary) => (run.status === "waiting" ? 0 : 1);
  return [...runs].sort((a, b) => rank(a) - rank(b) || startedAt(b) - startedAt(a));
}

export function mergeRuns(
  first: readonly RunSummary[],
  more: readonly RunSummary[],
): readonly RunSummary[] {
  const seen = new Set(first.map((run) => run.run_id));
  return [...first, ...more.filter((run) => !seen.has(run.run_id))];
}

export interface RunRow {
  readonly runId: string;
  readonly workflowId: string | null;
  readonly name: string;
  readonly version: number | null;
  readonly startedAt: number | null;
  readonly status: RunStatus;
}

export function runRows(
  runs: readonly RunSummary[],
  names: ReadonlyMap<string, string>,
): readonly RunRow[] {
  return sortRuns(runs).map((run) => ({
    runId: run.run_id,
    workflowId: run.workflow_id,
    name:
      (run.workflow_id === null ? null : names.get(run.workflow_id)) ??
      run.workflow_id ??
      "Unknown workflow",
    version: run.version,
    startedAt: run.created_at,
    status: asRunStatus(run.status) ?? "pending",
  }));
}
