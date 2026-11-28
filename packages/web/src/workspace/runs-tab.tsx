import { Button } from "@ui-sdk/react/button";
import { Callout } from "../components/callout";
import { EmptyState } from "../components/empty-state";
import { RunStatusBadge } from "../components/run-status-badge";
import { navigate } from "../route";
import { type RunRow, runRows } from "./panel-model";
import type { useRunList } from "./use-run-list";

export type RunListModel = ReturnType<typeof useRunList>;

interface RunsTabProps {
  readonly model: RunListModel;
  readonly names: ReadonlyMap<string, string>;
  readonly activeRunId: string | null;
}

const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();

function formatTime(ms: number | null): string {
  if (ms === null) return "";
  const date = new Date(ms);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay(date, new Date())) return time;
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

function Row({ row, current }: { readonly row: RunRow; readonly current: boolean }) {
  const { workflowId } = row;
  const body = (
    <>
      <span className="wp-run-main">
        <span className="wp-name">{row.name}</span>
        <span className="wp-version">{row.version === null ? "none" : `v${row.version}`}</span>
      </span>
      <span className="wp-run-sub">
        <RunStatusBadge status={row.status} />
        <span className="wp-run-time muted">{formatTime(row.startedAt)}</span>
      </span>
    </>
  );
  if (workflowId === null) return <li className="wp-run">{body}</li>;
  return (
    <li>
      <a
        className="nav-link wp-run"
        data-open={current ? "" : undefined}
        aria-current={current ? "true" : undefined}
        href={`/w/${encodeURIComponent(workflowId)}?run=${encodeURIComponent(row.runId)}`}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          navigate({ kind: "workflow", id: workflowId, version: row.version, runId: row.runId });
        }}
      >
        {body}
      </a>
    </li>
  );
}

export function RunsTab({ model, names, activeRunId }: RunsTabProps) {
  const { runs, error, loading } = model;
  if (runs === null && error !== null) {
    return (
      <div className="stack-tight">
        <Callout tone="danger" title="Could not load runs">
          {error.message}
        </Callout>
        <Button data-variant="secondary" onClick={model.refetch}>
          Retry
        </Button>
      </div>
    );
  }
  if (runs === null || (loading && runs.length === 0)) {
    return (
      <ul className="nav-list" aria-label="Loading runs">
        {[0, 1, 2, 3].map((row) => (
          <li key={row} className="wp-row">
            <span className="skeleton" data-width="2" />
          </li>
        ))}
      </ul>
    );
  }
  if (runs.length === 0) {
    return (
      <EmptyState icon="run" title="No runs">
        Runs appear here after you start one.
      </EmptyState>
    );
  }
  return (
    <>
      <ul className="nav-list" aria-label="Runs">
        {runRows(runs, names).map((row) => (
          <Row key={row.runId} row={row} current={row.runId === activeRunId} />
        ))}
      </ul>
      {model.moreError === null ? null : (
        <Callout tone="danger" title="Could not load more runs">
          {model.moreError}
        </Callout>
      )}
      {model.hasMore ? (
        <Button data-variant="secondary" disabled={model.loadingMore} onClick={model.loadMore}>
          {model.loadingMore ? <span className="spinner" aria-hidden="true" /> : null}
          Load more
        </Button>
      ) : null}
    </>
  );
}
