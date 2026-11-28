export function easeOut(t: number): number {
  return 1 - (1 - t) ** 4;
}

export function readTweenMs(el: Element | null): number {
  if (!el) return 0;
  const raw = getComputedStyle(el).getPropertyValue("--duration-tween").trim();
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return 0;
  return raw.endsWith("ms") ? value : value * 1000;
}
