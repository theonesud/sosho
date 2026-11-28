import { kindMeta } from "../meta";
import type { NodeKind } from "../types";
import { Icon } from "./icon";

interface NodeKindBadgeProps {
  readonly kind: NodeKind;
}

export function NodeKindBadge({ kind }: NodeKindBadgeProps) {
  const meta = kindMeta[kind];
  return (
    <span className="badge" data-kind={kind}>
      <Icon name={meta.icon} size={12} className="badge-icon" />
      {meta.label}
    </span>
  );
}
