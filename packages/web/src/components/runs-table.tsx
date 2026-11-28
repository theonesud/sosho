import { Button } from "@ui-sdk/react/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@ui-sdk/react/menu";
import { toast } from "@ui-sdk/react/toast";
import type { RunRow } from "../types";
import { Icon } from "./icon";
import { RunStatusBadge } from "./run-status-badge";

export type SortDirection = "ascending" | "descending";

interface RunsTableProps {
  readonly rows: readonly RunRow[];
  readonly loading: boolean;
  readonly direction: SortDirection;
  readonly page: number;
  readonly onToggleSort: () => void;
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return "-";
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function RowMenu({ run }: { readonly run: RunRow }) {
  return (
    <Menu onAction={(value) => toast(`${value} requested`, { description: run.id })}>
      <MenuTrigger render={<Button data-variant="ghost" aria-label={`Actions for ${run.id}`} />}>
        <Icon name="more" />
      </MenuTrigger>
      <MenuContent>
        <MenuItem value="Open">Open run</MenuItem>
        <MenuItem value="Resume" disabled={run.status !== "waiting"}>
          Resume
        </MenuItem>
        <MenuItem value="Fork">Fork from here</MenuItem>
        <MenuSeparator />
        <MenuItem value="Cancel" disabled={run.status !== "running"}>
          Cancel run
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((row) => (
        <tr key={row}>
          {[0, 1, 2, 3, 4, 5].map((cell) => (
            <td key={cell}>
              <span className="skeleton" data-width={cell % 3} aria-hidden="true" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function RunsTable({ rows, loading, direction, page, onToggleSort }: RunsTableProps) {
  return (
    <div className="table-wrap card">
      <table className="data-table" aria-busy={loading}>
        <caption className="visually-hidden">Recent runs</caption>
        <thead>
          <tr>
            <th scope="col">Run</th>
            <th scope="col">Workflow</th>
            <th scope="col">Status</th>
            <th scope="col" aria-sort={direction}>
              <button type="button" className="sort-button" onClick={onToggleSort}>
                Started
                <Icon name="arrowDown" size={12} className="sort-icon" data-direction={direction} />
              </button>
            </th>
            <th scope="col" className="num">
              Duration
            </th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows />
          ) : (
            rows.map((run) => (
              <tr key={`${page}-${direction}-${run.id}`}>
                <td className="mono">{run.id}</td>
                <td>{run.workflow}</td>
                <td>
                  <RunStatusBadge status={run.status} />
                </td>
                <td className="mono">{run.startedAt}</td>
                <td className="mono num">{formatDuration(run.durationSeconds)}</td>
                <td className="num">
                  <RowMenu run={run} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
