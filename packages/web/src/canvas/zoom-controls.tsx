import { IconTip } from "../components/icon-tip";

interface ZoomControlsProps {
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFit: () => void;
}

export function ZoomControls({ onZoomIn, onZoomOut, onFit }: ZoomControlsProps) {
  return (
    <div className="cv-zoom" role="toolbar" aria-label="Zoom" data-no-pan>
      <IconTip icon="plus" label="Zoom in" side="top" onClick={onZoomIn} />
      <IconTip icon="minus" label="Zoom out" side="top" onClick={onZoomOut} />
      <IconTip icon="fit" label="Fit graph" side="top" onClick={onFit} />
    </div>
  );
}
