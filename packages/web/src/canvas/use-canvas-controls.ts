import { type RefObject, useCallback, useEffect } from "react";
import type { Selection } from "../state/selection";
import { fitViewport, type Viewport, zoomAt } from "./camera";
import type { CanvasLayout } from "./layout";
import { frameSize } from "./use-camera-follow";

const ZOOM_STEP = 1.25;

interface ZoomOptions {
  readonly frame: RefObject<HTMLDivElement | null>;
  readonly layout: CanvasLayout;
  readonly getView: () => Viewport | null;
  readonly moveTo: (view: Viewport, animate: boolean) => void;
}

export function useZoomControls({ frame, layout, getView, moveTo }: ZoomOptions) {
  const zoomBy = useCallback(
    (factor: number) => {
      const size = frameSize(frame);
      const view = getView();
      if (size && view) moveTo(zoomAt(view, factor, size.width / 2, size.height / 2), true);
    },
    [frame, getView, moveTo],
  );
  const fit = useCallback(() => {
    const size = frameSize(frame);
    if (size) moveTo(fitViewport(layout, size), true);
  }, [frame, layout, moveTo]);
  return {
    zoomIn: useCallback(() => zoomBy(ZOOM_STEP), [zoomBy]),
    zoomOut: useCallback(() => zoomBy(1 / ZOOM_STEP), [zoomBy]),
    fit,
  };
}

export function useEscapeToDeselect(
  selection: Selection,
  onSelect: (selection: Selection) => void,
): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code === "Escape" && !event.defaultPrevented && selection.kind !== null) {
        onSelect({ kind: null });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection.kind, onSelect]);
}
