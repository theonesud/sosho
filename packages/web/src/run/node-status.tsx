import { Icon } from "../components/icon";
import type { IconName } from "../components/icon-paths";
import { statusMeta } from "../meta";
import type { NodeStatus } from "./run-state";

export const nodeStatusMeta = (status: NodeStatus): { label: string; icon: IconName } =>
  status === "skipped" ? { label: "Skipped", icon: "ring" } : statusMeta[status];

export function NodeStatusBadge({ status }: { readonly status: NodeStatus }) {
  const meta = nodeStatusMeta(status);
  return (
    <span className="badge" data-status={status}>
      <span className="badge-swap" key={status}>
        <Icon name={meta.icon} size={12} className="badge-icon" />
        <span className="badge-label">{meta.label}</span>
      </span>
    </span>
  );
}
