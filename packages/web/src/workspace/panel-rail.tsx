import { IconTip } from "../components/icon-tip";
import { waitingLabel } from "../waiting/waiting";

export function PanelRail({
  waitingCount,
  onExpand,
}: {
  readonly waitingCount: number;
  readonly onExpand: () => void;
}) {
  return (
    <div className="wp-rail">
      <IconTip icon="chevronRight" label="Expand panel" side="right" onClick={onExpand} />
      {waitingCount > 0 ? (
        <span
          className="wp-rail-dot"
          data-status="waiting"
          role="status"
          aria-label={waitingLabel(waitingCount)}
          title={waitingLabel(waitingCount)}
        >
          {waitingCount}
        </span>
      ) : null}
    </div>
  );
}
