import { statusMeta } from "../meta";
import type { RunStatus } from "../types";
import { Icon } from "./icon";

interface RunStatusBadgeProps {
  readonly status: RunStatus;
}

export function RunStatusBadge({ status }: RunStatusBadgeProps) {
  const meta = statusMeta[status];
  return (
    <span className="badge" data-status={status}>
      <span className="badge-swap" key={status}>
        <Icon name={meta.icon} size={12} className="badge-icon" />
        <span className="badge-label">{meta.label}</span>
      </span>
    </span>
  );
}
