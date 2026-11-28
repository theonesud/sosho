export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect extends Size {
  readonly x: number;
  readonly y: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2.5;
const FIT_MAX_ZOOM = 1;

export function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

export function zoomAt(view: Viewport, factor: number, cx: number, cy: number): Viewport {
  const k = clampZoom(view.k * factor);
  const ratio = k / view.k;
  return { k, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio };
}

export function centerOnRect(rect: Rect, frame: Size, k: number): Viewport {
  return {
    k,
    x: frame.width / 2 - (rect.x + rect.width / 2) * k,
    y: frame.height / 2 - (rect.y + rect.height / 2) * k,
  };
}

export const TOP_MARGIN = 72;

export function revealRect(rect: Rect, frame: Size, k: number): Viewport {
  const centered = centerOnRect(rect, frame, k);
  if (rect.height * k + 2 * TOP_MARGIN <= frame.height) return centered;
  return { ...centered, y: TOP_MARGIN - rect.y * k };
}

export function holdTop(view: Viewport, from: Rect, to: Rect): Viewport {
  const dx = from.x + from.width / 2 - (to.x + to.width / 2);
  return { k: view.k, x: view.x + dx * view.k, y: view.y + (from.y - to.y) * view.k };
}

export function fitViewport(content: Size, frame: Size): Viewport {
  if (content.width <= 0 || content.height <= 0) return { x: 0, y: 0, k: 1 };
  const k = clampZoom(
    Math.min(frame.width / content.width, frame.height / content.height, FIT_MAX_ZOOM),
  );
  return centerOnRect({ x: 0, y: 0, ...content }, frame, k);
}

export function viewTransform(view: Viewport): string {
  return `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
}
