import type { ReactNode } from "react";
import { Icon } from "./icon";
import type { IconName } from "./icon-paths";

interface EmptyStateProps {
  readonly icon: IconName;
  readonly title: string;
  readonly tone?: "neutral" | "danger";
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly afterCollapse?: boolean;
}

export function EmptyState({
  icon,
  title,
  tone = "neutral",
  children,
  action,
  afterCollapse = false,
}: EmptyStateProps) {
  return (
    <div
      className="empty-state"
      data-tone={tone}
      data-after-collapse={afterCollapse ? "" : undefined}
    >
      <span className="empty-icon">
        <Icon name={icon} size={20} />
      </span>
      <h4>{title}</h4>
      <p className="muted">{children}</p>
      {action}
    </div>
  );
}
