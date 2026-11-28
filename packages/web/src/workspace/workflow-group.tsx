import { listVersions } from "../api";
import type { VersionSummary, WorkflowSummary } from "../api/types";
import { useFetch } from "../api/use-fetch";
import { navigate } from "../route";
import { sortVersions } from "./panel-model";
import { RenameInput } from "./rename-input";
import { RowMenu } from "./row-menu";
import type { DuplicateSource } from "./use-actions";

export interface GroupActions {
  readonly busy: boolean;
  readonly onDuplicate: (source: DuplicateSource) => void;
  readonly onRename: (id: string, name: string) => Promise<string | null>;
  readonly onDelete: (id: string, name: string) => void;
}

interface WorkflowGroupProps extends GroupActions {
  readonly item: WorkflowSummary;
  readonly activeId: string | null;
  readonly openedVersion: number | null;
  readonly renaming: boolean;
  readonly onRenameStart: (id: string | null) => void;
}

const plainClick = (event: React.MouseEvent): boolean =>
  !(event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0);

const formatDate = (iso: string): string => iso.slice(0, 16).replace("T", " ");

function hrefOf(id: string, version: number | null): string {
  return `/w/${encodeURIComponent(id)}${version === null ? "" : `?v=${version}`}`;
}

function openOnClick(id: string, version: number | null) {
  return (event: React.MouseEvent) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    navigate({ kind: "workflow", id, version, runId: null });
  };
}

function Header(props: WorkflowGroupProps & { readonly empty: boolean }) {
  const { item, activeId, openedVersion, busy, empty, renaming } = props;
  const active = item.id === activeId;
  if (renaming) {
    return (
      <div className="wp-group-head" data-renaming="">
        <RenameInput
          name={item.name}
          onRename={(name) => props.onRename(item.id, name)}
          onClose={() => props.onRenameStart(null)}
        />
      </div>
    );
  }
  const latest = item.latest_version;
  const current = empty && active && openedVersion === null;
  return (
    <div className="wp-group-head" data-active={active ? "" : undefined}>
      <a
        className="nav-link wp-link wp-group-link"
        data-open={current ? "" : undefined}
        href={hrefOf(item.id, null)}
        aria-current={current ? "true" : undefined}
        title={item.name}
        onClick={openOnClick(item.id, null)}
      >
        <span className="wp-name">{item.name}</span>
      </a>
      <RowMenu
        label={item.name}
        items={[
          { value: "rename", label: "Rename" },
          { value: "duplicate", label: "Duplicate", disabled: busy || latest === null },
          { value: "delete", label: "Delete", destructive: true },
        ]}
        onAction={(value) => {
          if (value === "rename") props.onRenameStart(item.id);
          if (value === "duplicate" && latest !== null) {
            props.onDuplicate({ id: item.id, name: item.name, version: latest });
          }
          if (value === "delete") props.onDelete(item.id, item.name);
        }}
      />
    </div>
  );
}

interface VersionRowProps {
  readonly item: WorkflowSummary;
  readonly entry: VersionSummary;
  readonly current: boolean;
  readonly busy: boolean;
  readonly onDuplicate: (source: DuplicateSource) => void;
}

function VersionRow({ item, entry, current, busy, onDuplicate }: VersionRowProps) {
  return (
    <li className="wp-item" data-row="version">
      <a
        className="nav-link wp-link"
        data-open={current ? "" : undefined}
        href={hrefOf(item.id, entry.version)}
        aria-current={current ? "true" : undefined}
        title={`${item.name} v${entry.version}, saved ${formatDate(entry.created_at)}`}
        onClick={openOnClick(item.id, entry.version)}
      >
        <span className="wp-name">v{entry.version}</span>
        <span className="wp-version">{formatDate(entry.created_at)}</span>
      </a>
      <RowMenu
        label={`${item.name} v${entry.version}`}
        items={[{ value: "duplicate", label: "Duplicate from this version", disabled: busy }]}
        onAction={() => onDuplicate({ id: item.id, name: item.name, version: entry.version })}
      />
    </li>
  );
}

function Versions(props: WorkflowGroupProps & { readonly rows: readonly VersionSummary[] }) {
  const { item, activeId, openedVersion, busy, onDuplicate, rows } = props;
  return (
    <ul className="wp-versions" aria-label={`${item.name} versions`}>
      {rows.map((entry) => (
        <VersionRow
          key={entry.version}
          item={item}
          entry={entry}
          current={item.id === activeId && entry.version === openedVersion}
          busy={busy}
          onDuplicate={onDuplicate}
        />
      ))}
    </ul>
  );
}

export function WorkflowGroup(props: WorkflowGroupProps) {
  const { item } = props;
  const versions = useFetch(
    (signal) => listVersions(item.id, signal),
    `versions:${item.id}:${item.latest_version}`,
  );
  const rows = versions.data === null ? null : sortVersions(versions.data);
  return (
    <li className="wp-group" data-group={item.id}>
      <Header {...props} empty={rows !== null && rows.length === 0} />
      {rows === null ? (
        versions.error === null ? (
          <span className="skeleton wp-versions-skeleton" data-width="2" />
        ) : (
          <p className="muted wp-note" role="alert">
            Could not load versions of {item.name}.
          </p>
        )
      ) : (
        <Versions {...props} rows={rows} />
      )}
    </li>
  );
}
