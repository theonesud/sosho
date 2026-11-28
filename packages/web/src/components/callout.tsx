import type { ReactNode } from "react";
import { Icon } from "./icon";
import type { IconName } from "./icon-paths";

export type CalloutTone = "info" | "success" | "warning" | "danger";

const toneIcon: Readonly<Record<CalloutTone, IconName>> = {
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
};

interface CalloutProps {
  readonly tone: CalloutTone;
  readonly title: string;
  readonly children: ReactNode;
}

export function Callout({ tone, title, children }: CalloutProps) {
  return (
    <div className="callout" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={toneIcon[tone]} size={18} className="callout-icon" />
      <div className="stack-tight">
        <strong>{title}</strong>
        <span>{children}</span>
      </div>
    </div>
  );
}
