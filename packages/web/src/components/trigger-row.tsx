import { Label } from "@ui-sdk/react/label";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import { useState } from "react";
import { CopyButton } from "./copy-button";
import { Icon } from "./icon";
import type { IconName } from "./icon-paths";

interface TriggerRowProps {
  readonly kind: "cron" | "webhook";
  readonly title: string;
  readonly detail: string;
  readonly nextRun?: string;
  readonly defaultActive: boolean;
}

export function TriggerRow({ kind, title, detail, nextRun, defaultActive }: TriggerRowProps) {
  const [active, setActive] = useState(defaultActive);
  const icon: IconName = kind === "cron" ? "clock" : "link";
  return (
    <div className="card trigger-row" data-inactive={active ? undefined : ""}>
      <span className="trigger-icon">
        <Icon name={icon} size={16} />
      </span>
      <div className="stack-tight trigger-body">
        <strong>{title}</strong>
        <span className="mono muted trigger-detail">{detail}</span>
        {nextRun ? <span className="muted">Next run {nextRun}</span> : null}
      </div>
      {kind === "webhook" ? <CopyButton value={detail} label={`Copy URL for ${title}`} /> : null}
      <Label className="inline-label">
        <span className="muted">Active</span>
        <Switch checked={active} onCheckedChange={setActive} aria-label={`${title} active`}>
          <SwitchThumb />
        </Switch>
      </Label>
    </div>
  );
}
