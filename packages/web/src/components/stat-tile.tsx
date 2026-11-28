import { Icon } from "./icon";
import type { IconName } from "./icon-paths";
import { useCountTween } from "./use-count-tween";

interface StatTileProps {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly icon: IconName;
}

export function StatTile({ label, value, detail, icon }: StatTileProps) {
  const shown = useCountTween(value);
  return (
    <div className="stat-tile">
      <div className="stat-label">
        <Icon name={icon} size={14} />
        {label}
      </div>
      <div className="stat-value">
        <span aria-hidden="true">{shown}</span>
        <span className="visually-hidden">{value}</span>
      </div>
      <div className="stat-detail">{detail}</div>
    </div>
  );
}
